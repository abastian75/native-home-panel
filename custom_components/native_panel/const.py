"""Constants for Native Home Panel."""
DOMAIN = "native_panel"
VERSION = "0.7.12"
MAX_JSON = 65536
MAX_UPLOAD = 4 * 1024 * 1024
MAX_PANELS = 16
MAX_ENTITIES = 64
STATE_ATTRIBUTES = {
    "friendly_name", "brightness", "supported_features", "supported_color_modes",
    "rgb_color", "hs_color", "xy_color", "color_mode", "color_temp_kelvin",
    "min_color_temp_kelvin", "max_color_temp_kelvin",
    "current_temperature", "temperature", "min_temp", "max_temp", "target_temp_step",
    "target_temp_low", "target_temp_high", "temperature_unit", "hvac_modes", "hvac_action",
    "fan_modes", "fan_mode", "preset_modes", "preset_mode", "current_position",
    "unit_of_measurement", "device_class", "percentage", "percentage_step", "direction",
    "oscillating", "code_format", "code_arm_required", "open_sensors",
}
DEFAULT_CONFIG = {
    "schema": 1,
    "name": "Home Panel",
    "theme": {"background": "#0B1018", "foreground": "#EEF3FA", "accent": "#79B8EB", "button": "#202A39", "radius": 18, "button_style": "solid", "glass_opacity": 35, "glass_blur": 0, "border_color": "#D1D7DC", "border_width": 0},
    "menu": {"vertical": "rooms", "side": "left", "horizontal": "bottom"},
    "rooms": [],
    "systems": [],
    "entities": [],
    "screensaver": {"mode": "off", "idle_seconds": 60, "interval_seconds": 30, "photos": []},
    "security": {"alarm_entity": "", "sensor_entities": []},
    "alerts": [],
    "schedules": [],
}
