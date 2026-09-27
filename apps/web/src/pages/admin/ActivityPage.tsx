import { useCallback, useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '../../components/AdminUI';
import { Segmented, type SegmentedOption } from '../../components/ui';
import { AuditIcon, OverviewIcon, QueueIcon } from '../../components/Icons';
import OverviewPanel from './OverviewPage';
import QueuePanel from './QueuePage';
import AuditPanel from './AuditPage';

export const ACTIVITY_TABS = ['overview', 'queue', 'audit'] as const;
export type ActivityTab = (typeof ACTIVITY_TABS)[number];

export const DEFAULT_ACTIVITY_TAB: ActivityTab = 'overview';

function isActivityTab(value: string | undefined): value is ActivityTab {
  return ACTIVITY_TABS.includes(value as ActivityTab);
}

const ICON_CLASS = 'h-3.5 w-3.5 flex-shrink-0 fill-none stroke-current';

const TAB_OPTIONS: readonly SegmentedOption<ActivityTab>[] = [
  { value: 'overview', label: 'Overview', icon: <OverviewIcon className={ICON_CLASS} /> },
  { value: 'queue', label: 'Queue', icon: <QueueIcon className={ICON_CLASS} /> },
  { value: 'audit', label: 'Audit', icon: <AuditIcon className={ICON_CLASS} /> },
];

const TAB_DESCRIPTIONS: Record<ActivityTab, string> = {
  overview: 'System status, usage and live activity',
  queue: 'LLM call queue — what is running and what is waiting',
  audit: 'LLM & tool-call audit trail, with embedding/RAG context',
};

function panelId(tab: ActivityTab): string {
  return `activity-panel-${tab}`;
}

/**
 * One route for the three time-scales of "what is my agent doing": Overview
 * (now-ish), Queue (this second) and Audit (history).
 *
 * The active tab lives in the URL (`/admin/activity/:tab`) so it is linkable
 * and survives a reload, and only the active panel is mounted — each panel owns
 * its own polling, so a hidden tab can never keep hitting the API.
 */
export default function ActivityPage() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab: string }>();

  // The active panel registers its reload function here so the shared header
  // Refresh button drives whichever tab is on screen.
  const refreshRef = useRef<(() => void) | null>(null);
  const registerRefresh = useCallback((refresh: () => void) => {
    refreshRef.current = refresh;
  }, []);

  const handleChange = useCallback(
    (next: ActivityTab) => {
      navigate(`/admin/activity/${next}`);
    },
    [navigate],
  );

  if (!isActivityTab(tab)) {
    return <Navigate to={`/admin/activity/${DEFAULT_ACTIVITY_TAB}`} replace />;
  }

  const id = panelId(tab);
  const label = TAB_OPTIONS.find((option) => option.value === tab)?.label ?? 'Activity';

  return (
    <PageShell title="Activity" description={TAB_DESCRIPTIONS[tab]} onRefresh={() => refreshRef.current?.()}>
      <div className="-mx-1 mb-5 overflow-x-auto px-1 pb-1">
        <Segmented
          options={TAB_OPTIONS}
          value={tab}
          onChange={handleChange}
          label="Activity views"
          panelId={panelId}
        />
      </div>

      <div id={id} role="tabpanel" aria-label={label} tabIndex={0} className="outline-none">
        {tab === 'overview' && <OverviewPanel onRegisterRefresh={registerRefresh} />}
        {tab === 'queue' && <QueuePanel onRegisterRefresh={registerRefresh} />}
        {tab === 'audit' && <AuditPanel onRegisterRefresh={registerRefresh} />}
      </div>
    </PageShell>
  );
}
