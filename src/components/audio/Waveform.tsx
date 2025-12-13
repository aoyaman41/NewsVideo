import { useEffect, useMemo, useRef, useState } from 'react';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizePeaks(peaks: number[]): number[] {
  const max = peaks.reduce((acc, v) => Math.max(acc, v), 0);
  if (max <= 0) return peaks.map(() => 0);
  return peaks.map((v) => v / max);
}

async function decodeToPeaks(src: string, points: number): Promise<number[]> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const bytes = await res.arrayBuffer();

  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioContextCtor();
  try {
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    const channel = buffer.getChannelData(0);
    const buckets = Math.max(64, Math.min(points, channel.length));
    const samplesPerBucket = Math.max(1, Math.floor(channel.length / buckets));

    const peaks: number[] = [];
    for (let i = 0; i < buckets; i++) {
      const start = i * samplesPerBucket;
      const end = Math.min(channel.length, start + samplesPerBucket);
      let maxAbs = 0;
      for (let j = start; j < end; j++) {
        const v = Math.abs(channel[j]);
        if (v > maxAbs) maxAbs = v;
      }
      peaks.push(maxAbs);
    }

    return normalizePeaks(peaks);
  } finally {
    await ctx.close().catch(() => {});
  }
}

export function Waveform({
  src,
  currentTimeSec,
  durationSec,
  onSeek,
  height = 72,
}: {
  src: string;
  currentTimeSec: number;
  durationSec: number;
  onSeek?: (timeSec: number) => void;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progressRatio = useMemo(() => {
    if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
    if (!Number.isFinite(currentTimeSec) || currentTimeSec <= 0) return 0;
    return clamp(currentTimeSec / durationSec, 0, 1);
  }, [currentTimeSec, durationSec]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect?.width ?? 0);
      setWidth(next);
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    setError(null);

    void (async () => {
      try {
        const next = await decodeToPeaks(src, 1024);
        if (!cancelled) setPeaks(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!peaks || peaks.length === 0) return;
    if (!Number.isFinite(width) || width <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;
    const step = width / peaks.length;

    const draw = (color: string, maxIndex: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= maxIndex && i < peaks.length; i++) {
        const x = i * step;
        const amp = peaks[i] * (height / 2);
        ctx.moveTo(x, mid - amp);
        ctx.lineTo(x, mid + amp);
      }
      ctx.stroke();
    };

    draw('#d1d5db', peaks.length - 1);
    draw('#3b82f6', Math.floor(progressRatio * peaks.length));
  }, [height, peaks, progressRatio, width]);

  const canSeek = !!onSeek && Number.isFinite(durationSec) && durationSec > 0;

  return (
    <div ref={containerRef} className="w-full">
      <div className="relative">
        <canvas
          ref={canvasRef}
          onClick={(e) => {
            if (!canSeek || !onSeek) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
            onSeek(clamp(ratio, 0, 1) * durationSec);
          }}
          className={`w-full rounded-lg border border-gray-200 bg-white ${
            canSeek ? 'cursor-pointer' : 'cursor-default'
          }`}
          style={{ height }}
        />
        {!peaks && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
            波形を解析中...
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-red-600">
            波形の解析に失敗しました
          </div>
        )}
      </div>
    </div>
  );
}

