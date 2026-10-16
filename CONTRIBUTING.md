# Contributing to TiltX

Thanks for helping improve TiltX.

## Development setup

```bash
npm install        # also builds @tiltx/shared (postinstall)
npm run dev        # server + game + controller
```

## Before you open a PR

```bash
npm run typecheck
npm test
npm run build
```

All three must pass. CI runs exactly these.

## Conventions

- **TypeScript strict everywhere** (`tsconfig.base.json`). No `any` at the
  boundary — narrow unknown input at the edge.
- **Shared + server** use `moduleResolution: NodeNext` ⇒ **explicit `.js`
  extensions** in relative imports (`./foo.js`). The two Vite apps use
  `bundler` resolution but we still write `.js` for consistency.
- **Never add fake/mock sensor data.** Neutral output before calibration is a
  feature, not a bug.
- Protocol changes go in `packages/shared/src/protocol.ts` **first**, then
  server, then clients, then tests. Bump `PROTOCOL_VERSION` for breaking
  changes.
- Game logic (`apps/game/src/sim/*`) must stay pure: no Three.js, no DOM, no
  sockets — it is unit-tested directly.
- Comments explain *why*, not *what*.

## Tests

- `packages/shared` — sensor maths, validation.
- `server/tests/unit` — pairing, rate limits, rooms, config.
- `server/tests/integration` — real Socket.IO round-trips.
- `apps/game/src/sim` — physics, track, lap timing.

Put tests next to the code (`foo.test.ts`).

## Commit style

Short, imperative summaries:

```
fix(server): handle controller takeover on reconnect
feat(game): add chase camera lag
docs: clarify insecure-origin flag
```

## Reporting issues

Include: Node version, OS, how you paired (QR/APK/web), console output from
all three processes, and whether the phone was on the same Wi-Fi.
