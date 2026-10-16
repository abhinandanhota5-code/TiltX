import { useSyncExternalStore } from 'react';
import { ControllerSnapshot, LiveControl } from './lib/session.js';
import { useSession } from './sessionContext.js';
import { StatusView } from './lib/status.js';

export function useSnapshot(): ControllerSnapshot {
  const session = useSession();
  return useSyncExternalStore(session.store.subscribe, session.store.getSnapshot);
}

export function useStatusView(selector: (snapshot: ControllerSnapshot) => StatusView): StatusView {
  return selector(useSnapshot());
}

/**
 * Live control values for animation. Intentionally not React state: widgets
 * poll this inside requestAnimationFrame so 60 Hz sensor data never triggers
 * a re-render storm.
 */
export function useLiveControl(): () => LiveControl {
  const session = useSession();
  return () => session.getLive();
}
