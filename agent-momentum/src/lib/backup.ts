import { db, TABLES, type TableName } from './db';
import { todayKey } from './dates';
import { updateSettings } from './repo';

export interface BackupFile {
  app: 'agent-momentum';
  version: 1;
  exportedAt: string;
  tables: Record<TableName, unknown[]>;
}

export async function exportBackup(): Promise<BackupFile> {
  const tables = {} as Record<TableName, unknown[]>;
  for (const t of TABLES) tables[t] = await db.table(t).toArray();
  return { app: 'agent-momentum', version: 1, exportedAt: new Date().toISOString(), tables };
}

export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a backup — it couldn’t be read as JSON.');
  }
  const b = data as Partial<BackupFile>;
  if (b?.app !== 'agent-momentum' || !b.tables) throw new Error('That file isn’t an Agent Momentum backup.');
  if (b.version !== 1) throw new Error(`This backup is from a newer version (v${b.version}). Update the app first.`);
  return b as BackupFile;
}

/** Replaces everything on this device with the backup's contents. */
export async function restoreBackup(backup: BackupFile): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      const rows = backup.tables[t] ?? [];
      if (rows.length) await db.table(t).bulkAdd(rows);
    }
  });
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear();
  });
}

export function backupFileName(): string {
  return `agent-momentum-backup-${todayKey()}.json`;
}

export async function downloadBackup(): Promise<void> {
  const data = await exportBackup();
  await saveFile(new File([JSON.stringify(data, null, 2)], backupFileName(), { type: 'application/json' }));
  await updateSettings({ lastBackupAt: new Date().toISOString() });
}

// ─── CSV ────────────────────────────────────────────────────────────────────

function cell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}

export async function downloadCsv(table: TableName): Promise<void> {
  const rows = (await db.table(table).toArray()) as Record<string, unknown>[];
  await saveFile(new File([toCsv(rows)], `agent-momentum-${table}-${todayKey()}.csv`, { type: 'text/csv' }));
}

// ─── Files ──────────────────────────────────────────────────────────────────

/** Downloads a file. (Sharing is offered separately where it makes sense.) */
export async function saveFile(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Opens the phone's share sheet when it can take files; otherwise downloads. */
export async function shareOrSave(file: File, title: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  await saveFile(file);
  return 'saved';
}
