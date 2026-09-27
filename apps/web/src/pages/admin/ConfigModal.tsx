import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Modal from '../../components/Modal';
import { cn } from '../../lib/cn';
import { Button, IconButton } from '../../components/ui';
import { ChannelsIcon, CloseIcon, HeartbeatsIcon, MemoriesIcon, PluginsIcon, ProvidersIcon, SessionsIcon, SettingsIcon, SkillsIcon } from '../../components/Icons';
import { useSaveCoordinator, useSaveStates } from '../../lib/config-save-context';
import SessionsPage from './SessionsPage';
import ChannelsPage from './ChannelsPage';
import ProvidersPage from './ProvidersPage';
import PluginsPage from './PluginsPage';
import GeneralPage from './GeneralPage';
import SkillsSettingsPage from './SkillsSettingsPage';
import MemoriesPage from './MemoriesPage';
import HeartbeatsPage from './HeartbeatsPage';

export interface Section {
  id: string;
  label: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
  Component: ComponentType;
}

export const SECTIONS: Section[] = [
  { id: 'general', label: 'General', description: 'Personal context & access', Icon: SettingsIcon, Component: GeneralPage },
  { id: 'sessions', label: 'Sessions', description: 'Conversation history', Icon: SessionsIcon, Component: SessionsPage },
  { id: 'plugins', label: 'Plugins', description: 'Extensions & marketplace', Icon: PluginsIcon, Component: PluginsPage },
  { id: 'providers', label: 'Providers', description: 'Models & intelligence', Icon: ProvidersIcon, Component: ProvidersPage },
  { id: 'channels', label: 'Channels', description: 'Messaging & connections', Icon: ChannelsIcon, Component: ChannelsPage },
  { id: 'skills', label: 'Skills', description: 'Knowledge & instructions', Icon: SkillsIcon, Component: SkillsSettingsPage },
  { id: 'memories', label: 'Memories', description: 'Long-term memory', Icon: MemoriesIcon, Component: MemoriesPage },
  { id: 'beats', label: 'Beats', description: 'Scheduled agents & reminders', Icon: HeartbeatsIcon, Component: HeartbeatsPage },
];

