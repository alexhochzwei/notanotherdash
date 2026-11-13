"""Not Another Dash: ein Wandtablet-Dashboard, das sich aus den Bereichen in Home Assistant aufbaut.

Die Panel-Registrierung, die Auslieferung des Frontends und die Einstellungs-API
folgen dem Aufbau von HausPanel (https://github.com/alpacalabs-de/hauspanel, MIT).
"""

from __future__ import annotations

import hashlib
import inspect
import os
from pathlib import Path
from typing import Any

import voluptuous as vol
from aiohttp import web

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType

from .config_flow import OPT_ADMIN_ONLY
from .const import (
    DOMAIN,
    PANEL_URL,
    SIGNAL_SETTINGS_UPDATED,
    STATIC_URL,
    STORAGE_KEY,
    STORAGE_VERSION,
    VERSION,
)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
FRONTEND_DIR = Path(__file__).parent / "frontend"
# NOTANOTHERDASH_DEV=1 liefert das Frontend ohne Cache aus (zum Entwickeln).
DEV = bool(os.environ.get("NOTANOTHERDASH_DEV"))
# Neuere HA-Versionen kennen die Option, ältere nicht.
SAFE_AREA = (
    {"handle_safe_area": True}
    if "handle_safe_area" in inspect.signature(panel_custom.async_register_panel).parameters
    else {}
)
ALLOWED_SUFFIXES = (".js", ".css", ".svg", ".png", ".woff2")


class SettingsStore:
    """Gemeinsame Einstellungen des Panels in .storage (gelten für alle Geräte)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data: dict[str, Any] = {}
        self.revision = 0

    async def async_load(self) -> None:
        self.data = await self._store.async_load() or {}

    async def async_save(self, data: dict[str, Any]) -> None:
        self.data = data
        self.revision += 1
        await self._store.async_save(data)
        async_dispatcher_send(self.hass, SIGNAL_SETTINGS_UPDATED, self.revision)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Websocket-Befehle einmalig registrieren."""
    websocket_api.async_register_command(hass, ws_settings_get)
    websocket_api.async_register_command(hass, ws_settings_save)
    websocket_api.async_register_command(hass, ws_settings_subscribe)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Einstellungen laden und das Panel in die Seitenleiste eintragen."""
    store = SettingsStore(hass)
    await store.async_load()
    hass.data[DOMAIN] = store

    if not hass.data.get(f"{DOMAIN}_static"):
        hass.http.register_view(FrontendView())
        hass.data[f"{DOMAIN}_static"] = True

    build = await hass.async_add_executor_job(_build_id)
    entry.async_on_unload(entry.add_update_listener(_options_changed))
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="notanotherdash-panel",
        frontend_url_path=PANEL_URL,
        module_url=f"{STATIC_URL}/{build}/notanotherdash.js",
        sidebar_title="Dashboard",
        sidebar_icon="mdi:view-dashboard-variant-outline",
        require_admin=bool(entry.options.get(OPT_ADMIN_ONLY, False)),
        **SAFE_AREA,
        config={"version": VERSION},
    )
    return True


async def _options_changed(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Panel entfernen."""
    frontend.async_remove_panel(hass, PANEL_URL)
    hass.data.pop(DOMAIN, None)
    return True


class FrontendView(HomeAssistantView):
    """Liefert die Frontend-Module unter einer Build-ID aus."""

    url = STATIC_URL + "/{build}/{path:.+}"
    name = "notanotherdash:frontend"
    requires_auth = False

    async def get(self, request: web.Request, build: str, path: str) -> web.StreamResponse:
        root = FRONTEND_DIR.resolve()
        file = (root / path).resolve()
        if root not in file.parents or not file.is_file() or file.suffix not in ALLOWED_SUFFIXES:
            raise web.HTTPNotFound
        # Die Build-ID ändert sich mit jedem Update, daher darf lange gecacht werden.
        cache = "no-store" if DEV else "public, max-age=31536000, immutable"
        return web.FileResponse(file, headers={"Cache-Control": cache})


def _build_id() -> str:
    """Version plus Hash der Dateien, damit Browser nach einem Update neuen Code laden."""
    if DEV:
        return "dev"
    digest = hashlib.sha1(VERSION.encode())
    for file in sorted(FRONTEND_DIR.rglob("*.js")):
        stat = file.stat()
        digest.update(f"{file.name}{stat.st_mtime_ns}{stat.st_size}".encode())
    return f"{VERSION}-{digest.hexdigest()[:8]}"


def _store(hass: HomeAssistant) -> SettingsStore | None:
    return hass.data.get(DOMAIN)


@websocket_api.websocket_command({vol.Required("type"): "notanotherdash/settings/get"})
@websocket_api.async_response
async def ws_settings_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Not Another Dash ist nicht eingerichtet")
        return
    connection.send_result(msg["id"], {"settings": store.data, "revision": store.revision})


@websocket_api.websocket_command(
    {vol.Required("type"): "notanotherdash/settings/save", vol.Required("settings"): dict}
)
@websocket_api.async_response
async def ws_settings_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Not Another Dash ist nicht eingerichtet")
        return
    await store.async_save(msg["settings"])
    connection.send_result(msg["id"], {"revision": store.revision})


@websocket_api.websocket_command({vol.Required("type"): "notanotherdash/settings/subscribe"})
@callback
def ws_settings_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Offene Dashboards benachrichtigen, wenn ein anderes Gerät Einstellungen gespeichert hat."""

    @callback
    def forward(revision: int) -> None:
        store = _store(hass)
        if store is None:
            return
        connection.send_message(
            websocket_api.event_message(msg["id"], {"settings": store.data, "revision": revision})
        )

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_SETTINGS_UPDATED, forward)
    connection.send_result(msg["id"])
