# Home Command Center

Smart plugs fail silently: a plug can report "on" while the appliance behind it has stopped working. **Home Command Center** watches smart-home devices for exactly that kind of failure, explains it in plain language, and lets you control everything by typing, by voice, from a TV, or through an Alexa+-style MCP server.

Built for the **Build, Ship, Shape: Amazon Developer Hackathon**. Primary track: **Alexa+** (a self-hosted MCP server plus a web page acting as an MCP client). The repo also contains a native **Fire TV (Vega OS)** dashboard and **ESP32** firmware for a real, sensor-checked motor controller.

## What it does

- **Fault detection with explanations.** The backend raises alerts such as *"Pump Plug is switched on but not running"* and explains the likely cause. Detection works on measured behaviour (vibration, reports going silent), not on what a device claims.
- **Reliable timed runs.** "Run for 10 minutes" is scheduled and enforced by the backend, and reports a failure if the device stops early.
- **MCP server (Alexa+ track).** Seven tools over Streamable HTTP with OAuth 2.1 + PKCE account linking. See [MCP server](#mcp-server).
- **Tamil and English assistant (optional, needs AWS).** The web assistant translates Tamil to English with Amazon Translate, picks a tool, calls the MCP server, and translates the reply back. Voice input uses Amazon Transcribe streaming.
- **TV dashboard.** A native Vega OS app shows device health, alerts, notes and a live panel of what the assistant just did.
- **Real hardware.** An ESP32 reports every second (relay state plus whether the motor is really turning, measured with an MPU6050) and takes on/off commands from the backend. It also exposes two Matter on/off plugs (the relay and the board's own LED), and has been paired with an Echo through the Alexa app, so "Alexa, turn on the ESP32 LED" works by voice without any cloud skill.

## Quick start (no AWS account needed)

Requires **Node.js 20.12+** and `openssl`.

```bash
scripts/setup.sh    # installs dependencies, generates random local secrets, builds the web UI
scripts/start.sh    # backend :4000, MCP server :4100, web assistant :4200
```

Open **http://127.0.0.1:4200**, click a phrase ("Are there any alerts?", "Run the Fan Plug for 10 minutes") and watch the trace: request, chosen MCP tool, reply. In this offline mode a keyword matcher routes English requests; Tamil and voice need AWS (below).

To see a fault: turn on the Pump Plug and fast-forward the simulation ten minutes:

```bash
curl -X POST localhost:4000/devices/pump-plug/power -H 'Content-Type: application/json' -d '{"power":"on"}'
curl -X POST localhost:4000/simulate/advance -H 'Content-Type: application/json' -d '{"minutes":11}'
curl localhost:4000/alerts
```

## Architecture

```
 Alexa+ / any MCP client ──► MCP server :4100 ──┐
 (web assistant :4200,        OAuth 2.1 + PKCE   │      ┌──► Fire TV (Vega) dashboard
  Tamil/English, voice)       7 tools            ├──► Backend :4000 ──┤
                                                 │    devices, alerts,└──► web assistant status
 ESP32 motor node ── Wi-Fi, X-Device-Key ────────┘    timed runs, notes, activity log
 (relay + vibration sensor, Matter plug)
```

| Folder | What it is |
|---|---|
| `backend/` | Express API: simulated devices, anomaly detection, timed runs, notes, activity log, ESP32 node reports |
| `packages/mcp-server/` | The Alexa+ track deliverable: MCP server (spec 2025-11-25) with its own OAuth 2.1 authorization server |
| `packages/web/` | Assistant: local server (Translate, Transcribe, Bedrock tool routing, MCP client) plus React UI |
| `packages/vega/` | Fire TV dashboard (React Native for Vega OS) |
| `packages/shared/` | Types, API client and formatting shared by the dashboard, MCP server and web app |
| `firmware/motor-node/` | ESP32 / ESP32-S3 firmware (Arduino) |
| `FRICTION_LOG.md` | Developer-experience feedback gathered while building |
| `evidence/` | Captured proof: protocol-check output, test totals, ESP32 serial log excerpt |

## MCP server

`packages/mcp-server` implements MCP over **stateless Streamable HTTP** (`POST /mcp`) and requires a Bearer token on every call (401 without a `WWW-Authenticate` header, as Amazon's docs describe).

Tools: `list_devices`, `get_device_status`, `get_recent_alerts`, `set_device_power`, `run_device_for_duration`, `add_note`, `list_notes`. Replies are written to be read aloud, device names are matched loosely ("the pump plug"), and a timed run on a faulty device is refused.

The transport follows the MCP 2025-11-25 rules: `Origin` is validated (403 for foreign origins), JSON-RPC batches and tokens in the query string are refused, and `initialize` issues an `Mcp-Session-Id`. Session ids are signed (random nonce + HMAC) instead of stored, so the server stays stateless and restartable.

Account linking is an OAuth 2.1 authorization-code flow with mandatory **PKCE S256**, a resource indicator, refresh tokens, hashed token storage, and a passcode consent page with lockout after repeated failures. Discovery metadata is served at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`. The web assistant links to the server with this same flow, so the demo exercises the real authentication path.

```bash
curl localhost:4100/.well-known/oauth-protected-resource
curl -i -X POST localhost:4100/mcp   # 401: not linked
```

**Protocol conformance.** Besides our own tests, the server was checked with a third-party tool for Alexa+ MCP servers, [alexa-plus-mcp-checks](https://github.com/ubmids/alexa-plus-mcp-checks) (MIT, run unmodified): 11 checks pass and 2 are skipped because they cover an optional Echo Show view feature. The output is in [`evidence/mcp-protocol-checks.txt`](evidence/mcp-protocol-checks.txt). Running it found five gaps in our first version (Origin validation, batch and query-token refusal, session ids, and a metadata address mismatch in the test setup), which are now fixed and covered by tests. A second third-party tool, [Hearsay](https://github.com/hearsayhq/hearsay) (voice-readiness lint of the tool list), reports no findings; see [`evidence/hearsay-lint.txt`](evidence/hearsay-lint.txt).

## AWS mode (Tamil, voice, model-based routing)

Set `ASSISTANT_MODE=aws` in `packages/web/.env` (see `.env.example`) with an AWS profile that can call Amazon Translate, Amazon Transcribe streaming and Amazon Bedrock (default model `us.amazon.nova-lite-v1:0`, region `us-east-1`). The least-privilege IAM policy is just `translate:TranslateText`, `transcribe:StartStreamTranscription*` and `bedrock:InvokeModel*`. Press **Speak** in the UI for voice. Microphone audio goes only to your own AWS account (the browser's built-in speech recognition is deliberately not used).

## Fire TV dashboard

Needs the Vega SDK and a Fire TV device with developer mode enabled. `scripts/vega-build.sh Release` mirrors the source to a path without spaces, bundles the JavaScript and builds the package; install with `vega device install-app`. Set the backend's LAN address in `packages/vega/src/config.local.ts` (copied from `config.example.ts`). The dashboard's pieces are covered by Jest tests that run without a device.

## ESP32 firmware

`firmware/motor-node/` builds for the classic ESP32 and the ESP32-S3 (pins are chosen per chip). Copy `secrets.example.h` to `secrets.h`, fill in Wi-Fi and the backend address and device key, then:

```bash
arduino-cli compile -b esp32:esp32:esp32:PartitionScheme=huge_app firmware/motor-node
```

The relay switches only the low-voltage (5 V) side. **Never connect mains to the relay.** On a real water tank, keep an independent mechanical float valve.

## Tests

```bash
(cd backend && npx vitest run)               # 29
(cd packages/shared && npx vitest run)       # 7
(cd packages/mcp-server && npx vitest run)   # 46, including a real MCP client over HTTP, the OAuth security cases and the transport rules
(cd packages/web && npx vitest run)          # 43
(cd packages/vega && npx jest)               # 10
```

## Security notes

Services bind to loopback by default; the ESP32 endpoint requires a shared device key; the web assistant rejects requests from other origins; OAuth tokens and authorization codes are stored hashed; secrets live only in git-ignored `.env`, `secrets.h` and `config.local.ts` files.

## Status and honest limitations

- **Devices are simulated** (fictional brands), except the ESP32 node, which is real hardware. Alexa offers third-party apps no way to read a customer's device list or state, so real Amazon devices are not read.
- **Matter pairing uses the library's test credentials**, so the Alexa app asks you to confirm that the device is not Matter certified. Matter control through an Echo is demonstrated with the board's LED; the relay is not yet wired to a load.
- **Alexa+ add-on tools are in preview for select partners**, so this project does not deploy to an Alexa+ device. The Alexa+ experience is demonstrated through the self-hosted MCP server and a web page acting as a real MCP client, which the hackathon rules allow.
- **AWS mode is built and covered by tests against fakes**; see the project description for how far live verification got before the submission deadline.
- The Tamil starter phrases are first drafts and should be reviewed by a native speaker.
- Hardware safety features beyond "on but not running" and "went offline" (tank level cut-off, dry-run protection, autopilot) are designed but not built.

## License

MIT. See [LICENSE](LICENSE).
