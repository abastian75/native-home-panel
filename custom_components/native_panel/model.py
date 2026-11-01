"""Dependency-free validation shared by all configuration boundaries."""
from copy import deepcopy
import hashlib
import json
import math
import re

from .const import DEFAULT_CONFIG, MAX_ENTITIES, MAX_JSON
from .schedules import ID_RE as SCHEDULE_ID_RE, SCHEDULE_DOMAINS, normalize_schedule

DEVICE_RE = re.compile(r"^[a-f0-9]{12}$")
ASSET_RE = re.compile(r"^[a-f0-9]{32}$")
ENTITY_RE = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
DOMAINS = {"light", "switch", "fan", "climate", "cover", "lock", "alarm_control_panel", "camera", "sensor", "binary_sensor", "scene", "script", "button"}
SYSTEMS = {"light": "Lights", "switch": "Switches", "fan": "Fans", "climate": "HVAC", "cover": "Covers", "lock": "Security", "alarm_control_panel": "Security", "camera": "Cameras", "sensor": "Sensors", "binary_sensor": "Sensors", "scene": "Scenes", "script": "Scenes", "button": "Actions"}

def security_eligible(entity_id, attributes, name="", alarmo_managed=False):
    """One policy for picker and save validation; detection entities, not video."""
    if not isinstance(entity_id, str) or not ENTITY_RE.fullmatch(entity_id): return False
    domain = entity_id.split(".")[0]
    attrs = attributes if isinstance(attributes, dict) else {}
    device_class = attrs.get("device_class")
    if isinstance(device_class, str): device_class = device_class.lower()
    elif device_class is not None: return False
    if domain == "binary_sensor":
        eligible = {"door", "window", "opening", "garage_door", "motion", "occupancy", "presence", "safety", "smoke", "gas", "carbon_monoxide", "moisture", "tamper", "vibration", "sound"}
        diagnostics = {"battery", "battery_charging", "connectivity", "plug", "power", "problem", "running", "update", "light", "cold", "heat"}
        if device_class in diagnostics: return False
        if device_class in eligible: return True
        if device_class: return False
        if alarmo_managed: return True
        words = r"motion|person|people|vehicle|presence|occupancy|opening|door|window|tamper|vibration|smoke|gas|leak"
    elif domain == "cover":
        if device_class in {"garage", "door", "gate", "window"}: return True
        if device_class: return False
        words = r"garage|door|gate"
    else:
        return False
    label = " ".join(value for value in (entity_id, name, attrs.get("friendly_name", "")) if isinstance(value, str)).lower()
    return re.search(r"(?:^|[^a-z0-9])(?:" + words + r")(?:[^a-z0-9]|$)", label) is not None

def text(value, maximum=64, empty=False):
    if not isinstance(value, str) or len(value.encode("utf-8")) > maximum or (not empty and not value.strip()) or any(ord(c) < 32 for c in value):
        raise ValueError("Invalid or oversized text")
    return value.strip()

