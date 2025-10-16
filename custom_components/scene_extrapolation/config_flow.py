"""Config flow for Scene Extrapolation integration."""

from __future__ import annotations
from datetime import datetime, timedelta

import asyncio
import logging
import os
from typing import Any
import uuid

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
    CONF_UNIQUE_ID,
)

from .const import (
    DOMAIN,
    SCENE_NAME,
    SCENE_NIGHT_RISING_NAME,
    SCENE_NIGHT_RISING_ID,
    SCENE_DAWN_NAME,
    SCENE_DAWN_ID,
    SCENE_DAY_RISING_NAME,
    SCENE_DAY_RISING_ID,
    SCENE_DAY_SETTING_NAME,
    SCENE_DAY_SETTING_ID,
    SCENE_DUSK_NAME,
    SCENE_DUSK_ID,
    SCENE_DAWN_MINIMUM_TIME_OF_DAY,
    SCENE_NIGHT_SETTING_NAME,
    SCENE_NIGHT_SETTING_ID,
    AREA_NAME,
    NIGHTLIGHTS_BOOLEAN_NAME,
    NIGHTLIGHTS_BOOLEAN_ID,
    NIGHTLIGHTS_SCENE_NAME,
    NIGHTLIGHTS_SCENE_ID,
)

_LOGGER = logging.getLogger(__name__)


