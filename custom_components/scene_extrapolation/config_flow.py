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
import homeassistant.helpers.entity_registry as entity_registry

from homeassistant.const import (
    ATTR_AREA_ID,
    ATTR_DOMAIN,
    ATTR_ENTITY_ID,
    ATTR_SERVICE,
    ATTR_SERVICE_DATA,
    ATTR_SUPPORTED_FEATURES,
    CONF_NAME,
    EVENT_CALL_SERVICE,
    EVENT_HOMEASSISTANT_STARTED,
    EVENT_STATE_CHANGED,
    SERVICE_TURN_OFF,
    SERVICE_TURN_ON,
    STATE_OFF,
    STATE_ON,
    SUN_EVENT_SUNRISE,
    SUN_EVENT_SUNSET,
)

from .const import (
    DOMAIN,
    SCENE_NAME,
    SCENE_NIGHT_RISING_NAME,
    SCENE_DAWN_NAME,
    SCENE_DAY_RISING_NAME,
    SCENE_DAY_SETTING_NAME,
    SCENE_DUSK_NAME,
    SCENE_NIGHT_SETTING_NAME,
    AREA_NAME,
    NIGHTLIGHTS_BOOLEAN_NAME,
    NIGHTLIGHTS_BOOLEAN_ID,
    NIGHTLIGHTS_SCENE_NAME
)

_LOGGER = logging.getLogger(__name__)