export default function ConfigModal({
  open,
  onClose,
  initialSectionId = 'general',
}: {
  open: boolean;
  onClose: () => void;
  initialSectionId?: string;
}) {
  const [sectionId, setSectionId] = useState(initialSectionId);
  const [showContentOnMobile, setShowContentOnMobile] = useState(false);
  const tabListRef = useRef<HTMLDivElement>(null);
  const saves = useSaveCoordinator();
  const states = useSaveStates();
  const errors = states.filter((state) => state.state === 'error' || state.state === 'invalid');
  const saving = states.some((state) => state.state === 'pending' || state.state === 'saving');
  const saved = states.some((state) => state.state === 'saved');
  const status = errors.length
    ? `${errors.length} ${errors.length === 1 ? 'change needs' : 'changes need'} attention`
    : saving
      ? 'Saving changes…'
      : saved
        ? 'All changes saved'
        : 'Changes save automatically';

  useEffect(() => {
    if (open) {
      const target = initialSectionId && SECTIONS.some((s) => s.id === initialSectionId)
        ? initialSectionId
        : 'general';
      setSectionId(target);
    }
  }, [open, initialSectionId]);

  useEffect(() => {
    if (!open) {
      void saves.flush();
      setShowContentOnMobile(false);
    }
  }, [open, saves]);

  const active = SECTIONS.find((section) => section.id === sectionId) ?? SECTIONS[0];
  const ActivePage = active.Component;

  function selectSection(id: string) {
    void saves.flush();
    setSectionId(id);
    setShowContentOnMobile(true);
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const currentIndex = SECTIONS.findIndex((s) => s.id === sectionId);
    let nextIndex = -1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      nextIndex = (currentIndex + 1) % SECTIONS.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      nextIndex = (currentIndex - 1 + SECTIONS.length) % SECTIONS.length;
    } else if (event.key === 'Home') {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      nextIndex = SECTIONS.length - 1;
    }
    if (nextIndex >= 0) {
      const nextSection = SECTIONS[nextIndex];
      selectSection(nextSection.id);
      const nextButton = tabListRef.current?.querySelector<HTMLButtonElement>(`#tab-${nextSection.id}`);
      nextButton?.focus();
    }
  }

  function close() {
    void saves.flush();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Configuration"
      description="Your assistant, set up your way."
      maxWidthClassName="max-w-5xl"
      bodyClassName="p-0 flex flex-col configuration"
      fullHeightOnMobile
      customHeader={
        <header className="flex h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-subtle bg-bg-2 px-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-control bg-accent-muted text-accent">
              <SettingsIcon className="h-[18px] w-[18px] fill-none stroke-current" />
            </div>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="text-title font-semibold text-txt">Configuration</span>
              <span className="hidden text-caption text-txt-3 sm:inline" aria-hidden="true">/</span>
              <span className="hidden truncate text-caption font-medium text-txt-2 sm:inline">{active.label}</span>
            </div>
          </div>
          <IconButton
            variant="secondary"
            size="sm"
            onClick={close}
            aria-label="Close dialog"
            title="Close (Esc)"
            className="h-8 w-8 border-subtle hover:border-accent-muted hover:text-accent-2"
          >
            <CloseIcon className="h-4 w-4 fill-none stroke-current" />
          </IconButton>
        </header>
      }
      footer={
        <footer className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-subtle bg-bg-2 px-5 py-3 sm:px-6">
          <div
            aria-live="polite"
            className={cn('flex items-center gap-2 text-caption', errors.length ? 'text-danger-2' : 'text-txt-2')}
          >
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                errors.length ? 'bg-danger' : saving ? 'animate-pulse bg-accent' : 'bg-success',
              )}
            />
            {status}
          </div>
          {errors.length ? (
            <Button variant="ghost" size="sm" onClick={() => selectSection(errors[0].key.split('.')[0])} className="text-accent-2">
              Review
            </Button>
          ) : (
            <span className="hidden text-mini text-txt-3 sm:block">Esc to close</span>
          )}
        </footer>
      }
    >
      <div className="flex min-h-0 flex-1 sm:h-[min(72dvh,720px)] sm:flex-auto">
        <nav
          ref={tabListRef}
          role="tablist"
          aria-orientation="vertical"
          aria-label="Configuration sections"
          onKeyDown={handleTabKeyDown}
          className={cn(
            'w-full flex-shrink-0 overflow-y-auto bg-bg-3/30 p-3 sm:block sm:w-64 sm:border-r sm:border-subtle',
            showContentOnMobile ? 'hidden' : 'block',
          )}
        >
          <div className="px-3 pb-3 pt-2 text-micro font-semibold uppercase text-txt-3">
            Workspace settings
          </div>
          <div className="flex flex-col gap-1">
            {SECTIONS.map(({ id, label, description, Icon }) => {
              const hasError = errors.some((error) => error.key.startsWith(`${id}.`));
              const isSelected = id === sectionId;
              return (
                <button
                  key={id}
                  id={`tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-controls={`panel-${id}`}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => selectSection(id)}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-panel border px-3 py-2.5 text-left transition-colors',
                    'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    isSelected
                      ? 'border-accent-muted bg-accent-muted text-accent-2'
                      : 'border-transparent text-txt-2 hover:bg-bg-3 hover:text-txt',
                  )}
                >
                  <Icon className="h-[18px] w-[18px] flex-shrink-0 fill-none stroke-current" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold">{label}</span>
                    <span className={cn('mt-0.5 block text-mini', isSelected ? 'text-accent-2/80' : 'text-txt-3')}>
                      {description}
                    </span>
                  </span>
                  {hasError && (
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-danger" aria-label="Unsaved changes" />
                  )}
                  <span aria-hidden="true" className="text-lead text-txt-3 sm:hidden">
                    ›
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
        <section
          id={`panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${active.id}`}
          className={cn('min-w-0 flex-1 flex-col overflow-hidden bg-bg/25', showContentOnMobile ? 'flex' : 'hidden sm:flex')}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void saves.flush();
              setShowContentOnMobile(false);
            }}
            iconLeft={<span aria-hidden="true">‹</span>}
            className="h-auto flex-shrink-0 justify-start rounded-none border-0 border-b border-subtle px-5 py-3 text-caption sm:hidden"
          >
            All settings
          </Button>
          <ActivePage />
        </section>
      </div>
    </Modal>
  );
}
