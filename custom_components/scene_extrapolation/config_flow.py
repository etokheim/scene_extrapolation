"""Config flow for Scene Extrapolation integration."""
from __future__ import annotations

import logging
import os
from typing import Any

import voluptuous as vol
import homeassistant.helpers.config_validation as config_validation
import yaml
import inspect

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import selector
from homeassistant.helpers import area_registry

from .const import (
    DOMAIN,
    SCENE_NAME,
    SCENE_NIGHT_RISING_NAME,
    SCENE_DAWN_NAME,
    SCENE_DAY_RISING_NAME,
    SCENE_DAY_SETTING_NAME,
    SCENE_DUSK_NAME,
    SCENE_NIGHT_SETTING_NAME,
    AREA
)

_LOGGER = logging.getLogger(__name__)

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

        areas, area_names = await get_areas_and_area_names(self.hass)

        # User configuration data (when setting up the integration for the first time)
        data_schema = vol.Schema(
            {
                vol.Required("device_name"): str,
                vol.Optional("scene_name", default="Extrapolation Scene"): str,
                vol.Optional(
                    "area",
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=area_names,
                        multiple=False,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    ),
                ),
            }
        )

        if user_input is None:
            return self.async_show_form(
                step_id="user", data_schema=data_schema
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
            step_id="user", data_schema=data_schema, errors=errors
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Create the options flow."""

        return OptionsFlowHandler(config_entry)


class CannotReadScenesFile(HomeAssistantError):
    """Error to indicate we cannot read the file."""

# TODO: We will probably also have to add an options update event listener
# which runs when the config is updated. This event handler should probably
# reload the components configuration...
class OptionsFlowHandler(config_entries.OptionsFlow):
    """Handle the options flow for Scene Extrapolation (configure button on integration card)"""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        # TODO: There must be a better way to get the scene's light configuration than
        # reading and parsing the yaml file manually, like we are doing now.

        # Something like:
        # scenes = self.hass.states.async_entity_ids("scene")

        # Get the first scene
        # scene = self.hass.states.get(scenes[0])

        # Get that scene's first light's rgb_color (not it's current state, but the
        # one defined in the scene)
        # scene.attributes["entity_id"][0]["rgb_color"])


        # Read and parse the scenes.yaml file
        scenes = None

        try:
            with open("./config/scenes.yaml", "r") as file: # Open file in "r" (read mode)
                data = file.read()

                scenes = yaml.load(data, Loader=yaml.loader.SafeLoader)

        except Exception as exception:
            pwd = os.getcwd()
            _LOGGER.warn("Couldn't find the scenes.yaml file in: %s, which has the following content:", pwd)

            ls = os.listdir()
            _LOGGER.warn(ls)
            raise CannotReadScenesFile() from exception

        scene_names = []

        for scene in scenes:
            scene_names.append(scene["name"])

        areas, area_names = await get_areas_and_area_names(self.hass)

        schema = vol.Schema(
            {
                # vol.Required(
                #     "scene_day",
                #     default=list(self.scenes),
                # ): config_validation.multi_select(scene_names),
                vol.Optional(SCENE_NAME, default=self.config_entry.options.get(SCENE_NAME) or self.config_entry.data.get(SCENE_NAME)): str,
                vol.Optional(
                    AREA,
                    default=self.config_entry.options.get(AREA) or self.config_entry.data.get(AREA)
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=area_names,
                        multiple=False,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    ),
                ),
                vol.Required(
                    SCENE_NIGHT_RISING_NAME,
                    default=self.config_entry.options.get(SCENE_NIGHT_RISING_NAME)
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=scene_names,
                        multiple=False,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    ),
                ),
                vol.Required(
                    SCENE_DAWN_NAME,
                    default=self.config_entry.options.get(SCENE_DAWN_NAME)
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=scene_names,
                        multiple=False,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    ),
                ),
                vol.Required(
                    SCENE_DAY_RISING_NAME,
                    default=self.config_entry.options.get(SCENE_DAY_RISING_NAME)
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=scene_names,
                        multiple=False,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    ),
                ),
                vol.Required(
                    SCENE_DAY_SETTING_NAME,
                    default=self.config_entry.options.get(SCENE_DAY_SETTING_NAME)
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=scene_names,
                        multiple=False,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    ),
                ),
                vol.Required(
                    SCENE_DUSK_NAME,
                    default=self.config_entry.options.get(SCENE_DUSK_NAME)
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=scene_names,
                        multiple=False,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    ),
                ),
                vol.Required(
                    SCENE_NIGHT_SETTING_NAME,
                    default=self.config_entry.options.get(SCENE_NIGHT_SETTING_NAME)
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

        return self.async_show_form(
            step_id="init",
            data_schema=schema,
        )


async def get_areas_and_area_names(hass) -> list:
    # TODO: Apparently this is deprecated. Should use async_get instead
    area_registry_instance = await area_registry.async_get_registry(hass)
    areas = area_registry_instance.async_list_areas()

    area_names = []
    for area in areas:
        area_names.append(area.name)

    return [areas, area_names]
