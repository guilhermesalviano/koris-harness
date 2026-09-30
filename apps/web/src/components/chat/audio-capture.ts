import type { SpeechRecognitionInstance } from './audio-recognition';

export type CaptureReleaseMode = 'discard' | 'transcribe';

/** Owns browser capture resources, independent of React's presentation state. */
export class AudioCapture {
  stream: MediaStream | null = null;
  recorder: MediaRecorder | null = null;
  context: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  recognition: SpeechRecognitionInstance | null = null;
  animationFrame: number | null = null;
  timer: ReturnType<typeof setInterval> | number | null = null;

  private generation = 0;

  begin(): number {
    return ++this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  release(mode: CaptureReleaseMode): void {
    if (mode === 'discard') this.generation++;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;

    if (this.recognition) {
      if (mode === 'discard') {
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
      }
      try {
        if (mode === 'transcribe') this.recognition.stop();
        else this.recognition.abort();
      } catch {
        // A browser may already have stopped recognition.
      }
      this.recognition = null;
    }

    if (this.recorder) {
      if (mode === 'discard') {
        this.recorder.onstop = null;
        this.recorder.ondataavailable = null;
      }
      try {
        if (this.recorder.state !== 'inactive') this.recorder.stop();
      } catch {
        // Release the remaining resources even if the recorder has failed.
      }
      this.recorder = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
      this.stream = null;
    }

    if (this.context) {
      try {
        void this.context.close().catch(() => {});
      } catch {
        // Some browsers throw synchronously when the context is closed.
      }
      this.context = null;
    }
    this.analyser = null;
  }
}
