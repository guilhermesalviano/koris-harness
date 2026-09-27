import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkHealth, streamChat, cancelChat, apiRequest } from './api';
import { clearResponseAlert, triggerResponseDone } from './response-alert';
import { createHistoryPoller, mapMessages, nextId, timeStr, type ChatMessage, type HistoryMessage } from './chat-history';
import type { ActiveRun, ActiveRunsResponse, AllowedDomainsResponse, GateBlock, GateBlocksResponse, ImageAttachment, SessionDetailResponse, SessionsResponse, SessionSummary } from './types';

export type { ChatMessage } from './chat-history';

interface ChatHistoryResponse {
  sessionId: string | null;
  messages: HistoryMessage[];
}

interface ChatContextValue {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  attachments: ImageAttachment[];
  setAttachments: Dispatch<SetStateAction<ImageAttachment[]>>;
  streaming: boolean;
  currentQuestion: string | null;
  backgroundRun: ActiveRun | null;
  serverHealthy: boolean;
  historyLoaded: boolean;
  toast: string | null;
  setToast: (msg: string | null) => void;
  submit: (overrideText?: string) => Promise<void>;
  resendLast: () => Promise<void>;
  cancel: () => void;
  fillPrompt: (text: string) => void;
  activeSessionId: string | null;
  sessions: SessionSummary[];
  openSession: (id: string | null) => void;
  newChat: () => Promise<void>;
  gateBlocks: GateBlock[];
  allowDomain: (domain: string) => Promise<void>;
  dismissGateBlock: (domain: string) => void;
  /** Server-reported reply mode for the active conversation (set via `/mode`). */
  responseMode: 'text' | 'voice';
}

const ChatContext = createContext<ChatContextValue | null>(null);

const HEALTH_CHECK_MS = 5000;
const ACTIVE_RUN_POLL_MS = 4000;
const MESSAGE_POLL_MS = 3500;

