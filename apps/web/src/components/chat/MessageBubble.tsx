import { cn } from '../../lib/cn';
import { renderMarkdown } from '../../lib/markdown';
import type { ChatMessage } from '../../lib/chat-context';
import type { ImageAttachment } from '../../lib/types';
import { Button } from '../ui';
import { BrokenImageIcon, RetryIcon, SpeakerIcon, SquareIcon } from '../Icons';
import { imageSrc, type PreviewImages } from './shared';

export interface MessageBubbleProps {
  message: ChatMessage;
  /** Retry is only ever offered on the newest turn. */
  isLast: boolean;
  streaming: boolean;
  /** `responseMode === 'voice'` — gates the play/stop control. */
  voiceMode: boolean;
  speakingId: number | null;
  loadingSpeakId: number | null;
  onSpeak: (message: ChatMessage) => void;
  onResend: () => void;
  onPreviewImages: PreviewImages;
}

/** Shared bubble chrome; the prose styles hang off the `bubble` class in index.css. */
const BUBBLE = 'bubble relative w-fit max-w-full break-words px-4 py-3 text-lead leading-relaxed';

export function MessageBubble({
  message,
  isLast,
  streaming,
  voiceMode,
  speakingId,
  loadingSpeakId,
  onSpeak,
  onResend,
  onPreviewImages,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';

  const canResend = !isUser && message.error && isLast && !streaming;
  const canSpeak = voiceMode && !isUser && !message.pending && !message.error && Boolean(message.content) && !streaming;
  const hasFooter = canResend || canSpeak || Boolean(message.timestamp);

  return (
    <div className={cn('flex animate-msg-in gap-3', isUser && 'justify-end pl-8')}>
      {!isUser && (
        <div
          aria-hidden
          className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-accent-muted bg-accent-muted font-mono text-micro font-medium lowercase text-accent-2"
        >
          ai
        </div>
      )}

      <div className={cn('flex min-w-0 flex-col gap-1.5', isUser ? 'max-w-[88%] items-end' : 'flex-1 items-start')}>
        {isUser ? (
          <div className={cn(BUBBLE, 'rounded-card rounded-br-md bg-accent text-white shadow-panel')}>
            <MessageImages message={message} onPreviewImages={onPreviewImages} />
            {message.content}
          </div>
        ) : message.pending && !message.content ? (
          <div className={cn(BUBBLE, 'rounded-card rounded-bl-md border border-subtle bg-bg-2 text-txt')}>
            {message.status ? (
              <span className="text-body italic text-txt-2">{message.status}</span>
            ) : (
              <span className="flex items-center gap-1.5 py-1" role="status" aria-label="Assistant is replying">
                <span className="h-[5px] w-[5px] animate-blink rounded-full bg-txt-3" />
                <span className="h-[5px] w-[5px] animate-blink2 rounded-full bg-txt-3" />
                <span className="h-[5px] w-[5px] animate-blink3 rounded-full bg-txt-3" />
              </span>
            )}
          </div>
        ) : (
          <div
            className={cn(
              BUBBLE,
              'rounded-card rounded-bl-md border',
              message.error ? 'border-danger bg-danger-muted text-txt' : 'border-subtle bg-bg-2 text-txt',
            )}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        )}

        {hasFooter && (
          <div className={cn('flex flex-wrap items-center gap-2 px-1', isUser && 'justify-end')}>
            {canResend && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onResend}
                title="Send the last message again"
                iconLeft={<RetryIcon className="h-3 w-3 fill-none stroke-current" />}
                className="font-mono"
              >
                Resend
              </Button>
            )}
            {canSpeak && <SpeakButton message={message} speakingId={speakingId} loadingSpeakId={loadingSpeakId} onSpeak={onSpeak} />}
            {message.timestamp && <span className="font-mono text-micro text-txt-3">{message.timestamp}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function SpeakButton({
  message,
  speakingId,
  loadingSpeakId,
  onSpeak,
}: {
  message: ChatMessage;
  speakingId: number | null;
  loadingSpeakId: number | null;
  onSpeak: (message: ChatMessage) => void;
}) {
  const loading = loadingSpeakId === message.id;
  const playing = speakingId === message.id;

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={loading}
      onClick={() => onSpeak(message)}
      title={playing ? 'Stop playback' : 'Play as speech'}
      iconLeft={
        loading ? (
          <span className="h-2 w-2 animate-ping rounded-full bg-accent" />
        ) : playing ? (
          <SquareIcon className="h-3 w-3 fill-current" />
        ) : (
          <SpeakerIcon className="h-3 w-3 fill-none stroke-current" />
        )
      }
      className="font-mono"
    >
      {loading ? 'Loading…' : playing ? 'Stop' : 'Play'}
    </Button>
  );
}

/** Thumbnails carried by a user turn, plus placeholders for images since deleted. */
function MessageImages({ message, onPreviewImages }: { message: ChatMessage; onPreviewImages: PreviewImages }) {
  const images: ImageAttachment[] = message.images ?? [];
  const missing = message.missingImages ?? 0;
  if (images.length === 0 && missing === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {images.map((img, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPreviewImages(images, i)}
          title="View image"
          aria-label={`View attachment ${i + 1}`}
          className="group overflow-hidden rounded-control outline-none transition-transform duration-150 hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <img
            src={imageSrc(img)}
            alt={`attachment ${i + 1}`}
            className="h-20 max-w-[140px] cursor-zoom-in rounded-control object-cover transition-opacity duration-150 group-hover:opacity-90"
          />
        </button>
      ))}
      {Array.from({ length: missing }).map((_, i) => (
        <div
          key={`missing-${i}`}
          className="group relative flex h-20 w-[140px] cursor-default items-center justify-center rounded-control border border-dashed border-strong bg-bg-3"
        >
          <BrokenImageIcon className="h-7 w-7 fill-none stroke-txt-3" />
          <span className="pointer-events-none absolute bottom-full right-0 z-10 mb-1.5 max-w-[220px] rounded-control border border-subtle bg-bg-2 px-2 py-1 text-right font-mono text-mini leading-snug text-txt-2 opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100">
            This image was deleted and is no longer accessible
          </span>
        </div>
      ))}
    </div>
  );
}