def integer(value, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError("Number outside supported range")
    return value

def known_keys(value, keys):
    if not isinstance(value, dict) or set(value) - set(keys):
        raise ValueError("Unsupported configuration field")

def normalize_config(raw):
    known_keys(raw, {"schema", "name", "theme", "menu", "rooms", "systems", "entities", "screensaver", "security", "alerts", "schedules"})
    legacy_catalogs = "rooms" not in raw and "systems" not in raw
    if not legacy_catalogs and not ("rooms" in raw and "systems" in raw):
        raise ValueError("Provide both room and system catalogs")
    if type(raw.get("schema")) is not int or raw["schema"] != 1:
        raise ValueError("Unsupported layout version")
    result = deepcopy(DEFAULT_CONFIG)
    result["name"] = text(raw.get("name"), 63)
    theme = raw.get("theme", {})
    known_keys(theme, {"background", "foreground", "accent", "button", "radius", "background_asset", "button_style", "glass_opacity", "glass_blur", "border_color", "border_width"})
    for key in ("background", "foreground", "accent", "button", "border_color"):
        if key in theme:
            if not isinstance(theme[key], str) or not COLOR_RE.fullmatch(theme[key]):
                raise ValueError("Theme colors must be #RRGGBB")
            result["theme"][key] = theme[key]
    if "radius" in theme:
        result["theme"]["radius"] = integer(theme["radius"], 0, 32)
    if "border_width" in theme:
        result["theme"]["border_width"] = integer(theme["border_width"], 0, 1)
    if "button_style" in theme:
        if not isinstance(theme["button_style"], str) or theme["button_style"] not in {"solid", "glass"}:
            raise ValueError("Button style must be solid or glass")
        result["theme"]["button_style"] = theme["button_style"]
    for key, maximum in (("glass_opacity", 100), ("glass_blur", 20)):
        if key in theme: result["theme"][key] = integer(theme[key], 0, maximum)
    if theme.get("background_asset"):
        if not isinstance(theme["background_asset"], str) or not ASSET_RE.fullmatch(theme["background_asset"]):
            raise ValueError("Invalid background asset")
        result["theme"]["background_asset"] = theme["background_asset"]
    menu = raw.get("menu", {})
    known_keys(menu, {"vertical", "side", "horizontal", "show_all_rooms", "show_all_systems"})
    for key, choices in {"vertical": {"rooms", "systems"}, "side": {"left", "right"}, "horizontal": {"top", "bottom"}}.items():
        if key in menu:
            if not isinstance(menu[key], str) or menu[key] not in choices:
                raise ValueError("Invalid menu position")
            result["menu"][key] = menu[key]
    for option in ("show_all_rooms", "show_all_systems"):
        if option in menu:
            if not isinstance(menu[option], bool):
                raise ValueError("Show All rooms/systems must be true or false")
            result["menu"][option] = menu[option]
    entities = raw.get("entities", [])
    if not isinstance(entities, list) or len(entities) > MAX_ENTITIES:
        raise ValueError("Select at most 64 entities")
    seen = set()
    schedules = raw.get("schedules", [])
    if not isinstance(schedules, list) or len(schedules) > 32: raise ValueError("Maximum 32 schedules")
    schedule_ids = set()
    for schedule in schedules:
        normalized = normalize_schedule(schedule)
        if normalized["id"] in schedule_ids: raise ValueError("Schedule IDs must be unique")
        schedule_ids.add(normalized["id"])
        result["schedules"].append(normalized)
    for entity in entities:
        known_keys(entity, {"entity_id", "label", "room", "system", "icon", "schedule_ids", "additional_systems"})
        eid = entity.get("entity_id")
        if not isinstance(eid, str) or len(eid) > 255 or not ENTITY_RE.fullmatch(eid) or eid.split(".")[0] not in DOMAINS or eid in seen:
            raise ValueError("Invalid, unsupported or duplicate entity")
        seen.add(eid)
        record = {"entity_id": eid, "label": text(entity.get("label", eid), 80), "room": text(entity.get("room", "Unassigned")), "system": text(entity.get("system", SYSTEMS[eid.split(".")[0]]))}
        if "additional_systems" in entity:
            extra = entity["additional_systems"]
            if not isinstance(extra, list) or len(extra) > 23:
                raise ValueError("Additional systems must be up to 23 unique system names")
            names = [text(name, 64) for name in extra]
            if len(set(names)) != len(names) or record["system"] in names:
                raise ValueError("Additional systems must be unique and exclude the primary system")
            record["additional_systems"] = names
        if "icon" in entity:
            record["icon"] = text(entity["icon"], 80, empty=True)
        if "schedule_ids" in entity:
            bindings = entity["schedule_ids"]
            if eid.split(".")[0] not in SCHEDULE_DOMAINS or not isinstance(bindings, list) or len(bindings) > 8 or any(not isinstance(sid, str) or not SCHEDULE_ID_RE.fullmatch(sid) or sid not in schedule_ids for sid in bindings) or len(set(bindings)) != len(bindings):
                raise ValueError("Schedule bindings need up to eight unique configured schedules on a supported control")
            record["schedule_ids"] = list(bindings)
        result["entities"].append(record)
    if legacy_catalogs:
        rooms, systems = {}, {}
        for entity in result["entities"]:
            room = rooms.setdefault(entity["room"], {"name": entity["room"], "systems": []})
            for name in [entity["system"], *entity.get("additional_systems", [])]:
                systems.setdefault(name, {"name": name, "persistent": False})
                if name not in room["systems"]: room["systems"].append(name)
        if len(rooms) > 32 or len(systems) > 24:
            raise ValueError("Legacy layout exceeds 32 rooms or 24 systems; consolidate assignments before using the builder")
        result["rooms"], result["systems"] = list(rooms.values()), list(systems.values())
    else:
        rooms, systems = raw["rooms"], raw["systems"]
        if not isinstance(rooms, list) or len(rooms) > 32 or not isinstance(systems, list) or len(systems) > 24:
            raise ValueError("Maximum 32 rooms and 24 systems")
        system_map = {}
        for system in systems:
            known_keys(system, {"name", "persistent", "enabled"})
            name = text(system.get("name"), 64)
            persistent = system.get("persistent", False)
            if name in system_map or not isinstance(persistent, bool):
                raise ValueError("Systems need unique names and boolean persistence")
            item = {"name": name, "persistent": persistent}
            if "enabled" in system:
                if not isinstance(system["enabled"], bool):
                    raise ValueError("System enabled must be true or false")
                item["enabled"] = system["enabled"]
            system_map[name] = item
            result["systems"].append(item)
        room_map = {}
        for room in rooms:
            known_keys(room, {"name", "area_id", "systems", "system_labels"})
            name = text(room.get("name"), 64)
            if name in room_map: raise ValueError("Room names must be unique")
            links = room.get("systems", [])
            if not isinstance(links, list) or len(links) > 24:
                raise ValueError("A room can link up to 24 systems")
            linked = [text(value, 64) for value in links]
            if len(set(linked)) != len(linked) or any(value not in system_map or not system_map[value].get("enabled", True) for value in linked):
                raise ValueError("Room systems must be unique references to enabled systems in the system catalog")
            item = {"name": name, "systems": linked}
            if "system_labels" in room:
                labels = room["system_labels"]
                if not isinstance(labels, dict) or len(labels) > 24 or any(not isinstance(key, str) or key not in system_map for key in labels):
                    raise ValueError("Room system labels must reference up to 24 configured systems")
                normalized_labels = {}
                for key, label in labels.items():
                    if isinstance(label, str) and any(127 <= ord(char) <= 159 for char in label):
                        raise ValueError("Room system labels cannot contain control characters")
                    value = text(label, 64)
                    normalized_labels[key] = value
                item["system_labels"] = normalized_labels
            if "area_id" in room:
                area_id = text(room["area_id"], 64, empty=True)
                if area_id and not re.fullmatch(r"[a-zA-Z0-9_-]+", area_id):
                    raise ValueError("Invalid HA area identifier")
                item["area_id"] = area_id
            room_map[name] = item
            result["rooms"].append(item)
        for entity in result["entities"]:
            room = room_map.get(entity["room"])
            for name in [entity["system"], *entity.get("additional_systems", [])]:
                system = system_map.get(name)
                if room is None or system is None or not system.get("enabled", True) or not (system["persistent"] or name in room["systems"]):
                    raise ValueError("Each control must reference an existing room and enabled linked or persistent systems")
    saver = raw.get("screensaver", {})
    known_keys(saver, {"mode", "idle_seconds", "interval_seconds", "photos"})
    if not isinstance(saver.get("mode", "off"), str) or saver.get("mode", "off") not in {"off", "photos"}:
        raise ValueError("Invalid screensaver mode")
    result["screensaver"]["mode"] = saver.get("mode", "off")
    for key, low, high in (("idle_seconds", 10, 86400), ("interval_seconds", 5, 3600)):
        if key in saver:
            result["screensaver"][key] = integer(saver[key], low, high)
    photos = saver.get("photos", [])
    if not isinstance(photos, list) or len(photos) > 30 or any(not isinstance(p, str) or not ASSET_RE.fullmatch(p) for p in photos):
        raise ValueError("Invalid photos; maximum 30")
    if result["screensaver"]["mode"] == "photos" and not photos:
        raise ValueError("Add a photo before enabling the screensaver")
    result["screensaver"]["photos"] = list(dict.fromkeys(photos))
    security = raw.get("security", {})
    known_keys(security, {"alarm_entity", "sensor_entities"})
    alarm = text(security.get("alarm_entity", ""), 255, empty=True)
    if alarm and (not alarm.startswith("alarm_control_panel.") or alarm not in seen):
        raise ValueError("Security alarm must be a configured alarm control")
    sensors = security.get("sensor_entities", [])
    if not isinstance(sensors, list) or len(sensors) > 64 or any(not isinstance(eid, str) or len(eid) > 255 or not ENTITY_RE.fullmatch(eid) or eid.split(".")[0] not in {"binary_sensor", "cover"} for eid in sensors):
        raise ValueError("Security monitoring must be up to 64 binary sensors or covers")
    result["security"] = {"alarm_entity": alarm, "sensor_entities": list(dict.fromkeys(sensors))}
    rules = raw.get("alerts", [])
    if not isinstance(rules, list) or len(rules) > 32:
        raise ValueError("Maximum 32 alert rules")
    rule_ids = set()
    for rule in rules:
        known_keys(rule, {"id", "entity_id", "label", "condition", "delay_seconds", "enabled"})
        rule_id = text(rule.get("id"), 64)
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", rule_id) or rule_id in rule_ids:
            raise ValueError("Alert IDs must be unique letters, numbers, underscores or hyphens")
        rule_ids.add(rule_id)
        eid = rule.get("entity_id")
        if not isinstance(eid, str) or len(eid) > 255 or not ENTITY_RE.fullmatch(eid) or eid.split(".")[0] not in DOMAINS:
            raise ValueError("Invalid alert entity")
        condition = rule.get("condition", "on")
        if not isinstance(condition, str) or condition not in {"open", "on", "off", "unavailable"}:
            raise ValueError("Unsupported alert condition")
        if condition == "open" and eid.split(".")[0] not in {"binary_sensor", "cover"}:
            raise ValueError("Open alerts require a binary sensor or cover")
        enabled = rule.get("enabled", True)
        if not isinstance(enabled, bool):
            raise ValueError("Alert enabled must be true or false")
        result["alerts"].append({"id": rule_id, "entity_id": eid, "label": text(rule.get("label", eid), 80), "condition": condition, "delay_seconds": integer(rule.get("delay_seconds", 0), 0, 86400), "enabled": enabled})
    if len(json.dumps(result, ensure_ascii=False).encode()) > 49152:
        raise ValueError("Layout too large")
    return result

def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()

def action_service(entity_id, action, value=None, attributes=None, code=None):
    """Translate finite panel actions, never allow arbitrary HA service calls."""
    if not isinstance(entity_id, str) or not ENTITY_RE.fullmatch(entity_id):
        raise ValueError("Invalid entity")
    if not isinstance(action, str):
        raise ValueError("Invalid action")
    domain = entity_id.split(".")[0]
    data = {"entity_id": entity_id}
    simple = {
        "light": {"toggle": "toggle", "on": "turn_on", "off": "turn_off"},
        "switch": {"toggle": "toggle", "on": "turn_on", "off": "turn_off"},
        "fan": {"toggle": "toggle", "on": "turn_on", "off": "turn_off"},
        "climate": {"on": "turn_on", "off": "turn_off"},
        "cover": {"open": "open_cover", "close": "close_cover", "stop": "stop_cover"},
        "lock": {"lock": "lock"},
        "alarm_control_panel": {"disarm": "alarm_disarm", "arm_home": "alarm_arm_home", "arm_away": "alarm_arm_away", "arm_night": "alarm_arm_night", "arm_vacation": "alarm_arm_vacation", "arm_custom_bypass": "alarm_arm_custom_bypass"},
        "scene": {"on": "turn_on"}, "script": {"on": "turn_on"}, "button": {"on": "press"},
    }
    attrs = attributes if isinstance(attributes, dict) else None
    if code not in (None, "") and domain != "alarm_control_panel":
        raise ValueError("PIN is only accepted for alarm actions")
    if domain == "alarm_control_panel" and action in simple[domain]:
        if attrs is not None:
            flag = {"arm_home": 1, "arm_away": 2, "arm_night": 4, "arm_custom_bypass": 16, "arm_vacation": 32}.get(action)
            if flag:
                require_feature(attrs, flag)
            required = bool(attrs.get("code_arm_required", True)) if action != "disarm" else attrs.get("code_format") is not None
            if required and not code:
                raise ValueError("Alarm PIN required")
        if code not in (None, ""):
            pin = text(code, 32)
            if attrs is not None and attrs.get("code_format") == "number" and not re.fullmatch(r"[0-9]+", pin):
                raise ValueError("Numeric alarm PIN required")
            data["code"] = pin
        return domain, simple[domain][action], data
    if action in simple.get(domain, {}):
        if attrs is not None and domain == "cover" and "supported_features" in attrs:
            require_feature(attrs, {"open": 1, "close": 2, "stop": 8}[action])
        if attrs is not None and domain == "climate" and "supported_features" in attrs:
            require_feature(attrs, 256 if action == "on" else 128)
        return domain, simple[domain][action], data
    if domain == "light" and action == "set_brightness":
        if attrs is not None and not light_modes(attrs) - {"onoff", "unknown"}:
            raise ValueError("Light does not support brightness")
        data["brightness_pct"] = integer(value, 0, 100)
        return domain, "turn_on", data
    if domain == "light" and action == "set_rgb_color":
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,3},[0-9]{1,3},[0-9]{1,3}", value):
            raise ValueError("RGB requires exactly three comma-separated integers")
        color = [integer(int(part), 0, 255) for part in value.split(",")]
        if attrs is not None and not light_modes(attrs) & {"rgb", "rgbw", "rgbww", "hs", "xy"}:
            raise ValueError("Light does not support color")
        data["rgb_color"] = color
        return domain, "turn_on", data
    if domain == "light" and action == "set_color_temperature":
        kelvin = integer(value, 1000, 40000)
        if attrs is not None:
            if "color_temp" not in light_modes(attrs):
                raise ValueError("Light does not support color temperature")
            minimum = finite_number(attrs.get("min_color_temp_kelvin", 1000), 1000, 40000)
            maximum = finite_number(attrs.get("max_color_temp_kelvin", 40000), 1000, 40000)
            if not minimum <= kelvin <= maximum:
                raise ValueError("Color temperature outside light limits")
        data["color_temp_kelvin"] = kelvin
        return domain, "turn_on", data
    if domain == "cover" and action == "set_position":
        if attrs is not None:
            require_feature(attrs, 4)
        data["position"] = integer(value, 0, 100)
        return domain, "set_cover_position", data
    if domain == "climate" and action in {"set_hvac_mode", "set_fan_mode", "set_preset_mode"}:
        attr_key, service_key, flag = {"set_hvac_mode": ("hvac_modes", "hvac_mode", None), "set_fan_mode": ("fan_modes", "fan_mode", 8), "set_preset_mode": ("preset_modes", "preset_mode", 16)}[action]
        mode = text(value, 64)
        if attrs is not None:
            require_option(attrs, attr_key, mode)
            if flag: require_feature(attrs, flag)
        data[service_key] = mode
        return domain, action, data
    if domain == "climate" and action == "set_temperature_range":
        if not isinstance(value, str) or not re.fullmatch(r"[+-]?[0-9]+(?:\.[0-9]+)?,[+-]?[0-9]+(?:\.[0-9]+)?", value):
            raise ValueError("Temperature range requires low,high")
        low, high = [finite_number(float(part), -100, 200) for part in value.split(",")]
        if attrs is not None:
            require_feature(attrs, 2)
            low, high = validate_temperature(low, attrs), validate_temperature(high, attrs)
        if low > high:
            raise ValueError("Low target must not exceed high target")
        data.update(target_temp_low=low, target_temp_high=high)
        return domain, "set_temperature", data
    if domain == "climate" and action in {"set_temperature", "set_temperature_low", "set_temperature_high"}:
        temperature = finite_number(value, -100 if attrs is not None else -50, 200 if attrs is not None else 120)
        if attrs is not None:
            require_feature(attrs, 1 if action == "set_temperature" else 2)
            temperature = validate_temperature(temperature, attrs)
        if action == "set_temperature":
            data["temperature"] = temperature
        else:
            opposite = "target_temp_high" if action == "set_temperature_low" else "target_temp_low"
            if attrs is None:
                raise ValueError("Current temperature range is required")
            other = validate_temperature(attrs.get(opposite), attrs)
            low, high = (temperature, other) if action == "set_temperature_low" else (other, temperature)
            if low > high:
                raise ValueError("Low target must not exceed high target")
            data.update(target_temp_low=low, target_temp_high=high)
        return domain, "set_temperature", data
    if domain == "fan" and action == "set_percentage":
        if attrs is not None: require_feature(attrs, 1)
        data["percentage"] = int(round(finite_number(value, 0, 100)))
        return domain, "set_percentage", data
    if domain == "fan" and action == "set_preset_mode":
        mode = text(value, 64)
        if attrs is not None:
            require_feature(attrs, 8)
            require_option(attrs, "preset_modes", mode)
        data["preset_mode"] = mode
        return domain, "set_preset_mode", data
    if domain == "fan" and action == "set_direction":
        if value not in ("forward", "reverse"): raise ValueError("Invalid fan direction")
        if attrs is not None: require_feature(attrs, 4)
        data["direction"] = value
        return domain, "set_direction", data
    if domain == "fan" and action == "oscillate":
        if value not in ("on", "off"): raise ValueError("Oscillation must be on or off")
        if attrs is not None: require_feature(attrs, 2)
        data["oscillating"] = value == "on"
        return domain, "oscillate", data
    raise ValueError("Unsupported action")


