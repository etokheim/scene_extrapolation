"""Config flow for Scene Extrapolation integration."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_UNIQUE_ID
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar, entity_registry as er, selector

from .const import (
    DOMAIN,
    SCENE_NAME,
    SCENE_DAWN,
    SCENE_SUNRISE,
    SCENE_NOON,
    SCENE_SUNSET,
    SCENE_DUSK,
    SCENE_DUSK_MINIMUM_TIME_OF_DAY,
    AREA,
    NIGHTLIGHTS_BOOLEAN,
    NIGHTLIGHTS_SCENE,
    DISPLAY_SCENES_COMBINED,
)

_LOGGER = logging.getLogger(__name__)


def _infer_display_scenes_combined(config_entry: config_entries.ConfigEntry) -> bool:
    """Infer whether scenes should be displayed in combined mode based on stored scene IDs."""
    stored_dawn = config_entry.options.get(SCENE_DAWN) or config_entry.data.get(
        SCENE_DAWN
    )
    stored_dusk = config_entry.options.get(SCENE_DUSK) or config_entry.data.get(
        SCENE_DUSK
    )
    stored_sunrise = config_entry.options.get(SCENE_SUNRISE) or config_entry.data.get(
        SCENE_SUNRISE
    )
    stored_sunset = config_entry.options.get(SCENE_SUNSET) or config_entry.data.get(
        SCENE_SUNSET
    )

    if stored_dawn and stored_dusk and stored_sunrise and stored_sunset:
        return stored_dawn == stored_dusk and stored_sunrise == stored_sunset
    else:
        # Fallback: keep separate layout for safety
        return False


async def validate_combined_input(
    hass: HomeAssistant,
    basic_config: dict[str, Any],
    scenes_config: dict[str, Any],
    nightlights_config: dict[str, Any],
    config_entry: config_entries.ConfigEntry = None,
    display_scenes_combined: bool = False,
) -> dict[str, Any]:
    """Validate and combine basic config and scenes config for both flows."""
    _LOGGER.info("=== VALIDATE_COMBINED_INPUT START ===")
    _LOGGER.info("Basic config received: %s", basic_config)
    _LOGGER.info("Scenes config received: %s", scenes_config)
    _LOGGER.info("Nightlights config received: %s", nightlights_config)
    _LOGGER.info("Config entry provided: %s", config_entry is not None)

    # Combine the inputs
    combined_input = {**basic_config, **scenes_config, **nightlights_config}
    _LOGGER.info("Combined input: %s", combined_input)

    # Extract basic info
    scene_name = combined_input.get(SCENE_NAME, "Automatic Lighting")
    # Note: area information is not stored in the integration data, but on thescene entity
    # It's only used during initial setup to assign area to the scene entity

    data_to_store = {
        SCENE_NAME: scene_name,
    }

    # Store area_id if provided
    if AREA in combined_input:
        data_to_store[AREA] = combined_input[AREA]

    # Use the passed display_scenes_combined parameter
    _LOGGER.info("Display scenes combined: %s", display_scenes_combined)

    if not display_scenes_combined:
        # Separate mode - handle each scene individually
        _LOGGER.info("Processing SEPARATE mode")
        scene_keys = [
            SCENE_DAWN,
            SCENE_SUNRISE,
            SCENE_NOON,
            SCENE_SUNSET,
            SCENE_DUSK,
        ]

        for scene_key in scene_keys:
            if scene_key in combined_input:
                data_to_store[scene_key] = combined_input[scene_key]
                _LOGGER.info(
                    "Stored %s: %s",
                    scene_key,
                    combined_input[scene_key],
                )
    else:
        # Combined mode - duplicate selections
        _LOGGER.info("Processing COMBINED mode")
        # Dawn and dusk scene (combined)
        dawn_and_dusk_scene = combined_input.get("scene_dawn_and_dusk")
        if dawn_and_dusk_scene:
            data_to_store[SCENE_DAWN] = dawn_and_dusk_scene
            data_to_store[SCENE_DUSK] = dawn_and_dusk_scene
            _LOGGER.info("Stored dawn/dusk scene: %s", dawn_and_dusk_scene)

        # Noon scene
        noon_scene = combined_input.get(SCENE_NOON)
        if noon_scene:
            data_to_store[SCENE_NOON] = noon_scene
            _LOGGER.info("Stored noon scene: %s", noon_scene)

        # Sunrise and sunset scene (combined)
        sunrise_and_sunset_scene = combined_input.get("scene_sunrise_and_sunset")
        if sunrise_and_sunset_scene:
            data_to_store[SCENE_SUNRISE] = sunrise_and_sunset_scene
            data_to_store[SCENE_SUNSET] = sunrise_and_sunset_scene
            _LOGGER.info("Stored sunrise/sunset scene: %s", sunrise_and_sunset_scene)

    # Handle nightlights configuration
    nightlights_boolean = combined_input.get(NIGHTLIGHTS_BOOLEAN)
    nightlights_scene = combined_input.get(NIGHTLIGHTS_SCENE)

    # Handle nightlights scene separately (only if boolean is provided)
    if nightlights_scene:
        data_to_store[NIGHTLIGHTS_SCENE] = nightlights_scene

    # Handle boolean configuration
    if nightlights_boolean:
        # The selector now returns the entity ID directly
        data_to_store[NIGHTLIGHTS_BOOLEAN] = nightlights_boolean

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

    _LOGGER.info("Final data to store: %s", data_to_store)
    _LOGGER.info("=== VALIDATE_COMBINED_INPUT END ===")
    return data_to_store


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Scene Extrapolation."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step - basic configuration."""
        # For new entries, always default to combined mode
        config_flow_schema = await create_basic_config_schema(
            self.hass, display_scenes_combined=True
        )

        if user_input is None:
            return self.async_show_form(
                step_id="user",
                data_schema=config_flow_schema,
            )

        _LOGGER.info("=== CONFIG FLOW USER STEP ===")
        _LOGGER.info("User input received: %s", user_input)

        # Store the basic configuration and move to scene configuration
        self.basic_config = user_input
        return await self.async_step_scenes()

    async def async_step_scenes(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> FlowResult:
        """Handle the scene configuration step."""
        errors = {}
        scenes_flow_schema = None
        try:
            # Get the combined mode setting from basic config

            # Store for use in subsequent steps
            self.area_id = self.basic_config.get(AREA) or None
            self.display_scenes_combined = self.basic_config[DISPLAY_SCENES_COMBINED]

            # Create scenes configuration schema
            scenes_flow_schema = await create_scenes_config_schema(
                self.hass,
                self.area_id,
                display_scenes_combined=self.display_scenes_combined,
            )

            if user_input is None:
                return self.async_show_form(
                    step_id="scenes",
                    data_schema=scenes_flow_schema,
                )

            _LOGGER.info("=== CONFIG FLOW SCENES STEP ===")
            _LOGGER.info("Scenes user input received: %s", user_input)
            _LOGGER.info("Basic config: %s", self.basic_config)
            _LOGGER.info(
                "Extra variables - area_id: %s, display_scenes_combined: %s",
                self.area_id,
                self.display_scenes_combined,
            )

            # Store the scenes configuration and move to nightlights configuration
            self.scenes_config = user_input
            return await self.async_step_nightlights(user_input=None)

        except HomeAssistantError as err:
            errors["base"] = str(err)
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception("Unexpected exception")
            errors["base"] = "unknown"

        # Show the form again, just with the errors
        # If scenes_flow_schema wasn't created due to an error, create a default one
        if scenes_flow_schema is None:
            scenes_flow_schema = await create_scenes_config_schema(
                self.hass,
                getattr(self, "area_id", None),
                None,
                display_scenes_combined=getattr(self, "display_scenes_combined", False),
            )
        return self.async_show_form(
            step_id="scenes", data_schema=scenes_flow_schema, errors=errors
        )

    async def async_step_nightlights(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> FlowResult:
        """Handle the nightlights configuration step."""
        errors = {}
        try:
            if user_input is None:
                _LOGGER.info("=== NIGHTLIGHTS STEP - SHOWING FORM ===")
                # Create nightlights configuration schema
                current_values = None
                if hasattr(self, "config_entry") and self.config_entry:
                    # Options flow - get current values from config entry
                    current_values = {
                        NIGHTLIGHTS_BOOLEAN: (
                            self.config_entry.options.get(NIGHTLIGHTS_BOOLEAN)
                            or self.config_entry.data.get(NIGHTLIGHTS_BOOLEAN)
                        ),
                        NIGHTLIGHTS_SCENE: (
                            self.config_entry.options.get(NIGHTLIGHTS_SCENE)
                            or self.config_entry.data.get(NIGHTLIGHTS_SCENE)
                        ),
                    }

                nightlights_flow_schema = await create_nightlights_config_schema(
                    self.hass, current_values, self.area_id
                )
                return self.async_show_form(
                    step_id="nightlights",
                    data_schema=nightlights_flow_schema,
                )

            _LOGGER.info("=== NIGHTLIGHTS STEP - PROCESSING INPUT ===")
            _LOGGER.info("Nightlights user input received: %s", user_input)
            _LOGGER.info(
                "Extra variables - area_id: %s, display_scenes_combined: %s",
                self.area_id,
                self.display_scenes_combined,
            )

            _LOGGER.info("Processing CONFIG flow")
            _LOGGER.info("Basic config: %s", self.basic_config)
            _LOGGER.info("Scenes config: %s", self.scenes_config)
            _LOGGER.info(
                "Extra variables - area_id: %s, display_scenes_combined: %s",
                self.area_id,
                self.display_scenes_combined,
            )
            # Config flow - create new entry

            validated_input = await validate_combined_input(
                self.hass,
                self.basic_config,
                self.scenes_config,
                user_input,
                config_entry=None,
                display_scenes_combined=self.display_scenes_combined,
            )

            # Append a unique ID for this scene before saving the data
            validated_input[CONF_UNIQUE_ID] = str(uuid.uuid4())
            _LOGGER.info("Final validated input for config flow: %s", validated_input)

            _LOGGER.info(
                "Creating config entry with title: %s", validated_input[SCENE_NAME]
            )
            _LOGGER.info("Data being passed to async_create_entry: %s", validated_input)
            result = self.async_create_entry(
                title=validated_input[SCENE_NAME], data=validated_input
            )
            _LOGGER.info("Config entry created. Result: %s", result)
            _LOGGER.info("Config entry data after creation: %s", result.get("data"))

            # Set area_id on the scene entity after creation
            if self.area_id:
                self.hass.async_create_task(
                    self._async_set_scene_area_id(
                        validated_input[CONF_UNIQUE_ID], self.area_id
                    )
                )

            return result

        except HomeAssistantError as err:
            errors["base"] = str(err)
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception("Unexpected exception")
            errors["base"] = "unknown"

        # Show the form again, just with the errors
        # Preserve current values if this is an options flow
        current_values = None
        if hasattr(self, "config_entry") and self.config_entry:
            current_values = {
                NIGHTLIGHTS_BOOLEAN: (
                    self.config_entry.options.get(NIGHTLIGHTS_BOOLEAN)
                    or self.config_entry.data.get(NIGHTLIGHTS_BOOLEAN)
                ),
                NIGHTLIGHTS_SCENE: (
                    self.config_entry.options.get(NIGHTLIGHTS_SCENE)
                    or self.config_entry.data.get(NIGHTLIGHTS_SCENE)
                ),
            }

        nightlights_flow_schema = await create_nightlights_config_schema(
            self.hass, current_values, self.area_id
        )
        return self.async_show_form(
            step_id="nightlights",
            data_schema=nightlights_flow_schema,
            errors=errors,
        )

    async def _async_set_scene_area_id(self, unique_id: str, area_id: str):
        """Set the area_id on the scene entity after it's created."""
        # Wait for the scene entity to be created
        await asyncio.sleep(1)

        # Find the scene entity by unique_id
        entity_reg = er.async_get(self.hass)
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


# TODO: We will probably also have to add an options update event listener
# which runs when the config is updated. This event handler should probably
# reload the components configuration...
class OptionsFlowHandler(config_entries.OptionsFlow):
    """Handle the options flow for Scene Extrapolation (configure button on integration card)."""

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

        # Convert to int to handle float values
        seconds = int(seconds)
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        secs = seconds % 60
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step - basic configuration for options flow."""
        _LOGGER.info("=== OPTIONS FLOW INIT START ===")
        _LOGGER.info("Config entry data: %s", self.config_entry.data)
        _LOGGER.info("Config entry options: %s", self.config_entry.options)

        # Get current values from config entry for pre-population
        current_scene_name = self.config_entry.data.get(
            SCENE_NAME, "Automatic Lighting"
        )
        # Get area_id from the scene entity created by this integration
        self.area_id = None
        entity_reg = er.async_get(self.hass)
        unique_id = self.config_entry.data.get(CONF_UNIQUE_ID)
        if unique_id:
            for entity_entry in entity_reg.entities.values():
                if (
                    entity_entry.unique_id == unique_id
                    and entity_entry.domain == "scene"
                    and entity_entry.config_entry_id == self.config_entry.entry_id
                ):
                    self.area_id = entity_entry.area_id
                    break

        _LOGGER.debug("area_id: %s", self.area_id)

        display_scenes_combined = _infer_display_scenes_combined(self.config_entry)
        _LOGGER.info("Inferred display_scenes_combined: %s", display_scenes_combined)

        # Create basic configuration schema with current values
        # Options flow: initialize from inference
        basic_flow_schema = await create_basic_config_schema(
            self.hass,
            current_scene_name=current_scene_name,
            current_area_id=self.area_id,
            display_scenes_combined=display_scenes_combined,
            is_options_flow=True,
        )

        if user_input is None:
            # Get area friendly name
            area_friendly_name = "Unassigned"
            if self.area_id:
                area_reg = ar.async_get(self.hass)
                if self.area_id in area_reg.areas:
                    area_friendly_name = (
                        area_reg.areas[self.area_id].name or self.area_id
                    )

            # Get scene friendly name
            scene_friendly_name = self.config_entry.data.get(
                SCENE_NAME, "Unknown Scene"
            )
            unique_id = self.config_entry.data.get(CONF_UNIQUE_ID)
            if unique_id:
                entity_reg = er.async_get(self.hass)
                for entity_id, entity_entry in entity_reg.entities.items():
                    if (
                        entity_entry.unique_id == unique_id
                        and entity_entry.domain == "scene"
                        and entity_entry.config_entry_id == self.config_entry.entry_id
                    ):
                        _LOGGER.debug("entity_entry: %s", entity_entry)
                        scene_friendly_name = (
                            entity_entry.name or entity_entry.original_name or entity_id
                        )
                        break

            return self.async_show_form(
                step_id="init",
                data_schema=basic_flow_schema,
                description_placeholders={
                    "scene_name": scene_friendly_name,
                    "area_name": area_friendly_name,
                },
            )

        # Store the basic configuration and move to scene configuration
        self.basic_config = user_input
        return await self.async_step_scenes()

    async def async_step_scenes(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> FlowResult:
        """Handle the scene configuration step."""
        errors = {}
        scenes_flow_schema = None
        try:
            # Get area_id from the scene entity created by this integration
            entity_reg = er.async_get(self.hass)

            # Find the scene entity created by this integration using the unique_id
            unique_id = self.config_entry.data.get(CONF_UNIQUE_ID)
            if unique_id:
                for entity_entry in entity_reg.entities.values():
                    if (
                        entity_entry.unique_id == unique_id
                        and entity_entry.domain == "scene"
                        and entity_entry.config_entry_id == self.config_entry.entry_id
                    ):
                        self.area_id = entity_entry.area_id
                        break

            self.display_scenes_combined = self.basic_config[
                DISPLAY_SCENES_COMBINED
            ]  # Update as it can have been changed by the user in the basic configuration step

            # Get current values from config entry for pre-population
            # Check both data and options fields since initial config stores in data
            current_values = {
                SCENE_DAWN: (
                    self.config_entry.options.get(SCENE_DAWN)
                    or self.config_entry.data.get(SCENE_DAWN)
                ),
                SCENE_SUNRISE: (
                    self.config_entry.options.get(SCENE_SUNRISE)
                    or self.config_entry.data.get(SCENE_SUNRISE)
                ),
                SCENE_NOON: (
                    self.config_entry.options.get(SCENE_NOON)
                    or self.config_entry.data.get(SCENE_NOON)
                ),
                SCENE_SUNSET: (
                    self.config_entry.options.get(SCENE_SUNSET)
                    or self.config_entry.data.get(SCENE_SUNSET)
                ),
                SCENE_DUSK: (
                    self.config_entry.options.get(SCENE_DUSK)
                    or self.config_entry.data.get(SCENE_DUSK)
                ),
                SCENE_DUSK_MINIMUM_TIME_OF_DAY: self._convert_seconds_to_time_string(
                    self.config_entry.options.get(SCENE_DUSK_MINIMUM_TIME_OF_DAY)
                    or self.config_entry.data.get(SCENE_DUSK_MINIMUM_TIME_OF_DAY)
                ),
                NIGHTLIGHTS_BOOLEAN: (
                    self.config_entry.options.get(NIGHTLIGHTS_BOOLEAN)
                    or self.config_entry.data.get(NIGHTLIGHTS_BOOLEAN)
                ),
                NIGHTLIGHTS_SCENE: (
                    self.config_entry.options.get(NIGHTLIGHTS_SCENE)
                    or self.config_entry.data.get(NIGHTLIGHTS_SCENE)
                ),
            }

            # Create scenes configuration schema with current values
            scenes_flow_schema = await create_scenes_config_schema(
                self.hass,
                self.area_id,
                current_values,
                display_scenes_combined=self.display_scenes_combined,
            )

            if user_input is None:
                return self.async_show_form(
                    step_id="scenes",
                    data_schema=scenes_flow_schema,
                )

            _LOGGER.info("=== OPTIONS FLOW SCENES STEP ===")
            _LOGGER.info("Scenes user input received: %s", user_input)
            _LOGGER.info("Basic config: %s", self.basic_config)
            _LOGGER.info(
                "Extra variables - area_id: %s, display_scenes_combined: %s",
                self.area_id,
                self.display_scenes_combined,
            )

            # Store the scenes configuration and move to nightlights configuration
            self.scenes_config = user_input
            return await self.async_step_nightlights(user_input=None)

        except HomeAssistantError as err:
            errors["base"] = str(err)
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception("Unexpected exception")
            errors["base"] = "unknown"

        # Show the form again, just with the errors
        # If scenes_flow_schema wasn't created due to an error, create a default one
        if scenes_flow_schema is None:
            scenes_flow_schema = await create_scenes_config_schema(
                self.hass,
                getattr(self, "area_id", None),
                None,
                display_scenes_combined=getattr(self, "display_scenes_combined", False),
            )
        return self.async_show_form(
            step_id="scenes", data_schema=scenes_flow_schema, errors=errors
        )

    async def async_step_nightlights(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> FlowResult:
        """Handle the nightlights configuration step."""
        errors = {}
        try:
            if user_input is None:
                _LOGGER.info("=== OPTIONS FLOW NIGHTLIGHTS STEP - SHOWING FORM ===")
                # Create nightlights configuration schema with current values for options flow
                current_values = {
                    NIGHTLIGHTS_BOOLEAN: (
                        self.config_entry.options.get(NIGHTLIGHTS_BOOLEAN)
                        or self.config_entry.data.get(NIGHTLIGHTS_BOOLEAN)
                    ),
                    NIGHTLIGHTS_SCENE: (
                        self.config_entry.options.get(NIGHTLIGHTS_SCENE)
                        or self.config_entry.data.get(NIGHTLIGHTS_SCENE)
                    ),
                }
                _LOGGER.info("Current nightlights values: %s", current_values)

                nightlights_flow_schema = await create_nightlights_config_schema(
                    self.hass, current_values, self.area_id
                )
                return self.async_show_form(
                    step_id="nightlights",
                    data_schema=nightlights_flow_schema,
                )

            _LOGGER.info("=== OPTIONS FLOW NIGHTLIGHTS STEP - PROCESSING INPUT ===")
            _LOGGER.info("Nightlights user input received: %s", user_input)
            _LOGGER.info("Scenes config: %s", self.scenes_config)
            _LOGGER.info(
                "Extra variables - area_id: %s, display_scenes_combined: %s",
                self.area_id,
                self.display_scenes_combined,
            )

            validated_input = await validate_combined_input(
                self.hass,
                self.basic_config,
                self.scenes_config,
                user_input,
                config_entry=self.config_entry,
                display_scenes_combined=self.display_scenes_combined,
            )
            return self.async_create_entry(data=validated_input)

        except HomeAssistantError as err:
            errors["base"] = str(err)
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception("Unexpected exception")
            errors["base"] = "unknown"

        nightlights_flow_schema = await create_nightlights_config_schema(
            self.hass, area_id=self.area_id
        )
        return self.async_show_form(
            step_id="nightlights",
            data_schema=nightlights_flow_schema,
            errors=errors,
        )


async def create_basic_config_schema(
    hass: HomeAssistant,
    display_scenes_combined,
    current_scene_name=None,
    current_area_id=None,
    is_options_flow=False,
):
    """Create the basic configuration schema for both config and options flows."""
    if is_options_flow:
        # For options flow, hide scene name and area ID
        return vol.Schema(
            {
                vol.Optional(
                    DISPLAY_SCENES_COMBINED,
                    default=(
                        display_scenes_combined
                        if display_scenes_combined is not None
                        else True  # Default to True (combined) if not explicitly set
                    ),
                ): bool,
            }
        )
    else:  # noqa: RET505
        # For config flow, show all fields
        return vol.Schema(
            {
                vol.Optional(
                    "scene_name", default=current_scene_name or "Automatic Lighting"
                ): str,
                vol.Optional(
                    AREA,
                    default=current_area_id,
                ): vol.Maybe(
                    selector.AreaSelector(
                        selector.AreaSelectorConfig(
                            multiple=False,
                        ),
                    )
                ),
                vol.Optional(
                    DISPLAY_SCENES_COMBINED,
                    default=(
                        display_scenes_combined
                        if display_scenes_combined is not None
                        else True  # Default to True (combined) if not explicitly set
                    ),
                ): bool,
            }
        )


def create_nightlights_scene_selector(hass: HomeAssistant, area_id=None):
    """Create a scene selector for nightlights configuration that excludes scenes from this integration."""
    config = {
        "domain": "scene",
        "multiple": False,
    }

    def is_native_non_extrapolation_scene(entity):
        # Only include scenes that are NOT from this integration
        return (
            entity.domain == "scene"
            and getattr(entity, "platform", None) != "scene_extrapolation"
        )

    entity_reg = er.async_get(hass)

    if area_id:
        # Filter scenes to the selected area, non-scene_extrapolation scenes
        scene_entity_ids = [
            entity.entity_id
            for entity in er.async_entries_for_area(entity_reg, area_id)
            if is_native_non_extrapolation_scene(entity)
        ]
        if scene_entity_ids:
            config["include_entities"] = scene_entity_ids
        else:
            # If area has no matching scenes, fall back to all matching scenes
            native_scene_entities = [
                entity.entity_id
                for entity in entity_reg.entities.values()
                if is_native_non_extrapolation_scene(entity)
            ]
            if native_scene_entities:
                config["include_entities"] = native_scene_entities
    else:
        # If no area filtering, non-scene_extrapolation scenes
        native_scene_entities = [
            entity.entity_id
            for entity in entity_reg.entities.values()
            if is_native_non_extrapolation_scene(entity)
        ]
        if native_scene_entities:
            config["include_entities"] = native_scene_entities

    return selector.EntitySelector(selector.EntitySelectorConfig(**config))


async def create_nightlights_config_schema(
    hass: HomeAssistant, current_values=None, area_id=None
):
    """Create the nightlights configuration schema."""
    # Use current values if provided (for options flow), otherwise use defaults
    defaults = current_values or {}

    return vol.Schema(
        {
            vol.Optional(
                NIGHTLIGHTS_BOOLEAN,
                default=defaults.get(NIGHTLIGHTS_BOOLEAN),
            ): vol.Maybe(
                selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        domain="input_boolean",
                        multiple=False,
                    ),
                ),
            ),
            vol.Optional(
                NIGHTLIGHTS_SCENE,
                default=defaults.get(NIGHTLIGHTS_SCENE),
            ): vol.Maybe(
                create_nightlights_scene_selector(hass, area_id),
            ),
        }
    )


async def create_scenes_config_schema(
    hass: HomeAssistant, area_id, current_values=None, display_scenes_combined=False
):
    """Create the scenes configuration schema for both config and options flows."""

    # Get native Home Assistant scene entities for the area if area is configured
    scene_entity_ids = None
    if area_id:
        entity_reg = er.async_get(hass)
        scene_entity_ids = [
            entity.entity_id
            for entity in er.async_entries_for_area(entity_reg, area_id)
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
            entity_reg = er.async_get(hass)
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

    if not display_scenes_combined:
        # Separate mode - 5 scene selectors
        return vol.Schema(
            {
                vol.Required(
                    SCENE_DAWN,
                    default=defaults.get(SCENE_DAWN),
                ): create_scene_selector(),
                vol.Required(
                    SCENE_SUNRISE,
                    default=defaults.get(SCENE_SUNRISE),
                ): create_scene_selector(),
                vol.Required(
                    SCENE_NOON,
                    default=defaults.get(SCENE_NOON),
                ): create_scene_selector(),
                vol.Required(
                    SCENE_SUNSET,
                    default=defaults.get(SCENE_SUNSET),
                ): create_scene_selector(),
                vol.Required(
                    SCENE_DUSK,
                    default=defaults.get(SCENE_DUSK),
                ): create_scene_selector(),
                vol.Optional(
                    SCENE_DUSK_MINIMUM_TIME_OF_DAY,
                    default=defaults.get(SCENE_DUSK_MINIMUM_TIME_OF_DAY, "22:00:00"),
                ): selector.TimeSelector(selector.TimeSelectorConfig()),
            }
        )
    else:  # noqa: RET505
        # Combined mode - 3 scene selectors
        return vol.Schema(
            {
                vol.Required(
                    "scene_dawn_and_dusk",  # Combined dawn/dusk scene
                    default=defaults.get(SCENE_DAWN),  # Use dawn as default
                ): create_scene_selector(),
                vol.Required(
                    "scene_sunrise_and_sunset",  # Combined sunrise/sunset scene
                    default=defaults.get(SCENE_SUNRISE),  # Use sunrise as default
                ): create_scene_selector(),
                vol.Required(
                    SCENE_NOON,
                    default=defaults.get(SCENE_NOON),
                ): create_scene_selector(),
                vol.Optional(
                    SCENE_DUSK_MINIMUM_TIME_OF_DAY,
                    default=defaults.get(SCENE_DUSK_MINIMUM_TIME_OF_DAY, "22:00:00"),
                ): selector.TimeSelector(selector.TimeSelectorConfig()),
            }
        )
