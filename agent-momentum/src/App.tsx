import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { getSettings } from './lib/repo';
import { checkPin } from './lib/pin';
import { useSettings } from './hooks/data';
import { applyTheme } from './theme';
import { ToastProvider } from './components/Toast';
import { LogProvider } from './components/LogSheet';
import { Layout } from './components/Layout';
import { PinPad } from './components/Pin';
import { UpdatePrompt } from './components/Install';
import { Today } from './screens/Today';
import { WeekScreen } from './screens/WeekScreen';
import { PlanWizard } from './screens/PlanWizard';
import { SettingsScreen } from './screens/SettingsScreen';
import { Onboarding } from './screens/Onboarding';

// Charts and image export are the heavy parts; load them when first opened.
const Review = lazy(() => import('./screens/Review').then((m) => ({ default: m.Review })));
const Insights = lazy(() => import('./screens/Insights').then((m) => ({ default: m.Insights })));

/** Re-ask for the PIN after the app has been in the background this long. */
const RELOCK_MS = 60_000;

export function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <LogProvider>
          <Shell />
          <UpdatePrompt />
        </LogProvider>
      </ToastProvider>
    </HashRouter>
  );
}

function Shell() {
  const settings = useSettings();
  const navigate = useNavigate();
  const [unlocked, setUnlocked] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    void getSettings();
  }, []);

  useEffect(() => {
    if (settings) applyTheme(settings.theme);
  }, [settings?.theme]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_MS) setUnlocked(false);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (!settings) return <Splash />;
  if (!settings.onboarded) return <Onboarding onDone={(to) => navigate(to)} />;
  if (settings.pinHash && !unlocked) return <PinLock salt={settings.pinSalt} hash={settings.pinHash} onUnlock={() => setUnlocked(true)} />;

  return (
    <Routes>
      <Route path="/plan" element={<PlanWizard />} />
      <Route element={<Layout />}>
        <Route index element={<Today />} />
        <Route path="/week" element={<WeekScreen />} />
        <Route path="/review" element={<Suspense fallback={null}><Review /></Suspense>} />
        <Route path="/insights" element={<Suspense fallback={null}><Insights /></Suspense>} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gold text-3xl font-black text-navy-950">M</div>
    </div>
  );
}

function PinLock({ salt, hash, onUnlock }: { salt?: string; hash?: string; onUnlock: () => void }) {
  const [error, setError] = useState<string>();
  const [tries, setTries] = useState(0);
  return (
    <div className="pt-safe flex min-h-dvh flex-col items-center justify-center bg-navy px-6 text-white">
      <PinPad
        tone="dark"
        title="Agent Momentum"
        subtitle="Enter your PIN"
        error={error}
        onComplete={async (pin) => {
          if (await checkPin(pin, salt, hash)) onUnlock();
          else {
            setTries((t) => t + 1);
            setError(tries >= 2 ? 'Wrong PIN. Forgotten it? See below.' : 'Wrong PIN, try again.');
          }
        }}
      />
      {tries >= 3 && (
        <p className="mt-8 max-w-xs text-center text-xs text-white/60">
          The PIN can’t be recovered. To start over, clear this site’s data in your browser settings, then restore your latest backup.
        </p>
      )}
    </div>
  );
}
