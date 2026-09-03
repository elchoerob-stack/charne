import { useState } from "react";
import { api, type Note } from "../api";

interface NoteListProps {
  notes: Note[];
  onChanged: () => void;
}

function field(extracted: Record<string, unknown>, key: string): string {
  const v = extracted[key];
  return typeof v === "string" ? v : "";
}

function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ActionCard({ note, onChanged }: { note: Note; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmedMsg, setConfirmedMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => ({ ...note.extracted }));

  const isCalendar = note.intent === "calendar_event";
  const label = isCalendar ? "Calendar event" : "Email draft";

  const save = async () => {
    setBusy(true);
    try {
      await api.update(note.id, { extracted: draft });
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await api.confirm(note.id);
      setConfirmedMsg(isCalendar ? "Booked on your calendar" : "Saved as a Gmail draft — review & send from Gmail");
      onChanged();
      void result;
    } catch (err) {
      setConfirmedMsg(`Failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card action-card">
      <div className="card-header">
        <span className="badge">{label}</span>
        <h3>{note.title}</h3>
      </div>

      {editing ? (
        isCalendar ? (
          <div className="fields">
            <label>
              Summary
              <input
                value={field(draft, "summary")}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              />
            </label>
            <label>
              Start
              <input
                type="datetime-local"
                value={toLocalInput(field(draft, "start"))}
                onChange={(e) => setDraft({ ...draft, start: new Date(e.target.value).toISOString() })}
              />
            </label>
            <label>
              End
              <input
                type="datetime-local"
                value={toLocalInput(field(draft, "end"))}
                onChange={(e) => setDraft({ ...draft, end: new Date(e.target.value).toISOString() })}
              />
            </label>
            <label>
              Location
              <input
                value={field(draft, "location")}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              />
            </label>
          </div>
        ) : (
          <div className="fields">
            <label>
              To
              <input value={field(draft, "to")} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </label>
            <label>
              Subject
              <input
                value={field(draft, "subject")}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
            </label>
            <label>
              Body
              <textarea
                value={field(draft, "body")}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                rows={4}
              />
            </label>
          </div>
        )
      ) : (
        <div className="summary">
          {isCalendar ? (
            <>
              <div>{field(note.extracted, "summary")}</div>
              <div className="muted">
                {new Date(field(note.extracted, "start")).toLocaleString()} –{" "}
                {new Date(field(note.extracted, "end")).toLocaleTimeString()}
              </div>
              {field(note.extracted, "location") && <div className="muted">{field(note.extracted, "location")}</div>}
            </>
          ) : (
            <>
              <div className="muted">To: {field(note.extracted, "to") || "(unspecified)"}</div>
              <div>{field(note.extracted, "subject")}</div>
              <div className="muted">{field(note.extracted, "body")}</div>
            </>
          )}
        </div>
      )}

      {note.status === "confirmed" ? (
        <div className="confirmed-row">
          <span className="muted">{confirmedMsg ?? (isCalendar ? "Booked" : "Drafted in Gmail")}</span>
          <button onClick={() => api.complete(note.id).then(onChanged)}>Mark done</button>
        </div>
      ) : (
        <div className="card-actions">
          {editing ? (
            <button onClick={save} disabled={busy}>
              Save
            </button>
          ) : (
            <button onClick={() => setEditing(true)}>Edit</button>
          )}
          <button className="primary" onClick={confirm} disabled={busy}>
            {isCalendar ? "Book it" : "Create draft"}
          </button>
          <button className="ghost" onClick={() => api.remove(note.id).then(onChanged)}>
            Discard
          </button>
        </div>
      )}
      {confirmedMsg && note.status !== "confirmed" && <p className="error">{confirmedMsg}</p>}
    </div>
  );
}

function TodoRow({ note, onChanged }: { note: Note; onChanged: () => void }) {
  return (
    <label className="todo-row">
      <input type="checkbox" onChange={() => api.complete(note.id).then(onChanged)} />
      <span>{note.title ?? note.transcript}</span>
      <button className="ghost small" onClick={() => api.remove(note.id).then(onChanged)}>
        ✕
      </button>
    </label>
  );
}

export function NoteList({ notes, onChanged }: NoteListProps) {
  const thinking = notes.filter((n) => n.status === "new");
  const actions = notes.filter(
    (n) => n.intent !== "todo" && (n.status === "ready" || n.status === "confirmed")
  );
  const todos = notes.filter((n) => n.intent === "todo" && n.status === "ready");
  const done = notes.filter((n) => n.status === "done");

  return (
    <div className="note-list">
      {thinking.map((n) => (
        <div key={n.id} className="card thinking">
          <p className="muted">{n.transcript}</p>
          <p className="spinner">Thinking…</p>
        </div>
      ))}

      {actions.length > 0 && (
        <section>
          <h2>Ready to action</h2>
          {actions.map((n) => (
            <ActionCard key={n.id} note={n} onChanged={onChanged} />
          ))}
        </section>
      )}

      {todos.length > 0 && (
        <section>
          <h2>To do</h2>
          {todos.map((n) => (
            <TodoRow key={n.id} note={n} onChanged={onChanged} />
          ))}
        </section>
      )}

      {done.length > 0 && (
        <section className="done-section">
          <h2>Done</h2>
          {done.map((n) => (
            <div key={n.id} className="done-row muted">
              {n.title ?? n.transcript}
            </div>
          ))}
        </section>
      )}

      {notes.length === 0 && <p className="empty">No notes yet — capture one above.</p>}
    </div>
  );
}
