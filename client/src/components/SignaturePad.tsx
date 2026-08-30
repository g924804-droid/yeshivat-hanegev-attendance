import { useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Eraser } from 'lucide-react';

export type SignaturePadHandle = {
  getDataUrl: () => string | null;
  clear: () => void;
  isEmpty: () => boolean;
};

/** רכיב חתימה דיגיטלית (canvas) — מחזיר data URL של PNG. */
export const SignaturePad = forwardRef<SignaturePadHandle, { width?: number; height?: number }>(
  ({ width = 400, height = 150 }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const hasDrawn = useRef(false);
    const [, forceRender] = useState(0);

    function getCtx() {
      return canvasRef.current?.getContext('2d') || null;
    }

    function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function start(e: React.PointerEvent<HTMLCanvasElement>) {
      drawing.current = true;
      const ctx = getCtx();
      const { x, y } = getPos(e);
      ctx?.beginPath();
      ctx?.moveTo(x, y);
    }

    function move(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!drawing.current) return;
      const ctx = getCtx();
      if (!ctx) return;
      const { x, y } = getPos(e);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#0f172a';
      ctx.lineTo(x, y);
      ctx.stroke();
      hasDrawn.current = true;
    }

    function end() {
      drawing.current = false;
    }

    useImperativeHandle(ref, () => ({
      getDataUrl: () => (hasDrawn.current ? canvasRef.current?.toDataURL('image/png') || null : null),
      isEmpty: () => !hasDrawn.current,
      clear: () => {
        const ctx = getCtx();
        ctx?.clearRect(0, 0, width, height);
        hasDrawn.current = false;
        forceRender((n) => n + 1);
      },
    }));

    return (
      <div>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="rounded-xl border-2 border-dashed border-slate-300 bg-white touch-none w-full"
          style={{ maxWidth: width }}
        />
        <button
          type="button"
          className="btn-outline mt-2 text-xs py-1.5 px-3"
          onClick={() => {
            const ctx = getCtx();
            ctx?.clearRect(0, 0, width, height);
            hasDrawn.current = false;
            forceRender((n) => n + 1);
          }}
        >
          <Eraser size={14} /> נקה חתימה
        </button>
      </div>
    );
  }
);
SignaturePad.displayName = 'SignaturePad';
