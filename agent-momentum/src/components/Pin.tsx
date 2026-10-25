import { useEffect, useState } from 'react';
import { Delete, Lock } from 'lucide-react';
import { cx } from './ui';

/** Big-button 4-digit keypad. Calls onComplete when 4 digits are in. */
export function PinPad({
  onComplete,
  error,
  title,
  subtitle,
  tone = 'light',
}: {
  onComplete: (pin: string) => void;
  error?: string;
  title: string;
  subtitle?: string;
  tone?: 'light' | 'dark';
}) {
  const [pin, setPin] = useState('');
  useEffect(() => {
    if (error) setPin('');
  }, [error]);

  const press = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => {
      onComplete(next);
      setPin('');
    }, 120);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex flex-col items-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/15 text-gold">
        <Lock className="h-7 w-7" />
      </div>
      <h2 className="text-xl font-bold">{title}</h2>
      {subtitle && <p className="mt-1 text-sm opacity-70">{subtitle}</p>}
      <div className={cx('my-6 flex gap-4', error && 'animate-pop')} aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cx('h-4 w-4 rounded-full border-2 border-current transition', i < pin.length && 'bg-current')} />
        ))}
      </div>
      <p className="mb-4 h-5 text-sm font-medium text-red-400" role="alert">
        {error}
      </p>
      <div className="grid grid-cols-3 gap-4">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} tone={tone} onClick={() => press(d)}>
            {d}
          </Key>
        ))}
        <span />
        <Key tone={tone} onClick={() => press('0')}>0</Key>
        <button type="button" aria-label="Delete digit" onClick={() => setPin((p) => p.slice(0, -1))} className="flex h-16 w-16 items-center justify-center rounded-full opacity-70 active:scale-95">
          <Delete className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}

function Key({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone: 'light' | 'dark' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'h-16 w-16 rounded-full text-2xl font-semibold ring-1 transition active:scale-95',
        tone === 'dark' ? 'bg-white/10 ring-white/20 active:bg-white/20' : 'bg-white ring-slate-200 active:bg-slate-100 dark:bg-navy-800 dark:ring-white/10',
      )}
    >
      {children}
    </button>
  );
}
