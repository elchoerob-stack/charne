import { useEffect, useState } from 'react';
import { Share, Smartphone } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button, cx } from './ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** "Add to home screen" help: a real button on Android, instructions on iPhone. */
export function InstallHint({ dark }: { dark?: boolean }) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (isStandalone()) return null;

  if (deferred) {
    return (
      <Button
        variant={dark ? 'secondary' : 'secondary'}
        block
        icon={Smartphone}
        onClick={async () => {
          await deferred?.prompt();
          deferred = null;
          force((n) => n + 1);
        }}
      >
        Install on this phone
      </Button>
    );
  }
  if (isIos()) {
    return (
      <p className={cx('flex items-center justify-center gap-1.5 text-center text-xs', dark ? 'text-white/60' : 'text-slate-500')}>
        <Smartphone className="h-4 w-4" /> To install: tap <Share className="inline h-4 w-4" aria-label="Share" /> then “Add to Home Screen”.
      </p>
    );
  }
  return null;
}

/** Offers a reload when a new version has been downloaded in the background. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="no-print fixed inset-x-0 top-0 z-[80] flex justify-center p-3 pt-[calc(env(safe-area-inset-top)+12px)]">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl bg-navy-900 p-3 pl-4 text-sm text-white shadow-xl">
        <span className="flex-1">A new version is ready.</span>
        <button type="button" className="min-h-[40px] px-2 text-white/60" onClick={() => setNeedRefresh(false)}>
          Later
        </button>
        <Button size="sm" variant="gold" onClick={() => void updateServiceWorker(true)}>
          Update
        </Button>
      </div>
    </div>
  );
}
