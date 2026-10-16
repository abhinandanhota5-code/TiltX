import { createContext, useContext, useSyncExternalStore } from 'react';
import { GameSession } from './lib/gameSession.js';
import type { GameSnapshot, CurrentInput } from './lib/types.js';

export const GameContext = createContext<GameSession | null>(null);

export function useGame(): GameSession {
  const session = useContext(GameContext);
  if (!session) throw new Error('GameContext is missing a provider');
  return session;
}

export function useGameSnapshot(): GameSnapshot {
  const session = useGame();
  return useSyncExternalStore(session.store.subscribe, session.store.getSnapshot);
}

/** Mutable live input — read it inside rAF, not during render. */
export function useLiveInput(): CurrentInput {
  return useGame().input;
}
