"""Reinigungsplan für den Saugroboter.

Läuft in der Integration, damit der Plan auch ohne offenes Dashboard ausgeführt wird.
Ein Eintrag ({id, enabled, days, time, segments}) wird an seinen Wochentagen zur Uhrzeit
fällig. Ist eine Anwesenheits-Entität eingestellt, wartet der Eintrag, bis niemand zuhause
ist; um Mitternacht verfällt er. Pro Minute startet höchstens eine Reinigung, weitere
fällige Einträge warten, bis der Sauger wieder frei ist.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Event, HomeAssistant, State, callback
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import SCHEDULE_STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)

HOME_STATES = ("on", "home", "true")
AWAY_STATES = ("off", "not_home", "away", "false")
BUSY_STATES = ("cleaning", "returning")


def presence(state: State | None) -> bool | None:
    """True = jemand zuhause, False = niemand, None = unbekannt.

    Versteht input_boolean/binary_sensor/switch (an = zuhause), person/device_tracker
    (home, andere Zonen = weg) und zone (Anzahl Personen in der Zone).
    """
    if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE, ""):
        return None
    s = state.state.lower()
    if s in HOME_STATES:
        return True
    if s in AWAY_STATES:
        return False
    try:
        return float(s) > 0
    except ValueError:
        # person/device_tracker in einer anderen Zone
        return False


def parse_time(value: Any) -> tuple[int, int] | None:
    try:
        h, m = str(value).split(":")[:2]
        h, m = int(h), int(m)
    except (ValueError, TypeError):
        return None
    if 0 <= h < 24 and 0 <= m < 60:
        return h, m
    return None


def due_entries(schedule: list[dict], now: datetime, runs: dict[str, dict]) -> list[dict]:
    """Einträge, die heute fällig und noch nicht erledigt sind (Wochentag 0 = Montag)."""
    today = now.date().isoformat()
    out = []
    for e in schedule or []:
        if not isinstance(e, dict) or not e.get("id") or e.get("enabled") is False:
            continue
        if now.weekday() not in (e.get("days") or []):
            continue
        t = parse_time(e.get("time"))
        if t is None or (now.hour, now.minute) < t:
            continue
        # Erst nach der Uhrzeit angelegt oder geändert: heute nicht mehr nachholen.
        since = e.get("since")
        if isinstance(since, str) and since[:10] == today and since[11:16] > "%02d:%02d" % t:
            continue
        run = runs.get(e["id"])
        if run and run.get("date") == today and run.get("status") == "done":
            continue
        out.append(e)
    return sorted(out, key=lambda e: parse_time(e.get("time")) or (0, 0))


class VacuumScheduler:
    """Führt den Reinigungsplan aus den Dashboard-Einstellungen aus."""

    def __init__(self, hass: HomeAssistant, settings) -> None:
        self.hass = hass
        self.settings = settings  # SettingsStore
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, SCHEDULE_STORAGE_KEY)
        self.runs: dict[str, dict] = {}
        self._unsubs: list = []
        self._presence_unsub = None
        self._presence_id: str | None = None

    async def async_start(self) -> None:
        self.runs = (await self._store.async_load() or {}).get("runs", {})
        self._unsubs.append(async_track_time_change(self.hass, self._tick, second=5))
        self._watch_presence()

    @callback
    def async_stop(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs = []
        if self._presence_unsub:
            self._presence_unsub()
            self._presence_unsub = None

    @callback
    def settings_changed(self) -> None:
        self._watch_presence()

    @callback
    def _watch_presence(self) -> None:
        pid = self.settings.data.get("presence_entity")
        if pid == self._presence_id:
            return
        if self._presence_unsub:
            self._presence_unsub()
            self._presence_unsub = None
        self._presence_id = pid
        if pid:
            self._presence_unsub = async_track_state_change_event(self.hass, [pid], self._presence_event)

    @callback
    def _presence_event(self, event: Event) -> None:
        if presence(event.data.get("new_state")) is False:
            self.hass.async_create_task(self._run())

    @callback
    def _tick(self, now: datetime) -> None:
        self.hass.async_create_task(self._run())

    def state(self) -> dict[str, Any]:
        """Status je Eintrag für das Dashboard: heute wartend oder erledigt."""
        today = dt_util.now().date().isoformat()
        data = self.settings.data
        waiting = [e["id"] for e in due_entries(data.get("vacuum_schedule") or [], dt_util.now(), self.runs)]
        return {
            "today": today,
            "runs": {k: v for k, v in self.runs.items() if v.get("date") == today},
            "waiting": waiting,
        }

    async def _run(self) -> None:
        data = self.settings.data
        vac_id = data.get("vacuum_entity")
        schedule = data.get("vacuum_schedule") or []
        if not vac_id or not schedule:
            return
        now = dt_util.now()
        due = due_entries(schedule, now, self.runs)
        if not due:
            return
        pid = data.get("presence_entity")
        if pid and presence(self.hass.states.get(pid)) is not False:
            return  # jemand zuhause oder unbekannt: warten
        vac = self.hass.states.get(vac_id)
        if vac is None or vac.state in BUSY_STATES or vac.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            return
        entry = due[0]
        segments = [int(s) for s in entry.get("segments") or [] if str(s).isdigit()]
        try:
            if segments:
                await self.hass.services.async_call(
                    "vacuum",
                    "send_command",
                    {"entity_id": vac_id, "command": "app_segment_clean", "params": [{"segments": segments, "repeat": 1}]},
                    blocking=True,
                )
            else:
                await self.hass.services.async_call("vacuum", "start", {"entity_id": vac_id}, blocking=True)
        except Exception:  # noqa: BLE001 – Fehler des Saugers sollen den Planer nicht stoppen
            _LOGGER.exception("Reinigungsplan: Start fehlgeschlagen (%s)", entry.get("id"))
            return
        self.runs[entry["id"]] = {"date": now.date().isoformat(), "status": "done", "at": now.isoformat(timespec="minutes")}
        today = now.date().isoformat()
        self.runs = {k: v for k, v in self.runs.items() if v.get("date") == today}
        await self._store.async_save({"runs": self.runs})
        _LOGGER.info("Reinigungsplan: %s gestartet", entry.get("id"))
