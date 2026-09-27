import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { SessionSummary } from '../../lib/types';
import { CloseIcon, MenuIcon, OverviewIcon, PlusIcon, SettingsIcon } from '../../components/Icons';
import { IconButton, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import ConfigModal from './ConfigModal';
import { useSaveStates } from '../../lib/config-save-context';
import ChatPage from './ChatPage';
import ActivityPage, { DEFAULT_ACTIVITY_TAB } from './ActivityPage';
import { ChatProvider, useChat } from '../../lib/chat-context';
import { UiProvider, useUi } from '../../lib/ui-context';
import { ProvidersProvider } from '../../lib/use-providers';

/** Shared chrome for the sidebar/drawer nav rows — active state without an `!important`. */
function navItemClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex w-full items-center gap-2.5 rounded-control border border-transparent px-3 py-2.5',
    'text-body transition-colors duration-150 outline-none',
    'focus-visible:ring-2 focus-visible:ring-accent/40',
    isActive
      ? 'border-accent-muted bg-accent-muted text-accent-2'
      : 'text-txt-2 hover:bg-bg-3 hover:text-txt',
  );
}

const NAV_ICON_CLASS = 'h-4 w-4 flex-shrink-0 fill-none stroke-current';

function PrimaryNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Views" className="flex-shrink-0 border-b border-subtle p-2">
      <NavLink to="/admin/activity" onClick={onNavigate} className={navItemClass}>
        <OverviewIcon className={NAV_ICON_CLASS} />
        <span>Activity</span>
      </NavLink>
    </nav>
  );
}

function Drawer({
  open,
  onClose,
  label,
  mobileOnly = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  mobileOnly?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={mobileOnly ? 'md:hidden' : undefined} aria-hidden={!open}>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/60 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-subtle bg-bg-2',
          'shadow-pop transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {children}
      </div>
    </div>
  );
}

const THEME_KEY = 'koris-theme';

function getInitialDark(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) !== 'light';
  } catch {
    return true;
  }
}

/**
 * Mobile top bar. On `md:` and up the sidebar plus each page's own PageShell
 * header carry the navigation, so this bar stays out of the way.
 */
function Header({ onOpenNav }: { onOpenNav: () => void }) {
  return (
    <header className="relative z-20 flex h-14 flex-shrink-0 items-center gap-2 border-b border-subtle bg-bg/80 px-3 backdrop-blur-md md:hidden">
      <IconButton aria-label="Open navigation" onClick={onOpenNav}>
        <MenuIcon className={NAV_ICON_CLASS} />
      </IconButton>
      <span className="font-mono text-caption tracking-wide text-txt-2">koris</span>
    </header>
  );
}

function formatShortDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function ChatItem({ session, live, onNavigate }: { session: SessionSummary; live: boolean; onNavigate?: () => void }) {
  const { activeSessionId } = useChat();
  const navigate = useNavigate();
  const isActive = session.id === activeSessionId;
  const title = session.preview?.trim() || `Chat ${session.id.slice(0, 8)}`;

  function handleClick() {
    onNavigate?.();
    navigate(`/admin/chat/${session.id}`);
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full rounded-control border px-3 py-2 text-left transition-colors duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent/40',
        isActive ? 'border-accent-muted bg-accent-muted' : 'border-transparent hover:bg-bg-3',
      )}
    >
      <div className={cn('truncate text-body', isActive ? 'text-accent-2' : 'text-txt')}>{title}</div>
      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-micro text-txt-3">
        <span>{formatShortDate(session.startedAt)}</span>
        <span aria-hidden="true">·</span>
        {live ? <span className="text-success">live</span> : <span>{session.channel}</span>}
      </div>
    </button>
  );
}

function ChatsPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { sessions, newChat } = useChat();
  const navigate = useNavigate();
  const liveWebId = sessions.find((s) => s.channel === 'web' && !s.endedAt)?.id;
  const [query, setQuery] = useState('');

  async function handleNewChat() {
    await newChat();
    onNavigate?.();
    navigate('/admin/chat');
  }

  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed
    ? sessions.filter((s) => (s.preview?.trim() || `Chat ${s.id.slice(0, 8)}`).toLowerCase().includes(trimmed))
    : sessions;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="font-mono text-micro uppercase text-txt-3">Chats</div>
        <IconButton aria-label="New chat" title="New chat" variant="secondary" size="sm" onClick={handleNewChat}>
          <PlusIcon className="h-3.5 w-3.5 fill-none stroke-current" />
        </IconButton>
      </div>
      <div className="px-3 pb-2">
        <Input
          type="search"
          aria-label="Search chats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats"
          className="h-8 text-caption"
        />
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 && (
          <div className="px-3 py-8 text-center font-mono text-mini text-txt-3">
            {trimmed ? 'No matching chats.' : 'No chats yet.'}
          </div>
        )}
        {filtered.map((session) => (
          <ChatItem key={session.id} session={session} live={session.id === liveWebId} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

function ConfigButton({ onOpen }: { onOpen: () => void }) {
  const hasError = useSaveStates().some((state) => state.state === 'error' || state.state === 'invalid');
  return (
    <button
      onClick={onOpen}
      aria-label="Configuration"
      title={hasError ? 'Configuration · changes need attention' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-control border border-transparent px-3 py-2.5',
        'text-body text-txt-2 transition-colors duration-150 outline-none',
        'hover:bg-bg-3 hover:text-txt focus-visible:ring-2 focus-visible:ring-accent/40',
      )}
    >
      <SettingsIcon className={NAV_ICON_CLASS} />
      <span>Configuration</span>
      {hasError && <span aria-label="Changes need attention" className="h-1.5 w-1.5 rounded-full bg-danger" />}
    </button>
  );
}

/** Body shared by the desktop sidebar and the mobile drawer. */
function SidebarContent({ onNavigate, onOpenConfig }: { onNavigate?: () => void; onOpenConfig: () => void }) {
  return (
    <>
      <PrimaryNav onNavigate={onNavigate} />
      <div className="min-h-0 flex-1">
        <ChatsPanel onNavigate={onNavigate} />
      </div>
      <div className="flex-shrink-0 border-t border-subtle p-2">
        <ConfigButton onOpen={onOpenConfig} />
      </div>
    </>
  );
}

function Sidebar() {
  const { openConfig } = useUi();
  return (
    <aside className="relative hidden w-60 flex-shrink-0 flex-col border-r border-subtle bg-bg-2 md:flex">
      <SidebarContent onOpenConfig={() => openConfig()} />
    </aside>
  );
}

/** Keeps old page URLs working for views that now live in the Configuration modal. */
function ConfigSectionRedirect({ sectionId }: { sectionId: string }) {
  const { openConfig } = useUi();
  useEffect(() => {
    openConfig(sectionId);
  }, [openConfig, sectionId]);
  return <Navigate to="/admin/chat" replace />;
}

function DrawerHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex h-14 flex-shrink-0 items-center gap-2.5 border-b border-subtle px-3">
      <span className="text-body font-medium text-txt">{title}</span>
      <IconButton aria-label={`Close ${title}`} size="sm" onClick={onClose} className="ml-auto">
        <CloseIcon className={NAV_ICON_CLASS} />
      </IconButton>
    </div>
  );
}

export default function AdminLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [configSection, setConfigSection] = useState<string | undefined>('general');
  const [isDark, setIsDark] = useState(getInitialDark);

  function handleOpenConfig(sectionId?: string) {
    setConfigSection(sectionId || 'general');
    setConfigOpen(true);
  }

  useEffect(() => {
    document.documentElement.classList.toggle('light', !isDark);
    try {
      localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    } catch {
      // storage unavailable — theme still applies for this session
    }
  }, [isDark]);

  return (
    <ProvidersProvider>
      <ChatProvider>
        <UiProvider value={{ openConfig: handleOpenConfig, isDark, toggleTheme: () => setIsDark((d) => !d) }}>
          <div className="relative z-10 flex h-screen w-full flex-col supports-[height:100dvh]:h-dvh">
            <div className="flex min-h-0 min-w-0 flex-1">
              <Sidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <Header onOpenNav={() => setNavOpen(true)} />
                <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  <Routes>
                    <Route index element={<Navigate to="/admin/chat" replace />} />
                    <Route path="chat" element={<ChatPage />} />
                    <Route path="chat/:sessionId" element={<ChatPage />} />
                    <Route
                      path="activity"
                      element={<Navigate to={`/admin/activity/${DEFAULT_ACTIVITY_TAB}`} replace />}
                    />
                    <Route path="activity/:tab" element={<ActivityPage />} />
                    {/* Legacy single-view routes now resolve to their Activity tab. */}
                    <Route path="overview" element={<Navigate to="/admin/activity/overview" replace />} />
                    <Route path="queue" element={<Navigate to="/admin/activity/queue" replace />} />
                    <Route path="audit" element={<Navigate to="/admin/activity/audit" replace />} />
                    <Route path="memories" element={<ConfigSectionRedirect sectionId="memories" />} />
                    <Route path="heartbeats" element={<ConfigSectionRedirect sectionId="beats" />} />
                    <Route path="*" element={<Navigate to="/admin/chat" replace />} />
                  </Routes>
                </main>
              </div>
            </div>

            <Drawer open={navOpen} onClose={() => setNavOpen(false)} label="Menu">
              <DrawerHeader title="Menu" onClose={() => setNavOpen(false)} />
              <div className="flex min-h-0 flex-1 flex-col">
                <SidebarContent
                  onNavigate={() => setNavOpen(false)}
                  onOpenConfig={() => {
                    setNavOpen(false);
                    handleOpenConfig();
                  }}
                />
              </div>
            </Drawer>

            <ConfigModal open={configOpen} initialSectionId={configSection} onClose={() => setConfigOpen(false)} />
          </div>
        </UiProvider>
      </ChatProvider>
    </ProvidersProvider>
  );
}
