import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const SpeechRecognitionCtor =
  typeof window !== "undefined" ? window.SpeechRecognition ?? window.webkitSpeechRecognition : undefined;

interface CaptureProps {
  onCaptured: () => void;
}

export function Capture({ onCaptured }: CaptureProps) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [manualText, setManualText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const recognitionRef = useRef<InstanceType<NonNullable<typeof SpeechRecognitionCtor>> | null>(null);

  useEffect(() => {
    if (!SpeechRecognitionCtor) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      let combined = "";
      for (let i = 0; i < event.results.length; i++) {
        combined += event.results[i][0].transcript;
      }
      setTranscript(combined.trim());
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, []);

  const startListening = () => {
    setTranscript("");
    setListening(true);
    recognitionRef.current?.start();
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const submit = async (text: string) => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const note = await api.create(text.trim());
      setTranscript("");
      setManualText("");
      onCaptured();
      // Classify in the background; the list will show a "thinking" state.
      api.process(note.id).then(onCaptured).catch(console.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="capture">
      {SpeechRecognitionCtor ? (
        <>
          <button
            className={`mic-button ${listening ? "listening" : ""}`}
            onClick={listening ? stopListening : startListening}
            aria-label={listening ? "Stop recording" : "Start recording"}
          >
            {listening ? "■" : "●"}
          </button>
          <p className="transcript-preview">
            {listening ? transcript || "Listening…" : transcript || "Tap to speak a task"}
          </p>
          {!listening && transcript && (
            <div className="capture-actions">
              <button onClick={() => submit(transcript)} disabled={submitting}>
                Add task
              </button>
              <button className="ghost" onClick={() => setTranscript("")}>
                Discard
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="unsupported">
          Voice capture isn't supported in this browser. Type it instead — it'll still get
          classified the same way.
        </p>
      )}

      <form
        className="manual-add"
        onSubmit={(e) => {
          e.preventDefault();
          submit(manualText);
        }}
      >
        <input
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          placeholder="Or type a task…"
        />
        <button type="submit" disabled={submitting || !manualText.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
