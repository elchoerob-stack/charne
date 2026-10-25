import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Minus, Plus, type LucideIcon } from 'lucide-react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'gold' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-navy text-white hover:bg-navy-600 dark:bg-gold dark:text-navy-950 dark:hover:bg-gold-400',
  gold: 'bg-gold text-navy-950 hover:bg-gold-400',
  secondary:
    'bg-white text-navy-900 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-navy-800 dark:text-slate-100 dark:ring-white/10 dark:hover:bg-navy-700',
  ghost: 'text-navy-700 hover:bg-navy-50 dark:text-slate-200 dark:hover:bg-white/5',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: LucideIcon;
  block?: boolean;
  size?: 'md' | 'lg' | 'sm';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', icon: Icon, block, size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        size === 'lg' && 'min-h-[52px] px-5 text-base',
        size === 'md' && 'min-h-[44px] px-4 text-sm',
        size === 'sm' && 'min-h-[36px] px-3 text-sm',
        VARIANT[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />}
      {children}
    </button>
  );
});

export function IconButton({
  icon: Icon,
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-11 w-11 items-center justify-center rounded-full text-navy-700 transition hover:bg-navy-50 active:scale-95 dark:text-slate-200 dark:hover:bg-white/5',
        className,
      )}
      {...rest}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('card', className)}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</h2>
      {action}
    </div>
  );
}

export function Chip({
  active,
  children,
  onClick,
  className,
  color,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={active && color ? { backgroundColor: color, borderColor: color } : undefined}
      className={cx(
        'inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition active:scale-95',
        active
          ? 'border-navy bg-navy text-white dark:border-gold dark:bg-gold dark:text-navy-950'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-white/10 dark:bg-navy-800 dark:text-slate-200',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-slate-100 p-1 dark:bg-navy-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-[40px] flex-1 rounded-lg px-2 text-sm font-medium transition',
            value === o.value
              ? 'bg-white text-navy-900 shadow-sm dark:bg-navy-600 dark:text-white'
              : 'text-slate-500 dark:text-slate-400',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Fewer ${label}`}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 active:scale-95 dark:bg-navy-800"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-10 text-center text-lg font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label={`More ${label}`}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 active:scale-95 dark:bg-navy-800"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean | undefined;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-slate-500 dark:text-slate-400">{description}</span>}
      </span>
      <span
        className={cx(
          'relative h-7 w-12 shrink-0 rounded-full transition',
          checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-navy-600',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}

/** Yes / No / not answered — for the optional quality checks. */
export function YesNo({
  value,
  onChange,
  label,
}: {
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
  label: string;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-2">
        <Chip active={value === true} onClick={() => onChange(value === true ? undefined : true)} color="#10B981">
          Yes
        </Chip>
        <Chip active={value === false} onClick={() => onChange(value === false ? undefined : false)} color="#EF4444">
          No
        </Chip>
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-50 text-gold-600 dark:bg-gold/10 dark:text-gold">
        <Icon className="h-7 w-7" aria-hidden />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Banner({
  icon: Icon,
  title,
  children,
  action,
  tone = 'gold',
  onDismiss,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: 'gold' | 'navy' | 'red' | 'slate';
  onDismiss?: () => void;
}) {
  const tones = {
    gold: 'bg-gold-50 ring-gold/30 dark:bg-gold/10 dark:ring-gold/30',
    navy: 'bg-navy text-white ring-navy dark:bg-navy-700',
    red: 'bg-red-50 ring-red-200 dark:bg-red-500/10 dark:ring-red-500/30',
    slate: 'bg-slate-100 ring-slate-200 dark:bg-navy-800 dark:ring-white/10',
  };
  return (
    <div className={cx('flex items-start gap-3 rounded-2xl p-4 ring-1', tones[tone])}>
      <Icon className={cx('mt-0.5 h-5 w-5 shrink-0', tone === 'navy' ? 'text-gold' : 'text-gold-600 dark:text-gold')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {children && <div className={cx('mt-0.5 text-sm', tone === 'navy' ? 'text-white/80' : 'text-slate-600 dark:text-slate-300')}>{children}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-2 p-2 text-slate-400 hover:text-slate-600">
          ×
        </button>
      )}
    </div>
  );
}

export function ProgressBar({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cx('h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800', className)}>
      <div
        className="h-full rounded-full bg-gold transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color }}
      />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 px-1 pb-2 pt-4">
      <div className="min-w-0">
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
      </div>
      {actions && <div className="-mr-2 flex shrink-0 items-center">{actions}</div>}
    </header>
  );
}
