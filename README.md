# Set up a Home Panel without AI

Companion 0.7.12 · Elecrow Advanced 10.1-inch ESP32-P4 V1.2 / 1024×600 only.

This companion update changes the configuration editor, not the tablet dashboard. You configure existing Home Assistant entities; the app does not discover or provision your lights, alarm or other equipment into Home Assistant for you.

## Release status

This is a development release of the Home Assistant companion. Install it through a HACS custom repository or manually. It is not part of the default HACS catalog. This repository contains the companion only; firmware binaries are not included. The existing credential-free 0.9.8 factory package is available separately, but erased-board startup, C6 compatibility, Wi-Fi onboarding and recovery on a spare panel still need a physical test. A later experimental firmware failed startup on the development tablet and was rolled back. Do not install held 0.9.9 or staged 0.9.10 firmware.

Do not describe the complete clean-install product as validated yet. No new firmware is included in the companion ZIP.

## 1. Install the companion

### HACS custom repository

1. Open HACS in Home Assistant, select the three-dot menu → Custom repositories.
2. Add `https://github.com/abastian75/native-home-panel` and select **Integration**.
3. Open **Native Home Panel** in HACS and download the release.
4. Restart HA. Add **Native Home Panel** in Settings → Devices & services, then open **Native Panel** in the sidebar. Existing installations should retain their integration and stored configuration.

[Open repository in HACS](https://my.home-assistant.io/redirect/hacs_repository/?owner=abastian75&repository=native-home-panel&category=integration)

### Manual installation

1. Back up Home Assistant and preserve any unpublished browser draft.
2. Extract the companion ZIP. Copy `custom_components/native_panel` into Home Assistant's configuration directory, inside `custom_components`. Preserve other integrations and the existing integration's stored data.
3. Restart Home Assistant. In Settings → Devices & services → Add integration, choose **Native Home Panel**. If already installed, keep the existing integration; do not delete and re-add it.
4. Open **Native Panel** in the HA sidebar. The page explains pairing when no tablet is connected.

## 2. Prepare a new tablet

1. Match the exact supported board revision. Keep the existing tablet's recovery images. A blank board needs its programming USB/UART0 connection; it cannot receive OTA yet.
2. Use the separate matching clean-install package and its START-HERE instructions. Use the **factory** image for the initial USB installation and an **OTA** image only for a later network update. Never use a private, already-configured device image for somebody else's tablet.
3. On the touchscreen, open Local Setup, join Wi-Fi and set the display name, brightness, volume and display timeout. These remain local device settings.
4. Enter HA's base address, for example `http://homeassistant.local:8123`, without a dashboard path. The panel and HA must be reachable on the same trusted network. HTTPS requires a trusted certificate.
5. In the companion, choose **Pair a touchscreen**. Enter the displayed, expiring pairing code on the tablet and pair. No HA account password needs to be entered into a firmware configuration file.
6. Choose **Refresh panels** and select the new touchscreen. Each tablet has its own configuration.

## 3. Build the layout

1. **Add room:** select an HA area or enter a custom room name. An HA area suggests its controls and systems. Uncheck unwanted items, review, then create the room in the draft. Selected systems are enabled/created and linked as part of that reviewed operation.
2. **Add controls:** from the room or a system group, search this HA room or all entities. Choose the entities and their systems. Adding confirms any proposed system links. Already assigned entities offer Edit assignment rather than being duplicated or silently moved.
3. **Custom systems:** choose Add system inside a room. Pick a discovered category or create a name such as Sprinklers or Aquarium. A category changes grouping, not the real capabilities of the entity.
4. **Edit a control:** select its row or three dots. Set its label, room and Show in systems memberships. A control can appear in several systems within one room; its label, state, order and schedules remain shared.
5. **Organize:** use each system's three dots to change its room-specific name/order. Use Room order to move rooms. The room's three dots offer rename/delete. Deleting a room offers moving its controls or removing only its panel assignments.
6. **Systems tab:** manage global categories and visibility in every room. Persistent tabs keep room-specific controls. Global Disable removes that system's placements throughout the panel after impact review. Re-enabling does not restore removed placements.
7. **Other settings:** configure Security, Alerts, Schedules, Layout, Theme and Photo screensaver. Preview is read-only and sends no device commands. Local Wi-Fi and screen settings remain on the touchscreen.
8. **Review & publish:** inspect the changes, then Publish to panel. Local drafts belong to this browser; publishing stores the configuration in HA for this tablet. Do not clear browser storage before publishing an important draft.

## Searching a large Home Assistant installation

The entity picker initially displays60 matches. Search covers the full HA entity catalog; Show more reveals another60 rows. Selected entities remain selected when a search hides them. System choices are computed once for each result batch, and search updates shortly after typing pauses. The existing64 configured-control limit on the tablet is unchanged.

## Firmware compatibility

Normal room/system editing uses the existing tablet interface. Hiding All systems and using several systems for one entity require firmware advertising those features; older firmware blocks publishing those options with a clear message. The current 0.9.8 clean-install image does not provide them. Do not bypass the guard or install an unvalidated experimental image to enable them.

## Troubleshooting

- No tablet: check Wi-Fi and the HA base address, generate a fresh pairing code, then Refresh panels.
- Missing entity: add the device to HA first, choose All entities, search its entity ID and refresh. HA area assignments are suggestions, not requirements.
- Already assigned elsewhere: Edit assignment and explicitly move its room; the same entity is not duplicated into two rooms.
- Old draft warning: the published revision changed. Restore only after reviewing which layout should win; neither version is silently overwritten.
- Publish blocked: finish/cancel open setup, resolve the first displayed validation error, or use firmware-compatible options.
- Removing a panel control does not turn the actual device off. A separate schedule or automation may still control that device.

## Distribution work remaining

The folder layout supports packaging one HA integration. The repository includes maintainer and support metadata for custom-repository distribution. Default-catalog inclusion and branding submission are separate, unfinished steps. References: [HACS integration requirements](https://hacs.dev/docs/publish/integration/) and [general publication requirements](https://hacs.dev/docs/publish/start/), checked October 31, 2026.

The remaining product gates are a spare-board clean-install/recovery test, resolving the experimental boot failure, hardware testing of the new firmware features, and a complete new-user acceptance run without developer intervention. No AI should be required for the configuration steps above after a supported, validated firmware is installed.
