# Workflow recorder

Two halves: a browser extension that captures what a user does in CMS, and a
server-side compiler that turns the capture into an SOP, a replay script and
diagnostic evidence.

## Capture (extension)

See `recorder-extension/README.md` for install and use. Design points:

- **Two purposes.** *SOP* captures are training material; *Problem* captures
  are evidence. The same event stream serves both.
- **Stable targets.** Each action records the interactive ancestor of the
  clicked node with role, accessible name, visible text, `data-testid`, id,
  placeholder and a short CSS path. That is what makes SOP text human
  ("Click the **Save booking** button") and replay scripts robust
  (`getByRole("button", { name: "Save booking" })`).
- **Page signals.** `fetch`/XHR are wrapped in the page context to log method,
  URL, status and duration; window errors, unhandled rejections and
  `console.error` are captured; online/offline and tab visibility are noted.
- **Screenshots** are taken on clicks and page loads, throttled to one per
  1.5 s, JPEG quality 45, and stored separately from the event stream so SOPs
  stay small.
- **POPIA masking** happens in the content script before anything reaches the
  background worker: password/tel/email inputs, sensitive-looking field names,
  and values matching SA ID numbers, mobile numbers, e-mails or card numbers.

## Compile (server)

`server/src/recorder/sop.ts`:

- `compileSop(recording)` drops noise (scroll, visibility), collapses
  keystroke-level inputs into one "Enter X in Y" step, removes the click that
  only focused a field, de-duplicates double clicks, keeps Enter/Tab/Escape,
  attaches every error and failed request to the step it followed, and splits
  steps into sections per screen.
- `renderSopMarkdown` produces a shareable procedure with a metadata line,
  screen headings, numbered steps and an anomalies appendix.
- `renderPlaywright` produces a `@playwright/test` script using the best
  available locator per step; masked values are emitted as `<MASKED>` so the
  test author supplies test data.
- `evidenceFromRecording` builds the `Evidence` object for the diagnostic
  engine: failed requests, console errors, p95 latency, offline flag, last URL.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/recordings` | Upload a recording (extension or JSON file) |
| GET | `/api/recordings` | List recordings |
| GET | `/api/recordings/:id` | Raw recording (without screenshots) |
| GET | `/api/recordings/:id/sop?format=json|md|playwright` | Compiled SOP |
| GET | `/api/recordings/:id/screenshots/:sid` | A screenshot |
| POST | `/api/diagnose` | Run the engine directly `{symptom, recording_id?, answers?, facts?}` |

`server/test/sop.test.ts` covers collapsing, anomaly attachment, both
renderers and evidence extraction. A sample recording lives in
`server/test/fixtures/sample-recording.json`.
