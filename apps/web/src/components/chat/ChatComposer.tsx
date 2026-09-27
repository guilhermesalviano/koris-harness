import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import type { ImageAttachment } from '../../lib/types';
import ProviderPicker from '../ProviderPicker';
import { AttachIcon, CloseIcon, MicIcon, SendIcon, StopIcon } from '../Icons';
import { imageSrc } from './shared';

export interface ChatComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onCancelStreaming?: () => void;
  streaming?: boolean;
  canSend?: boolean;
  attachments?: ImageAttachment[];
  onAddFiles?: (files: File[]) => void;
  onRemoveAttachment?: (index: number) => void;
  onPreviewAttachment?: (index: number) => void;
  onOpenAudioModal?: () => void;
  placeholder?: string;
  maxChars?: number;
  className?: string;
}

export function computeCanSend(
  canSend: boolean | undefined,
  streaming: boolean,
  input: string,
  attachmentsCount: number,
): boolean {
  return canSend !== undefined
    ? canSend
    : !streaming && (input.trim().length > 0 || attachmentsCount > 0);
}

export function filterImageFiles(files: File[]): File[] {
  return files.filter((f) => f.type.startsWith('image/'));
}

export function handleComposerKeyDown(
  e: { key: string; shiftKey?: boolean; preventDefault: () => void },
  effectiveCanSend: boolean,
  streaming: boolean,
  onSubmit: () => void | Promise<void>,
  onCancelStreaming?: () => void,
): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (effectiveCanSend) {
      void onSubmit();
    }
  } else if (e.key === 'Escape' && streaming) {
    e.preventDefault();
    onCancelStreaming?.();
  }
}

export function handleComposerPaste(
  e: { clipboardData: { files: FileList | File[] } | null; preventDefault: () => void },
  onAddFiles?: (files: File[]) => void,
): void {
  const files = Array.from(e.clipboardData?.files ?? []);
  if (files.length === 0) return;
  const images = filterImageFiles(files);
  if (images.length === 0) return;
  e.preventDefault();
  onAddFiles?.(images);
}

export function handleComposerDrop(
  e: { dataTransfer: { files: FileList | File[] } | null; preventDefault: () => void; stopPropagation: () => void },
  onAddFiles?: (files: File[]) => void,
): void {
  e.preventDefault();
  e.stopPropagation();
  const files = Array.from(e.dataTransfer?.files ?? []);
  const images = filterImageFiles(files);
  if (images.length > 0) {
    onAddFiles?.(images);
  }
}

export function handleComposerFileInput(
  files: File[] | FileList | null | undefined,
  onAddFiles?: (files: File[]) => void,
): void {
  if (files && files.length > 0) {
    const images = filterImageFiles(Array.from(files));
    if (images.length > 0) {
      onAddFiles?.(images);
    }
  }
}

export const ChatComposer = forwardRef<HTMLTextAreaElement, ChatComposerProps>(function ChatComposer(
  {
    input,
    onInputChange,
    onSubmit,
    onCancelStreaming,
    streaming = false,
    canSend,
    attachments = [],
    onAddFiles,
    onRemoveAttachment,
    onPreviewAttachment,
    onOpenAudioModal,
    placeholder = 'Ask something…',
    maxChars = 4000,
    className,
  },
  ref,
) {
  const innerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useImperativeHandle(ref, () => innerTextareaRef.current as HTMLTextAreaElement);

  useEffect(() => {
    const el = innerTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [input]);

  const effectiveCanSend = computeCanSend(canSend, streaming, input, attachments.length);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    handleComposerKeyDown(e, effectiveCanSend, streaming, onSubmit, onCancelStreaming);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    handleComposerPaste(e, onAddFiles);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    setIsDragging(false);
    handleComposerDrop(e, onAddFiles);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleComposerFileInput(e.target.files, onAddFiles);
    e.target.value = '';
  }

  const charCount = input.length;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'relative flex flex-col rounded-card border border-strong bg-bg-3/95 p-3 shadow-panel transition-all duration-200',
        'focus-within:border-accent/60 focus-within:shadow-[0_0_24px_rgba(243,98,70,0.12)]',
        isDragging && 'border-accent bg-bg-4 ring-2 ring-accent/30',
        className,
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Attachment Preview Tray */}
      {attachments.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-2 animate-msg-in">
          {attachments.map((img, i) => (
            <div key={i} className="group relative">
              <button
                type="button"
                onClick={() => onPreviewAttachment?.(i)}
                title="View image"
                aria-label={`View image attachment ${i + 1}`}
                className="block h-14 w-14 overflow-hidden rounded-control border border-strong bg-bg-2 transition-transform duration-150 hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <img
                  src={imageSrc(img)}
                  alt={`attachment ${i + 1}`}
                  className="h-full w-full cursor-zoom-in object-cover"
                />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveAttachment?.(i);
                }}
                className="absolute -right-1.5 -top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-strong bg-bg-2 text-txt-2 shadow-sm transition-colors hover:border-danger hover:bg-danger hover:text-white focus:outline-none"
                title="Remove image"
                aria-label={`Remove attachment ${i + 1}`}
              >
                <CloseIcon className="h-2.5 w-2.5 fill-none stroke-current" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main Textarea */}
      <textarea
        ref={innerTextareaRef}
        rows={1}
        placeholder={placeholder}
        autoComplete="off"
        value={input}
        maxLength={maxChars}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className="min-h-[44px] max-h-48 w-full resize-none bg-transparent px-1 py-1 font-sans text-body leading-relaxed text-txt outline-none placeholder:text-txt-3 selection:bg-accent/30"
      />

      {/* Bottom Action Bar */}
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-subtle/50 pt-2">
        {/* Left Toolbar */}
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            disabled={streaming}
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
            aria-label="Attach image"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control text-txt-3 transition-colors duration-150 hover:bg-bg-4 hover:text-txt disabled:cursor-not-allowed disabled:opacity-35"
          >
            <AttachIcon className="h-4 w-4 fill-none stroke-current" />
          </button>
          <button
            type="button"
            disabled={streaming}
            onClick={onOpenAudioModal}
            title="Record voice note & sound recognition"
            aria-label="Record voice note"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control text-txt-3 transition-colors duration-150 hover:bg-bg-4 hover:text-accent-2 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <MicIcon className="h-4 w-4 fill-none stroke-current" />
          </button>
          <div className="mx-1 h-3.5 w-px bg-border-subtle" />
          <ProviderPicker />
        </div>

        {/* Right Toolbar */}
        <div className="flex flex-shrink-0 items-center gap-2.5">
          <div className="flex items-center gap-2 font-mono text-micro text-txt-3">
            <span className="hidden sm:inline">↵ send · ⇧↵ newline</span>
            {charCount > 0 && (
              <span className={charCount > maxChars * 0.85 ? 'font-medium text-amber-500' : ''}>
                {charCount}
              </span>
            )}
          </div>

          {streaming ? (
            <button
              type="button"
              title="Stop generating"
              aria-label="Stop generating"
              onClick={onCancelStreaming}
              className="flex h-8 w-8 items-center justify-center rounded-control bg-accent text-white shadow-panel transition-all duration-150 hover:bg-accent-2 active:scale-95"
            >
              <StopIcon className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!effectiveCanSend}
              title="Send message"
              aria-label="Send message"
              onClick={() => void onSubmit()}
              className="flex h-8 w-8 items-center justify-center rounded-control bg-accent text-white shadow-panel transition-all duration-150 hover:enabled:bg-accent-2 active:enabled:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <SendIcon className="h-3.5 w-3.5 fill-none stroke-current" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default ChatComposer;
