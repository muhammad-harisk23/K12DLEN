import { useEffect, useRef, useState } from 'react';
import { Bot, ChevronUp, MessageCircleQuestion, Sparkles, User } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { RoomTutorError, askRoomTutor, fetchOlderTutorMessages, fetchTutorMessages } from '@/lib/roomTutor';
import {
  MAX_QUESTION_LEN,
  applyHistoryPage,
  applyRealtimeEvent,
  isGenerating,
  makeRequestId,
  mergeMessages,
  validateQuestion,
} from '@/lib/tutorCore';
import type { PendingQuestion, TutorMessage } from '@/lib/tutorCore';
import { supabase } from '@/lib/supabase';
import type { StudentProfile } from '@/types/curriculum';

interface ConversationPanelProps {
  roomId: string;
  profile: StudentProfile;
  roomReady: boolean;
  /** Title of the video the student is currently watching (sent as AI context). */
  currentVideoTitle?: string | null;
  /** YouTube id of the current video (sent as AI context attribution). */
  currentVideoId?: string | null;
  /** When true, the panel stretches to fill its column height (desktop split). */
  fillHeight?: boolean;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'denied' }
  | { status: 'ready'; messages: TutorMessage[]; hasMore: boolean };

export function ConversationPanel({
  roomId,
  profile,
  roomReady,
  currentVideoTitle,
  currentVideoId,
  fillHeight,
}: ConversationPanelProps) {
  // Keep the latest video context in a ref so handleSubmit always sends the
  // current video even if the student switches lessons mid-draft.
  const videoCtxRef = useRef({ title: currentVideoTitle ?? null, id: currentVideoId ?? null });
  videoCtxRef.current = { title: currentVideoTitle ?? null, id: currentVideoId ?? null };
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const [draft, setDraft] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offlineNotice, setOfflineNotice] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ---- initial load ----
  useEffect(() => {
    if (!roomReady) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchTutorMessages(roomId);
        if (cancelled) return;
        setLoad({ status: 'ready', messages: page.messages, hasMore: page.hasMore });
      } catch {
        if (!cancelled) setLoad({ status: 'denied' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, roomReady]);

  // ---- realtime: approved messages only (RLS-filtered delivery) ----
  useEffect(() => {
    if (load.status !== 'ready') return;
    const channel = supabase
      .channel(`room-chat-${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const incoming = {
            id: String(row.id),
            seq: Number(row.seq),
            roomId: String(row.room_id),
            senderId: String(row.sender_id),
            role: row.role === 'ai' ? 'ai' : 'student',
            status: row.status === 'blocked' ? 'blocked' : 'approved',
            body: String(row.body ?? ''),
            inReplyTo: (row.in_reply_to as string | null) ?? null,
            clientRequestId: String(row.client_request_id ?? ''),
            createdAt: String(row.created_at ?? ''),
            metadata: (row.metadata as TutorMessage['metadata']) ?? {},
          } satisfies TutorMessage;
          setLoad((prev) =>
            prev.status === 'ready'
              ? { ...prev, messages: applyRealtimeEvent(prev.messages, incoming) }
              : prev
          );
          setNotice(null);
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setOfflineNotice(true);
        if (status === 'SUBSCRIBED') setOfflineNotice(false);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load.status, roomId]);

  // scroll to newest when the feed grows
  const feedCount = load.status === 'ready' ? mergeMessages(load.messages, pending).length : 0;
  const prevCountRef = useRef(feedCount);
  useEffect(() => {
    if (feedCount > prevCountRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevCountRef.current = feedCount;
  }, [feedCount]);

  async function loadOlder() {
    if (load.status !== 'ready' || !load.hasMore || loadingOlder) return;
    const oldest = load.messages[0]?.seq;
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const page = await fetchOlderTutorMessages(roomId, oldest);
      setLoad((prev) =>
        prev.status === 'ready'
          ? {
              ...applyHistoryPage(prev.messages, page.messages, page.hasMore),
              status: 'ready' as const,
            }
          : prev
      );
    } catch {
      setNotice('Could not load earlier messages.');
    } finally {
      setLoadingOlder(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setNotice(null);
    const check = validateQuestion(draft);
    if (!check.ok) {
      setSubmitError(check.error);
      return;
    }
    const requestId = makeRequestId();
    const entry: PendingQuestion = { requestId, body: check.text, createdAt: Date.now() };
    setPending(entry);
    setDraft('');
    try {
      const result = await askRoomTutor({
        roomId,
        question: check.text,
        clientRequestId: requestId,
        videoTitle: videoCtxRef.current.title,
        videoId: videoCtxRef.current.id,
      });
      if (result.status === 'blocked') {
        setNotice(result.reason);
      }
      // approved messages arrive via realtime; also apply directly to be robust
      if (result.status === 'ok') {
        setLoad((prev) => {
          if (prev.status !== 'ready') return prev;
          let messages = prev.messages;
          for (const m of result.messages) messages = applyRealtimeEvent(messages, m);
          return { ...prev, messages };
        });
      }
      setPending((p) => (p?.requestId === requestId ? null : p));
    } catch (err) {
      setPending(null);
      setDraft(check.text);
      if (err instanceof RoomTutorError) {
        if (err.kind === 'rate_limited') setNotice(err.message);
        else setSubmitError(err.message);
      } else {
        setSubmitError('Could not ask the tutor. Please try again.');
      }
    }
  }

  if (load.status === 'loading') {
    return (
      <section aria-label="Shared tutor conversation" className="rounded-2xl border border-line bg-raised p-5 shadow-sm">
        <div className="h-24 animate-pulse rounded-xl bg-sunken" />
      </section>
    );
  }

  if (load.status === 'denied') {
    return (
      <section aria-label="Shared tutor conversation" className="rounded-2xl border border-line bg-raised p-5 text-center shadow-sm">
        <MessageCircleQuestion className="mx-auto h-6 w-6 text-ink-faint" aria-hidden />
        <p className="mt-2 text-sm text-ink-soft">Ask a question about this lesson and the room's tutor will help everyone.</p>
      </section>
    );
  }

  const feed = mergeMessages(load.messages, pending);
  const generating = isGenerating(feed, pending);
  const remaining = MAX_QUESTION_LEN - draft.length;

  return (
    <section
      aria-label="Shared tutor conversation"
      className={`flex flex-col rounded-2xl border border-accent/25 bg-raised shadow-sm ${fillHeight ? 'h-full min-h-0' : ''}`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          Shared tutor
        </h2>
        {offlineNotice && (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
            Reconnecting…
          </span>
        )}
      </header>

      {currentVideoTitle && (
        <p className="flex items-center gap-1.5 border-b border-line/60 bg-accent-soft/40 px-4 py-2 text-[11px] leading-snug text-accent-strong">
          <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">Asking about: {currentVideoTitle}</span>
        </p>
      )}

      {/* Feed */}
      <div ref={scrollRef} className={`min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 ${fillHeight ? '' : 'max-h-[420px] min-h-[180px]'}`}>
        {load.hasMore && (
          <button
            type="button"
            onClick={() => void loadOlder()}
            disabled={loadingOlder}
            className="mx-auto flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            {loadingOlder ? 'Loading…' : 'Earlier messages'}
          </button>
        )}

        {feed.length === 0 && !generating && (
          <div className="px-4 py-8 text-center">
            <Bot className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
            <p className="mt-2 text-sm font-medium text-ink">No questions yet</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ink-soft">
              Ask anything about this lesson — the tutor answers for the whole room, and everyone learns from it.
            </p>
          </div>
        )}

        {feed.map((item, idx) =>
          'pendingOf' in item ? (
            <div key={item.pendingOf.requestId} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2.5 text-sm leading-relaxed text-accent-strong">
                <p className="whitespace-pre-wrap break-words">{item.pendingOf.body}</p>
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-accent">
                  <span className="inline-flex gap-0.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:300ms]" />
                  </span>
                  Checking with the tutor…
                </p>
              </div>
            </div>
          ) : (
            <ConversationEntry
              key={item.id}
              message={item}
              mine={item.senderId === profile.id}
              showAvatar={idx === 0 || (feed[idx - 1] as TutorMessage | undefined)?.senderId !== item.senderId}
            />
          )
        )}

        {generating && pending && !feed.some((f) => 'pendingOf' in f) && (
          <p className="text-center text-xs text-ink-faint" role="status">
            Thinking…
          </p>
        )}
      </div>

      {/* Notices */}
      {(notice || submitError) && (
        <div className="px-5 pb-1">
          {notice && (
            <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800" role="status">
              {notice}
            </p>
          )}
          {submitError && (
            <p className="mt-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-xs leading-relaxed text-red-700" role="alert">
              {submitError}
            </p>
          )}
        </div>
      )}

      {/* Composer */}
      <form onSubmit={handleSubmit} className="border-t border-line px-4 py-3.5">
        <label htmlFor="tutor-question" className="sr-only">
          Ask the shared tutor
        </label>
        <textarea
          id="tutor-question"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask the room's tutor about this lesson…"
          rows={2}
          maxLength={MAX_QUESTION_LEN}
          className="w-full resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className={`text-[11px] tabular-nums ${remaining < 60 ? 'text-amber-700' : 'text-ink-faint'}`}>
            {remaining < 60 ? `${remaining} characters left` : 'Be specific — answers are shared with the room'}
          </span>
          <Button type="submit" disabled={!draft.trim() || generating} loading={generating}>
            Ask tutor
          </Button>
        </div>
      </form>
    </section>
  );
}

function ConversationEntry({ message, mine }: { message: TutorMessage; mine: boolean; showAvatar: boolean }) {
  if (message.role === 'student') {
    return (
      <div className={`flex gap-2.5 ${mine ? 'justify-end' : ''}`}>
        {!mine && (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-soft">
            <User className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
        <div className={`max-w-[85%] ${mine ? 'order-first' : ''}`}>
          <div
            className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
              mine ? 'rounded-br-md bg-accent text-white' : 'rounded-bl-md bg-sunken text-ink'
            }`}
          >
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          </div>
          <p className={`mt-1 text-[11px] text-ink-faint ${mine ? 'text-right' : ''}`}>{mine ? 'You asked' : 'Classmate asked'}</p>
        </div>
        {mine && (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
            <User className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
        <Bot className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 max-w-[85%]">
        <div className="rounded-2xl rounded-bl-md border border-accent/20 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink shadow-sm">
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        </div>
        <p className="mt-1 text-[11px] text-ink-faint">Study tutor</p>
      </div>
    </div>
  );
}