async def validate_combined_input(
    hass: HomeAssistant,
    basic_config: dict[str, Any],
    scenes_config: dict[str, Any],
    config_entry: config_entries.ConfigEntry = None,
) -> dict[str, Any]:
    """Validate and combine basic config and scenes config for both flows."""
    # Combine the inputs
    combined_input = {**basic_config, **scenes_config}

    # Extract basic info
    scene_name = combined_input.get(SCENE_NAME, "Extrapolation Scene")
    # Note: area information is not stored in the integration data, but on thescene entity
    # It's only used during initial setup to assign area to the scene entity

    data_to_store = {
        SCENE_NAME: scene_name,
    }

    # Handle scene configurations
    scene_name_to_id_mapping = {
        SCENE_NIGHT_RISING_NAME: SCENE_NIGHT_RISING_ID,
        SCENE_DAWN_NAME: SCENE_DAWN_ID,
        SCENE_DAY_RISING_NAME: SCENE_DAY_RISING_ID,
        SCENE_DAY_SETTING_NAME: SCENE_DAY_SETTING_ID,
        SCENE_DUSK_NAME: SCENE_DUSK_ID,
        SCENE_NIGHT_SETTING_NAME: SCENE_NIGHT_SETTING_ID,
        NIGHTLIGHTS_SCENE_NAME: NIGHTLIGHTS_SCENE_ID,
    }

    for scene_name_key, scene_id_key in scene_name_to_id_mapping.items():
        if scene_name_key in combined_input:
            data_to_store[scene_id_key] = combined_input[scene_name_key]

    # Handle boolean configuration
    if NIGHTLIGHTS_BOOLEAN_NAME in combined_input:
        boolean_name = combined_input[NIGHTLIGHTS_BOOLEAN_NAME]
        if boolean_name:
            boolean_id = get_boolean_id_by_name(hass, boolean_name)
            data_to_store[NIGHTLIGHTS_BOOLEAN_ID] = boolean_id

    # Handle time configuration
    if SCENE_DAWN_MINIMUM_TIME_OF_DAY in combined_input:
        time_str = combined_input[SCENE_DAWN_MINIMUM_TIME_OF_DAY]
        if time_str:
            time_parts = time_str.split(":")
            seconds = (
                int(time_parts[0]) * 3600 + int(time_parts[1]) * 60 + int(time_parts[2])
            )
            data_to_store[SCENE_DAWN_MINIMUM_TIME_OF_DAY] = seconds

    return data_to_store


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Scene Extrapolation."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step - basic configuration."""
        config_flow_schema = await create_basic_config_schema(self.hass)

        if user_input is None:
            return self.async_show_form(
                step_id="user",
                data_schema=config_flow_schema,
            )

        # Store the basic configuration and move to scene configuration
        self.basic_config = user_input
        return await self.async_step_scenes()

    async def async_step_scenes(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the scene configuration step."""
        errors = {}
        try:
            # Get the area ID to filter scenes by area
            area_id = None
            if hasattr(self, "basic_config") and AREA_NAME in self.basic_config:
                # The area selector returns the area ID directly, not the name
                area_id = self.basic_config[AREA_NAME]

            # Create scenes configuration schema
            scenes_flow_schema = await create_scenes_config_schema(self.hass, area_id)

            if user_input is None:
                return self.async_show_form(
                    step_id="scenes",
                    data_schema=scenes_flow_schema,
                )

            # Validate and combine basic config with scene config
            validated_input = await validate_combined_input(
                self.hass, self.basic_config, user_input
            )

            # Append a unique ID for this scene before saving the data
            validated_input[CONF_UNIQUE_ID] = str(uuid.uuid4())

            # Store area_id temporarily for setting on the scene entity after creation
            area_id = None
            if AREA_NAME in self.basic_config:
                # The area selector returns the area ID directly
                area_id = self.basic_config[AREA_NAME]

            # Create the config entry
            result = self.async_create_entry(
                title=validated_input[SCENE_NAME], data=validated_input
            )

            # Set area_id on the scene entity after it's created
            if area_id:
                # Schedule setting the area_id on the scene entity
                self.hass.async_create_task(
                    self._async_set_scene_area_id(
                        validated_input[CONF_UNIQUE_ID], area_id
                    )
                )

            return result

        except CannotReadScenesFile:
            errors["base"] = "cant_read_scenes_file"
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception("Unexpected exception")
            errors["base"] = "unknown"

        # Show the form again, just with the errors
        return self.async_show_form(
            step_id="scenes", data_schema=scenes_flow_schema, errors=errors
        )

    async def _async_set_scene_area_id(self, unique_id: str, area_id: str):
        """Set the area_id on the scene entity after it's created."""
        # Wait for the scene entity to be created
        await asyncio.sleep(1)

        # Find the scene entity by unique_id
        entity_reg = entity_registry.async_get(self.hass)
        for entity_id, entity_entry in entity_reg.entities.items():
            if entity_entry.unique_id == unique_id and entity_entry.domain == "scene":
                # Set the area_id on the scene entity
                entity_reg.async_update_entity(entity_id, area_id=area_id)
                _LOGGER.debug("Set area_id %s on scene entity %s", area_id, entity_id)
                break

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


class WrongObjectType(HomeAssistantError):
    """Error to indicate that the variable holding the scenes is of the wrong type."""


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
        """Handle the initial step - skip basic configuration and go directly to scenes."""
        # Skip basic configuration and go directly to scenes configuration
        return await self.async_step_scenes()

    async def async_step_scenes(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the scene configuration step."""
        errors = {}
        try:
            # Get area_id from the scene entity created by this integration
            area_id = None
            entity_reg = entity_registry.async_get(self.hass)

            # Find the scene entity created by this integration using the unique_id
            unique_id = self.config_entry.data.get(CONF_UNIQUE_ID)
            if unique_id:
                for entity_id, entity_entry in entity_reg.entities.items():
                    if (
                        entity_entry.unique_id == unique_id
                        and entity_entry.domain == "scene"
                        and entity_entry.config_entry_id == self.config_entry.entry_id
                    ):
                        area_id = entity_entry.area_id
                        break

            # Get current values from config entry for pre-population
            # Check both data and options fields since initial config stores in data
            current_values = {
                SCENE_NIGHT_RISING_ID: (
                    self.config_entry.options.get(SCENE_NIGHT_RISING_ID)
                    or self.config_entry.data.get(SCENE_NIGHT_RISING_ID)
                ),
                SCENE_DAWN_ID: (
                    self.config_entry.options.get(SCENE_DAWN_ID)
                    or self.config_entry.data.get(SCENE_DAWN_ID)
                ),
                SCENE_DAY_RISING_ID: (
                    self.config_entry.options.get(SCENE_DAY_RISING_ID)
                    or self.config_entry.data.get(SCENE_DAY_RISING_ID)
                ),
                SCENE_DAY_SETTING_ID: (
                    self.config_entry.options.get(SCENE_DAY_SETTING_ID)
                    or self.config_entry.data.get(SCENE_DAY_SETTING_ID)
                ),
                SCENE_DUSK_ID: (
                    self.config_entry.options.get(SCENE_DUSK_ID)
                    or self.config_entry.data.get(SCENE_DUSK_ID)
                ),
                SCENE_NIGHT_SETTING_ID: (
                    self.config_entry.options.get(SCENE_NIGHT_SETTING_ID)
                    or self.config_entry.data.get(SCENE_NIGHT_SETTING_ID)
                ),
                NIGHTLIGHTS_BOOLEAN_ID: (
                    self.config_entry.options.get(NIGHTLIGHTS_BOOLEAN_ID)
                    or self.config_entry.data.get(NIGHTLIGHTS_BOOLEAN_ID)
                ),
                NIGHTLIGHTS_SCENE_ID: (
                    self.config_entry.options.get(NIGHTLIGHTS_SCENE_ID)
                    or self.config_entry.data.get(NIGHTLIGHTS_SCENE_ID)
                ),
            }

            # Create scenes configuration schema with current values
            scenes_flow_schema = await create_scenes_config_schema(
                self.hass, area_id, current_values
            )

            if user_input is None:
                return self.async_show_form(
                    step_id="scenes",
                    data_schema=scenes_flow_schema,
                )

            # For options flow, create basic config from existing config entry data
            # Note: area information is not stored in integration data
            basic_config = {
                SCENE_NAME: self.config_entry.data.get(
                    SCENE_NAME, "Extrapolation Scene"
                ),
            }

            # Validate and combine basic config with scene config
            validated_input = await validate_combined_input(
                self.hass, basic_config, user_input, self.config_entry
            )

            return self.async_create_entry(
                title=validated_input[SCENE_NAME], data=validated_input
            )

        except CannotReadScenesFile:
            errors["base"] = "cant_read_scenes_file"
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception("Unexpected exception")
            errors["base"] = "unknown"

        # Show the form again, just with the errors
        return self.async_show_form(
            step_id="scenes", data_schema=scenes_flow_schema, errors=errors
        )


async def create_basic_config_schema(
    hass, current_scene_name=None, current_area_name=None
):
    """Create the basic configuration schema for both config and options flows."""
    return vol.Schema(
        {
            vol.Optional(
                "scene_name", default=current_scene_name or "Extrapolation Scene"
            ): str,
            vol.Optional(
                AREA_NAME,
                default=current_area_name,
            ): selector.AreaSelector(
                selector.AreaSelectorConfig(
                    multiple=False,
                ),
            ),
        }
    )


async def create_scenes_config_schema(hass, area_id, current_values=None):
    """Create the scenes configuration schema for both config and options flows."""
    booleans, boolean_names = await get_input_booleans_and_boolean_names(hass)

    # Get native Home Assistant scene entities for the area if area is configured
    scene_entity_ids = None
    if area_id:
        entity_reg = entity_registry.async_get(hass)
        scene_entity_ids = [
            entity.entity_id
            for entity in entity_registry.async_entries_for_area(entity_reg, area_id)
            if entity.domain == "scene" and entity.platform == "homeassistant"
        ]

    # Helper function to create scene selector with area filtering
    def create_scene_selector():
        config = {
            "domain": "scene",
            "multiple": False,
        }
        if scene_entity_ids:
            config["include_entities"] = scene_entity_ids
        else:
            # If no area filtering, still filter for native Home Assistant scenes only
            entity_reg = entity_registry.async_get(hass)
            native_scene_entities = [
                entity.entity_id
                for entity in entity_reg.entities.values()
                if entity.domain == "scene" and entity.platform == "homeassistant"
            ]
            if native_scene_entities:
                config["include_entities"] = native_scene_entities
        return selector.EntitySelector(selector.EntitySelectorConfig(**config))

    # Use current values if provided (for options flow), otherwise use defaults
    defaults = current_values or {}

    return vol.Schema(
        {
            vol.Required(
                SCENE_NIGHT_RISING_NAME,
                default=defaults.get(SCENE_NIGHT_RISING_ID),
            ): create_scene_selector(),
            vol.Required(
                SCENE_DAWN_NAME,
                default=defaults.get(SCENE_DAWN_ID),
            ): create_scene_selector(),
            vol.Required(
                SCENE_DAY_RISING_NAME,
                default=defaults.get(SCENE_DAY_RISING_ID),
            ): create_scene_selector(),
            vol.Required(
                SCENE_DAY_SETTING_NAME,
                default=defaults.get(SCENE_DAY_SETTING_ID),
            ): create_scene_selector(),
            vol.Required(
                SCENE_DUSK_NAME,
                default=defaults.get(SCENE_DUSK_ID),
            ): create_scene_selector(),
            vol.Optional(
                SCENE_DAWN_MINIMUM_TIME_OF_DAY, default="22:00:00"
            ): selector.TimeSelector(selector.TimeSelectorConfig()),
            vol.Required(
                SCENE_NIGHT_SETTING_NAME,
                default=defaults.get(SCENE_NIGHT_SETTING_ID),
            ): create_scene_selector(),
            vol.Optional(
                NIGHTLIGHTS_BOOLEAN_NAME,
                default=get_input_boolean_name_by_id(
                    hass,
                    defaults.get(NIGHTLIGHTS_BOOLEAN_ID),
                ),
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=boolean_names,
                    multiple=False,
                    mode=selector.SelectSelectorMode.DROPDOWN,
                ),
            ),
            vol.Optional(
                NIGHTLIGHTS_SCENE_NAME,
                default=defaults.get(NIGHTLIGHTS_SCENE_ID),
            ): create_scene_selector(),
        }
    )


async def get_input_booleans_and_boolean_names(hass) -> list:
    input_booleans = hass.states.async_all("input_boolean")

    input_boolean_names = []
    for input_boolean in input_booleans:
        input_boolean_names.append(input_boolean.name)

    return [input_booleans, input_boolean_names]


def get_input_boolean_by_id(hass, id):
    """Finds the input_boolean matching the supplied id"""
    input_booleans = hass.states.async_all("input_boolean")

    try:
        input_boolean = next(
            filter(
                lambda input_boolean: input_boolean.as_dict()["entity_id"] == id,
                input_booleans,
            )
        )
    except StopIteration:
        return None

    # Convert the matching input_boolean to a dict
    input_boolean = input_boolean.as_dict()

    return input_boolean


def get_input_boolean_name_by_id(hass, id):
    """Supply a input_boolean ID to get its name"""
    input_boolean = get_input_boolean_by_id(hass, id)
    return input_boolean["attributes"]["friendly_name"] if input_boolean else None


def get_boolean_id_by_name(hass, name):
    """Supply a boolean name to get its ID"""
    input_booleans = hass.states.async_all("input_boolean")
    for input_boolean in input_booleans:
        if input_boolean.name == name:
            return input_boolean.entity_id
    return None


async def get_scenes_and_scene_names(hass) -> list:
    """Get a list of all the scene objects and another list with just the scene names"""
    scenes = hass.states.async_all("scene")
    scenes_as_dicts = []

    scene_names = []
    for scene in scenes:
        scene_as_dict = scene.as_dict()
        scene_names.append(scene_as_dict["attributes"]["friendly_name"])
        scenes_as_dicts.append(scene_as_dict)

    return [scenes_as_dicts, scene_names]


def get_scene_by_name(hass, name) -> dict:
    """Finds the scene matching the supplied name"""
    scenes = hass.states.async_all("scene")

    try:
        scene = next(
            filter(
                lambda scene: scene.as_dict()["attributes"]["friendly_name"] == name,
                scenes,
            )
        )
    except StopIteration:
        return None

    # Convert the matching scene to a dict
    scene = scene.as_dict()

    return scene


def get_scene_by_entity_id(hass, entity_id) -> dict:
    """Finds the scene matching the supplied entity_id"""
    # TODO: Is there a better, more direct way to get a scene by ID? Here we fetch all scenes and then filter out one...
    # I tried the following, which seemed simple, but couldn't find a good way to get it's friendly name.
    #    entity_registry_instance = entity_registry.async_get(hass)
    #    scene = entity_registry_instance.async_get(id)
    # It returns a RegistryEntry, which does have a .to_partial_dict, but that partial version doesn't
    # include `attributes`, where "friendly_name" resides...

    scenes = hass.states.async_all("scene")

    try:
        scene = next(
            filter(lambda scene: scene.as_dict()["entity_id"] == entity_id, scenes)
        )
    except StopIteration:
        return None

    # Convert the matching scene to a dict
    scene = scene.as_dict()

    return scene


def get_scene_name_by_entity_id(hass, entity_id) -> str:
    """Supply a scene ID to get its name"""
    scene = get_scene_by_entity_id(hass, entity_id)

    return scene["attributes"]["friendly_name"] if scene else None


def get_area_id_by_name(hass, name) -> dict:
    """Finds the area matching the supplied id"""
    area_registry_instance = area_registry.async_get(hass)
    area = area_registry_instance.async_get_area_by_name(name)

    return area.id


def get_area_name_by_id(hass, area_id):
    """Supply an area ID to get its name"""
    area_registry_instance = area_registry.async_get(hass)
    area = area_registry_instance.async_get_area(area_id)
    return area.name if area else None


async def get_native_scenes(hass=None) -> list:
    """Returns scenes from scenes.yaml. Only Home Assistant native scenes are stored here. Ie. not Hue scenes.
    Alternately supply a hass object to return the scenes with their entity_ids attached.
    """
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

        with open(
            verified_scenes_location + "scenes.yaml", "r"
        ) as file:  # Open file in "r" (read mode)
            data = file.read()

            scenes = yaml.load(data, Loader=yaml.loader.SafeLoader)

        if type(scenes) is not list:
            raise WrongObjectType()

    except WrongObjectType:
        _LOGGER.warning(
            "The scenes object is of the wrong type. This is normal if the user hasn't defined any scenes yet. Proceeding with an empty scenes list."
        )
        scenes = []

    except CannotFindScenesFile:
        _LOGGER.warning(
            "Cannot find the scenes.yaml file. We assume that the user has no scenes."
        )
        scenes = []

    except Exception as exception:
        pwd = os.getcwd()
        _LOGGER.warn(
            "Couldn't find the scenes.yaml file in: %s, which has the following content:",
            pwd,
        )

        location_content = os.listdir()
        _LOGGER.warn(location_content)
        raise CannotReadScenesFile() from exception

    # If we get the hass object supplied, we are also able to search for entity_ids and saturate the scenes with them.
    if hass:
        scenes = saturate_data(scenes, hass)

    return scenes


def sort_by_area_id(entities, area_id):
    sorted_entities = []

    for entity in entities:
        if entity["area_id"] == area_id:
            sorted_entities.insert(0, entity)
        else:
            sorted_entities.append(entity)

    return sorted_entities


def saturate_data(scenes, hass: HomeAssistant):
    """Let's do stupid since Home Assistant is stupid... Meaning, we'll go get the scenes.yaml's scene's entity_ids manually, since they're not there for some reason. Only scene.id resides in scenes.yaml."""
    saturated_scenes = []
    ha_scenes = hass.states.async_all("scene")
    entity_registry_instance = entity_registry.async_get(hass)

    for scene in scenes:
        # Loop through ha_scenes and match the ID in order to find the corresponding scene from the registry (which contains the entity_id we want)
        ha_scene = next(
            filter(lambda ha_scene: ha_scene.attributes["id"] == scene["id"], ha_scenes)
        )

        # Let's do even more stupid and get the entity for the THIRD time (!) in order to saturate the data with the area ID, which isn't available in neither the scenes.yaml file OR in states
        ha_entity = entity_registry_instance.async_get(ha_scene.entity_id)
        scene["entity_id"] = ha_scene.entity_id
        scene["area_id"] = ha_entity.area_id
        saturated_scenes.append(scene)

    return saturated_scenes
