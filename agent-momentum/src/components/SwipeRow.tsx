import { useRef, useState, type ReactNode } from 'react';
import { Check, Clock } from 'lucide-react';

/**
 * Swipe right to complete, left to reschedule. The same two actions are also
 * plain buttons in the row, so nobody has to discover the gesture.
 */
export function SwipeRow({
  children,
  onDone,
  onLater,
}: {
  children: ReactNode;
  onDone: () => void;
  onLater: () => void;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const horizontal = useRef(false);
  const T = 90;

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div
        className={`absolute inset-0 flex items-center justify-between px-5 text-sm font-semibold text-white ${dx > 0 ? 'bg-emerald-500' : dx < 0 ? 'bg-amber-500' : ''}`}
        aria-hidden
      >
        <span className={`flex items-center gap-2 ${dx > 0 ? 'opacity-100' : 'opacity-0'}`}>
          <Check className="h-5 w-5" /> Done
        </span>
        <span className={`flex items-center gap-2 ${dx < 0 ? 'opacity-100' : 'opacity-0'}`}>
          Next work day <Clock className="h-5 w-5" />
        </span>
      </div>
      <div
        className="card relative touch-pan-y"
        style={{ transform: `translateX(${dx}px)`, transition: start.current ? 'none' : 'transform 200ms ease' }}
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY };
          horizontal.current = false;
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const mx = e.clientX - start.current.x;
          const my = e.clientY - start.current.y;
          if (!horizontal.current && Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my)) horizontal.current = true;
          if (horizontal.current) setDx(Math.max(-140, Math.min(140, mx)));
        }}
        onPointerUp={() => {
          const d = dx;
          start.current = null;
          setDx(0);
          if (d > T) onDone();
          else if (d < -T) onLater();
        }}
        onPointerCancel={() => {
          start.current = null;
          setDx(0);
        }}
      >
        {children}
      </div>
    </div>
  );
}
