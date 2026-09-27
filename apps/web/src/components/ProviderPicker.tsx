import { useEffect, useRef, useState } from 'react';
import { useProviders } from '../lib/use-providers';
import { useUi } from '../lib/ui-context';
import { useToast, Toast } from './AdminUI';
import { ChevronDownIcon, SettingsIcon } from './Icons';
import type { ProviderCatalogEntry } from '../lib/types';

const DEFAULT_PROVIDERS = ['ollama'];

export default function ProviderPicker() {
  const api = useProviders();
  const { openConfig } = useUi();
  const [toastMsg, showToast, isError] = useToast();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const active = api.active.manager;
  const activeEntry = api.catalog.find((e) => e.name === active.provider);
  const connected = !!active.provider && (active.hasToken || (activeEntry ? !activeEntry.isOpenAICompatible : false));
  const visible = api.catalog.filter((e) => DEFAULT_PROVIDERS.includes(e.name) || e.configured);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleConfig() {
    setOpen(false);
    openConfig('providers');
  }

  function modelFor(entry: ProviderCatalogEntry, isCurrent: boolean): string {
    if (isCurrent) return active.model;
    return entry.model || entry.recommendedModel || '';
  }

  async function switchTo(entry: ProviderCatalogEntry) {
    const isCurrent = entry.name === active.provider;
    setSwitching(entry.name);
    try {
      const res = await api.activate('manager', {
        provider: entry.name,
        model: modelFor(entry, isCurrent),
        apiToken: '',
        baseUrl: isCurrent ? active.baseUrl : entry.storedBaseUrl ?? '',
      });
      if (res.ok) {
        showToast(`Switched to ${entry.label}`);
        setOpen(false);
      } else {
        showToast(res.errors?.[0] ?? `Could not switch to ${entry.label}`, true);
      }
    } finally {
      setSwitching(null);
    }
  }

  const label = api.error
    ? 'unavailable'
    : active.provider
      ? `${active.provider}${active.model ? ` · ${active.model}` : ''}`
      : api.loading
        ? 'loading…'
        : 'no provider';

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => (api.error ? handleConfig() : setOpen((v) => !v))}
        title="AI provider for this chat"
        className="flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-strong bg-bg-3 px-2 py-1 text-txt-2 transition-colors duration-150 hover:border-accent hover:text-txt"
      >
        <span
          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
            api.error ? 'bg-red-500' : connected ? 'bg-green-500' : 'bg-amber-500'
          }`}
        />
        <span className="truncate">{label}</span>
        {!api.error && <ChevronDownIcon className="h-3 w-3 flex-shrink-0 fill-none stroke-current" />}
      </button>

      {open && !api.error && (
        <div className="absolute bottom-full left-0 z-50 mb-2 max-h-[60vh] w-[17rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-card border border-strong bg-bg-2 py-1 shadow-2xl">
          {visible.map((entry) => {
            const isCurrent = entry.name === active.provider;
            const isNative = !entry.isOpenAICompatible;
            // A provider is switchable straight from the picker when it's native,
            // already active, or has saved config in koris.json (ai.providers[]).
            const ready = isNative || isCurrent || entry.configured;
            const model = modelFor(entry, isCurrent);
            return (
              <div
                key={entry.name}
                className={`flex items-center gap-2 px-3 py-2 ${ready ? 'cursor-pointer hover:bg-bg-3' : ''}`}
                onClick={ready && !switching ? () => switchTo(entry) : undefined}
              >
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${isCurrent ? 'bg-accent' : 'bg-txt-3'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-txt">{entry.label}</span>
                  {model && <span className="block truncate font-mono text-[10px] text-txt-3">{model}</span>}
                </span>
                {switching === entry.name ? (
                  <span className="flex-shrink-0 font-mono text-[10px] text-txt-3">…</span>
                ) : ready ? (
                  isCurrent && (
                    <span className="flex-shrink-0 rounded bg-accent-muted px-1.5 py-0.5 font-mono text-[10px] text-accent-2">
                      active
                    </span>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleConfig();
                    }}
                    className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-strong bg-bg-3 px-1.5 py-1 font-mono text-[10px] text-txt-2 hover:border-accent hover:text-accent-2"
                  >
                    <SettingsIcon className="h-3 w-3 fill-none stroke-current" />
                    Set up
                  </button>
                )}
              </div>
            );
          })}
          <div className="my-1 border-t border-subtle" />
          <button
            type="button"
            onClick={handleConfig}
            className="block w-full px-3 py-2 text-left text-[13px] text-txt-2 hover:bg-bg-3 hover:text-txt"
          >
            Configure providers…
          </button>
        </div>
      )}

      <Toast message={toastMsg} isError={isError} />
    </div>
  );
}
