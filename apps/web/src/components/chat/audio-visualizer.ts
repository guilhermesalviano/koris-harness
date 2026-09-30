import { computeSoundLevel, computeVisualizerBar } from './audio-recognition';

export function drawAudioVisualizer(canvas: HTMLCanvasElement, analyser: AnalyserNode, previousLevel: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);
  const level = computeSoundLevel(dataArray, bufferLength, previousLevel);
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const barCount = 36;
  for (let index = 0; index < barCount; index++) {
    const bar = computeVisualizerBar({ index, barCount, dataArray, bufferLength, width, height });
    ctx.fillStyle = bar.fillColor;
    ctx.beginPath();
    ctx.roundRect(bar.x, bar.y, bar.width, bar.height, 2);
    ctx.fill();
  }
  return level;
}
