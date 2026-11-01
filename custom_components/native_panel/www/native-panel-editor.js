/* Native Home Panel editor. No remote assets, telemetry, or build step. */
export const MODERN_BLUE_THEME=Object.freeze({background:"#0B1018",button:"#202A39",foreground:"#EEF3FA",accent:"#79B8EB",radius:18,border_width:0,button_style:"solid"});
export function modernBlueTheme(theme) { return {...theme,...MODERN_BLUE_THEME}; }
export function activeTileColor(accent,button) {
  return `#${[1,3,5].map(i=>Math.floor((parseInt(accent.slice(i,i+2),16)*100+parseInt(button.slice(i,i+2),16)*155)/255).toString(16).padStart(2,"0")).join("")}`;
}
export const DEFAULT_CONFIG = Object.freeze({
  schema: 1, name: "Home Panel",
  theme: {...MODERN_BLUE_THEME,glass_opacity:35,glass_blur:0,border_color:"#D1D7DC"},
  menu: {vertical: "rooms", side: "left", horizontal: "bottom"}, entities: [],
  screensaver: {mode: "off", idle_seconds: 60, interval_seconds: 30, photos: []},
  security: {alarm_entity: "", sensor_entities: []}, alerts: [], schedules: [],
});
const copy = value => JSON.parse(JSON.stringify(value));
const textBytes = value => new TextEncoder().encode(value).length;
const validText = (value,maximum) => typeof value==="string" && value.trim().length>0 && textBytes(value)<=maximum && !/[\u0000-\u001f]/.test(value);
export function defaultLabel(value,maximum=80) {
  let result="";
  for (const char of String(value||"").replace(/[\u0000-\u001f]/g," ").trim()) {
    if (textBytes(result+char)>maximum) break;
    result+=char;
  }
  return result;
}
export const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export function entitySystems(entity) { return [entity.system,...(Array.isArray(entity.additional_systems)?entity.additional_systems:[])]; }
export function setAdditionalSystems(config,entity,names) {
  if(!Array.isArray(names)||names.length>23||new Set(names).size!==names.length||names.includes(entity.system)||names.some(name=>!systemsForRoom(config,entity.room).includes(name)))throw new Error("Choose unique enabled systems linked to this room, excluding the primary system.");
  if(names.length)entity.additional_systems=[...names];else delete entity.additional_systems;
}
export function removeSystemAssignments(config,name,roomName="") {
  const removed=new Set();
  config.entities=config.entities.filter(entity=>{
    if(roomName&&entity.room!==roomName||!entitySystems(entity).includes(name))return true;
    const remaining=entitySystems(entity).filter(system=>system!==name);
    if(!remaining.length){removed.add(entity.entity_id);return false;}
    entity.system=remaining[0];if(remaining.length>1)entity.additional_systems=remaining.slice(1);else delete entity.additional_systems;return true;
  });
  if(removed.has(config.security.alarm_entity))config.security.alarm_entity="";
  return removed;
}
export function firmwareFeatureErrors(config,capabilities=[]) {
  const errors=[];
  if(config.menu?.show_all_systems===false&&!capabilities.includes("hide_all_systems"))errors.push("Update touchscreen firmware before hiding All systems. This draft stays saved locally.");
  if(config.entities?.some(entity=>entity.additional_systems?.length)&&!capabilities.includes("system_memberships"))errors.push("Update touchscreen firmware before using additional systems. This draft stays saved locally.");
  return errors;
}
export function normalizeConfig(value) {
  const base = copy(DEFAULT_CONFIG);
  value ||= {};
  const config={...base, ...copy(value), theme: {...base.theme, ...value.theme}, menu: {...base.menu, ...value.menu}, screensaver: {...base.screensaver, ...value.screensaver}, entities: copy(value.entities || []), security: {...base.security, ...copy(value.security || {})}, alerts: copy(value.alerts || []),schedules:copy(value.schedules||[])};
  if (!Object.hasOwn(value,"rooms") && !Object.hasOwn(value,"systems")) {
    config.systems=[...new Set(config.entities.flatMap(entitySystems))].map(name=>({name,persistent:false}));
    config.rooms=[...new Set(config.entities.map(e=>e.room))].map(name=>({name,systems:[...new Set(config.entities.filter(e=>e.room===name).flatMap(entitySystems))]}));
  }
  return config;
}
export function systemsForRoom(config,room) {
  const catalog=(Array.isArray(config.systems)?config.systems:[]).filter(s=>s&&s.enabled!==false);
  if(!room)return catalog.map(s=>s.name);
  const links=(Array.isArray(config.rooms)?config.rooms:[]).find(r=>r?.name===room)?.systems||[];
  const enabled=new Set(catalog.map(s=>s.name));
  return [...new Set([...links.filter(name=>enabled.has(name)),...catalog.filter(s=>s.persistent).map(s=>s.name)])];
}
const validRoomLabel=value=>validText(value,64)&&!/[\u007f-\u009f]/.test(value);
export function roomSystemLabel(config,roomName,name) {
  const labels=config.rooms?.find(room=>room.name===roomName)?.system_labels;
  return labels&&Object.hasOwn(labels,name)?labels[name]:name;
}
export function roomSystemCaption(config,roomName,name) {
  const label=roomSystemLabel(config,roomName,name);return label===name?name:`${label} (${name})`;
}
export function setRoomSystemLabel(config,roomName,name,value) {
  const room=config.rooms.find(room=>room.name===roomName);
  if(!room||!config.systems.some(system=>system.name===name))throw new Error("Choose an existing room and system.");
  if(value!==""&&!validRoomLabel(value))throw new Error("System labels need 1–64 UTF-8 bytes and no control characters.");
  if(value===""){if(room.system_labels){delete room.system_labels[name];if(!Object.keys(room.system_labels).length)delete room.system_labels;}}
  else room.system_labels={...room.system_labels,[name]:value.trim()};
}
export function moveRoomSystem(config,roomName,name,direction) {
  const room=config.rooms.find(r=>r.name===roomName);if(!room)return false;
  const order=systemsForRoom(config,roomName),index=order.indexOf(name),next=index+(direction==="up"?-1:direction==="down"?1:0);
  if(index<0||next===index||next<0||next>=order.length)return false;
  [order[index],order[next]]=[order[next],order[index]];room.systems=order;return true;
}
export function cycleSystem(values,selected,direction) {
  if(!values.length)return "";
  const index=Math.max(0,values.indexOf(selected));return values[((index+direction)%values.length+values.length)%values.length];
}
export function systemSwipeSteps(dx,dy) {
  return Math.abs(dx)>=28&&Math.abs(dx)>Math.abs(dy)?(dx<0?1:-1)*Math.max(1,Math.round(Math.abs(dx)/128)):0;
}
export function carouselSlots(values,selected,delta=0) {
  const index=Math.max(0,values.indexOf(selected)),count=values.length;
  return values.map((value,i)=>{let distance=i-index+(count<2?0:delta/128);while(distance>count/2)distance-=count;while(distance<-count/2)distance+=count;const depth=Math.abs(distance),width=Math.trunc(110-16*depth),height=Math.max(44,Math.trunc(66-8*depth)),center=Math.trunc(402+136*distance-8*distance*depth);return {value,distance,x:center-Math.trunc(width/2),y:4+Math.trunc(4*depth),width,height};}).filter(slot=>Math.abs(slot.distance)<=3.2);
}
export function wheelFacePath(width,height,distance) {
  const skew=Math.min(7,3+Math.abs(distance)*2),left=distance<0?skew:0,right=distance>0?skew:0,w=width-1,h=height-1;
  return `M6 ${left} L${w-6} ${right} Q${w} ${right} ${w} ${right+6} L${w} ${h-right-6} Q${w} ${h-right} ${w-6} ${h-right} L6 ${h-left} Q0 ${h-left} 0 ${h-left-6} L0 ${left+6} Q0 ${left} 6 ${left} Z`;
}
export function systemCatalog(config,sources) {
  const stored=(config.systems||[]).map((system,index)=>({...system,index,configured:true,enabled:system.enabled!==false})),names=new Set(stored.map(s=>s.name));
  for(const source of sources)if(validText(source.system,64)&&!names.has(source.system)){names.add(source.system);stored.push({name:source.system,persistent:false,enabled:false,configured:false});}
  return stored;
}
export function setSystemEnabled(config,sources,name,enabled) {
  if(typeof enabled!=="boolean")throw new Error("Choose whether the system is enabled.");
  const next=normalizeConfig(config),known=systemCatalog(next,sources).find(s=>s.name===name);if(!known)throw new Error("Choose an available system.");
  let system=next.systems.find(s=>s.name===name);
  if(!system){if(!enabled)return next;system={name,persistent:false,enabled:true};next.systems.push(system);}else system.enabled=enabled;
  if(!enabled) {
    const removed=removeSystemAssignments(next,name);
    for(const room of next.rooms)room.systems=room.systems.filter(s=>s!==name);
    if(removed.has(next.security.alarm_entity))next.security.alarm_entity="";
  }
  const errors=validateConfig(next,{draft:true});if(errors.length)throw new Error(errors.join(" "));return next;
}
export function roomWizardDefaults(config,sources,area) {
  const enabled=new Set((config.systems||[]).filter(s=>s.enabled!==false).map(s=>s.name)),matching=area?.area_id?sources.filter(e=>e.area_id===area.area_id):[],systems=[...new Set(matching.map(e=>e.system))].filter(name=>enabled.has(name)),assigned=new Set(config.entities.map(e=>e.entity_id));
  return {area_id:area?.area_id||"",name:area?.name||"",systems,entity_ids:[...new Set(matching.filter(e=>systems.includes(e.system)&&!assigned.has(e.entity_id)).map(e=>e.entity_id))],step:"choose"};
}
export function createRoomFromWizard(config,sources,wizard) {
  if(!wizard||typeof wizard.name!=="string"||typeof wizard.area_id!=="string"||!Array.isArray(wizard.systems)||!Array.isArray(wizard.entity_ids))throw new Error("Room setup is invalid. Restart the room setup and review its selections.");
  const next=normalizeConfig(config),name=wizard.name.trim(),systems=[...new Set(wizard.systems||[])];
  if(!validText(name,64))throw new Error("Enter a room name using 1–64 UTF-8 bytes.");
  if(next.rooms.some(r=>r.name===name))throw new Error("That room name already exists. Choose another name.");
  if(next.rooms.length>=32)throw new Error("A panel can have up to 32 rooms.");
  if(systems.some(name=>!next.systems.some(s=>s.name===name&&s.enabled!==false)))throw new Error("Enable the selected systems in Systems before using them in a new room.");
  next.rooms.push({name,...(wizard.area_id?{area_id:wizard.area_id}:{}),systems});
  const selected=[...new Set(wizard.entity_ids||[])];
  for(const id of selected) {
    const source=sources.find(e=>e.entity_id===id);if(!source)throw new Error("A selected HA entity is unavailable. Review the room selections.");
    if(wizard.area_id&&source.area_id!==wizard.area_id)throw new Error("A selected entity is outside this HA area. Review the room selections.");
    if(!systems.includes(source.system))throw new Error("Every selected device needs its detected system selected.");
    if(config.entities.some(e=>e.entity_id===id))throw new Error(`${source.name||id} is already assigned. Existing controls will not be moved automatically.`);
  }
  for(const system of systems){const ids=selected.filter(id=>sources.find(e=>e.entity_id===id)?.system===system);if(ids.length)addRoomEntities(next,sources,ids,name,system);}
  const errors=validateConfig(next,{draft:true});if(errors.length)throw new Error(errors.join(" "));return next;
}
export function addEntityAssignments(config,sources,ids,roomName,assignments) {
  const next=normalizeConfig(config),available=new Set(systemsForRoom(next,roomName)),selected=[...new Set(ids)];
  if(!selected.length)throw new Error("Choose at least one entity.");
  for(const id of selected){const system=assignments[id];if(!available.has(system))throw new Error("Choose an enabled, linked or persistent system for every selected entity.");addRoomEntities(next,sources,[id],roomName,system);}
  const errors=validateConfig(next,{draft:true});if(errors.length)throw new Error(errors.join(" "));return next;
}
export function reorderEntityInGroup(config,id,targetId,system) {
  const source=config.entities.find(e=>e.entity_id===id),target=config.entities.find(e=>e.entity_id===targetId);
  if(!source||!target||source.room!==target.room||!entitySystems(source).includes(system)||!entitySystems(target).includes(system)||id===targetId)return false;
  const slots=config.entities.map((e,i)=>e.room===source.room&&entitySystems(e).includes(system)?i:-1).filter(i=>i>=0),peers=slots.map(i=>config.entities[i]);
  const from=peers.indexOf(source),to=peers.indexOf(target);peers.splice(from,1);peers.splice(to,0,source);
  slots.forEach((slot,i)=>config.entities[slot]=peers[i]);return true;
}
export function moveEntityInGroup(config,index,direction,system=config.entities[index]?.system) {
  const entity=config.entities[index];if(!entity)return false;
  const peers=config.entities.filter(e=>e.room===entity.room&&entitySystems(e).includes(system)),target=peers[peers.indexOf(entity)+(direction==="up"?-1:1)];
  return target?reorderEntityInGroup(config,entity.entity_id,target.entity_id,system):false;
}
export function candidatesForRoom(candidates,room,scope,query="") {
  const search=query.trim().toLowerCase();
  return candidates.filter(e=>(scope!=="room" || Boolean(room?.area_id)&&e.area_id===room.area_id) && `${e.entity_id} ${e.name||""} ${e.room||""}`.toLowerCase().includes(search));
}
export function securityRoom(config,id,sources) {
  const assigned=config.entities.find(e=>e.entity_id===id);
  if(assigned)return assigned.room;
  const source=sources.find(e=>e.entity_id===id);
  return config.rooms?.find(r=>r.area_id&&r.area_id===source?.area_id)?.name || source?.room || "";
}
export function renameCatalog(config,kind,oldName,newName) {
  if(!validText(newName,64))throw new Error("Names need 1–64 UTF-8 bytes and no control characters.");
  if(config[kind].some(item=>item.name===newName&&item.name!==oldName))throw new Error("That name is already in use.");
  const item=config[kind].find(item=>item.name===oldName);if(!item)throw new Error("Selection no longer exists.");
  item.name=newName;
  for(const entity of config.entities)if(entity[kind==="rooms"?"room":"system"]===oldName)entity[kind==="rooms"?"room":"system"]=newName;
  if(kind==="systems")for(const entity of config.entities)if(entity.additional_systems)entity.additional_systems=entity.additional_systems.map(name=>name===oldName?newName:name);
  if(kind==="systems")for(const room of config.rooms){room.systems=room.systems.map(name=>name===oldName?newName:name);if(room.system_labels)room.system_labels=Object.fromEntries(Object.entries(room.system_labels).map(([name,label])=>[name===oldName?newName:name,label]));}
}
export function deletePanelRoom(config,name,mode,destination="") {
  const room=config.rooms.find(r=>r.name===name);
  if(!room)throw new Error("That room no longer exists. Select a room again.");
  const controls=config.entities.filter(e=>e.room===name);
  if(controls.length) {
    if(!["move","remove"].includes(mode))throw new Error("Choose whether to move this room's controls or remove their panel assignments.");
    if(mode==="move") {
      const target=config.rooms.find(r=>r.name===destination&&r.name!==name);
      if(!target)throw new Error("Choose another destination room before deleting this room.");
      target.systems=[...new Set([...target.systems,...room.systems,...controls.flatMap(entitySystems)])];
      if(room.system_labels)target.system_labels={...room.system_labels,...target.system_labels};
      for(const entity of controls)entity.room=target.name;
    } else {
      const removed=new Set(controls.map(e=>e.entity_id));
      config.entities=config.entities.filter(e=>e.room!==name);
      if(removed.has(config.security.alarm_entity))config.security.alarm_entity="";
    }
  }
  config.rooms=config.rooms.filter(r=>r!==room);
  return controls.length;
}
export function addRoomEntities(config,sources,ids,roomName,systemName) {
  const room=config.rooms.find(r=>r.name===roomName),system=config.systems.find(s=>s.name===systemName);
  if(!room||!system)throw new Error("Choose a room and system before adding controls.");
  if(system.enabled===false)throw new Error("Enable this system in Systems before assigning new controls.");
  const selected=[...new Set(ids)].map(id=>sources.find(e=>e.entity_id===id));
  if(!selected.length||selected.some(e=>!e))throw new Error("Choose available Home Assistant entities.");
  const conflicts=selected.filter(source=>config.entities.some(e=>e.entity_id===source.entity_id&&e.room!==roomName));
  if(conflicts.length)throw new Error(`${conflicts[0].name||conflicts[0].entity_id} is already assigned elsewhere. Move it using its Room and System fields first; an entity can belong to multiple systems within one room.`);
  const additions=selected.filter(source=>!config.entities.some(e=>e.entity_id===source.entity_id));
  if(config.entities.length+additions.length>64)throw new Error("A panel can have up to 64 control entities.");
  if(!room.systems.includes(systemName))room.systems.push(systemName);
  config.entities.push(...additions.map(source=>({...makeEntity(source),room:roomName,system:systemName})));
  for(const source of selected){const existing=config.entities.find(e=>e.entity_id===source.entity_id);if(!entitySystems(existing).includes(systemName))existing.additional_systems=[...(existing.additional_systems||[]),systemName];}
  const alarm=config.entities.find(e=>e.entity_id===config.security.alarm_entity);
  if(systemName==="Security"||alarm&&entitySystems(alarm).includes(systemName))config.security.sensor_entities=[...new Set([...config.security.sensor_entities,...selected.filter(e=>e.security_eligible===true).map(e=>e.entity_id)])];
}
export function createAlert(source, id) {
  const stableId = id || globalThis.crypto?.randomUUID?.() || `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  return {id:stableId,entity_id:source?.entity_id || "",label:defaultLabel(source?.name || source?.entity_id || "New alert"),condition:source?.entity_id?.startsWith("binary_sensor.") || source?.entity_id?.startsWith("cover.") ? "open" : "on",delay_seconds:0,enabled:true};
}
export function createSchedule(id) {
  return {id:id||`schedule-${globalThis.crypto?.randomUUID?.().replaceAll("-","").slice(0,22)||Math.random().toString(36).slice(2,14)}`,name:"New schedule",enabled:true,kind:"weekly",weekdays:[0,1,2,3,4],start_date:"",end_date:"",on_time:"08:00",off_time:"20:00"};
}
export function scheduleEligible(source) {
  const domain=source?.entity_id?.split(".")[0];
  if(!["light","switch","fan","cover","climate"].includes(domain))return false;
  if(typeof source?.schedule_eligible==="boolean")return source.schedule_eligible;
  if(["light","switch","fan"].includes(domain))return true;
  const features=Number(source?.attributes?.supported_features)||0;
  if(domain==="cover")return Boolean(features&1)&&Boolean(features&2);
  return domain==="climate"&&Boolean(features&128)&&Boolean(features&256);
}
export function validateSchedules(config) {
  const errors=[],rules=config.schedules||[],ids=new Set();
  if(!Array.isArray(rules)||rules.length>32)return ["Choose no more than 32 schedules."];
  const validDate=value=>{
    if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const [year,month,day]=value.split("-").map(Number),date=new Date(0);date.setUTCFullYear(year,month-1,day);
    return year>=1&&year<=9999&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
  };
  for(const rule of rules) {
    if(!rule||typeof rule!=="object"){errors.push("Every schedule must be a valid rule.");continue;}
    if(typeof rule.id!=="string"||!/^[a-zA-Z0-9_-]{1,32}$/.test(rule.id)||ids.has(rule.id))errors.push("Schedules need unique IDs of up to 32 letters, numbers, hyphens or underscores.");
    ids.add(rule.id);
    if(!validText(rule.name,63))errors.push("Schedule names need 1–63 UTF-8 bytes and no control characters.");
    if(typeof rule.enabled!=="boolean")errors.push("Schedule enabled must be on or off.");
    if(!["weekly","once","range"].includes(rule.kind))errors.push("Choose a weekly, once or date-range schedule.");
    if(!Array.isArray(rule.weekdays)||rule.weekdays.some(day=>!Number.isInteger(day)||day<0||day>6)||new Set(rule.weekdays).size!==rule.weekdays.length||rule.kind!=="once"&&!rule.weekdays.length)errors.push("Choose at least one weekday for weekly and date-range schedules.");
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.on_time||"")||!/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.off_time||"")||rule.on_time===rule.off_time)errors.push("Choose different on and off times in HH:MM format.");
    if(rule.kind==="weekly"&&(rule.start_date!==""||rule.end_date!==""))errors.push("Weekly schedules do not use dates.");
    if(rule.kind!=="weekly"&&(!validDate(rule.start_date)||!validDate(rule.end_date)||rule.end_date<rule.start_date||rule.kind==="once"&&rule.start_date!==rule.end_date))errors.push("Choose valid schedule dates; once uses one date and date ranges must end on or after the start.");
  }
  for(const entity of config.entities||[])if(entity.schedule_ids!==undefined) {
    const supported=["light","switch","fan","cover","climate"].includes(entity.entity_id?.split(".")[0]);
    if(!Array.isArray(entity.schedule_ids)||entity.schedule_ids.length>8||new Set(entity.schedule_ids).size!==entity.schedule_ids.length||entity.schedule_ids.some(id=>!ids.has(id))||entity.schedule_ids.length&&!supported)errors.push("Assign up to 8 existing schedules to supported lights, switches, fans, covers or climate controls only.");
  }
  return [...new Set(errors)];
}
export function describeCapabilities(entity, state) {
  const domain = entity.entity_id.split(".")[0], a = state?.attributes || entity.attributes || {}, features = Number(a.supported_features) || 0;
  const has = bit => Boolean(features & bit), modes = a.supported_color_modes || [];
  if (domain === "fan") return ["On / off",has(1)?"Speed percentage":null,has(8)&&a.preset_modes?.length?`Presets: ${a.preset_modes.join(", ")}`:null,has(2)?"Oscillation":null,has(4)?"Direction":null].filter(Boolean);
  if (domain === "light") return ["On / off",modes.some(m=>!["onoff","unknown"].includes(m))?"Brightness":null,modes.some(m=>["hs","xy","rgb","rgbw","rgbww"].includes(m))?"Colour":null,modes.includes("color_temp")?`Colour temperature${a.min_color_temp_kelvin&&a.max_color_temp_kelvin?`: ${a.min_color_temp_kelvin}–${a.max_color_temp_kelvin} K`:""}`:null].filter(Boolean);
  if (domain === "climate") return [a.hvac_modes?.length?`Modes: ${a.hvac_modes.join(", ")}`:null,has(1)?`Target temperature${a.min_temp!==undefined&&a.max_temp!==undefined?`: ${a.min_temp}–${a.max_temp}°`:""}`:null,has(2)?"Low / high temperature range":null,has(8)&&a.fan_modes?.length?`Fan modes: ${a.fan_modes.join(", ")}`:null,has(16)&&a.preset_modes?.length?`Presets: ${a.preset_modes.join(", ")}`:null].filter(Boolean);
  if (domain === "alarm_control_panel") return ["Alarm state",has(1)?"Arm home":null,has(2)?"Arm away":null,has(4)?"Arm night":null,has(32)?"Arm vacation":null,has(16)?"Arm custom bypass":null,"Disarm (PIN if required)"].filter(Boolean);
  if (domain === "cover") return [has(1)?"Open":null,has(2)?"Close":null,has(8)?"Stop":null,has(4)?"Position":null].filter(Boolean);
  if (["sensor","binary_sensor"].includes(domain)) return ["Read-only status"];
  return ["State", "Home Assistant supported actions"];
}
export function systemFor(domain) {
  return ({light:"Lights",switch:"Switches",climate:"Climate",cover:"Covers",lock:"Security",alarm_control_panel:"Security",camera:"Cameras",fan:"Fans",scene:"Scenes",script:"Scenes",sensor:"Sensors",binary_sensor:"Sensors"})[domain] || "Other";
}
export function makeEntity(source) {
  return {entity_id: source.entity_id, label: defaultLabel(source.name || source.entity_id), room: defaultLabel(source.room || "Unassigned",64), system: defaultLabel(source.system || systemFor(source.domain || source.entity_id.split(".")[0]),64)};
}
export function wizardEntities(sources, selectedIds, previous = []) {
  const ids = new Set(selectedIds), existing = new Map(previous.map(e => [e.entity_id, e]));
  return sources.filter(e => ids.has(e.entity_id)).map(e => copy(existing.get(e.entity_id) || makeEntity(e)));
}
export function filterEntities(entities, room, system) {
  return entities.filter(e => (!room || e.room === room) && (!system || entitySystems(e).includes(system)));
}
export function securityCandidates(entities) { return entities.filter(entity=>entity.security_eligible===true); }
export function securitySensorGrid(count) {
  const columns=count<=6?1:2,rows=Math.max(1,Math.ceil(Math.min(count,16)/columns)),step=Math.floor((count>12?304:234)/rows),font=count<=4?20:14;
  return {columns,rows,step,font,columnWidth:columns===1?384:187,badgeWidth:columns===1?128:80,nameHeight:Math.min(step-4,font===20?44:32),stateHeight:Math.min(30,step-6)};
}
export function previewGeometry(menu) {
  const right=menu.side==="right",top=menu.horizontal==="top";
  return {railX:right?804:0,rowX:right?0:220,rowY:top?0:522,bodyX:right?20:240,bodyY:top?154:82,nameY:top?88:18,statusY:top?120:49};
}
export function adaptiveGrid(count) {
  const columns=count<=4?2:count<=6?3:count<=8?4:5,rows=2,width=count<=4?369:count<=6?209:count<=8?179:141,height=count<=4?209:width;
  return {columns,rows,width,height,stepX:width+10,stepY:height+10,pageSize:10};
}
export function layoutControlPages(entities) {
  const climates=entities.filter(e=>e.entity_id.startsWith("climate.")),others=entities.filter(e=>!e.entity_id.startsWith("climate.")),pages=[];
  let consumed=0;
  for(const climate of climates) {
    const neighbors=others.slice(consumed,consumed+6);consumed+=neighbors.length;
    const count=neighbors.length,columns=count<=2?1:2,size=count<=2?209:count<=4?179:136,width=count<=2?369:size,offset=Math.floor((369-(columns*width+(columns-1)*10))/2);
    pages.push([{entity:climate,x:0,y:0,width:369,height:430,featured:true},...neighbors.map((entity,i)=>({entity,x:379+offset+(i%columns)*(width+10),y:Math.floor(i/columns)*(size+10),width,height:size,featured:false}))]);
  }
  const remaining=others.slice(consumed);
  for(let offset=0;offset<remaining.length;offset+=10) {
    const chunk=remaining.slice(offset,offset+10),grid=adaptiveGrid(chunk.length),left=Math.floor((748-(grid.columns*grid.width+(grid.columns-1)*10))/2);
    pages.push(chunk.map((entity,i)=>({entity,x:left+(i%grid.columns)*grid.stepX,y:Math.floor(i/grid.columns)*grid.stepY,width:grid.width,height:grid.height,featured:false})));
  }
  return pages;
}
const DELAY_FACTORS = Object.freeze({seconds:1,minutes:60,hours:3600});
export function parseAlertDelay(amount,unit) {
  if (!Object.hasOwn(DELAY_FACTORS,unit)) throw new Error("Choose Seconds, Minutes or Hours.");
  const text=String(amount).trim();
  if (text.length>32 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error("Enter a non-negative delay amount.");
  const [whole,fraction=""]=text.split("."), scale=10n**BigInt(fraction.length);
  const numerator=BigInt(`${whole||"0"}${fraction}`)*BigInt(DELAY_FACTORS[unit]);
  const exact=Number(numerator)/Number(scale),seconds=Math.round(exact);
  const tolerance=Number.EPSILON*Math.max(1,Math.abs(exact))*8;
  if (numerator%scale!==0n && (seconds===0 || Math.abs(exact-seconds)>tolerance)) throw new Error("Delay must resolve to a whole number of seconds; use Seconds for finer timing.");
  if (seconds>86400) throw new Error("Delay cannot exceed 24 hours (86400 seconds).");
  return seconds;
}
export function delayPresentation(seconds,preferredUnit) {
  if (!Number.isInteger(seconds) || seconds<0 || seconds>86400) throw new Error("Delay must be a whole number of seconds from 0 to 86400.");
  if (preferredUnit!==undefined && !Object.hasOwn(DELAY_FACTORS,preferredUnit)) throw new Error("Choose Seconds, Minutes or Hours.");
  const unit=preferredUnit || (seconds>=3600&&seconds%3600===0?"hours":seconds>=60&&seconds%60===0?"minutes":"seconds");
  // This amount is presentation only; switching units never rewrites canonical seconds.
  return {unit,amount:String(seconds/DELAY_FACTORS[unit])};
}
export function contrastRatio(a,b) {
  const luminance = hex => {
    if (!/^#[\da-f]{6}$/i.test(hex || "")) return NaN;
    const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
    return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  };
  const l1=luminance(a),l2=luminance(b); return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
}
export function validateConfig(config,{draft=false}={}) {
  const errors = [];
  if (config.schema !== 1) errors.push("Unsupported configuration version.");
  if (!validText(config.name,63)) errors.push("Panel name must contain 1–63 UTF-8 bytes and no control characters.");
  for (const key of ["background", "foreground", "accent", "button", "border_color"])
    if (!/^#[\da-f]{6}$/i.test(config.theme?.[key] || "")) errors.push(`Choose a valid ${key} colour.`);
  if (contrastRatio(config.theme?.foreground,config.theme?.background) < 4.5 || contrastRatio(config.theme?.foreground,config.theme?.button) < 4.5) errors.push("Text needs stronger contrast against the background and button surface (at least 4.5:1).");
  if (contrastRatio("#08090A",config.theme?.accent) < 4.5) errors.push("Choose a brighter selected-control colour so its dark label stays readable.");
  if (!Number.isInteger(config.theme?.radius) || config.theme.radius < 0 || config.theme.radius > 32) errors.push("Button radius must be 0–32.");
  if (!["solid","glass"].includes(config.theme?.button_style)) errors.push("Choose Solid or Glass button style.");
  if (!Number.isInteger(config.theme?.glass_opacity) || config.theme.glass_opacity<0 || config.theme.glass_opacity>100) errors.push("Glass opacity must be an integer from 0 to 100 percent.");
  if (!Number.isInteger(config.theme?.glass_blur) || config.theme.glass_blur<0 || config.theme.glass_blur>20) errors.push("Glass frost must be an integer from 0 to 20.");
  if (![0,1].includes(config.theme?.border_width)) errors.push("Button borders must be off (0) or on (1).");
  if (!["rooms","systems"].includes(config.menu?.vertical) || !["left","right"].includes(config.menu?.side) || !["top","bottom"].includes(config.menu?.horizontal)) errors.push("Choose supported menu positions.");
  for(const option of ["show_all_rooms","show_all_systems"])if(Object.hasOwn(config.menu||{},option)&&typeof config.menu[option]!=="boolean")errors.push("Show All rooms/systems must be on or off.");
  if (!Array.isArray(config.entities) || config.entities.length > 64) errors.push("Choose no more than 64 control entities.");
  if(Object.hasOwn(config,"rooms")||Object.hasOwn(config,"systems")) {
    if(!Array.isArray(config.rooms)||config.rooms.length>32||!Array.isArray(config.systems)||config.systems.length>24)errors.push("Use at most 32 rooms and 24 systems.");
    for(const kind of ["rooms","systems"]) {
      const entries=Array.isArray(config[kind])?config[kind]:[];
      if(entries.some(item=>!item||!validText(item.name,64))||new Set(entries.map(item=>item?.name)).size!==entries.length)errors.push("Room and system names must be unique and contain 1–64 UTF-8 bytes.");
    }
    const systemList=Array.isArray(config.systems)?config.systems:[],roomList=Array.isArray(config.rooms)?config.rooms:[],systems=new Set(systemList.map(s=>s?.name));
    if(systemList.some(s=>typeof s?.persistent!=="boolean"))errors.push("Choose whether each system is persistent.");
    if(systemList.some(s=>s?.enabled!==undefined&&typeof s.enabled!=="boolean"))errors.push("System enabled must be on or off.");
    const disabled=new Set(systemList.filter(s=>s?.enabled===false).map(s=>s.name));
    if(roomList.some(r=>r?.systems?.some?.(name=>disabled.has(name)))||(config.entities||[]).some(e=>entitySystems(e).some(name=>disabled.has(name))))errors.push("Disabled systems cannot have room links or panel controls.");
    if(roomList.some(r=>!r||!Array.isArray(r.systems)||r.systems.some(name=>!systems.has(name))||new Set(r.systems).size!==r.systems.length||r.area_id!==undefined&&(typeof r.area_id!=="string"||r.area_id!==""&&!/^[a-zA-Z0-9_-]{1,64}$/.test(r.area_id))))errors.push("Rooms need valid system links and an optional HA area ID.");
    for(const room of roomList)if(room&&Object.hasOwn(room,"system_labels")) {
      const labels=room.system_labels;
      if(!labels||typeof labels!=="object"||Array.isArray(labels)||Object.keys(labels).length>24||Object.entries(labels).some(([name,label])=>!systems.has(name)||!validRoomLabel(label)))errors.push("Room system labels need existing system keys and 1–64 UTF-8 byte labels.");
    }
    if((config.entities||[]).some(e=>!roomList.some(r=>r?.name===e.room)||entitySystems(e).some(name=>!systems.has(name)||!systemsForRoom(config,e.room).includes(name))))errors.push("Every control needs an existing room and a linked or persistent system.");
  }
  const ids = new Set();
  for (const e of config.entities || []) {
    if (typeof e.entity_id !== "string" || e.entity_id.length>255 || !/^[a-z_]+\.[a-z0-9_]+$/.test(e.entity_id) || ids.has(e.entity_id)) errors.push("Each entity must have a unique Home Assistant ID of at most 255 characters.");
    ids.add(e.entity_id);
    if(Object.hasOwn(e,"additional_systems")&&(!Array.isArray(e.additional_systems)||e.additional_systems.length>23||new Set(e.additional_systems).size!==e.additional_systems.length||e.additional_systems.includes(e.system)||e.additional_systems.some(name=>!validText(name,64))))errors.push("Additional systems must be up to 23 unique valid names excluding the primary system.");
    if (!validText(e.label,80) || !validText(e.room,64) || !validText(e.system,64)) errors.push("Each entity needs a label (up to 80 UTF-8 bytes), room and system (up to 64 bytes), with no control characters.");
  }
  const saver = config.screensaver;
  if (!["off","photos"].includes(saver?.mode)) errors.push("Choose a supported screensaver mode.");
  if (!Number.isInteger(saver?.idle_seconds) || saver.idle_seconds < 15 || saver.idle_seconds > 3600) errors.push("Screensaver delay must be 15–3600 seconds.");
  if (!Number.isInteger(saver?.interval_seconds) || saver.interval_seconds < 5 || saver.interval_seconds > 3600) errors.push("Photo interval must be 5–3600 seconds.");
  if (!Array.isArray(saver?.photos) || saver.photos.length > 20) errors.push("Choose no more than 20 screensaver photos.");
  if (saver?.mode === "photos" && !saver.photos?.length) errors.push("Upload a photo before enabling the photo screensaver.");
  const security = config.security || {alarm_entity:"",sensor_entities:[]};
  if (typeof security.alarm_entity!=="string" || security.alarm_entity && (security.alarm_entity.length>255 || !/^alarm_control_panel\.[a-z0-9_]+$/.test(security.alarm_entity) || !draft&&!ids.has(security.alarm_entity))) errors.push("Selected alarm must be included in Rooms. In Security, add it to a room or choose No alarm selected before publishing.");
  if (!Array.isArray(security.sensor_entities) || security.sensor_entities.length > 64 || security.sensor_entities.some(id=>typeof id!=="string" || id.length>255 || !/^(binary_sensor|cover)\.[a-z0-9_]+$/.test(id)) || new Set(security.sensor_entities).size!==security.sensor_entities.length) errors.push("Security statuses must be up to 64 unique binary sensors or covers.");
  const alertIds = new Set();
  if (!Array.isArray(config.alerts || []) || config.alerts?.length > 32) errors.push("Choose no more than 32 alert rules.");
  for (const alert of Array.isArray(config.alerts)?config.alerts:[]) {
    if (!alert || typeof alert!=="object") { errors.push("Every alert must be a valid rule."); continue; }
    if (typeof alert.id!=="string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(alert.id) || alertIds.has(alert.id)) errors.push("Each alert needs a unique stable ID.");
    alertIds.add(alert.id);
    if (typeof alert.entity_id!=="string" || alert.entity_id.length>255 || !/^[a-z_]+\.[a-z0-9_]+$/.test(alert.entity_id)) errors.push("Choose a target entity for every alert (ID up to 255 characters).");
    if (!validText(alert.label,80)) errors.push("Alert labels must contain 1–80 UTF-8 bytes and no control characters.");
    if (!["open","on","off","unavailable"].includes(alert.condition)) errors.push("Choose a supported alert condition.");
    if (alert.condition==="open" && typeof alert.entity_id==="string" && !/^(binary_sensor|cover)\./.test(alert.entity_id)) errors.push("The Open condition needs a binary sensor or cover. Use On, Off or Unavailable for other entities.");
    if (!Number.isInteger(alert.delay_seconds) || alert.delay_seconds<0 || alert.delay_seconds>86400) errors.push("Alert delay must be 0–86400 seconds.");
    if (typeof alert.enabled!=="boolean") errors.push("Alert enabled must be on or off.");
  }
  return [...new Set([...errors,...validateSchedules(config)])];
}
export function validateThemePackage(value) {
  if (!value || value.format !== "native-panel-theme" || value.version !== 1) throw new Error("This is not a Native Home Panel theme package (version 1).");
  const keys = Object.keys(value.theme || {});
  if (keys.some(k => !["background","foreground","accent","button","radius","background_asset","button_style","glass_opacity","glass_blur","border_color","border_width"].includes(k))) throw new Error("Theme includes unsupported style settings.");
  const config = normalizeConfig({theme: value.theme, screensaver: value.screensaver || DEFAULT_CONFIG.screensaver});
  const errors = validateConfig(config);
  if (errors.length) throw new Error(errors.join(" "));
  if (!Array.isArray(value.assets) || value.assets.length > 21) throw new Error("Theme must contain an assets list with at most 21 images.");
  const ids = new Set();
  let bytes = 0;
  for (const asset of value.assets) {
    if (!asset || typeof asset.asset_id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(asset.asset_id) || ids.has(asset.asset_id)) throw new Error("Theme has an invalid or duplicate image ID.");
    ids.add(asset.asset_id);
    if (typeof asset.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data) || asset.data.length % 4 !== 0 || !asset.data.length) throw new Error("Theme contains invalid image data.");
    bytes += asset.data.length;
  }
  if (bytes > 12 * 1024 * 1024) throw new Error("Theme images exceed the 12 MB package limit.");
  const referenced = [config.theme.background_asset, ...config.screensaver.photos].filter(Boolean);
  if (referenced.some(id => !ids.has(id))) throw new Error("Theme is missing one or more referenced images.");
  return {theme: copy(config.theme), screensaver: copy(config.screensaver), assets: copy(value.assets)};
}


// Enable/link only the systems explicitly included in a reviewed room operation.
export function prepareRoomSystems(config,names,roomName="") {
  const next=normalizeConfig(config);
  for(const name of [...new Set(names)]) {
    if(!validText(name,64))throw new Error("Enter a valid system name using 1–64 UTF-8 bytes.");
    let system=next.systems.find(item=>item.name===name);
    if(system)system.enabled=true;
    else {if(next.systems.length>=24)throw new Error("A panel can have up to 24 systems.");next.systems.push({name,enabled:true,persistent:false});}
    if(roomName){const room=next.rooms.find(item=>item.name===roomName);if(!room)throw new Error("Choose a room first.");if(!room.systems.includes(name))room.systems.push(name);}
  }
  return next;
}
export function createReviewedRoom(config,sources,wizard) {
  return createRoomFromWizard(prepareRoomSystems(config,wizard.systems),sources,wizard);
}
export function addReviewedControls(config,sources,ids,roomName,assignments) {
  const names=[...new Set(ids.map(id=>assignments[id]))];
  if(names.some(name=>!systemCatalog(config,sources).some(system=>system.name===name)))throw new Error("Choose an available system for each control.");
  return addEntityAssignments(prepareRoomSystems(config,names,roomName),sources,ids,roomName,assignments);
}
export function setEntityMemberships(config,id,names) {
  const entity=config.entities.find(item=>item.entity_id===id);
  if(!entity||!Array.isArray(names)||!names.length||new Set(names).size!==names.length||names.some(name=>!systemsForRoom(config,entity.room).includes(name)))throw new Error("Keep at least one enabled system selected. Use Remove from room to remove the control.");
  const primary=names.includes(entity.system)?entity.system:names[0];
  entity.system=primary;setAdditionalSystems(config,entity,names.filter(name=>name!==primary));
}
export function removeEntityPlacement(config,id,system) {
  const entity=config.entities.find(item=>item.entity_id===id);if(!entity)return;
  const remaining=entitySystems(entity).filter(name=>name!==system);
  if(remaining.length)setEntityMemberships(config,id,remaining);
  else {config.entities=config.entities.filter(item=>item!==entity);if(config.security.alarm_entity===id)config.security.alarm_entity="";}
}
export function configurationChanges(before,after) {
  const lines=[];
  for(const [key,label,id] of [["rooms","Room","name"],["systems","System","name"],["entities","Control","entity_id"]]) {
    const old=new Map((before[key]||[]).map(item=>[item[id],item])),current=new Map((after[key]||[]).map(item=>[item[id],item]));
    for(const [name,item] of current)if(!old.has(name))lines.push(`${label} added: ${item.label||name}`);else if(JSON.stringify(item)!==JSON.stringify(old.get(name)))lines.push(`${label} updated: ${item.label||name}`);
    for(const [name,item] of old)if(!current.has(name))lines.push(`${label} removed: ${item.label||name}`);
    if([...old.keys()].join("\n")!==[...current.keys()].join("\n")&&old.size===current.size&&[...old.keys()].every(name=>current.has(name)))lines.push(`${label} order changed`);
  }
  for(const key of ["name","menu","theme","security","alerts","schedules","screensaver"])if(JSON.stringify(before[key])!==JSON.stringify(after[key]))lines.push(`${key==="menu"?"Layout":key[0].toUpperCase()+key.slice(1)} updated`);
  return lines;
}

const BaseElement = globalThis.HTMLElement || class {};
export class NativePanelEditor extends BaseElement {
  constructor() {
    super();
    if (!this.attachShadow) return;
    this.attachShadow({mode:"open"});
    this._data = {panels:[],entities:[],areas:[]};
    this._config = normalizeConfig(); this._tab = "controls"; this._dirty = false;
    this._selected = ""; this._error = ""; this._notice = ""; this._busy = false;
    this._room = ""; this._system = ""; this._assetCache = new Map(); this._wizardSelection = new Set();
    this._pair = null; this._search = ""; this._wizardRoom = ""; this._securitySearch = ""; this._delayDrafts = new Map();
    this._builderRoom="";this._builderSystem="";this._builderScope="all";this._builderSelection=new Set();
    this._builderAssignments={};this._roomWizard=null;this._systemDisable=null;this._systemAdd=null;this._systemEditing="";this._groupOpen={};this._editingEntity="";this._editingSystem="";this._inspector="preview";this._pickerOpen=false;this._roomOptions=false;this._roomSystemAdd=false;this._reviewOpen=false;
    this.shadowRoot.addEventListener("click", e => this._click(e));
    this.shadowRoot.addEventListener("change", e => this._change(e));
    this.shadowRoot.addEventListener("pointerdown",e=>{const handle=e.target.closest("[data-drag-entity]");if(!handle||e.button!==0)return;this._dragEntity={id:handle.dataset.dragEntity,system:handle.dataset.system,room:this._builderRoom,x:e.clientX,y:e.clientY,pointer:e.pointerId};handle.setPointerCapture(e.pointerId);});
    this.shadowRoot.addEventListener("pointermove",e=>{const drag=this._dragEntity;if(!drag||drag.pointer!==e.pointerId)return;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<8&&!drag.moved)return;drag.moved=true;e.preventDefault();this.shadowRoot.querySelectorAll(".reorder-target").forEach(row=>row.classList.remove("reorder-target"));const row=this.shadowRoot.elementFromPoint(e.clientX,e.clientY)?.closest("[data-reorder-entity]");if(row?.dataset.system===drag.system&&drag.room===this._builderRoom)row.classList.add("reorder-target");});
    this.shadowRoot.addEventListener("pointerup",e=>{const drag=this._dragEntity;if(!drag||drag.pointer!==e.pointerId)return;this._dragEntity=null;this.shadowRoot.querySelectorAll(".reorder-target").forEach(row=>row.classList.remove("reorder-target"));if(!drag.moved)return;e.preventDefault();const row=this.shadowRoot.elementFromPoint(e.clientX,e.clientY)?.closest("[data-reorder-entity]");if(row&&drag.room===this._builderRoom&&row.dataset.system===drag.system&&reorderEntityInGroup(this._config,drag.id,row.dataset.reorderEntity,drag.system)){this._previewPage=0;this._mark();}});
    this.shadowRoot.addEventListener("pointercancel",()=>{this._dragEntity=null;this.shadowRoot.querySelectorAll(".reorder-target").forEach(row=>row.classList.remove("reorder-target"));});
    this.shadowRoot.addEventListener("toggle",e=>{if(e.target.dataset.controlGroup!==undefined){this._groupOpen[e.target.dataset.controlGroup]=e.target.open;this._saveDraft();}},{capture:true});
    this.shadowRoot.addEventListener("wheel", e => {
      const menu=e.target.closest(".native-row");
      if(menu?.classList.contains("native-carousel")) {
        if(e.ctrlKey)return;e.preventDefault();
        const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
        if(delta&&Date.now()-(this._carouselWheelAt||0)>140){this._carouselWheelAt=Date.now();this._cyclePreviewAxis(delta<0?-1:1);}return;
      }
      if(!menu||Math.abs(e.deltaX)>=Math.abs(e.deltaY)||e.ctrlKey)return;
      const delta=e.deltaY*(e.deltaMode===1?20:e.deltaMode===2?menu.clientWidth:1);
      if((delta>0&&menu.scrollLeft<menu.scrollWidth-menu.clientWidth)||(delta<0&&menu.scrollLeft>0)) {
        menu.scrollLeft+=delta;e.preventDefault();
      }
    },{passive:false});
    this.shadowRoot.addEventListener("pointerdown",e=>{const menu=e.target.closest(".native-carousel");if(menu&&e.isPrimary!==false){this._carouselGesture={id:e.pointerId,x:e.clientX,y:e.clientY};}});
    this.shadowRoot.addEventListener("pointermove",e=>{const gesture=this._carouselGesture;if(!gesture||gesture.id!==e.pointerId)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>=8){gesture.moved=true;e.preventDefault();this._updatePreviewWheel(dx);}});
    this.shadowRoot.addEventListener("pointerup",e=>{const gesture=this._carouselGesture;this._carouselGesture=null;if(!gesture||gesture.id!==e.pointerId)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;const steps=systemSwipeSteps(dx,dy);if(steps){this._carouselClickUntil=Date.now()+350;e.preventDefault();this._cyclePreviewAxis(steps);}else if(gesture.moved)this._render();});
    this.shadowRoot.addEventListener("pointercancel",()=>{const gesture=this._carouselGesture;this._carouselGesture=null;if(gesture?.moved)this._render();});
    this.shadowRoot.addEventListener("keydown",e=>{if(e.target.closest(".native-carousel")&&["ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();this._cyclePreviewAxis(e.key==="ArrowLeft"?-1:1);}});
    this.shadowRoot.addEventListener("input", e => {
      if(e.target.dataset.roomSystemLabel!==undefined){
        try{setRoomSystemLabel(this._config,this._builderRoom,e.target.dataset.roomSystemLabel,e.target.value);this._dirty=true;this._error="";this._updateLiveStates();this._updateDraftStatus();}catch(error){this._error=error.message;this._render();}
      }
      else if(e.target.id==="room-system-name"){this._roomSystemName=e.target.value;this._saveDraft();}
      else if(e.target.id==="new-system-name"&&this._systemAdd){this._systemAdd.name=e.target.value;this._saveDraft();}
      else if(e.target.id==="new-room-name"&&this._roomWizard){this._roomWizard.name=e.target.value;this._roomWizard.step="choose";this._saveDraft();}
      else if (e.target.id === "entity-search") { this._queueCandidateSearch(e.target.value);this._saveDraft(); }
      else if (e.target.id === "security-search") { this._securitySearch = e.target.value; this._renderSecuritySensors(); }
      else if (e.target.dataset.delayAmount!==undefined) {
        this._storeDelayAmount(e.target); this._dirty=true; this._updateDraftStatus();
      }
      else if (e.target.dataset.scheduleField) {this._storeScheduleField(e.target);this._dirty=true;this._updateDraftStatus();}
      else if (e.target.dataset.field || e.target.dataset.entityField || e.target.dataset.alertField) {
        this._storeField(e.target); this._dirty = true; this._updateLiveStates();
        this._updateDraftStatus();
        const output=this.shadowRoot.querySelector(`[data-theme-output="${e.target.dataset.field}"]`);
        if (output) output.textContent=e.target.value;
      }
    });
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._loaded && this.isConnected) this._load();
    else if (this._loaded) this._updateLiveStates();
  }
  connectedCallback() { this._render(); if (this._hass && !this._loaded) this._load(); }
  disconnectedCallback() { this._resize?.disconnect(); clearInterval(this._pairTimer);clearTimeout(this._candidateTimer); }
  async _call(type, args = {}) {
    if (!this._hass?.callWS) throw new Error("Connect to Home Assistant to configure a panel.");
    return this._hass.callWS({type:`native_panel/${type}`,...args});
  }
  async _run(fn, notice = "") {
    if (this._busy) return;
    this._busy = true; this._error = ""; this._notice = ""; this._render();
    try { await fn(); if (notice) this._notice = notice; }
    catch (e) { this._error = e?.message || String(e); }
    finally { this._busy = false; this._saveDraft(); this._render(); }
  }
  async _load() {
    await this._run(async () => {
      this._data = await this._call("list"); this._loaded = true;
      if (!this._selected && this._data.panels.length) this._selectPanel(this._data.panels[0].device_id);
      else if(!this._dirty&&this._selected)this._selectPanel(this._selected);
      await this._loadBackground();
    });
  }
  _draftKey() {return `native-panel:draft:${this._hass?.user?.id||"local"}:${this._selected}`;}
  _hasWorkflowDraft(){return Boolean(this._roomWizard||this._systemDisable||this._systemAdd||this._roomSystemAdd||this._builderSelection?.size||Object.keys(this._builderAssignments||{}).length);}
  _saveDraft() {
    if(!this._selected)return;
    if(!this._dirty&&!this._hasWorkflowDraft()){if(!this._pendingDraft)this._clearDraft();return;}
    try {
      if(!globalThis.localStorage)throw new Error();
      this._captureOpenGroups();
      localStorage.setItem(this._draftKey(),JSON.stringify({revision:this._baseRevision,config:this._config,dirty:this._dirty,tab:this._tab,room:this._builderRoom,builderSystem:this._builderSystem,previewRoom:this._room,previewSystem:this._system,scope:this._builderScope,roomWizard:this._roomWizard,systemDisable:this._systemDisable,systemAdd:this._systemAdd||null,builderSelection:[...(this._builderSelection||[])],builderAssignments:this._builderAssignments||{},groupOpen:this._groupOpen||{},editingEntity:this._editingEntity||"",editingSystem:this._editingSystem||"",roomSystemAdd:Boolean(this._roomSystemAdd),roomSystemChoice:this._roomSystemChoice||"",roomSystemName:this._roomSystemName||""}));
      this._draftError="";
    } catch {this._draftError="This browser could not save your draft locally. Keep this page open and Publish to save your changes.";}
  }
  _clearDraft() {
    try {globalThis.localStorage?.removeItem(this._draftKey());}catch {}
    this._pendingDraft=null;
  }
  _restoreDraft(panel) {
    this._pendingDraft=null;
    try {
      const draft=JSON.parse(globalThis.localStorage?.getItem(this._draftKey())||"null");
      if(!draft||!draft.config||typeof draft.config!=="object"||!Array.isArray(draft.config.entities))return;
      const changed=JSON.stringify(draft.config)!==JSON.stringify(this._config),workflow=draft.roomWizard||draft.systemDisable||draft.systemAdd||draft.roomSystemAdd||draft.builderSelection?.length||Object.keys(draft.builderAssignments||{}).length;
      if(!changed&&!workflow){this._clearDraft();return;}
      if(draft.revision!==panel?.revision){this._pendingDraft=draft;return;}
      this._config=normalizeConfig(draft.config);this._dirty=changed||draft.dirty===true;
      this._builderRoom=this._config.rooms.some(r=>r.name===draft.room)?draft.room:this._config.rooms[0]?.name||"";
      this._roomSystemAdd=Boolean(draft.roomSystemAdd);this._roomSystemChoice=typeof draft.roomSystemChoice==="string"?draft.roomSystemChoice:"";this._roomSystemName=typeof draft.roomSystemName==="string"?draft.roomSystemName:"";this._editingEntity=draft.editingEntity||"";this._editingSystem=draft.editingSystem||"";this._inspector=this._editingEntity?"control":"preview";this._pickerOpen=Boolean(draft.builderSelection?.length);this._room=this._builderRoom;this._system=draft.previewSystem||"";this._builderSystem=draft.builderSystem||"";this._builderScope=draft.scope||"all";
      this._roomWizard=draft.roomWizard||null;this._systemDisable=draft.systemDisable||null;this._systemAdd=draft.systemAdd&&typeof draft.systemAdd.choice==="string"&&typeof draft.systemAdd.name==="string"?{choice:draft.systemAdd.choice,name:draft.systemAdd.name}:null;this._builderSelection=new Set(draft.builderSelection||[]);this._builderAssignments=draft.builderAssignments||{};this._groupOpen=draft.groupOpen||{};this._tab=["controls","systems","security","alerts","schedules","layout","theme","photos"].includes(draft.tab)?draft.tab:this._systemDisable?"systems":"controls";
      this._notice=this._dirty?"Your unpublished draft was restored from this browser. Publish to apply it to the panel.":"Your unfinished setup was restored. It has not been added to the layout.";
    } catch {this._draftError="The saved draft could not be read. Keep any open editing session and Publish your changes before reloading.";}
  }
  _selectPanel(id) {
    this._saveDraft();this._selected = id;
    const panel = this._data.panels.find(p => p.device_id === id);
    this._baseRevision=panel?.revision||0;
    const legacy=!Object.hasOwn(panel?.config||{},"rooms")&&!Object.hasOwn(panel?.config||{},"systems");
    this._config = normalizeConfig(panel?.config); this._config.name = panel?.name || this._config.name;
    this._dirty = false; this._room = ""; this._system = ""; this._previewPage=0; this._sensorPreviewPage=0;
    this._candidateLimit=60;clearTimeout(this._candidateTimer);this._wizardSelection = new Set(this._config.entities.map(e => e.entity_id));
    this._delayDrafts = new Map();
    this._builderRoom=this._config.rooms[0]?.name||"";this._builderSystem="";this._builderSelection=new Set();this._search="";
    this._roomDeletion=null;
    this._roomWizard=null;this._systemDisable=null;this._systemAdd=null;this._systemEditing="";this._builderAssignments={};this._groupOpen={};
    this._builderScope=this._config.rooms[0]?.area_id?"room":"all";
    // Link legacy room names to existing HA areas without changing HA's registry.
    if(legacy)for(const room of this._config.rooms)if(!room.area_id){const area=this._areas().find(area=>(area.name||area.area_id)===room.name);if(area)room.area_id=area.area_id;}
    this._builderScope=this._config.rooms[0]?.area_id?"room":"all";
    this._editingEntity="";this._inspector="preview";this._pickerOpen=false;this._roomSystemAdd=false;this._roomOptions=false;this._reviewOpen=false;this._room=this._builderRoom;this._restoreDraft(panel);
  }
  async _loadBackground() {
    const id = this._config.theme.background_asset;
    if (!id || this._assetCache.has(id)) return;
    const response = await this._call("assets",{device_id:this._selected,asset_ids:[id]});
    const asset = response.assets?.find(a => a.asset_id === id);
    if (asset && typeof asset.data === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)) this._assetCache.set(id,asset);
    else throw new Error("The saved background image could not be loaded. Remove it or upload a replacement.");
  }
  _validationErrors() {
    const errors=[...(this._delayDrafts?[...this._delayDrafts.values()].map(draft=>draft.error).filter(Boolean):[]),...validateConfig(this._config),...firmwareFeatureErrors(this._config,this._data?.panels?.find(panel=>panel.device_id===this._selected)?.capabilities||[])];
    if(this._config.entities.some(entity=>entity.schedule_ids?.length&&!scheduleEligible(this._source(entity.entity_id))))errors.push("Remove schedule assignments from entities without the required HA on/off or open/close capabilities.");
    if(this._roomWizard||this._systemDisable||this._systemAdd||this._roomSystemAdd)errors.push("Finish or cancel the open setup before publishing.");
    if(this._builderSelection?.size)errors.push("Add or clear the selected entities before publishing.");
    return errors;
  }
  _updateDraftStatus() {
    this._saveDraft();
    const status=this.shadowRoot.querySelector("footer strong"); if(status) status.textContent=this._draftError?"Unpublished changes · local draft could not be saved":"Draft saved on this browser";
    const errors=this._validationErrors(),publish=this.shadowRoot.querySelector('[data-action="publish"], [data-action="review-publish"]');
    if(publish) publish.disabled=this._busy||errors.length>0;
    const summary=this.shadowRoot.querySelector("footer p");
    if(summary) summary.textContent=errors[0]||"Configuration only · Home Assistant devices are unchanged.";
  }
  _delayDraft(alert) {
    if(this._delayDrafts?.has(alert.id)) return this._delayDrafts.get(alert.id);
    try {return delayPresentation(alert.delay_seconds);} catch(error) {return {amount:"",unit:"seconds",error:error.message};}
  }
  _storeDelayAmount(el) {
    const alert=this._config.alerts[Number(el.dataset.index)],draft={...this._delayDraft(alert),amount:el.value,error:""};
    try {alert.delay_seconds=parseAlertDelay(draft.amount,draft.unit);} catch(error) {draft.error=error.message;alert.delay_seconds=null;}
    this._delayDrafts ||= new Map(); this._delayDrafts.set(alert.id,draft);
    const feedback=this.shadowRoot?.querySelector(`[data-delay-feedback="${alert.id}"]`);
    if(feedback) feedback.textContent=draft.error||`${alert.delay_seconds} seconds stored exactly`;
  }
  _changeDelayUnit(el) {
    const alert=this._config.alerts[Number(el.dataset.index)]; let draft;
    try {
      if(Number.isInteger(alert.delay_seconds)) draft=delayPresentation(alert.delay_seconds,el.value);
      else {draft={...this._delayDraft(alert),unit:el.value,error:""};alert.delay_seconds=parseAlertDelay(draft.amount,draft.unit);}
    } catch(error) {draft={...this._delayDraft(alert),unit:el.value,error:error.message};alert.delay_seconds=null;}
    this._delayDrafts ||= new Map(); this._delayDrafts.set(alert.id,draft);
    this._mark();
  }
  _mark(notice="") {
    if(this._roomWizard){const assigned=new Set(this._config.entities.map(entity=>entity.entity_id)),ids=this._roomWizard.entity_ids.filter(id=>!assigned.has(id));if(ids.length!==this._roomWizard.entity_ids.length){this._roomWizard.entity_ids=ids;this._roomWizard.step="choose";}}
    this._dirty = true; this._notice = notice; this._saveDraft(); this._render();
  }
  _storeField(el) {
    if (el.dataset.alertField) this._config.alerts[Number(el.dataset.index)][el.dataset.alertField] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
    else if (el.dataset.entityField) {
      const entity=this._config.entities[Number(el.dataset.index)];entity[el.dataset.entityField]=el.value;
      if(el.dataset.entityField==="system"&&entity.additional_systems){entity.additional_systems=entity.additional_systems.filter(name=>name!==entity.system);if(!entity.additional_systems.length)delete entity.additional_systems;}
      if(["room","system"].includes(el.dataset.entityField)) {
        if(!this._config.rooms.some(r=>r.name===entity.room))this._config.rooms.push({name:entity.room,systems:[]});
        if(!this._config.systems.some(s=>s.name===entity.system))this._config.systems.push({name:entity.system,persistent:false});
        const room=this._config.rooms.find(r=>r.name===entity.room);for(const name of entitySystems(entity))if(!room.systems.includes(name))room.systems.push(name);
      }
    }
    else {
      const parts = el.dataset.field.split("."); let target = this._config;
      for (const part of parts.slice(0,-1)) target = target[part];
      target[parts.at(-1)] = el.type === "checkbox" ? (["menu.show_all_rooms","menu.show_all_systems"].includes(el.dataset.field)?el.checked:(el.checked?1:0)) : el.type === "number" || el.type === "range" ? Number(el.value) : el.value;
    }
  }
  _storeScheduleField(el) {
    const schedule=this._config.schedules[Number(el.dataset.index)],field=el.dataset.scheduleField;
    schedule[field]=el.type==="checkbox"?el.checked:el.value;
    if(field==="kind") {
      if(schedule.kind==="weekly"){schedule.start_date="";schedule.end_date="";}
      else if(schedule.kind==="once")schedule.end_date=schedule.start_date;
    }
    if(field==="start_date"&&schedule.kind==="once")schedule.end_date=schedule.start_date;
  }
  async _click(e) {
    const button = e.target.closest("button");
    if(Date.now()<(this._carouselClickUntil||0)&&button?.closest?.(".native-carousel"))return;
    if (!button || button.disabled) return;
    const a = button.dataset.action, index = Number(button.dataset.index);
    if(a?.startsWith("workspace-")){try{this._workspaceAction(a,button);}catch(error){this._error=error.message;this._render();}return;}
    if(a==="review-publish"){this._reviewOpen=true;this._render();this.shadowRoot.querySelector(".publish-review")?.scrollIntoView?.({block:"start"});return;}
    if(a==="cancel-review"){this._reviewOpen=false;this._render();return;}
    if(a?.startsWith("builder-")) {
      try {this._error="";this._builderAction(a,button);}catch(error){this._error=error.message;this._render();}
    }
    else if(a==="restore-draft") {
      const draft=this._pendingDraft;if(!draft)return;
      this._config=normalizeConfig(draft.config);this._builderRoom=this._config.rooms[0]?.name||"";this._pendingDraft=null;
      this._roomWizard=draft.roomWizard||null;this._systemDisable=draft.systemDisable||null;this._systemAdd=draft.systemAdd&&typeof draft.systemAdd.choice==="string"&&typeof draft.systemAdd.name==="string"?{choice:draft.systemAdd.choice,name:draft.systemAdd.name}:null;this._builderSelection=new Set(draft.builderSelection||[]);this._builderAssignments=draft.builderAssignments||{};this._groupOpen=draft.groupOpen||{};
      this._mark("Saved draft restored for review. Publish to replace the current panel layout with this draft.");
    } else if(a==="discard-draft") {this._clearDraft();this._render();}
    else if (a === "tab") { this._tab = button.dataset.tab;this._saveDraft();this._render(); }
    else if(a==="add-schedule") {
      if(this._config.schedules.length>=32){this._error="A panel can have up to 32 schedules.";this._render();return;}
      this._config.schedules.push(createSchedule());this._mark();
    } else if(a==="delete-schedule") {
      const rule=this._config.schedules[index],count=this._config.entities.filter(e=>e.schedule_ids?.includes(rule.id)).length;
      if(!confirm(`Delete ${rule.name} and remove its assignments from ${count} controls? This takes effect after publishing.`))return;
      this._config.schedules.splice(index,1);
      for(const entity of this._config.entities)if(entity.schedule_ids?.includes(rule.id))entity.schedule_ids=entity.schedule_ids.filter(id=>id!==rule.id);
      this._mark();
    }
    else if (a === "add-alert") {
      if (this._config.alerts.length >= 32) { this._error = "A panel can have up to 32 alert rules."; this._render(); return; }
      this._config.alerts.push(createAlert()); this._mark();
    } else if (a === "delete-alert") { this._delayDrafts?.delete(this._config.alerts[index].id); this._config.alerts.splice(index,1); this._mark(); }
    else if (a === "ack-alert") await this._run(async () => {
      const alertId = button.dataset.alertId;
      await this._call("ack_alert",{device_id:this._selected,alert_id:alertId});
      const panel = this._data.panels.find(p=>p.device_id===this._selected);
      if (panel) panel.alerts = (panel.alerts || []).filter(alert=>alert.id!==alertId);
      this._notice = "Alert acknowledged for one hour on this panel. Alarm and sensor states are unchanged. Unpublished edits are preserved.";
    });
    else if (a === "refresh-alerts") await this._run(async () => {
      const data = await this._call("list"); this._data = data;
      this._notice = "Active alerts refreshed. Unpublished edits are preserved.";
    });
    else if (a === "remove-ineligible-security") {
      const eligible = new Set(securityCandidates(this._data.entities).map(entity=>entity.entity_id));
      this._config.security.sensor_entities = this._config.security.sensor_entities.filter(id=>eligible.has(id)); this._mark();
    }
    else if (a === "refresh") {
      this._saveDraft();this._loaded = false;await this._load();
    } else if (a === "pair") await this._run(async () => {
      this._pair = await this._call("pair_code"); this._pairDeadline = Date.now() + this._pair.expires_in * 1000;
      clearInterval(this._pairTimer); this._pairTimer = setInterval(() => {
        const el = this.shadowRoot.querySelector("#pair-expiry");
        if (el) el.textContent = this._pairDeadline > Date.now() ? `Expires in ${Math.ceil((this._pairDeadline-Date.now())/1000)} seconds` : "Code expired. Generate a new code.";
      },1000);
    });
    else if (a === "publish") await this._run(async () => {
      const errors = this._validationErrors(); if (errors.length) throw new Error(errors.join(" "));
      const response = await this._call("save",{device_id:this._selected,config:this._config});
      const p = this._data.panels.find(p => p.device_id === this._selected);
      if (p) { p.config = copy(this._config); p.name = this._config.name; p.revision = response.revision; }
      this._baseRevision=response.revision;this._reviewOpen=false;this._dirty = false;this._clearDraft(); this._notice = `Published revision ${response.revision}. The panel will apply it when connected.`;
    });
    else if (a === "prepare-cameras") await this._run(async () => {
      if(this._dirty)throw new Error("Publish your camera selections before connecting their streams.");
      const response=await this._call("prepare_cameras",{device_id:this._selected});
      this._notice=response.results.map(result=>`${this._config.entities.find(e=>e.entity_id===result.entity_id)?.label||result.entity_id}: ${result.message||result.status}`).join(" · ")||"No cameras selected.";
    });
    else if (a === "remove") { this._wizardSelection.delete(this._config.entities[index].entity_id); this._config.entities.splice(index,1); this._mark(); }
    else if (a === "up" || a === "down") {
      if(moveEntityInGroup(this._config,index,a,button.dataset.system||this._config.entities[index]?.system))this._mark();
    } else if (a === "defaults") {
      const source = this._data.entities.find(s => s.entity_id === this._config.entities[index].entity_id);
      if (source) {
        const restored={...this._config.entities[index],...makeEntity(source)};
        if(restored.additional_systems){restored.additional_systems=restored.additional_systems.filter(name=>name!==restored.system);if(!restored.additional_systems.length)delete restored.additional_systems;}
        if(!this._config.systems.some(s=>s.name===restored.system&&s.enabled!==false)){this._error=`Enable ${restored.system} in Systems before restoring its HA assignment.`;this._render();return;}
        this._config.entities[index]=restored;
        if(!this._config.rooms.some(r=>r.name===restored.room))this._config.rooms.push({name:restored.room,area_id:source.area_id||"",systems:[]});
        if(!this._config.systems.some(s=>s.name===restored.system))this._config.systems.push({name:restored.system,persistent:false});
        const room=this._config.rooms.find(r=>r.name===restored.room);for(const name of entitySystems(restored))if(!room.systems.includes(name))room.systems.push(name);this._builderRoom=restored.room;this._room=restored.room;
      }
      this._mark();
    } else if (a === "preview-room") { this._room = button.dataset.value; this._previewPage=0; this._sensorPreviewPage=0; this._render(); }
    else if (a === "preview-cycle-system") {this._cyclePreviewAxis(Number(button.dataset.value));}
    else if (a === "preview-system") { this._system = button.dataset.value; this._previewPage=0; this._sensorPreviewPage=0; this._render(); }
    else if (a === "preview-page") { this._previewPage=Math.max(0,(this._previewPage||0)+Number(button.dataset.value)); this._render(); }
    else if (a === "preview-sensor-page") { this._sensorPreviewPage=Math.max(0,(this._sensorPreviewPage||0)+Number(button.dataset.value)); this._render(); }
    else if (a === "background") this.shadowRoot.querySelector("#background-file").click();
    else if (a === "photo") this.shadowRoot.querySelector("#photo-file").click();
    else if (a === "clear-background") { delete this._config.theme.background_asset; this._mark(); }
    else if (a === "remove-photo") { this._config.screensaver.photos.splice(index,1); this._mark(); }
    else if (a === "export") await this._run(() => this._exportTheme());
    else if (a === "import") this.shadowRoot.querySelector("#theme-file").click();
  }
  async _change(e) {
    const el = e.target, field = el.dataset.field;
    if(el.dataset.membership!==undefined) {
      const entity=this._config.entities[Number(el.dataset.index)],names=new Set(entitySystems(entity));if(el.checked)names.add(el.dataset.membership);else names.delete(el.dataset.membership);
      try{setEntityMemberships(this._config,entity.entity_id,[...names]);this._mark();}catch(error){this._error=error.message;this._render();}
    } else if(el.id==="room-system-choice") {this._roomSystemChoice=el.value;this._render();}
    else if(el.id==="add-system-choice"&&this._systemAdd) {
      this._systemAdd.choice=el.value;this._error="";this._saveDraft();this._render();if(el.value==="custom")this.shadowRoot?.querySelector("#new-system-name")?.focus?.();
    } else if(el.dataset.systemEnabled!==undefined) {
      const name=el.dataset.systemEnabled,count=this._config.entities.filter(entity=>entitySystems(entity).includes(name)).length;
      if(!el.checked&&count){this._systemDisable={name};this._saveDraft();this._render();}
      else try{this._config=setSystemEnabled(this._config,this._data.entities,name,el.checked);if(!el.checked)this._reconcileDisabledSystem(name);this._mark(el.checked?"System enabled. Link it to rooms or select it during room setup.":"System disabled. Room links removed; Home Assistant devices are unchanged.");}catch(error){this._error=error.message;this._render();}
    } else if(el.id==="new-room-area"&&this._roomWizard) {
      const previous=this._areas().find(a=>a.area_id===this._roomWizard.area_id),area=this._areas().find(a=>a.area_id===el.value),name=this._roomWizard.name;
      this._roomWizard=roomWizardDefaults(this._config,this._data.entities,area);if(area){this._roomWizard.systems=[...new Set(this._data.entities.filter(e=>e.area_id===area.area_id).map(e=>e.system).filter(name=>validText(name,64)))];this._roomWizard.entity_ids=this._data.entities.filter(e=>e.area_id===area.area_id&&!this._config.entities.some(item=>item.entity_id===e.entity_id)).map(e=>e.entity_id);}if(name&&name!==previous?.name)this._roomWizard.name=name;
      this._saveDraft();this._render();
    } else if(el.dataset.wizardSystem!==undefined&&this._roomWizard) {
      const name=el.dataset.wizardSystem,selected=new Set(this._roomWizard.systems),ids=new Set(this._roomWizard.entity_ids),matching=this._data.entities.filter(source=>source.area_id===this._roomWizard.area_id&&source.system===name),assigned=new Set(this._config.entities.map(entity=>entity.entity_id));
      if(el.checked){selected.add(name);for(const source of matching)if(!assigned.has(source.entity_id))ids.add(source.entity_id);}else {selected.delete(name);for(const source of matching)ids.delete(source.entity_id);}
      this._roomWizard.systems=[...selected];this._roomWizard.entity_ids=[...ids];this._roomWizard.step="choose";this._saveDraft();this._render();
    } else if(el.dataset.wizardEntity!==undefined&&this._roomWizard) {
      const ids=new Set(this._roomWizard.entity_ids);if(el.checked)ids.add(el.dataset.wizardEntity);else ids.delete(el.dataset.wizardEntity);this._roomWizard.entity_ids=[...ids];this._roomWizard.step="choose";this._saveDraft();
    } else if(el.dataset.builderAssignment!==undefined) {
      this._builderAssignments||={};this._builderAssignments[el.dataset.builderAssignment]=el.value;this._saveDraft();this._updateAddButton();
    } else if(el.id==="theme-preset") {if(el.value==="modern-blue"){this._config.theme=modernBlueTheme(this._config.theme);this._mark("Modern blue applied to this draft. Background image and photos are retained. Publish to apply it to the panel.");}}
    else if(el.dataset.scheduleField) {this._storeScheduleField(el);this._mark();}
    else if(el.dataset.scheduleWeekday!==undefined) {
      const rule=this._config.schedules[Number(el.dataset.index)],days=new Set(rule.weekdays),day=Number(el.dataset.scheduleWeekday);
      if(el.checked)days.add(day);else days.delete(day);rule.weekdays=[...days].sort();this._mark();
    } else if(el.dataset.bindSchedule) {
      const entity=this._config.entities[Number(el.dataset.index)],ids=new Set(entity.schedule_ids||[]);
      if(el.checked)ids.add(el.dataset.bindSchedule);else ids.delete(el.dataset.bindSchedule);
      if(ids.size>8){this._error="A control can use up to 8 schedules.";this._render();return;}
      entity.schedule_ids=[...ids];this._dirty=true;
      const summary=el.closest?.("details")?.querySelector("summary");if(summary)summary.textContent=`Schedules${ids.size?` (${ids.size})`:""}`;
      this._updateDraftStatus();
    }
    else if(el.id==="room-delete-mode"||el.name==="room-delete-mode"||el.id==="room-delete-destination") {
      if(this._roomDeletion){if(el.id==="room-delete-destination")this._roomDeletion.destination=el.value;else this._roomDeletion.mode=el.value;this._error="";this._render();}
    }
    else if(el.id==="builder-room") {this._roomDeletion=null;this._builderRoom=el.value;this._room=el.value;this._previewPage=0;this._sensorPreviewPage=0;const room=this._config.rooms.find(r=>r.name===el.value);this._builderScope=room?.area_id?"room":"all";this._builderSelection=new Set();this._builderAssignments={};this._builderSystem="";this._editingEntity="";this._inspector="preview";this._pickerOpen=false;this._roomSystemAdd=false;this._saveDraft();this._render();}
    else if(el.id==="show-all-assigned") {this._showAllAssigned=el.checked;this._render();}
    else if(el.id==="builder-system") {this._builderSystem=el.value;this._renderCandidates();}
    else if(el.id==="builder-scope") {this._builderScope=el.value;this._candidateLimit=60;this._renderCandidates();this._saveDraft();}
    else if(el.dataset.builderEntity) {if(el.checked)this._builderSelection.add(el.dataset.builderEntity);else this._builderSelection.delete(el.dataset.builderEntity);this._updateAddButton();this._saveDraft();}
    else if(el.dataset.systemPersistent!==undefined) {const system=this._config.systems[Number(el.dataset.systemPersistent)];system.persistent=el.checked;if(!el.checked)for(const room of this._config.rooms)if(this._config.entities.some(e=>e.room===room.name&&entitySystems(e).includes(system.name))&&!room.systems.includes(system.name))room.systems.push(system.name);this._mark();}
    else if (el.id === "panel-select") {
      this._saveDraft();
      this._selectPanel(el.value);
      await this._run(() => this._loadBackground());
    } else if (el.dataset.roomSystemLabel!==undefined) {
      try{setRoomSystemLabel(this._config,this._builderRoom,el.dataset.roomSystemLabel,el.value);this._mark("System label updated for this room only. Publish to apply.");}catch(error){this._error=error.message;this._render();}
    } else if (el.id === "security-select-linked") {
      const source=this._data.entities.find(entity=>entity.entity_id===this._config.security.alarm_entity);
      const eligible=new Set(securityCandidates(this._data.entities).map(entity=>entity.entity_id));
      const linked=(source?.sensor_entities||[]).filter(id=>eligible.has(id));
      if(!linked.length)return;
      const selected=new Set(this._config.security.sensor_entities);
      for(const id of linked){if(el.checked)selected.add(id);else selected.delete(id);}
      if(selected.size>64){this._error="Adding these alarm sensors would exceed 64 security statuses. Remove other selections first.";this._render();return;}
      this._config.security.sensor_entities=[...selected];this._mark();
    } else if (el.dataset.additionalSystem!==undefined) {
      const entity=this._config.entities[Number(el.dataset.index)],names=new Set(entity.additional_systems||[]);
      if(el.checked)names.add(el.dataset.additionalSystem);else names.delete(el.dataset.additionalSystem);
      try{setAdditionalSystems(this._config,entity,[...names]);this._mark();}catch(error){this._error=error.message;this._render();}
    } else if (el.dataset.securitySensor) {
      const selected = new Set(this._config.security.sensor_entities);
      if (el.checked) selected.add(el.dataset.securitySensor); else selected.delete(el.dataset.securitySensor);
      this._config.security.sensor_entities = [...selected]; this._mark();
    } else if (el.dataset.delayAmount!==undefined) {
      this._storeDelayAmount(el); this._mark();
    } else if (el.dataset.delayUnit!==undefined) {
      this._changeDelayUnit(el);
    } else if (el.dataset.alertField) {
      this._storeField(el); this._mark();
    } else if (field) {
      this._storeField(el);
      this._mark();
    } else if (el.dataset.entityField) {
      this._storeField(el);
      if(el.dataset.entityField==="room"){this._builderRoom=el.value;this._room=el.value;this._builderScope=this._config.rooms.find(room=>room.name===el.value)?.area_id?"room":"all";}
      this._mark();
    } else if (el.id === "background-file" || el.id === "photo-file") {
      const files = [...(el.files || [])]; if (!files.length) return;
      const purpose = el.id === "background-file" ? "background" : "photo";
      await this._run(async () => {
        if (purpose === "photo" && this._config.screensaver.photos.length + files.length > 20) throw new Error("A screensaver can contain up to 20 photos.");
        for (const file of files) {
          const asset = await this._upload(file);
          if (purpose === "background") this._config.theme.background_asset = asset.asset_id;
          else this._config.screensaver.photos.push(asset.asset_id);
          this._dirty = true;
        }
      }, "Images uploaded. Publish to use them on the panel.");
    } else if (el.id === "theme-file" && el.files?.[0]) await this._run(async () => {
      if (el.files[0].size > 14 * 1024 * 1024) throw new Error("Theme package exceeds 14 MB.");
      const pkg = validateThemePackage(JSON.parse(await el.files[0].text()));
      const remap = new Map();
      for (const asset of pkg.assets) {
        const response = await this._call("upload",{device_id:this._selected,filename:asset.filename || "theme-image.jpg",data:asset.data});
        remap.set(asset.asset_id,response.asset_id); this._assetCache.set(response.asset_id,{...asset,asset_id:response.asset_id});
      }
      if (pkg.theme.background_asset) pkg.theme.background_asset = remap.get(pkg.theme.background_asset);
      pkg.screensaver.photos = pkg.screensaver.photos.map(id => remap.get(id));
      this._config.theme = pkg.theme; this._config.screensaver = pkg.screensaver; this._dirty = true;
    },"Theme imported. Entity assignments are unchanged; publish when ready.");
  }
  async _upload(file) {
    if (!["image/jpeg","image/png"].includes(file.type) || file.size > 4 * 1024 * 1024) throw new Error("Choose a JPEG or PNG no larger than 4 MiB.");
    const data = await new Promise((resolve,reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("Could not read the image.")); reader.readAsDataURL(file);
    });
    const response = await this._call("upload",{device_id:this._selected,filename:file.name,data});
    this._assetCache.set(response.asset_id,{asset_id:response.asset_id,filename:file.name,data});
    return response;
  }
  async _exportTheme() {
    const ids = [...new Set([this._config.theme.background_asset,...this._config.screensaver.photos].filter(Boolean))];
    let assets = [];
    if (ids.length) {
      // The backend supplies canonical resized JPEGs, including after an editor reload.
      const response = await this._call("assets",{device_id:this._selected,asset_ids:ids}); assets = response.assets;
      if (!Array.isArray(assets) || ids.some(id => !assets.some(a => a.asset_id === id))) throw new Error("Some theme images could not be exported. No package was created.");
    }
    const pkg = {format:"native-panel-theme",version:1,theme:this._config.theme,screensaver:this._config.screensaver,assets};
    validateThemePackage(pkg);
    const blob = new Blob([JSON.stringify(pkg,null,2)],{type:"application/json"}), url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "native-panel-theme.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    this._notice = "Theme exported. Panel identity and entity assignments are not included.";
  }
  _option(value,label,current,disabled=false) { return `<option value="${escapeHTML(value)}" ${value===current?"selected":""} ${disabled?"disabled":""}>${escapeHTML(label)}</option>`; }
  _field(label,field,value,type="text",extra="") {
    return `<label class="field"><span>${escapeHTML(label)}</span><input aria-label="${escapeHTML(label)}" type="${type}" data-field="${field}" value="${escapeHTML(value)}" ${extra}></label>`;
  }
  _select(label,field,options,current) { return `<label class="field"><span>${label}</span><select aria-label="${escapeHTML(label)}" data-field="${field}">${options.map(o=>this._option(o[0],o[1],current)).join("")}</select></label>`; }
  _render() {
    if (!this.shadowRoot) return;
    this._captureOpenGroups();
    const menuScroll=this._menuScroll();
    const active=this.shadowRoot.activeElement,focus=active?{id:active.id,tag:active.tagName,data:JSON.stringify(active.dataset),label:active.getAttribute("aria-label"),text:["BUTTON","SUMMARY"].includes(active.tagName)?active.textContent:""}:null;
    const cfg = this._config, panel = this._data.panels.find(p=>p.device_id===this._selected), disabled = this._busy ? "disabled" : "";
    const ready = Boolean(this._selected), errors = this._validationErrors();
    const tabs=[["controls","Rooms"],["systems","Systems"],["security","Security"],["alerts","Alerts"],["schedules","Schedules"],["layout","Layout"],["theme","Theme"],["photos","Photo screensaver"]];
    const side=this._tab==="controls"&&this._inspector==="control"&&cfg.entities.some(e=>e.entity_id===this._editingEntity)?this._controlInspector():`<section class="preview-section" aria-label="Touchscreen preview"><div class="preview-heading"><div><h2>Touchscreen preview</h2><p>Elecrow 10.1″ · 1024 × 600</p></div><span class="preview-note">Layout preview · no device actions</span></div><div class="preview-shell"><div class="native-preview" style="--panel-bg:${cfg.theme.background};--panel-fg:${cfg.theme.foreground};--panel-accent:${cfg.theme.accent};--panel-button:${cfg.theme.button};--panel-radius:${cfg.theme.radius}px">${this._preview()}</div></div><p class="hint">Select a room or system to preview its controls. Supported functions come from Home Assistant automatically. Cameras are deferred in this build.</p>${layoutControlPages(filterEntities(cfg.entities,this._room,this._system)).length>1?`<p class="hint">Thermostats get more space for direct adjustments. Other controls fit alongside them; use the page arrows for additional controls.</p>`:""}</section>`;
    this.shadowRoot.innerHTML = `<style>${CSS}${WORKSPACE_CSS}</style><main class="companion" aria-busy="${this._busy}">
      <header class="app-header"><h1>Home Panel</h1><label class="panel-choice"><span class="sr-only">Touchscreen</span><select id="panel-select" ${disabled}><option value="">${this._data.panels.length?"Select panel":"No paired panels"}</option>${this._data.panels.map(p=>this._option(p.device_id,p.name,this._selected)).join("")}</select></label><span class="panel-status">${ready?panel?.online?"Connected":"Offline · applies on reconnect":"Not paired"}${ready?` · Revision ${panel?.revision||0}`:""}</span><div class="header-actions"><button data-action="refresh" ${disabled} aria-label="Refresh panels"><ha-icon icon="mdi:refresh"></ha-icon></button><button data-action="pair" ${disabled}>Pair a touchscreen</button></div></header>
      ${this._hass?.nativePanelDemo?'<p class="demo">Demonstration only · synthetic devices · no hardware connected</p>':""}
      ${this._pair?`<section class="pair" aria-label="Pairing code"><h2>Connect a new touchscreen</h2><p>On the touchscreen: Setup → Home Assistant. Enter your HA base address (${escapeHTML(this._hass?.hassUrl?.("")||globalThis.location?.origin||"your HA address")}) and this code.</p><strong class="pair-code">${escapeHTML(this._pair.code)}</strong><p id="pair-expiry">Expires in ${Math.max(0,Math.ceil((this._pairDeadline-Date.now())/1000))} seconds</p><p>After pairing, choose Refresh panels. Each tablet has its own configuration.</p></section>`:""}
      ${this._error?`<p class="message error" role="alert">${escapeHTML(this._error)}</p>`:""}${this._notice?`<p class="message" role="status">${escapeHTML(this._notice)}</p>`:""}${this._draftError?`<p class="message error" role="alert">${escapeHTML(this._draftError)}</p>`:""}
      ${this._pendingDraft?'<section class="message"><p>A saved draft is older than the published layout. Your edits are kept separately.</p><button data-action="restore-draft">Restore saved draft for review</button><button data-action="discard-draft">Discard saved draft</button></section>':""}
      ${!ready?`<section class="empty"><h2>Build your home touchscreen</h2><ol class="setup-steps"><li>Install the clean firmware for your exact Elecrow board using its programming USB connection.</li><li>On the touchscreen, join Wi-Fi and set its name.</li><li>Choose Pair a touchscreen here; enter HA's base address and the code on the touchscreen.</li><li>Refresh panels, add rooms and controls, then review and publish.</li></ol><p>No AI or source editing is needed to configure a supported, installed panel.</p></section>`:`
      <nav class="app-tabs" aria-label="Editor sections">${tabs.slice(0,2).map(([key,label])=>`<button data-action="tab" data-tab="${key}" aria-current="${this._tab===key?"page":"false"}">${label}</button>`).join("")}<details class="settings-nav"><summary>${tabs.slice(2).find(([key])=>key===this._tab)?.[1]||"Other settings"}</summary><div>${tabs.slice(2).map(([key,label])=>`<button data-action="tab" data-tab="${key}" aria-current="${this._tab===key?"page":"false"}">${label}</button>`).join("")}</div></details></nav>
      ${this._reviewOpen?this._publishReview():""}
      <div ${this._reviewOpen?"hidden":""} class="workspace ${this._tab==="controls"?"room-workspace":"settings-workspace"}"><section class="editor"><fieldset class="editor-body" ${disabled}>${this._tab==="controls"?this._controls():this._tab==="systems"?this._systems():this._tab==="security"?this._security():this._tab==="alerts"?this._alerts():this._tab==="schedules"?this._schedules():this._tab==="layout"?this._layout():this._tab==="theme"?this._theme():this._photos()}</fieldset></section><aside class="context-pane"><div class="context-tabs"><button class="back-to-room" data-action="workspace-back-room">Back to room</button><button data-action="workspace-inspector" ${!cfg.entities.some(e=>e.entity_id===this._editingEntity)?"disabled":""} aria-pressed="${this._inspector==="control"}">Control settings</button><button data-action="workspace-preview" aria-pressed="${this._inspector!=="control"}">Preview</button></div>${side}</aside></div>
      <footer><div><strong>${this._hasWorkflowDraft()?"Finish setup in this draft":this._dirty?"Draft saved on this browser":"Published layout"}</strong><p>${errors.length?escapeHTML(errors[0]):"Configuration only · Home Assistant devices are unchanged."}</p></div><button class="primary" data-action="review-publish" ${this._busy||errors.length?"disabled":""}>Review &amp; publish</button></footer>`}
      <input hidden id="background-file" type="file" accept="image/jpeg,image/png"><input hidden id="photo-file" type="file" accept="image/jpeg,image/png" multiple><input hidden id="theme-file" type="file" accept="application/json,.json">
    </main>`;
    this._renderCandidates(); this._renderSecuritySensors(); this._scalePreview();this._restoreMenuScroll(menuScroll);
    if(focus){const target=[...this.shadowRoot.querySelectorAll("button,input,select,summary")].find(el=>focus.id?el.id===focus.id:el.tagName===focus.tag&&JSON.stringify(el.dataset)===focus.data&&el.getAttribute("aria-label")===focus.label&&(!focus.text||el.textContent===focus.text));target?.focus?.({preventScroll:true});}
  }
  _areas() { return (this._data.areas||[]).map(area=>({...area,area_id:area.area_id||area.id||""})); }
  _builderAction(action,button) {
    const value=id=>this.shadowRoot.querySelector(`#${id}`)?.value.trim()||"";
    const room=this._config.rooms.find(r=>r.name===this._builderRoom);
    let notice="";
    if(action==="builder-new-system") {
      this._systemAdd={choice:"",name:""};this._systemEditing="";this._error="";this._saveDraft();this._render();this.shadowRoot?.querySelector("#add-system-choice")?.focus?.();return;
    } else if(action==="builder-cancel-system") {
      this._systemAdd=null;this._error="";this._saveDraft();this._render();return;
    } else if(action==="builder-edit-system") {
      const system=this._config.systems[Number(button.dataset.index)];if(!system)throw new Error("That system no longer exists.");
      this._systemEditing=this._systemEditing===system.name?"":system.name;this._render();return;
    } else if(action==="builder-close-system") {
      this._systemEditing="";this._render();return;
    } else if(action==="builder-new-room") {
      this._roomWizard=roomWizardDefaults(this._config,this._data.entities);this._saveDraft();this._render();return;
    } else if(action==="builder-cancel-room") {
      this._roomWizard=null;this._saveDraft();this._render();return;
    } else if(action==="builder-review-room") {
      if(!this._roomWizard)throw new Error("Start room setup first.");createReviewedRoom(this._config,this._data.entities,this._roomWizard);
      this._roomWizard.step="review";this._saveDraft();this._render();return;
    } else if(action==="builder-edit-room-setup") {
      if(this._roomWizard)this._roomWizard.step="choose";this._saveDraft();this._render();return;
    } else if(action==="builder-create-room") {
      if(this._roomWizard?.step!=="review")throw new Error("Review the room setup before creating it.");
      const wizard=this._roomWizard;this._config=createReviewedRoom(this._config,this._data.entities,wizard);this._builderRoom=wizard.name.trim();this._builderScope=wizard.area_id?"room":"all";this._builderSelection=new Set();this._builderAssignments={};this._roomWizard=null;
      notice="Room created in this draft. Publish to apply its menus and controls to the panel.";
    } else if(action==="builder-cancel-disable-system") {
      this._systemDisable=null;this._saveDraft();this._render();return;
    } else if(action==="builder-confirm-disable-system") {
      if(!this._systemDisable)throw new Error("Choose a system to disable first.");
      const name=this._systemDisable.name;if(!this._config.systems.some(system=>system.name===name))throw new Error("This system changed. Cancel and choose the system again.");this._config=setSystemEnabled(this._config,this._data.entities,name,false);this._reconcileDisabledSystem(name);this._systemDisable=null;
      notice=`${name} disabled in this draft. Its panel controls and room links were removed. Home Assistant devices are unchanged. Publish to apply.`;
    } else if(action==="builder-rename-room") {
      renameCatalog(this._config,"rooms",this._builderRoom,value("room-rename"));this._builderRoom=value("room-rename");
    } else if(action==="builder-room-up"||action==="builder-room-down") {
      const index=this._config.rooms.indexOf(room),next=index+(action==="builder-room-up"?-1:1);
      if(index<0||next<0||next>=this._config.rooms.length)return;
      [this._config.rooms[index],this._config.rooms[next]]=[this._config.rooms[next],this._config.rooms[index]];
      notice="Room order updated in this draft. Publish to apply it to the panel.";
    } else if(action==="builder-delete-room") {
      if(!room)throw new Error("Select a room to delete.");
      this._roomDeletion={name:room.name,mode:"move",destination:""};this._error="";this._render();return;
    } else if(action==="builder-cancel-delete-room") {
      this._roomDeletion=null;this._error="";this._render();return;
    } else if(action==="builder-confirm-delete-room") {
      if(!this._roomDeletion)throw new Error("Choose Delete room first.");
      const {name,mode,destination}=this._roomDeletion,count=deletePanelRoom(this._config,name,mode,destination);
      this._roomDeletion=null;this._builderRoom=count&&mode==="move"?destination:this._config.rooms[0]?.name||"";this._builderSelection=new Set();
      this._builderScope=this._config.rooms.find(r=>r.name===this._builderRoom)?.area_id?"room":"all";
      notice=`Room removed from this draft${count?mode==="move"?`; ${count} controls moved to ${destination}`:`; ${count} panel controls removed`:""}. Home Assistant devices and areas are unchanged. Publish to apply the panel layout.`;
    } else if(action==="builder-create-system"||action==="builder-add-system") {
      const choice=this._systemAdd?.choice||"",custom=action==="builder-create-system"||choice==="custom";
      const name=custom?value("new-system-name"):choice.startsWith("known:")?choice.slice(6):"";
      if(!custom&&!systemCatalog(this._config,this._data.entities).some(system=>!system.configured&&system.name===name))throw new Error("Choose an available system or Create a custom system.");
      if(!validText(name,64))throw new Error("Enter a system name using 1–64 UTF-8 bytes.");
      if(this._config.systems.length>=24)throw new Error("A panel can have up to 24 systems.");
      if(this._config.systems.some(s=>s.name===name))throw new Error("That system already exists. Link it from the catalog instead.");
      const next=normalizeConfig(this._config);next.systems.push({name,persistent:false,enabled:true});const errors=validateConfig(next,{draft:true});if(errors.length)throw new Error(errors.join(" "));this._config=next;this._systemAdd=null;notice="System added to this draft. Link it to rooms, then Publish to apply it.";
    } else if(action==="builder-link-system") {
      if(!room)throw new Error("Create or select a room first.");
      const name=value("link-system");if(!this._config.systems.some(s=>s.name===name&&s.enabled!==false))throw new Error("Choose an enabled system from Systems.");
      if(!room.systems.includes(name))room.systems.push(name);this._builderSystem=name;
    } else if(action==="builder-system-up"||action==="builder-system-down") {
      if(!moveRoomSystem(this._config,this._builderRoom,button.dataset.value,action==="builder-system-up"?"up":"down"))return;
      notice="System order updated for this room in the draft. Publish to apply it to the panel.";
    } else if(action==="builder-unlink-system") {
      const name=button.dataset.value;
      if(!room||!room.systems.includes(name))throw new Error("Select a system linked to this room.");
      const removed=removeSystemAssignments(this._config,name,room.name);
      if(removed.has(this._config.security.alarm_entity))this._config.security.alarm_entity="";
      room.systems=room.systems.filter(s=>s!==name);
      this._builderSelection=new Set();
      notice=`${name} unlinked from ${room.name}; ${removed.size} panel control${removed.size===1?"":"s"} removed from this draft. Home Assistant devices are unchanged. Publish to apply.${this._config.systems.find(s=>s.name===name)?.persistent?" This system is persistent, so its tab remains visible. Turn off Persistent in the global system catalog to hide it in unlinked rooms.":""}`;
    } else if(action==="builder-rename-system") {
      const index=Number(button.dataset.index),old=this._config.systems[index].name,name=value(`system-name-${index}`);
      renameCatalog(this._config,"systems",old,name);this._systemEditing=name;if(this._builderSystem===old)this._builderSystem=name;
    } else if(action==="builder-delete-system") {
      const system=this._config.systems[Number(button.dataset.index)];
      if(this._config.entities.some(e=>entitySystems(e).includes(system.name)))throw new Error("Move or remove this system's controls before deleting it. No controls were deleted.");
      this._systemEditing="";this._config.systems=this._config.systems.filter(s=>s!==system);for(const r of this._config.rooms){r.systems=r.systems.filter(name=>name!==system.name);if(r.system_labels){delete r.system_labels[system.name];if(!Object.keys(r.system_labels).length)delete r.system_labels;}}
    } else if(action==="builder-add-alarm") {
      const id=this._config.security.alarm_entity,roomName=value("alarm-room"),systemName=value("alarm-system");
      if(!id.startsWith("alarm_control_panel."))throw new Error("Choose an available alarm first.");
      addRoomEntities(this._config,this._data.entities,[id],roomName,systemName);
      this._builderRoom=roomName;this._builderSystem=systemName;
      notice="Alarm added to this draft. Publish to show its keypad and arm controls on the panel.";
    } else if(action==="builder-add-entities") {
      const available=systemCatalog(this._config,this._data.entities).filter(item=>item.enabled||!item.configured).map(item=>item.name),assignments=Object.fromEntries([...this._builderSelection].map(id=>[id,this._assignmentFor(this._source(id),available)]));
      this._config=addReviewedControls(this._config,this._data.entities,[...this._builderSelection],this._builderRoom,assignments);this._pickerOpen=false;
      this._builderSelection=new Set();this._builderAssignments={};
    } else if(action==="builder-clear-selection") {
      this._builderSelection=new Set();this._builderAssignments={};this._saveDraft();this._render();return;
    }
    this._room=this._builderRoom;this._previewPage=0;this._sensorPreviewPage=0;this._mark(notice);
  }
  _deleteRoomPanel() {
    const intent=this._roomDeletion,room=this._config.rooms.find(r=>r.name===intent?.name);if(!room)return "";
    const controls=this._config.entities.filter(e=>e.room===room.name),destinations=this._config.rooms.filter(r=>r!==room),bindings=controls.filter(e=>e.schedule_ids?.length).length;
    return `<section class="room-deletion" aria-label="Delete room options"><h3>Delete ${escapeHTML(room.name)}?</h3><p>${controls.length} panel control${controls.length===1?"":"s"} in this room. Home Assistant devices and areas are unchanged. This edits the draft; Publish applies the new panel layout.</p>${controls.length?`<fieldset class="schedule-bindings"><legend>What should happen to this room's controls?</legend><label class="checkbox-field"><input type="radio" name="room-delete-mode" value="move" ${intent.mode==="move"?"checked":""}>Move all controls to another room, then delete (recommended)</label>${intent.mode==="move"?`<label class="field"><span>Destination room</span><select id="room-delete-destination" aria-label="Destination room" ${!destinations.length?"disabled":""}>${this._option("","Choose another room",intent.destination)}${destinations.map(r=>this._option(r.name,r.name,intent.destination)).join("")}</select></label>${!destinations.length?'<p class="hint">There is no other room. Cancel and create a destination room first, or explicitly choose to remove the panel controls.</p>':'<p class="hint">Names, systems and schedule assignments are kept. The destination gains this room’s system links.</p>'}`:""}<label class="checkbox-field"><input type="radio" name="room-delete-mode" value="remove" ${intent.mode==="remove"?"checked":""}>Remove this room's panel controls</label>${intent.mode==="remove"?`<p class="hint">${controls.length} control${controls.length===1?"":"s"} will be removed from this panel layout${bindings?`, including schedule assignments on ${bindings} control${bindings===1?"":"s"}`:""}. Schedule definitions, independent alerts and Security monitoring selections stay. If the selected alarm is removed, the panel's alarm selection is cleared.</p>`:""}</fieldset>`:'<p>This room is empty. Its panel menu entry will be removed.</p>'}<div class="row"><button class="danger" data-action="builder-confirm-delete-room" ${controls.length&&intent.mode==="move"&&!intent.destination?"disabled":""}>Confirm delete room</button><button data-action="builder-cancel-delete-room">Cancel</button></div></section>`;
  }
  _systems() {
    const catalog=systemCatalog(this._config,this._data.entities),configured=catalog.filter(system=>system.configured),available=catalog.filter(system=>!system.configured),add=this._systemAdd;
    const dots='<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>';
    return `<div class="section-title"><div><h2>Systems</h2><p>Choose the systems available to your rooms.</p></div><button data-action="builder-new-system" ${add?"disabled":""}>Add system</button></div>${add?`<section class="wizard" aria-label="Add system"><label class="field"><span>System</span><select id="add-system-choice" aria-label="System to add">${this._option("","Choose a system",add.choice)}${available.map(system=>this._option(`known:${system.name}`,system.name,add.choice)).join("")}${this._option("custom","Create a custom system…",add.choice)}</select></label>${!available.length?'<p class="hint">All discovered systems are already added. You can still create a custom system.</p>':""}${add.choice==="custom"?`<label class="field"><span>Custom system name</span><input id="new-system-name" aria-label="Custom system name" maxlength="64" value="${escapeHTML(add.name)}" placeholder="e.g. Sprinklers"></label>`:""}<div class="row"><button class="primary" data-action="builder-add-system" ${!add.choice?"disabled":""}>Add to systems</button><button data-action="builder-cancel-system">Cancel</button></div></section>`:""}${this._systemDisablePanel()}<div class="system-catalog">${configured.map(system=>`<section class="system-entry"><div class="system-row"><label class="checkbox-field"><input type="checkbox" aria-label="Enable ${escapeHTML(system.name)}" data-system-enabled="${escapeHTML(system.name)}" ${system.enabled?"checked":""}><span>${escapeHTML(system.name)}</span></label><button class="system-edit-button" data-action="builder-edit-system" data-index="${system.index}" aria-label="Edit ${escapeHTML(system.name)} system" aria-expanded="${this._systemEditing===system.name}" aria-controls="system-editor-${system.index}">${dots}</button></div>${this._systemEditing===system.name?`<div class="system-edit" id="system-editor-${system.index}"><label class="field"><span>System name</span><input id="system-name-${system.index}" aria-label="System name" value="${escapeHTML(system.name)}" maxlength="64"></label><label class="checkbox-field"><input type="checkbox" data-system-persistent="${system.index}" aria-label="Keep ${escapeHTML(system.name)} visible in every room" ${system.persistent?"checked":""}>Persistent · visible in every room when enabled</label><div class="row"><button data-action="builder-rename-system" data-index="${system.index}" aria-label="Rename ${escapeHTML(system.name)} system">Rename system</button><button class="danger" data-action="builder-delete-system" data-index="${system.index}" aria-label="Delete ${escapeHTML(system.name)} system">Delete unused system</button><button data-action="builder-close-system">Done</button></div></div>`:""}</section>`).join("")||'<p>No systems added yet. Use Add system to choose one.</p>'}</div><p class="hint">Disabling a system removes its controls from every room after confirmation. Home Assistant devices are unchanged.</p>`;
  }
  _systemDisablePanel() {
    if(!this._systemDisable)return "";
    const name=this._systemDisable.name,controls=this._config.entities.filter(e=>entitySystems(e).includes(name)),rooms=this._config.rooms.filter(r=>r.systems.includes(name)||controls.some(e=>e.room===r.name)),bindings=controls.reduce((count,e)=>count+(e.schedule_ids?.length||0),0);
    const removed=controls.filter(entity=>entitySystems(entity).length===1),kept=controls.length-removed.length;
    return `<section class="room-deletion" aria-label="Disable system confirmation"><h3>Disable ${escapeHTML(name)}?</h3><p>This removes ${controls.length} system placements and links from ${rooms.length} rooms. ${removed.length} controls lose their last placement and leave the panel; ${kept} controls remain in their other systems. Schedule assignments stay with controls that remain.</p><p>Room names, independent alerts, Security monitoring and schedule definitions stay. Removing the last placement of the selected alarm clears its panel alarm selection. Home Assistant devices and areas are unchanged.</p><p>Re-enabling does not restore removed placements. Publish applies this draft.</p><div class="row"><button class="danger" data-action="builder-confirm-disable-system">Confirm disable</button><button data-action="builder-cancel-disable-system">Cancel disable</button></div></section>`;
  }
  _reconcileDisabledSystem(name) {
    if(this._roomWizard?.systems.includes(name)){this._roomWizard.systems=this._roomWizard.systems.filter(system=>system!==name);this._roomWizard.entity_ids=this._roomWizard.entity_ids.filter(id=>this._source(id).system!==name);this._roomWizard.step="choose";}
  }
  _roomSetup() {
    const wizard=this._roomWizard;if(!wizard)return "";
    const catalog=systemCatalog(this._config,this._data.entities),matching=wizard.area_id?this._data.entities.filter(e=>e.area_id===wizard.area_id):[],assigned=new Map(this._config.entities.map(e=>[e.entity_id,e]));
    if(wizard.step==="review")return `<section class="wizard" aria-label="Review new room"><h3>Review ${escapeHTML(wizard.name)}</h3><p>${wizard.systems.length} system${wizard.systems.length===1?"":"s"} · ${wizard.entity_ids.length} control${wizard.entity_ids.length===1?"":"s"}. Existing assignments stay in their rooms.</p><ul>${wizard.systems.map(name=>`<li>${escapeHTML(name)} · ${wizard.entity_ids.filter(id=>this._source(id).system===name).length} control${wizard.entity_ids.filter(id=>this._source(id).system===name).length===1?"":"s"}</li>`).join("")}</ul><p>Selected systems will be enabled or created and linked to this room. This room has not been added to the layout. Create it in the draft, then Publish to update the touchscreen.</p><div class="row"><button class="primary" data-action="builder-create-room">Create room in draft</button><button data-action="builder-edit-room-setup">Edit selections</button><button data-action="builder-cancel-room">Cancel room setup</button></div></section>`;
    const groups=wizard.area_id?[...new Set([...matching.map(e=>e.system||"No detected system"),...wizard.systems])]:catalog.map(s=>s.name);
    const other=catalog.filter(system=>system.enabled&&!groups.includes(system.name));
    const renderGroup=name=>{
      const system=catalog.find(s=>s.name===name),enabled=system?.enabled===true,selected=wizard.systems.includes(name),entities=matching.filter(e=>(e.system||"No detected system")===name);
      const checkbox=`<label class="checkbox-field"><input type="checkbox" data-wizard-system="${escapeHTML(name)}" ${selected?"checked":""}>Include ${escapeHTML(name)}${!enabled?" · enable/create when room is confirmed":""}</label>`;
      if(!wizard.area_id)return checkbox;
      return `<fieldset class="schedule-bindings"><legend>${escapeHTML(name)}</legend>${checkbox}${entities.map(source=>{const existing=assigned.get(source.entity_id);return `<label class="candidate"><input type="checkbox" data-wizard-entity="${escapeHTML(source.entity_id)}" ${wizard.entity_ids.includes(source.entity_id)?"checked":""} ${existing||!selected?"disabled":""}><span><strong>${escapeHTML(source.name||source.entity_id)}</strong><small>${escapeHTML(source.entity_id)}</small>${existing?`<small>Already assigned to ${escapeHTML(existing.room)} / ${escapeHTML(existing.system)}. It will not be moved.</small>`:""}</span></label>`;}).join("")}</fieldset>`;
    };
    return `<section class="wizard" aria-label="Create room setup"><h3>Create a room</h3><p>Choose an HA area or a manual room. Review all selections before creating anything. The preview shows the saved layout until this room is created in the draft.</p><label class="field"><span>Home Assistant area</span><select id="new-room-area" aria-label="Home Assistant area">${this._option("","Manual room (panel only)",wizard.area_id)}${this._areas().map(a=>this._option(a.area_id,a.name||a.area_id,wizard.area_id)).join("")}</select></label><label class="field"><span>Room name or area alias</span><input id="new-room-name" aria-label="Room name or area alias" maxlength="64" value="${escapeHTML(wizard.name)}"></label>${!wizard.area_id?'<p class="hint">Choose systems for this manual room. Add devices from any HA area after creating it.</p>':""}<p class="hint">Selected systems will be enabled and linked when you create this room. Review before confirming; HA areas and devices stay unchanged.</p><div class="room-setup-groups">${groups.map(renderGroup).join("")||"<p>No devices detected in this HA area. You can create the room and add controls later.</p>"}${wizard.area_id&&other.length?`<details><summary>Other available systems (${other.length})</summary>${other.map(system=>renderGroup(system.name)).join("")}</details>`:""}</div><div class="row"><button class="primary" data-action="builder-review-room">Review room</button><button data-action="builder-cancel-room">Cancel room setup</button></div></section>`;
  }
  _captureOpenGroups() {
    this._groupOpen||={};for(const node of this.shadowRoot?.querySelectorAll?.("[data-control-group]")||[])if(node.dataset?.controlGroup!==undefined)this._groupOpen[node.dataset.controlGroup]=node.open;
  }
  _icon(entity) {
    const names={light:"lightbulb-outline",switch:"power-plug-outline",climate:"thermostat",cover:"blinds-horizontal",fan:"fan",sensor:"gauge",binary_sensor:"motion-sensor",alarm_control_panel:"shield-home-outline",camera:"cctv",lock:"lock-outline"};
    return `<ha-icon icon="mdi:${names[entity.entity_id.split(".")[0]]||"tune"}"></ha-icon>`;
  }
  _assignedControls(room) {
    const names=systemsForRoom(this._config,room?.name),indexed=this._config.entities.map((entity,index)=>({entity,index})).filter(({entity})=>entity.room===room?.name);
    return names.map((name,position)=>{
      const key=JSON.stringify([room?.name||"",name]),open=Object.hasOwn(this._groupOpen||{},key)?this._groupOpen[key]:position===0||indexed.some(({entity})=>entity.system===name),entries=indexed.filter(({entity})=>entitySystems(entity).includes(name)),persistent=this._config.systems.find(s=>s.name===name)?.persistent;
      return `<details class="assigned-group" data-control-group="${escapeHTML(key)}" ${open?"open":""}><summary><span>${escapeHTML(roomSystemLabel(this._config,room.name,name))}</span><small>${entries.length} control${entries.length===1?"":"s"}${persistent?" · every room":""}</small></summary><div class="group-tools"><button data-action="workspace-add-controls" data-system="${escapeHTML(name)}" aria-label="Add controls to ${escapeHTML(name)}">Add controls</button><button data-action="workspace-system-options" data-system="${escapeHTML(name)}" aria-label="Edit ${escapeHTML(name)} in ${escapeHTML(room.name)}"><ha-icon icon="mdi:dots-horizontal"></ha-icon></button></div>${this._editingRoomSystem===name?this._roomSystemOptions(room,name,position,names):""}<ol class="control-rows">${entries.map(({entity,index},position)=>`<li data-reorder-entity="${escapeHTML(entity.entity_id)}" data-system="${escapeHTML(name)}" class="control-row ${this._editingEntity===entity.entity_id?"selected":""}"><button class="control-drag" data-drag-entity="${escapeHTML(entity.entity_id)}" data-system="${escapeHTML(name)}" aria-label="Drag to reorder ${escapeHTML(entity.label)}" title="Drag to reorder"><svg width="18" height="24" viewBox="0 0 18 24" aria-hidden="true" fill="currentColor"><circle cx="6" cy="6" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="12" cy="18" r="1.6"/></svg></button><button class="control-label" data-action="workspace-edit" data-entity="${escapeHTML(entity.entity_id)}" data-system="${escapeHTML(name)}">${this._icon(entity)}<span><strong>${escapeHTML(entity.label)}</strong><small>${escapeHTML(entity.entity_id)}</small></span></button><span class="membership-chips">${entitySystems(entity).map(system=>`<span>${escapeHTML(roomSystemLabel(this._config,room.name,system))}</span>`).join("")}</span><div class="control-order"><button data-action="workspace-move-up" data-entity="${escapeHTML(entity.entity_id)}" data-system="${escapeHTML(name)}" aria-label="Move ${escapeHTML(entity.label)} up in ${escapeHTML(name)}" ${position===0?"disabled":""}>↑</button><button data-action="workspace-move-down" data-entity="${escapeHTML(entity.entity_id)}" data-system="${escapeHTML(name)}" aria-label="Move ${escapeHTML(entity.label)} down in ${escapeHTML(name)}" ${position===entries.length-1?"disabled":""}>↓</button></div><button class="control-edit" data-action="workspace-edit" data-entity="${escapeHTML(entity.entity_id)}" data-system="${escapeHTML(name)}" aria-label="Edit ${escapeHTML(entity.label)}"><ha-icon icon="mdi:dots-horizontal"></ha-icon></button></li>`).join("")||'<li class="group-empty">No controls yet. Add existing Home Assistant entities.</li>'}</ol></details>`;
    }).join("")||'<div class="empty small"><h3>Add your first controls</h3><p>Choose entities from this HA room or search all entities. Systems can be linked while you add controls.</p><button data-action="workspace-add-controls">Add controls</button></div>';
  }
  _roomSystemOptions(room,name,index,order) {
    const persistent=this._config.systems.find(s=>s.name===name)?.persistent;
    return `<div class="system-local-options"><label class="field"><span>Display label in this room</span><input data-room-system-label="${escapeHTML(name)}" aria-label="Display label for ${escapeHTML(name)} in ${escapeHTML(room.name)}" value="${escapeHTML(room.system_labels?.[name]||"")}" placeholder="${escapeHTML(name)}" maxlength="64"></label><div class="row"><button data-action="builder-system-up" data-value="${escapeHTML(name)}" aria-label="Move ${escapeHTML(name)} system up in ${escapeHTML(room.name)}" ${index===0?"disabled":""}>Up</button><button data-action="builder-system-down" data-value="${escapeHTML(name)}" aria-label="Move ${escapeHTML(name)} system down in ${escapeHTML(room.name)}" ${index===order.length-1?"disabled":""}>Down</button>${room.systems.includes(name)?`<button class="danger" data-action="builder-unlink-system" data-value="${escapeHTML(name)}" aria-label="${persistent?"Remove controls for":"Unlink"} ${escapeHTML(name)} from ${escapeHTML(room.name)}">${persistent?"Remove controls":"Unlink"}</button>`:""}</div><p class="hint">${persistent?"Tab is visible in every room; controls stay room-specific.":"Unlink removes this system's placements in this room."}</p></div>`;
  }
  _entityEditor(entity,i) {
    const orderSystem=entitySystems(entity).includes(this._editingSystem)?this._editingSystem:entity.system,peers=this._config.entities.map((e,index)=>e.room===entity.room&&entitySystems(e).includes(orderSystem)?index:-1).filter(index=>index>=0);
    return `<li class="entity-inspector"><div class="inspector-scroll"><h2>Edit control</h2><div class="inspector-title">${this._icon(entity)}<div><strong>${escapeHTML(entity.label)}</strong><small>${escapeHTML(entity.entity_id)}</small></div></div><label class="field"><span>Label</span><input aria-label="Control label" data-entity-field="label" data-index="${i}" maxlength="80" value="${escapeHTML(entity.label)}"></label><label class="field"><span>Room</span><select aria-label="Control room" data-entity-field="room" data-index="${i}">${this._config.rooms.map(room=>this._option(room.name,room.name,entity.room)).join("")}</select></label><p class="hint">Changing room moves this control and its system memberships on this panel only.</p><fieldset class="membership-picker"><legend>Show in systems</legend>${systemsForRoom(this._config,entity.room).map(name=>`<label class="checkbox-field"><input type="checkbox" aria-label="Show ${escapeHTML(entity.label)} in ${escapeHTML(name)}" data-membership="${escapeHTML(name)}" data-index="${i}" ${entitySystems(entity).includes(name)?"checked":""}>${escapeHTML(roomSystemCaption(this._config,entity.room,name))}</label>`).join("")}</fieldset><p class="shared-note">One entity. Label, state, order and schedules stay shared across its systems.</p>${this._entitySchedules(entity,i)}<details class="capabilities"><summary>Automatic controls</summary><ul>${describeCapabilities(this._source(entity.entity_id),this._state(entity.entity_id)).map(item=>`<li>${escapeHTML(item)}</li>`).join("")}</ul><p class="hint">Home Assistant capabilities determine the tablet's controls.</p><h3>Order and defaults</h3><div class="row"><button data-action="up" data-system="${escapeHTML(orderSystem)}" data-index="${i}" aria-label="Move ${escapeHTML(entity.label)} up" ${peers.indexOf(i)===0?"disabled":""}>Up</button><button data-action="down" data-system="${escapeHTML(orderSystem)}" data-index="${i}" aria-label="Move ${escapeHTML(entity.label)} down" ${peers.indexOf(i)===peers.length-1?"disabled":""}>Down</button><button data-action="defaults" data-index="${i}">Restore HA defaults</button></div></details></div><div class="inspector-remove"><button class="danger" data-action="workspace-remove-placement" data-entity="${escapeHTML(entity.entity_id)}" data-system="${escapeHTML(entitySystems(entity).includes(this._editingSystem)?this._editingSystem:entity.system)}">Remove from ${escapeHTML(entitySystems(entity).includes(this._editingSystem)?roomSystemLabel(this._config,entity.room,this._editingSystem):roomSystemLabel(this._config,entity.room,entity.system))}</button><button class="danger" data-action="workspace-remove-room" data-entity="${escapeHTML(entity.entity_id)}">Remove from room</button></div></li>`;
  }
  _controlInspector() {
    const index=this._config.entities.findIndex(entity=>entity.entity_id===this._editingEntity);
    return `<ol class="entity-list inspector-list">${this._entityEditor(this._config.entities[index],index)}</ol>`;
  }
  _controls() {
    const room=this._config.rooms.find(r=>r.name===this._builderRoom)||this._config.rooms[0];if(room)this._builderRoom=room.name;
    const entries=this._config.entities.filter(e=>e.room===room?.name),placements=entries.reduce((sum,e)=>sum+entitySystems(e).length,0);
    return `<div class="room-workbench"><nav class="room-rail" aria-label="Configured rooms"><div class="rail-title"><h2>Rooms</h2><button data-action="builder-new-room" ${this._roomWizard?"disabled":""}>Add room</button></div>${this._config.rooms.map(item=>`<button class="room-select" data-action="workspace-room" data-room="${escapeHTML(item.name)}" aria-current="${item.name===room?.name?"true":"false"}"><span>${escapeHTML(item.name)}</span><small>${this._config.entities.filter(e=>e.room===item.name).length}</small></button>`).join("")||'<p class="hint">No rooms yet.</p>'}<details class="room-order"><summary>Room order</summary><button data-action="builder-room-up" ${!room||this._config.rooms.indexOf(room)===0?"disabled":""}>Move room up</button><button data-action="builder-room-down" ${!room||this._config.rooms.indexOf(room)===this._config.rooms.length-1?"disabled":""}>Move room down</button></details></nav><section class="room-content" aria-label="Room controls">${this._roomWizard?this._roomSetup():!room?'<div class="empty small"><h2>Create your first room</h2><p>Import an existing Home Assistant area or create a custom room. You can choose systems and controls as you go.</p><button class="primary" data-action="builder-new-room">Create room</button></div>':`<div class="room-heading"><div><h2>${escapeHTML(room.name)}</h2><p>${room.area_id?"HA area linked":"Custom room"} · ${entries.length} controls · ${placements} placements</p></div><div class="row"><button data-action="workspace-add-system">Add system</button><button class="primary" data-action="workspace-add-controls">Add controls</button><button data-action="workspace-room-options" aria-label="Edit ${escapeHTML(room.name)} room"><ha-icon icon="mdi:dots-horizontal"></ha-icon></button></div></div>${this._roomOptions?`<section class="room-options"><label class="field"><span>Rename room</span><input id="room-rename" maxlength="64" value="${escapeHTML(room.name)}"></label><div class="row"><button data-action="builder-rename-room">Rename room</button><button data-action="builder-room-up" ${this._config.rooms.indexOf(room)===0?"disabled":""}>Move room up</button><button data-action="builder-room-down" ${this._config.rooms.indexOf(room)===this._config.rooms.length-1?"disabled":""}>Move room down</button><button class="danger" data-action="builder-delete-room">Delete room</button></div><p class="hint">${room.area_id?`Linked HA area: ${escapeHTML(room.area_id)}`:"Manual room · panel only"}</p></section>`:""}${this._deleteRoomPanel()}${this._roomSystemAdd?this._roomSystemForm():""}${this._pickerOpen||this._builderSelection?.size?this._controlPicker(room):""}${this._assignedControls(room)}`}</section></div>`;
  }
  _controlPicker(room) {
    return `<section class="control-picker" aria-label="Add controls"><div class="section-title"><h3>Add controls to ${escapeHTML(room.name)}</h3><button data-action="workspace-close-picker">Close picker</button></div><div class="picker-filters"><label class="field"><span>Entity source filter</span><select id="builder-scope">${this._option("room","This HA room only",this._builderScope,!room.area_id)}${this._option("all","All entities",this._builderScope)}</select></label><label class="field"><span>Find entities</span><input id="entity-search" type="search" value="${escapeHTML(this._search)}" placeholder="Name, HA room or entity ID"></label></div><div id="candidates"></div><div class="row"><button data-action="builder-add-entities" class="primary" disabled>Add selected controls</button><button data-action="builder-clear-selection">Clear selected controls</button><button data-action="workspace-add-system">Create or link a system</button></div></section>`;
  }
  _roomSystemForm() {
    const choice=this._roomSystemChoice||"",catalog=systemCatalog(this._config,this._data.entities);
    return `<section class="room-system-form" aria-label="Add system to room"><h3>Add system to this room</h3><label class="field"><span>System</span><select id="room-system-choice" aria-label="System for room">${this._option("","Choose a system",choice)}${catalog.map(item=>this._option(item.name,`${item.name}${item.enabled?"":" · enable/create"}`,choice)).join("")}${this._option("__custom__","Create a custom system…",choice)}</select></label>${choice==="__custom__"?`<label class="field"><span>Custom system name</span><input id="room-system-name" maxlength="64" value="${escapeHTML(this._roomSystemName||"")}" placeholder="e.g. Sprinklers"></label>`:""}<p class="hint">Add confirms enabling and linking this system to this room in the draft. Existing controls are preserved.</p><div class="row"><button data-action="workspace-confirm-system" ${!choice?"disabled":""}>Add system to room</button><button data-action="workspace-cancel-system">Cancel</button></div></section>`;
  }
  _publishReview() {
    const before=normalizeConfig(this._data.panels.find(panel=>panel.device_id===this._selected)?.config),changes=configurationChanges(before,this._config),errors=this._validationErrors();
    return `<section class="publish-review" role="region" aria-label="Review changes"><h2>Review changes</h2><p>Only this tablet's configuration is updated. Home Assistant entities and areas are unchanged.</p><ul>${changes.map(line=>`<li>${escapeHTML(line)}</li>`).join("")||'<li>No configuration changes.</li>'}</ul>${errors.length?`<p class="message error">${escapeHTML(errors.join(" "))}</p>`:""}<div class="row"><button class="primary" data-action="publish" ${errors.length||this._busy?"disabled":""}>Publish to panel</button><button data-action="cancel-review">Keep editing</button></div></section>`;
  }
  _workspaceAction(action,button) {
    const id=button.dataset.entity,system=button.dataset.system;
    if(action==="workspace-move-up"||action==="workspace-move-down"){const index=this._config.entities.findIndex(e=>e.entity_id===id);if(moveEntityInGroup(this._config,index,action.endsWith("up")?"up":"down",system)){this._previewPage=0;this._mark();}return;}
    if(action==="workspace-room")return this._change({target:{id:"builder-room",value:button.dataset.room,dataset:{}}});
    if(action==="workspace-edit"||action==="workspace-edit-existing") {
      const entity=this._config.entities.find(e=>e.entity_id===id);if(!entity)throw new Error("This control no longer exists.");
      this._editingEntity=id;this._editingSystem=system||entity.system;this._builderRoom=entity.room;this._room=entity.room;this._inspector="control";
    } else if(action==="workspace-inspector")this._inspector="control";
    else if(action==="workspace-preview")this._inspector="preview";
    else if(action==="workspace-back-room"){this.shadowRoot.querySelector(".room-content")?.scrollIntoView?.({block:"start"});this.shadowRoot.querySelector(".room-heading button")?.focus?.({preventScroll:true});return;}
    else if(action==="workspace-room-options")this._roomOptions=!this._roomOptions;
    else if(action==="workspace-system-options")this._editingRoomSystem=this._editingRoomSystem===system?"":system;
    else if(action==="workspace-add-controls"){this._pickerOpen=true;this._candidateLimit=60;this._builderSystem=system||"";}
    else if(action==="workspace-more-candidates"){this._candidateLimit=(this._candidateLimit||60)+60;this._renderCandidates();this.shadowRoot.querySelector('[data-action="workspace-more-candidates"]')?.focus?.({preventScroll:true});return;}
    else if(action==="workspace-close-picker"){this._pickerOpen=false;this._builderSelection=new Set();this._builderAssignments={};}
    else if(action==="workspace-add-system"){this._roomSystemAdd=true;this._roomSystemChoice="";this._roomSystemName="";}
    else if(action==="workspace-cancel-system")this._roomSystemAdd=false;
    else if(action==="workspace-confirm-system") {
      const name=this._roomSystemChoice==="__custom__"?this.shadowRoot.querySelector("#room-system-name")?.value.trim():this._roomSystemChoice;
      this._config=prepareRoomSystems(this._config,[name],this._builderRoom);this._roomSystemAdd=false;this._builderSystem=name;this._mark("System enabled and linked in this draft. Publish to apply.");return;
    } else if(action==="workspace-remove-placement"||action==="workspace-remove-room") {
      const entity=this._config.entities.find(item=>item.entity_id===id);if(!entity)return;
      if(!confirm(`${action==="workspace-remove-room"?"Remove all placements of":"Remove this system placement of"} ${entity.label}?${entity.schedule_ids?.length?" The last placement removes this control's schedule assignments.":""}${this._config.security.alarm_entity===id?" Removing its last placement clears the selected panel alarm.":""} Home Assistant is unchanged. Publish applies this change.`))return;
      if(action==="workspace-remove-placement")removeEntityPlacement(this._config,id,system);
      else {this._config.entities=this._config.entities.filter(item=>item!==entity);if(this._config.security.alarm_entity===id)this._config.security.alarm_entity="";}
      if(!this._config.entities.some(item=>item.entity_id===id)){this._editingEntity="";this._inspector="preview";}this._mark();return;
    }
    this._saveDraft();this._render();
    if(["workspace-edit","workspace-edit-existing","workspace-inspector"].includes(action)) {
      this.shadowRoot?.querySelector?.('[aria-label="Control label"]')?.focus?.({preventScroll:true});
      if(this.clientWidth<=1150||globalThis.matchMedia?.("(max-width:960px)")?.matches)this.shadowRoot?.querySelector?.(".context-pane")?.scrollIntoView?.({block:"start"});
    } else if(action==="workspace-add-controls")this.shadowRoot?.querySelector?.("#entity-search")?.focus?.();
  }
  _queueCandidateSearch(value) {
    this._search=value;this._candidateLimit=60;clearTimeout(this._candidateTimer);
    this.shadowRoot?.querySelector("#candidates")?.setAttribute?.("aria-busy","true");
    this._candidateTimer=setTimeout(()=>this._renderCandidates(),160);
  }
  _assignmentFor(source,available) {
    available ||= systemCatalog(this._config,this._data.entities).filter(item=>item.enabled||!item.configured).map(item=>item.name);
    if(Object.hasOwn(this._builderAssignments||{},source.entity_id)){const value=this._builderAssignments[source.entity_id];return available.includes(value)?value:"";}
    return this._builderSystem&&available.includes(this._builderSystem)?this._builderSystem:available.includes(source.system)?source.system:"";
  }
  _updateAddButton(available) {
    const selected=[...(this._builderSelection||[])],button=this.shadowRoot?.querySelector('[data-action="builder-add-entities"]');
    if(button){available ||= systemCatalog(this._config,this._data.entities).filter(item=>item.enabled||!item.configured).map(item=>item.name);const sources=new Map(this._data.entities.map(source=>[source.entity_id,source]));button.disabled=!selected.length||selected.some(id=>!sources.has(id)||!this._assignmentFor(sources.get(id),available));}
    const count=this.shadowRoot?.querySelector("#candidate-count");if(count)count.textContent=`${selected.length} selected to add. Choose a system for each entity; Add confirms any required enabling and room links.`;
  }
  _renderCandidates() {
    clearTimeout(this._candidateTimer);this._candidateTimer=null;
    const root=this.shadowRoot?.querySelector("#candidates");if(!root)return;
    const room=this._config.rooms.find(r=>r.name===this._builderRoom),entities=candidatesForRoom(this._data.entities,room,this._builderScope,this._search),available=systemCatalog(this._config,this._data.entities).filter(item=>item.enabled||!item.configured).map(item=>item.name),linked=new Set(systemsForRoom(this._config,this._builderRoom)),assigned=new Map(this._config.entities.map(entity=>[entity.entity_id,entity]));
    const captions=new Map(available.map(name=>[name,`${roomSystemCaption(this._config,this._builderRoom,name)}${!linked.has(name)?" · enable/link":""}`])),visible=entities.slice(0,this._candidateLimit||60);
    root.setAttribute?.("aria-busy","false");
    root.innerHTML=`<p class="hint" id="candidate-count"></p><p class="hint" role="status">${entities.length} matching · showing ${visible.length}. Search covers all HA entities; selections stay when you change the search.</p><div class="candidate-list">${visible.map(source=>{
      const existing=assigned.get(source.entity_id),assignment=this._assignmentFor(source,available);
      return `<div class="candidate"><label class="candidate-choice"><input type="checkbox" data-builder-entity="${escapeHTML(source.entity_id)}" ${this._builderSelection?.has(source.entity_id)?"checked":""} ${existing?"disabled":""}><span><strong>${escapeHTML(source.name||source.entity_id)}</strong><small>${escapeHTML(source.entity_id)} · ${escapeHTML(source.room||"Unassigned")}</small>${existing?`<small>Already assigned to ${escapeHTML(existing.room)} / ${escapeHTML(existing.system)}. Edit its assignment; it will not be duplicated.</small>`:""}</span></label>${existing?`<button data-action="workspace-edit-existing" data-entity="${escapeHTML(existing.entity_id)}">Edit assignment</button>`:`<label class="field candidate-system"><span>System</span><select aria-label="System for ${escapeHTML(source.name||source.entity_id)}" data-builder-assignment="${escapeHTML(source.entity_id)}">${this._option("","Choose system",assignment)}${available.map(name=>this._option(name,captions.get(name),assignment)).join("")}</select></label>`}</div>`;
    }).join("")||"<p>No matching entities. Change the source filter or search.</p>"}</div>${visible.length<entities.length?`<button data-action="workspace-more-candidates">Show ${Math.min(60,entities.length-visible.length)} more</button>`:""}`;
    this._updateAddButton(available);
  }

  _source(entityId) { return this._data.entities.find(e=>e.entity_id===entityId) || {entity_id:entityId,name:entityId}; }
  _state(entityId) {
    const source = this._source(entityId);
    return this._hass?.states?.[entityId] || (source.state!==undefined ? {state:source.state,attributes:source.attributes||{}} : null);
  }
  _security() {
    const security=this._config.security,alarms=[...new Map([...this._data.entities.filter(e=>e.entity_id.startsWith("alarm_control_panel.")),...this._config.entities.filter(e=>e.entity_id.startsWith("alarm_control_panel."))].map(e=>[e.entity_id,{...e,label:e.label||e.name||e.entity_id}])).values()];
    if(security.alarm_entity&&!alarms.some(e=>e.entity_id===security.alarm_entity))alarms.push({entity_id:security.alarm_entity,label:`${security.alarm_entity} (unavailable in HA)`});
    const needsPlacement=security.alarm_entity&&!this._config.entities.some(e=>e.entity_id===security.alarm_entity),defaultSystem=this._config.systems.some(s=>s.name==="Security"&&s.enabled!==false)?"Security":"";
    const placement=needsPlacement?`<section class="wizard" aria-label="Add alarm to panel"><h3>Add this alarm to the panel</h3><p>Choose where its controls should appear. This changes the panel layout only.</p><label class="field"><span>Alarm room</span><select id="alarm-room">${this._option("","Choose room","")}${this._config.rooms.map(r=>this._option(r.name,r.name,"")).join("")}</select></label><label class="field"><span>Alarm control system</span><select id="alarm-system">${this._option("","Choose system",defaultSystem)}${this._config.systems.filter(s=>s.enabled!==false).map(s=>this._option(s.name,s.name,defaultSystem)).join("")}</select></label><button data-action="builder-add-alarm" ${!this._config.rooms.length||!this._config.systems.some(s=>s.enabled!==false)?"disabled":""}>Add alarm to selected room</button>${!this._config.rooms.length||!this._config.systems.some(s=>s.enabled!==false)?'<p class="hint">Create a room in Rooms and enable a system in Systems first.</p>':""}</section>`:"";
    const source = this._source(security.alarm_entity), alarmState = this._state(security.alarm_entity);
    const attributes = alarmState?.attributes || source.attributes || {};
    const noPin = Object.hasOwn(attributes,"code_format") && !attributes.code_format;
    return `<h2>Security</h2><p>Choose the alarm and read-only security sensor and door statuses shown on this touchscreen. These settings do not change Alarmo configuration.</p>${this._select("Alarm system","security.alarm_entity",[["","No alarm selected"],...alarms.map(e=>[e.entity_id,e.label])],security.alarm_entity)}${!alarms.length?`<p class="hint">No alarm entities were reported by Home Assistant. After adding one in HA, use Refresh panels to update this list.</p>`:""}${placement}${security.alarm_entity?`<div class="alarm-summary"><strong>${escapeHTML(source.name||security.alarm_entity)}</strong><span>${escapeHTML(alarmState?.state?.replaceAll("_"," ")||"Unavailable")}</span><p class="hint">${escapeHTML(describeCapabilities(source,alarmState).join(" · "))}</p><p class="hint">Use the touchscreen keypad and press Enter to disarm; arm modes have their own buttons. No PIN is stored in this layout or editor.</p>${noPin?`<p class="pin-warning">Home Assistant does not require a PIN for this alarm. Configure a code in the alarm integration if disarming must require one.</p>`:""}</div>`:""}<h3>Security sensors and doors</h3><p>Choose doors, windows, garage doors, motion, occupancy, camera detection or other safety sensors. Battery and connectivity diagnostics are excluded. Selection adds read-only statuses, not control permissions.</p><label class="field"><span>Find security sensors and doors</span><input id="security-search" type="search" value="${escapeHTML(this._securitySearch)}" placeholder="Sensor or door name, room or entity ID"></label><div id="security-sensors"></div>`;
  }
  _renderSecuritySensors() {
    const root = this.shadowRoot?.querySelector("#security-sensors"); if (!root) return;
    const selected = new Set(this._config.security.sensor_entities), query = this._securitySearch.toLowerCase();
    const sources = securityCandidates(this._data.entities), eligible = new Set(sources.map(entity=>entity.entity_id));
    const unsupported = [...selected].filter(id=>!eligible.has(id));
    const alarm = this._config.security.alarm_entity, source = this._data.entities.find(e=>e.entity_id===alarm);
    const linked = Array.isArray(source?.sensor_entities) ? [...new Set(source.sensor_entities)].filter(id=>eligible.has(id)) : null;
    const linkedSelected = linked?.filter(id=>selected.has(id)).length || 0;
    const sensors = sources.filter(e=>`${e.name} ${e.room} ${e.entity_id}`.toLowerCase().includes(query));
    const bulk = alarm ? `<label class="checkbox-field"><input id="security-select-linked" type="checkbox" ${linked?.length&&linkedSelected===linked.length?"checked":""} ${linked?.length?"":"disabled"}>Select all sensors linked to this alarm</label><p class="hint">${!linked?"This alarm integration does not report linked sensors. Select sensors individually below.":!linked.length?"No linked sensors were reported for this alarm. Select any security sensors below.":`${linkedSelected} of ${linked.length} linked sensors selected. Check to add all; uncheck to remove only linked sensors. Other selections stay unchanged.`} All security sensors remain available below. Publish to update the panel.</p>` : "";
    root.innerHTML = `${bulk}<p class="hint">${selected.size-unsupported.length} of 64 security statuses selected</p>${unsupported.length?`<p class="pin-warning">${unsupported.length} previous selection(s) are no longer eligible security sensors. They are preserved in this draft until you remove them. Other settings are unchanged.</p><button data-action="remove-ineligible-security">Remove unsupported security selections</button>`:""}${!selected.size?"<p>No security sensors selected. Choose sensors in the companion.</p>":""}<div class="candidate-list">${sensors.map(e=>{
      const state = this._state(e.entity_id)?.state || "unavailable";
      return `<label class="candidate"><input type="checkbox" data-security-sensor="${escapeHTML(e.entity_id)}" ${selected.has(e.entity_id)?"checked":""} ${selected.size>=64&&!selected.has(e.entity_id)?"disabled":""}><span><strong>${escapeHTML(e.name||e.entity_id)}</strong><small>${escapeHTML(e.entity_id)} · ${escapeHTML(e.room||"Unassigned")}</small></span><span class="sensor-state" data-security-state="${escapeHTML(e.entity_id)}">${escapeHTML(state.replaceAll("_"," "))}</span></label>`;
    }).join("")||"<p>No matching security-related sensors or doors.</p>"}</div>`;
  }
  _alerts() {
    const active = this._data.panels.find(p=>p.device_id===this._selected)?.alerts || [];
    return `<div class="section-title"><div><h2>Alerts</h2><p>Monitor entity states independently of your control tiles.</p></div><button data-action="add-alert" ${this._config.alerts.length>=32?"disabled":""}>Add alert rule</button></div><section class="active-alerts"><div class="section-title"><h3>Active alerts · last refresh</h3><button data-action="refresh-alerts">Refresh alert status</button></div>${active.length?`<ul>${active.map(alert=>`<li><div><strong>${escapeHTML(alert.label)}</strong><small>${escapeHTML(alert.entity_id)} · ${escapeHTML(alert.state)}</small></div><button data-action="ack-alert" data-alert-id="${escapeHTML(alert.id)}" aria-label="Acknowledge ${escapeHTML(alert.label)} for one hour">Acknowledge 1 hour</button></li>`).join("")}</ul>`:"<p>No active unsnoozed alerts at the last refresh.</p>"}<p class="hint">Acknowledgement silences only this rule on this panel for one hour, even if it clears and reopens. It never changes your alarm or the source entity. No chime is played.</p></section>${!this._config.alerts.length?`<div class="empty small"><h3>No alert rules</h3><p>Add a rule, choose an entity and set the state to watch. The entity does not need a control tile.</p></div>`:`<ol class="alert-rules">${this._config.alerts.map((alert,i)=>{
      const delay = this._delayDraft(alert);
      const candidates = [...this._data.entities];
      if (alert.entity_id && !candidates.some(e=>e.entity_id===alert.entity_id)) candidates.push({entity_id:alert.entity_id,name:`${alert.entity_id} (not currently available)`});
      return `<li><div class="entity-top"><h3>${escapeHTML(alert.label||"New alert")}</h3><button class="danger" data-action="delete-alert" data-index="${i}" aria-label="Delete ${escapeHTML(alert.label||"new alert")}">Delete rule</button></div><label class="field"><span>Target entity</span><select aria-label="Target entity for alert ${i+1}" data-alert-field="entity_id" data-index="${i}"><option value="">Choose an entity</option>${candidates.map(e=>this._option(e.entity_id,`${e.name||e.entity_id} · ${e.entity_id}`,alert.entity_id)).join("")}</select></label><label class="field"><span>Alert label</span><input aria-label="Label for alert ${i+1}" data-alert-field="label" data-index="${i}" maxlength="80" value="${escapeHTML(alert.label)}"></label><div class="entity-fields"><label class="field"><span>Watch for</span><select aria-label="Condition for alert ${i+1}" data-alert-field="condition" data-index="${i}">${[["open","Open"],["on","On"],["off","Off"],["unavailable","Unavailable"]].map(([value,label])=>this._option(value,label,alert.condition)).join("")}</select></label><div class="delay-fields"><label class="field"><span>Delay amount</span><input aria-label="Delay amount for alert ${i+1}" type="number" min="0" step="any" data-delay-amount="${escapeHTML(alert.id)}" data-index="${i}" value="${escapeHTML(delay.amount)}"></label><label class="field"><span>Delay unit</span><select aria-label="Delay unit for alert ${i+1}" data-delay-unit="${escapeHTML(alert.id)}" data-index="${i}">${[["seconds","Seconds"],["minutes","Minutes"],["hours","Hours"]].map(([value,label])=>this._option(value,label,delay.unit)).join("")}</select></label><p class="hint" data-delay-feedback="${escapeHTML(alert.id)}">${escapeHTML(delay.error||`${alert.delay_seconds} seconds stored exactly`)}</p></div></div><label class="checkbox-field"><input type="checkbox" data-alert-field="enabled" data-index="${i}" ${alert.enabled?"checked":""}>Enable this alert</label><p class="hint">Open means a binary sensor is on, or a cover is open/opening/closing. Delay requires the condition to remain true. Maximum 24 hours; fractions must resolve to whole seconds. Changing units preserves the exact stored delay. Publish to apply rule changes.</p></li>`;
    }).join("")}</ol>`}`;
  }
  _entitySchedules(entity,index) {
    const source=this._source(entity.entity_id),eligible=scheduleEligible(source),assigned=entity.schedule_ids||[];
    if(!eligible&&!assigned.length)return "";
    return `<details class="capabilities"><summary>Schedules${assigned.length?` (${assigned.length})`:""}</summary><p class="hint">Home Assistant runs these rules even when the screen is off. No action runs when you assign or publish them.</p>${!eligible?'<p class="hint">This entity no longer advertises the required on/off or open/close actions. Remove its assignments before publishing.</p>':""}${this._config.schedules.length?`<fieldset class="schedule-bindings"><legend>Schedules for ${escapeHTML(entity.label)}</legend>${this._config.schedules.map(rule=>`<label class="checkbox-field"><input type="checkbox" data-bind-schedule="${escapeHTML(rule.id)}" data-index="${index}" ${assigned.includes(rule.id)?"checked":""} ${!eligible&&!assigned.includes(rule.id)?"disabled":""}>${escapeHTML(rule.name)}${rule.enabled?"":" (disabled)"}</label>`).join("")}</fieldset>`:'<p class="hint">No schedules created yet. Create a rule, then explicitly assign it here.</p>'}<button data-action="tab" data-tab="schedules">Manage schedules</button></details>`;
  }
  _schedules() {
    const timezone=this._data.time_zone||this._hass?.config?.time_zone||"Not reported by Home Assistant";
    const weekdays=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
    return `<div class="section-title"><div><h2>Schedules</h2><p>Home Assistant time zone: <strong>${escapeHTML(timezone)}</strong></p></div><button data-action="add-schedule" ${this._config.schedules.length>=32?"disabled":""}>Create schedule</button></div><p>Schedules run in Home Assistant, independently of panel power. Create a rule here, then assign it under a control's Schedules options in Rooms.</p><p class="hint">Rules are independent: overlapping rules can send opposing actions. An off time before the on time means the following day. Missed times while Home Assistant is offline are not replayed. Creating, editing and assigning never triggers a device immediately.</p>${!this._config.schedules.length?'<p>No schedules configured. Nothing is automatically assigned.</p>':`<ol class="entity-list">${this._config.schedules.map((rule,i)=>{
      const input=(label,key,type="text",extra="")=>`<label class="field"><span>${label}</span><input aria-label="${label} for schedule ${i+1}" type="${type}" data-schedule-field="${key}" data-index="${i}" value="${escapeHTML(rule[key])}" ${extra}></label>`;
      const count=this._config.entities.filter(entity=>entity.schedule_ids?.includes(rule.id)).length;
      return `<li><div class="entity-top"><h3>${escapeHTML(rule.name||"New schedule")}</h3><button class="danger" data-action="delete-schedule" data-index="${i}" aria-label="Delete schedule ${i+1}">Delete schedule</button></div>${input("Schedule name","name","text",'maxlength="63"')}<label class="field"><span>Repeat</span><select aria-label="Repeat for schedule ${i+1}" data-schedule-field="kind" data-index="${i}">${[["weekly","Weekly"],["once","Once"],["range","Date range"]].map(([value,label])=>this._option(value,label,rule.kind)).join("")}</select></label>${rule.kind!=="weekly"?`<div class="entity-fields">${input(rule.kind==="once"?"Date":"Start date","start_date","date")}${rule.kind==="range"?input("End date","end_date","date"):""}</div>`:""}${rule.kind!=="once"?`<fieldset class="schedule-days"><legend>Run on</legend>${weekdays.map((day,index)=>`<label class="checkbox-field"><input type="checkbox" aria-label="${day} for schedule ${i+1}" data-schedule-weekday="${index}" data-index="${i}" ${rule.weekdays.includes(index)?"checked":""}>${day}</label>`).join("")}</fieldset>`:""}<div class="entity-fields">${input("On / open time","on_time","time",'step="60"')}${input("Off / close time","off_time","time",'step="60"')}</div><label class="checkbox-field"><input type="checkbox" data-schedule-field="enabled" data-index="${i}" ${rule.enabled?"checked":""}>Enable ${escapeHTML(rule.name||"this schedule")}</label><p class="hint">${count} control${count===1?"":"s"} assigned · ${escapeHTML(rule.id)}${rule.off_time<rule.on_time?" · Off / close runs on the following day":""}</p></li>`;
    }).join("")}</ol>`}`;
  }
  _layout() {
    const c = this._config;
    return `<h2>Layout</h2><p>One room/system layout, with menus positioned to suit the wall.</p>${this._field("Panel name in Home Assistant","name",c.name,"text",'maxlength="63"')}${this._select("Vertical menu","menu.vertical",[["rooms","Rooms"],["systems","Systems"]],c.menu.vertical)}${this._select("Vertical menu position","menu.side",[["left","Left"],["right","Right"]],c.menu.side)}${this._select("Horizontal menu position","menu.horizontal",[["bottom","Bottom"],["top","Top"]],c.menu.horizontal)}<label class="checkbox-field"><input type="checkbox" aria-label="Show All rooms" data-field="menu.show_all_rooms" ${c.menu.show_all_rooms!==false?"checked":""}>Show All rooms</label><p class="hint">When hidden, the panel opens on the first configured room.</p><label class="checkbox-field"><input type="checkbox" aria-label="Show All systems" data-field="menu.show_all_systems" ${c.menu.show_all_systems!==false?"checked":""}>Show All systems</label><p class="hint">When hidden, the first available system is selected. Controls still appear in each assigned system.</p><p class="hint">The horizontal menu shows ${c.menu.vertical==="rooms"?"systems":"rooms"}. All systems combines controls within the selected room.</p><h3>Local setup stays on the touchscreen</h3><p>Wi-Fi, Home Assistant pairing, brightness, screen-off timeout, touch wake and speaker volume remain available on the device, even when HA is offline.</p>`;
  }
  _theme() {
    const t = this._config.theme,modern=Object.entries(MODERN_BLUE_THEME).every(([key,value])=>t[key]===value);
    return `<h2>Theme</h2><p>Style the interface without changing its controls.</p><label class="field"><span>Theme preset</span><select id="theme-preset" aria-label="Theme preset"><option value="" ${modern?"":"selected"}>Current / custom theme</option><option value="modern-blue" ${modern?"selected":""}>Modern blue</option></select></label><p class="hint">Presets change colours, corners and button surfaces. Background images, photos, controls and menu positions are retained.</p><div class="color-fields">${[["background","Background"],["foreground","Text"],["accent","Selected controls"],["button","Button surface"]].map(([key,label])=>this._field(label,`theme.${key}`,t[key],"color")).join("")}</div>${this._field("Button corner radius","theme.radius",t.radius,"number",'min="0" max="32" step="1"')}<label class="checkbox-field"><input aria-label="Show button borders" type="checkbox" data-field="theme.border_width" ${t.border_width===1?"checked":""}>Show button borders</label>${t.border_width===1?this._field("Border color","theme.border_color",t.border_color,"color"):`<p class="hint">Button borders are hidden. Your border color is kept for when you turn them on again.</p>`}${this._select("Button style","theme.button_style",[["solid","Solid"],["glass","Glass"]],t.button_style)}${t.button_style==="glass"?`<label class="field"><span>Glass opacity: <output data-theme-output="theme.glass_opacity">${t.glass_opacity}</output>%</span><input aria-label="Glass opacity" type="range" min="0" max="100" step="1" data-field="theme.glass_opacity" value="${t.glass_opacity}"></label><label class="field"><span>Glass frost: <output data-theme-output="theme.glass_blur">${t.glass_blur}</output></span><input aria-label="Glass frost" type="range" min="0" max="20" step="1" data-field="theme.glass_blur" value="${t.glass_blur}"></label><p class="hint">Frost 0 keeps the background clear through buttons; higher values blur it. Opacity controls the button tint, from clear (0%) to solid (100%). Check text readability against your photo.</p>`:""}<h3>Full-screen background image</h3><p>JPEG or PNG, up to 4 MiB. The image fills the whole screen, including behind the title and menu rails. The server prepares an image for this screen.</p><div class="row"><button data-action="background">Upload background</button>${t.background_asset?`<button data-action="clear-background">Remove background</button>`:""}</div>${t.background_asset?`<p class="hint">Background image configured.</p>`:""}<h3>Portable themes</h3><p>Export colours, button style and photos. Entity assignments and panel identity stay private.</p><div class="row"><button data-action="export">Export theme</button><button data-action="import">Import theme</button></div>`;
  }
  _photos() {
    const s = this._config.screensaver;
    return `<h2>Photo screensaver</h2><p>Show your photos while the panel is idle. The first touch returns to controls without activating them.</p>${this._select("Screensaver mode","screensaver.mode",[["off","Off"],["photos","Photo frame"]],s.mode)}${this._field("Start after inactivity (seconds)","screensaver.idle_seconds",s.idle_seconds,"number",'min="15" max="3600" step="1"')}${this._field("Change photo every (seconds)","screensaver.interval_seconds",s.interval_seconds,"number",'min="5" max="3600" step="1"')}<button data-action="photo">Upload photos</button><p class="hint">${s.photos.length} of 20 photos · JPEG/PNG up to 4 MiB each. Screen-off timing is configured on the touchscreen.</p><ol class="photo-list">${s.photos.map((id,i)=>`<li><span>Photo ${i+1}</span><button class="danger" data-action="remove-photo" data-index="${i}">Remove photo ${i+1}</button></li>`).join("")}</ol>`;
  }
  _screenAppearance() {
    const theme=this._config.theme,asset=this._assetCache?.get(theme.background_asset);
    const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(",");
    const image=asset?`background-image:url(data:image/${asset.filename?.toLowerCase().endsWith("png")?"png":"jpeg"};base64,${asset.data});`:"";
    const selectedForeground=theme.button_style==="glass"?(theme.border_width===0?theme.accent:theme.foreground):"#101820";
    const style=`${image}--panel-button-rgb:${rgb(theme.button)};--panel-accent-rgb:${rgb(theme.accent)};--panel-glass-opacity:${theme.glass_opacity/100};--panel-glass-blur:${theme.glass_blur}px;--panel-border-color:${theme.border_color};--panel-border-width:${theme.border_width}px;--panel-selected-fg:${selectedForeground};--panel-active:${activeTileColor(theme.accent,theme.button)};--panel-active-rgb:${rgb(activeTileColor(theme.accent,theme.button))};`;
    return `class="native-screen ${theme.button_style==="glass"?"glass":"solid"}" style="${style}"`;
  }
  _cyclePreviewAxis(direction) {
    const rooms=this._config.menu.vertical==="systems",values=rooms?this._config.rooms.map(room=>room.name):systemsForRoom(this._config,this._room);
    if(rooms?this._config.menu.show_all_rooms!==false:this._config.menu.show_all_systems!==false)values.unshift("");
    if(rooms){this._room=cycleSystem(values,this._room,direction);if(!systemsForRoom(this._config,this._room).includes(this._system))this._system="";}
    else this._system=cycleSystem(values,this._system,direction);
    this._previewPage=0;this._sensorPreviewPage=0;this._render();
  }
  _previewSystemWheel(systems,selected,g,delta=0,kind="systems") {
    const values=(kind==="rooms"?this._config.menu.show_all_rooms:this._config.menu.show_all_systems)===false?systems:["",...systems],slots=carouselSlots(values,selected,delta),icons={Lights:"M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 3H9Z",HVAC:"M12 3v18M4 7l16 10M4 17 20 7M9 5l3 3 3-3M9 19l3-3 3 3",Climate:"M12 3v18M4 7l16 10M4 17 20 7",Covers:"M5 3h14v14H5Zm0 4h14M5 11h14M5 15h14M12 17v4",Switches:"M7 3h10v18H7Zm5 5v2m0 4v2",Security:"M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z",Fans:"M12 11C2 2 18 0 14 10m-1 2c13-3 6 12 0 3m-2-2c-3 13-12 0-2-1",Cameras:"M3 6h13v12H3Zm13 4 5-3v10l-5-3"};
    const cards=slots.map(slot=>{const title=kind==="rooms"?slot.value||"All rooms":slot.value?roomSystemLabel(this._config,this._room,slot.value):"All systems",path=kind==="rooms"?"m3 11 9-8 9 8M6 9v12h12V9M10 21v-7h4v7":slot.value?icons[slot.value]||"M5 5h5v5H5Zm9 0h5v5h-5ZM5 14h5v5H5Zm9 0h5v5h-5Z":"m3 11 9-8 9 8M6 9v12h12V9M10 21v-7h4v7",small=Math.abs(slot.distance)>1.5||title.length>7,active=slot.value===selected;
      const face=active?`<defs><linearGradient id="wheel-focus-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#4C7783"/><stop offset="1" stop-color="#1B3642"/></linearGradient></defs><rect x="1.5" y="1.5" width="${slot.width-3}" height="${slot.height-3}" rx="8" fill="url(#wheel-focus-fill)" fill-opacity=".86" stroke="#BFFAFF" stroke-width="3"/>`:`<path d="${wheelFacePath(slot.width,slot.height,slot.distance)}" fill="#293D4C" fill-opacity=".706" stroke="#A5BECF" stroke-opacity=".47"/>`;
      return `<button class="native-control native-wheel-card ${active?"selected":""}" data-action="preview-${kind==="rooms"?"room":"system"}" data-value="${escapeHTML(slot.value)}" aria-label="${escapeHTML(title)}" aria-pressed="${active}" style="left:${slot.x}px;top:${slot.y}px;width:${slot.width}px;height:${slot.height}px;"><svg class="native-wheel-face" width="${slot.width}" height="${slot.height}" viewBox="0 0 ${slot.width} ${slot.height}" aria-hidden="true">${face}</svg><svg class="native-wheel-icon" style="left:${(slot.width-24)/2}px;top:${Math.abs(slot.distance)>1.5?5:8}px" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span style="left:5px;bottom:1px;width:${slot.width-10}px;height:${small?18:24}px;font-size:${small?14:20}px;line-height:${small?18:24}px">${escapeHTML(title)}</span></button>`;}).join("");
    const track='<svg class="native-wheel-track" width="804" height="78" viewBox="0 0 804 78" aria-hidden="true"><path d="M56 60 Q402 88 748 60" stroke="#C8FAFF" stroke-width="12" opacity=".078"/><path d="M56 60 Q402 88 748 60" stroke="#C8FAFF" stroke-width="6" opacity=".216"/><path d="M56 60 Q402 88 748 60" stroke="#C8FAFF" stroke-width="2" opacity=".902"/></svg>';
    return `<nav class="native-menu native-row native-carousel" tabindex="0" aria-label="Preview ${kind}" data-axis="${kind}" data-selected="${escapeHTML(selected)}" aria-roledescription="looping carousel" style="left:${g.rowX}px;top:${g.rowY}px;width:804px;height:78px">${track}${cards}</nav>`;
  }
  _updatePreviewWheel(delta) {
    const menu=this.shadowRoot?.querySelector(".native-carousel");if(!menu)return;
    const kind=menu.dataset.axis||"systems",values=kind==="rooms"?this._config.rooms.map(room=>room.name):systemsForRoom(this._config,this._room),selected=menu.dataset.selected;
    const html=this._previewSystemWheel(values,selected,{rowX:0,rowY:0},delta,kind);
    // Reuse the navigation node so pointer events remain in the same interaction surface.
    menu.innerHTML=html.slice(html.indexOf(">")+1,html.lastIndexOf("</nav>"));
  }

  _previewButton(text,x,y,width,height,options={}) {
    const action=options.action?`data-action="${options.action}" data-value="${escapeHTML(options.value||"")}"`:"";
    const content=options.icon==="more"?'<svg width="28" height="24" viewBox="0 0 28 24" aria-hidden="true"><circle cx="6" cy="12" r="2" fill="currentColor"/><circle cx="14" cy="12" r="2" fill="currentColor"/><circle cx="22" cy="12" r="2" fill="currentColor"/></svg>':options.icon?`<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="${options.icon==="previous"?"M15 5 8 12l7 7":"m9 5 7 7-7 7"}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`:escapeHTML(text);
    return `<button class="native-control ${options.selected?"selected":""} ${options.className||""}" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px;${options.style||""}" ${action} ${options.icon||options.ariaLabel?`aria-label="${escapeHTML(options.ariaLabel||text)}"`:""} ${!options.action||options.disabled?"disabled":""}>${content}</button>`;
  }
  _previewFrame(body,security=false,count=0,pageCount=0) {
    const c=this._config,g=previewGeometry(c.menu),rooms=c.rooms.map(r=>r.name),systems=systemsForRoom(c,this._room),pages=pageCount||Math.ceil(count/9),paged=pages>1;
    const alarm=c.entities.find(e=>e.entity_id===c.security.alarm_entity);
    if(c.menu.show_all_systems===false&&!this._system)this._system=systems[0]||"";
    const alarmSystems=alarm?entitySystems(alarm):["Security"],system=security?(alarmSystems.includes(this._system)&&systems.includes(this._system)?this._system:alarmSystems.find(name=>systems.includes(name))||this._system):this._system;
    const menu=(kind,vertical)=>{
      const values=kind==="rooms"?rooms:systems,selected=kind==="rooms"?this._room:system;
      if(!vertical)return this._previewSystemWheel(values,selected,g,0,kind);
      return `<nav class="native-menu ${vertical?"native-rail":"native-row"}" tabindex="0" aria-label="Preview ${kind}" style="left:${vertical?g.railX:g.rowX}px;top:${vertical?0:g.rowY}px;width:${vertical?220:804}px;height:${vertical?520:78}px">${((kind==="rooms"?c.menu.show_all_rooms:c.menu.show_all_systems)===false?values:["",...values]).map((value,i)=>this._previewButton(value?(kind==="systems"?roomSystemLabel(c,this._room,value):value):(kind==="rooms"?"All rooms":"All systems"),vertical?(kind==="rooms"?12:22):12+i*(kind==="rooms"?166:146),vertical?14+i*66:10,vertical?(kind==="rooms"?196:176):(kind==="rooms"?156:136),56,{action:kind==="rooms"?"preview-room":"preview-system",value,selected:selected===value})).join("")}</nav>`;
    };
    const panel=this._data.panels?.find(p=>p.device_id===this._selected),alerts=panel?.alerts||[];
    const pager=paged?`${this._previewButton("Previous",g.bodyX+264,g.nameY,48,48,{action:"preview-page",value:"-1",icon:"previous",disabled:this._previewPage===0})}<span class="native-page-count" style="left:${g.bodyX+318}px;top:${g.nameY+14}px;width:64px">${this._previewPage+1}/${pages}</span>${this._previewButton("Next",g.bodyX+386,g.nameY,48,48,{action:"preview-page",value:"1",icon:"next",disabled:this._previewPage===pages-1})}`:"";
    return `<div ${this._screenAppearance()}>${menu(c.menu.vertical,true)}${menu(c.menu.vertical==="rooms"?"systems":"rooms",false)}<strong class="native-name" style="left:${g.bodyX}px;top:${g.nameY}px;width:${paged?252:432}px">${escapeHTML(c.name)}</strong><span class="native-status" style="left:${g.bodyX}px;top:${g.statusY}px;width:${paged?252:432}px">${panel?.online?"Home Assistant connected":"Home Assistant offline"}</span>${pager}${this._previewButton("Schedules",g.bodyX+446,g.nameY,136,48,{className:"native-schedule-button"})}${this._previewButton(alerts.length?`Alerts (${alerts.length})`:"No alerts",g.bodyX+594,g.nameY,154,48,{className:`native-alert-button ${alerts.length?"active":""}`})}<div class="native-fixed-body" style="left:${g.bodyX}px;top:${g.bodyY}px;height:430px">${body}</div>${this._previewButton("Setup",g.railX+12,532,196,56,{className:"native-setup"})}</div>`;
  }
  _preview() {
    const c=this._config,rooms=c.rooms.map(r=>r.name);
    if(this._room&&!rooms.includes(this._room))this._room="";
    if(c.menu.show_all_rooms===false&&!this._room)this._room=rooms[0]||"";
    if(this._system&&!systemsForRoom(c,this._room).includes(this._system))this._system="";
    if(c.menu.show_all_systems===false&&!this._system)this._system=systemsForRoom(c,this._room)[0]||"";
    const alarm=c.entities.find(e=>e.entity_id===c.security.alarm_entity);
    if(this._tab==="security"||(alarm?entitySystems(alarm).includes(this._system):this._system==="Security")&&(c.security.alarm_entity||c.security.sensor_entities.length))return this._previewSecurity();
    const visible=filterEntities(c.entities,this._room,this._system),pages=layoutControlPages(visible);
    this._previewPage=Math.max(0,Math.min(this._previewPage||0,pages.length-1));
    const cards=(pages[this._previewPage]||[]).map(slot=>slot.featured?this._previewClimateHero(slot.entity,slot.x,slot.y,slot.height):this._previewCard(slot.entity,slot.x,slot.y,slot.height,slot.width)).join("");
    return this._previewFrame(cards||`<p class="native-empty-fixed">No controls in this selection.<br>Choose another room or system, or publish a layout from Home Assistant.</p>`,false,visible.length,Math.max(1,pages.length));
  }

  _previewClimateHero(entity,x,y,height) {
    const source=this._source(entity.entity_id),state=this._state(entity.entity_id),a=state?.attributes||source.attributes||{},features=Number(a.supported_features)||0,tall=height>=430;
    const offline=!state||["unavailable","unknown"].includes(state.state),range=state?.state==="heat_cool"&&Boolean(features&2),reported=value=>!offline&&Number.isFinite(value)&&value>-900;
    const unit=a.temperature_unit||this._hass?.config?.unit_system?.temperature||"°",current=reported(a.current_temperature)?`${a.current_temperature}${unit}`:"Unavailable",raw=(state?.state||"Unavailable").replaceAll("_"," "),mode=raw[0].toUpperCase()+raw.slice(1);
    let body=this._previewButton(`Three-dot menu for ${entity.label}`,307,8,48,48,{icon:"more",className:"native-more"});
    if(range) {
      for(const [label,key,rowY] of [["Low","target_temp_low",tall?140:112],["High","target_temp_high",tall?230:190]]) {
        body+=`<span class="native-hero-text" style="left:14px;top:${rowY}px;width:110px;font-size:20px">${escapeHTML(`${label} ${unit}`)}</span><span class="native-hero-text" style="left:140px;top:${rowY}px;width:90px;font-size:24px">${reported(a[key])?escapeHTML(a[key]):"--"}</span>`;
        body+=this._previewButton("-",248,rowY-4,48,48,{ariaLabel:`Decrease ${entity.label} ${label.toLowerCase()} temperature`})+this._previewButton("+",307,rowY-4,48,48,{ariaLabel:`Increase ${entity.label} ${label.toLowerCase()} temperature`});
      }
    } else if(features&1) {
      const size=tall?230:200,arcX=tall?69:84,arcY=tall?78:58,c=size/2,r=c-10,p=r/Math.sqrt(2),min=Number.isFinite(a.min_temp)?a.min_temp:-50,max=Number.isFinite(a.max_temp)?a.max_temp:120,limits=max>min;
      if(limits) {
        const valid=reported(a.temperature),step=Math.max(.01,Number.isFinite(a.target_temp_step)?a.target_temp_step:1),steps=Math.max(1,Math.floor((max-min)/step)),value=valid?Math.max(0,Math.min(steps,Math.round((Math.max(min,Math.min(max,a.temperature))-min)/step))):0,ratio=value/steps,angle=(135+270*ratio)*Math.PI/180,path=`M${c-p} ${c+p} A${r} ${r} 0 1 1 ${c+p} ${c+p}`,readoutY=arcY+Math.floor(size*.35);
        body+=`<svg class="native-climate-ring native-hero-ring" style="left:${arcX}px;top:${arcY}px;width:${size}px;height:${size}px" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHTML(valid?`Target temperature ${a.temperature}${unit} (preview only)`:"Target temperature unavailable")}"><path d="${path}" fill="none" stroke="#405363" stroke-width="20" stroke-linecap="round" pathLength="100"/><path d="${path}" fill="none" stroke="var(--panel-accent)" stroke-width="20" stroke-linecap="round" pathLength="100" stroke-dasharray="${ratio*100} 100" ${valid&&value?"":"visibility=hidden"}/>${valid?`<circle class="native-hero-knob" cx="${c+Math.cos(angle)*r}" cy="${c+Math.sin(angle)*r}" r="22" fill="var(--panel-accent)"/>`:""}</svg><span class="native-climate-target" style="left:${arcX+12}px;top:${readoutY}px;width:${size-24}px;height:64px;font-size:48px;line-height:64px">${valid?escapeHTML(a.temperature):"--"}</span><span class="native-hero-text" style="left:${arcX+20}px;top:${readoutY+68}px;width:${size-40}px;text-align:center;font-size:20px">${escapeHTML(`Target${unit}`)}</span>`;
      } else body+=`<span class="native-hero-text" style="left:${arcX}px;top:${arcY}px;width:${size}px;font-size:20px">Temperature limits not reported.</span>`;
      body+=this._previewButton("-",14,tall?170:130,48,48,{ariaLabel:`Decrease ${entity.label} target temperature`})+this._previewButton("+",307,tall?170:130,48,48,{ariaLabel:`Increase ${entity.label} target temperature`});
    } else body+='<p class="native-hero-text" style="left:24px;top:120px;width:321px;font-size:20px">Setpoint control not reported.<br>Use the menu for supported modes.</p>';
    const available=Array.isArray(a.hvac_modes)?a.hvac_modes:[],modes=[...new Set([...["off","heat","cool"].filter(m=>available.includes(m)),...available])].slice(0,3);
    body+=modes.map((value,i)=>{const label=value.replaceAll("_"," ");return this._previewButton(label[0].toUpperCase()+label.slice(1),14+i*117,tall?370:268,109,44,{selected:state?.state===value});}).join("");
    return `<article class="native-card native-climate-hero ${offline?"unavailable":""}" style="left:${x}px;top:${y}px;width:369px;height:${height}px" data-preview-entity="${escapeHTML(entity.entity_id)}"><h3 style="left:14px;top:14px;width:285px;height:30px;font-size:24px">${escapeHTML(entity.label)}</h3><span class="native-card-state" style="left:14px;top:${range?54:tall?316:240}px;width:341px;height:26px;line-height:26px;font-size:20px;text-align:center">${escapeHTML(`Current ${current} / ${mode}`)}</span>${body}</article>`;
  }
  _previewCard(entity,x,y,height=209,width=369) {
    const source=this._source(entity.entity_id),state=this._state(entity.entity_id),domain=entity.entity_id.split(".")[0],attributes=state?.attributes||source.attributes||{},features=Number(attributes.supported_features)||0;
    const offline=!state||state.state==="unavailable"||state.state==="unknown"&&!["scene","script","button"].includes(domain),compact=height<=103,actionY=compact?50:height-54;
    const toggle=["light","switch","fan","input_boolean"].includes(domain),readonly=["sensor","binary_sensor"].includes(domain),action=toggle||["climate","cover","alarm_control_panel","scene","script","button","lock","camera"].includes(domain),explicit=["scene","script","button","lock","camera"].includes(domain),more=toggle||["cover","climate","alarm_control_panel"].includes(domain);
    const active=toggle&&state?.state==="on";
    const raw=state?.state?state.state.replaceAll("_"," "):"Waiting for state";
    let text=raw[0].toUpperCase()+raw.slice(1),badge="";
    if(domain==="binary_sensor") {
      const opening=["door","window","opening","garage_door"].includes(attributes.device_class),motion=["motion","occupancy","presence"].includes(attributes.device_class);
      if(state?.state==="on")text=opening?"Open":motion?"Detected":"Active";
      if(state?.state==="off")text=opening?"Closed":"Clear";
    }
    if(["cover","binary_sensor","alarm_control_panel"].includes(domain))badge=offline?"neutral":(domain==="cover"?state.state==="closed":domain==="alarm_control_panel"?state.state==="disarmed":state.state==="off")?"closed":"open";
    if(domain==="sensor"&&attributes.unit_of_measurement&&!offline)text+=` ${attributes.unit_of_measurement}`;
    if(domain==="cover"&&attributes.current_position>0&&attributes.current_position<100)text+=` ${attributes.current_position}%`;
    let controls=more?this._previewButton(`Three-dot menu for ${entity.label}`,307,8,48,48,{icon:"more",className:"native-more"}):"";
    if(toggle&&height>100)controls+=`<svg class="native-power" style="left:14px;top:${height-42}px" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v9M6.5 6.5a8 8 0 1 0 11 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    if(domain==="cover") {
      const position=Boolean(features&4),actions=position?["0%","25%","50%","75%","100%",...(features&8?["Stop"]:[])]:[...(features&1?["Open"]:[]),...(features&8?["Stop"]:[]),...(features&2?["Close"]:[])],gap=position?5:10,width=Math.floor((349-gap*(actions.length-1))/Math.max(1,actions.length));
      controls+=actions.map((label,i)=>this._previewButton(label,10+i*(width+gap),actionY,width,44,{style:position?"letter-spacing:-1px;":""})).join("");
    } else if(explicit)controls+=this._previewButton(({scene:"Activate",script:"Run",button:"Press",lock:"Lock",camera:"View live camera"})[domain],domain==="camera"?10:190,actionY,domain==="camera"?349:166,44);
    let titleWidth=action?285:341,stateX=14,stateY=action?(compact?46:54):(compact?48:height>=209?90:70),stateWidth=action?285:341,stateHeight=action?34:44,stateFont=!action||height>=209?24:20;
    if(explicit&&compact){titleWidth=156;stateX=178;stateY=8;stateWidth=170;stateHeight=28;}
    if(domain==="cover"&&compact){titleWidth=150;stateX=174;stateY=12;stateWidth=125;stateHeight=28;}else if(domain==="cover"&&height>=136&&height<=141){stateY=44;stateHeight=28;}
    if(domain==="climate") {
      const unit=attributes.temperature_unit||this._hass?.config?.unit_system?.temperature||"°",current=!offline&&Number.isFinite(attributes.current_temperature)?`${attributes.current_temperature}${unit}`:"Unavailable",target=!offline&&Number.isFinite(attributes.temperature)?`${attributes.temperature}${unit}`:"Not reported";
      text=`${current} / ${target}`;
    }

    const tileTarget=toggle||["climate","alarm_control_panel"].includes(domain)?`<button class="native-tile-target" disabled aria-label="${escapeHTML(toggle?`Toggle ${entity.label} (preview only)`:`Open ${entity.label} controls (preview only)`)}"></button>`:"";
    if(width===height&&width<242) {
      const cover=domain==="cover",font=width>=179?20:14,titleHeight=font===20?44:32;
      if(cover&&width<180)text=raw[0].toUpperCase()+raw.slice(1);
      let buttons=more?this._previewButton(`Three-dot menu for ${entity.label}`,width-48,cover?0:height-48,44,44,{icon:"more",className:"native-more"}):"";
      if(toggle)buttons+=`<span style="position:absolute;left:10px;bottom:12px;font-size:24px">⏻</span>`;
      if(cover){const position=Boolean(features&4),actions=position?["0%","25%","50%","75%","100%",...(features&8?["Stop"]:[])]:[...(features&1?["Open"]:[]),...(features&8?["Stop"]:[]),...(features&2?["Close"]:[])];buttons+=actions.map((label,i)=>this._previewButton(label,(width-132)/2+(i%3)*44,height-(position?92:48)+Math.floor(i/3)*44,44,44,{style:"font-size:14px;padding:0;"})).join("");}
      else if(explicit)buttons+=this._previewButton(({scene:"Activate",script:"Run",button:"Press",lock:"Lock",camera:"Camera"})[domain],8,height-48,width-16,44);
      return `<article class="native-card ${active?"active":""} ${offline?"unavailable":""}" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px" data-preview-entity="${escapeHTML(entity.entity_id)}">${tileTarget}<h3 style="left:8px;top:${cover?2:6}px;width:${width-(cover?56:16)}px;height:${cover?24:titleHeight}px;line-height:${cover?14:font===20?22:16}px;font-size:${cover?14:font}px;white-space:normal;overflow-wrap:anywhere">${escapeHTML(entity.label)}</h3><span class="native-card-state ${badge?`native-status-badge ${badge}`:""}" style="left:8px;top:${cover?26:titleHeight+10}px;width:${width-(cover?56:16)}px;height:${cover?16:24}px;line-height:${cover?16:24}px;font-size:${cover?14:readonly?20:font}px">${escapeHTML(text)}</span>${buttons}</article>`;
    }
    if(width<369) {
      const actionY=height-52,inner=width-20;
      controls=more?this._previewButton(`Three-dot menu for ${entity.label}`,width-62,8,48,48,{icon:"more",className:"native-more"}):"";
      if(toggle)controls+=`<svg class="native-power" style="left:14px;top:${height-42}px" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v9M6.5 6.5a8 8 0 1 0 11 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      if(domain==="cover") {
        const position=Boolean(features&4),actions=position?["0%","25%","50%","75%","100%"]:[...(features&1?["Open"]:[]),...(features&8?["Stop"]:[]),...(features&2?["Close"]:[])];
        const actionWidth=position?44:Math.floor((inner-10*(actions.length-1))/Math.max(1,actions.length)),step=position?44:actionWidth+10;
        controls+=actions.map((label,i)=>this._previewButton(label,(position?11:10)+i*step,actionY,actionWidth,44,{style:"font-size:14px;padding:0;"})).join("");
      } else if(explicit)controls+=this._previewButton(({scene:"Activate",script:"Run",button:"Press",lock:"Lock",camera:"View live camera"})[domain],domain==="camera"?10:width-179,actionY,domain==="camera"?inner:166,44);
      const font=entity.label.length>32?14:20;
      return `<article class="native-card native-card-narrow ${active?"active":""} ${offline?"unavailable":""}" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px" data-preview-entity="${escapeHTML(entity.entity_id)}">${tileTarget}<h3 style="left:14px;top:8px;width:${width-(more?84:28)}px;height:${font===14?32:44}px;line-height:${font===14?16:22}px;font-size:${font}px;white-space:normal;overflow-wrap:anywhere">${escapeHTML(entity.label)}</h3><span class="native-card-state ${badge?`native-status-badge ${badge}`:""}" style="left:14px;top:58px;width:${width-28}px;height:${readonly?44:24}px;line-height:24px;font-size:${readonly?24:20}px">${escapeHTML(text)}</span>${controls}</article>`;
    }
    const titleStyle=`left:14px;top:${compact?8:14}px;width:${titleWidth}px;height:${compact?28:30}px;font-size:${compact?20:24}px`;
    const stateStyle=`left:${stateX}px;top:${stateY}px;width:${stateWidth}px;height:${stateHeight}px;font-size:${stateFont}px;${domain==="climate"&&height>=209?"white-space:pre-line;line-height:34px;":""}`;
    return `<article class="native-card ${active?"active":""} ${offline?"unavailable":""}" style="left:${x}px;top:${y}px;width:369px;height:${height}px" data-preview-entity="${escapeHTML(entity.entity_id)}">${tileTarget}<h3 style="${titleStyle}">${escapeHTML(entity.label)}</h3><span class="native-card-state ${badge?`native-status-badge ${badge}`:""}" style="${stateStyle}">${escapeHTML(text)}</span>${controls}</article>`;
  }
  _previewSecurity() {
    const c=this._config,selected=c.security.alarm_entity,alarm=c.entities.find(e=>e.entity_id===selected),alarmHere=!this._room||alarm?.room===this._room;
    const s={...c.security,alarm_entity:alarmHere?selected:""},source=this._source(s.alarm_entity),state=this._state(s.alarm_entity),attributes=state?.attributes||source.attributes||{},features=Number(attributes.supported_features)||0;
    const eligible=new Set(securityCandidates(this._data.entities).map(e=>e.entity_id)),sensors=s.sensor_entities.filter(id=>eligible.has(id));
    const pageSize=sensors.length<=16?16:12,pages=Math.max(1,Math.ceil(sensors.length/pageSize));this._sensorPreviewPage=Math.min(this._sensorPreviewPage||0,pages-1);
    const armed=Boolean(state?.state)&&!["disarmed","unknown","unavailable"].includes(state.state),disarmed=state?.state==="disarmed",rawState=(state?.state||"Unavailable").replaceAll("_"," "),stateText=rawState[0].toUpperCase()+rawState.slice(1);
    let body=`<span class="native-security-state ${armed?"native-status-badge open":disarmed?"native-status-badge closed":""}" style="left:364px;top:10px;width:384px;height:32px">${escapeHTML(stateText)}</span>`;
    if(s.alarm_entity) {
      const modes=[["Home",1],["Away",2]].filter(([,bit])=>features&bit);
      body+='<input class="native-security-pin" type="password" aria-label="Preview alarm PIN" placeholder="Enter PIN" maxlength="32" value="" disabled>';
      body+=modes.map(([label],i)=>this._previewButton(label,(336-(modes.length*132+(modes.length-1)*16))/2+i*148,88,132,56,{className:"native-arm-mode"})).join("");
      const keypadY=168;
      body+=["1","2","3","4","5","6","7","8","9","Clear","0","Enter"].map((label,i)=>this._previewButton(label,(i%3)*116,keypadY+Math.floor(i/3)*62,104,56,{className:"native-keypad-key",selected:label==="Enter"})).join("");
    }
    if(selected&&!alarmHere)body+='<p style="position:absolute;left:0;top:164px;width:336px">No alarm control in this room.</p>';
    body+='<h3 class="native-sensors-heading">Security sensors</h3>';
    if(!sensors.length)body+='<p class="native-security-empty">No security sensors selected. Choose sensors in the HA companion.</p>';
    else {
      const shown=sensors.slice(this._sensorPreviewPage*pageSize,this._sensorPreviewPage*pageSize+pageSize),grid=securitySensorGrid(shown.length);
      body+=shown.map((id,i)=>{
        const sensor=this._source(id),data=this._state(id),value=data?.state||"unavailable",type=data?.attributes?.device_class||sensor.attributes?.device_class;
        const opening=["door","window","opening","garage_door"].includes(type),motion=["motion","occupancy","presence"].includes(type);
        const label=value==="on"?(opening?"Open":motion?"Detected":"Active"):value==="off"?(opening?"Closed":"Clear"):value.replaceAll("_"," ");
        const openingState=opening||id.startsWith("cover."),badge=openingState&&["on","off","open","closed"].includes(value)?(["on","open"].includes(value)?"open":"closed"):"";
        const display=openingState&&["on","off","open","closed"].includes(value)?(["on","open"].includes(value)?"Open":"Closed"):label;
        const x=364+(i%grid.columns)*197,y=108+Math.floor(i/grid.columns)*grid.step;
        return `<span class="native-sensor-name" style="top:${y}px;left:${x}px;width:${grid.columnWidth-grid.badgeWidth-8}px;height:${grid.nameHeight}px;font-size:${grid.font}px;line-height:${grid.font===20?22:16}px;white-space:${grid.font===20?"nowrap":"normal"};overflow-wrap:anywhere">${escapeHTML(c.entities.find(e=>e.entity_id===id)?.label||sensor.name||id)}</span><span class="native-sensor-value ${badge?`native-status-badge ${badge}`:value==="on"?"active":""}" style="top:${y}px;left:${x+grid.columnWidth-grid.badgeWidth}px;width:${grid.badgeWidth}px;height:${grid.stateHeight}px;font-size:${grid.font}px;line-height:${grid.stateHeight}px">${escapeHTML(display)}</span>`;
      }).join("");
      if(pages>1)body+=this._previewButton("Previous",364,374,104,48,{action:"preview-sensor-page",value:"-1",disabled:this._sensorPreviewPage===0})+`<span class="native-page-count" style="left:480px;top:386px;width:136px">${this._sensorPreviewPage+1} / ${pages}</span>`+this._previewButton("Next",644,374,104,48,{action:"preview-sensor-page",value:"1",disabled:this._sensorPreviewPage===pages-1});
    }
    return this._previewFrame(body,true);
  }
  _scalePreview() {
    this._resize?.disconnect();
    const shell = this.shadowRoot.querySelector(".preview-shell"), preview = this.shadowRoot.querySelector(".native-preview");
    if (!shell || !preview) return;
    const resize = () => { preview.style.transform = `scale(${shell.clientWidth / 1024})`; };
    if (globalThis.ResizeObserver) { this._resize = new ResizeObserver(resize); this._resize.observe(shell); }
    resize();
  }
  _menuScroll() {
    return [...(this.shadowRoot?.querySelectorAll(".native-menu")||[])].map(menu=>({
      label:menu.getAttribute("aria-label"),vertical:menu.classList.contains("native-rail"),
      top:menu.scrollTop,left:menu.scrollLeft,
      focus:menu.contains(this.shadowRoot.activeElement)?[menu,...menu.querySelectorAll("button")].indexOf(this.shadowRoot.activeElement):-1
    }));
  }
  _restoreMenuScroll(saved) {
    for(const menu of this.shadowRoot?.querySelectorAll(".native-menu")||[]) {
      const position=saved.find(p=>p.label===menu.getAttribute("aria-label")&&p.vertical===menu.classList.contains("native-rail"));
      if(!position)continue;
      if(position.focus>=0)[menu,...menu.querySelectorAll("button")][position.focus]?.focus({preventScroll:true});
      menu.scrollTop=position.top;menu.scrollLeft=position.left;
    }
  }
  _updateLiveStates() {
    // Rebuild only the preview so HA state updates cannot interrupt text editing.
    const preview = this.shadowRoot?.querySelector(".native-preview");
    if (preview&&!this._carouselGesture) {const saved=this._menuScroll();preview.innerHTML=this._preview();this._restoreMenuScroll(saved);}
    // HA state events must not replace checkboxes while a pointer or keyboard action is in progress.
    for (const node of this.shadowRoot?.querySelectorAll("[data-security-state]") || [])
      node.textContent = (this._state(node.dataset.securityState)?.state || "unavailable").replaceAll("_"," ");
  }
}


