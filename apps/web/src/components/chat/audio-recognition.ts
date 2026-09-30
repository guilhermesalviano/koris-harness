export type AudioErrorType =
  | 'permission-denied'
  | 'no-microphone'
  | 'device-busy'
  | 'disconnected'
  | 'insecure-context'
  | 'unsupported'
  | 'transcription-failed'
  | 'general';

export interface AudioErrorState {
  type: AudioErrorType;
  title: string;
  message: string;
  suggestion: string;
  actionLabel?: string;
}

export type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

export function getSpeechRecognitionClass(win?: unknown): SpeechRecognitionConstructor | null {
  const target = (win !== undefined ? win : (typeof window !== 'undefined' ? window : undefined)) as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  } | undefined;
  if (!target) return null;
  return target.SpeechRecognition || target.webkitSpeechRecognition || null;
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function getAudioFilename(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'recording.mp4';
  if (mimeType.includes('ogg')) return 'recording.ogg';
  return 'recording.webm';
}

export function resolveSupportedMimeType(
  isTypeSupported?: (mime: string) => boolean,
): string {
  if (!isTypeSupported) return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg',
  ];
  for (const candidate of candidates) {
    if (isTypeSupported(candidate)) return candidate;
  }
  return '';
}

export function resolveActualMimeType(recorderMime?: string, fallbackMime?: string): string {
  return recorderMime || fallbackMime || 'audio/webm';
}

export function filterAudioInputs(devices: { kind: string }[]): { kind: string }[] {
  return devices.filter((d) => d.kind === 'audioinput');
}

export function checkRecordingEnvironment(options: {
  isSecureContext?: boolean;
  hostname?: string;
  hasMediaDevices?: boolean;
  hasGetUserMedia?: boolean;
}): AudioErrorState | null {
  if (
    options.isSecureContext === false &&
    options.hostname !== 'localhost' &&
    options.hostname !== '127.0.0.1'
  ) {
    return {
      type: 'insecure-context',
      title: 'HTTPS Required',
      message: 'Microphone access is restricted on insecure connections.',
      suggestion:
        'Please open this application over HTTPS or via localhost to allow microphone recording.',
    };
  }

  if (!options.hasMediaDevices || !options.hasGetUserMedia) {
    return {
      type: 'unsupported',
      title: 'Not Supported',
      message: 'Audio recording is not supported in this browser or environment.',
      suggestion: 'Please use a modern browser such as Chrome, Firefox, Safari, or Edge.',
    };
  }

  return null;
}

export function buildAudioConstraints(forceRetryFallback: boolean): MediaStreamConstraints {
  return forceRetryFallback
    ? { audio: true }
    : {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };
}

export interface AudioErrorResolution {
  errorState: AudioErrorState | null;
  retryFallback: boolean;
}

export function mapAudioError(err: unknown, forceRetryFallback = false): AudioErrorResolution {
  if (err instanceof DOMException) {
    if (
      err.name === 'NotAllowedError' ||
      err.name === 'PermissionDeniedError' ||
      err.name === 'SecurityError'
    ) {
      return {
        errorState: {
          type: 'permission-denied',
          title: 'Microphone Permission Blocked',
          message: 'Microphone access was denied in your browser settings.',
          suggestion:
            'Click the lock or settings icon in your browser address bar to allow microphone access, then click Try Again.',
          actionLabel: 'Try Again',
        },
        retryFallback: false,
      };
    }

    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return {
        errorState: {
          type: 'no-microphone',
          title: 'No Microphone Detected',
          message: 'We could not find any connected microphone or audio input hardware.',
          suggestion:
            'Please plug in or connect a microphone, headset, or webcam and click Check Devices.',
          actionLabel: 'Check Devices',
        },
        retryFallback: false,
      };
    }

    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return {
        errorState: {
          type: 'device-busy',
          title: 'Microphone In Use',
          message:
            'Your microphone is currently in use by another application or locked by the system.',
          suggestion:
            'Please close other applications using audio (such as video conferencing or screen recording apps) and try again.',
          actionLabel: 'Retry Connection',
        },
        retryFallback: false,
      };
    }

    if (err.name === 'OverconstrainedError' && !forceRetryFallback) {
      return {
        errorState: null,
        retryFallback: true,
      };
    }
  }

  return {
    errorState: {
      type: 'general',
      title: 'Microphone Error',
      message: err instanceof Error ? err.message : String(err),
      suggestion: 'Please check your microphone settings and try reconnecting your device.',
      actionLabel: 'Retry',
    },
    retryFallback: false,
  };
}

export interface SpeechRecognitionResultItem {
  transcript: string;
}
export interface SpeechRecognitionResultEntry {
  isFinal: boolean;
  [j: number]: SpeechRecognitionResultItem;
  0: SpeechRecognitionResultItem;
}
export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: SpeechRecognitionResultEntry;
  };
}

