export interface Store<T extends Record<string, any>> {
  getState: () => T;
  setState: (partial: Partial<T>) => void;
  subscribe: (listener: () => void) => () => void;
}

export const createStore = <T extends Record<string, any>>(
  initialState: T
): Store<T> => {
  let state = initialState;
  const listeners = new Set<() => void>();

  const getState = () => state;

  const setState = (partial: Partial<T>) => {
    // Only notify subscribers if at least one value actually changed (by reference).
    // This prevents cascading re-renders when setState is called with identical data.
    let hasChanged = false;
    for (const key of Object.keys(partial) as (keyof T)[]) {
      if (!Object.is(state[key], partial[key])) {
        hasChanged = true;
        break;
      }
    }
    if (!hasChanged) return;

    state = { ...state, ...(partial as T) };
    for (const listener of listeners) {
      listener();
    }
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { getState, setState, subscribe };
};
