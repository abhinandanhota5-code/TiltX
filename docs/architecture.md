# TiltX architecture

## The problem

A phone has the sensors (accelerometer, gyroscope, rotation) but no screen big
enough to race on. A laptop has the screen and GPU but no good tilt input. TiltX
bridges the two over the local network.

## Components

```
                    packages/shared (pure TS, no runtime deps)
                    ┌─────────────────────────────────────┐
                    │ protocol.ts  validation.ts          │
                    │ sensor/ calibration filters mapping │
                    │        pipeline shake               │
                    └────────────┬────────────────────────┘
                                 │ imported by all three
        ┌────────────────────────┼──────────────────────────┐
        ▼                        ▼                          ▼
 apps/controller            server (Node)              apps/game
 phone: sensors →           rooms · roles              Three.js scene
 packet → Socket.IO         HMAC tokens                physics ← game:input
                            rate limits                HUD · QR overlay
                            latency probes
```

### `packages/shared`

- **Protocol** (`protocol.ts`) — the only place event names and message shapes
  are defined. Bump `PROTOCOL_VERSION` when breaking the wire.
- **Validation** (`validation.ts`) — bounds every numeric field; returns a
  discriminated result instead of throwing.
- **Sensor maths** (`sensor/`) — orientation-aware axis mapping, complementary
  filtering, dead zone, EMA smoothing, robust calibration (median + MAD) and a
  threshold/cooldown shake detector. Everything is unit-testable and has no
  platform assumptions.

### `server`

Single process, in-memory rooms.

- Role slots: exactly one `game` and one `controller` per room. Clients cannot
  claim roles — they arrive, the server validates, and assigns.
- Pairing: `createPairingToken(secret, room, ttl)` produces an HMAC over
  `room.expiry`. A valid token authorises taking over the controller slot; an
  absent token requires the caller to be first, or to pass `replace: true`.
- Rate limiting: token buckets for join attempts and for input packets.
- Grace: when the game disconnects, the room survives `GAME_GRACE_MS` so the
  laptop can reconnect to the *same* room and QR code.
- Latency: echoes `t0` back untouched so both clients measure honest RTT.

### `apps/controller`

Non-React core (`lib/session.ts`) owns the sensor stream, calibration window,
send loop and socket. React only reads snapshots (`useSyncExternalStore`) and
calls commands. Continuous values are published to React at ≤ ~12 Hz to avoid
render storms; high-rate widgets (steering needle, pedals) poll a mutable
object inside `requestAnimationFrame`.

Sensors come from one of two sources behind a `MotionSource` interface:

- `DeviceMotionSource` — browser `devicemotion` (needs a secure context).
- `CapacitorMotionSource` — `@capacitor/motion`, used automatically inside the
  APK.

### `apps/game`

- `sim/` is deliberately **pure** (no Three.js, no DOM, no sockets) so it is
  unit-tested directly: track geometry → car physics → lap timing.
- The React Three Fiber loop calls `stepRace()` each frame with the latest
  socket input. Every controller value is clamped again — the client is never
  trusted.
- The QR overlay renders `pairing.url` as a QR code and warns when that URL
  points at `localhost` (unreachable from a phone).

## Why a game-side simulation loop?

Input arrives at 20–60 Hz over a jittery network; rendering runs at 60 Hz.
Simulating at the frame rate with the *latest* packet (and neutral input when
packets stop) gives smooth motion and an automatic safe state on loss.
