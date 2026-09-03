export type Intent = "todo" | "calendar_event" | "email_draft";
export type NoteStatus = "new" | "ready" | "confirmed" | "done" | "dismissed";

export interface Note {
  id: string;
  created_at: string;
  transcript: string;
  title: string | null;
  intent: Intent;
  extracted: Record<string, unknown>;
  status: NoteStatus;
  completed_at: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  list: () => request<Note[]>("/notes"),
  create: (transcript: string) =>
    request<Note>("/notes", { method: "POST", body: JSON.stringify({ transcript }) }),
  process: (id: string) => request<Note>(`/notes/${id}/process`, { method: "POST" }),
  update: (id: string, fields: Partial<Pick<Note, "title" | "intent" | "extracted">>) =>
    request<Note>(`/notes/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
  confirm: (id: string) =>
    request<{ ok: true; link?: string; draftId?: string }>(`/notes/${id}/confirm`, {
      method: "POST",
    }),
  complete: (id: string) => request<Note>(`/notes/${id}/complete`, { method: "POST" }),
  remove: (id: string) => request<void>(`/notes/${id}`, { method: "DELETE" }),
};
