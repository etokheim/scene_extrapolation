"""Config flow for Scene Extrapolation integration."""
from __future__ import annotations

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
    CONF_UNIQUE_ID
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
    SCENE_NIGHT_SETTING_NAME,
    SCENE_NIGHT_SETTING_ID,
    AREA_NAME,
    NIGHTLIGHTS_BOOLEAN_NAME,
    NIGHTLIGHTS_BOOLEAN_ID,
    NIGHTLIGHTS_SCENE_NAME,
    NIGHTLIGHTS_SCENE_ID
)

_LOGGER = logging.getLogger(__name__)

async def validate_input(hass: HomeAssistant, user_input: dict[str, Any], config_entry: config_entries.ConfigEntry = None) -> dict[str, Any]:
    """Validate the user input.

    Note: We use the same function for both the config flow and the options flow

    Data has the keys from STEP_USER_DATA_SCHEMA with values provided by the user.
    """

    # _LOGGER.info("data: %s", config_entry.data)
    # _LOGGER.info("user_input: %s", user_input)
    data_to_store = {
        SCENE_NAME: user_input[SCENE_NAME] if SCENE_NAME in user_input else config_entry.data.get(SCENE_NAME),
        # Too tired to explain this mess now. It seems to work though, so let's just not touch it! 😅
        ATTR_AREA_ID:   get_area_id_by_name( hass, user_input[AREA_NAME] ) if AREA_NAME in user_input else
                        config_entry.data.get(ATTR_AREA_ID) if config_entry is not None else None
    }

    # If we are in the options flow (the integration has already been set up)
    options_flow = True if config_entry else False
    if options_flow:
        # Find the ID of each supplied scene and store that instead of the name. (This way users can change the scene names without breaking the configuration).
        user_supplied_scene_names = [SCENE_NIGHT_RISING_NAME, SCENE_DAWN_NAME, SCENE_DAY_RISING_NAME, SCENE_DAY_SETTING_NAME, SCENE_DUSK_NAME, SCENE_NIGHT_SETTING_NAME, NIGHTLIGHTS_SCENE_NAME]
        user_supplied_scene_id_keys = [SCENE_NIGHT_RISING_ID, SCENE_DAWN_ID, SCENE_DAY_RISING_ID, SCENE_DAY_SETTING_ID, SCENE_DUSK_ID, SCENE_NIGHT_SETTING_ID, NIGHTLIGHTS_SCENE_ID]

        for index, item in enumerate(user_supplied_scene_names):
            current_user_supplied_scene_name = user_supplied_scene_names[index]
            current_user_supplied_scene_id_key = user_supplied_scene_id_keys[index]

            scene_name = user_input[current_user_supplied_scene_name]
            data_to_store[current_user_supplied_scene_id_key] = get_scene_by_name(hass, scene_name)["entity_id"]

    if NIGHTLIGHTS_BOOLEAN_NAME in user_input:
        # TODO: Just use get_boolean_id_by_name?
        nightlights_boolean = user_input[NIGHTLIGHTS_BOOLEAN_NAME]

        boolean, boolean_names = await get_input_booleans_and_boolean_names(hass)
        boolean_name_index = boolean_names.index(nightlights_boolean)
        nightlights_boolean = boolean[boolean_name_index]
        data_to_store[NIGHTLIGHTS_BOOLEAN_ID] = nightlights_boolean.entity_id

    # Return info that you want to store in the config entry.
    _LOGGER.info("data_to_store: %s", data_to_store)
    return data_to_store


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
                vol.Optional("scene_name", default="Extrapolation Scene"): str,
                vol.Optional(
                    AREA_NAME,
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
            # Append a unique ID for this scene before saving the data
            validated_input[CONF_UNIQUE_ID] = str( uuid.uuid4() )

            return self.async_create_entry(title=validated_input[SCENE_NAME], data=validated_input)

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
        """Manage the options."""

        errors = {}

        try:
            native_scenes = await get_native_scenes()
            native_scene_names = []

            for native_scene in native_scenes:
                native_scene_names.append(native_scene["name"])

            all_scenes, all_scene_names = await get_scenes_and_scene_names(self.hass) # All scenes, not just those in scenes.yaml
            booleans, boolean_names = await get_input_booleans_and_boolean_names(self.hass)

            # TODO: Filter the displayed scenes based on the area input, so it's easier to find
            # the correct scene
            options_flow_schema = vol.Schema(
                {
                    # vol.Required(
                    #     "scene_day",
                    #     default=list(self.scenes),
                    # ): config_validation.multi_select(scene_names),
                    vol.Required(
                        SCENE_NIGHT_RISING_NAME,
                        default=get_scene_name_by_entity_id( self.hass, self.config_entry.options.get(SCENE_NIGHT_RISING_ID) )
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Required(
                        SCENE_DAWN_NAME,
                        default=get_scene_name_by_entity_id( self.hass, self.config_entry.options.get(SCENE_DAWN_ID) )
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Required(
                        SCENE_DAY_RISING_NAME,
                        default=get_scene_name_by_entity_id( self.hass, self.config_entry.options.get(SCENE_DAY_RISING_ID) )
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Required(
                        SCENE_DAY_SETTING_NAME,
                        default=get_scene_name_by_entity_id( self.hass, self.config_entry.options.get(SCENE_DAY_SETTING_ID) )
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Required(
                        SCENE_DUSK_NAME,
                        default=get_scene_name_by_entity_id( self.hass, self.config_entry.options.get(SCENE_DUSK_ID) )
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Required(
                        SCENE_NIGHT_SETTING_NAME,
                        default=get_scene_name_by_entity_id( self.hass, self.config_entry.options.get(SCENE_NIGHT_SETTING_ID) )
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=native_scene_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Optional(
                        NIGHTLIGHTS_BOOLEAN_NAME,
                        default=get_input_boolean_name_by_id( self.hass, self.config_entry.options.get(NIGHTLIGHTS_BOOLEAN_ID) )
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=boolean_names,
                            multiple=False,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        ),
                    ),
                    vol.Optional(
                        NIGHTLIGHTS_SCENE_NAME,
                        default=get_scene_name_by_entity_id( self.hass, self.config_entry.options.get(NIGHTLIGHTS_SCENE_ID) )
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
            return self.async_create_entry(title=validated_input[SCENE_NAME], data=validated_input)

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

def get_input_boolean_by_id(hass, id):
    """ Finds the input_boolean matching the supplied id """
    input_booleans = hass.states.async_all("input_boolean")

    try:
        input_boolean = next( filter(lambda input_boolean: input_boolean.as_dict()["entity_id"] == id, input_booleans) )
    except StopIteration:
        return None

    # Convert the matching input_boolean to a dict
    input_boolean = input_boolean.as_dict()

    return input_boolean

def get_input_boolean_name_by_id(hass, id):
    """ Supply a input_boolean ID to get its name """
    input_boolean = get_input_boolean_by_id(hass, id)
    return input_boolean["attributes"]["friendly_name"] if input_boolean else None

async def get_scenes_and_scene_names(hass) -> list:
    """ Get a list of all the scene objects and another list with just the scene names """
    scenes = hass.states.async_all("scene")
    scenes_as_dicts = []

    scene_names = []
    for scene in scenes:
        scene_as_dict = scene.as_dict()
        scene_names.append(scene_as_dict["attributes"]["friendly_name"])
        scenes_as_dicts.append(scene_as_dict)

    return [scenes_as_dicts, scene_names]

def get_scene_by_name(hass, name) -> dict:
    """ Finds the scene matching the supplied name """
    scenes = hass.states.async_all("scene")

    try:
        scene = next( filter(lambda scene: scene.as_dict()["attributes"]["friendly_name"] == name, scenes) )
    except StopIteration:
        return None

    # Convert the matching scene to a dict
    scene = scene.as_dict()

    return scene

def get_scene_by_entity_id(hass, entity_id) -> dict:
    """ Finds the scene matching the supplied entity_id """
    # TODO: Is there a better, more direct way to get a scene by ID? Here we fetch all scenes and then filter out one...
    # I tried the following, which seemed simple, but couldn't find a good way to get it's friendly name.
    #    entity_registry_instance = entity_registry.async_get(hass)
    #    scene = entity_registry_instance.async_get(id)
    # It returns a RegistryEntry, which does have a .to_partial_dict, but that partial version doesn't
    # include `attributes`, where "friendly_name" resides...

    scenes = hass.states.async_all("scene")

    try:
        scene = next( filter(lambda scene: scene.as_dict()["entity_id"] == entity_id, scenes) )
    except StopIteration:
        return None

    # Convert the matching scene to a dict
    scene = scene.as_dict()

    return scene

def get_scene_name_by_entity_id(hass, entity_id) -> str:
    """ Supply a scene ID to get its name """
    scene = get_scene_by_entity_id(hass, entity_id)

    return scene["attributes"]["friendly_name"] if scene else None


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

def get_area_id_by_name(hass, name) -> dict:
    """ Finds the area matching the supplied id """
    area_registry_instance = area_registry.async_get(hass)
    area = area_registry_instance.async_get_area_by_name(name)

    return area.id

async def get_native_scenes(hass = None) -> list:
    """Returns scenes from scenes.yaml. Only Home Assistant native scenes are stored here. Ie. not Hue scenes.
    Alternately supply a hass object to return the scenes with their entity_ids attached."""
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

        if type(scenes) is not list:
            raise WrongObjectType()

    except WrongObjectType:
        _LOGGER.warning("The scenes object is of the wrong type. This is normal if the user hasn't defined any scenes yet. Proceeding with an empty scenes list.")
        scenes = []

    except CannotFindScenesFile:
        _LOGGER.warning("Cannot find the scenes.yaml file. We assume that the user has no scenes.")
        scenes = []

    except Exception as exception:
        pwd = os.getcwd()
        _LOGGER.warn("Couldn't find the scenes.yaml file in: %s, which has the following content:", pwd)

        location_content = os.listdir()
        _LOGGER.warn(location_content)
        raise CannotReadScenesFile() from exception

    # If we get the hass object supplied, we are also able to search for entity_ids and saturate the scenes with them.
    if hass:
        scenes = saturate_with_entity_ids(scenes, hass)

    return scenes

def saturate_with_entity_ids(scenes, hass):
    """Let's do stupid since Home Assistant is stupid... Meaning, we'll go get the scenes.yaml's scene's entity_ids manually, since they're not there for some reason. Only scene.id resides in scenes.yaml."""
    saturated_scenes = []
    ha_scenes = hass.states.async_all("scene")

    for scene in scenes:
        # Loop through ha_scenes and match the ID in order to find the corresponding scene from the registry (which contains the entity_id we want)
        ha_scene = next( filter(lambda ha_scene: ha_scene.attributes["id"] == scene["id"], ha_scenes) )
        scene["entity_id"] = ha_scene.entity_id
        saturated_scenes.append(scene)

    return saturated_scenes