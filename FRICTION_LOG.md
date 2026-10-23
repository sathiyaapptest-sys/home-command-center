# Friction Log

Tracked per Amazon's official format (confirmed via amazonappdev2026.devpost.com/rules) — up to a 10% judging bonus is applied for submitting these. Fields: task attempted, steps taken, expected vs. actual result, severity, workaround used, actionable suggestion.

---

### 1. `brew install --cask temurin@17` fails non-interactively

- **Task attempted:** Install a JDK on macOS via Homebrew to build the React Native Fire TV app (Amazon Devices Builder Tools require a working Java runtime).
- **Steps taken:** `brew install --cask temurin@17`
- **Expected result:** JDK installs cleanly, as with any other cask.
- **Actual result:** Fails with `sudo: a terminal is required to read the password; either use the -S option to read from standard input or configure an askpass helper` — the cask's underlying `.pkg` installer requires an interactive sudo prompt, which fails in any non-interactive/automated shell (CI, agent-driven terminals, scripted setup).
- **Severity:** Medium — blocks any scripted/automated onboarding flow for Fire TV development; not Amazon-specific, but directly hit while following Amazon Devices Builder Tools' implied Java prerequisite.
- **Workaround used:** Installed the `openjdk@17` Homebrew *formula* instead of the *cask* — formulas install into Homebrew's own prefix and don't require root/sudo.
- **Actionable suggestion:** Amazon Devices Builder Tools' setup docs/scripts for Fire TV should recommend `brew install openjdk@17` (formula) over the cask, or document the sudo requirement explicitly, so automated/agent-assisted setup flows (which the hackathon itself encourages via ADBT's AI-coding-agent integration) don't silently fail.

---

### 2. Vega Virtual Device fails with a misleading error when its instances directory is missing

- **Task attempted:** Start the Vega Virtual Device after `vega sdk install` succeeded.
- **Steps taken:** `vega virtual-device start`
- **Expected result:** Device boots, or an error naming the actual problem.
- **Actual result:** `Vega operation FAILED due to an irrecoverable error: Registering QEMU binary as identified to system failed.` The real first failure was only visible by calling the bundled `virtualdevice create-and-launch` binary directly: `object does not exist: ~/.kepler/virtual_device/instances`. The CLI wrapper swallows the underlying error and the message points at QEMU/Gatekeeper, which sent debugging in the wrong direction for hours.
- **Severity:** High — the first-run path of the simulator-first workflow Amazon recommends fails with an error that misdirects.
- **Workaround used:** `mkdir -p ~/.kepler/virtual_device/instances`, then launch the underlying binary directly.
- **Actionable suggestion:** Create the instances directory during `vega sdk install`, and surface the underlying error text (or a `--verbose` flag on `vega virtual-device start`) instead of the generic QEMU registration message.

---

### 3. Bundled QEMU binaries rejected by macOS Gatekeeper; Hypervisor entitlement missing

- **Task attempted:** Run the Vega Virtual Device on an Apple Silicon Mac (macOS 27).
- **Steps taken:** `spctl -a -vv .../vvd/images/tv/vmtools/agent/qemu/darwin-aarch64/qemu-system-armel`, `codesign -dv` on the same binary.
- **Expected result:** SDK-shipped emulator binaries run without manual security steps, or the docs list the steps.
- **Actual result:** Binaries are ad-hoc signed only (no Team ID); `spctl` reports `rejected`; first launch raises a macOS "override security settings" prompt. After approval, the process still dies in Hypervisor.framework with `UniversalExceptionRaise: (os/kern) failure (5)` and no crash report written, so the cause is not discoverable from logs.
- **Severity:** High — blocks the Virtual Device entirely on a current Apple Silicon Mac.
- **Workaround used:** Ran `spctl --add` for the four qemu binaries and re-signed them with a `com.apple.security.hypervisor` entitlement; still failing (investigating Developer Tools permission for the host terminal).
- **Actionable suggestion:** Ship the qemu binaries signed and notarized with the hypervisor entitlement, and document the macOS permissions (Gatekeeper approval, Developer Tools permission) in the Vega install guide.

---

### 4. Disk footprint of SDK + Virtual Device is undocumented and fails late

- **Task attempted:** `vega sdk install` on a machine with ~7GB free.
- **Actual result:** CLI/SDK tools installed, then the Virtual Device image failed at ~100% with `No space left on device`, after downloading several GB; the install rolled back, wasting the download. Needed roughly 10GB+ of headroom in practice.
- **Severity:** Medium.
- **Workaround used:** Freed ~20GB (build caches) and re-ran.
- **Actionable suggestion:** Document the required free space up front and check it before downloading.

---

### 5. `vega exec vda connect` fails with "No route to host" on macOS although the device is reachable

