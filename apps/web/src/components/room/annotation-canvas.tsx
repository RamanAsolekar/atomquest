'use client';

import { useEffect, useRef, useState } from 'react';
import { Pen, Square, MoveUpRight, Eraser, MousePointer2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Stroke {
  id: string;
  tool: string;
  color: string;
  points: number[]; // normalised 0..1 flattened
  authorName: string;
  __clear?: boolean;
}

interface Props {
  active: boolean;
  authorName: string;
  onStroke: (stroke: Stroke) => void;
  onClear: () => void;
  onPointer: (x: number, y: number) => void;
  registerStrokeHandler: (h: (s: Stroke) => void) => void;
  registerPointerHandler: (h: (p: { x: number; y: number; displayName: string }) => void) => void;
}

const COLORS = ['#ef4444', '#6366f1', '#22c55e', '#f59e0b', '#ffffff'];

/**
 * Shared annotation/pointer overlay (visual-assistance USP). Coordinates are
 * normalised 0..1 so they map correctly across different viewport sizes.
 */
export function AnnotationCanvas({ active, authorName, onStroke, onClear, onPointer, registerStrokeHandler, registerPointerHandler }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const remotePointer = useRef<{ x: number; y: number; displayName: string; ts: number } | null>(null);
  const [tool, setTool] = useState<'pen' | 'arrow' | 'rect' | 'pointer'>('pen');
  const [color, setColor] = useState(COLORS[0]);

  // redraw loop
  useEffect(() => {
    let raf: number;
    const render = () => {
      const c = canvasRef.current;
      const cont = containerRef.current;
      if (c && cont) {
        c.width = cont.clientWidth;
        c.height = cont.clientHeight;
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, c.width, c.height);
        const all = [...strokes.current, ...(drawing.current ? [drawing.current] : [])];
        for (const s of all) drawStroke(ctx, s, c.width, c.height);
        // remote pointer
        const rp = remotePointer.current;
        if (rp && Date.now() - rp.ts < 2500) {
          ctx.fillStyle = '#d946ef';
          ctx.beginPath();
          ctx.arc(rp.x * c.width, rp.y * c.height, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '11px sans-serif';
          ctx.fillText(rp.displayName, rp.x * c.width + 10, rp.y * c.height);
        }
      }
      raf = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    registerStrokeHandler((s) => {
      if (s.__clear) { strokes.current = []; return; }
      strokes.current.push(s);
    });
    registerPointerHandler((p) => { remotePointer.current = { ...p, ts: Date.now() }; });
  }, [registerStrokeHandler, registerPointerHandler]);

  function norm(e: React.PointerEvent) {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function down(e: React.PointerEvent) {
    if (!active) return;
    if (tool === 'pointer') return;
    const { x, y } = norm(e);
    drawing.current = { id: crypto.randomUUID(), tool, color, points: [x, y], authorName };
  }
  function move(e: React.PointerEvent) {
    if (!active) return;
    const { x, y } = norm(e);
    if (tool === 'pointer') { onPointer(x, y); return; }
    if (!drawing.current) return;
    if (tool === 'pen') drawing.current.points.push(x, y);
    else drawing.current.points = [drawing.current.points[0], drawing.current.points[1], x, y];
  }
  function up() {
    if (drawing.current) {
      strokes.current.push(drawing.current);
      onStroke(drawing.current);
      drawing.current = null;
    }
  }

  function clearAll() { strokes.current = []; onClear(); }

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className={cn('absolute inset-0 h-full w-full', active ? (tool === 'pointer' ? 'cursor-pointer' : 'cursor-crosshair') : 'pointer-events-none')}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      {active && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card/90 p-1 shadow-lg backdrop-blur">
          {[['pen', Pen], ['arrow', MoveUpRight], ['rect', Square], ['pointer', MousePointer2]].map(([t, Icon]: any) => (
            <Button key={t} size="icon" variant={tool === t ? 'default' : 'ghost'} className="h-8 w-8" onClick={() => setTool(t)}><Icon className="h-4 w-4" /></Button>
          ))}
          <div className="mx-1 h-5 w-px bg-border" />
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} className={cn('h-5 w-5 rounded-full border-2', color === c ? 'border-foreground' : 'border-transparent')} style={{ background: c }} />
          ))}
          <div className="mx-1 h-5 w-px bg-border" />
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={clearAll}><Eraser className="h-4 w-4" /></Button>
        </div>
      )}
    </div>
  );
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const p = s.points;
  if (s.tool === 'pen') {
    ctx.beginPath();
    ctx.moveTo(p[0] * w, p[1] * h);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * w, p[i + 1] * h);
    ctx.stroke();
  } else if (s.tool === 'rect' && p.length >= 4) {
    ctx.strokeRect(p[0] * w, p[1] * h, (p[2] - p[0]) * w, (p[3] - p[1]) * h);
  } else if (s.tool === 'arrow' && p.length >= 4) {
    const x1 = p[0] * w, y1 = p[1] * h, x2 = p[2] * w, y2 = p[3] * h;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 14 * Math.cos(a - Math.PI / 6), y2 - 14 * Math.sin(a - Math.PI / 6));
    ctx.lineTo(x2 - 14 * Math.cos(a + Math.PI / 6), y2 - 14 * Math.sin(a + Math.PI / 6));
    ctx.closePath(); ctx.fill();
  }
}
