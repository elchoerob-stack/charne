import { useState } from 'react';
import { CalendarCheck, ChartLine, FileChartColumn, ShieldCheck, Zap } from 'lucide-react';
import { loadDemoData } from '../lib/demo';
import { updateSettings } from '../lib/repo';
import { InstallHint } from '../components/Install';
import { Button } from '../components/ui';

const POINTS = [
  { icon: CalendarCheck, title: 'Plan on Sunday', text: 'Five quick steps: focus, targets, buyers, top 3 deals.' },
  { icon: Zap, title: 'Log in two taps', text: 'Tap a ring when you finish a call or viewing. Works offline.' },
  { icon: FileChartColumn, title: 'Review on Friday', text: 'Your scorecard builds itself, ready for Monday’s meeting.' },
  { icon: ChartLine, title: 'See what to improve', text: 'Trends, funnel leaks, best price band and coaching tips.' },
];

export function Onboarding({ onDone }: { onDone: (to: string) => void }) {
  const [name, setName] = useState('Charné');
  const finish = async (to: string, demo = false) => {
    if (demo) await loadDemoData();
    await updateSettings({ name: name.trim() || 'Charné', onboarded: true });
    onDone(to);
  };

  return (
    <div className="min-h-dvh bg-navy text-white">
      <div className="pt-safe mx-auto flex min-h-dvh max-w-lg flex-col px-6 pb-8">
        <div className="pt-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gold text-2xl font-black text-navy-950">M</div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight">Agent Momentum</h1>
          <p className="mt-1 text-white/70">Your weekly sales rhythm, in your pocket.</p>
        </div>

        <ul className="mt-8 space-y-5">
          {POINTS.map((p) => (
            <li key={p.title} className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-gold">
                <p.icon className="h-5 w-5" aria-hidden />
              </span>
              <span>
                <span className="block font-semibold">{p.title}</span>
                <span className="block text-sm text-white/70">{p.text}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex items-start gap-3 rounded-2xl bg-white/5 p-4 text-sm text-white/80 ring-1 ring-white/10">
          <ShieldCheck className="h-5 w-5 shrink-0 text-gold" aria-hidden />
          Private by design: everything stays on this phone. No client names or numbers needed — keep those in Keystone.
        </div>

        <label className="mt-8 block">
          <span className="mb-1.5 block text-sm font-medium text-white/80">What should we call you?</span>
          <input
            className="min-h-[48px] w-full rounded-xl border border-white/15 bg-white/10 px-4 text-base text-white placeholder:text-white/40 focus:border-gold focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="given-name"
          />
        </label>

        <div className="mt-auto space-y-3 pt-8">
          <Button variant="gold" size="lg" block onClick={() => finish('/plan')}>
            Plan my first week
          </Button>
          <Button size="lg" block className="!bg-white/10 !text-white ring-1 ring-white/15" onClick={() => finish('/')}>
            Skip — just start logging
          </Button>
          <button type="button" onClick={() => finish('/insights', true)} className="min-h-[44px] w-full text-sm font-medium text-white/70 underline-offset-4 hover:underline">
            Explore with sample data first
          </button>
          <InstallHint dark />
        </div>
      </div>
    </div>
  );
}
