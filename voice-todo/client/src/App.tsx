import { useCallback, useEffect, useState } from "react";
import { api, type Note } from "./api";
import { Capture } from "./components/Capture";
import { NoteList } from "./components/NoteList";

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);

  const refresh = useCallback(() => {
    api.list().then(setNotes).catch(console.error);
  }, []);

  useEffect(() => {
    refresh();
    // Pick up classification results that finish shortly after capture.
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div className="app">
      <header>
        <h1>Voice Todo</h1>
      </header>
      <Capture onCaptured={refresh} />
      <NoteList notes={notes} onChanged={refresh} />
    </div>
  );
}
