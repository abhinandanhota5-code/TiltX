import { createContext, useContext } from 'react';
import { ControllerSession } from './lib/session.js';

export const SessionContext = createContext<ControllerSession | null>(null);

export function useSession(): ControllerSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionContext is missing a provider');
  return session;
}