def finite_number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError("Number outside supported limits")
    return value


def require_feature(attrs, flag):
    features = attrs.get("supported_features", 0)
    if isinstance(features, bool) or not isinstance(features, int) or features < 0 or not features & flag:
        raise ValueError("Entity does not advertise this control")


def require_option(attrs, key, value):
    options = attrs.get(key)
    if not isinstance(options, (list, tuple)) or value not in options:
        raise ValueError("Mode is not advertised by this entity")


def light_modes(attrs):
    modes = attrs.get("supported_color_modes", [])
    return {mode for mode in modes if isinstance(mode, str)} if isinstance(modes, (list, tuple)) else set()


def validate_temperature(value, attrs):
    minimum = finite_number(attrs.get("min_temp", -100), -100, 200)
    maximum = finite_number(attrs.get("max_temp", 200), -100, 200)
    value = finite_number(value, minimum, maximum)
    step = attrs.get("target_temp_step")
    if step is not None:
        step = finite_number(step, 0.001, 100)
        increments = (value - minimum) / step
        if abs(increments - round(increments)) > 0.00001:
            raise ValueError("Temperature does not match the entity's target step")
    return value


def alert_condition(rule, state):
    if not rule.get("enabled", True): return False
    value = state.state if state is not None else "unavailable"
    if rule["condition"] == "unavailable": return value == "unavailable"
    if rule["condition"] == "open":
        return value == "on" if rule["entity_id"].startswith("binary_sensor.") else value in {"open", "opening", "closing"}
    return value == rule["condition"]