- **Task attempted:** Connect a Vega Fire TV Stick over TCP/IP (Developer Options → Connection Mode → TCP/IP) and install an app.
- **Steps taken:** `vega exec vda connect <stick-ip>:5555`.
- **Expected result:** `connected to <ip>:5555`.
- **Actual result:** `failed to connect ...: No route to host -- ip or mac address`, while `ping` and `nc -z <ip> 5555` from the same shell both succeeded. The cause is the auto-started background `vda` server (`vda -L tcp:5037 fork-server server`): macOS blocks LAN access for detached daemons that no permitted app owns, and the error message gives no hint of that.
- **Severity:** High — looks like a network or router fault, so users will debug the wrong thing.
- **Workaround used:** `vega exec vda kill-server`, then run `vega exec vda server nodaemon` in a Terminal tab (so macOS attributes it to Terminal), then `vega exec vda connect` worked immediately.
- **Reproduced 2026-10-21:** after the Stick got a new DHCP address, the foreground `vda server nodaemon` also logged `network.cpp:149 failed to connect to '<ip>:5555': No route to host`, while `nc -zv <ip> 5555` run in the same Terminal tab succeeded. Stopping and restarting the helper made `vda connect` work immediately. So the failure is intermittent and unrelated to reachability, which makes it very hard to diagnose.
- **Actionable suggestion:** Detect EHOSTUNREACH from the vda server on macOS and print the Local Network permission / foreground-server workaround; document it on the "Configure VDA over TCP/IP" page.

---

### 6. Docs disagree on whether a physical Vega device needs USB or network

- **Task attempted:** Connect a Fire TV Stick 4K Select for development.
- **Actual result:** "Enable Developer Mode" says the device must be on the same network and does not mention a cable; "Run Your App" says to connect it to the computer with a USB cable and to a display over HDMI; "VDA over TCP/IP" says USB is the default and TCP/IP needs a one-time USB step or an on-device Connection Mode toggle. A developer whose computer is not next to the TV cannot tell which applies.
- **Severity:** Medium.
- **Workaround used:** On-device Connection Mode toggle (no USB needed).
- **Actionable suggestion:** Lead the device setup docs with the Connection Mode toggle and state clearly that USB is optional.

---

### 7. `vega build` succeeds without a JS bundle; the app then crashes instantly with no useful message

- **Task attempted:** Build and run a generated `helloWorld`-template app on a real Fire TV Stick 4K Select.
- **Steps taken:** `vega build` (reported `exit 0`, produced a 3.5KB `.vpkg`), `vega device install-app`, `vega device launch-app`.
- **Expected result:** App launches, or the build fails.
- **Actual result:** Install and launch report success, but the process is gone within a second: `acr_core_dump ... crashed with signal 6`. The package contained only the native shell and a config file; JavaScript is produced by a different command (`react-native build-vega`) that `vega build` never runs. Nothing warns that the bundle is missing.
- **Severity:** High — a successful build, install and launch produce an app that crashes with a binary minidump and no readable reason.
- **Workaround used:** Run `react-native build-vega` first, then `vega build`; verify the package contains `index.hermes.bundle` (package size jumped from 3.5KB to 164KB).
- **Actionable suggestion:** Make `vega build` fail or warn when no JS bundle is present; document the two-step build next to the generated "common commands" text.

---

### 8. JS bundling silently depends on Node 20 and on a project path with no spaces

- **Task attempted:** `npm run build:release` / `react-native build-vega` and `react-native start` on a machine with Node 18.
- **Actual result:** `configs.toReversed is not a function` (Node 18 lacks it); the SDK's own bundled Node is also v18.20.4, so `vega exec` does not help. Under Node 20 the next failure is `/bin/sh: /Users/<user>/My: No such file or directory` — the manifest builder does not quote the project path, so any repo under a folder with a space fails.
- **Severity:** High — both fail with errors that point away from the cause.
- **Workaround used:** Installed Node 20 via nvm; wrote `scripts/vega-build.sh`, which mirrors the source to a space-free directory and builds there.
- **Actionable suggestion:** Quote paths in `kepler-module-manifest-builder`, ship a Node >= 20 in the SDK (or fail early with a version check), and state both requirements in the install guide.

---

### 9. The Alexa AI CLI cannot be installed from public sources, and its obvious npm name belongs to an unrelated package

- **Task attempted:** Install the `alexa-ai` CLI that the Alexa+ MCP QuickStart tells you to use (`alexa-ai configure`, `alexa-ai new mcp`, `alexa-ai deploy`).
- **Steps taken:** Read the QuickStart and the Account Linking page (neither gives an install command), searched, then `npm view alexa-ai`.
- **Expected result:** A public install command in the quickstart.
- **Actual result:** The QuickStart says only "after you install the CLI". `npm view alexa-ai` returns a real, public package (v2.6.0, created 2026-09-06) that is an unrelated WhatsApp-bot library by an individual — a developer following the obvious name would install and run it. The real install is on a separate page ("Set Up Your Development Environment"): `npm install -g @alexa-ai/cli` from a private AWS CodeArtifact registry, which first requires an AWS account, an IAM user with programmatic access keys, role assumption into an Amazon-owned account, Git/CodeCommit configuration, and Node 24+.
- **Severity:** High — the first step of the Alexa+ track is undiscoverable from the quickstart, and the nearest public package is a supply-chain trap.
- **Workaround used:** Verified the npm package's publisher/repository before running anything and did not install it; followed the setup page instead.
- **Actionable suggestion:** Put the install command and prerequisites at the top of the QuickStart, publish the CLI (or a stub that redirects) under the obvious public name, and offer a lighter credential path than a hand-built IAM user for hackathon participants.

