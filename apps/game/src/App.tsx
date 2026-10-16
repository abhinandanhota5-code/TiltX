import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Scene } from './three/Scene.js';
import { Hud } from './ui/Hud.js';
import { PairingOverlay } from './ui/PairingOverlay.js';
import { Toast } from './ui/Toast.js';
import { createDefaultTrack } from './sim/track.js';
import { createRace, RaceState, stepRace } from './sim/race.js';
import { useGame, useGameSnapshot } from './gameContext.js';

const track = createDefaultTrack();
/** How often the HUD re-renders while the car is moving. */
const HUD_PUBLISH_MS = 100;

export function App(): ReactElement {
  const session = useGame();
  const snapshot = useGameSnapshot();

  const raceRef = useRef<RaceState>(createRace(track));
  const [race, setRace] = useState<RaceState>(() => raceRef.current);
  const lastLapsRef = useRef(0);
  const lastPublishRef = useRef(0);

  const getVehicle = useCallback((): RaceState['vehicle'] => raceRef.current.vehicle, []);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();

    const step = (now: number): void => {
      const dtMs = Math.min(50, now - previous);
      previous = now;

      const current = raceRef.current;
      const input = session.input;
      const next = stepRace(track, current, {
        steering: input.steering,
        throttle: input.throttle,
        brake: input.brake,
        boostRequest: session.consumeBoostRequest(),
        dtMs,
      });
      raceRef.current = next;

      // Publish immediately on a lap event so the toast never misses it;
      // otherwise throttle to keep React renders off the render loop.
      const lapEvent = next.laps !== lastLapsRef.current;
      if (lapEvent || now - lastPublishRef.current >= HUD_PUBLISH_MS) {
        lastPublishRef.current = now;
        lastLapsRef.current = next.laps;
        setRace(next);
      }

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [session]);

  const endSession = (): void => {
    session.endSession();
    raceRef.current = createRace(track);
    lastLapsRef.current = 0;
    setRace(raceRef.current);
  };

  return (
    <div className="app">
      <div className="canvas">
        <Scene track={track} getVehicle={getVehicle} />
      </div>
      <Hud race={race} snapshot={snapshot} />
      <Toast race={race} snapshot={snapshot} />
      <PairingOverlay snapshot={snapshot} onEndSession={endSession} />
    </div>
  );
}
