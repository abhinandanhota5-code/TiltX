import { useEffect, useRef } from 'react';
import type { LiveControl } from '../lib/session.js';

type RafCallback = (live: LiveControl, elapsedMs: number) => void;

/** Runs a callback on every animation frame with the latest live control data. */
export function useRafLoop(read: () => LiveControl, callback: RafCallback): void {
  const readRef = useRef(read);
  const callbackRef = useRef(callback);
  readRef.current = read;
  callbackRef.current = callback;

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const step = (time: number): void => {
      const elapsed = time - previous;
      previous = time;
      callbackRef.current(readRef.current(), elapsed);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);
}
