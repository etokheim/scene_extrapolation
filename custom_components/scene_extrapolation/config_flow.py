"""Config flow for Scene Extrapolation integration."""

from __future__ import annotations
from datetime import datetime, timedelta

import asyncio
import logging
from typing import Any
import uuid

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import selector
import homeassistant.helpers.entity_registry as entity_registry

from homeassistant.const import (
    CONF_UNIQUE_ID,
)

from .const import (
    DOMAIN,
    SCENE_NAME,
    SCENE_DAWN_NAME,
    SCENE_DAWN_ID,
    SCENE_SUNRISE_NAME,
    SCENE_SUNRISE_ID,
    SCENE_NOON_NAME,
    SCENE_NOON_ID,
    SCENE_SUNSET_NAME,
    SCENE_SUNSET_ID,
    SCENE_DUSK_NAME,
    SCENE_DUSK_ID,
    SCENE_DUSK_MINIMUM_TIME_OF_DAY,
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
    scene_name = combined_input.get(SCENE_NAME, "Automatic Lighting")
    # Note: area information is not stored in the integration data, but on thescene entity
    # It's only used during initial setup to assign area to the scene entity

    data_to_store = {
        SCENE_NAME: scene_name,
    }

    # Handle scene configurations
    scene_name_to_id_mapping = {
        SCENE_DAWN_NAME: SCENE_DAWN_ID,
        SCENE_SUNRISE_NAME: SCENE_SUNRISE_ID,
        SCENE_NOON_NAME: SCENE_NOON_ID,
        SCENE_SUNSET_NAME: SCENE_SUNSET_ID,
        SCENE_DUSK_NAME: SCENE_DUSK_ID,
    }

    for scene_name_key, scene_id_key in scene_name_to_id_mapping.items():
        if scene_name_key in combined_input:
            data_to_store[scene_id_key] = combined_input[scene_name_key]

    # Handle nightlights configuration
    nightlights_boolean = combined_input.get(NIGHTLIGHTS_BOOLEAN_NAME)
    nightlights_scene = combined_input.get(NIGHTLIGHTS_SCENE_NAME)

    # Handle nightlights scene separately (only if boolean is provided)
    if nightlights_scene:
        data_to_store[NIGHTLIGHTS_SCENE_ID] = nightlights_scene

    # Handle boolean configuration
    if nightlights_boolean:
        # The selector now returns the entity ID directly
        data_to_store[NIGHTLIGHTS_BOOLEAN_ID] = nightlights_boolean

        # If nightlights boolean is provided, nightlights scene is required
        if not nightlights_scene:
            raise HomeAssistantError(
                "Nightlights scene is required when a nightlights boolean is configured"
            )

    # Handle time configuration - always set a default value
    time_str = combined_input.get(SCENE_DUSK_MINIMUM_TIME_OF_DAY, "22:00:00")
    if time_str:
        # TimeSelector returns time in HH:MM:SS format
        time_parts = time_str.split(":")
        seconds = (
            int(time_parts[0]) * 3600 + int(time_parts[1]) * 60 + int(time_parts[2])
        )
        data_to_store[SCENE_DUSK_MINIMUM_TIME_OF_DAY] = seconds

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
        except HomeAssistantError as err:
            errors["base"] = str(err)
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

    def _convert_seconds_to_time_string(self, seconds):
        """Convert seconds since midnight to HH:MM:SS format."""
        if seconds is None:
            return "22:00:00"  # Default value

        if isinstance(seconds, str):
            # Already a time string, return as is
            return seconds

        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        secs = seconds % 60
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"

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
                SCENE_DAWN_ID: (
                    self.config_entry.options.get(SCENE_DAWN_ID)
                    or self.config_entry.data.get(SCENE_DAWN_ID)
                ),
                SCENE_SUNRISE_ID: (
                    self.config_entry.options.get(SCENE_SUNRISE_ID)
                    or self.config_entry.data.get(SCENE_SUNRISE_ID)
                ),
                SCENE_NOON_ID: (
                    self.config_entry.options.get(SCENE_NOON_ID)
                    or self.config_entry.data.get(SCENE_NOON_ID)
                ),
                SCENE_SUNSET_ID: (
                    self.config_entry.options.get(SCENE_SUNSET_ID)
                    or self.config_entry.data.get(SCENE_SUNSET_ID)
                ),
                SCENE_DUSK_ID: (
                    self.config_entry.options.get(SCENE_DUSK_ID)
                    or self.config_entry.data.get(SCENE_DUSK_ID)
                ),
                SCENE_DUSK_MINIMUM_TIME_OF_DAY: self._convert_seconds_to_time_string(
                    self.config_entry.options.get(SCENE_DUSK_MINIMUM_TIME_OF_DAY)
                    or self.config_entry.data.get(SCENE_DUSK_MINIMUM_TIME_OF_DAY)
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
                    SCENE_NAME, "Automatic Lighting"
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
        except HomeAssistantError as err:
            errors["base"] = str(err)
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
                "scene_name", default=current_scene_name or "Automatic Lighting"
            ): str,
            vol.Optional(
                AREA_NAME,
                default=current_area_name,
            ): vol.Maybe(
                selector.AreaSelector(
                    selector.AreaSelectorConfig(
                        multiple=False,
                    ),
                )
            ),
        }
    )


async def create_scenes_config_schema(hass, area_id, current_values=None):
    """Create the scenes configuration schema for both config and options flows."""

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
                SCENE_DAWN_NAME,
                default=defaults.get(SCENE_DAWN_ID),
            ): create_scene_selector(),
            vol.Required(
                SCENE_SUNRISE_NAME,
                default=defaults.get(SCENE_SUNRISE_ID),
            ): create_scene_selector(),
            vol.Required(
                SCENE_NOON_NAME,
                default=defaults.get(SCENE_NOON_ID),
            ): create_scene_selector(),
            vol.Required(
                SCENE_SUNSET_NAME,
                default=defaults.get(SCENE_SUNSET_ID),
            ): create_scene_selector(),
            vol.Required(
                SCENE_DUSK_NAME,
                default=defaults.get(SCENE_DUSK_ID),
            ): create_scene_selector(),
            vol.Optional(
                SCENE_DUSK_MINIMUM_TIME_OF_DAY,
                default=defaults.get(SCENE_DUSK_MINIMUM_TIME_OF_DAY, "22:00:00"),
            ): selector.TimeSelector(selector.TimeSelectorConfig()),
            vol.Optional(
                NIGHTLIGHTS_BOOLEAN_NAME,
                default=defaults.get(NIGHTLIGHTS_BOOLEAN_ID),
            ): vol.Maybe(
                selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        domain="input_boolean",
                        multiple=False,
                    ),
                ),
            ),
            vol.Optional(
                NIGHTLIGHTS_SCENE_NAME,
                default=defaults.get(NIGHTLIGHTS_SCENE_ID),
            ): vol.Maybe(
                create_scene_selector(),
            ),
        }
    )
