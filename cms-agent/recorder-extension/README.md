# CMS Workflow Recorder (browser extension)

Records a CMS workflow in the current tab and turns it into an SOP or a problem
capture for CMS Agent.

What it captures:

- clicks, typed values, dropdown selections, Enter/Tab/Escape, form submits
- navigation (full loads and single-page route changes), page titles
- a throttled screenshot on every click and page load
- console errors, unhandled promise rejections, and every fetch/XHR with status and duration
- online/offline transitions and tab visibility
- free-text notes you add while recording ("expected the OTP screen here")

What it masks (POPIA): password/tel/email fields, anything whose field name
looks sensitive (ID, PIN, OTP, card, account), and any value that looks like an
SA ID number, mobile number, e-mail address or card number. Masked values show
as `••••` and are marked `sensitive` so SOPs and Playwright exports never carry
customer data.

## Install (Chrome / Edge)

1. Open `chrome://extensions`, enable Developer mode.
2. Load unpacked → select this `recorder-extension` folder.
3. Click the extension, open Server settings and enter the CMS Agent URL
   (default `http://localhost:8787`) and the token if the server uses one.

## Use

1. Open the CMS screen where the workflow starts. Click the extension, enter a
   title, pick SOP or Problem capture, and Start.
2. Work through the task. Add notes at the point where something went wrong.
3. Stop, then Send to CMS Agent (or Download JSON and upload it later via
   `POST /api/recordings`).

In the CMS Agent console the recording appears under Recordings with a
generated SOP (markdown), a Playwright replay script, and a one-click
"Diagnose from this recording" action.
