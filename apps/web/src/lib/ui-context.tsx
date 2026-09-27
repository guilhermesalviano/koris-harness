import { createContext, useContext, type ReactNode } from 'react';

interface UiContextValue {
  openConfig: (sectionId?: string) => void;
  isDark: boolean;
  toggleTheme: () => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ value, children }: { value: UiContextValue; children: ReactNode }) {
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext);
  if (!ctx) {
    throw new Error('useUi must be used within a UiProvider');
  }
  return ctx;
}
