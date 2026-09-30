import { useState } from 'react';
import Modal from '../Modal';
import { Button, IconButton, Badge } from '../ui';
import {
  AlertCircleIcon,
  CheckIcon,
  CloseIcon,
  MicIcon,
  MicOffIcon,
  RetryIcon,
  SendIcon,
  SquareIcon,
  WaveformIcon,
} from '../Icons';

import { useAudioRecognition } from './use-audio-recognition';
import {
  type AudioErrorState, formatDuration, resolveAudioOutputText,
  getAudioBadgeState, getAudioPlaceholderText, shouldShowMicOffIcon,
} from './audio-recognition';

// Preserve the existing helper exports for consumers of this component.
export * from './audio-recognition';

export interface AudioRecognitionModalProps {
  open: boolean;
  onClose: () => void;
  onSend: (text: string) => Promise<void> | void;
  onInsert: (text: string) => void;
  streaming?: boolean;
  initialError?: AudioErrorState | null;
  initialTranscript?: string;
}

export default function AudioRecognitionModal({
  open,
  onClose,
  onSend,
  onInsert,
  streaming = false,
  initialError = null,
  initialTranscript = '',
}: AudioRecognitionModalProps) {
  const {
    isRecording, isTranscribing, duration, transcript, interimText,
    soundLevel, hasSoundDetected, audioError, canvasRef,
    startRecording, stopRecording, cleanupAudio,
    setTranscript, setInterimText, setAudioError,
  } = useAudioRecognition({ open, initialError, initialTranscript });
  const [copied, setCopied] = useState(false);

  const handleClose = () => {
    cleanupAudio();
    onClose();
  };

  const handleSend = async () => {
    const textToSend = resolveAudioOutputText(transcript, interimText);
    if (!textToSend || streaming) return;
    stopRecording();
    await onSend(textToSend);
    handleClose();
  };

  const handleInsert = () => {
    const textToInsert = resolveAudioOutputText(transcript, interimText);
    if (!textToInsert) return;
    stopRecording();
    onInsert(textToInsert);
    handleClose();
  };

  const handleClear = () => {
    setTranscript('');
    setInterimText('');
    setAudioError(null);
    if (!isRecording) {
      void startRecording();
    }
  };

  const handleCopy = async () => {
    const text = resolveAudioOutputText(transcript, interimText);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard failure
    }
  };

  const displayText = transcript.trim();
  const hasText = Boolean(displayText || interimText.trim());
  const badgeState = getAudioBadgeState({
    audioError,
    isTranscribing,
    isRecording,
    hasSoundDetected,
    hasText,
  });
  const placeholderText = getAudioPlaceholderText({
    audioError,
    isRecording,
  });

  return (
    <Modal
      open={open}
      onClose={handleClose}
      hideHeader
      maxWidthClassName="max-w-lg"
      bodyClassName="p-0"
    >
      <div className="flex flex-col overflow-hidden bg-bg-2">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-subtle px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
              <WaveformIcon className="h-4 w-4 fill-none stroke-current" />
            </div>
            <div>
              <h2 className="font-sans text-sm font-semibold tracking-tight text-txt">
                Sound Recognition
              </h2>
              <p className="text-micro text-txt-3">Real-time voice & speech detection</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              tone={badgeState.tone}
              className={badgeState.animatePulse ? 'animate-pulse' : undefined}
            >
              {badgeState.label}
            </Badge>

            <IconButton
              onClick={handleClose}
              aria-label="Close dialog"
              title="Close (Esc)"
              size="sm"
              variant="secondary"
              className="border-subtle hover:bg-bg-3"
            >
              <CloseIcon className="h-3.5 w-3.5 fill-none stroke-current" />
            </IconButton>
          </div>
        </div>

        {/* Hero Section: Diagnostic / Error Card OR Live Visualizer */}
        <div className="relative flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-bg-3/50 to-bg-2 px-6 py-6">
          {audioError ? (
            <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-danger/30 bg-bg-3/90 p-5 text-center shadow-panel">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-danger/40 bg-danger/10 text-danger shadow-[0_0_20px_rgba(248,113,113,0.2)]">
                {shouldShowMicOffIcon(audioError.type) ? (
                  <MicOffIcon className="h-6 w-6 fill-none stroke-current" />
                ) : (
                  <AlertCircleIcon className="h-6 w-6 fill-none stroke-current" />
                )}
              </div>

              <div>
                <h3 className="font-sans text-sm font-semibold text-txt">
                  {audioError.title}
                </h3>
                <p className="mt-1 text-mini text-txt-2">
                  {audioError.message}
                </p>
              </div>

              <div className="w-full rounded-xl border border-subtle bg-bg-4/60 px-3.5 py-2.5 text-left text-micro leading-relaxed text-txt-3">
                <span className="font-medium text-txt-2">Suggested action: </span>
                {audioError.suggestion}
              </div>

              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => void startRecording()}
                className="mt-1 gap-1.5"
              >
                <RetryIcon className="h-3.5 w-3.5 fill-none stroke-current" />
                {audioError.actionLabel || 'Try Again'}
              </Button>
            </div>
          ) : (
            <>
              {/* Reactive Waveform Canvas */}
              <div className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-xl border border-subtle/80 bg-bg-4/40 px-3">
                <canvas
                  ref={canvasRef}
                  width={380}
                  height={56}
                  className="h-full w-full object-contain"
                />
              </div>

              {/* Central Mic Button with Acoustic Ripple Ring */}
              <div className="relative flex items-center justify-center">
                {isRecording && (
                  <>
                    <span
                      style={{
                        transform: `scale(${1 + soundLevel * 1.8})`,
                        opacity: Math.max(0.1, soundLevel * 0.8),
                      }}
                      className="pointer-events-none absolute -inset-3 rounded-full bg-accent/25 transition-transform duration-75 ease-out"
                    />
                    <span
                      style={{
                        transform: `scale(${1 + soundLevel * 2.8})`,
                        opacity: Math.max(0.05, soundLevel * 0.4),
                      }}
                      className="pointer-events-none absolute -inset-6 rounded-full bg-accent/15 transition-transform duration-100 ease-out"
                    />
                  </>
                )}

                <button
                  type="button"
                  onClick={isRecording ? stopRecording : () => void startRecording()}
                  title={isRecording ? 'Pause recording' : 'Start recording'}
                  className={`relative z-10 flex h-16 w-16 items-center justify-center rounded-full border shadow-panel transition-all duration-200 active:scale-95 ${
                    isRecording
                      ? 'border-accent bg-accent text-white hover:brightness-110'
                      : 'border-strong bg-bg-3 text-txt-2 hover:border-accent/40 hover:text-txt'
                  }`}
                >
                  {isRecording ? (
                    <SquareIcon className="h-6 w-6 fill-current" />
                  ) : (
                    <MicIcon className="h-6 w-6 fill-none stroke-current" />
                  )}
                </button>
              </div>

              {/* Timer & Status Label */}
              <div className="flex items-center gap-2">
                {isRecording && (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                  </span>
                )}
                <span className="font-mono text-xs font-medium text-txt">
                  {formatDuration(duration)}
                </span>
                <span className="text-caption text-txt-3">
                  {isRecording ? 'Listening for speech…' : 'Click microphone to record'}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Real-time Recognition Output Card */}
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between pb-1.5 pt-1">
            <span className="text-micro font-medium uppercase tracking-wider text-txt-3">
              Recognized Speech
            </span>
            {hasText && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="flex items-center gap-1 text-micro text-txt-3 hover:text-txt"
                >
                  {copied ? (
                    <>
                      <CheckIcon className="h-3 w-3 fill-none stroke-current text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    'Copy'
                  )}
                </button>
                <span className="text-txt-3">•</span>
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex items-center gap-1 text-micro text-txt-3 hover:text-txt"
                >
                  <RetryIcon className="h-2.5 w-2.5 fill-none stroke-current" />
                  Reset
                </button>
              </div>
            )}
          </div>

          <div className="relative min-h-[96px] max-h-48 overflow-y-auto rounded-card border border-strong bg-bg-3 p-3.5 font-sans text-sm leading-relaxed text-txt outline-none focus-within:border-accent">
            {hasText ? (
              <div>
                <span>{displayText}</span>
                {interimText && (
                  <span className="text-accent-2 italic">
                    {displayText ? ` ${interimText}` : interimText}
                  </span>
                )}
                {isRecording && (
                  <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle" />
                )}
              </div>
            ) : (
              <p className="select-none text-txt-3 italic">
                {placeholderText}
              </p>
            )}
          </div>

          {/* Settings & Hints */}
          <div className="mt-3 flex items-center justify-end text-mini text-txt-3">
            <span className="font-mono text-micro text-txt-3">
              {displayText ? `${displayText.length} chars` : ''}
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-subtle bg-bg-2/70 px-5 py-3.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleClose}
          >
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!hasText}
              onClick={handleInsert}
              title="Insert recognized text into message box"
            >
              Insert in Input
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!hasText || streaming}
              onClick={() => void handleSend()}
              title="Send recognized message to chat"
              className="gap-1.5"
            >
              <SendIcon className="h-3.5 w-3.5 fill-none stroke-current" />
              Send to Chat
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
