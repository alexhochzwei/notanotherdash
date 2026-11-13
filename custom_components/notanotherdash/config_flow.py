"""Config Flow: genau ein Eintrag, optional nur für Administratoren sichtbar."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback

from .const import DOMAIN

OPT_ADMIN_ONLY = "admin_only"


class NotAnotherDashConfigFlow(ConfigFlow, domain=DOMAIN):
    """Legt den einzigen Eintrag an."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="Not Another Dash", data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return NotAnotherDashOptionsFlow(config_entry)


class NotAnotherDashOptionsFlow(OptionsFlow):
    """Ob nur Administratoren das Panel sehen."""

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        schema = vol.Schema(
            {vol.Required(OPT_ADMIN_ONLY, default=self._entry.options.get(OPT_ADMIN_ONLY, False)): bool}
        )
        return self.async_show_form(step_id="init", data_schema=schema)