async def validate_input(hass: HomeAssistant, user_input: dict[str, Any], config_entry: config_entries.ConfigEntry = None) -> dict[str, Any]:
    """Validate the user input.

    Note: We use the same function for both the config flow and the options flow

    Data has the keys from STEP_USER_DATA_SCHEMA with values provided by the user.
    """

    _LOGGER.warn("Data----")
    _LOGGER.info(user_input)
    _LOGGER.warn("/Data")

    # If we are in the options flow (the integration has already been set up), then we'll fetch the device name and add it to the data
    if config_entry:
        user_input["device_name"] = config_entry.data.get("device_name")

    if AREA_NAME in user_input:
        area_name = user_input[AREA_NAME]

        area_entries, area_names = await get_areas_and_area_names(hass)
        area_name_index = area_names.index(area_name)
        _LOGGER.info(area_entries)
        _LOGGER.info("area_name_index: %s", str(area_name_index))

        area_entry = area_entries[area_name_index]
        user_input[ATTR_AREA_ID] = area_entry.id

    if NIGHTLIGHTS_BOOLEAN_NAME in user_input:
        nightlights_boolean = user_input[NIGHTLIGHTS_BOOLEAN_NAME]

        boolean, boolean_names = await get_input_booleans_and_boolean_names(hass)
        boolean_name_index = boolean_names.index(nightlights_boolean)
        _LOGGER.info("boolean_entries: %s", boolean)
        _LOGGER.info("boolean_name_index: %s", str(boolean_name_index))

        _LOGGER.info("boolean: %s", str(boolean))
        nightlights_boolean = boolean[boolean_name_index]
        _LOGGER.info("nightlights_boolean: %s", str(nightlights_boolean))
        user_input[NIGHTLIGHTS_BOOLEAN_ID] = nightlights_boolean.entity_id

    _LOGGER.error("---------")
    _LOGGER.error("Validate input")
    _LOGGER.error("---------")
    _LOGGER.info(user_input)

    # Return info that you want to store in the config entry.
    return user_input


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Scene Extrapolation."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""

        areas, area_names = await get_areas_and_area_names(self.hass)

        # User configuration data (when setting up the integration for the first time)
        config_flow_schema = vol.Schema(
            {
                vol.Required("device_name"): str,
                vol.Optional("scene_name", default="Extrapolation Scene"): str,
                vol.Optional(
                    "area_name",
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=area_names,
                        multiple=False,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    ),
                ),
            }
        )

        _LOGGER.error("---------")
        _LOGGER.error("Before user_input is None (async step user)")
        _LOGGER.error("---------")

        if user_input is None:
            return self.async_show_form(
                step_id="user", data_schema=config_flow_schema
            )

        errors = {}

        try:
            validated_input = await validate_input(self.hass, user_input)
        except CannotReadScenesFile:
            errors["base"] = "cant_read_scenes_file"
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception("Unexpected exception")
            errors["base"] = "unknown"
        else:
            return self.async_create_entry(title=validated_input["device_name"], data=user_input)

        # (If we haven't returned already)
        # Show the form again, just with the errors
        return self.async_show_form(
            step_id="user", data_schema=config_flow_schema, errors=errors
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

class CannotFindScenesFile(HomeAssistantError):
    """Error to indicate we cannot find the file."""

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

        _LOGGER.warning("self.config_entry.options: %s", self.config_entry.options)
        errors = {}

        try:
            native_scenes = await get_native_scenes()
            native_scene_names = []

            for native_scene in native_scenes:
                native_scene_names.append(native_scene["name"])

            all_scenes, all_scene_names = await get_scenes_and_scene_names(self.hass) # All scenes, not just those in scenes.yaml
            areas, area_names = await get_areas_and_area_names(self.hass)
            booleans, boolean_names = await get_input_booleans_and_boolean_names(self.hass)

            # TODO: Filter the displayed scenes based on the area input, so it's easier to find
            # the correct scene
            options_flow_schema = vol.Schema(
                {
                    # vol.Required(
                    #     "scene_day",
                    #     default=list(self.scenes),
                    # ): config_validation.multi_select(scene_names),
                    vol.Optional(SCENE_NAME, default=self.config_entry.options.get(SCENE_NAME) or self.config_entry.data.get(SCENE_NAME)): str,
                    vol.Optional(
                        AREA_NAME,
                        default=self.config_entry.options.get(AREA_NAME) or self.config_entry.data.get(AREA_NAME)
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
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Required(
                        SCENE_DAWN_NAME,
                        default=self.config_entry.options.get(SCENE_DAWN_NAME)
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Required(
                        SCENE_DAY_RISING_NAME,
                        default=self.config_entry.options.get(SCENE_DAY_RISING_NAME)
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Required(
                        SCENE_DAY_SETTING_NAME,
                        default=self.config_entry.options.get(SCENE_DAY_SETTING_NAME)
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Required(
                        SCENE_DUSK_NAME,
                        default=self.config_entry.options.get(SCENE_DUSK_NAME)
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Required(
                        SCENE_NIGHT_SETTING_NAME,
                        default=self.config_entry.options.get(SCENE_NIGHT_SETTING_NAME)
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Optional(
                        NIGHTLIGHTS_BOOLEAN_NAME,
                        default=self.config_entry.options.get(NIGHTLIGHTS_BOOLEAN_NAME)
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=boolean_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Optional(
                        NIGHTLIGHTS_SCENE_NAME,
                        default=self.config_entry.options.get(NIGHTLIGHTS_SCENE_NAME)
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=all_scene_names,
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

            if user_input is None:
                return self.async_show_form(
                    step_id="init", data_schema=options_flow_schema
                )

            validated_input = await validate_input(self.hass, user_input, self.config_entry)
        except CannotReadScenesFile:
            errors["base"] = "cant_read_scenes_file"
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception("Unexpected exception")
            errors["base"] = "unknown"
        else:
            return self.async_create_entry(title=validated_input["device_name"], data=validated_input)

        # (If we haven't returned already)
        # Show the form again, just with the errors
        return self.async_show_form(
            step_id="init", data_schema=options_flow_schema, errors=errors
        )


async def get_input_booleans_and_boolean_names(hass) -> list:
    input_booleans = hass.states.async_all("input_boolean")

    input_boolean_names = []
    for input_boolean in input_booleans:
        input_boolean_names.append(input_boolean.name)

    return [input_booleans, input_boolean_names]

async def get_scenes_and_scene_names(hass) -> list:
    scenes = hass.states.async_all("scene")
    scenes_as_dicts = []

    scene_names = []
    for scene in scenes:
        scene_as_dict = scene.as_dict()
        scene_names.append(scene_as_dict["attributes"]["friendly_name"])
        scenes_as_dicts.append(scene_as_dict)

    return [scenes_as_dicts, scene_names]


async def get_areas_and_area_names(hass: HomeAssistant) -> list:
    area_registry_instance = area_registry.async_get(hass)
    areas = area_registry_instance.async_list_areas()

    # Areas are originally odicts, so we'll convert them to a list, which is what we expect to get
    areas_as_list = []

    area_names = []
    for area in areas:
        area_names.append(area.name)
        areas_as_list.append(area)

    return [areas_as_list, area_names]

async def get_native_scenes() -> list:
    """Returns scenes from scenes.yaml. Only Home Assistant native scenes are stored here. Ie. not Hue scenes"""
    # TODO: There must be a better way to get the scene's light configuration than
    # reading and parsing the yaml file manually, like we are doing now.

    # Something like:
    # scenes = self.hass.states.async_entity_ids("scene")

    # Get the first scene
    # scene = self.hass.states.get(scenes[0])

    # Get that scene's first light's rgb_color (not it's current state, but the
    # one defined in the scene)
    # scene.attributes["entity_id"][0]["rgb_color"])

    try:
        scenes_locations = ["./config/", "./"]
        verified_scenes_location = None

        for scenes_location in scenes_locations:
            if not os.path.exists(scenes_location):
                continue

            location_content = os.listdir(scenes_location)

            if "scenes.yaml" in location_content:
                # _LOGGER.info("scenes.yaml was found in %s", scenes_location)
                verified_scenes_location = scenes_location
                break

        if not verified_scenes_location:
            raise CannotFindScenesFile()

        with open(verified_scenes_location + "scenes.yaml", "r") as file: # Open file in "r" (read mode)
            data = file.read()

            scenes = yaml.load(data, Loader=yaml.loader.SafeLoader)

    except CannotFindScenesFile:
        _LOGGER.warning("Cannot find the scenes.yaml file. We assume that the user has no scenes.")
        scenes = []

    except Exception as exception:
        pwd = os.getcwd()
        _LOGGER.warn("Couldn't find the scenes.yaml file in: %s, which has the following content:", pwd)

        location_content = os.listdir()
        _LOGGER.warn(location_content)
        raise CannotReadScenesFile() from exception

    return scenes