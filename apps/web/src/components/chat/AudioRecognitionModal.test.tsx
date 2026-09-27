import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../Modal', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid="modal">{children}</div> : null,
}));

import AudioRecognitionModal, {
  getSpeechRecognitionClass,
  formatDuration,
  blobToBase64,
  getAudioFilename,
  resolveSupportedMimeType,
  resolveActualMimeType,
  filterAudioInputs,
  checkRecordingEnvironment,
  buildAudioConstraints,
  mapAudioError,
  parseSpeechRecognitionResults,
  appendTranscript,
  computeSoundLevel,
  computeVisualizerBar,
  parseTranscriptionResponse,
  getAudioBadgeState,
  getAudioPlaceholderText,
  resolveAudioOutputText,
  shouldShowMicOffIcon,
  type SpeechRecognitionEventLike,
} from './AudioRecognitionModal';

describe('AudioRecognitionModal', () => {
  it('renders nothing when open is false', () => {
    const html = renderToStaticMarkup(
      <AudioRecognitionModal
        open={false}
        onClose={vi.fn()}
        onSend={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    expect(html).toBe('');
  });

  it('renders modern sound recognition modal when open is true', () => {
    const html = renderToStaticMarkup(
      <AudioRecognitionModal
        open={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        onInsert={vi.fn()}
      />,
    );

    // Header elements
    expect(html).toContain('Sound Recognition');
    expect(html).toContain('Real-time voice &amp; speech detection');

    // Visualizer canvas and mic hero section
    expect(html).toContain('<canvas');
    expect(html).toContain('title="Start recording"');

    // Recognition output container
    expect(html).toContain('Recognized Speech');

    // Action buttons
    expect(html).toContain('Cancel');
    expect(html).toContain('Insert in Input');
    expect(html).toContain('Send to Chat');
  });

  it('disables send and insert buttons when there is no recognized text', () => {
    const html = renderToStaticMarkup(
      <AudioRecognitionModal
        open={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        onInsert={vi.fn()}
        streaming={false}
      />,
    );

    expect(html).toContain('disabled=""');
  });

  it('renders disabled send button when streaming is true', () => {
    const html = renderToStaticMarkup(
      <AudioRecognitionModal
        open={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        onInsert={vi.fn()}
        initialTranscript="Hello"
        streaming={true}
      />,
    );

    expect(html).toContain('disabled=""');
  });

  it('renders close button with accessibility labels', () => {
    const html = renderToStaticMarkup(
      <AudioRecognitionModal
        open={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        onInsert={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Close dialog"');
    expect(html).toContain('title="Close (Esc)"');
  });

  describe('Microphone and Hardware Error Scenarios', () => {
    it('renders permission-blocked diagnostic card when permission is denied', () => {
      const html = renderToStaticMarkup(
        <AudioRecognitionModal
          open={true}
          onClose={vi.fn()}
          onSend={vi.fn()}
          onInsert={vi.fn()}
          initialError={{
            type: 'permission-denied',
            title: 'Microphone Permission Blocked',
            message: 'Microphone access was denied in your browser settings.',
            suggestion: 'Click the lock or settings icon in your browser address bar to allow microphone access, then click Try Again.',
            actionLabel: 'Try Again',
          }}
        />,
      );

      expect(html).toContain('Microphone Permission Blocked');
      expect(html).toContain('Microphone access was denied in your browser settings.');
      expect(html).toContain('Click the lock or settings icon in your browser address bar');
      expect(html).toContain('Try Again');
      expect(html).not.toContain('<canvas');
    });

    it('renders no-microphone diagnostic card when no audio input device is found', () => {
      const html = renderToStaticMarkup(
        <AudioRecognitionModal
          open={true}
          onClose={vi.fn()}
          onSend={vi.fn()}
          onInsert={vi.fn()}
          initialError={{
            type: 'no-microphone',
            title: 'No Microphone Detected',
            message: 'We could not find any connected microphone or audio input hardware.',
            suggestion: 'Please plug in or connect a microphone, headset, or webcam and click Check Devices.',
            actionLabel: 'Check Devices',
          }}
        />,
      );

      expect(html).toContain('No Microphone Detected');
      expect(html).toContain('We could not find any connected microphone');
      expect(html).toContain('Check Devices');
    });

    it('renders device-busy diagnostic card when microphone is locked by another app', () => {
      const html = renderToStaticMarkup(
        <AudioRecognitionModal
          open={true}
          onClose={vi.fn()}
          onSend={vi.fn()}
          onInsert={vi.fn()}
          initialError={{
            type: 'device-busy',
            title: 'Microphone In Use',
            message: 'Your microphone is currently in use by another application or locked by the system.',
            suggestion: 'Please close other applications using audio and try again.',
            actionLabel: 'Retry Connection',
          }}
        />,
      );

      expect(html).toContain('Microphone In Use');
      expect(html).toContain('Your microphone is currently in use by another application');
      expect(html).toContain('Retry Connection');
    });

    it('renders disconnected diagnostic card when device is unplugged mid-session', () => {
      const html = renderToStaticMarkup(
        <AudioRecognitionModal
          open={true}
          onClose={vi.fn()}
          onSend={vi.fn()}
          onInsert={vi.fn()}
          initialError={{
            type: 'disconnected',
            title: 'Microphone Disconnected',
            message: 'The active microphone was unplugged or disconnected.',
            suggestion: 'Reconnect your audio device to continue. Any recognized text was preserved.',
            actionLabel: 'Reconnect',
          }}
        />,
      );

      expect(html).toContain('Microphone Disconnected');
      expect(html).toContain('The active microphone was unplugged or disconnected');
      expect(html).toContain('Reconnect');
    });

    it('preserves recognized transcript and enables Send button even when an error occurs', () => {
      const html = renderToStaticMarkup(
        <AudioRecognitionModal
          open={true}
          onClose={vi.fn()}
          onSend={vi.fn()}
          onInsert={vi.fn()}
          initialTranscript="Create a task for tomorrow morning"
          initialError={{
            type: 'disconnected',
            title: 'Microphone Disconnected',
            message: 'Device unplugged',
            suggestion: 'Reconnect device',
            actionLabel: 'Reconnect',
          }}
        />,
      );

      expect(html).toContain('Create a task for tomorrow morning');
      expect(html).toContain('Send to Chat');
      expect(html).toContain('Insert in Input');
      // Send button should NOT be disabled when text exists
      expect(html).not.toContain('disabled=""');
    });
  });

  describe('Rendering State Variations', () => {
    it('renders general error with alert icon and custom action label', () => {
      const html = renderToStaticMarkup(
        <AudioRecognitionModal
          open={true}
          onClose={vi.fn()}
          onSend={vi.fn()}
          onInsert={vi.fn()}
          initialError={{
            type: 'general',
            title: 'Audio Initialization Failed',
            message: 'An unexpected error occurred',
            suggestion: 'Please reload your browser',
            actionLabel: 'Reload',
          }}
        />,
      );

      expect(html).toContain('Audio Initialization Failed');
      expect(html).toContain('An unexpected error occurred');
      expect(html).toContain('Reload');
    });

    it('renders ready state badge and char count when text is present', () => {
      const html = renderToStaticMarkup(
        <AudioRecognitionModal
          open={true}
          onClose={vi.fn()}
          onSend={vi.fn()}
          onInsert={vi.fn()}
          initialTranscript="Testing transcript character count"
        />,
      );

      expect(html).toContain('Ready');
      expect(html).toContain('34 chars');
      expect(html).toContain('Copy');
      expect(html).toContain('Reset');
    });
  });

  describe('Audio Helpers & Branch Logic', () => {
    describe('getSpeechRecognitionClass', () => {
      it('returns null when window or target is undefined', () => {
        expect(getSpeechRecognitionClass(undefined)).toBeNull();
      });

      it('returns SpeechRecognition constructor if present', () => {
        class MockSR {}
        expect(getSpeechRecognitionClass({ SpeechRecognition: MockSR })).toBe(MockSR);
      });

      it('returns webkitSpeechRecognition constructor if present', () => {
        class MockWSR {}
        expect(getSpeechRecognitionClass({ webkitSpeechRecognition: MockWSR })).toBe(MockWSR);
      });

      it('returns null when neither is present on the object', () => {
        expect(getSpeechRecognitionClass({})).toBeNull();
      });
    });

    describe('formatDuration', () => {
      it('formats zero seconds as 00:00', () => {
        expect(formatDuration(0)).toBe('00:00');
      });

      it('formats single-digit seconds with leading zero', () => {
        expect(formatDuration(7)).toBe('00:07');
      });

      it('formats minutes and seconds accurately', () => {
        expect(formatDuration(65)).toBe('01:05');
        expect(formatDuration(599)).toBe('09:59');
        expect(formatDuration(3600)).toBe('60:00');
      });

      it('handles negative inputs safely', () => {
        expect(formatDuration(-10)).toBe('00:00');
      });
    });

    describe('blobToBase64', () => {
      it('extracts base64 string from data URL with comma', async () => {
        class MockFileReader {
          onloadend: (() => void) | null = null;
          onerror: ((err: unknown) => void) | null = null;
          result: string | null = null;
          readAsDataURL() {
            setTimeout(() => {
              this.result = 'data:audio/webm;base64,QUJDREVGR0g=';
              this.onloadend?.();
            }, 0);
          }
        }
        const origFileReader = globalThis.FileReader;
        // @ts-expect-error test mock
        globalThis.FileReader = MockFileReader;

        try {
          const blob = new Blob(['dummy'], { type: 'audio/webm' });
          const result = await blobToBase64(blob);
          expect(result).toBe('QUJDREVGR0g=');
        } finally {
          globalThis.FileReader = origFileReader;
        }
      });

      it('returns raw result when no comma exists', async () => {
        class MockFileReaderNoComma {
          onloadend: (() => void) | null = null;
          onerror: ((err: unknown) => void) | null = null;
          result: string | null = null;
          readAsDataURL() {
            setTimeout(() => {
              this.result = 'RAW_BASE64_PAYLOAD';
              this.onloadend?.();
            }, 0);
          }
        }
        const origFileReader = globalThis.FileReader;
        // @ts-expect-error test mock
        globalThis.FileReader = MockFileReaderNoComma;

        try {
          const blob = new Blob(['dummy'], { type: 'audio/webm' });
          const result = await blobToBase64(blob);
          expect(result).toBe('RAW_BASE64_PAYLOAD');
        } finally {
          globalThis.FileReader = origFileReader;
        }
      });

      it('rejects on FileReader error', async () => {
        class MockFileReaderError {
          onloadend: (() => void) | null = null;
          onerror: ((err: unknown) => void) | null = null;
          result: string | null = null;
          readAsDataURL() {
            setTimeout(() => {
              this.onerror?.(new Error('FileReader aborted'));
            }, 0);
          }
        }
        const origFileReader = globalThis.FileReader;
        // @ts-expect-error test mock
        globalThis.FileReader = MockFileReaderError;

        try {
          const blob = new Blob(['dummy'], { type: 'audio/webm' });
          await expect(blobToBase64(blob)).rejects.toThrow('FileReader aborted');
        } finally {
          globalThis.FileReader = origFileReader;
        }
      });
    });

    describe('getAudioFilename', () => {
      it('returns recording.mp4 for mp4 audio', () => {
        expect(getAudioFilename('audio/mp4')).toBe('recording.mp4');
      });

      it('returns recording.ogg for ogg audio', () => {
        expect(getAudioFilename('audio/ogg;codecs=opus')).toBe('recording.ogg');
      });

      it('defaults to recording.webm for webm or other formats', () => {
        expect(getAudioFilename('audio/webm')).toBe('recording.webm');
        expect(getAudioFilename('audio/wav')).toBe('recording.webm');
      });
    });

    describe('resolveSupportedMimeType', () => {
      it('returns empty string when isTypeSupported is undefined', () => {
        expect(resolveSupportedMimeType(undefined)).toBe('');
      });

      it('prefers audio/webm;codecs=opus if supported', () => {
        const check = (mime: string) => mime === 'audio/webm;codecs=opus' || mime === 'audio/webm';
        expect(resolveSupportedMimeType(check)).toBe('audio/webm;codecs=opus');
      });

      it('falls back to audio/webm when opus is not supported', () => {
        const check = (mime: string) => mime === 'audio/webm';
        expect(resolveSupportedMimeType(check)).toBe('audio/webm');
      });

      it('falls back to audio/mp4 if webm is unsupported', () => {
        const check = (mime: string) => mime === 'audio/mp4';
        expect(resolveSupportedMimeType(check)).toBe('audio/mp4');
      });

      it('falls back to audio/ogg if webm and mp4 are unsupported', () => {
        const check = (mime: string) => mime === 'audio/ogg';
        expect(resolveSupportedMimeType(check)).toBe('audio/ogg');
      });

      it('returns empty string if none are supported', () => {
        expect(resolveSupportedMimeType(() => false)).toBe('');
      });
    });

    describe('resolveActualMimeType', () => {
      it('uses recorder mime type when present', () => {
        expect(resolveActualMimeType('audio/webm;codecs=opus', 'audio/webm')).toBe('audio/webm;codecs=opus');
      });

      it('falls back to fallback mime type when recorder mime is empty', () => {
        expect(resolveActualMimeType('', 'audio/mp4')).toBe('audio/mp4');
      });

      it('defaults to audio/webm when neither is provided', () => {
        expect(resolveActualMimeType(undefined, undefined)).toBe('audio/webm');
      });
    });

    describe('filterAudioInputs', () => {
      it('filters out non-audioinput devices', () => {
        const devices = [
          { kind: 'audioinput', label: 'Mic 1' },
          { kind: 'videoinput', label: 'Cam 1' },
          { kind: 'audiooutput', label: 'Speaker 1' },
          { kind: 'audioinput', label: 'Mic 2' },
        ];
        const filtered = filterAudioInputs(devices);
        expect(filtered).toHaveLength(2);
        expect(filtered.every((d) => d.kind === 'audioinput')).toBe(true);
      });

      it('returns empty array when no audio input devices exist', () => {
        expect(filterAudioInputs([])).toEqual([]);
        expect(filterAudioInputs([{ kind: 'videoinput' }])).toEqual([]);
      });
    });

    describe('checkRecordingEnvironment', () => {
      it('returns insecure-context error on insecure non-localhost origins', () => {
        const err = checkRecordingEnvironment({
          isSecureContext: false,
          hostname: 'example.com',
          hasMediaDevices: true,
          hasGetUserMedia: true,
        });
        expect(err?.type).toBe('insecure-context');
        expect(err?.title).toBe('HTTPS Required');
      });

      it('allows insecure context on localhost and 127.0.0.1', () => {
        expect(
          checkRecordingEnvironment({
            isSecureContext: false,
            hostname: 'localhost',
            hasMediaDevices: true,
            hasGetUserMedia: true,
          }),
        ).toBeNull();

        expect(
          checkRecordingEnvironment({
            isSecureContext: false,
            hostname: '127.0.0.1',
            hasMediaDevices: true,
            hasGetUserMedia: true,
          }),
        ).toBeNull();
      });

      it('returns unsupported when mediaDevices or getUserMedia is missing', () => {
        const noMedia = checkRecordingEnvironment({
          isSecureContext: true,
          hostname: 'app.example.com',
          hasMediaDevices: false,
          hasGetUserMedia: true,
        });
        expect(noMedia?.type).toBe('unsupported');

        const noGUM = checkRecordingEnvironment({
          isSecureContext: true,
          hostname: 'app.example.com',
          hasMediaDevices: true,
          hasGetUserMedia: false,
        });
        expect(noGUM?.type).toBe('unsupported');
      });

      it('returns null in a fully supported secure environment', () => {
        expect(
          checkRecordingEnvironment({
            isSecureContext: true,
            hostname: 'app.example.com',
            hasMediaDevices: true,
            hasGetUserMedia: true,
          }),
        ).toBeNull();
      });
    });

    describe('buildAudioConstraints', () => {
      it('returns minimal constraints on forceRetryFallback', () => {
        expect(buildAudioConstraints(true)).toEqual({ audio: true });
      });

      it('returns advanced constraints with echo cancellation by default', () => {
        expect(buildAudioConstraints(false)).toEqual({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      });
    });

    describe('mapAudioError', () => {
      it('maps NotAllowedError, PermissionDeniedError, and SecurityError to permission-denied', () => {
        for (const name of ['NotAllowedError', 'PermissionDeniedError', 'SecurityError']) {
          const domErr = new DOMException('Denied', name);
          const res = mapAudioError(domErr);
          expect(res.errorState?.type).toBe('permission-denied');
          expect(res.retryFallback).toBe(false);
        }
      });

      it('maps NotFoundError and DevicesNotFoundError to no-microphone', () => {
        for (const name of ['NotFoundError', 'DevicesNotFoundError']) {
          const domErr = new DOMException('Not found', name);
          const res = mapAudioError(domErr);
          expect(res.errorState?.type).toBe('no-microphone');
          expect(res.retryFallback).toBe(false);
        }
      });

      it('maps NotReadableError and TrackStartError to device-busy', () => {
        for (const name of ['NotReadableError', 'TrackStartError']) {
          const domErr = new DOMException('Locked', name);
          const res = mapAudioError(domErr);
          expect(res.errorState?.type).toBe('device-busy');
          expect(res.retryFallback).toBe(false);
        }
      });

      it('requests retry fallback on OverconstrainedError when fallback is not active', () => {
        const domErr = new DOMException('Too strict', 'OverconstrainedError');
        const res = mapAudioError(domErr, false);
        expect(res.retryFallback).toBe(true);
        expect(res.errorState).toBeNull();
      });

      it('falls back to general error on OverconstrainedError when already on fallback', () => {
        const domErr = new DOMException('Too strict', 'OverconstrainedError');
        const res = mapAudioError(domErr, true);
        expect(res.retryFallback).toBe(false);
        expect(res.errorState?.type).toBe('general');
      });

      it('maps standard Error and string errors to general error', () => {
        const err = new Error('Audio pipe failed');
        const res = mapAudioError(err);
        expect(res.errorState?.type).toBe('general');
        expect(res.errorState?.message).toBe('Audio pipe failed');

        const strRes = mapAudioError('Unknown audio fault');
        expect(strRes.errorState?.type).toBe('general');
        expect(strRes.errorState?.message).toBe('Unknown audio fault');
      });
    });

    describe('parseSpeechRecognitionResults', () => {
      it('correctly partitions final and interim results', () => {
        const mockEvent: SpeechRecognitionEventLike = {
          resultIndex: 0,
          results: {
            length: 2,
            0: { isFinal: true, 0: { transcript: 'Hello ' } },
            1: { isFinal: false, 0: { transcript: 'world' } },
          },
        };

        const { newFinal, interim } = parseSpeechRecognitionResults(mockEvent);
        expect(newFinal).toBe('Hello ');
        expect(interim).toBe('world');
      });

      it('skips items before resultIndex', () => {
        const mockEvent: SpeechRecognitionEventLike = {
          resultIndex: 1,
          results: {
            length: 2,
            0: { isFinal: true, 0: { transcript: 'Skipped' } },
            1: { isFinal: true, 0: { transcript: 'New text' } },
          },
        };

        const { newFinal, interim } = parseSpeechRecognitionResults(mockEvent);
        expect(newFinal).toBe('New text');
        expect(interim).toBe('');
      });
    });

    describe('appendTranscript', () => {
      it('returns prev unchanged if addition is empty', () => {
        expect(appendTranscript('Hello', '')).toBe('Hello');
        expect(appendTranscript('Hello', '   ')).toBe('Hello');
      });

      it('returns trimmed addition when prev is empty', () => {
        expect(appendTranscript('', 'Hello')).toBe('Hello');
        expect(appendTranscript('   ', 'Hello')).toBe('Hello');
      });

      it('concatenates prev and addition with a space', () => {
        expect(appendTranscript('Hello', 'world')).toBe('Hello world');
        expect(appendTranscript('  Hello  ', '  world  ')).toBe('Hello world');
      });
    });

    describe('computeSoundLevel', () => {
      it('calculates low level for silence and detects no sound', () => {
        const data = new Uint8Array(32).fill(0);
        const { smoothedLevel, hasSoundDetected } = computeSoundLevel(data, 32, 0);
        expect(smoothedLevel).toBe(0);
        expect(hasSoundDetected).toBe(false);
      });

      it('detects sound above 0.07 threshold on loud input', () => {
        const data = new Uint8Array(32).fill(255);
        const { smoothedLevel, hasSoundDetected } = computeSoundLevel(data, 32, 0);
        expect(smoothedLevel).toBeCloseTo(0.3, 2);
        expect(hasSoundDetected).toBe(true);
      });
    });

    describe('computeVisualizerBar', () => {
      it('computes dimensions and standard styling for low volume values', () => {
        const data = new Uint8Array(64).fill(20);
        const bar = computeVisualizerBar({
          index: 0,
          barCount: 36,
          dataArray: data,
          bufferLength: 64,
          width: 380,
          height: 56,
        });

        expect(bar.width).toBe(4);
        expect(bar.isHighlighted).toBe(false);
        expect(bar.fillColor).toContain('243, 98, 70');
        expect(bar.x).toBe(0);
        expect(bar.height).toBeGreaterThanOrEqual(4);
      });

      it('computes highlighted styling for high volume values', () => {
        const data = new Uint8Array(64).fill(200);
        const bar = computeVisualizerBar({
          index: 5,
          barCount: 36,
          dataArray: data,
          bufferLength: 64,
          width: 380,
          height: 56,
        });

        expect(bar.isHighlighted).toBe(true);
        expect(bar.fillColor).toContain('255, 128, 100');
        expect(bar.x).toBeGreaterThan(0);
      });
    });

    describe('parseTranscriptionResponse', () => {
      it('extracts server text on successful response', () => {
        const res = parseTranscriptionResponse(200, true, { text: '  Recognized speech  ' });
        expect(res.text).toBe('Recognized speech');
        expect(res.errorState).toBeNull();
      });

      it('handles successful response without text field gracefully', () => {
        const res = parseTranscriptionResponse(200, true, {});
        expect(res.text).toBe('');
        expect(res.errorState).toBeNull();
      });

      it('returns errorState with error message on failed response', () => {
        const res = parseTranscriptionResponse(500, false, { error: 'Whisper sidecar crashed' });
        expect(res.text).toBe('');
        expect(res.errorState?.type).toBe('transcription-failed');
        expect(res.errorState?.message).toBe('Whisper sidecar crashed');
      });

      it('falls back to status code message when error payload is empty', () => {
        const res = parseTranscriptionResponse(503, false, null);
        expect(res.errorState?.message).toBe('Transcription failed (503)');
      });
    });

    describe('getAudioBadgeState', () => {
      it('returns danger badge when audioError is present', () => {
        const badge = getAudioBadgeState({
          audioError: {
            type: 'no-microphone',
            title: 'No Mic',
            message: '',
            suggestion: '',
          },
          isTranscribing: false,
          isRecording: false,
          hasSoundDetected: false,
          hasText: false,
        });
        expect(badge.tone).toBe('danger');
        expect(badge.label).toBe('No Mic');
      });

      it('returns warn badge when isTranscribing is true', () => {
        const badge = getAudioBadgeState({
          audioError: null,
          isTranscribing: true,
          isRecording: false,
          hasSoundDetected: false,
          hasText: false,
        });
        expect(badge.tone).toBe('warn');
        expect(badge.label).toBe('Transcribing…');
        expect(badge.animatePulse).toBe(true);
      });

      it('returns success badge when recording and sound is detected', () => {
        const badge = getAudioBadgeState({
          audioError: null,
          isTranscribing: false,
          isRecording: true,
          hasSoundDetected: true,
          hasText: false,
        });
        expect(badge.tone).toBe('success');
        expect(badge.label).toBe('Sound Detected');
        expect(badge.animatePulse).toBe(true);
      });

      it('returns accent badge when recording without sound detected', () => {
        const badge = getAudioBadgeState({
          audioError: null,
          isTranscribing: false,
          isRecording: true,
          hasSoundDetected: false,
          hasText: false,
        });
        expect(badge.tone).toBe('accent');
        expect(badge.label).toBe('Listening…');
      });

      it('returns Ready badge when not recording and text exists', () => {
        const badge = getAudioBadgeState({
          audioError: null,
          isTranscribing: false,
          isRecording: false,
          hasSoundDetected: false,
          hasText: true,
        });
        expect(badge.tone).toBe('neutral');
        expect(badge.label).toBe('Ready');
      });

      it('returns Paused badge when idle and no text exists', () => {
        const badge = getAudioBadgeState({
          audioError: null,
          isTranscribing: false,
          isRecording: false,
          hasSoundDetected: false,
          hasText: false,
        });
        expect(badge.tone).toBe('neutral');
        expect(badge.label).toBe('Paused');
      });
    });

    describe('getAudioPlaceholderText', () => {
      it('returns error instructions when audioError exists', () => {
        const text = getAudioPlaceholderText({
          audioError: {
            type: 'disconnected',
            title: '',
            message: '',
            suggestion: '',
          },
          isRecording: false,
        });
        expect(text).toContain('Microphone is currently unavailable');
      });

      it('returns speaking prompt when recording', () => {
        const text = getAudioPlaceholderText({
          audioError: null,
          isRecording: true,
        });
        expect(text).toContain('Speak clearly into your microphone');
      });

      it('returns paused prompt when idle', () => {
        const text = getAudioPlaceholderText({
          audioError: null,
          isRecording: false,
        });
        expect(text).toContain('Microphone is paused');
      });
    });

    describe('resolveAudioOutputText', () => {
      it('prefers trimmed transcript when available', () => {
        expect(resolveAudioOutputText('  Recognized text  ', 'interim')).toBe('Recognized text');
      });

      it('falls back to trimmed interimText when transcript is empty', () => {
        expect(resolveAudioOutputText('', '  Interim text  ')).toBe('Interim text');
      });

      it('returns empty string when both are whitespace or empty', () => {
        expect(resolveAudioOutputText('   ', '')).toBe('');
      });
    });

    describe('shouldShowMicOffIcon', () => {
      it('returns true for hardware and permission disconnections', () => {
        expect(shouldShowMicOffIcon('permission-denied')).toBe(true);
        expect(shouldShowMicOffIcon('no-microphone')).toBe(true);
        expect(shouldShowMicOffIcon('disconnected')).toBe(true);
      });

      it('returns false for generic errors and busy states', () => {
        expect(shouldShowMicOffIcon('device-busy')).toBe(false);
        expect(shouldShowMicOffIcon('insecure-context')).toBe(false);
        expect(shouldShowMicOffIcon('unsupported')).toBe(false);
        expect(shouldShowMicOffIcon('transcription-failed')).toBe(false);
        expect(shouldShowMicOffIcon('general')).toBe(false);
      });
    });
  });
});
