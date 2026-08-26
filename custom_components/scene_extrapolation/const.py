"""Constants for the Scene Extrapolation integration."""

DOMAIN = "scene_extrapolation"
AREA = "area"
SCENE_NAME = "scene_name"

SCENE_DAWN = "scene_dawn"
SCENE_SUNRISE = "scene_sunrise"
SCENE_NOON = "scene_noon"
SCENE_SUNSET = "scene_sunset"
SCENE_DUSK = "scene_dusk"
SCENE_DUSK_MINIMUM_TIME_OF_DAY = "scene_dusk_minimum_time_of_day"
SCENE_DAWN_SUNRISE_SUNSET = "scene_dawn_sunrise_sunset"

NIGHTLIGHTS_BOOLEAN = "nightlights_boolean"
NIGHTLIGHTS_SCENE = "nightlights_scene"

DISPLAY_SCENES_COMBINED = "display_scenes_combined"

PANEL_URL_PATH = "scene_extrapolation"

DATA_STORE = "store"
DATA_ENTITIES = "entities"
DATA_ADD_ENTITIES = "add_entities"
DATA_CONFIG_ENTRY = "config_entry"

STORE_KEY = f"{DOMAIN}.scenes"

SCENE_KEYS = (
    SCENE_DAWN,
    SCENE_SUNRISE,
    SCENE_NOON,
    SCENE_SUNSET,
    SCENE_DUSK,
)
