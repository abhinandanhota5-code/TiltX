/** Minimal observable store for React's useSyncExternalStore. */
export interface Store<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  update(updater: (previous: T) => T): void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (updater) => {
      const next = updater(state);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}