---

### 10. Alexa AI CLI setup fails with AccessDenied on `AddOn3PDeveloperToolsRead`; the docs don't say the AWS account must be approved

- **Task attempted:** Follow "Set Up Your Development Environment" to install `@alexa-ai/cli`.
- **Steps taken:** Created IAM user `alexa-ai-user`, attached the exact inline policy from the page (`sts:AssumeRole` on `arn:aws:iam::372468808636:role/AddOn3PDeveloperToolsRead`), created access keys, configured the `alexa-ai-user` and `alexa-ai` profiles exactly as documented, then `aws sts get-caller-identity --profile alexa-ai`.
- **Expected result:** Role assumption succeeds, so the CodeArtifact login and `npm install -g @alexa-ai/cli` can proceed.
- **Actual result:** `AccessDenied: User ...:user/alexa-ai-user is not authorized to perform: sts:AssumeRole on resource: ...AddOn3PDeveloperToolsRead`. The base keys work (the base profile resolves to the IAM user) and the policy was re-checked in the console, so the role's trust policy appears not to include this account. The only hint is one line saying to log in to "the AWS account that you provided to the Alexa Solutions Architect", which a hackathon participant has no way to act on.
- **Severity:** Critical — blocks installing the CLI, and with it deploying and testing an Alexa+ add-on.
- **Resolution (2026-10-07):** the hackathon FAQ says the Alexa+ Add-on developer tools (Category SDK, MCP Toolkit, CLI, Web Simulator) are in preview and available to select partners only, so participants should build self-hosted MCP servers. The setup and account-linking pages I read (as summarized by my fetch tool) did not say this, so a participant discovers it only by hitting AccessDenied after creating IAM users and keys. A single line at the top of the setup page, or an error that says "not enrolled in the preview", would have saved most of a day.
- **Workaround used:** Built a self-hosted MCP server and a web page that acts as an MCP client over Streamable HTTP, as the FAQ allows.
- **Actionable suggestion:** State on the setup page that the AWS account must be approved, say how a hackathon participant gets that (form, office hours, or automatic on registration), and return an error that says "account not enrolled" instead of a generic AccessDenied.

---

### 11. A brand-new AWS account (Free plan) cannot redeem the hackathon's AWS credits, and AWS errors never mention the plan

- **Task attempted:** Use Amazon Translate, Transcribe and Bedrock for the AWS Builder mini-challenge, funded by the $150 hackathon credit.
- **Steps taken:** Created a new AWS account (AWS India entity, Free plan by default), requested the credit through the form on the hackathon Resources page, then tried Translate and Bedrock with a least-privilege IAM user.
- **Expected result:** The calls work, and the credit can be redeemed.
- **Actual result:** Billing → Credits shows the Redeem button disabled with "AWS accounts with free plans cannot redeem credits." Separately, days after sign-up, Translate returns `SubscriptionRequiredException: The AWS Access Key Id needs a subscription for the service` and Bedrock returns "Your account is currently being verified... normally takes less than 2 hours". Neither message mentions the Free plan, so it is unclear whether verification, the plan, or the account type is the blocker (cause not confirmed at the time of writing).
- **Severity:** High — a participant following the hackathon's own steps (new account, request credits) hits two silent blockers, and the error text points at the wrong thing.
- **Workaround used:** Built AWS mode behind interfaces and tested it against fakes, and shipped an offline mode (keyword routing, English) so the project runs without any AWS account.
- **Actionable suggestion:** State on the Resources page that credits need the Paid plan, and have the Translate/Bedrock errors say "Free plan accounts cannot use this service" when that is the cause.

---

### 12. Alexa names a Matter device's endpoints "Second plug" and "Third plug", with no way to tell which is which

- **Task attempted:** Pair an ESP32 that exposes two Matter on/off plugs (a relay and its onboard LED) with an Echo through the Alexa app, then control each by voice.
- **Steps taken:** Alexa app → Devices → + → Add Device → Matter → entered the 11-digit setup code the board prints on its serial port, accepted the "not Matter certified" prompt, then set up the three devices Alexa listed one at a time.
- **Expected result:** Each plug appears with something that says which endpoint it is, or the setup flow lets you identify it (a "test this device" toggle).
- **Actual result:** Pairing worked and the uncertified prompt allowed it to continue, but the devices were listed as "First device", "Second plug", "Third plug" (the first being the board itself). The only way to learn which plug was the LED was to switch each one on and watch the board.
- **Severity:** Low — it works, but it is confusing for anyone building a multi-endpoint Matter device, and nothing in the setup flow warns about it.
- **Workaround used:** Switched each plug on from the app while watching the board's LED and the backend state, then renamed them.
- **Actionable suggestion:** Show the Matter endpoint's label (or its device type and endpoint number) during setup, and add a "Test" or "Identify" button that sends the Matter Identify command, so developers can tell endpoints apart.

---

<!-- Add new entries above this line as they occur. Keep the format consistent. -->




