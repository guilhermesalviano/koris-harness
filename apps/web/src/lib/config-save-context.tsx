import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SaveCoordinator, type SaveDraft } from './save-coordinator';
import { apiRequest, ApiRequestError } from './api';
import type { RuntimeSettings } from './use-settings-form';

const SaveContext = createContext<SaveCoordinator | null>(null);

export function ConfigSaveProvider({ children }: { children: ReactNode }) {
  const [coordinator] = useState(() => new SaveCoordinator());
  return <SaveContext.Provider value={coordinator}>{children}</SaveContext.Provider>;
}

export function useSaveCoordinator() {
  const shared = useContext(SaveContext);
  if (!shared) throw new Error('Configuration saves require ConfigSaveProvider.');
  return shared;
}

export function useSaveStates() {
  const coordinator = useSaveCoordinator();
  useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  return coordinator.states();
}

export function useAutoSave<T>(key: string, initial: T, write: (value: T, baseline: T | undefined) => Promise<void>, validate?: (value: T) => string | null) {
  const coordinator = useSaveCoordinator();
  useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const fingerprint = JSON.stringify(initial);
  useEffect(() => { coordinator.hydrate(key, initialRef.current); }, [coordinator, key, fingerprint]);
  const draft: SaveDraft<T> = coordinator.get<T>(key) ?? { value: initial, state: 'idle', error: null, version: 0 };

  function update(value: T | ((previous: T) => T), immediate = false) {
    const previous = coordinator.get<T>(key)?.value ?? initial;
    const next = typeof value === 'function' ? (value as (previous: T) => T)(previous) : value;
    coordinator.schedule(key, next, write, { immediate, error: validate?.(next) });
  }

  return { ...draft, update, retry: () => coordinator.retry(key) };
}

export async function postSettings(patch: Record<string, unknown>) {
  try {
    await apiRequest('/settings', { method: 'POST', body: JSON.stringify(patch) });
  } catch (error) {
    if (error instanceof ApiRequestError && error.details?.length) throw new Error(error.details.join(' '));
    throw error;
  }
}

export function useConfigSnapshot() {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    apiRequest<RuntimeSettings>('/settings').then((value) => {
      if (active) setSettings(value);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load settings.');
    });
    return () => { active = false; };
  }, []);
  return { settings, error };
}
