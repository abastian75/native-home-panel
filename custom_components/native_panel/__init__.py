"""Local native touchscreen coordinator; no browser screen streaming."""
from __future__ import annotations

import asyncio
import base64
from collections import OrderedDict, deque
from contextlib import suppress
from copy import deepcopy
import hmac
from io import BytesIO
from inspect import iscoroutinefunction
import json
import math
from pathlib import Path
import secrets
import time
from urllib.parse import urlsplit

from aiohttp import web
try:
    import probatio as vol
except ImportError:
    import voluptuous as vol
from homeassistant.components import camera, panel_custom, websocket_api
from homeassistant.components.ffmpeg import get_ffmpeg_manager
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.const import EVENT_HOMEASSISTANT_STOP, EVENT_STATE_CHANGED
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers.storage import Store
from homeassistant.helpers.event import async_track_time_change

from .const import DEFAULT_CONFIG, DOMAIN, MAX_JSON, MAX_PANELS, MAX_UPLOAD, VERSION, STATE_ATTRIBUTES
from .model import ASSET_RE, DEVICE_RE, DOMAINS, SYSTEMS, action_service, alert_condition, integer, normalize_config, security_eligible, text, token_hash
from .schedules import SCHEDULE_DOMAINS, ScheduleEngine, binding_plans, clock_metadata, execution_plan, schedule_eligible


def valid_camera_source(source):
    """Validate a gateway-owned source without exposing it to clients or logs."""
    if not isinstance(source, str) or len(source) > 4096 or any(ord(c) <= 32 or ord(c) == 127 for c in source):
        return False
    try:
        parsed = urlsplit(source)
        return parsed.scheme.lower() in {"rtsp", "rtsps", "http", "https"} and bool(parsed.hostname) and (parsed.port is None or 1 <= parsed.port <= 65535)
    except ValueError:
        return False


async def async_setup(hass, config):
    return True


async def async_setup_entry(hass, entry):
    if DOMAIN in hass.data:
        return False
    hub = PanelHub(hass, entry.entry_id)
    await hub.load()
    hass.data[DOMAIN] = hub
    for view in (PairView(hub), SyncView(hub), AssetView(hub), CameraView(hub)):
        hass.http.register_view(view)
    if not hass.data.get(f"{DOMAIN}_static"):
        await hass.http.async_register_static_paths([StaticPathConfig(
            f"/native_panel/editor-{VERSION}.js", str(Path(__file__).parent / "www" / "native-panel-editor.js"), False
        ), StaticPathConfig(
            "/native_panel/editor.js", str(Path(__file__).parent / "www" / "native-panel-editor.js"), False
        )])
        hass.data[f"{DOMAIN}_static"] = True
    for handler in (ws_list, ws_pair, ws_save, ws_upload, ws_assets, ws_prepare_cameras, ws_ack_alert):
        websocket_api.async_register_command(hass, handler)
    await panel_custom.async_register_panel(
        hass, webcomponent_name=f"native-panel-editor-{VERSION.replace('.', '-')}", frontend_url_path="native-panel",
        sidebar_title="Native Panel", sidebar_icon="mdi:tablet-dashboard",
        module_url=f"/native_panel/editor-{VERSION}.js", require_admin=True,
        config={"version": VERSION},
    )
    entry.async_on_unload(hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, hub.stop))
    entry.async_on_unload(hass.bus.async_listen(EVENT_STATE_CHANGED, hub.on_state_changed))
    hub.schedule_engine = ScheduleEngine(hub)
    hub.schedule_cancel = async_track_time_change(hass, hub.schedule_engine.async_tick, second=0)
    entry.async_on_unload(hub.cancel_schedules)
    for device_id, record in hub.panels.items():
        hub.register_device(device_id, record["name"])
    return True


async def async_unload_entry(hass, entry):
    hub = hass.data.pop(DOMAIN)
    await hub.stop()
    from homeassistant.components.frontend import async_remove_panel
    async_remove_panel(hass, "native-panel")
    return True


def convert_photo(data, blur=0):
    """Decode in executor; pixel and encoded-byte limits precede full decoding."""
    from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError
    blur = integer(blur, 0, 20)
    if len(data) > MAX_UPLOAD:
        raise ValueError("Photo exceeds 4 MiB")
    try:
        with Image.open(BytesIO(data)) as source:
            if source.format not in {"JPEG", "PNG"} or source.width * source.height > 16000000:
                raise ValueError("Use JPEG or PNG up to 16 megapixels")
            image = ImageOps.exif_transpose(source).convert("RGB")
            canvas = ImageOps.fit(image, (1024, 600), method=Image.Resampling.LANCZOS)
            if blur: canvas = canvas.filter(ImageFilter.GaussianBlur(radius=blur))
            for quality in (85, 75, 65, 55):
                result = BytesIO()
                canvas.save(result, format="JPEG", quality=quality, optimize=True)
                if len(result.getvalue()) <= 256 * 1024:
                    return result.getvalue()
            raise ValueError("Photo exceeds the panel's 256 KiB image limit; use a less detailed image")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as err:
        raise ValueError("Invalid image") from err