export function parseSpeechRecognitionResults(
  event: SpeechRecognitionEventLike,
): { newFinal: string; interim: string } {
  let interim = '';
  let newFinal = '';

  for (let i = event.resultIndex; i < event.results.length; i++) {
    const res = event.results[i];
    if (res && res[0]) {
      if (res.isFinal) {
        newFinal += res[0].transcript;
      } else {
        interim += res[0].transcript;
      }
    }
  }

  return { newFinal, interim };
}

export function appendTranscript(prev: string, newFinal: string): string {
  const trimmed = prev.trim();
  const addition = newFinal.trim();
  if (!addition) return prev;
  return trimmed ? `${trimmed} ${addition}` : addition;
}

export function computeSoundLevel(
  dataArray: Uint8Array,
  bufferLength: number,
  prevSmoothedLevel: number,
): { smoothedLevel: number; hasSoundDetected: boolean } {
  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    sum += dataArray[i];
  }
  const currentLevel = sum / (bufferLength * 255);
  const smoothed = prevSmoothedLevel * 0.7 + currentLevel * 0.3;
  return {
    smoothedLevel: smoothed,
    hasSoundDetected: smoothed > 0.07,
  };
}

export function computeVisualizerBar(options: {
  index: number;
  barCount: number;
  dataArray: Uint8Array;
  bufferLength: number;
  width: number;
  height: number;
  barWidth?: number;
}): {
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
  isHighlighted: boolean;
  fillColor: string;
} {
  const { index, barCount, dataArray, bufferLength, width, height, barWidth = 4 } = options;
  const totalBarsWidth = barCount * barWidth;
  const totalSpacing = width - totalBarsWidth;
  const barGap = totalSpacing / (barCount - 1);
  const centerY = height / 2;

  const dataIndex = Math.floor((index / barCount) * (bufferLength / 2));
  const value = dataArray[dataIndex] || 0;
  const normalized = Math.max(0.08, value / 255);
  const barHeight = Math.max(4, normalized * (height * 0.88));

  const x = index * (barWidth + barGap);
  const y = centerY - barHeight / 2;

  const alpha = Math.min(1, 0.35 + normalized * 0.65);
  const isHighlighted = normalized > 0.35;
  const fillColor = isHighlighted
    ? `rgba(255, 128, 100, ${alpha})`
    : `rgba(243, 98, 70, ${alpha * 0.85})`;

  return { x, y, width: barWidth, height: barHeight, alpha, isHighlighted, fillColor };
}

export function parseTranscriptionResponse(
  status: number,
  isOk: boolean,
  data: unknown,
): { text: string; errorState: AudioErrorState | null } {
  if (!isOk) {
    const errorMsg =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) || `Transcription failed (${status})`;
    return {
      text: '',
      errorState: {
        type: 'transcription-failed',
        title: 'Transcription Failed',
        message: errorMsg,
        suggestion: 'Server speech synthesis or Whisper sidecar may be offline. Your live text was preserved.',
        actionLabel: 'Retry',
      },
    };
  }

  const whisperText =
    (data && typeof data === 'object' && 'text' in data && typeof (data as { text: unknown }).text === 'string'
      ? (data as { text: string }).text
      : '') || '';

  return { text: whisperText.trim(), errorState: null };
}

export interface AudioBadgeState {
  tone: 'danger' | 'warn' | 'success' | 'accent' | 'neutral';
  label: string;
  animatePulse?: boolean;
}

export function getAudioBadgeState(options: {
  audioError: AudioErrorState | null;
  isTranscribing: boolean;
  isRecording: boolean;
  hasSoundDetected: boolean;
  hasText: boolean;
}): AudioBadgeState {
  if (options.audioError) {
    return { tone: 'danger', label: options.audioError.title };
  }
  if (options.isTranscribing) {
    return { tone: 'warn', label: 'Transcribing…', animatePulse: true };
  }
  if (options.isRecording) {
    if (options.hasSoundDetected) {
      return { tone: 'success', label: 'Sound Detected', animatePulse: true };
    }
    return { tone: 'accent', label: 'Listening…' };
  }
  if (options.hasText) {
    return { tone: 'neutral', label: 'Ready' };
  }
  return { tone: 'neutral', label: 'Paused' };
}

export function getAudioPlaceholderText(options: {
  audioError: AudioErrorState | null;
  isRecording: boolean;
}): string {
  if (options.audioError) {
    return 'Microphone is currently unavailable. Follow the suggestions above to enable recording.';
  }
  if (options.isRecording) {
    return 'Speak clearly into your microphone… text will appear in real time.';
  }
  return 'Microphone is paused. Click the button above to begin speaking.';
}

export function resolveAudioOutputText(transcript: string, interimText: string): string {
  return transcript.trim() || interimText.trim();
}

export function shouldShowMicOffIcon(errorType: AudioErrorType): boolean {
  return (
    errorType === 'permission-denied' ||
    errorType === 'no-microphone' ||
    errorType === 'disconnected'
  );
}
