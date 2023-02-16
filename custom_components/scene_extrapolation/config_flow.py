# TODO: Change all "scene_day" strings to global variables imported from consts.
# That way we can change the name and variable easily with the rename symbol function.

"""Config flow for Scene Extrapolation integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
import homeassistant.helpers.config_validation as config_validation
import yaml

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import selector

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# User configuration data (when setting up the integration for the first time)
STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required("device_name"): str,
    }
)


class PlaceholderHub:
    """Placeholder class to make tests pass.

    TODO Remove this placeholder class and replace with things from your PyPI package.
    """

    def __init__(self, host: str) -> None:
        """Initialize."""
        self.host = host

    async def authenticate(self, username: str, password: str) -> bool:
        """Test if we can authenticate with the host."""
        return True


async def validate_input(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """Validate the user input.

    Data has the keys from STEP_USER_DATA_SCHEMA with values provided by the user.
    """
    # TODO validate the data can be used to set up a connection.

    # If your PyPI package is not built with async, pass your methods
    # to the executor:
    # await hass.async_add_executor_job(
    #     your_validate_func, data["username"], data["password"]
    # )


    # hub = PlaceholderHub(data["host"])

    # if not await hub.authenticate(data["username"], data["password"]):
    #    raise InvalidAuth

    # If you cannot connect:
    # throw CannotConnect
    # If the authentication is wrong:
    # InvalidAuth

    # Return info that you want to store in the config entry.
    return {"title": data["device_name"]}


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Scene Extrapolation."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        if user_input is None:
            return self.async_show_form(
                step_id="user", data_schema=STEP_USER_DATA_SCHEMA
            )

        errors = {}

        try:
            info = await validate_input(self.hass, user_input)
        except CannotReadScenesFile:
            errors["base"] = "cant_read_scenes_file"
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception("Unexpected exception")
            errors["base"] = "unknown"
        else:
            return self.async_create_entry(title=info["title"], data=user_input)

        return self.async_show_form(
            step_id="user", data_schema=STEP_USER_DATA_SCHEMA, errors=errors
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Create the options flow."""

        # Parse the scenes file and send it to the options flow
        scenes = None

        try:
            with open("./config/scenes.yaml", "r") as file: # Open file in "r" (read mode)
                data = file.read()

                scenes = yaml.load(data, Loader=yaml.loader.SafeLoader)

            _LOGGER.info("Successfully found and opened the scenes.yaml file")
            _LOGGER.info(scenes)

        except Exception as exception:
            raise CannotReadScenesFile() from exception

        return OptionsFlowHandler(config_entry, scenes)


class CannotReadScenesFile(HomeAssistantError):
    """Error to indicate we cannot read the file."""

# TODO: We will probably also have to add an options update event listener
# which runs when the config is updated. This event handler should probably
# reload the components configuration...
class OptionsFlowHandler(config_entries.OptionsFlow):
    """Handle the options flow for Scene Extrapolation (configure button on integration card)"""

    def __init__(self, config_entry: config_entries.ConfigEntry, scenes) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry
        self.scenes = scenes

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        scene_names = []

        for scene in self.scenes:
            scene_names.append(scene["name"])

        schema = vol.Schema(
            {
                # vol.Required(
                #     "scene_day",
                #     default=list(self.scenes),
                # ): config_validation.multi_select(scene_names),
                vol.Required(
                    "scene_day",
                    default=self.config_entry.options.get("scene_day")
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=scene_names,
                        multiple=False,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    ),
                ),
                vol.Required(
                    "scene_sundown",
                    default=self.config_entry.options.get("scene_sundown")
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=scene_names,
                        multiple=False,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    ),
                ),
                # vol.Required(
                #     "show_things",
                #     default=self.config_entry.options.get("show_things"),
                # ): bool,
                # vol.Optional(
                #     "scene_dusk",
                #     default=self.config_entry.options.get("scene_dusk"),
                # ): str,
            }
        )

        _LOGGER.info(schema)

        return self.async_show_form(
            step_id="init",
            data_schema=schema,
        )