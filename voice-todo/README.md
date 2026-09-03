# Voice Todo

Capture a task by voice from your phone; review, edit, and action it from any
device — including having Claude turn the note into a ready-to-book calendar
event or a ready-to-send email draft, which you confirm with one tap.

## How it works

```
Phone (or laptop) — PWA
  1. Tap the mic, speak the task.
  2. Browser's on-device speech recognition produces a live transcript.
  3. Transcript is POSTed to the server and saved immediately (status: new).

Server
  4. Claude (Anthropic API) classifies the transcript:
       - plain todo               → nothing further to do
       - "meeting with X at 3pm"  → calendar_event {summary, start, end, location}
       - "email Y about Z"        → email_draft {to, subject, body}
     Note moves to status: ready.

Any device — same app
  5. The note list shows a "Ready to action" card for calendar/email items,
     pre-filled and editable, next to a plain checklist for ordinary todos.
  6. You tap Confirm:
       - calendar_event → creates the event directly on your Google Calendar.
       - email_draft    → creates a Gmail DRAFT only. It is never sent
                           automatically — you still open Gmail and hit send.
     Note moves to status: confirmed, then done once you check it off.
```

Nothing leaves your control without a tap: Claude only ever *prepares* an
action, and even "confirm" on an email stops at a draft, never a send.

## Why this shape

- **One app, not two.** The phone and the laptop are the same PWA talking to
  the same server/database — no separate "capture app" + "action app" to keep
  in sync.
- **Direct API integrations** (not Zapier/IFTTT): Anthropic SDK for
  classification, `googleapis` for Calendar + Gmail. More setup up front, but
  no third-party middleman holding your OAuth tokens, and no per-task
  automation-platform run costs.
- **Single user, no accounts.** This is scoped for one person (you), so there's
  no login system — just API keys and a Google OAuth refresh token in `.env`.

## Setup

### 1. Server

```bash
cd server
npm install
cp .env.example .env
```

Fill in `.env`:

- `ANTHROPIC_API_KEY` — from https://console.anthropic.com/settings/keys
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — create an OAuth client
  (Application type: **Desktop app**) in the Google Cloud Console for a
  project that has the **Google Calendar API** and **Gmail API** enabled.
- `GOOGLE_REFRESH_TOKEN` — run the one-time helper, which opens a consent URL
  and prints the token to paste in:

  ```bash
  npm run google:auth
  ```

Then start the API:

```bash
npm run dev   # http://localhost:4000
```

Notes are stored in a local SQLite file at `server/data/voice-todo.sqlite`
(gitignored) — no external database to stand up.

### 2. Client

```bash
cd client
npm install
npm run dev   # http://localhost:5173, proxies /api to the server
```

Open it on your phone (same Wi-Fi, `http://<your-laptop-ip>:5173`) and use
"Add to Home Screen" to install it as a PWA — that's what gives you the
one-tap capture icon instead of opening a browser and typing a URL.

For real phone use you'll want to deploy both (e.g. the server on Fly.io/
Render, the client on Vercel/Netlify/Cloudflare Pages) behind HTTPS — Web
Speech API and PWA install both require a secure origin.

## Known limitations / next steps

- **iOS Safari** doesn't support the Web Speech API, so voice capture there
  falls back to the "type it instead" field. A server-side Whisper
  transcription step (upload the recorded audio blob) would close that gap —
  not built here since Chrome/Android cover the primary "in the car" use
  case today.
- **Single Google account.** The refresh token is for one Google account
  (yours). Multi-user would need per-user OAuth and a real login.
- **No push notifications.** The list polls every few seconds while open;
  there's no "note captured" notification if the app isn't open.
