"""Finite local-time schedule definitions and an HA-owned minute edge runner."""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import re
from zoneinfo import ZoneInfo

SCHEDULE_DOMAINS = {"light", "switch", "fan", "cover", "climate"}
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
TIME_RE = re.compile(r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
DATE_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")


def normalize_schedule(raw):
    from .model import known_keys, text
    known_keys(raw, {"id", "name", "enabled", "kind", "weekdays", "start_date", "end_date", "on_time", "off_time"})
    sid = raw.get("id")
    if not isinstance(sid, str) or not ID_RE.fullmatch(sid): raise ValueError("Schedule ID must be 1–32 ASCII letters, digits, underscores or hyphens")
    name = text(raw.get("name"), 63)
    enabled = raw.get("enabled", True)
    if not isinstance(enabled, bool): raise ValueError("Schedule enabled must be boolean")
    kind = raw.get("kind")
    if not isinstance(kind, str) or kind not in {"weekly", "once", "range"}: raise ValueError("Unsupported schedule kind")
    weekdays = raw.get("weekdays", [])
    if not isinstance(weekdays, list) or len(weekdays) > 7 or any(type(day) is not int or not 0 <= day <= 6 for day in weekdays) or len(set(weekdays)) != len(weekdays):
        raise ValueError("Weekdays must be unique integers Monday 0 through Sunday 6")
    if kind != "once" and not weekdays: raise ValueError("Select at least one weekday")
    start, end = raw.get("start_date", ""), raw.get("end_date", "")
    if kind == "weekly":
        if start != "" or end != "": raise ValueError("Weekly schedules do not use dates")
    else:
        try:
            if not isinstance(start, str) or not isinstance(end, str) or not DATE_RE.fullmatch(start) or not DATE_RE.fullmatch(end): raise ValueError()
            first, last = date.fromisoformat(start), date.fromisoformat(end)
        except ValueError:
            raise ValueError("Use valid YYYY-MM-DD dates") from None
        if first > last or kind == "once" and first != last: raise ValueError("Once uses one date; range end must not precede start")
    on, off = raw.get("on_time"), raw.get("off_time")
    if not isinstance(on, str) or not isinstance(off, str) or not TIME_RE.fullmatch(on) or not TIME_RE.fullmatch(off) or on == off:
        raise ValueError("Use different on/off times in HH:MM format")
    return {"id": sid, "name": name, "enabled": enabled, "kind": kind, "weekdays": sorted(weekdays), "start_date": start, "end_date": end, "on_time": on, "off_time": off}


def schedule_eligible(entity_id, attributes):
    if not isinstance(entity_id, str): return False
    domain = entity_id.split(".")[0]
    if domain not in SCHEDULE_DOMAINS: return False
    if domain in {"light", "switch", "fan"}: return True
    flags = attributes.get("supported_features", 0)
    if isinstance(flags, bool) or not isinstance(flags, int) or flags < 0: return False
    required = 3 if domain == "cover" else 384
    return flags & required == required


def eligible_on_date(schedule, day):
    if not schedule.get("enabled", True): return False
    iso = day.isoformat()
    if schedule["kind"] == "once": return iso == schedule["start_date"]
    return day.weekday() in schedule["weekdays"] and (schedule["kind"] == "weekly" or schedule["start_date"] <= iso <= schedule["end_date"])


def due_edges(schedule, local_now):
    """Only this minute; overnight off belongs to the previous on date."""
    if not schedule.get("enabled", True): return []
    current = local_now.strftime("%H:%M")
    result = []
    if current == schedule["on_time"] and eligible_on_date(schedule, local_now.date()): result.append(("on", local_now.date()))
    if current == schedule["off_time"]:
        anchor = local_now.date() - timedelta(days=1 if schedule["off_time"] < schedule["on_time"] else 0)
        if eligible_on_date(schedule, anchor): result.append(("off", anchor))
    return result


def execution_plan(config):
    rules = sorted([{key: value for key, value in schedule.items() if key != "name"} for schedule in config.get("schedules", [])], key=lambda rule: rule["id"])
    bindings = sorted([[item["entity_id"], sorted(item["schedule_ids"])] for item in config["entities"] if item.get("schedule_ids")])
    return json.dumps({"schedules": rules, "bindings": bindings}, sort_keys=True, separators=(",", ":"))


def binding_plans(config):
    rules = {schedule["id"]: {key: value for key, value in schedule.items() if key != "name"} for schedule in config.get("schedules", [])}
    return {f"{sid}|{item['entity_id']}": json.dumps(rules[sid], sort_keys=True, separators=(",", ":")) for item in config["entities"] for sid in item.get("schedule_ids", []) if sid in rules}


def clock_metadata(hass):
    zone = getattr(hass.config, "time_zone", None) or "UTC"
    return {"time_zone": zone, "server_date": datetime.now(ZoneInfo(zone)).date().isoformat()}


class ScheduleEngine:
    def __init__(self, hub, clock=None):
        self.hub = hub
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.started_at = self.clock().timestamp()
        self.lock = asyncio.Lock()

    def current_minute(self, now):
        return self.clock().astimezone(now.tzinfo).replace(second=0, microsecond=0) == now.replace(second=0, microsecond=0)

    async def async_tick(self, now):
        """Called by HA's local-time minute helper, never by save or bind."""
        if now.tzinfo is None or not self.hub.active or self.lock.locked() or not self.current_minute(now) or self.started_at >= now.replace(second=0, microsecond=0).timestamp(): return
        async with self.lock:
            for device_id in list(self.hub.panels):
                config = self.hub.panels[device_id]["config"]
                candidates = [(item["entity_id"], schedule["id"], edge, anchor) for schedule in config.get("schedules", []) for edge, anchor in due_edges(schedule, now) for item in config["entities"] if schedule["id"] in item.get("schedule_ids", [])]
                for entity_id, sid, edge, anchor in candidates:
                    if not self.hub.active or not self.current_minute(now): return
                    async with self.hub.sync_locks.setdefault(device_id, asyncio.Lock()):
                        record = self.hub.record(device_id)
                        armed_after = record.get("schedule_armed_after", {}).get(f"{sid}|{entity_id}", record.get("schedule_changed_at", 0))
                        if armed_after >= now.replace(second=0, microsecond=0).timestamp(): continue
                        item = next((item for item in record["config"]["entities"] if item["entity_id"] == entity_id and sid in item.get("schedule_ids", [])), None)
                        schedule = next((schedule for schedule in record["config"].get("schedules", []) if schedule["id"] == sid), None)
                        if item is None or schedule is None or (edge, anchor) not in due_edges(schedule, now): continue
                        # A changed future wall time is a new edge; DST repeats
                        # of that same local date/time must never run twice.
                        key = hashlib.sha256(f"{anchor.isoformat()}|{sid}|{entity_id}|{edge}|{schedule[edge + '_time']}".encode()).hexdigest()
                        cutoff = (now.date() - timedelta(days=2)).isoformat()
                        receipts = record.setdefault("schedule_receipts", {})
                        receipts = record["schedule_receipts"] = {key: day for key, day in receipts.items() if day >= cutoff}
                        if key in receipts: continue
                        if len(receipts) >= 4096: continue
                        receipts[key] = anchor.isoformat()
                        await self.hub.save()
                        if not self.hub.active or not self.current_minute(now): return
                        state = self.hub.hass.states.get(entity_id)
                        if state is None or state.state in {"unknown", "unavailable"} or not schedule_eligible(entity_id, state.attributes): continue
                        from .model import action_service
                        command = ("open" if edge == "on" else "close") if entity_id.startswith("cover.") else edge
                        try:
                            domain, service, data = action_service(entity_id, command, attributes=dict(state.attributes))
                            if not self.hub.hass.services.has_service(domain, service): continue
                            async with asyncio.timeout(10):
                                await self.hub.hass.services.async_call(domain, service, data, blocking=True)
                        except Exception:
                            # Provider exceptions can carry sensitive text. A
                            # persisted attempted edge is never replayed.
                            continue
