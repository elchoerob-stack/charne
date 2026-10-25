import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Bottom sheet: slides up from the bottom, closes on backdrop tap or Escape. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="animate-fade absolute inset-0 bg-navy-950/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="animate-sheet relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-[#F6F4EF] shadow-2xl outline-none dark:bg-navy-950 sm:rounded-3xl"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <div className="absolute left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-slate-300 dark:bg-navy-600" aria-hidden />
          <h2 className="pt-3 text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 mt-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/60 dark:hover:bg-white/5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="pb-safe border-t border-black/5 px-5 pt-3 dark:border-white/10"><div className="pb-3">{footer}</div></div>}
      </div>
    </div>,
    document.body,
  );
}

/** Small centred confirm dialog. */
export function Confirm({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  danger,
  disabled,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="animate-fade absolute inset-0 bg-navy-950/50" onClick={onCancel} aria-hidden />
      <div role="alertdialog" aria-modal="true" aria-label={title} className="animate-fade relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-navy-900">
        <h2 className="text-lg font-bold">{title}</h2>
        {children && <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">{children}</div>}
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={onCancel} className="min-h-[44px] flex-1 rounded-xl bg-slate-100 font-semibold dark:bg-navy-800">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={disabled}
            className={`min-h-[44px] flex-1 rounded-xl font-semibold text-white disabled:opacity-40 ${danger ? 'bg-red-600' : 'bg-navy dark:bg-gold dark:text-navy-950'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