export function ChatProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [serverHealthy, setServerHealthy] = useState(true);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [backgroundRun, setBackgroundRun] = useState<ActiveRun | null>(null);
  const [gateBlocks, setGateBlocks] = useState<GateBlock[]>([]);
  const [responseMode, setResponseMode] = useState<'text' | 'voice'>('text');
  const dismissedDomainsRef = useRef<Set<string>>(new Set());
  const loadToken = useRef(0);
  const historyLoadingRef = useRef(false);
  const historyGenerationRef = useRef(0);
  const pendingNewChatRef = useRef(false);
  const streamingRef = useRef(false);
  const streamTargetRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const backgroundRunRef = useRef<ActiveRun | null>(null);
  const surfacedRunKeyRef = useRef<string | null>(null);
  const backgroundPendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<{ sessionId: string; userMsg: ChatMessage; assistantId: number; content: string; status: string | null } | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    backgroundRunRef.current = backgroundRun;
  }, [backgroundRun]);

  const currentQuestion = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content;
    }
    return null;
  }, [messages]);

  const loadSessions = useCallback(async () => {
    try {
      // kind=user: the sidebar is the principal's own chats, not delegated
      // (errand) sessions running with other contacts.
      const res = await apiRequest<SessionsResponse>('/sessions?limit=50&kind=user');
      setSessions(res.items);
    } catch {
      // Keep the current list if the request fails.
    }
  }, []);

  // Loads a session into view. `null` targets the live chat (latest open web
  // session, without creating one — a session is only created on first send).
  // A token guards against stale responses when switching sessions quickly.
  const loadSession = useCallback(async (target: string | null) => {
    const token = ++loadToken.current;
    historyGenerationRef.current += 1;
    historyLoadingRef.current = true;
    setHistoryLoaded(false);

    try {
      if (target === null) {
        if (pendingNewChatRef.current) {
          pendingNewChatRef.current = false;
          setActiveSessionId(null);
          setMessages([]);
          return;
        }

        if (streamTargetRef.current && activeSessionIdRef.current === streamTargetRef.current) {
          // A reply is still being streamed into the live chat while the user
          // navigated away and back. Keep the in-progress exchange on screen
          // instead of replacing it with history that doesn't include it yet.
          setHistoryLoaded(true);
          return;
        }

        if (backgroundRunRef.current && backgroundRunRef.current.sessionId === activeSessionIdRef.current) {
          // A reply is still being processed in the background (e.g. after a
          // reload). Keep the restored exchange on screen instead of replacing
          // it with history that doesn't include it yet.
          setHistoryLoaded(true);
          return;
        }

        const history = await apiRequest<ChatHistoryResponse>('/chat/history');
        if (token !== loadToken.current) return;

        if (history.sessionId) {
          setActiveSessionId(history.sessionId);
          setMessages(mapMessages(history.messages));
        } else {
          setActiveSessionId(null);
          setMessages([]);
        }
      } else {
        if (streamTargetRef.current === target && inFlightRef.current?.sessionId === target) {
          // A reply is still streaming into a freshly-rotated session (the
          // navigation that follows a `/compact` / auto-compact rotation). Keep
          // the in-progress exchange on screen instead of replacing it with
          // history that doesn't include it yet.
          setHistoryLoaded(true);
          return;
        }

        const detail = await apiRequest<SessionDetailResponse>(`/sessions/${target}`);
        if (token !== loadToken.current) return;

        setActiveSessionId(detail.session.id);
        setMessages(mapMessages(detail.messages));
      }
    } catch {
      if (token !== loadToken.current) return;
      setActiveSessionId(target);
      setMessages([]);
    } finally {
      if (token === loadToken.current) {
        historyLoadingRef.current = false;
        setHistoryLoaded(true);
      }
    }
  }, [loadSessions]);

  const openSession = useCallback((id: string | null) => {
    loadSession(id);
  }, [loadSession]);

  const newChat = useCallback(async () => {
    pendingNewChatRef.current = true;
    loadToken.current += 1;
    historyGenerationRef.current += 1;
    historyLoadingRef.current = false;
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setMessages([]);
    setHistoryLoaded(true);
    setGateBlocks([]);
    dismissedDomainsRef.current = new Set();
    await loadSessions();
  }, [loadSessions]);

  // Domain-gate blocks: after a turn, a tool call may have been refused because
  // its target host is not in koris.json `allowed_domains`. Surface those so the
  // user can add the domain from the chat.
  const refreshGateBlocks = useCallback(async () => {
    const sid = activeSessionIdRef.current;
    if (!sid) {
      setGateBlocks([]);
      return;
    }
    try {
      const res = await apiRequest<GateBlocksResponse>(`/chat/gate-blocks?sessionId=${encodeURIComponent(sid)}`);
      setGateBlocks(res.blocks.filter((b) => !dismissedDomainsRef.current.has(b.domain)));
    } catch {
      // Non-critical — leave the current list in place.
    }
  }, []);

  const allowDomain = useCallback(async (domain: string) => {
    try {
      await apiRequest<AllowedDomainsResponse>('/allowed-domains', {
        method: 'POST',
        body: JSON.stringify({ domain }),
      });
      setGateBlocks((prev) => prev.filter((b) => b.domain !== domain));
      setToast(`Added ${domain} to allowed_domains`);
    } catch (err) {
      setToast(`Error: ${err instanceof Error ? err.message : 'Failed to add domain'}`);
    }
  }, []);

  const dismissGateBlock = useCallback((domain: string) => {
    dismissedDomainsRef.current.add(domain);
    setGateBlocks((prev) => prev.filter((b) => b.domain !== domain));
  }, []);

  useEffect(() => {
    void refreshGateBlocks();
  }, [activeSessionId, refreshGateBlocks]);

  // Populate the sidebar list on mount. The chat page drives session loading.
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const healthy = await checkHealth();
      if (!cancelled) setServerHealthy(healthy);
    };

    poll();
    const interval = setInterval(poll, HEALTH_CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Poll for background messages in the active session (e.g. errand escalations or notices).
  useEffect(() => {
    const poller = createHistoryPoller({
      getState: () => {
        const sessionId = activeSessionIdRef.current;
        return {
          sessionId,
          generation: historyGenerationRef.current,
          busy: historyLoadingRef.current
            || (streamingRef.current && (!streamTargetRef.current || streamTargetRef.current === sessionId))
            || (!!backgroundRunRef.current && backgroundRunRef.current.sessionId === sessionId),
        };
      },
      fetchHistory: async (sessionId) => {
        const detail = await apiRequest<SessionDetailResponse>(`/sessions/${encodeURIComponent(sessionId)}`);
        return detail.messages;
      },
      update: setMessages,
    });
    void poller.poll();
    const interval = setInterval(() => { void poller.poll(); }, MESSAGE_POLL_MS);
    return () => {
      poller.dispose();
      clearInterval(interval);
    };
  }, [activeSessionId, historyLoaded, streaming, backgroundRun]);

  // Poll for questions still being processed server-side. When the page is
  // reloaded mid-run the SSE stream is gone, so this restores the current
  // question/status until the run finishes and history has the answer.
  useEffect(() => {
    let cancelled = false;
    let lastKey = '';

    const poll = async () => {
      let runs: ActiveRun[] = [];
      try {
        const res = await apiRequest<ActiveRunsResponse>('/active');
        runs = res.items;
      } catch {
        return;
      }
      if (cancelled) return;

      const webRun = runs.find((r) => r.channel === 'web') ?? null;
      const key = webRun ? `${webRun.sessionId}:${webRun.startedAt}` : '';
      if (key !== lastKey) {
        if (lastKey && !key && !streamingRef.current) {
          triggerResponseDone();
        }
        lastKey = key;
        setBackgroundRun(webRun);
      }
    };

    poll();
    const interval = setInterval(poll, ACTIVE_RUN_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Surface a background run into the viewed session and refresh the answer of
  // the previous one when it completes.
  useEffect(() => {
    if (streamingRef.current) return;

    const run = backgroundRun && activeSessionId === backgroundRun.sessionId ? backgroundRun : null;
    const prevKey = surfacedRunKeyRef.current;

    if (run && run.startedAt !== prevKey) {
      if (prevKey) {
        surfacedRunKeyRef.current = run.startedAt;
        void loadSession(activeSessionId ?? null);
        return;
      }
      surfacedRunKeyRef.current = run.startedAt;
    }

    if (run) {
      setMessages((prev) => {
        const alreadyPresent = prev.some((m) => m.backgroundRunKey === run.startedAt);
        let lastUser: ChatMessage | undefined;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === 'user') {
            lastUser = prev[i];
            break;
          }
        }
        const alreadyAnswered = !!lastUser
          && lastUser.content === run.question
          && prev.some((m) => m.role === 'assistant' && !m.pending && m.id > lastUser.id);
        if (alreadyPresent || alreadyAnswered) return prev;

        backgroundPendingRef.current = true;
        const startedAt = new Date(run.startedAt).getTime();
        const userMsg: ChatMessage = { id: nextId(), role: 'user', content: run.question, timestamp: timeStr(new Date(run.startedAt)), at: startedAt };
        const assistantMsg: ChatMessage = { id: nextId(), role: 'assistant', content: '', pending: true, status: 'Processing in background…', timestamp: '', at: startedAt, backgroundRunKey: run.startedAt };
        return [...prev, userMsg, assistantMsg];
      });
      return;
    }

    if (prevKey) {
      surfacedRunKeyRef.current = null;
      if (backgroundPendingRef.current) {
        backgroundPendingRef.current = false;
        void loadSession(activeSessionId ?? null);
      }
    }
  }, [backgroundRun, activeSessionId, loadSession, messages]);

  // Restore the locally-streamed exchange when the user returns to the session
  // it belongs to (e.g. after opening another session, which replaced messages
  // with that session's history). The stream's status/content deltas keep
  // flowing through the same assistant message id.
  useEffect(() => {
    const inFlight = inFlightRef.current;
    if (!inFlight) return;
    if (activeSessionId !== inFlight.sessionId) return;

    setMessages((prev) => {
      if (prev.some((m) => m.id === inFlight.assistantId)) return prev;
      const userMsg: ChatMessage = { ...inFlight.userMsg };
      const assistantMsg: ChatMessage = {
        id: inFlight.assistantId,
        role: 'assistant',
        content: inFlight.content,
        pending: true,
        status: inFlight.status ?? 'Thinking…',
        timestamp: '',
        at: inFlight.userMsg.at,
      };
      return [...prev, userMsg, assistantMsg];
    });
  }, [activeSessionId, messages]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const fillPrompt = useCallback((text: string) => {
    setInput(text);
  }, []);

  const sendMessage = useCallback(async (rawText: string, images: ImageAttachment[]) => {
    const text = rawText.trim();
    if ((!text && images.length === 0) || streaming) return;

    setStreaming(true);
    streamingRef.current = true;
    historyGenerationRef.current += 1;
    clearResponseAlert();
    const sentAt = Date.now();
    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: text, images, timestamp: timeStr(new Date()), at: sentAt };
    const assistantId = nextId();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', pending: true, timestamp: '', at: sentAt }]);

    let accumulated = '';

    try {
      let targetId = activeSessionId;
      if (!targetId) {
        const created = await apiRequest<SessionSummary>('/sessions', { method: 'POST' });
        pendingNewChatRef.current = false;
        setActiveSessionId(created.id);
        targetId = created.id;
        loadSessions();
      }
      streamTargetRef.current = targetId;
      inFlightRef.current = { sessionId: targetId, userMsg, assistantId, content: '', status: null };
      const controller = new AbortController();
      abortRef.current = controller;

      await streamChat(
        text,
        targetId,
        images,
        (status) => {
          if (inFlightRef.current) inFlightRef.current.status = status;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status, pending: true } : m)));
        },
        (chunk) => {
          accumulated += chunk;
          if (inFlightRef.current) inFlightRef.current.content = accumulated;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated, pending: false, status: undefined } : m)));
        },
        controller.signal,
        (rotatedSessionId) => {
          // `/compact` (or the manual-mode auto-compact) ended the current
          // session and opened a fresh one. Follow it so the next turn is routed
          // to the new session (and its resumed summary / memory reach the model),
          // redirect the URL to the new chat, and refresh the sidebar list.
          streamTargetRef.current = rotatedSessionId;
          historyGenerationRef.current += 1;
          if (inFlightRef.current) inFlightRef.current.sessionId = rotatedSessionId;
          setActiveSessionId(rotatedSessionId);
          void loadSessions();
          navigate(`/admin/chat/${rotatedSessionId}`);
        },
        (mode) => setResponseMode(mode),
      );

      setMessages((prev) => prev.map((m) => (m.id === assistantId
        ? { ...m, content: accumulated || 'No response.', pending: false, status: undefined, timestamp: timeStr(new Date()) }
        : m)));
      triggerResponseDone();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setMessages((prev) => prev.map((m) => (m.id === assistantId
          ? { ...m, content: accumulated ? `${accumulated}\n\n_(canceled)_` : '_(canceled)_', pending: false, status: undefined, error: false, timestamp: timeStr(new Date()) }
          : m)));
      } else {
        const msg = err instanceof Error ? err.message : 'Request failed';
        setMessages((prev) => prev.map((m) => (m.id === assistantId
          ? { ...m, content: msg, pending: false, status: undefined, error: true, timestamp: timeStr(new Date()) }
          : m)));
        setServerHealthy(false);
        setToast(`Error: ${msg}`);
      }
    } finally {
      inFlightRef.current = null;
      abortRef.current = null;
      streamingRef.current = false;
      streamTargetRef.current = null;
      setStreaming(false);
      loadSessions();
      void refreshGateBlocks();
    }
  }, [streaming, activeSessionId, loadSessions, refreshGateBlocks, navigate]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    const sid = streamTargetRef.current ?? activeSessionIdRef.current;
    if (sid) void cancelChat(sid);
  }, []);

  const submit = useCallback(async (overrideText?: string) => {
    const text = typeof overrideText === 'string' ? overrideText : input;
    const images = attachments;
    if ((!text.trim() && images.length === 0) || streaming) return;
    setInput('');
    setAttachments([]);
    await sendMessage(text, images);
  }, [input, attachments, streaming, sendMessage]);

  // Re-send the last question (text + images) after a provider error, so the
  // user doesn't retype. Keeps the failed turn on screen; appends a fresh try.
  const resendLast = useCallback(async () => {
    if (streaming) return;
    let lastUser: ChatMessage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUser = messages[i]; break; }
    }
    if (!lastUser) return;
    await sendMessage(lastUser.content, lastUser.images ?? []);
  }, [messages, streaming, sendMessage]);

  const value: ChatContextValue = {
    messages,
    input,
    setInput,
    attachments,
    setAttachments,
    streaming,
    currentQuestion,
    backgroundRun,
    serverHealthy,
    historyLoaded,
    toast,
    setToast,
    submit,
    resendLast,
    cancel,
    fillPrompt,
    activeSessionId,
    sessions,
    openSession,
    newChat,
    gateBlocks,
    allowDomain,
    dismissGateBlock,
    responseMode,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return ctx;
}
