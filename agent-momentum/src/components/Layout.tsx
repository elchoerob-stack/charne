import { NavLink, Outlet } from 'react-router-dom';
import { CalendarDays, ChartLine, FileChartColumn, House, Plus, type LucideIcon } from 'lucide-react';
import { useLog } from './LogSheet';
import { cx } from './ui';

function Tab({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cx(
          'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition',
          isActive ? 'text-navy dark:text-gold' : 'text-slate-400 dark:text-slate-500',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="h-6 w-6" strokeWidth={isActive ? 2.4 : 1.8} aria-hidden />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function Layout() {
  const log = useLog();
  return (
    <div className="mx-auto min-h-dvh max-w-lg">
      <main className="pt-safe px-4 pb-[calc(96px+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <nav
        aria-label="Main"
        className="no-print pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-black/5 bg-white/90 backdrop-blur-lg dark:border-white/10 dark:bg-navy-900/90"
      >
        <div className="mx-auto flex max-w-lg items-center px-2">
          <Tab to="/" icon={House} label="Today" />
          <Tab to="/week" icon={CalendarDays} label="Week" />
          <div className="flex flex-1 justify-center">
            <button
              type="button"
              onClick={() => log.open()}
              aria-label="Log activity"
              className="-mt-6 flex h-16 w-16 items-center justify-center rounded-full bg-gold text-navy-950 shadow-lg shadow-gold/30 ring-4 ring-[#F6F4EF] transition active:scale-95 dark:ring-navy-950"
            >
              <Plus className="h-8 w-8" strokeWidth={2.5} />
            </button>
          </div>
          <Tab to="/review" icon={FileChartColumn} label="Review" />
          <Tab to="/insights" icon={ChartLine} label="Insights" />
        </div>
      </nav>
    </div>
  );
}
