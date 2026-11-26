import React, { useEffect, useRef, useState } from 'react';
import { LAND_DOTS, ORIGIN } from '../data/worldBitmap';
import { MapProjection, TunnelStatus, VpnNode } from '../types';
import { soundEngine } from '../audio/soundEngine';

interface SpatialGlobeProps {
  nodes: VpnNode[];
  activeNode: VpnNode | null;
  entryNode: VpnNode | null;
  multiHop: boolean;
  status: TunnelStatus;
  projection: MapProjection;
  lightMode: boolean;
  onChangeProjection: (p: MapProjection) => void;
  onSelectNode: (id: string) => void;
  onOpenImport: () => void;
  getEffectivePing: (n: VpnNode) => number;
}

export const SpatialGlobe: React.FC<SpatialGlobeProps> = ({
  nodes,
  activeNode,
  entryNode,
  multiHop,
  status,
  projection,
  lightMode,
  onChangeProjection,
  onSelectNode,
  onOpenImport,
  getEffectivePing
}) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tooltip, setTooltip] = useState<{ name: string; meta: string; x: number; y: number } | null>(null);

  const camRef = useRef({
    lon: 128,
    lat: 28,
    targetLon: 130,
    targetLat: 30,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragMoved: false,
    hoveredId: null as string | null,
    phase: 0,
    w: 640,
    h: 380
  });

  // Fly camera to newly selected node
  useEffect(() => {
    if (!activeNode) return;
    const toVec = (lon: number, lat: number) => {
      const l = (lon * Math.PI) / 180;
      const p = (lat * Math.PI) / 180;
      return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
    };
    const vO = toVec(ORIGIN.lon, ORIGIN.lat);
    const vD = toVec(activeNode.lon, activeNode.lat);
    let mx = vO[0] * 0.32 + vD[0] * 0.68;
    let my = vO[1] * 0.32 + vD[1] * 0.68;
    let mz = vO[2] * 0.32 + vD[2] * 0.68;
    const len = Math.hypot(mx, my, mz) || 1;
    mx /= len;
    my /= len;
    mz /= len;
    camRef.current.targetLon = (Math.atan2(mx, mz) * 180) / Math.PI;
    camRef.current.targetLat = Math.max(-42, Math.min(52, (Math.asin(my) * 180) / Math.PI));
  }, [activeNode?.id, activeNode?.lon, activeNode?.lat, projection]);

  const propsRef = useRef({
    nodes,
    activeNode,
    entryNode,
    multiHop,
    status,
    projection,
    lightMode,
    getEffectivePing,
    onSelectNode
  });
  propsRef.current = {
    nodes,
    activeNode,
    entryNode,
    multiHop,
    status,
    projection,
    lightMode,
    getEffectivePing,
    onSelectNode
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 40) {
        const nextW = Math.floor(rect.width);
        const nextH = Math.floor(rect.height);
        const targetPW = nextW * dpr;
        const targetPH = nextH * dpr;
        camRef.current.w = nextW;
        camRef.current.h = nextH;
        if (canvas.width !== targetPW || canvas.height !== targetPH) {
          canvas.width = targetPW;
          canvas.height = targetPH;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const getGlobeParams = () => {
      const { w, h, lon, lat } = camRef.current;
      const cx = w * 0.5;
      const cy = h * 0.51;
      const radius = Math.min(w * 0.42, h * 0.43);
      const lam0 = (lon * Math.PI) / 180;
      const phi0 = (lat * Math.PI) / 180;
      return { cx, cy, radius, lam0, phi0, cosPhi0: Math.cos(phi0), sinPhi0: Math.sin(phi0) };
    };

    const lonLatToCamVec = (lon: number, lat: number, gp: ReturnType<typeof getGlobeParams>) => {
      const lam = (lon * Math.PI) / 180;
      const phi = (lat * Math.PI) / 180;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      const dLam = lam - gp.lam0;
      const x1 = cosPhi * Math.sin(dLam);
      const y1 = sinPhi;
      const z1 = cosPhi * Math.cos(dLam);
      return {
        rx: x1,
        ry: y1 * gp.cosPhi0 - z1 * gp.sinPhi0,
        rz: y1 * gp.sinPhi0 + z1 * gp.cosPhi0
      };
    };

    const projectPoint = (lon: number, lat: number, gp: ReturnType<typeof getGlobeParams>) => {
      const { w, h } = camRef.current;
      if (propsRef.current.projection === 'flat') {
        const padX = w * 0.05;
        const padY = h * 0.09;
        return {
          x: padX + ((lon + 180) / 360) * (w - padX * 2),
          y: padY + ((78 - lat) / 136) * (h - padY * 2),
          visible: true,
          rz: 1
        };
      }
      const v = lonLatToCamVec(lon, lat, gp);
      return {
        x: gp.cx + gp.radius * v.rx,
        y: gp.cy - gp.radius * v.ry,
        visible: v.rz > -0.05,
        rz: v.rz
      };
    };

    const drawRouteArc = (
      lon1: number,
      lat1: number,
      lon2: number,
      lat2: number,
      startColor: string,
      endColor: string,
      isConnected: boolean,
      phaseOffset: number,
      gp: ReturnType<typeof getGlobeParams>
    ) => {
      const phase = camRef.current.phase;
      if (propsRef.current.projection === 'flat') {
        const p1 = projectPoint(lon1, lat1, gp);
        const p2 = projectPoint(lon2, lat2, gp);
        const midX = (p1.x + p2.x) * 0.5;
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const midY = (p1.y + p2.y) * 0.5 - Math.min(100, dist * 0.27);
        const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
        grad.addColorStop(0, startColor);
        grad.addColorStop(1, endColor);
        ctx.save();
        if (isConnected) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.quadraticCurveTo(midX, midY, p2.x, p2.y);
          ctx.strokeStyle = endColor;
          ctx.globalAlpha = 0.18;
          ctx.lineWidth = 6;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.quadraticCurveTo(midX, midY, p2.x, p2.y);
        ctx.strokeStyle = grad;
        ctx.globalAlpha = isConnected ? 0.9 : 0.35;
        ctx.lineWidth = 2;
        if (!isConnected) ctx.setLineDash([4, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (isConnected) {
          for (let k = 0; k < 2; k++) {
            const headT = ((phase * 0.48 + phaseOffset + k * 0.5) % 1 + 1) % 1;
            for (let tail = 0; tail < 5; tail++) {
              const t = Math.max(0, headT - tail * 0.016);
              const bx = (1 - t) * (1 - t) * p1.x + 2 * (1 - t) * t * midX + t * t * p2.x;
              const by = (1 - t) * (1 - t) * p1.y + 2 * (1 - t) * t * midY + t * t * p2.y;
              ctx.beginPath();
              ctx.arc(bx, by, 3.1 - tail * 0.45, 0, Math.PI * 2);
              ctx.fillStyle = tail === 0 ? '#ffffff' : endColor;
              ctx.globalAlpha = 1 - tail * 0.2;
              ctx.fill();
            }
          }
        }
        ctx.restore();
        return;
      }

      const u1 = lonLatToCamVec(lon1, lat1, gp);
      const u2 = lonLatToCamVec(lon2, lat2, gp);
      const dot = Math.max(-1, Math.min(1, u1.rx * u2.rx + u1.ry * u2.ry + u1.rz * u2.rz));
      const omega = Math.acos(dot);
      const sinOmega = Math.sin(omega);
      const loftPeak = 0.09 + 0.16 * (omega / Math.PI);

      const sample3D = (t: number) => {
        let x: number, y: number, z: number;
        if (sinOmega < 0.001) {
          x = u1.rx + (u2.rx - u1.rx) * t;
          y = u1.ry + (u2.ry - u1.ry) * t;
          z = u1.rz + (u2.rz - u1.rz) * t;
        } else {
          const w1 = Math.sin((1 - t) * omega) / sinOmega;
          const w2 = Math.sin(t * omega) / sinOmega;
          x = w1 * u1.rx + w2 * u2.rx;
          y = w1 * u1.ry + w2 * u2.ry;
          z = w1 * u1.rz + w2 * u2.rz;
        }
        const alt = 1 + Math.sin(t * Math.PI) * loftPeak;
        const qx = x * alt;
        const qy = y * alt;
        const qz = z * alt;
        const visible = qz >= 0 || qx * qx + qy * qy >= 1.0;
        return { sx: gp.cx + gp.radius * qx, sy: gp.cy - gp.radius * qy, visible };
      };

      const pts = Array.from({ length: 49 }, (_, s) => sample3D(s / 48));
      const grad = ctx.createLinearGradient(pts[0].sx, pts[0].sy, pts[48].sx, pts[48].sy);
      grad.addColorStop(0, startColor);
      grad.addColorStop(1, endColor);

      ctx.save();
      const passes = isConnected
        ? [
            { width: 6, alpha: 0.18, stroke: endColor as string | CanvasGradient, dashed: false },
            { width: 2.2, alpha: 0.92, stroke: grad as string | CanvasGradient, dashed: false }
          ]
        : [{ width: 1.8, alpha: 0.35, stroke: grad as string | CanvasGradient, dashed: true }];

      passes.forEach((pass) => {
        ctx.beginPath();
        let down = false;
        pts.forEach((pt) => {
          if (!pt.visible) {
            down = false;
            return;
          }
          if (!down) {
            ctx.moveTo(pt.sx, pt.sy);
            down = true;
          } else {
            ctx.lineTo(pt.sx, pt.sy);
          }
        });
        ctx.strokeStyle = pass.stroke;
        ctx.globalAlpha = pass.alpha;
        ctx.lineWidth = pass.width;
        if (pass.dashed) ctx.setLineDash([4, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      if (isConnected) {
        for (let k = 0; k < 2; k++) {
          const headT = ((phase * 0.46 + phaseOffset + k * 0.5) % 1 + 1) % 1;
          for (let tail = 0; tail < 5; tail++) {
            const pt = sample3D(Math.max(0, headT - tail * 0.017));
            if (!pt.visible) continue;
            ctx.beginPath();
            ctx.arc(pt.sx, pt.sy, 3.2 - tail * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = tail === 0 ? '#ffffff' : endColor;
            ctx.globalAlpha = 1 - tail * 0.2;
            ctx.fill();
          }
        }
      }
      ctx.restore();
    };

    let rafId = 0;
    const render = () => {
      camRef.current.phase += 0.02;
      const cam = camRef.current;
      const p = propsRef.current;

      if (!cam.dragging) {
        const dLon = ((cam.targetLon - cam.lon + 540) % 360) - 180;
        cam.lon += dLon * 0.075;
        cam.lat += (cam.targetLat - cam.lat) * 0.075;
      }

      const rootStyles = getComputedStyle(document.documentElement);
      const primaryColor = rootStyles.getPropertyValue('--primary').trim() || '#38bdf8';
      const successColor = rootStyles.getPropertyValue('--success').trim() || '#22c55e';
      const warningColor = rootStyles.getPropertyValue('--warning').trim() || '#f59e0b';
      const light = p.lightMode;

      ctx.clearRect(0, 0, cam.w, cam.h);
      const gp = getGlobeParams();

      if (p.projection === 'globe') {
        const haloGrad = ctx.createRadialGradient(gp.cx, gp.cy, gp.radius * 0.85, gp.cx, gp.cy, gp.radius * 1.18);
        haloGrad.addColorStop(0, light ? 'rgba(2, 132, 199, 0.10)' : 'rgba(56, 189, 248, 0.15)');
        haloGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.arc(gp.cx, gp.cy, gp.radius * 1.18, 0, Math.PI * 2);
        ctx.fill();

        const sphereGrad = ctx.createRadialGradient(
          gp.cx - gp.radius * 0.32,
          gp.cy - gp.radius * 0.32,
          gp.radius * 0.08,
          gp.cx,
          gp.cy,
          gp.radius
        );
        if (light) {
          sphereGrad.addColorStop(0, 'rgba(255, 255, 255, 0.94)');
          sphereGrad.addColorStop(0.7, 'rgba(226, 232, 240, 0.72)');
          sphereGrad.addColorStop(1, 'rgba(203, 213, 225, 0.88)');
        } else {
          sphereGrad.addColorStop(0, 'rgba(30, 41, 59, 0.76)');
          sphereGrad.addColorStop(0.68, 'rgba(15, 23, 42, 0.84)');
          sphereGrad.addColorStop(1, 'rgba(9, 13, 24, 0.96)');
        }
        ctx.fillStyle = sphereGrad;
        ctx.beginPath();
        ctx.arc(gp.cx, gp.cy, gp.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = light ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.strokeStyle = light ? 'rgba(15, 23, 42, 0.05)' : 'rgba(255, 255, 255, 0.045)';
        ctx.lineWidth = 1;
        for (let lon = -150; lon <= 180; lon += 30) {
          ctx.beginPath();
          let down = false;
          for (let lat = -75; lat <= 75; lat += 6) {
            const v = lonLatToCamVec(lon, lat, gp);
            if (v.rz <= 0) { down = false; continue; }
            const sx = gp.cx + gp.radius * v.rx;
            const sy = gp.cy - gp.radius * v.ry;
            if (!down) { ctx.moveTo(sx, sy); down = true; } else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
        for (let lat = -60; lat <= 60; lat += 30) {
          ctx.beginPath();
          let down = false;
          for (let lon = -180; lon <= 180; lon += 6) {
            const v = lonLatToCamVec(lon, lat, gp);
            if (v.rz <= 0) { down = false; continue; }
            const sx = gp.cx + gp.radius * v.rx;
            const sy = gp.cy - gp.radius * v.ry;
            if (!down) { ctx.moveTo(sx, sy); down = true; } else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }

        const baseRgb = light ? '15, 23, 42' : '255, 255, 255';
        for (let i = 0; i < LAND_DOTS.length; i++) {
          const d = LAND_DOTS[i];
          const dLam = d.lam - gp.lam0;
          const z1 = d.cosPhi * Math.cos(dLam);
          const rz = d.sinPhi * gp.sinPhi0 + z1 * gp.cosPhi0;
          if (rz <= 0.02) continue;
          const rx = d.cosPhi * Math.sin(dLam);
          const ry = d.sinPhi * gp.cosPhi0 - z1 * gp.sinPhi0;
          ctx.fillStyle = `rgba(${baseRgb}, ${(0.08 + rz * 0.24).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(gp.cx + gp.radius * rx, gp.cy - gp.radius * ry, 1.15 + rz * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.strokeStyle = light ? 'rgba(15, 23, 42, 0.045)' : 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        for (let gx = 1; gx < 6; gx++) {
          const x = (cam.w / 6) * gx;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cam.h); ctx.stroke();
        }
        for (let gy = 1; gy < 4; gy++) {
          const y = (cam.h / 4) * gy;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cam.w, y); ctx.stroke();
        }
        ctx.fillStyle = light ? 'rgba(15, 23, 42, 0.17)' : 'rgba(255, 255, 255, 0.18)';
        for (let i = 0; i < LAND_DOTS.length; i++) {
          const pt = projectPoint(LAND_DOTS[i].lon, LAND_DOTS[i].lat, gp);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const activeColor =
        p.status === 'connected' ? successColor : p.status === 'connecting' ? warningColor : primaryColor;

      if (p.status !== 'disconnected' && p.activeNode) {
        if (p.multiHop && p.entryNode && p.entryNode.id !== p.activeNode.id) {
          drawRouteArc(ORIGIN.lon, ORIGIN.lat, p.entryNode.lon, p.entryNode.lat, primaryColor, primaryColor, p.status === 'connected', 0, gp);
          drawRouteArc(p.entryNode.lon, p.entryNode.lat, p.activeNode.lon, p.activeNode.lat, primaryColor, activeColor, p.status === 'connected', 0.45, gp);
        } else {
          drawRouteArc(ORIGIN.lon, ORIGIN.lat, p.activeNode.lon, p.activeNode.lat, primaryColor, activeColor, p.status === 'connected', 0, gp);
        }
      }

      const origPt = projectPoint(ORIGIN.lon, ORIGIN.lat, gp);
      if (origPt.visible && origPt.rz > 0) {
        ctx.beginPath();
        ctx.arc(origPt.x, origPt.y, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = light ? '#334155' : '#f1f5f9';
        ctx.fill();
      }

      p.nodes.forEach((n) => {
        const pt = projectPoint(n.lon, n.lat, gp);
        if (!pt.visible || pt.rz < 0) return;
        const isTarget = p.activeNode ? n.id === p.activeNode.id : false;
        const isEntry = p.multiHop && p.entryNode ? n.id === p.entryNode.id && !isTarget : false;
        const isHovered = n.id === cam.hoveredId;

        if (isTarget && p.status === 'connected') {
          const sonar = (cam.phase * 0.65) % 1;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 5 + sonar * 22, 0, Math.PI * 2);
          ctx.strokeStyle = activeColor;
          ctx.globalAlpha = (1 - sonar) * 0.65;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (isTarget || isEntry || isHovered) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 9.5, 0, Math.PI * 2);
          ctx.fillStyle = isTarget ? activeColor : primaryColor;
          ctx.globalAlpha = 0.24;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isTarget ? 5.2 : isHovered ? 4.8 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = isTarget ? activeColor : isEntry ? primaryColor : light ? '#64748b' : '#94a3b8';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = light ? '#ffffff' : '#0f172a';
        ctx.stroke();
      });

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);

    const handlePointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      camRef.current.dragging = true;
      camRef.current.dragMoved = false;
      camRef.current.dragStartX = e.clientX;
      camRef.current.dragStartY = e.clientY;
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!camRef.current.dragging) return;
      const wasClick = !camRef.current.dragMoved;
      camRef.current.dragging = false;
      if (wasClick) {
        const rect = wrap.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const gp = getGlobeParams();
        for (const n of propsRef.current.nodes) {
          const pt = projectPoint(n.lon, n.lat, gp);
          if (pt.visible && pt.rz > 0 && Math.hypot(mx - pt.x, my - pt.y) < 14) {
            propsRef.current.onSelectNode(n.id);
            break;
          }
        }
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (camRef.current.dragging && propsRef.current.projection === 'globe') {
        const dx = e.clientX - camRef.current.dragStartX;
        const dy = e.clientY - camRef.current.dragStartY;
        if (Math.hypot(dx, dy) > 4) camRef.current.dragMoved = true;
        camRef.current.lon -= dx * 0.36;
        camRef.current.lat = Math.max(-65, Math.min(65, camRef.current.lat + dy * 0.32));
        camRef.current.targetLon = camRef.current.lon;
        camRef.current.targetLat = camRef.current.lat;
        camRef.current.dragStartX = e.clientX;
        camRef.current.dragStartY = e.clientY;
        setTooltip(null);
        return;
      }

      const gp = getGlobeParams();
      let found: { node: VpnNode; pt: { x: number; y: number } } | null = null;
      for (const n of propsRef.current.nodes) {
        const pt = projectPoint(n.lon, n.lat, gp);
        if (pt.visible && pt.rz > 0 && Math.hypot(mx - pt.x, my - pt.y) < 13) {
          found = { node: n, pt };
          break;
        }
      }

      if (found) {
        if (camRef.current.hoveredId !== found.node.id) soundEngine.playTick(1200);
        camRef.current.hoveredId = found.node.id;
        wrap.style.cursor = 'pointer';
        setTooltip({
          name: `${found.node.country} · ${found.node.city}`,
          meta: `${propsRef.current.getEffectivePing(found.node)} ms · 负载 ${found.node.load}%`,
          x: Math.min(camRef.current.w - 170, Math.max(10, found.pt.x + 12)),
          y: Math.max(10, found.pt.y - 46)
        });
      } else {
        camRef.current.hoveredId = null;
        wrap.style.cursor = propsRef.current.projection === 'globe' ? 'grab' : 'default';
        setTooltip(null);
      }
    };

    const handleLeave = () => {
      camRef.current.hoveredId = null;
      setTooltip(null);
    };

    wrap.addEventListener('pointerdown', handlePointerDown);
    wrap.addEventListener('pointermove', handlePointerMove);
    wrap.addEventListener('pointerleave', handleLeave);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      wrap.removeEventListener('pointerdown', handlePointerDown);
      wrap.removeEventListener('pointermove', handlePointerMove);
      wrap.removeEventListener('pointerleave', handleLeave);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  return (
    <div className="glass-surface spotlight-card rounded-2xl overflow-hidden relative min-h-[370px] flex-1 flex flex-col">
      <div ref={wrapRef} className="relative z-10 flex-1 w-full h-full select-none cursor-grab active:cursor-grabbing">
        <canvas ref={canvasRef} className="block w-full h-full" />

        <div className="pointer-events-none absolute top-3.5 left-3.5 flex flex-wrap items-center gap-2">
          <div className="glass-hud rounded-xl px-3 py-1.5 text-xs font-mono flex items-center gap-2">
            <span className="text-[var(--muted-foreground)]">LOCAL</span>
            <span className="opacity-60">⟶</span>
            <span className="font-semibold text-[var(--foreground)]">
              {!activeNode
                ? '尚未导入节点'
                : multiHop && entryNode && entryNode.id !== activeNode.id
                ? `${entryNode.city} ⟶ ${activeNode.city}`
                : `${activeNode.code} · ${activeNode.city}`}
            </span>
          </div>
        </div>

        <div className="absolute top-3.5 right-3.5 flex items-center gap-1 p-1 rounded-xl glass-hud text-xs">
          {(['globe', 'flat'] as MapProjection[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChangeProjection(p)}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                projection === p
                  ? 'glass-surface text-[var(--foreground)] font-semibold'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {p === 'globe' ? '3D 地球仪' : '2D 全景图'}
            </button>
          ))}
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3.5 glass-hud rounded-xl px-3 py-1.5 text-xs text-[var(--muted-foreground)]">
          {projection === 'globe'
            ? '拖拽旋转 3D 地球 · 点选节点自动飞跃切换'
            : '全景平面视图 · 点击任意城市节点直接切换隧道'}
        </div>

        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 glass-hud rounded-xl px-3 py-2 text-xs"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <div className="font-semibold">{tooltip.name}</div>
            <div className="font-mono text-[var(--muted-foreground)] mt-0.5">{tooltip.meta}</div>
          </div>
        )}
      </div>

      {/* Quick-Select Strip */}
      <div className="relative z-10 px-3.5 py-2.5 border-t border-[var(--card-border)] glass-well flex items-center gap-2 overflow-x-auto">
        <span className="text-xs text-[var(--muted-foreground)] shrink-0 mr-1">我的线路:</span>
        {nodes.length === 0 ? (
          <button
            type="button"
            onClick={onOpenImport}
            className="text-xs text-[var(--link)] hover:underline cursor-pointer"
          >
            暂无节点，点击这里导入你的订阅链接 / JSON / WireGuard 配置 →
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            {nodes.slice(0, 7).map((n) => {
              const active = activeNode ? n.id === activeNode.id : false;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onSelectNode(n.id)}
                  className={`px-2.5 py-1 rounded-lg text-[12.5px] font-medium shrink-0 transition cursor-pointer flex items-center gap-1.5 ${
                    active
                      ? 'glass-surface text-[var(--foreground)] font-semibold'
                      : 'border border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <span className="font-mono text-[11.5px] font-semibold">{n.code}</span>
                  <span>{n.city}</span>
                  <span className="font-mono tabular-nums text-[11.5px] opacity-75">{getEffectivePing(n)}ms</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