const WORKSPACE_CSS=`
:host{container-type:inline-size}.back-to-room{display:none}

.companion{max-width:1800px;padding:0 24px 20px;--line:#2e3b4c;--muted:#afbdce;--accent:#79b8eb;background:#0b1018;font-size:14px;min-height:100vh}
.companion .app-header{margin:0;min-height:66px;border-bottom:1px solid var(--line);gap:18px}.app-header h1{font-size:26px;white-space:nowrap}.panel-choice{max-width:220px}.panel-choice select{min-height:44px}.panel-status{color:var(--muted);font-size:13px}.header-actions{display:flex;gap:10px;margin-left:auto}.header-actions button{min-height:44px}.companion .demo{padding:4px 12px;margin:4px 0;font-size:11px}.app-tabs{display:flex;gap:8px;border-bottom:1px solid var(--line);padding:6px 0}.app-tabs>button{border:0;background:transparent;border-radius:5px;min-height:48px;padding:10px 22px}.app-tabs [aria-current=page]{background:#1d354c;color:#94d4ff}.settings-nav{position:relative}.settings-nav>summary{padding:13px 18px;cursor:pointer;min-height:48px}.settings-nav>div{position:absolute;top:100%;left:0;z-index:10;background:#182434;border:1px solid var(--line);width:220px;padding:8px;display:grid}.settings-nav button{text-align:left;border:0;background:transparent}
.companion .workspace[hidden]{display:none}.companion .workspace{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:0;align-items:start}.companion .settings-workspace{grid-template-columns:minmax(0,1fr) 460px;gap:28px;padding-top:24px}.room-workbench{display:grid;grid-template-columns:210px minmax(0,1fr)}.room-rail{padding:22px 14px 24px 0;border-right:1px solid var(--line);min-height:calc(100vh - 225px)}.rail-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:16px}.rail-title h2{font-size:18px}.rail-title button{padding:8px 10px;min-height:44px;font-size:13px}.room-select{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;border:0;border-bottom:1px solid var(--line);background:transparent;text-align:left;padding:14px 12px;min-height:58px;border-radius:5px;overflow-wrap:anywhere}.room-select[aria-current=true]{background:#203b55;box-shadow:inset 3px 0 #79b8eb}.room-select small{color:var(--muted)}.room-order{margin-top:20px}.room-order button{display:block;width:100%;margin-top:8px}.room-order summary{min-height:44px;padding:12px 0;cursor:pointer}.room-content{padding:24px;min-width:0}.room-heading{display:flex;align-items:start;justify-content:space-between;gap:16px;margin-bottom:24px}.room-heading h2{font-size:24px}.room-heading p{margin:6px 0 0;font-size:13px}.room-heading>.row{flex-wrap:nowrap;gap:6px}.room-heading button{padding:8px 12px;font-size:13px;min-height:44px;white-space:nowrap}.companion ha-icon{width:22px;height:22px;--mdc-icon-size:22px;flex:0 0 22px}.control-edit,.group-tools button:last-child{padding:10px;min-width:44px}
.companion .assigned-group{position:relative;border:1px solid var(--line);border-radius:9px;margin-bottom:18px;min-width:0}.assigned-group>summary{padding:14px 168px 14px 18px;min-height:72px;cursor:pointer;list-style-position:inside;font-size:16px;font-weight:600}.assigned-group>summary small{display:block;font-size:12px;font-weight:400;color:var(--muted);padding-left:20px;margin-top:4px}.group-tools{position:absolute;right:10px;top:13px;display:flex;gap:6px}.group-tools button{min-height:44px;font-size:12px;padding:8px}.group-tools button:first-child{max-width:none;white-space:nowrap;line-height:1.2}.control-rows{list-style:none;padding:0;margin:0}.control-row{display:flex;align-items:center;gap:8px;min-height:74px;border-top:1px solid var(--line);padding:8px 10px}.control-order{display:flex;gap:2px}.control-order button,.control-drag{min-width:36px;min-height:44px;padding:4px}.control-drag{touch-action:none;cursor:grab;background:transparent;border:0}.control-drag:active{cursor:grabbing}.control-row.reorder-target{box-shadow:inset 0 3px #79b8eb}.control-row.selected{background:#1c334a;box-shadow:inset 3px 0 #79b8eb}.control-label{flex:1;min-width:0;display:flex;align-items:center;gap:12px;text-align:left;background:transparent;border:0;padding:4px;min-height:48px}.control-label>span{min-width:0}.control-label strong{display:block;font-size:14px;overflow-wrap:anywhere}.control-label small{display:block;font-weight:400;font-size:11px;color:var(--muted);overflow-wrap:anywhere;margin-top:3px}.membership-chips{display:flex;gap:4px;flex-wrap:wrap;max-width:34%;font-size:11px}.membership-chips>span{padding:5px 7px;background:#243c53;border-radius:5px;overflow-wrap:anywhere}.group-empty{padding:16px;color:var(--muted)}.system-local-options,.room-options{padding:16px;background:#142130;border-bottom:1px solid var(--line)}
.context-pane{border-left:1px solid var(--line);padding:0 20px 24px;min-width:0;position:sticky;top:0;max-height:calc(100vh - 210px);overflow:auto;scrollbar-width:thin}.context-tabs{display:flex;gap:8px;border-bottom:1px solid var(--line);margin-bottom:24px;position:sticky;top:0;background:#0b1018;z-index:2}.context-tabs button{border:0;border-radius:0;background:transparent;padding:16px 8px;min-height:52px;color:var(--muted)}.context-tabs button[aria-pressed=true]{color:#94d4ff;border-bottom:3px solid #79b8eb}.companion .preview-section{position:static}.preview-heading h2{font-size:17px}.companion .preview-note{font-size:11px}.companion .inspector-list{margin:0}.companion .entity-inspector{border:0;padding:0;display:flex;flex-direction:column;max-height:calc(100vh - 330px)}.inspector-scroll{overflow:auto;min-height:0;padding-right:6px;scrollbar-width:thin}.inspector-title{display:flex;gap:12px;align-items:center;margin:16px 0}.entity-inspector .field{margin-bottom:14px}.entity-inspector input:not([type=checkbox]),.entity-inspector select{min-height:44px}.entity-inspector .hint{font-size:12px;margin:6px 0 12px}.inspector-title strong,.inspector-title small{display:block}.inspector-title small{color:var(--muted);font-size:12px;overflow-wrap:anywhere;margin-top:5px}.membership-picker{border:0;padding:0;margin:16px 0 12px}.membership-picker legend{font-weight:600}.membership-picker .checkbox-field{margin:0;min-height:44px}.membership-picker input[type=checkbox]{width:24px;height:24px;min-height:24px;padding:0}.shared-note{padding:14px;background:#15273a;border:1px solid #2b5173;border-radius:6px;font-size:13px}.entity-inspector details{border-bottom:1px solid var(--line);padding:10px 0;margin:0}.entity-inspector summary{cursor:pointer;min-height:32px;padding:6px 0}.entity-inspector details .row{margin-top:14px}.inspector-remove{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;padding:12px 0 2px;border-top:1px solid var(--line);flex:0 0 auto}.inspector-remove button{font-size:12px;padding:8px;min-height:44px}
.control-picker,.room-system-form,.publish-review{padding:20px;border:1px solid #36526d;background:#111e2c;border-radius:8px;margin-bottom:22px}.picker-filters{display:grid;grid-template-columns:1fr 1fr;gap:12px}.companion .control-picker .candidate-list{max-height:320px}.candidate-choice{display:flex;align-items:center;gap:10px;flex:1;min-width:0}.candidate-system{max-width:180px;margin:0}.candidate>button{font-size:12px;padding:8px}.companion footer{position:sticky;bottom:0;background:#0b1018;z-index:5;margin:0;padding:16px 0;border-top:1px solid var(--line)}.publish-review{margin:20px 0;max-height:60vh;overflow:auto}.publish-review ul{max-height:30vh;overflow:auto}.companion .message{padding:12px 16px;margin:12px 0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.companion .setup-steps li{padding-bottom:16px}.companion .empty{margin:20px 0}
@media(min-width:1600px){.companion .workspace{grid-template-columns:minmax(0,1fr) 380px}.room-workbench{grid-template-columns:220px minmax(0,1fr)}}
@media(max-width:1200px){.companion .workspace{grid-template-columns:minmax(0,1fr) 310px}.room-workbench{grid-template-columns:165px minmax(0,1fr)}.room-content{padding:18px}.room-heading{flex-wrap:wrap}.membership-chips{display:none}.companion .editor{grid-row:auto}.companion .preview-section{grid-row:auto}}
@media(max-width:960px){.companion .workspace,.companion .settings-workspace{grid-template-columns:1fr}.companion .entity-inspector{max-height:none}.context-pane{position:static;max-height:none;border:1px solid var(--line);margin-bottom:16px}.room-rail{min-height:400px}.app-header{flex-wrap:wrap;padding:12px 0}.panel-status{display:none}.header-actions{gap:6px}.header-actions button{font-size:12px;padding:8px}.room-content{padding-right:0}}
@media(max-width:600px){.companion{padding:0 14px 16px}.companion .app-header h1{font-size:22px}.panel-choice{max-width:180px}.header-actions{width:100%;justify-content:flex-end}.room-workbench{grid-template-columns:1fr}.room-rail{border-right:0;min-height:0;padding:14px 0;display:flex;gap:8px;overflow:auto}.rail-title{min-width:160px;margin:0}.room-select{width:auto;flex:0 0 130px}.room-order{display:none}.room-content{padding:16px 0}.picker-filters{grid-template-columns:1fr}.companion footer{align-items:stretch}.candidate{flex-wrap:wrap}.candidate-system{max-width:none;width:100%}.app-tabs>button{padding:8px 16px}.room-heading>.row{flex-wrap:wrap}.context-pane{padding:0 14px 20px}}
@container(max-width:1200px){.companion .workspace{grid-template-columns:minmax(0,1fr) 310px}.room-workbench{grid-template-columns:165px minmax(0,1fr)}.room-heading{flex-wrap:wrap}.membership-chips{display:none}}
@container(max-width:1150px){.companion .workspace,.companion .settings-workspace{grid-template-columns:1fr}.companion .entity-inspector{max-height:none}.context-pane{position:static;max-height:none;border:1px solid var(--line);margin-bottom:16px}.back-to-room{display:block}.membership-chips{display:flex}.room-content{padding-right:0}}
@container(max-width:600px){.membership-chips{display:none}}
`;

