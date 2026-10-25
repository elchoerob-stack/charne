import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  actions: ToastAction[];
  duration: number;
}

interface ToastApi {
  show: (message: string, opts?: { actions?: ToastAction[]; duration?: number }) => void;
}

const Ctx = createContext<ToastApi>({ show: () => {} });

export const useToast = () => useContext(Ctx);

/** One snackbar at a time, above the tab bar. A new one replaces the old. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<number>();
  const seq = useRef(0);

  const show = useCallback<ToastApi['show']>((message, opts) => {
    window.clearTimeout(timer.current);
    setToast({ id: ++seq.current, message, actions: opts?.actions ?? [], duration: opts?.duration ?? 4000 });
  }, []);

  useEffect(() => {
    if (!toast) return;
    timer.current = window.setTimeout(() => setToast(null), toast.duration);
    return () => window.clearTimeout(timer.current);
  }, [toast]);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {toast &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] z-[70] flex justify-center px-4">
            <div
              key={toast.id}
              role="status"
              aria-live="polite"
              className="animate-sheet pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl bg-navy-900 py-2 pl-4 pr-2 text-sm text-white shadow-xl ring-1 ring-white/10 dark:bg-slate-100 dark:text-navy-900"
            >
              <span className="flex-1 py-2">{toast.message}</span>
              {toast.actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => {
                    setToast(null);
                    a.onClick();
                  }}
                  className="min-h-[40px] rounded-lg px-3 font-semibold text-gold hover:bg-white/10 dark:text-navy-600 dark:hover:bg-navy-50"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}
