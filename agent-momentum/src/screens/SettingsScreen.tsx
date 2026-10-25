import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarPlus,
  Download,
  FlaskConical,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ACTIVITY_BY_TYPE, TARGET_KEYS, TARGET_LABEL, TARGET_TO_TYPE } from '../config';
import type { Band, Settings } from '../types';
import { formatDay } from '../lib/dates';
import { updateSettings } from '../lib/repo';
import { clearAllData, downloadBackup, downloadCsv, parseBackup, restoreBackup, shareOrSave } from '../lib/backup';
import { TABLES } from '../lib/db';
import { buildReminderIcs } from '../lib/ics';
import { hashPin, newSalt } from '../lib/pin';
import { hasDemoData, loadDemoData, removeDemoData } from '../lib/demo';
import { useSettings } from '../hooks/data';
import { useLiveQuery } from 'dexie-react-hooks';
import { Confirm, Sheet } from '../components/Sheet';
import { PinPad } from '../components/Pin';
import { useToast } from '../components/Toast';
import { InstallHint } from '../components/Install';
import { applyTheme } from '../theme';
import { Button, Card, Chip, IconButton, NumberStepper, PageHeader, SectionTitle, Segmented } from '../components/ui';
import { ACTIVITY_ICON } from '../components/ActivityIcon';

const DAYS = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 7, label: 'Sun' },
];

