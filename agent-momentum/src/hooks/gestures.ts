import { useRef, type PointerEvent } from 'react';

/** Tap vs. press-and-hold on the same element, without firing both. */
export function useLongPress(onTap: () => void, onLongPress: () => void, ms = 450) {
  const timer = useRef<number>();
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };

  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, ms);
    },
    onPointerMove: (e: PointerEvent) => {
      // A scroll or drag is neither a tap nor a hold.
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: () => {
      const wasPressed = start.current != null;
      cancel();
      if (wasPressed && !fired.current) onTap();
    },
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (e.shiftKey) onLongPress();
        else onTap();
      }
    },
  };
}
