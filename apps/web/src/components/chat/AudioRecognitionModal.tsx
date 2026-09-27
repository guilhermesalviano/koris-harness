import { useEffect, useRef, useState, useCallback } from 'react';
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

export interface AudioRecognitionModalProps {
  open: boolean;
  onClose: () => void;
  onSend: (text: string) => Promise<void> | void;
  onInsert: (text: string) => void;
  streaming?: boolean;
  initialError?: AudioErrorState | null;
  initialTranscript?: string;
}

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

type SpeechRecognitionInstance = {
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

export default function AudioRecognitionModal({
  open,
  onClose,
  onSend,
  onInsert,
  streaming = false,
  initialError = null,
  initialTranscript = '',
}: AudioRecognitionModalProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState(initialTranscript);
  const [interimText, setInterimText] = useState('');
  const [soundLevel, setSoundLevel] = useState(0);
  const [hasSoundDetected, setHasSoundDetected] = useState(false);
  const [audioError, setAudioError] = useState<AudioErrorState | null>(initialError);
  const [copied, setCopied] = useState(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const soundLevelSmoothedRef = useRef(0);
  const isRetryingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const isTranscribingRef = useRef(false);

  const cleanupAudio = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.abort();
      } catch {
        // ignore abort errors
      }
      speechRecognitionRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore stop errors
      }
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close();
      } catch {
        // ignore close errors
      }
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    setSoundLevel(0);
    setHasSoundDetected(false);
  }, []);

  const drawVisualizer = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const { smoothedLevel, hasSoundDetected: detected } = computeSoundLevel(
      dataArray,
      bufferLength,
      soundLevelSmoothedRef.current,
    );
    soundLevelSmoothedRef.current = smoothedLevel;
    setSoundLevel(smoothedLevel);
    setHasSoundDetected(detected);

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const barCount = 36;
    for (let i = 0; i < barCount; i++) {
      const bar = computeVisualizerBar({
        index: i,
        barCount,
        dataArray,
        bufferLength,
        width,
        height,
      });
      ctx.fillStyle = bar.fillColor;
      ctx.beginPath();
      ctx.roundRect(bar.x, bar.y, bar.width, bar.height, 2);
      ctx.fill();
    }

    animationFrameRef.current = requestAnimationFrame(drawVisualizer);
  }, []);

  const handleTranscribe = useCallback(async (blob: Blob, mimeType: string): Promise<string> => {
    isTranscribingRef.current = true;
    setIsTranscribing(true);

    try {
      const base64 = await blobToBase64(blob);
      const filename = getAudioFilename(mimeType);

      const res = await fetch('/api/audio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64, mimeType, filename }),
      });

      const isJson = (res.headers.get('content-type') || '').includes('application/json');
      const data = isJson ? await res.json().catch(() => ({})) : null;

      const parsed = parseTranscriptionResponse(res.status, res.ok, data);
      if (parsed.errorState) {
        console.warn(`[audio] Voice server transcription failed: ${parsed.errorState.message}`);
        setAudioError(parsed.errorState);
        return '';
      }

      console.info(`[audio] Voice server connected at /api/audio/transcribe (transcribed ${parsed.text.length} characters)`);
      return parsed.text;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Transcription request failed';
      console.warn(`[audio] Voice server network error: ${errorMsg}`);
      setAudioError({
        type: 'transcription-failed',
        title: 'Transcription Network Error',
        message: errorMsg,
        suggestion: 'Could not connect to the transcription service. Check your connection or sidecar status.',
        actionLabel: 'Retry',
      });
      return '';
    } finally {
      isTranscribingRef.current = false;
      setIsTranscribing(false);
    }
  }, []);

  const handleTrackEnded = useCallback(() => {
    cleanupAudio();
    setAudioError({
      type: 'disconnected',
      title: 'Microphone Disconnected',
      message: 'The active microphone was unplugged or disconnected.',
      suggestion: 'Reconnect your audio device to continue. Any recognized text was preserved.',
      actionLabel: 'Reconnect',
    });
  }, [cleanupAudio]);

  const startRecording = useCallback(async (forceRetryFallback = false) => {
    if (isRecordingRef.current || isTranscribingRef.current) return;
    setAudioError(null);
    setInterimText('');

    if (typeof window !== 'undefined') {
      const envError = checkRecordingEnvironment({
        isSecureContext: window.isSecureContext,
        hostname: window.location.hostname,
        hasMediaDevices: Boolean(navigator?.mediaDevices),
        hasGetUserMedia: Boolean(navigator?.mediaDevices?.getUserMedia),
      });
      if (envError) {
        setAudioError(envError);
        return;
      }
    }

    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioInputs = filterAudioInputs(devices);
          if (audioInputs.length === 0) {
            setAudioError({
              type: 'no-microphone',
              title: 'No Microphone Detected',
              message: 'We could not find any connected microphone or audio input hardware.',
              suggestion: 'Please plug in or connect a microphone, headset, or webcam and click Check Devices.',
              actionLabel: 'Check Devices',
            });
            return;
          }
        } catch {
          // Device enumeration might be blocked before permission is granted; proceed to getUserMedia
        }
      }

      const constraints = buildAudioConstraints(forceRetryFallback);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = handleTrackEnded;
      }

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        analyserRef.current = analyser;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        animationFrameRef.current = requestAnimationFrame(drawVisualizer);
      }

      const SpeechRec = getSpeechRecognitionClass();
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = navigator.language || 'en-US';

          rec.onresult = (event: unknown) => {
            const ev = event as SpeechRecognitionEventLike;
            const { newFinal, interim } = parseSpeechRecognitionResults(ev);

            if (newFinal) {
              setTranscript((prev) => appendTranscript(prev, newFinal));
            }
            setInterimText(interim);
          };

          rec.onerror = () => {
            // Non-fatal, Whisper provides fallback
          };

          rec.start();
          speechRecognitionRef.current = rec;
        } catch {
          // Speech recognition init failed, fallback to Whisper
        }
      }

      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        mimeType = resolveSupportedMimeType((mime) => MediaRecorder.isTypeSupported(mime));

        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        recorder.onstop = async () => {
          const chunks = audioChunksRef.current;
          audioChunksRef.current = [];
          if (chunks.length === 0) return;

          const actualMime = resolveActualMimeType(recorder.mimeType, mimeType);
          const blob = new Blob(chunks, { type: actualMime });
          if (blob.size === 0) return;

          const serverText = await handleTranscribe(blob, actualMime);

          if (serverText) {
            setTranscript(serverText);
          }
        };

        recorder.start(250);
      }

      isRecordingRef.current = true;
      setIsRecording(true);
      setDuration(0);

      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } catch (err) {
      cleanupAudio();

      const resolution = mapAudioError(err, forceRetryFallback);
      if (resolution.retryFallback) {
        void startRecording(true);
        return;
      }
      if (resolution.errorState) {
        setAudioError(resolution.errorState);
      }
    }
  }, [cleanupAudio, drawVisualizer, handleTrackEnded, handleTranscribe]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {
        // ignore error
      }
      speechRecognitionRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close();
      } catch {
        // ignore close error
      }
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    setSoundLevel(0);
    setHasSoundDetected(false);
    setInterimText('');
  }, []);

  useEffect(() => {
    if (!open) {
      cleanupAudio();
      setTranscript('');
      setInterimText('');
      setDuration(0);
      setAudioError(null);
      return;
    }

    if (!initialError) {
      setAudioError(null);
      void startRecording();
    }

    let permissionStatus: PermissionStatus | null = null;
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status) => {
          permissionStatus = status;
          status.onchange = () => {
            if (status.state === 'granted') {
              setAudioError(null);
              if (!isRecordingRef.current && !isTranscribingRef.current) {
                void startRecording();
              }
            } else if (status.state === 'denied') {
              cleanupAudio();
              setAudioError({
                type: 'permission-denied',
                title: 'Microphone Permission Blocked',
                message: 'Microphone access was denied in your browser settings.',
                suggestion: 'Click the lock or settings icon in your browser address bar to allow microphone access, then click Try Again.',
                actionLabel: 'Try Again',
              });
            }
          };
        })
        .catch(() => {
          // permissions query not supported for microphone in this browser
        });
    }

    const onDeviceChange = () => {
      if (isRetryingRef.current) return;
      isRetryingRef.current = true;
      setTimeout(() => {
        isRetryingRef.current = false;
        if (!isRecordingRef.current && !isTranscribingRef.current) {
          void startRecording();
        }
      }, 350);
    };

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    }

    return () => {
      cleanupAudio();
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      }
    };
  }, [open, initialError, startRecording, cleanupAudio]);

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
