# TiltX

**Turn an Android phone into a real-time motion controller for a browser racing game.**

TiltX is a demo-ready monorepo: a phone's accelerometer and gyroscope steer a
Three.js car running in a browser on your laptop, over a Socket.IO link, with QR
pairing, live calibration, latency measurement and automatic reconnection.

```
   Android phone                    WebSocket (LAN)                 Laptop browser
┌──────────────────┐          ┌────────────────────────┐         ┌──────────────────┐
│  TiltX Controller│  ──────▶ │  TiltX backend (Node)  │ ──────▶ │  TiltX game      │
│  tilt → input    │  input   │  rooms · auth · rate   │  input  │  Three.js scene  │
│  shake → boost   │  status  │  limits · latency      │         │  physics · HUD   │
└──────────────────┘          └────────────────────────┘         └──────────────────┘
```

## Table of contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Repository layout](#repository-layout)
4. [Requirements](#requirements)
5. [Quick start](#quick-start)
6. [Demo checklist](#demo-checklist)
7. [How pairing works](#how-pairing-works)
8. [Same-Wi-Fi / LAN setup](#same-wi-fi--lan-setup)
9. [Running the game](#running-the-game)
10. [Running the controller (web)](#running-the-controller-web)
11. [Controller features](#controller-features)
12. [Controls](#controls)
13. [Sensor model & sign conventions](#sensor-model--sign-conventions)
14. [Calibration](#calibration)
15. [Boost gesture](#boost-gesture)
16. [Latency & measurement](#latency--measurement)
17. [Reconnection & safe states](#reconnection--safe-states)
18. [Protocol reference](#protocol-reference)
19. [Configuration & environment variables](#configuration--environment-variables)
20. [Testing](#testing)
21. [Type checking](#type-checking)
22. [Production builds](#production-builds)
23. [Android APK with Capacitor](#android-apk-with-capacitor)
24. [Security notes](#security-notes)
25. [Troubleshooting](#troubleshooting)
26. [Limitations, roadmap, license](#limitations-roadmap-license)

---

## Overview

- **Phone as the controller.** Tilt left/right steers, tilt forward/back is
  throttle/brake, a deliberate shake fires boost. Keyboard is only an optional
  developer fallback.
- **Laptop as the display.** A Three.js / React Three Fiber scene runs the
  car, the track and the race HUD.
- **Real data only.** No mocked inputs anywhere: until calibration produces a
  baseline, the controller emits strictly neutral values.
- **Pairing you can demo.** The game renders a QR code; the controller scans
  or types a 6-character room code and gets a short-lived HMAC token.
- **Honest telemetry.** Round-trip latency, measured send rate, packet counts
  and reconnection attempts are all shown live.

## Architecture

| Layer | Tech | Role |
| --- | --- | --- |
| `packages/shared` | TypeScript (NodeNext) | Protocol events, message validation, sensor maths (calibration, filters, mapping, pipeline, shake) |
| `server` | Node + Socket.IO | Rooms, role slots, pairing tokens, rate limits, latency probes, grace periods |
| `apps/controller` | React 19 + Vite | Phone UI, motion capture (DeviceMotion / Capacitor), calibration, send loop |
| `apps/game` | React 19 + Vite + Three.js + R3F | Race scene, car physics, HUD, QR pairing overlay |

**Data flow:** `controller:input` (from phone) → server validation + rate
limit → `game:input` (to browser) → pure `stepRace()` simulation at frame rate.
The game's physics never trusts the client: every field is clamped again.

## Repository layout

```
TiltX/
├── apps/
│   ├── controller/        # phone app (web + Capacitor)
│   └── game/              # browser racing game
├── packages/shared/       # protocol + sensor maths (built to dist/)
├── server/                # Socket.IO backend
├── scripts/lan-ip.mjs     # print reachable LAN IPs for QR base URL
├── docs/                  # architecture & protocol notes
├── .github/workflows/     # CI
└── package.json           # npm workspaces
```

## Requirements

- **Node.js ≥ 20.19** (tested on Node 26)
- npm ≥ 10
- An **Android phone** on the **same Wi-Fi** as the laptop
- For sensor access over plain HTTP: Chrome's insecure-origin flag, **or**
  HTTPS, **or** the packaged Android app (see [Troubleshooting](#troubleshooting))
- For the APK only: **JDK 17** and the **Android SDK** (platform 35 +
  build-tools 35). Android Studio is convenient but optional — a headless
  command-line install works. None of this is needed for the browser workflow.

## Quick start

```bash
git clone <repo-url> TiltX && cd TiltX
npm install
npm run dev
```

This starts three processes:

| Process | URL |
| --- | --- |
| Backend | http://localhost:3001 (health: `/health`) |
| Game | http://localhost:5174 |
| Controller | http://localhost:5173 |

Open the **game** on the laptop, then pair the phone (next sections).

Pairing needs **no configuration**: when a room is created the backend detects
this machine's reachable LAN address (the default-route interface) and builds
the QR link from it, so switching Wi-Fi does not require editing any file. See
[Same-Wi-Fi / LAN setup](#same-wi-fi--lan-setup) for the rare overrides.

## Demo checklist

Five minutes, two devices, no Android toolchain required.

1. **Start everything** from the repo root — backend `0.0.0.0:3001`, game
   `:5174`, controller `:5173`:

   ```bash
   npm run dev
   ```

   Leave it running. Restarting the backend invalidates outstanding pairing
   tokens, so refresh the game page if you restart mid-demo.

2. **Check the QR address (usually nothing to do).** The backend
   auto-detects this machine's reachable LAN address and combines it with the
   controller port, so the QR keeps working when you switch Wi-Fi:

   ```bash
   npm run lan:ip     # prints the interface + address the QR will use
   ```

   If it prints the wrong interface (e.g. a VPN is up), pin it with
   `LAN_ADDRESS_OVERRIDE=<ip>` or set a full `CONTROLLER_BASE_URL` — see
   [Same-Wi-Fi / LAN setup](#same-wi-fi--lan-setup). No file editing or rebuild
   is required.

3. **Open the game** at <http://localhost:5174>. The pairing overlay shows a QR
   code, the 6-character room code, and the LAN URL it encodes.

4. **On the phone — same Wi-Fi — allow motion sensors first.** Chrome blocks
   `devicemotion` on plain-HTTP origins:

   - open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
   - add `http://<lan-ip>:5173`, set the flag to *Enabled*, **Relaunch**

5. **Scan the QR** (or type the room code on the controller page). The
   controller pairs automatically, then: **Enable motion** → **Calibrate**
   (hold still ~1.5 s) → **Start driving**.

6. **Drive:** tilt to steer, tip the top forward for throttle, back for brake,
   shake hard for boost. The HUD shows speed, laps, measured input Hz and RTT.

7. **Safe states to show off:** background the phone browser → streaming stops
   and neutral input is sent; swipe away the game tab → the phone shows
   `reconnecting` and retries with backoff; both sides get a human-readable
   `room:closed` reason when the grace period (30 s) expires.

Watch the terminal for `[tiltx] room … created`, `controller joined` and
`controller slot taken over` while you demo.

## How pairing works

1. The game creates a room → the server returns `{ url, code, token, expiresAt }`.
2. The QR code encodes
   `http://<lan-ip>:5173/?room=CODE&token=TOKEN` — an absolute LAN URL, never `localhost`.
3. The controller reads `?room=` / `?token=` and calls `controller:join`.
4. The token is an **HMAC over room + expiry** (default 900 s). Valid token ⇒
   automatic slot takeover (reconnect or fresh scan). No token ⇒ you must be
   the first controller, or pass `replace: true`.
5. The controller emits `controller:status` (calibrated / ready / Hz) so the
   game HUD knows the phone is actually usable.

Room codes are 6 characters from `A–Z0–9`, generated with `crypto` rejection
sampling (no modulo bias).

## Same-Wi-Fi / LAN setup

A phone cannot resolve `localhost`, so the QR code must encode a LAN address.
You normally don't have to do anything: when the game creates a room it sends
**no** base URL, and the backend resolves one from its live network
interfaces — combining the detected address with the controller port:

```bash
npm run lan:ip          # prints the interface + address the QR will use
```

The selection logic (shared between the server and `lan:ip`) follows the
**default-route interface** — the one actually carrying traffic — so the QR
uses the address a phone can genuinely reach. It ignores virtual interfaces
(`utun`/VPN, `awdl`, `bridge`, `docker`, …) and never emits a loopback address.
It also **replaces** a stale or `localhost` base sent by the game, logging a
warning:

```
Default-route interface: en0
controller base http://localhost:5174 is not reachable from a phone — using http://<lan-ip>:5173
```

> A `172.17.x.x` address can look like Docker's default bridge, but that range
> is also a perfectly normal private LAN. If `npm run lan:ip` names the active
> Wi-Fi interface (e.g. `en0`) and the gateway in `route -n get default` is on
> the same subnet, it **is** the right address — do not "fix" it to a different
> IP, that only makes the QR unreachable. If the phone still can't connect, the
> network is isolating clients (common on guest/enterprise Wi-Fi); use a phone
> hotspot or a tunnel instead of changing the IP.

Overrides, in precedence order:

| Setting | Where | Use it when |
| --- | --- | --- |
| `CONTROLLER_BASE_URL` | `server/.env` | You want a fixed URL (reverse proxy/tunnel). Wins over everything. |
| `LAN_ADDRESS_OVERRIDE` | `server/.env` | Auto-detection picks the wrong interface (e.g. a VPN is up). |
| `CONTROLLER_PORT` | `server/.env` | The controller dev server runs on a non-default port (default `5173`). |
| `VITE_PAIRING_BASE_URL` | `apps/game/.env.local` | Rare: force the base from the game. Leave empty to let the server decide. |

Keep `CONTROLLER_PORT` (server) in sync with the controller's own `PORT`.
The controller runs on a **separate port** from the game (`5173` vs `5174`),
which is why the game's page origin is never a valid pairing base.

Concrete overrides (put these in `server/.env`, then restart `npm run dev:server`):

```bash
# Force a specific address (e.g. auto-detection picked a VPN interface):
LAN_ADDRESS_OVERRIDE=192.168.1.42
# Controller dev server on a non-default port:
CONTROLLER_PORT=5173
# Or bypass detection entirely with a full URL (tunnel / reverse proxy):
CONTROLLER_BASE_URL=https://tiltx.example.com
```

> The controller dev server uses `strictPort: true`, so if `5173` is already
> taken Vite **fails loudly** instead of silently moving to `5174` (which would
> make the QR point at the wrong port). Keep the controller's `PORT` equal to
> the server's `CONTROLLER_PORT` (both `5173` by default).

The QR overlay still warns loudly if the resolved URL is loopback, because that
link would be unreachable from a phone.

The controller can be opened two ways:

- **Web (no install):** open the QR URL in Chrome on the phone. The link
  carries `?room=…&token=…`, so pairing is automatic (token lasts 15 min).
- **APK:** install the app, enter the backend URL in *Server settings*, then
  type the **room code** shown on the laptop. The QR code cannot launch a
  locally installed APK, so the QR URL is only used by the web path; the APK
  pairs by room code and will claim the slot (auto-retrying with
  `replace: true` if something stale holds it).

## Running the game

```bash
npm run dev:game     # http://localhost:5174
```

On first load you'll see the pairing overlay with a QR code and room code. Once
the phone connects, calibrated and ready, the overlay disappears and the race
begins when you cross the start line.

HUD shows: speed (km/h), lap count, current/last/best lap, measured input Hz,
room code and RTT latency.

## Running the controller (web)

```bash
npm run dev:controller   # http://localhost:5173
```

Scan the QR code (or type the room code), tap **Enable motion**, **Calibrate**,
then **Start driving**.

> **Sensor permission needs a secure context.** Over plain HTTP on a LAN IP the
> browser will not expose `devicemotion`. Options:
> 1. Chrome flag (Android): `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
>    → add `http://<lan-ip>:5173` → relaunch.
> 2. Put the controller behind HTTPS (e.g. `npm install -D
>    @vitejs/plugin-basic-ssl` and enable it in `apps/controller/vite.config.ts`).
> 3. **Best:** use the packaged Android APK. Its origin is
>    `https://localhost` (a secure context), so the WebView exposes
>    `devicemotion` without any flag, and `@capacitor/motion` feeds it straight
>    to the controller. See [Android APK with Capacitor](#android-apk-with-capacitor).

## Controller features

| Feature | Detail |
| --- | --- |
| Steering | Tilt left/right; dead zone + sensitivity + EMA smoothing |
| Throttle / brake | Derived from **one** pitch command so they can never conflict |
| Calibration | 1.5 s window, per-axis median + MAD outlier rejection |
| Boost | 14 m/s² threshold, 90 ms sustain, 2 s cooldown (shake detector) |
| Diagnostics | RTT, packet count, measured Hz, socket id, reconnect attempts |
| Settings | Sensitivity, smoothing, input rate, invert pitch, server URL |
| Safety | Backgrounding the tab forces neutral and stops streaming |

## Controls

Hold the phone like a steering wheel. All axes are measured **relative to the
calibration baseline**, so the grip you calibrate in is the neutral position.

| Action | Gesture | Output |
| --- | --- | --- |
| **Steer left** | Tilt the phone left (left edge down) | `steering` negative → car turns left |
| **Steer right** | Tilt the phone right (right edge down) | `steering` positive → car turns right |
| **Accelerate** | Tip the **top forward** (away from you) | `throttle` 0→1 |
| **Brake / reverse-to-stop** | Tip the **top back** (toward you) | `brake` 0→1 |
| **Boost** | **Shake hard** once | temporary top-speed/accel increase |

Mutable in the controller's *Settings*: sensitivity (steering/pitch gain),
smoothing, input rate, invert-pitch, server URL. A small dead zone (default
8% of range) keeps the car straight when the phone is nearly level, and
throttle/brake come from a **single** pitch value so they can never both be
non-zero.

Verified in source: `packages/shared/src/sensor/mapping.ts`
(`lateralTiltToSteering`, `pitchToThrottleBrake`), applied to physics in
`apps/game/src/sim/vehicle.ts` (`heading += steering · turnRate · authority`,
`speed += throttle · acceleration`, `speed −= brake · deceleration`).

## Sensor model & sign conventions

The pipeline is orientation-aware (`orientTilt`) so it works in portrait or
landscape:

| Orientation | lateral | pitch |
| --- | --- | --- |
| 0° (portrait) | `gamma` | `beta` |
| 90° (landscape L) | `-beta` | `gamma` |
| 180° (upside down) | `-gamma` | `-beta` |
| 270° (landscape R) | `beta` | `-gamma` |

- `axes.lateral > 0` ⇒ phone's **left edge** is down.
- Steering is **negated**: left tilt ⇒ negative steering ⇒ car turns left.
- **Negative** pitch (top tipped forward) ⇒ throttle; **positive** ⇒ brake.
- Gyro + accelerometer are fused with a complementary filter (α = 0.985); with
  no gyro the accelerometer angle is used directly.

All of this is unit-tested in `packages/shared`.

## Calibration

Calibration records the **neutral holding angle**, so tilting is measured
relative to how you're actually holding the phone — not some absolute tilt.

Exact steps on the phone:

1. Hold the phone the way you'll drive (both hands, screen toward you).
2. Tap **Enable motion** (grant the sensor prompt if one appears). The button
   then reads **Motion enabled**.
3. Tap **Calibrate** and **hold the phone still for ~1.5 s** (the panel shows a
   countdown/progress and a **Cancel** button).
4. The button becomes **Recalibrate** — you're calibrated. Tap **Start driving**
   to begin streaming input (the button then reads **Stop driving**).

What happens under the hood:

```text
samples (≥15) → per-axis median → MAD-based outlier rejection → baseline
```

- Requires ≥ 15 kept samples (1.5 s window).
- Refuses to calibrate if `spread > 1.5 m/s²` (you moved too much).
- Until a baseline exists, the pipeline output is **strictly neutral**, so the
  car never lurches before you calibrate.
- The game's pairing overlay clears as soon as the controller connects; the
  HUD then shows `waiting → connected → calibrated → ready`, so you can watch
  the phone's sensor state before driving off.

## Boost gesture

| Constant | Value |
| --- | --- |
| Acceleration threshold | 14 m/s² |
| Sustain duration | 90 ms |
| Cooldown | 2000 ms |
| Re-arm threshold | 0.6 × trigger |
| Wire representation | Rising edge of `boost` in `controller:input` |

The game converts the flag into a rising edge and grants a bounded boost window
(`VEHICLE.boostDuration` 1.5 s). Ordinary handling cannot trigger it.

## Latency & measurement

- Both clients send `latency:ping { seq, t0 }`; the server echoes
  `latency:pong` (or acks) with the same `t0`.
- RTT = `performance.now() - t0`. Controller displays it in **Diagnostics**;
  the game shows it in the HUD.
- Send rate is **measured**, not estimated: packets are timestamped and counted
  over a 1-second sliding window.
- The server also reports `hz` back via `controller:status`.

## Reconnection & safe states

| Event | Behaviour |
| --- | --- |
| Controller socket drops | Phase → `reconnecting`, socket.io retries (400 ms → 4 s, 30 attempts), neutral packets on resume |
| Second controller joins | Slot taken over with a valid token; previous socket receives `room:closed` |
| Background tab | `visibilitychange` → neutral + stop streaming |
| Input stall > `INPUT_STALL_MS` | Server marks room stalled (safe-state monitoring) |
| Game disconnects | Grace period `GAME_GRACE_MS` (default 30 s), then room closes |
| Room closes | Both sides get `room:closed` with a human reason string |

## Protocol reference

All channel names and shapes live in `packages/shared/src/protocol.ts`
(`PROTOCOL_VERSION = 1`).

| Event | Direction | Payload |
| --- | --- | --- |
| `game:create-room` | game → server | `{ controllerBaseUrl? }` → `Ack<CreateRoomResult>` |
| `game:join` | game → server | `{ code }` → `Ack<JoinRoomResult>` |
| `game:close-room` | game → server | – |
| `controller:join` | controller → server | `{ code, token?, replace? }` → `Ack<JoinRoomResult>` |
| `controller:input` | controller → server | `ControllerInputPacket` |
| `controller:status` | controller → server | `{ room, calibrated, ready, hz }` |
| `game:controller-presence` | server → game | `ControllerPresence` |
| `game:input` | server → game | `ControllerInputPacket` |
| `room:closed` | server → both | `{ room, reason }` |
| `error` | server → both | `{ code, message }` |
| `latency:ping` / `latency:pong` | bidirectional | `{ seq, t0 }` |
| `heartbeat` | server → both | `{ serverTime }` |

`ControllerInputPacket`:

```ts
{ v: 1, room: "K7M2QX", seq: n, ts: ms,          // seq monotonic — stale dropped
  steering: -1..1, throttle: 0..1, brake: 0..1,
  boost: boolean, meta: { hz?, orientation?, calibrated? } }
```

## Configuration & environment variables

**Server (`server/.env`)**

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address (0.0.0.0 = reachable on LAN) |
| `CORS_ORIGINS` | empty = allow all | Allowed origins |
| `CONTROLLER_BASE_URL` | empty = auto-detect | Full QR base URL; wins over detection (e.g. a tunnel) |
| `CONTROLLER_PORT` | `5173` | Controller dev-server port used to build the QR URL |
| `LAN_ADDRESS_OVERRIDE` | empty | Pin the address when auto-detection is wrong |
| `PAIRING_SECRET` | generated | HMAC secret (set in prod!) |
| `PAIRING_TOKEN_TTL` | `900` | Token lifetime (s) |
| `MAX_INPUT_RATE` | `90` | Input packets/s |
| `INPUT_STALL_MS` | – | Stall threshold |
| `GAME_GRACE_MS` | `30000` | Reconnect grace |
| `ROOM_TTL_SECONDS` | `1800` | Empty-room TTL |
| `LOG_LEVEL` | `info` | Logging |

**Game (`apps/game/.env`)**

| Var | Purpose |
| --- | --- |
| `VITE_DEV_SERVER_PROXY` | Where `/socket.io` proxies in dev (default `http://localhost:3001`) |
| `VITE_PAIRING_BASE_URL` | Override the QR base from the game (leave empty to auto-detect) |
| `VITE_SERVER_URL` | Absolute backend URL (empty = same origin) |

**Controller (`apps/controller/.env`)**

| Var | Purpose |
| --- | --- |
| `VITE_DEV_SERVER_PROXY` | Same as above |
| `VITE_SERVER_URL` | Absolute backend URL (used as the initial default) |

## Testing

```bash
npm test                  # everything (unit + integration)
npm run test:unit         # shared + server unit + game sim
npm run test:integration  # Socket.IO integration suite
npm run test:watch        # watch mode
```

Current: **155 tests** across 14 files (shared sensor maths, server
unit/integration, game simulation).

## Type checking

```bash
npm run typecheck    # builds shared, then typechecks every workspace
```

`tsconfig.base.json` enables `strict`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `isolatedModules` and `forceConsistentCasingInFileNames`.

## Production builds

```bash
npm run build   # shared → server → game → controller
```

Artifacts:

- `server/dist` — run with `npm run start:server`
- `apps/game/dist` — static bundle (serve with any static host)
- `apps/controller/dist` — static bundle / Capacitor `webDir`

## Android APK with Capacitor

The native platform lives in `apps/controller/android` (generated, with build
outputs and `local.properties` gitignored). It targets **compileSdk/targetSdk
35**, **minSdk 23**, Android Gradle Plugin **8.7.2** and the bundled Gradle
**8.11.1** wrapper — so it needs **JDK 17** and an Android SDK at
`~/Library/Android/sdk`.

> **This machine has no JDK and no Android SDK** (only the macOS `java` stub is
> present), so it cannot build an APK as-is. Install the toolchain first:

```bash
# 1. JDK 17 + Android command-line tools (Homebrew)
brew install --cask temurin@17 android-commandlinetools

# 2. Android SDK at the exact path Capacitor looks for
export ANDROID_HOME="$HOME/Library/Android/sdk"
mkdir -p "$ANDROID_HOME"
/opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager \
  --sdk_root="$ANDROID_HOME" --licenses </dev/null
/opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager \
  --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-35" "build-tools;35.0.0"

# 3. Point the build at that JDK (add to ~/.zshrc to persist)
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

With an SDK at `~/Library/Android/sdk`, `npx cap add android` writes
`local.properties` (`sdk.dir=…`) itself, so Gradle works without any further
configuration. Android Studio (`brew install --cask android-studio`) is an
alternative — it bundles its own JDK and manages the SDK for you.

The first build also downloads Gradle 8.11.1 and the Android Gradle Plugin
from `google()`/`mavenCentral()`, so it needs network access.

```bash
npm run android:init   # creates apps/controller/android if it is missing
npm run android:sync   # builds dist/ and copies it into the platform
npm run android:apk    # android:sync + ./gradlew assembleDebug
```

`android:init` is idempotent: it skips `cap add android` when the platform
already exists, and always re-applies the cleartext manifest flag (see below).
All three are safe to re-run.

The APK lands at:

```text
apps/controller/android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on a plugged-in phone (or copy the file across and sideload it):

```bash
adb devices
adb install -r apps/controller/android/app/build/outputs/apk/debug/app-debug.apk
```

First run on the phone: open **Server settings** → enter the backend as
`http://<lan-ip>:3001` (`npm run lan:ip` shows your LAN address) → enter the
**room code** shown on the laptop → **Enable motion** → **Calibrate** →
**Start driving**. The URL and room code persist in `localStorage` per device —
a packaged app has no Vite dev proxy, so the backend address must be explicit.

Configured in `apps/controller/capacitor.config.ts`:

- `appId`: `dev.tiltx.controller`, `webDir`: `dist`
- `server.androidScheme: 'https'` → origin `https://localhost`, a **secure
  context**, so the WebView exposes `devicemotion` with no Chrome flag needed.
- `android.allowMixedContent: true` → the `https` origin may talk to the
  `http` LAN backend.

**Network security (local development):** targetSdk 35 blocks cleartext HTTP
by default, which would reject both the XHR handshake and the WebSocket to
`http://<lan-ip>:3001` with `ERR_CLEARTEXT_NOT_PERMITTED`. The app manifest
therefore sets `android:usesCleartextTraffic="true"` — only this app, only in
this debug build. `scripts/ensure-android.mjs` re-applies it whenever the
platform is regenerated, and `INTERNET` is the only permission required.

**Sensors:** `@capacitor/motion@7` ships **no native Android or iOS code** — it
registers `Motion` against its web implementation, which is just a wrapper over
the browser `devicemotion` event. On Android the APK therefore reads the real
accelerometer/gyroscope **through the WebView**, and `CapacitorMotionSource`
(`isNativePlatform() === true`) picks it up automatically. No Android runtime
permission is needed for the accelerometer/gyroscope, so nothing is requested
on screen. This is the code path only — verify actual sensor delivery with a
real device before calling the APK tested.

## Security notes

- **Pairing tokens** are HMAC-signed with room + expiry; they are short-lived
  and are **not** long-lived credentials. Set `PAIRING_SECRET` in production.
- Room membership is enforced server-side; a controller cannot inject input for
  a room it does not belong to (`UNAUTHORIZED_ROLE`).
- Input packets are validated and bounded; malformed packets are dropped with a
  rate-limited error response (`MAX_REPORTED_ERRORS_PER_SOCKET`).
- `seq` must strictly increase — stale/replayed packets are dropped.
- Rate limits: join (5/10 s) and input (`MAX_INPUT_RATE`) via token buckets.
- The game runs physics from validated server input only; the client never
  drives the car directly.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| QR won't scan / phone can't open | Check `npm run lan:ip`; if it shows the wrong interface set `LAN_ADDRESS_OVERRIDE` (or `CONTROLLER_BASE_URL`) in `server/.env` and restart — the server replaces an unreachable base automatically |
| "Motion sensors need a secure context" | See [Running the controller](#running-the-controller-web) — flag / HTTPS / APK |
| `controller:join` → `CONTROLLER_TAKEN` | Another phone holds the slot; the UI auto-retries with `replace: true`, or Unpair first |
| `TOKEN_EXPIRED` | Re-scan the QR (tokens last 15 min by default) |
| `Cannot reach the TiltX server` | Backend not running, or wrong `VITE_SERVER_URL`; check `npm run dev` output |
| APK: `ERR_CLEARTEXT_NOT_PERMITTED` | Cleartext flag missing from `AndroidManifest.xml`; re-run `npm run android:init` (`scripts/ensure-android.mjs` re-applies it) |
| APK: no motion data | Phone on the same Wi-Fi? Backend `http://<lan-ip>:3001` set in *Server settings*? Check the controller status line — it reports `unavailable` after 2.5 s if no `devicemotion` event arrives |
| Car feels unresponsive | Recalibrate, raise sensitivity, lower smoothing on the controller |
| Boost never fires | You must shake hard & deliberately: ≥ 14 m/s² for 90 ms, 2 s cooldown |
| Nothing arrives in the game | Controller must be **streaming** (Start driving) and **calibrated** |
| Port already in use | Backend `PORT`, game `PORT` (apps/game), controller `--port` |

## Limitations, roadmap, license

**Known limitations**

- No physics engine: arcade kinematics + track-boundary clamping.
- Single controller, single room focus (the protocol supports many).
- Keyboard fallback is intentionally minimal (dev convenience only).
- APK must be built locally with the Android toolchain.

**Roadmap**

- Persistent leaderboards and ghost cars.
- Multiple simultaneous rooms in the game UI.
- Gamepad-style controller themes (one-handed mode).
- HTTPS-by-default dev setup.

**Contributing** — see [CONTRIBUTING.md](./CONTRIBUTING.md).

**License** — [MIT](./LICENSE).
