"""Single local coordinator configured through the HA integrations screen."""
from homeassistant import config_entries
from .const import DOMAIN

class NativePanelConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="Native Home Panel", data={})
        return self.async_show_form(step_id="user")
