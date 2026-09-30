import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioCapture } from './audio-capture';
import type { SpeechRecognitionInstance } from './audio-recognition';

function makeCapture() {
  const capture = new AudioCapture();
  const track = { onended: vi.fn(), stop: vi.fn() };
  const recorder = { state: 'recording', stop: vi.fn(), onstop: vi.fn(), ondataavailable: vi.fn() };
  const recognition = { stop: vi.fn(), abort: vi.fn(), onresult: vi.fn(), onerror: vi.fn(), onend: vi.fn() };
  const context = { close: vi.fn().mockResolvedValue(undefined) };
  capture.stream = { getTracks: () => [track] } as unknown as MediaStream;
  capture.recorder = recorder as unknown as MediaRecorder;
  capture.recognition = recognition as unknown as SpeechRecognitionInstance;
  capture.context = context as unknown as AudioContext;
  return { capture, track, recorder, recognition, context };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AudioCapture', () => {
  it('discards callbacks and invalidates pending work when the dialog closes', () => {
    vi.useFakeTimers();
    const cancelFrame = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const { capture, track, recorder, recognition, context } = makeCapture();
    const generation = capture.begin();
    const tick = vi.fn();
    capture.timer = setInterval(tick, 1000);
    capture.animationFrame = 0;

    capture.release('discard');
    capture.release('discard'); // Closing twice is harmless.
    vi.advanceTimersByTime(2000);

    expect(capture.isCurrent(generation)).toBe(false);
    expect(cancelFrame).toHaveBeenCalledWith(0);
    expect(tick).not.toHaveBeenCalled();
    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(recognition.onresult).toBeNull();
    expect(recorder.onstop).toBeNull();
    expect(recorder.ondataavailable).toBeNull();
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(track.onended).toBeNull();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(capture.stream).toBeNull();
    expect(capture.context).toBeNull();
  });

  it('preserves final transcription callbacks when recording is paused', () => {
    const { capture, recorder, recognition, track } = makeCapture();
    const generation = capture.begin();
    const onstop = recorder.onstop;
    capture.release('transcribe');
    expect(capture.isCurrent(generation)).toBe(true);
    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(recognition.abort).not.toHaveBeenCalled();
    expect(recorder.onstop).toBe(onstop);
    expect(track.stop).toHaveBeenCalledOnce();
    capture.begin();
    expect(capture.isCurrent(generation)).toBe(false);
  });

  it('releases the microphone when stopping the recorder fails', async () => {
    const { capture, track, recorder, context } = makeCapture();
    recorder.stop.mockImplementation(() => { throw new Error('recorder failed'); });
    context.close.mockRejectedValueOnce(new Error('context already closed'));
    expect(() => capture.release('discard')).not.toThrow();
    await Promise.resolve();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(capture.recorder).toBeNull();
  });
});
