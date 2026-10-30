import { useSyncExternalStore } from 'react';

/** Minimal external store: get / set / subscribe, plus a React hook with a selector. */
export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T extends object>(initial: T, onChange?: (s: T) => void): Store<T> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      onChange?.(state);
      subs.forEach((f) => f());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

export function useStore<T extends object, U>(store: Store<T>, selector: (s: T) => U): U {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