export function SettingsScreen() {
  const settings = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const backupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (location.hash === '#backup') backupRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash, settings == null]);

  if (!settings) return <div className="h-dvh" />;
  const save = (patch: Partial<Settings>) => void updateSettings(patch);

  return (
    <div>
      <div className="-ml-2 pt-2">
        <IconButton icon={ArrowLeft} label="Back" onClick={() => navigate(-1)} />
      </div>
      <PageHeader title="Settings" />

      <SectionTitle>You</SectionTitle>
      <Card className="p-4">
        <label className="label" htmlFor="name">Name</label>
        <input id="name" className="input" defaultValue={settings.name} onBlur={(e) => save({ name: e.target.value.trim() || 'Charné' })} />
      </Card>

      <SectionTitle>Usual weekly targets</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-white/5">
        {TARGET_KEYS.map((k) => {
          const type = TARGET_TO_TYPE[k];
          const Icon = ACTIVITY_ICON[type];
          return (
            <div key={k} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: ACTIVITY_BY_TYPE[type].color }}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="flex-1 text-sm font-medium">{TARGET_LABEL[k]}</span>
              <NumberStepper label={TARGET_LABEL[k].toLowerCase()} value={settings.targets[k]} onChange={(v) => save({ targets: { ...settings.targets, [k]: v } })} />
            </div>
          );
        })}
      </Card>
      <p className="mt-1.5 px-1 text-xs text-slate-500">New weeks start with these. Change a single week’s targets in the planner.</p>

      <SectionTitle>Work days</SectionTitle>
      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const on = settings.workDays.includes(d.n);
            return (
              <Chip
                key={d.n}
                active={on}
                onClick={() => {
                  const next = on ? settings.workDays.filter((x) => x !== d.n) : [...settings.workDays, d.n].sort();
                  if (next.length) save({ workDays: next });
                }}
              >
                {d.label}
              </Chip>
            );
          })}
        </div>
        <p className="hint mt-2">Add Saturday if you want show days to count toward your daily plan.</p>
      </Card>

      <SectionTitle>Price bands & areas</SectionTitle>
      <div className="space-y-2">
        {settings.bands.map((b, i) => (
          <BandEditor
            key={b.id}
            band={b}
            onChange={(nb) => {
              const bands = settings.bands.map((x, j) => (j === i ? nb : x));
              save({ bands, areas: [...new Set(bands.flatMap((x) => x.areas))] });
            }}
          />
        ))}
      </div>

      <SectionTitle>Reminders</SectionTitle>
      <Reminders settings={settings} />

      <SectionTitle>Appearance</SectionTitle>
      <Card className="p-4">
        <Segmented
          label="Theme"
          value={settings.theme}
          onChange={(theme) => {
            save({ theme });
            applyTheme(theme);
          }}
          options={[
            { value: 'system', label: 'Automatic' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Card>

      <SectionTitle>Privacy</SectionTitle>
      <PinSettings settings={settings} />

      <div ref={backupRef} id="backup" className="scroll-mt-4">
        <SectionTitle>Backup & export</SectionTitle>
      </div>
      <BackupSettings settings={settings} />

      <SectionTitle>Sample data</SectionTitle>
      <DemoSettings />

      <SectionTitle>Danger zone</SectionTitle>
      <ClearData />

      <div className="mt-8 space-y-3 pb-4 text-center">
        <InstallHint />
        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4" /> Everything stays on this device. Nothing is sent anywhere.
        </p>
        <p className="text-xs text-slate-400">Agent Momentum v1.0</p>
      </div>
    </div>
  );
}

function BandEditor({ band, onChange }: { band: Band; onChange: (b: Band) => void }) {
  const [adding, setAdding] = useState('');
  const add = () => {
    const a = adding.trim();
    if (a && !band.areas.includes(a)) onChange({ ...band, areas: [...band.areas, a] });
    setAdding('');
  };
  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-2">
        <input className="input font-semibold" aria-label="Band name" defaultValue={band.label} onBlur={(e) => onChange({ ...band, label: e.target.value.trim() || band.label })} />
        <input className="input" aria-label="Band description" defaultValue={band.description} onBlur={(e) => onChange({ ...band, description: e.target.value.trim() })} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {band.areas.map((a) => (
          <span key={a} className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-slate-100 pl-3 text-sm dark:bg-navy-800">
            {a}
            <button type="button" aria-label={`Remove ${a}`} onClick={() => onChange({ ...band, areas: band.areas.filter((x) => x !== a) })} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:text-red-500">
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="input" placeholder="Add an area" aria-label={`Add an area to ${band.label}`} value={adding} onChange={(e) => setAdding(e.target.value)} />
        <Button type="submit" variant="secondary" icon={Plus} aria-label="Add area" disabled={!adding.trim()} />
      </form>
    </Card>
  );
}

function Reminders({ settings }: { settings: Settings }) {
  const toast = useToast();
  const r = settings.reminders;
  const set = (patch: Partial<Settings['reminders']>) => void updateSettings({ reminders: { ...r, ...patch } });
  const rows: { key: keyof Settings['reminders']; label: string }[] = [
    { key: 'planSun', label: 'Sunday — plan your week' },
    { key: 'dailyAm', label: 'Work days — check in' },
    { key: 'reviewFri', label: 'Friday — weekly review' },
  ];
  return (
    <Card className="p-4">
      <div className="space-y-2">
        {rows.map((row) => (
          <label key={row.key} className="flex min-h-[44px] items-center justify-between gap-3 text-sm">
            <span className="font-medium">{row.label}</span>
            <input type="time" className="input w-32" value={r[row.key]} onChange={(e) => e.target.value && set({ [row.key]: e.target.value })} />
          </label>
        ))}
      </div>
      <Button
        className="mt-4"
        block
        icon={CalendarPlus}
        onClick={async () => {
          const file = new File([buildReminderIcs(r, settings.workDays)], 'agent-momentum-reminders.ics', { type: 'text/calendar' });
          const res = await shareOrSave(file, 'Agent Momentum reminders');
          if (res === 'saved') toast.show('Open the downloaded file to add the reminders to your calendar');
        }}
      >
        Add reminders to my calendar
      </Button>
      <p className="hint mt-2">Your phone’s calendar does the reminding — this app can’t send notifications on its own. The app also nudges you when you open it.</p>
    </Card>
  );
}

function PinSettings({ settings }: { settings: Settings }) {
  const toast = useToast();
  const [step, setStep] = useState<'closed' | 'enter' | 'confirm'>('closed');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string>();
  const hasPin = !!settings.pinHash;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Lock className="h-5 w-5 text-slate-400" aria-hidden />
        <div className="flex-1">
          <p className="text-sm font-medium">PIN lock</p>
          <p className="text-xs text-slate-500">{hasPin ? 'On — asked each time you open the app.' : 'Off'}</p>
        </div>
        {hasPin ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setStep('enter')}>
              Change
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await updateSettings({ pinHash: undefined, pinSalt: undefined });
                toast.show('PIN removed');
              }}
            >
              Turn off
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setStep('enter')}>
            Set a PIN
          </Button>
        )}
      </div>
      <p className="hint mt-2">A privacy screen for when someone else picks up your phone. It doesn’t encrypt your data.</p>
      <Sheet open={step !== 'closed'} onClose={() => setStep('closed')} title={hasPin ? 'Change PIN' : 'Set a PIN'}>
        <div className="py-4">
          {step === 'enter' && (
            <PinPad
              key="enter"
              title="Choose a 4-digit PIN"
              onComplete={(p) => {
                setFirst(p);
                setError(undefined);
                setStep('confirm');
              }}
            />
          )}
          {step === 'confirm' && (
            <PinPad
              key="confirm"
              title="Enter it again"
              error={error}
              onComplete={async (p) => {
                if (p !== first) {
                  setError('Those didn’t match. Try again.');
                  return;
                }
                const salt = newSalt();
                await updateSettings({ pinSalt: salt, pinHash: await hashPin(p, salt) });
                setStep('closed');
                toast.show('PIN set');
              }}
            />
          )}
        </div>
      </Sheet>
    </Card>
  );
}

