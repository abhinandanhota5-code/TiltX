import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { GameSnapshot } from '../lib/types.js';
import { RaceState } from '../sim/race.js';

interface ToastProps {
  race: RaceState;
  snapshot: GameSnapshot;
}

export function Toast({ race, snapshot }: ToastProps): ReactElement {
  const [message, setMessage] = useState<string | null>(null);
  const timeout = useRef<number | null>(null);
  const prevLap = useRef<number | null>(null);

  useEffect(() => {
    if (race.lapJustCompleted !== null && race.laps !== prevLap.current) {
      prevLap.current = race.laps;
      setMessage(`Lap ${race.laps} — ${Math.round(race.lapJustCompleted)} ms`);
      if (timeout.current !== null) window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => setMessage(null), 2000);
    }
  }, [race.lapJustCompleted, race.laps]);

  useEffect(() => {
    if (snapshot.controllerReason && !snapshot.controllerConnected) {
      setMessage(snapshot.controllerReason);
      if (timeout.current !== null) window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => setMessage(null), 1500);
    }
  }, [snapshot.controllerConnected, snapshot.controllerReason]);

  return <div className="toast" aria-live="polite">{message ?? ''}</div>;
}
