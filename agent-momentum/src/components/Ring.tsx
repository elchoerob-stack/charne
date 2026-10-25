import { useEffect, useRef, useState } from 'react';
import { cx } from './ui';

/** Progress ring. `value` is 0–1+; anything over 1 draws a second, brighter lap. */
export function Ring({
  value,
  size = 84,
  stroke = 9,
  color,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const first = Math.min(1, Math.max(0, value));
  const over = Math.min(1, Math.max(0, value - 1));
  const [pop, setPop] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (value > last.current) {
      setPop(true);
      const t = setTimeout(() => setPop(false), 300);
      last.current = value;
      return () => clearTimeout(t);
    }
    last.current = value;
  }, [value]);

  return (
    <div className={cx('relative', pop && 'animate-pop')} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-100 dark:stroke-navy-800" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - first)}
          style={{ transition: 'stroke-dashoffset 500ms ease' }}
        />
        {over > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - over)}
            style={{ transition: 'stroke-dashoffset 500ms ease', filter: 'brightness(1.25) saturate(1.2)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