function BackupSettings({ settings }: { settings: Settings }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<ReturnType<typeof parseBackup> | null>(null);
  const [table, setTable] = useState<(typeof TABLES)[number]>('activities');

  return (
    <Card className="p-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Your data lives only on this phone. Save a backup file somewhere safe (email it to yourself, or Google Drive).
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {settings.lastBackupAt ? `Last backup: ${formatDay(settings.lastBackupAt.slice(0, 10), 'EEE d MMM yyyy')}` : 'No backup yet.'}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          icon={Download}
          onClick={async () => {
            await downloadBackup();
            toast.show('Backup saved');
          }}
        >
          Back up now
        </Button>
        <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>
          Restore
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            setPendingRestore(parseBackup(await f.text()));
          } catch (err) {
            toast.show((err as Error).message);
          }
        }}
      />

      <p className="label mt-5">Export a spreadsheet (CSV)</p>
      <div className="flex flex-wrap gap-2">
        {TABLES.filter((t) => t !== 'settings').map((t) => (
          <Chip key={t} active={table === t} onClick={() => setTable(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </Chip>
        ))}
      </div>
      <Button className="mt-3" variant="secondary" block icon={Download} onClick={() => void downloadCsv(table)}>
        Export {table} as CSV
      </Button>

      <Confirm
        open={!!pendingRestore}
        title="Replace everything with this backup?"
        confirmLabel="Restore"
        danger
        onCancel={() => setPendingRestore(null)}
        onConfirm={async () => {
          if (!pendingRestore) return;
          await restoreBackup(pendingRestore);
          setPendingRestore(null);
          toast.show('Backup restored');
        }}
      >
        Backup from {pendingRestore ? formatDay(pendingRestore.exportedAt.slice(0, 10), 'd MMM yyyy') : ''}. Everything currently on this phone will be replaced.
      </Confirm>
    </Card>
  );
}

function DemoSettings() {
  const toast = useToast();
  const on = useLiveQuery(hasDemoData, []);
  return (
    <Card className="flex items-center gap-3 p-4">
      <FlaskConical className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
      <p className="flex-1 text-sm text-slate-600 dark:text-slate-300">
        {on ? 'Sample data is loaded. Removing it never touches what you logged yourself.' : '8 weeks of realistic sample data, to see how the charts and coaching work.'}
      </p>
      {on ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            await removeDemoData();
            toast.show('Sample data removed');
          }}
        >
          Remove
        </Button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            await loadDemoData();
            toast.show('Sample data loaded');
          }}
        >
          Load
        </Button>
      )}
    </Card>
  );
}

function ClearData() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  return (
    <Card className="p-4">
      <Button variant="secondary" block icon={Trash2} className="!text-red-600" onClick={() => setOpen(true)}>
        Clear all data
      </Button>
      <Confirm
        open={open}
        title="Delete everything?"
        confirmLabel="Delete everything"
        danger
        disabled={typed !== 'DELETE'}
        onCancel={() => {
          setOpen(false);
          setTyped('');
        }}
        onConfirm={async () => {
          await clearAllData();
          try {
            localStorage.removeItem('am-theme');
          } catch {
            /* ignore */
          }
          window.location.replace(window.location.pathname);
        }}
      >
        <p>This removes every week, entry and setting from this phone. It can’t be undone — make a backup first.</p>
        <label className="mt-4 block">
          <span className="label">Type DELETE to confirm</span>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" />
        </label>
      </Confirm>
    </Card>
  );
}
