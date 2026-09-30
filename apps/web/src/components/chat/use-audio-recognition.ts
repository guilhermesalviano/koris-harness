import { useEffect, useRef, useState, useCallback } from 'react';
import {
  type AudioErrorState, type SpeechRecognitionEventLike,
  getSpeechRecognitionClass, blobToBase64, getAudioFilename,
  resolveSupportedMimeType, resolveActualMimeType, filterAudioInputs,
  checkRecordingEnvironment, buildAudioConstraints, mapAudioError,
  parseSpeechRecognitionResults, appendTranscript, parseTranscriptionResponse,
} from './audio-recognition';
import { AudioCapture, type CaptureReleaseMode } from './audio-capture';
import { drawAudioVisualizer } from './audio-visualizer';

interface AudioRecognitionOptions {
  open: boolean;
  initialError?: AudioErrorState | null;
  initialTranscript?: string;
}

/** Owns microphone capture and recognition; the modal only renders its state. */
export function useAudioRecognition({
  open, initialError = null, initialTranscript = '',
}: AudioRecognitionOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState(initialTranscript);
  const [interimText, setInterimText] = useState('');
  const [soundLevel, setSoundLevel] = useState(0);
  const [hasSoundDetected, setHasSoundDetected] = useState(false);
  const [audioError, setAudioError] = useState<AudioErrorState | null>(initialError);

  const captureRef = useRef<AudioCapture | null>(null);
  if (!captureRef.current) captureRef.current = new AudioCapture();
  const capture = captureRef.current;
  const isStartingRef = useRef(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const soundLevelSmoothedRef = useRef(0);
  const isRetryingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const isTranscribingRef = useRef(false);

  const releaseAudio = useCallback((mode: CaptureReleaseMode) => {
    capture.release(mode);
    if (mode === 'discard') {
      audioChunksRef.current = [];
      isStartingRef.current = false;
      isTranscribingRef.current = false;
      setIsTranscribing(false);
    }
    isRecordingRef.current = false;
    setIsRecording(false);
    setSoundLevel(0);
    soundLevelSmoothedRef.current = 0;
    setHasSoundDetected(false);
    if (mode === 'transcribe') setInterimText('');
  }, [capture]);

  const cleanupAudio = useCallback(() => releaseAudio('discard'), [releaseAudio]);
  const stopRecording = useCallback(() => releaseAudio('transcribe'), [releaseAudio]);

  const drawVisualizer = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = capture.analyser;
    if (!canvas || !analyser) return;

    const level = drawAudioVisualizer(canvas, analyser, soundLevelSmoothedRef.current);
    if (!level) return;
    soundLevelSmoothedRef.current = level.smoothedLevel;
    setSoundLevel(level.smoothedLevel);
    setHasSoundDetected(level.hasSoundDetected);

    capture.animationFrame = requestAnimationFrame(drawVisualizer);
  }, [capture]);

  const handleTranscribe = useCallback(async (blob: Blob, mimeType: string, generation: number): Promise<string> => {
    isTranscribingRef.current = true;
    setIsTranscribing(true);

    try {
      const base64 = await blobToBase64(blob);
      if (!capture.isCurrent(generation)) return '';
      const filename = getAudioFilename(mimeType);

      const res = await fetch('/api/audio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64, mimeType, filename }),
      });

      const isJson = (res.headers.get('content-type') || '').includes('application/json');
      const data = isJson ? await res.json().catch(() => ({})) : null;

      if (!capture.isCurrent(generation)) return '';
      const parsed = parseTranscriptionResponse(res.status, res.ok, data);
      if (parsed.errorState) {
        console.warn(`[audio] Voice server transcription failed: ${parsed.errorState.message}`);
        setAudioError(parsed.errorState);
        return '';
      }

      console.info(`[audio] Voice server connected at /api/audio/transcribe (transcribed ${parsed.text.length} characters)`);
      return parsed.text;
    } catch (err) {
      if (!capture.isCurrent(generation)) return '';
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
      if (capture.isCurrent(generation)) {
        isTranscribingRef.current = false;
        setIsTranscribing(false);
      }
    }
  }, [capture]);

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
    if (isRecordingRef.current || isTranscribingRef.current || isStartingRef.current) return;
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

    const generation = capture.begin();
    isStartingRef.current = true;
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!capture.isCurrent(generation)) return;
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

      if (!capture.isCurrent(generation)) return;
      const constraints = buildAudioConstraints(forceRetryFallback);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!capture.isCurrent(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      capture.stream = stream;

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = handleTrackEnded;
      }

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        capture.context = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        capture.analyser = analyser;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
          if (!capture.isCurrent(generation)) return;
        }

        capture.animationFrame = requestAnimationFrame(drawVisualizer);
      }

      const SpeechRec = getSpeechRecognitionClass();
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = navigator.language || 'en-US';

          rec.onresult = (event: unknown) => {
            if (!capture.isCurrent(generation)) return;
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
          capture.recognition = rec;
        } catch {
          // Speech recognition init failed, fallback to Whisper
        }
      }

      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        mimeType = resolveSupportedMimeType((mime) => MediaRecorder.isTypeSupported(mime));

        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        capture.recorder = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = (e: BlobEvent) => {
          if (!capture.isCurrent(generation)) return;
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        recorder.onstop = async () => {
          if (!capture.isCurrent(generation)) return;
          const chunks = audioChunksRef.current;
          audioChunksRef.current = [];
          if (chunks.length === 0) return;

          const actualMime = resolveActualMimeType(recorder.mimeType, mimeType);
          const blob = new Blob(chunks, { type: actualMime });
          if (blob.size === 0) return;

          const serverText = await handleTranscribe(blob, actualMime, generation);

          if (serverText && capture.isCurrent(generation)) {
            setTranscript(serverText);
          }
        };

        recorder.start(250);
      }

      isRecordingRef.current = true;
      setIsRecording(true);
      setDuration(0);

      const startTime = Date.now();
      capture.timer = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } catch (err) {
      if (!capture.isCurrent(generation)) return;
      cleanupAudio();
      isStartingRef.current = false;

      const resolution = mapAudioError(err, forceRetryFallback);
      if (resolution.retryFallback) {
        void startRecording(true);
        return;
      }
      if (resolution.errorState) {
        setAudioError(resolution.errorState);
      }
    } finally {
      if (capture.isCurrent(generation)) isStartingRef.current = false;
    }
  }, [capture, cleanupAudio, drawVisualizer, handleTrackEnded, handleTranscribe]);

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

    let active = true;
    let deviceChangeTimer: ReturnType<typeof setTimeout> | null = null;
    let permissionStatus: PermissionStatus | null = null;
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status) => {
          if (!active) return;
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
      deviceChangeTimer = setTimeout(() => {
        deviceChangeTimer = null;
        if (!active) return;
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
      active = false;
      if (deviceChangeTimer !== null) clearTimeout(deviceChangeTimer);
      isRetryingRef.current = false;
      cleanupAudio();
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      }
    };
  }, [open, initialError, startRecording, cleanupAudio]);

  return {
    isRecording, isTranscribing, duration, transcript, interimText,
    soundLevel, hasSoundDetected, audioError, canvasRef,
    startRecording, stopRecording, cleanupAudio,
    setTranscript, setInterimText, setAudioError,
  };
}