class PanelHub:
    def __init__(self, hass, entry_id):
        self.hass, self.entry_id = hass, entry_id
        self.store = Store(hass, 1, DOMAIN)
        self.panels = {}
        self.codes = {}
        self.attempts = {}
        self.actions = {}
        self.sync_locks = {}
        self.streaming = set()
        self.processes = set()
        self.asset_dir = Path(hass.config.path(".storage", "native_panel_assets"))
        self.last_save = 0
        self.active = True
        self.prepare_camera_lock = asyncio.Lock()
        self.asset_cache = OrderedDict()
        self.asset_render_lock = asyncio.Lock()
        self.schedule_engine = None
        self.schedule_cancel = None

    async def load(self):
        data = await self.store.async_load() or {}
        self.panels = data.get("panels", {})
        await self.hass.async_add_executor_job(lambda: self.asset_dir.mkdir(parents=True, exist_ok=True))
        migrated = False
        for record in self.panels.values():
            config = record.get("config", {})
            if "rooms" not in config and "systems" not in config:
                try:
                    normalized = normalize_config(config)
                except ValueError:
                    # Preserve an older unsupported layout rather than discard
                    # its assignments; the editor can surface a save error.
                    continue
                record["config"] = normalized
                record["revision"] += 1
                migrated = True
        if migrated: await self.save()

    async def save(self):
        await self.store.async_save({"panels": self.panels})
        self.last_save = time.monotonic()

    def record(self, device_id):
        if not isinstance(device_id, str) or not DEVICE_RE.fullmatch(device_id) or device_id not in self.panels:
            raise ValueError("Unknown panel")
        return self.panels[device_id]

    def authenticate(self, request, device_id):
        if not self.active:
            raise web.HTTPUnauthorized()
        try:
            record = self.record(device_id)
        except ValueError:
            raise web.HTTPUnauthorized() from None
        header = request.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else ""
        if not 32 <= len(token) <= 128 or not hmac.compare_digest(token_hash(token), record["token_hash"]):
            raise web.HTTPUnauthorized()
        return record

    def register_device(self, device_id, name):
        registry = dr.async_get(self.hass)
        device = registry.async_get_or_create(config_entry_id=self.entry_id,
            identifiers={(DOMAIN, device_id)}, connections={(dr.CONNECTION_NETWORK_MAC, ":".join(device_id[i:i+2] for i in range(0, 12, 2)))},
            manufacturer="Native Home Panel", model="Elecrow Advanced 10.1 P4", name=name,
            sw_version=VERSION)
        registry.async_update_device(device.id, name=name)

    def pair_code(self):
        now = time.monotonic()
        self.codes = {key: expiry for key, expiry in self.codes.items() if expiry > now}
        if len(self.codes) >= 20:
            raise ValueError("Too many pending pairing codes")
        code = secrets.token_hex(4).upper()
        self.codes[code] = now + 300
        return {"code": code, "expires_in": 300}

    def pairing_rate(self, peer):
        if not self.active:
            raise web.HTTPUnauthorized()
        now = time.monotonic()
        self.attempts = {key: hits for key, hits in self.attempts.items() if hits and now - hits[-1] < 60}
        if peer not in self.attempts and len(self.attempts) >= 256:
            raise web.HTTPTooManyRequests()
        hits = self.attempts.setdefault(peer, deque())
        while hits and now - hits[0] >= 60:
            hits.popleft()
        if len(hits) >= 8:
            raise web.HTTPTooManyRequests()
        hits.append(now)

    async def pair(self, raw):
        code = text(raw.get("code"), 16).upper()
        device_id = text(raw.get("device_id"), 12).lower()
        name = text(raw.get("name"), 63)
        if not DEVICE_RE.fullmatch(device_id):
            raise ValueError("Device ID must be its 12-character MAC")
        expiry = self.codes.pop(code, 0)
        if expiry < time.monotonic():
            raise ValueError("Pairing code expired or invalid")
        if device_id not in self.panels and len(self.panels) >= MAX_PANELS:
            raise ValueError("Maximum 16 panels")
        token = secrets.token_urlsafe(32)
        record = self.panels.get(device_id, {"revision": 1, "config": deepcopy(DEFAULT_CONFIG), "assets": {}, "seen": 0, "requests": []})
        record.update(name=name, token_hash=token_hash(token))
        record["config"]["name"] = name
        record["revision"] += 1
        self.panels[device_id] = record
        self.register_device(device_id, name)
        await self.save()
        return {"token": token, "device_id": device_id, "name": name}

    def source_location(self, entity_id):
        """HA location is display metadata; this never updates the registry."""
        entry = er.async_get(self.hass).async_get(entity_id)
        device_id = getattr(entry, "device_id", None)
        device = dr.async_get(self.hass).async_get(device_id) if device_id else None
        area_id = getattr(entry, "area_id", None) or getattr(device, "area_id", None)
        area = ar.async_get(self.hass).async_get_area(area_id) if area_id else None
        name = getattr(area, "name", "Unassigned")
        return {"area_id": area_id or "", "room": name}

    def state_payload(self, config):
        controls = {item["entity_id"] for item in config["entities"]}
        overrides = {item["entity_id"]: item["room"] for item in config["entities"] if "room" in item}
        monitored = controls | set(config.get("security", {}).get("sensor_entities", [])) | {rule["entity_id"] for rule in config.get("alerts", [])}
        result = {}
        for eid in sorted(monitored):
            state = self.hass.states.get(eid)
            attrs = self.metadata(state)
            if eid.startswith("climate.") and "temperature_unit" not in attrs:
                units = getattr(getattr(self.hass, "config", None), "units", None)
                unit = getattr(units, "temperature_unit", None)
                if unit is not None: attrs["temperature_unit"] = str(unit)
            location = self.source_location(eid)
            if eid in overrides: location["room"] = overrides[eid]
            result[eid] = {"state": state.state if state else "unavailable", "attributes": attrs, **location}
        return result

    @staticmethod
    def metadata(state):
        """Only finite control metadata, never arbitrary integration attributes."""
        if state is None: return {}
        result = {}
        def bounded_string(value, maximum=80):
            return value.encode("utf-8")[:maximum].decode("utf-8", "ignore")
        for key, value in state.attributes.items():
            if key not in STATE_ATTRIBUTES: continue
            if value is None or isinstance(value, bool): result[key] = value
            elif isinstance(value, (int, float)) and math.isfinite(value): result[key] = value
            elif isinstance(value, str): result[key] = bounded_string(value)
            elif isinstance(value, (list, tuple)):
                items = []
                for item in value[:32]:
                    if isinstance(item, str): items.append(bounded_string(item, 64))
                    elif isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(item): items.append(item)
                result[key] = items
            elif key == "open_sensors" and isinstance(value, dict):
                result[key] = {eid: bounded_string(label) if isinstance(label, str) else bool(label) for eid, label in list(value.items())[:64] if isinstance(eid, str) and eid.startswith("binary_sensor.")}
        return result

    def active_alerts(self, record, now=None):
        now = time.time() if now is None else now
        runtime = record.setdefault("alert_runtime", {})
        active = []
        for rule in record["config"].get("alerts", []):
            signature = [rule["entity_id"], rule["condition"]]
            tracked = runtime.get(rule["id"])
            if not isinstance(tracked, dict) or tracked.get("signature") != signature:
                tracked = runtime[rule["id"]] = {"signature": signature, "since": None, "ack_until": 0}
            state = self.hass.states.get(rule["entity_id"])
            if not alert_condition(rule, state):
                tracked["since"] = None
                continue
            if tracked.get("since") is None or tracked["since"] > now:
                tracked["since"] = now
            if now - tracked["since"] >= rule.get("delay_seconds", 0) and now >= tracked.get("ack_until", 0):
                active.append({"id": rule["id"], "entity_id": rule["entity_id"], "label": rule["label"], "state": state.state if state else "unavailable"})
        return active

    @callback
    def on_state_changed(self, event):
        if not self.active: return
        changed = False
        eid = event.data.get("entity_id")
        for record in self.panels.values():
            if not any(rule["entity_id"] == eid for rule in record["config"].get("alerts", [])): continue
            before = deepcopy(record.get("alert_runtime", {}))
            self.active_alerts(record)
            changed |= before != record.get("alert_runtime", {})
        delay_save = getattr(self.store, "async_delay_save", None)
        if changed and callable(delay_save):
            delay_save(lambda: {"panels": self.panels}, 2)

    def acknowledge_alert(self, record, alert_id, entity_id=None):
        alert_id = text(alert_id, 64)
        rule = next((rule for rule in record["config"].get("alerts", []) if rule["id"] == alert_id and rule.get("enabled", True)), None)
        if rule is None or entity_id is not None and entity_id != rule["entity_id"]:
            raise ValueError("Unknown alert on this panel")
        self.active_alerts(record)
        until = time.time() + 3600
        record["alert_runtime"][alert_id]["ack_until"] = until
        return {"alert_id": alert_id, "acknowledged_until": until}

    async def ack_alert(self, device_id, alert_id):
        async with self.sync_locks.setdefault(device_id, asyncio.Lock()):
            result = self.acknowledge_alert(self.record(device_id), alert_id)
            await self.save()
            return result

    async def configure(self, device_id, raw, *, _locked=False, receipt_id=None):
        if not _locked:
            self.record(device_id)
            async with self.sync_locks.setdefault(device_id, asyncio.Lock()):
                return await self.configure(device_id, raw, _locked=True, receipt_id=receipt_id)
        record = self.record(device_id)
        config = normalize_config(raw)
        capabilities = record.get("capabilities", [])
        if config["menu"].get("show_all_systems") is False and "hide_all_systems" not in capabilities:
            raise ValueError("Update this touchscreen firmware before hiding All systems. Your saved layout was not changed.")
        if any(entity.get("additional_systems") for entity in config["entities"]) and "system_memberships" not in capabilities:
            raise ValueError("Update this touchscreen firmware before using additional systems. Your saved layout was not changed.")
        if any(rule[key].startswith("sunset") for rule in config.get("schedules", []) for key in ("on_time", "off_time")) and "sunset_schedules" not in capabilities:
            raise ValueError("Update this touchscreen firmware before using sunset schedules. Your saved layout was not changed.")
        refs = config["screensaver"]["photos"] + ([config["theme"]["background_asset"]] if config["theme"].get("background_asset") else [])
        if any(asset not in record["assets"] for asset in refs):
            raise ValueError("Theme references a photo not uploaded to this panel")
        old_bindings = {item["entity_id"]: set(item.get("schedule_ids", [])) for item in record["config"]["entities"]}
        for item in config["entities"]:
            state = self.hass.states.get(item["entity_id"])
            if state is None:
                raise ValueError(f"Entity does not exist: {item['entity_id']}")
            added = set(item.get("schedule_ids", [])) - old_bindings.get(item["entity_id"], set())
            if added and not schedule_eligible(item["entity_id"], state.attributes):
                raise ValueError("This entity does not advertise both scheduled on/off or open/close controls")
        monitored = set(config["security"]["sensor_entities"]) | {rule["entity_id"] for rule in config["alerts"]}
        for eid in monitored:
            if self.hass.states.get(eid) is None:
                raise ValueError(f"Monitored entity does not exist: {eid}")
        managed = self.alarmo_managed_ids()
        for eid in config["security"]["sensor_entities"]:
            state = self.hass.states.get(eid)
            if not security_eligible(eid, dict(state.attributes), getattr(state, "name", ""), eid in managed):
                raise ValueError("Security monitoring accepts security-related detection sensors and doors, windows or garage covers; diagnostics, shades and video cameras are excluded")
        all_alerts = [{"id": rule["id"], "entity_id": rule["entity_id"], "label": rule["label"], "state": "unavailable"} for rule in config["alerts"]]
        if len(json.dumps({"config": config, "states": self.state_payload(config), "alerts": all_alerts}, ensure_ascii=False).encode()) > MAX_JSON - 2048:
            raise ValueError("Layout and control metadata exceed the panel response limit; select fewer entities")
        previous_runtime = record.get("alert_runtime", {})
        record["alert_runtime"] = {rule["id"]: previous_runtime[rule["id"]] for rule in config["alerts"] if rule["id"] in previous_runtime and previous_runtime[rule["id"]].get("signature") == [rule["entity_id"], rule["condition"]]}
        previous_plans, next_plans = binding_plans(record["config"]), binding_plans(config)
        changed_at = time.time()
        record["schedule_armed_after"] = {key: record.get("schedule_armed_after", {}).get(key, 0) if previous_plans.get(key) == plan else changed_at for key, plan in next_plans.items()}
        if execution_plan(record["config"]) != execution_plan(config): record["schedule_changed_at"] = changed_at
        if receipt_id is not None: record["requests"] = (record.setdefault("requests", []) + [receipt_id])[-256:]
        record.update(config=config, name=config["name"], revision=record["revision"] + 1)
        selected = {item["entity_id"] for item in config["entities"] if item["entity_id"].startswith("camera.")}
        record["camera_sources"] = {eid: source for eid, source in record.get("camera_sources", {}).items() if eid in selected}
        self.active_alerts(record)
        self.register_device(device_id, config["name"])
        await self.save()
        return {"revision": record["revision"]}

    async def schedule_action(self, device_id, action, receipt_id):
        """Called under the panel sync lock; configuration only, never services."""
        command, value, eid = action.get("action"), action.get("value"), action.get("entity_id")
        if not isinstance(value, str) or len(value.encode("utf-8")) > 1024: raise ValueError("Invalid schedule edit")
        config = deepcopy(self.record(device_id)["config"])
        schedules = config.setdefault("schedules", [])
        if command == "schedule_save":
            if eid not in (None, ""): raise ValueError("Schedule definition is not an entity action")
            schedule = json.loads(value)
            if not isinstance(schedule, dict): raise ValueError("Invalid schedule")
            if schedule.get("id") == "":
                schedule["id"] = secrets.token_hex(8)
                if any(item["id"] == schedule["id"] for item in schedules): raise ValueError("Schedule ID collision; retry the edit")
            elif not any(item["id"] == schedule.get("id") for item in schedules): raise ValueError("Schedule not found")
            index = next((index for index, item in enumerate(schedules) if item["id"] == schedule["id"]), len(schedules))
            if index == len(schedules): schedules.append(schedule)
            else: schedules[index] = schedule
        elif command == "schedule_delete":
            if eid not in (None, "") or not any(item["id"] == value for item in schedules): raise ValueError("Schedule not found")
            config["schedules"] = [item for item in schedules if item["id"] != value]
            for item in config["entities"]:
                if value in item.get("schedule_ids", []):
                    item["schedule_ids"] = [sid for sid in item["schedule_ids"] if sid != value]
                    if not item["schedule_ids"]: item.pop("schedule_ids")
        elif command == "schedule_bind":
            item = next((item for item in config["entities"] if item["entity_id"] == eid), None)
            if item is None or eid.split(".")[0] not in SCHEDULE_DOMAINS: raise ValueError("Entity is not a configured schedulable control on this panel")
            bindings = json.loads(value)
            if not isinstance(bindings, list): raise ValueError("Invalid schedule bindings")
            if bindings: item["schedule_ids"] = bindings
            else: item.pop("schedule_ids", None)
        else:
            raise ValueError("Unsupported schedule edit")
        return await self.configure(device_id, config, _locked=True, receipt_id=receipt_id)

    async def sync(self, device_id, raw):
        if not isinstance(raw, dict) or not isinstance(raw.get("actions", []), list) or len(raw.get("actions", [])) > 8:
            raise ValueError("Invalid sync request")
        capabilities = raw.get("capabilities", [])
        if not isinstance(capabilities, list) or len(capabilities) > 8 or any(not isinstance(value, str) or len(value) > 40 for value in capabilities):
            raise ValueError("Invalid touchscreen capabilities")
        supported = sorted(set(capabilities) & {"hide_all_systems", "system_memberships", "sunset_schedules"})
        lock = self.sync_locks.setdefault(device_id, asyncio.Lock())
        async with lock:
            record = self.record(device_id)
            if record.get("capabilities", []) != supported:
                record["capabilities"] = supported
                await self.save()
            if "name" in raw:
                name = text(raw["name"], 63)
                if name != record["name"]:
                    record["name"] = record["config"]["name"] = name
                    record["revision"] += 1
                    self.register_device(device_id, name)
                    await self.save()
            allowed = {item["entity_id"] for item in record["config"]["entities"]}
            seen = set(record.setdefault("requests", []))
            results = []
            for action in raw.get("actions", []):
                if not isinstance(action, dict):
                    raise ValueError("Invalid action")
                pin = action.pop("code", None)
                rid = text(action.get("request_id"), 96)
                if rid in seen:
                    results.append({"request_id": rid, "status": "duplicate"})
                    pin = None
                    continue
                eid = action.get("entity_id")
                service_data = None
                try:
                    if isinstance(action.get("action"), str) and action["action"] in {"schedule_save", "schedule_delete", "schedule_bind"}:
                        if pin not in (None, ""): raise ValueError("Schedule edits do not accept a PIN")
                        await self.schedule_action(device_id, action, rid)
                        seen.add(rid)
                        results.append({"request_id": rid, "status": "ok"})
                        continue
                    if action.get("action") == "ack_alert":
                        if pin not in (None, ""): raise ValueError("Alert acknowledgement does not accept a PIN")
                        if not isinstance(eid, str): raise ValueError("Alert target is required")
                        self.acknowledge_alert(record, action.get("value"), entity_id=eid)
                        record["requests"] = (record["requests"] + [rid])[-256:]
                        seen.add(rid)
                        await self.save()
                        results.append({"request_id": rid, "status": "ok"})
                        continue
                    if not isinstance(eid, str) or eid not in allowed:
                        raise ValueError("Entity is not configured on this panel")
                    state = self.hass.states.get(eid)
                    stateless_activation = eid.split(".")[0] in {"scene", "button"} and action.get("action") == "on"
                    if state is None or state.state == "unavailable" or state.state == "unknown" and not stateless_activation:
                        raise ValueError("Entity unavailable")
                    domain, service, service_data = action_service(eid, action.get("action"), action.get("value"), attributes=dict(state.attributes), code=pin)
                    if not self.hass.services.has_service(domain, service):
                        raise ValueError("Entity action unavailable")
                    # Persist receipt before acting: retries after a restart must not toggle twice.
                    record["requests"] = (record["requests"] + [rid])[-256:]
                    seen.add(rid)
                    await self.save()
                    async with asyncio.timeout(10):
                        await self.hass.services.async_call(domain, service, service_data, blocking=True)
                    results.append({"request_id": rid, "status": "ok"})
                except (ValueError, HomeAssistantError, TimeoutError):
                    results.append({"request_id": rid, "status": "error", "error": "Action unavailable, invalid or failed; check HA"})
                finally:
                    if service_data is not None: service_data.pop("code", None)
                    pin = None
            record["seen"] = time.time()
            states = self.state_payload(record["config"])
            result = {"revision": record["revision"], "config": record["config"] if raw.get("revision") != record["revision"] else None, "states": states, "name": record["name"], "results": results, "alerts": self.active_alerts(record), **clock_metadata(self.hass)}
            if len(json.dumps(result, ensure_ascii=False).encode()) > MAX_JSON:
                raise ValueError("Panel response exceeds 64 KiB; select fewer entities")
            if time.monotonic() - self.last_save > 30:
                await self.save()
            return result

    def alarmo_sensors(self, alarm_entity):
        """Read Alarmo's configured sensors only; never access its user store."""
        data = self.hass.data.get("alarmo", {})
        if not isinstance(data, dict): return []
        coordinator = data.get("coordinator")
        getter = getattr(getattr(coordinator, "store", None), "async_get_sensors", None)
        if not callable(getter) or iscoroutinefunction(getter): return []
        try:
            sensors = getter()
            if not isinstance(sensors, dict): return []
            areas = data.get("areas", {})
            area_id = next((area_id for area_id, entity in areas.items() if getattr(entity, "entity_id", None) == alarm_entity), None) if isinstance(areas, dict) else None
            result = []
            for eid, settings in sensors.items():
                if not isinstance(eid, str) or not eid.startswith("binary_sensor.") or not isinstance(settings, dict) or not settings.get("enabled", True): continue
                if area_id is not None and settings.get("area") != area_id: continue
                if self.hass.states.get(eid) is not None: result.append(eid)
            return sorted(result)[:64]
        except (AttributeError, TypeError, ValueError):
            return []

    def alarmo_managed_ids(self):
        """Enabled Alarmo sensor IDs; never read users, codes or other settings."""
        data = self.hass.data.get("alarmo", {})
        getter = getattr(getattr(data.get("coordinator") if isinstance(data, dict) else None, "store", None), "async_get_sensors", None)
        if not callable(getter) or iscoroutinefunction(getter): return set()
        try:
            sensors = getter()
            return {eid for eid, settings in sensors.items() if isinstance(eid, str) and eid.startswith("binary_sensor.") and isinstance(settings, dict) and settings.get("enabled", True)} if isinstance(sensors, dict) else set()
        except (AttributeError, TypeError, ValueError):
            return set()

    def listing(self):
        entities, areas = er.async_get(self.hass), ar.async_get(self.hass)
        devices = dr.async_get(self.hass)
        candidates = []
        managed = self.alarmo_managed_ids()
        for state in self.hass.states.async_all():
            domain = state.entity_id.split(".")[0]
            if domain not in DOMAINS:
                continue
            entry = entities.async_get(state.entity_id)
            if entry and entry.disabled_by:
                continue
            device = devices.async_get(entry.device_id) if entry and entry.device_id else None
            area_id = entry.area_id if entry and entry.area_id else device.area_id if device else None
            area = areas.async_get_area(area_id) if area_id else None
            metadata = self.state_payload({"entities": [{"entity_id": state.entity_id}]})[state.entity_id]["attributes"]
            candidate = {"entity_id": state.entity_id, "name": state.name, "domain": domain, "room": area.name if area else "Unassigned", "area_id": area_id or "", "system": SYSTEMS[domain], "attributes": metadata, "security_eligible": security_eligible(state.entity_id, dict(state.attributes), state.name, state.entity_id in managed), "schedule_eligible": schedule_eligible(state.entity_id, state.attributes)}
            if domain == "alarm_control_panel": candidate["is_alarmo"] = bool(entry and entry.platform == "alarmo")
            if domain == "alarm_control_panel" and entry and entry.platform == "alarmo":
                candidate["sensor_entities"] = self.alarmo_sensors(state.entity_id)
            candidates.append(candidate)
        alarm = next((item for item in candidates if "sensor_entities" in item), None)
        defaults = {"alarm_entity": alarm["entity_id"], "sensor_entities": alarm["sensor_entities"]} if alarm else {"alarm_entity": "", "sensor_entities": []}
        return {"panels": [{"device_id": did, "name": p["name"], "revision": p["revision"], "config": p["config"], "online": time.time() - p.get("seen", 0) < 15, "capabilities": p.get("capabilities", []), "alerts": self.active_alerts(p)} for did, p in self.panels.items()], "entities": sorted(candidates, key=lambda x: (x["room"], x["name"])), "areas": [{"id": a.id, "name": a.name} for a in areas.async_list_areas()], "security_defaults": defaults, **clock_metadata(self.hass)}

    async def upload(self, device_id, filename, encoded):
        record = self.record(device_id)
        filename = text(filename, 120)
        if not isinstance(encoded, str) or len(encoded) > (MAX_UPLOAD * 4 // 3 + 8):
            raise ValueError("Photo exceeds 4 MiB")
        if len(record["assets"]) >= 50:
            raise ValueError("Maximum 50 uploaded photos per panel")
        try:
            data = base64.b64decode(encoded, validate=True)
        except ValueError as err:
            raise ValueError("Invalid photo encoding") from err
        result = await self.hass.async_add_executor_job(convert_photo, data)
        if sum(a["size"] for a in record["assets"].values()) + len(result) > 12 * 1024 * 1024:
            raise ValueError("Panel photo storage limit is 12 MiB")
        asset_id = secrets.token_hex(16)
        await self.hass.async_add_executor_job((self.asset_dir / f"{device_id}-{asset_id}.jpg").write_bytes, result)
        record["assets"][asset_id] = {"filename": filename, "size": len(result)}
        await self.save()
        return {"asset_id": asset_id}

    async def asset_bytes(self, device_id, asset_id, blur=0):
        record = self.record(device_id)
        blur = integer(blur, 0, 20)
        if not isinstance(asset_id, str) or not ASSET_RE.fullmatch(asset_id) or asset_id not in record["assets"]:
            raise ValueError("Photo not found")
        if blur:
            key = (device_id, asset_id, blur)
            async with self.asset_render_lock:
                if key in self.asset_cache:
                    self.asset_cache.move_to_end(key)
                    return self.asset_cache[key]
                original = await self.asset_bytes(device_id, asset_id)
                derived = await self.hass.async_add_executor_job(convert_photo, original, blur)
                if self.active:
                    self.asset_cache[key] = derived
                    while len(self.asset_cache) > 8: self.asset_cache.popitem(last=False)
                return derived
        try:
            return await self.hass.async_add_executor_job((self.asset_dir / f"{device_id}-{asset_id}.jpg").read_bytes)
        except OSError as err:
            raise ValueError("Photo not found") from err

    def camera_entity(self, entity_id):
        lookup = getattr(camera, "get_camera_from_entity_id", None)
        if callable(lookup):
            return lookup(self.hass, entity_id)
        component = self.hass.data.get("camera")
        return component.get_entity(entity_id) if component and callable(getattr(component, "get_entity", None)) else None

    def camera_source(self, record, entity_id):
        """Only reuse a private source while HA and gateway identities match."""
        cached = record.get("camera_sources", {}).get(entity_id)
        if not isinstance(cached, dict) or not valid_camera_source(cached.get("url")):
            return None
        registered = er.async_get(self.hass).async_get(entity_id)
        if registered is None or registered.platform != "unifiprotect" or registered.config_entry_id != cached.get("entry_id") or registered.unique_id != cached.get("unique_id"):
            return None
        entity = self.camera_entity(entity_id)
        camera_id = getattr(getattr(entity, "_public", None), "id", None) or getattr(getattr(entity, "device", None), "id", None)
        return cached["url"] if camera_id == cached.get("camera_id") else None

    async def prepare_cameras(self, device_id):
        """Read selected third-party camera sources from HA's gateway client.

        Raw Protect connection information is not in the SDK's Camera model.
        Keep it solely in HA's private store; no provider writes or reloads.
        """
        record = self.record(device_id)
        if self.prepare_camera_lock.locked():
            raise ValueError("Camera preparation is already running")
        async with self.prepare_camera_lock:
            registry = er.async_get(self.hass)
            results = []
            changed = False
            for item in record["config"]["entities"]:
                entity_id = item["entity_id"]
                if not entity_id.startswith("camera."):
                    continue
                result = {"entity_id": entity_id, "status": "error"}
                results.append(result)
                stage = "registry_lookup"
                try:
                    entity_entry = registry.async_get(entity_id)
                    entry = self.hass.config_entries.async_get_entry(entity_entry.config_entry_id) if entity_entry and entity_entry.config_entry_id else None
                    if entity_entry is None or entity_entry.platform != "unifiprotect" or entry is None or entry.domain != "unifiprotect":
                        stage = "source_lookup"
                        async with asyncio.timeout(10):
                            source = await camera.async_get_stream_source(self.hass, entity_id)
                        if valid_camera_source(source):
                            result["status"] = "ready"
                        else:
                            result["message"] = "This camera has no live source; only the HA UniFi Protect gateway can supply a direct camera connection automatically"
                        continue
                    stage = "gateway_client"
                    data = getattr(entry, "runtime_data", None)
                    if data is None:
                        result["message"] = "The HA Protect gateway is not loaded or its runtime API is unsupported"
                        continue
                    api = getattr(data, "api", None)
                    read_camera = getattr(api, "api_request_obj", None)
                    if not callable(read_camera):
                        result["message"] = "This HA Protect client lacks the supported raw camera read API"
                        continue
                    stage = "camera_identity"
                    entity = self.camera_entity(entity_id)
                    public = getattr(entity, "_public", None)
                    camera_id = getattr(public, "id", None) or getattr(getattr(entity, "device", None), "id", None)
                    if not isinstance(camera_id, str) or not camera_id or len(camera_id) > 128 or not all(c.isalnum() or c in "_-" for c in camera_id):
                        result["message"] = "The HA Protect camera does not expose a supported gateway device identity"
                        continue
                    async with asyncio.timeout(15):
                        stage = "gateway_read_camera"
                        raw = await read_camera(f"cameras/{camera_id}", method="get")
                    info = raw.get("thirdPartyCameraInfo") if isinstance(raw, dict) else None
                    source = info.get("rtspUrl") if isinstance(info, dict) else None
                    if valid_camera_source(source):
                        unique_id = getattr(entity_entry, "unique_id", None)
                        if not isinstance(unique_id, str) or not unique_id:
                            result["message"] = "The HA camera has no stable registry identity; re-add the camera before pairing a direct stream"
                            continue
                        record.setdefault("camera_sources", {})[entity_id] = {"url": source, "entry_id": entry.entry_id, "unique_id": unique_id, "camera_id": camera_id}
                        changed = True
                        result["status"] = "prepared"
                    else:
                        stage = "source_lookup"
                        async with asyncio.timeout(10):
                            source = await camera.async_get_stream_source(self.hass, entity_id)
                        if valid_camera_source(source):
                            result["status"] = "ready"
                        else:
                            result["message"] = "The gateway has no valid direct RTSP connection for this camera and HA exposes no live stream"
                except Exception as err:
                    # Library errors can contain credential-bearing URLs; never
                    # reflect or log exception text from this provisioning path.
                    result["message"] = "The gateway could not read this camera connection; check HA Protect health and account permissions"
                    result["error_code"] = type(err).__name__[:64]
                    result["stage"] = stage
            if changed:
                await self.save()
            return {"results": results, "reloaded_entries": 0}

    @callback
    def cancel_schedules(self):
        if self.schedule_cancel is not None:
            self.schedule_cancel()
            self.schedule_cancel = None

    async def stop(self, event=None):
        self.active = False
        self.cancel_schedules()
        self.asset_cache.clear()
        for process in tuple(self.processes):
            await terminate(process)
        await self.save()


async def read_json(request):
    try:
        async with asyncio.timeout(5):
            body = bytearray()
            async for chunk in request.content.iter_chunked(8192):
                body.extend(chunk)
                if len(body) > MAX_JSON:
                    raise web.HTTPRequestEntityTooLarge(max_size=MAX_JSON, actual_size=len(body))
        result = json.loads(body)
        if not isinstance(result, dict):
            raise ValueError()
        return result
    except (ValueError, TimeoutError):
        raise web.HTTPBadRequest(text="Invalid JSON request") from None


class BaseView(HomeAssistantView):
    requires_auth = False  # Dedicated device token, never a Home Assistant account token.
    def __init__(self, hub):
        self.hub = hub


class PairView(BaseView):
    url = "/api/native_panel/pair"
    name = "api:native_panel:pair"
    async def post(self, request):
        self.hub.pairing_rate(request.remote or "unknown")
        try:
            return web.json_response(await self.hub.pair(await read_json(request)))
        except ValueError as err:
            return web.json_response({"error": str(err)}, status=400)


class SyncView(BaseView):
    url = "/api/native_panel/device/{device_id}/sync"
    name = "api:native_panel:sync"
    async def post(self, request, device_id):
        self.hub.authenticate(request, device_id)
        try:
            return web.json_response(await self.hub.sync(device_id, await read_json(request)))
        except ValueError as err:
            return web.json_response({"error": str(err)}, status=400)


class AssetView(BaseView):
    url = "/api/native_panel/device/{device_id}/asset/{asset_id}"
    name = "api:native_panel:asset"
    async def get(self, request, device_id, asset_id):
        self.hub.authenticate(request, device_id)
        values = request.query.getall("blur", [])
        if set(request.query) - {"blur"} or len(values) > 1 or values and values[0] not in {str(value) for value in range(21)}:
            raise web.HTTPBadRequest(text="Blur must be an integer from 0 to 20")
        blur = int(values[0]) if values else 0
        try:
            data = await self.hub.asset_bytes(device_id, asset_id, blur)
        except ValueError:
            raise web.HTTPNotFound() from None
        return web.Response(body=data, content_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


async def terminate(process):
    if process.returncode is None:
        with suppress(ProcessLookupError):
            process.terminate()
        try:
            await asyncio.wait_for(process.wait(), 2)
        except TimeoutError:
            with suppress(ProcessLookupError):
                process.kill()
            await process.wait()


class CameraView(BaseView):
    url = "/api/native_panel/device/{device_id}/camera/{entity_id}"
    name = "api:native_panel:camera"
    async def get(self, request, device_id, entity_id):
        record = self.hub.authenticate(request, device_id)
        if entity_id not in {e["entity_id"] for e in record["config"]["entities"] if e["entity_id"].startswith("camera.")}:
            raise web.HTTPForbidden()
        if device_id in self.hub.streaming or len(self.hub.streaming) >= 2:
            raise web.HTTPConflict(text="Camera stream already active or server stream limit reached")
        self.hub.streaming.add(device_id)
        process = None
        response = None
        try:
            source = self.hub.camera_source(record, entity_id)
            if not valid_camera_source(source):
                async with asyncio.timeout(10):
                    source = await camera.async_get_stream_source(self.hub.hass, entity_id)
            if not valid_camera_source(source):
                raise web.HTTPUnprocessableEntity(text="This HA camera does not expose a supported live stream source")
            args = [get_ffmpeg_manager(self.hub.hass).binary, "-nostdin", "-hide_banner", "-loglevel", "error"]
            if urlsplit(source).scheme.lower() == "rtsp":
                args += ["-rtsp_transport", "tcp"]
            args += ["-i", source, "-an", "-vf", "fps=8,scale=640:360:force_original_aspect_ratio=decrease", "-threads", "1", "-q:v", "5", "-f", "mpjpeg", "-boundary_tag", "frame", "pipe:1"]
            process = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, limit=65536)
            self.hub.processes.add(process)
            first = await asyncio.wait_for(process.stdout.read(16384), 15)
            if not first:
                raise web.HTTPBadGateway(text="Camera live source could not be decoded")
            response = web.StreamResponse(headers={"Content-Type": "multipart/x-mixed-replace; boundary=frame", "Cache-Control": "no-store", "X-Accel-Buffering": "no"})
            await response.prepare(request)
            await response.write(first)
            while request.transport is not None and not request.transport.is_closing():
                chunk = await asyncio.wait_for(process.stdout.read(16384), 15)
                if not chunk:
                    break
                await response.write(chunk)
            return response
        except (HomeAssistantError, ValueError, OSError, TimeoutError):
            if response is not None:
                return response
            raise web.HTTPBadGateway(text="Live camera unavailable; check camera stream and FFmpeg in HA") from None
        except (ConnectionError, asyncio.CancelledError):
            if response is not None:
                return response
            raise
        finally:
            if process is not None:
                await terminate(process)
                self.hub.processes.discard(process)
            self.hub.streaming.discard(device_id)


@websocket_api.websocket_command({"type": "native_panel/list"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_list(hass, connection, msg):
    connection.send_result(msg["id"], hass.data[DOMAIN].listing())


@websocket_api.websocket_command({"type": "native_panel/pair_code"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_pair(hass, connection, msg):
    try:
        connection.send_result(msg["id"], hass.data[DOMAIN].pair_code())
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_config", str(err))


@websocket_api.websocket_command({"type": "native_panel/save", "device_id": str, "config": dict})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass, connection, msg):
    try:
        connection.send_result(msg["id"], await hass.data[DOMAIN].configure(msg["device_id"], msg["config"]))
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_config", str(err))


@websocket_api.websocket_command({"type": "native_panel/upload", "device_id": str, "filename": str, "data": str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_upload(hass, connection, msg):
    try:
        connection.send_result(msg["id"], await hass.data[DOMAIN].upload(msg["device_id"], msg["filename"], msg["data"]))
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_photo", str(err))


@websocket_api.websocket_command({"type": "native_panel/assets", "device_id": str, "asset_ids": [str]})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_assets(hass, connection, msg):
    try:
        if len(msg["asset_ids"]) > 31:
            raise ValueError("Maximum 30 photos plus one background per export")
        hub = hass.data[DOMAIN]
        record = hub.record(msg["device_id"])
        assets = []
        total = 0
        for asset_id in dict.fromkeys(msg["asset_ids"]):
            data = await hub.asset_bytes(msg["device_id"], asset_id)
            total += len(data)
            if total > 6 * 1024 * 1024:
                raise ValueError("Export exceeds 6 MiB; export fewer photos")
            assets.append({"asset_id": asset_id, "filename": record["assets"][asset_id]["filename"], "data": base64.b64encode(data).decode("ascii")})
        connection.send_result(msg["id"], {"assets": assets})
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_photo", str(err))


@websocket_api.websocket_command({"type": "native_panel/prepare_cameras", "device_id": str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_prepare_cameras(hass, connection, msg):
    try:
        connection.send_result(msg["id"], await hass.data[DOMAIN].prepare_cameras(msg["device_id"]))
    except ValueError as err:
        connection.send_error(msg["id"], "camera_preparation_failed", str(err))


@websocket_api.websocket_command({"type": "native_panel/ack_alert", "device_id": str, "alert_id": str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ack_alert(hass, connection, msg):
    try:
        connection.send_result(msg["id"], await hass.data[DOMAIN].ack_alert(msg["device_id"], msg["alert_id"]))
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_alert", str(err))
