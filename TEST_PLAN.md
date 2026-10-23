# Test Plan — Smart Home Command Center

Order confirmed by the user: **simulator/emulator first for everything, real devices only after that passes.** Real devices available: a real Fire TV, and the real Alexa/Smart Hub setup described in PROJECT_NOTES.md.

## Phase A — Backend (already largely done)
- `npm test` in `backend/` — 7/7 automated tests, including the exact real-incident fault pattern and the reliable timed-run engine.
- Manual smoke test via `curl` against `localhost:4000` (already done — see PROJECT_NOTES.md).
- **Still to do:** a scripted end-to-end scenario that replays the full incident (`POST /devices/pump-plug/power {on}` → `POST /simulate/advance {minutes:11}` → assert `GET /alerts` shows it) as a repeatable smoke-test script, not just ad hoc curl commands.

## Phase B — Fire TV App
1. **Emulator first.** Use an **Android TV system image** (not a phone image) so navigation is D-pad-first like a real Fire TV remote — this matters directly for the "Design" judging criterion (intuitive interaction model for the device). Create the AVD with `avdmanager create avd -n FireTV_Test -k "system-images;android-34;android-tv;arm64-v8a" -d tv_1080p`, launch with `emulator -avd FireTV_Test`.
2. Run the RN app against it (`npx react-native run-android`), verify:
   - Dashboard renders all 6 seeded devices + any custom-registered one
   - D-pad navigation moves focus between device tiles / alerts / notes sensibly (no touch-only interactions)
   - Triggering `/simulate/advance` on the backend causes the alert to appear on-screen without a manual refresh
   - The "run for N minutes" action actually flips power state and later flips it back
3. **Real Fire TV device, once the emulator pass is clean.** Enable ADB debugging on the device (Settings → My Fire TV → Developer Options → ADB Debugging) and note its IP, then:
   ```bash
   adb connect <fire-tv-ip>:5555
   npx react-native run-android --deviceId=<fire-tv-ip>:5555
   ```
   Confirm the same checklist as step 2, plus remote-control feel (real Fire TV remote, not keyboard-emulated D-pad) and real network latency to the backend.

## Phase C — Alexa+ MCP Server
1. **Local dev, tunneled.** Run the MCP server locally, expose it via `cloudflared tunnel` (Alexa+ requires a public HTTPS URL — no localhost).
2. `alexa-ai new mcp` then `alexa-ai deploy` to the development stage.
3. **Web simulator first** (Alexa+ developer console) — this is Amazon's own recommended first test surface, confirming: tool discovery works, OAuth 2.1/PKCE auth succeeds, each tool (`list_devices`, `get_device_status`, `get_recent_alerts`, `run_device_for_duration`) returns correct results for realistic English utterances.
4. **Real device — only if eligible.** Alexa+ has its own device/region eligibility requirements separate from plain Alexa; **we haven't confirmed whether the Smart Hub in the household is Alexa+-eligible** — don't assume it is. Check this in the Alexa app / developer console before planning a real-device Alexa+ test; if it isn't eligible, the web simulator is the legitimate test surface anyway (the track explicitly allows this) and that's fine for submission.

## Phase D — Tamil Bridge (companion web app)
1. **Typed Tamil text first** (skip Transcribe initially) — verify Translate round-trip (ta→en→tool call→en→ta) and Bedrock tool-use correctly picks the right MCP tool from natural Tamil phrasing.
2. **Spoken Tamil via Transcribe** — you (as a native speaker) provide sample utterances (a status question, a timed-run command, a note) and judge whether the translated intent and the Tamil response actually make sense — this can only be validated by a native speaker, not automated.

## Phase E — Combined end-to-end scenario
Fast-forward a simulated fault → confirm it surfaces in *all three* places consistently: the Fire TV alert panel, the Alexa+ MCP `get_recent_alerts` tool (English), and the Tamil web app (Tamil). This is the "combine" step from the plan and doubles as the core demo-video sequence.

## Phase F — Final real-device pass
Once B, C, and D each pass in their simulated/emulated form, re-run the Phase E combined scenario against the real Fire TV device (and the real Alexa+ device, if Phase C confirms eligibility) as the final check before recording the demo video.

## Open item
Confirm Alexa+ device eligibility for the household's Smart Hub before Phase C step 4 — not assumed here.
