import React, { useEffect, useRef, useState } from 'react';
import { TunnelStatus } from '../types';

interface TelemetrySplineProps {
  downHistory: number[];
  upHistory: number[];
  downSpeed: number;
  upSpeed: number;
  totalGB: number;
  effectivePing: number;
  status: TunnelStatus;
  lightMode: boolean;
  onTriggerBurst: () => void;
}

export const TelemetrySpline: React.FC<TelemetrySplineProps> = ({
  downHistory,
  upHistory,
  downSpeed,
  upSpeed,
  totalGB,
  effectivePing,
  status,
  lightMode,
  onTriggerBurst
}) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(200, Math.floor(rect.width));
    const h = Math.max(70, Math.floor(rect.height));
    const targetW = w * dpr;
    const targetH = h * dpr;
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const rootStyles = getComputedStyle(document.documentElement);
    const primaryColor = rootStyles.getPropertyValue('--primary').trim() || '#38bdf8';
    const successColor = rootStyles.getPropertyValue('--success').trim() || '#22c55e';

    ctx.clearRect(0, 0, w, h);
    const maxVal = Math.max(35, ...downHistory, ...upHistory) * 1.18;

    ctx.strokeStyle = lightMode ? 'rgba(15, 23, 42, 0.05)' : 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    [0.33, 0.66].forEach((r) => {
      const y = Math.round(h * r) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    const drawSeries = (arr: number[], color: string, topAlpha: number) => {
      const pts = arr.map((v, idx) => ({
        x: (idx / Math.max(1, arr.length - 1)) * w,
        y: h - 7 - (v / maxVal) * (h - 18)
      }));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) * 0.5;
        const yc = (pts[i].y + pts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.1;
      ctx.stroke();

      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.globalAlpha = topAlpha;
      ctx.fill();
      ctx.restore();
      return pts;
    };

    const downPts = drawSeries(downHistory, successColor, 0.24);
    const upPts = drawSeries(upHistory, primaryColor, 0.18);

    if (hoverIdx !== null && downPts[hoverIdx]) {
      const cx = downPts[hoverIdx].x;
      ctx.save();
      ctx.strokeStyle = lightMode ? 'rgba(15, 23, 42, 0.25)' : 'rgba(255, 255, 255, 0.28)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.stroke();
      ctx.setLineDash([]);

      [
        { pt: downPts[hoverIdx], color: successColor },
        { pt: upPts[hoverIdx], color: primaryColor }
      ].forEach((item) => {
        ctx.beginPath();
        ctx.arc(item.pt.x, item.pt.y, 3.8, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      });
      ctx.restore();
    }
  }, [downHistory, upHistory, hoverIdx, lightMode]);

  return (
    <div className="glass-surface spotlight-card rounded-2xl p-4 flex flex-col gap-3">
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-5">
          <div>
            <div className="text-[11.5px] font-medium tracking-wide text-[var(--muted-foreground)] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--success)', boxShadow: '0 0 6px var(--success)' }} />
              实时下行 · Download
            </div>
            <div className="font-mono tabular-nums text-[20px] leading-tight font-semibold tracking-tight mt-1">
              {downSpeed.toFixed(1)}
              <span className="text-xs font-medium text-[var(--muted-foreground)] ml-1">MB/s</span>
            </div>
          </div>
          <div className="h-8 w-px bg-[var(--border)]" />
          <div>
            <div className="text-[11.5px] font-medium tracking-wide text-[var(--muted-foreground)] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--primary)', boxShadow: '0 0 6px var(--primary)' }} />
              实时上行 · Upload
            </div>
            <div className="font-mono tabular-nums text-[20px] leading-tight font-semibold tracking-tight mt-1">
              {upSpeed.toFixed(1)}
              <span className="text-xs font-medium text-[var(--muted-foreground)] ml-1">MB/s</span>
            </div>
          </div>
          <div className="hidden sm:block h-8 w-px bg-[var(--border)]" />
          <div className="hidden sm:block">
            <div className="text-[11.5px] font-medium tracking-wide text-[var(--muted-foreground)]">隧道延迟 / 抖动</div>
            <div className="font-mono tabular-nums text-[20px] leading-tight font-semibold tracking-tight mt-1">
              {status === 'connected' ? (
                <>
                  {effectivePing}
                  <span className="text-xs font-medium text-[var(--muted-foreground)] ml-1">ms · ±1.2 ms</span>
                </>
              ) : (
                <>
                  --<span className="text-xs font-medium text-[var(--muted-foreground)] ml-1">ms</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-xs font-mono tabular-nums text-[var(--muted-foreground)]">
            会话流量: <span className="text-[var(--foreground)] font-medium">{totalGB.toFixed(2)} GB</span>
          </span>
          <button
            type="button"
            onClick={onTriggerBurst}
            className="px-3 py-1.5 rounded-xl text-[12.5px] font-medium glass-well hover:opacity-90 transition cursor-pointer"
          >
            峰值带宽测试
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          setHoverIdx(Math.round(ratio * (downHistory.length - 1)));
        }}
        onPointerLeave={() => setHoverIdx(null)}
        className="relative z-10 h-28 w-full rounded-xl glass-well overflow-hidden cursor-crosshair"
      >
        <canvas ref={canvasRef} className="block w-full h-full" />
        {hoverIdx !== null && (
          <div className="pointer-events-none absolute top-2 left-3 glass-hud px-2.5 py-1 rounded-lg text-xs font-mono tabular-nums">
            ↓ {downHistory[hoverIdx].toFixed(1)} MB/s · ↑ {upHistory[hoverIdx].toFixed(1)} MB/s
          </div>
        )}
      </div>
    </div>
  );
};