const CSS = `
.pin-warning{color:#FFD18B;border:1px solid #A5681D;padding:12px;border-radius:4px}

.native-security{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px 32px 80px;min-height:0;flex:1}.native-alarm,.native-security-sensors{background:var(--panel-button);border:var(--panel-border-width) solid var(--panel-border-color);border-radius:var(--panel-radius);padding:22px;min-width:0}.native-alarm h3,.native-security-sensors h3{font-size:23px;margin-bottom:20px;overflow-wrap:anywhere}.native-alarm>.control-value{display:block;text-transform:capitalize;color:var(--panel-accent);font-size:28px}.native-alarm-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}.native-alarm-actions button{font-size:18px;min-height:56px;opacity:1;color:var(--panel-fg);background:var(--panel-bg);border-radius:var(--panel-radius)}.native-security-sensors>div{display:flex;justify-content:space-between;gap:12px;align-items:center;border-top:1px solid #383E46;padding:13px 0;font-size:18px}.native-security-sensors span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.native-security-sensors strong{color:var(--panel-accent);text-transform:capitalize}

.capabilities{border:1px solid #383E46;padding:12px 14px;margin-bottom:16px;border-radius:6px}.capabilities summary{cursor:pointer;min-height:24px;font-weight:600}.capabilities ul{padding-left:20px;margin:12px 0 0}.checkbox-field{display:flex;align-items:center;gap:12px;min-height:48px;cursor:pointer}.alarm-summary{border:1px solid #535A63;padding:16px;margin:0 0 24px;border-radius:6px}.alarm-summary>span{float:right;text-transform:capitalize;color:#FFBE64}.active-alerts{border:1px solid #535A63;padding:16px;margin:16px 0 24px;border-radius:6px}.active-alerts ul,.alert-rules{list-style:none;padding:0;margin:16px 0}.active-alerts li{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid #383E46;padding:14px 0}.active-alerts li small{display:block;color:#BEC3CB;overflow-wrap:anywhere}.active-alerts li strong{color:#FFD18B}.alert-rules>li{border-top:1px solid #383E46;padding:20px 0}.sensor-state{text-transform:capitalize}.native-control-label{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}

:host{display:block;color:#EEF3FA;background:#0B1018;font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100%;--line:#383E46;--muted:#BEC3CB;--accent:#79B8EB}
*{box-sizing:border-box}main{max-width:1800px;margin:auto;padding:28px 32px 32px}h1,h2,h3,p{margin:0}h1{font-size:28px;line-height:1.2;letter-spacing:-.02em}h2{font-size:20px;line-height:1.3}h3{font-size:16px}p{color:var(--muted);margin:8px 0 16px}header{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:24px}header p{margin:5px 0 0}button,input,select{font:inherit;color:inherit}button{min-height:48px;border:1px solid #535A63;background:#121417;border-radius:8px;padding:10px 16px;cursor:pointer;font-weight:600}button:hover{background:#22272D}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button.primary{color:#08090A;background:var(--accent);border-color:var(--accent)}button.primary:hover{background:#9CCCF1}.danger{color:#ffb6af}input,select{width:100%;min-height:48px;padding:10px 12px;border:1px solid #535A63;border-radius:6px;background:#16191D}input[type=color]{padding:5px;height:48px;cursor:pointer}input[type=checkbox],input[type=radio]{width:24px;height:24px;min-height:24px;accent-color:var(--accent);flex:0 0 auto}.field{display:grid;gap:7px;margin-bottom:18px}.field>span{font-size:14px;font-weight:600}.connection{display:flex;align-items:center;gap:24px;padding:18px 20px;border:1px solid var(--line);border-radius:10px;margin-bottom:24px}.connection .field{min-width:230px;margin:0}.connection-state{flex:1}.connection-state small{display:block;color:var(--muted);padding-left:19px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#f2b678;margin-right:10px}.dot.online{background:var(--accent)}.pair,.message,.demo{border:1px solid var(--line);border-radius:8px;padding:18px 20px;margin-bottom:20px}.pair-code{display:block;color:var(--accent);font-size:32px;letter-spacing:.12em;overflow-wrap:anywhere}.message{color:#d0f5e8;background:#15342f}.message.error{color:#ffd2cd;background:#3a2428;border-color:#b66b6a}.demo{background:#2c2a1a;color:#f5e2a5}.workspace{display:grid;grid-template-columns:minmax(370px, .9fr) minmax(420px,1.3fr);gap:28px;align-items:start}.editor{min-width:0}.editor>nav{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:24px}.editor>nav button{background:transparent;border-color:transparent;padding:8px 12px}.editor>nav button[aria-current=page]{background:#203C54;color:#EEF3FA;border-color:#79B8EB}.editor-body{border:0;padding:0;margin:0;min-width:0}.editor-body>h3{margin-top:28px}.section-title{display:flex;align-items:flex-start;gap:16px;justify-content:space-between}.section-title button{white-space:nowrap}.hint{font-size:13px}.row{display:flex;gap:10px;flex-wrap:wrap}.row.compact{gap:6px}.entity-list{padding:0;list-style:none;margin:18px 0}.entity-list>li{padding:20px 0;border-top:1px solid var(--line)}.entity-top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:14px}.entity-top>strong{overflow-wrap:anywhere;font-size:13px;color:var(--muted)}.entity-fields{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.entity-fields>.field:first-child{grid-column:1/-1}.wizard{padding:20px;background:#16191D;border:1px solid var(--line);border-radius:8px;margin:12px 0 24px}.schedule-days{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin:0 0 18px}.schedule-bindings{margin:12px 0 18px}.room-deletion{border-top:1px solid var(--line);padding:16px 0;margin:16px 0 24px}.room-deletion>h3{font-size:18px}.room-deletion .field{margin-top:12px}.schedule-days,.schedule-bindings{border:1px solid var(--line);padding:12px}.checkbox-field{display:flex;align-items:center;gap:10px;margin:10px 0}.wizard-filters{display:grid;grid-template-columns:1fr 1.25fr;gap:12px}.candidate-list{max-height:400px;overflow:auto;margin:14px 0 20px;scrollbar-color:#535A63 #16191D}.candidate{display:flex;align-items:center;gap:12px;padding:12px 4px;min-height:64px;border-top:1px solid var(--line);cursor:pointer}.candidate>span:nth-child(2){flex:1;min-width:0}.candidate strong,.candidate small{display:block;overflow-wrap:anywhere}.candidate small,.candidate>span:last-child{color:var(--muted);font-size:12px}.color-fields{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}.photo-list{list-style:none;padding:0}.photo-list li{display:flex;justify-content:space-between;align-items:center;gap:16px;border-top:1px solid var(--line);padding:10px 0}.empty{padding:48px 24px;max-width:720px}.empty.small{padding:32px 0}.preview-section{position:sticky;top:24px;min-width:0}.preview-heading{display:flex;gap:16px;align-items:flex-start;justify-content:space-between}.preview-note{font-size:12px;color:var(--muted);text-align:right;max-width:140px}.preview-shell{width:100%;aspect-ratio:1024/600;overflow:hidden;border:1px solid #535A63;border-radius:10px;background:#08090A}.native-preview{width:1024px;height:600px;transform-origin:top left;color:var(--panel-fg);font-family:system-ui,sans-serif;font-size:20px}.native-screen{position:relative;width:100%;height:100%;background-color:var(--panel-bg);background-size:cover;background-position:center;display:flex;flex-direction:column}.native-title{height:64px;flex:0 0 64px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;gap:20px;background:transparent}.native-title>strong{font-size:24px}.native-title>span{font-size:18px}.native-body{display:flex;flex:1;min-height:0}.native-body.right{flex-direction:row-reverse}.native-menu{display:flex;gap:10px;padding:12px;background:transparent;overflow:auto;scrollbar-width:none}.native-menu.vertical{flex:0 0 190px;flex-direction:column;padding-bottom:78px}.native-menu.horizontal{height:76px;flex:0 0 76px;padding-left:82px}.native-menu button{min-height:56px;font-size:19px;background:var(--panel-button);color:var(--panel-fg);border:var(--panel-border-width) solid var(--panel-border-color);border-radius:var(--panel-radius);white-space:nowrap}.native-menu .selected{background:var(--panel-accent);color:#08090A}.native-content{flex:1;min-width:0;display:grid;grid-template-columns:370px 370px;grid-auto-rows:178px;align-content:start;justify-content:center;gap:14px;padding:12px 20px 18px}.native-card{display:flex;flex-direction:column;justify-content:space-between;background:var(--panel-button);border-radius:var(--panel-radius);padding:18px;min-width:0;border:var(--panel-border-width) solid var(--panel-border-color)}.native-card h3{font-size:21px;line-height:1.2;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.native-card small{font-size:14px}.control-value{font-size:26px;font-weight:600;text-transform:capitalize}.native-control-label{font-size:15px}.camera-placement{background:#070d12;min-height:62px;display:flex;align-items:center;justify-content:center;flex-direction:column;border-radius:5px}.camera-placement span{font-size:20px}.cover-controls{display:flex;justify-content:space-between;gap:8px;font-size:18px}.native-empty{grid-column:1/-1;margin:auto;color:var(--panel-fg);font-size:24px;text-align:center}.native-setup{position:absolute;left:8px;bottom:8px;height:60px;width:60px;display:grid;place-items:center;background:var(--panel-bg);border:var(--panel-border-width) solid var(--panel-border-color);border-radius:10px;font-size:15px}.native-card.unavailable .control-value{font-size:22px;color:#e3bbb4}footer{display:flex;align-items:center;justify-content:space-between;gap:20px;border-top:1px solid var(--line);margin-top:28px;padding-top:20px}footer p{margin:4px 0 0;font-size:13px}footer .primary{min-width:170px}::selection{background:#79B8EB;color:#0B1018}

.delay-fields{display:grid;grid-template-columns:minmax(90px,1fr) minmax(110px,1fr);gap:0 12px;grid-column:1/-1}.delay-fields>.hint{grid-column:1/-1;margin-top:-8px}.field output{font-variant-numeric:tabular-nums}input[type=range]{accent-color:var(--accent);padding:0;border:0;background:transparent}
.native-screen.glass .native-card,.native-screen.glass .native-menu button,.native-screen.glass .native-setup,.native-screen.glass .native-alarm,.native-screen.glass .native-security-sensors,.native-screen.glass .native-alarm-actions button{background:rgba(var(--panel-button-rgb),var(--panel-glass-opacity));-webkit-backdrop-filter:blur(var(--panel-glass-blur));backdrop-filter:blur(var(--panel-glass-blur))}
.native-screen.glass .native-menu button.selected{background:rgba(var(--panel-accent-rgb),var(--panel-glass-opacity))}
.native-screen :is(button,.native-card,.native-alarm,.native-security-sensors,.native-setup){border-width:var(--panel-border-width);border-style:solid;border-color:var(--panel-border-color)}

/* The preview shares the 1024x600 native geometry; editor viewport changes only scale this surface. */
.native-screen{display:block;overflow:hidden}.native-name,.native-status{position:absolute;width:470px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin:0}.native-name{height:30px;line-height:30px;font-size:24px;font-weight:600}.native-status{height:26px;line-height:26px;font-size:20px;color:#B4C3CF}
.native-screen button.native-control{position:absolute;display:flex;align-items:center;justify-content:center;min-height:0;margin:0;padding:6px;font-size:20px;line-height:24px;font-weight:400;white-space:normal;overflow:hidden;border-radius:var(--panel-radius);background:var(--panel-button);color:var(--panel-fg)}.native-screen button.native-control:disabled{opacity:1;cursor:default}.native-screen .native-control.selected{background:var(--panel-accent);color:var(--panel-selected-fg)}.native-screen.glass .native-control{background:rgba(var(--panel-button-rgb),var(--panel-glass-opacity));-webkit-backdrop-filter:blur(var(--panel-glass-blur));backdrop-filter:blur(var(--panel-glass-blur))}.native-screen.glass .native-control.selected{background:rgba(var(--panel-accent-rgb),var(--panel-glass-opacity));color:var(--panel-selected-fg)}
.native-menu.native-rail,.native-menu.native-row{position:absolute;display:block;flex:none;padding:0;background:transparent;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--panel-accent) transparent}.native-menu.native-rail{overflow-x:hidden;overflow-y:auto;touch-action:pan-y}.native-menu.native-row{overflow-x:auto;overflow-y:hidden;touch-action:pan-x}.native-menu:focus-visible{outline:3px solid var(--panel-accent);outline-offset:-3px}.native-fixed-body{position:absolute;width:748px;height:430px;overflow:visible}.native-screen .native-setup{display:flex}
.native-screen .native-card{position:absolute;display:block;padding:0;overflow:hidden}.native-card h3{position:absolute;left:14px;top:12px;width:342px;height:30px;margin:0;display:block;font-size:24px;font-weight:400;line-height:30px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.native-card-state{position:absolute;left:14px;top:51px;width:190px;height:28px;line-height:28px;font-size:20px;color:#B4C3CF;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.native-card-kind{position:absolute;left:14px;top:120px;width:160px;height:26px;font-size:20px;color:#B4C3CF}.native-status-only{position:absolute;left:14px;top:113px;width:342px;font-size:20px;color:#B4C3CF}.native-screen .native-dim-slider{position:absolute;min-height:0;padding:0;margin:0;accent-color:var(--panel-accent);border:0;opacity:1}.native-screen .native-card.unavailable button.native-control,.native-screen .native-card.unavailable input.native-dim-slider{opacity:.4}.native-page-count{position:absolute;height:26px;font-size:20px;line-height:26px;color:#B4C3CF;white-space:nowrap}.native-empty-fixed{position:absolute;left:24px;top:90px;width:690px;margin:0;font-size:24px;line-height:30px;color:#B4C3CF}
.native-screen .native-alert-button.active,.native-screen.glass .native-alert-button.active{background:rgba(106,34,30,.8);color:var(--panel-fg)}
.native-security-title{position:absolute;left:138px;top:8px;width:320px;height:30px;font-size:24px;font-weight:400;line-height:30px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.native-security-state{position:absolute;left:480px;top:10px;width:244px;height:26px;font-size:20px;line-height:26px;color:#B4C3CF;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.native-screen .native-security-pin{position:absolute;left:0;top:12px;width:336px;height:52px;min-height:0;padding:6px 10px;font-size:24px;color:var(--panel-fg);background:var(--panel-bg);opacity:1;border:1px solid #405363;border-radius:var(--panel-radius)}.native-sensors-heading{position:absolute;left:364px;top:58px;width:384px;height:30px;font-size:24px;line-height:30px;font-weight:400;margin:0}.native-security-help{position:absolute;left:364px;top:88px;width:384px;height:72px;margin:0;font-size:20px;line-height:24px;color:#B4C3CF;overflow:hidden}.native-security-empty{position:absolute;left:364px;top:170px;width:384px;margin:0;font-size:20px;line-height:25px;color:#B4C3CF}.native-sensor-name,.native-sensor-value{position:absolute;height:26px;font-size:20px;line-height:26px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.native-sensor-name{left:364px;width:244px}.native-sensor-value{left:620px;width:128px;color:#B4C3CF}.native-sensor-value.active{color:#FFB0A2}
.native-screen .native-status-badge{display:flex;align-items:center;justify-content:center;color:#FFFFFF;border:0;border-radius:0;line-height:1.1}.native-screen .native-status-badge.closed{background:#146438}.native-screen .native-status-badge.open{background:#9B241E}
.native-screen .native-tile-target{position:absolute;inset:0;width:100%;height:100%;background:transparent;border:0;border-radius:inherit;padding:0;min-height:0;opacity:1;pointer-events:none}.native-screen .native-card.active{background:var(--panel-active)}.native-screen.glass .native-card.active{background:rgba(var(--panel-active-rgb),var(--panel-glass-opacity))}.native-card-state{color:var(--panel-fg)}.native-climate-ring,.native-climate-target,.native-power{position:absolute;pointer-events:none;color:var(--panel-fg)}.native-climate-target{font-size:32px;line-height:40px;text-align:center}.native-screen .native-status-badge.neutral{background:#363C43}
.native-hero-text{position:absolute;color:var(--panel-fg);line-height:26px;margin:0}.native-hero-ring{overflow:visible}
.assigned-group{border-top:1px solid var(--line);padding:16px 0}.system-entry{border-top:1px solid var(--line);padding:0}.system-row{display:flex;align-items:center;gap:12px;min-height:56px}.system-row>.checkbox-field{flex:1;min-width:0;margin:0;min-height:56px;cursor:pointer}.system-row>.checkbox-field>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.system-row .system-edit-button{display:grid;place-items:center;flex:0 0 44px;width:44px;height:44px;min-height:44px;padding:0;border:0;background:transparent}.system-edit{padding:0 0 16px}.system-edit>.field{margin-top:0}.assigned-group>summary{cursor:pointer;font-weight:600;min-height:44px}.candidate-choice{display:flex;align-items:center;gap:12px;flex:1;min-width:0}.candidate-system{width:180px;flex:0 0 180px;margin:0}.candidate-system select{font-size:13px}.system-entry>details{margin:12px 0}.room-setup-groups .schedule-bindings{margin-top:16px}
@media(max-width:1100px){main{padding:20px}.workspace{grid-template-columns:1fr}.preview-section{position:static;grid-row:1}.editor{grid-row:2}.preview-shell{max-width:1024px}.connection{flex-wrap:wrap}.connection-state{min-width:160px}}
@media(max-width:550px){.active-alerts li{align-items:stretch;flex-direction:column}.active-alerts .section-title>button{margin-top:12px}main{padding:16px}header{align-items:flex-start;gap:12px}h1{font-size:24px}header button{font-size:13px;padding:8px}.connection{gap:16px}.connection .field{min-width:0;width:100%}.connection>button{width:100%}.section-title{display:block}.section-title>button{margin-bottom:12px}.wizard{padding:14px}.wizard-filters,.entity-fields,.color-fields{grid-template-columns:1fr}.entity-fields>.field:first-child{grid-column:auto}.candidate>span:last-child{display:none}.preview-heading{display:block}.preview-note{display:block;max-width:none;text-align:left;margin-bottom:10px}footer{align-items:stretch;flex-direction:column}.editor>nav button{flex:1;font-size:13px;padding:8px}.entity-top{flex-wrap:wrap}}
.room-system-order{list-style:none;padding:0;margin:12px 0 20px}.room-system-order>li{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:10px 0}.room-system-order>li>span{min-width:0;overflow-wrap:anywhere}.room-system-caption{min-width:0;flex:1}.room-system-caption>.field{margin:8px 0 0}.room-system-caption>.field>span{font-size:12px}.room-system-order small{display:block;color:var(--muted);font-size:12px}.native-menu.native-carousel{overflow:hidden;touch-action:pan-y;user-select:none}.native-wheel-track{position:absolute;inset:0;pointer-events:none;fill:none}.native-screen .native-menu .native-wheel-card{display:block;min-height:44px;padding:0;border:0;border-radius:8px;background:transparent;color:#D8E4EB;font-weight:400;overflow:visible}.native-screen.glass .native-menu .native-wheel-card{background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none}.native-wheel-face{position:absolute;inset:0;pointer-events:none;overflow:visible}.native-wheel-icon{position:absolute;pointer-events:none;color:#CEDDE5}.native-wheel-card span{position:absolute;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;pointer-events:none}.native-screen .native-menu .native-wheel-card.selected{color:#D2FCFF;background:transparent;border:0}.native-wheel-card.selected .native-wheel-icon{color:#D2FCFF}.native-wheel-card.selected .native-wheel-face{filter:drop-shadow(0 0 9px #79DDEBAA)}.native-screen .native-menu .native-wheel-card:focus-visible{outline:2px solid #BFFAFF;outline-offset:1px}

`;
if(globalThis.customElements) {
  if(!customElements.get("native-panel-editor-0-7-13"))customElements.define("native-panel-editor-0-7-13",NativePanelEditor);
  if(!customElements.get("native-panel-editor"))customElements.define("native-panel-editor",class extends NativePanelEditor {});
}
