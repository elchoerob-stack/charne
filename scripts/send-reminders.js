// Kick-off reminder sender for the Bok Family Predictor.
//
// Finds matches kicking off within the next 2 hours where a subscribed person
// hasn't predicted yet, and sends them a web push notification. Safe to run on
// any schedule (hourly is plenty): each match is reminded about exactly once.
//
// Required setup (none of these belong in git):
//   - service-account-key.json next to this file (Firebase console →
//     Project settings → Service accounts → Generate new private key)
//   - VAPID_PRIVATE_KEY env var (pairs with the public key baked into the app)
//
// Run:  VAPID_PRIVATE_KEY=... node send-reminders.js
const admin = require("firebase-admin");
const webpush = require("web-push");

const VAPID_PUBLIC_KEY = "BJmuttRyryMqveEFKTaPzjh9uMl5QzmYcOAYei8E7fGbYSktHWrRSvM6J0vmYBBiydJDlgGOV0YQYAp2snQ3doI";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const REMINDER_WINDOW_MS = 2 * 60 * 60 * 1000;

function keyFor(name) {
  return String(name).trim().toLowerCase().replace(/[.\/\[\]~*]/g, "_").replace(/\s+/g, " ");
}

async function run(db) {
  const now = Date.now();
  const matchesSnap = await db.collection("matches").get();
  const dueMatches = [];
  matchesSnap.forEach((doc) => {
    const m = doc.data();
    if (m.f || !m.ko || m.remindedAt) return;
    const untilKickoff = m.ko - now;
    if (untilKickoff > REMINDER_WINDOW_MS || untilKickoff < 0) return;
    dueMatches.push({ id: doc.id, ...m });
  });
  if (!dueMatches.length) return { sent: 0, matches: 0 };

  const subsSnap = await db.collection("pushSubs").get();
  const subs = [];
  subsSnap.forEach((doc) => subs.push({ id: doc.id, ...doc.data() }));

  let sent = 0;
  for (const m of dueMatches) {
    const predictedKeys = new Set(Object.keys(m.p || {}));
    const targets = subs.filter((s) => !s.name || !predictedKeys.has(keyFor(s.name)));

    const payload = JSON.stringify({
      title: "🏉 " + m.h + " vs " + m.a,
      body: "Kick-off soon — add your prediction before it locks!",
      url: "./#m=" + m.id,
    });

    for (const t of targets) {
      try {
        await webpush.sendNotification(t.sub, payload);
        sent++;
      } catch (err) {
        // 410/404 = the subscription is dead (app uninstalled, permissions
        // revoked) — clean it up so we stop trying.
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.collection("pushSubs").doc(t.id).delete();
        }
      }
    }
    await db.collection("matches").doc(m.id).update({ remindedAt: now });
  }
  return { sent, matches: dueMatches.length };
}

if (require.main === module) {
  if (!VAPID_PRIVATE_KEY) {
    console.error("Set the VAPID_PRIVATE_KEY environment variable first.");
    process.exit(1);
  }
  webpush.setVapidDetails("mailto:elchoerob@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const serviceAccount = require("./service-account-key.json");
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  run(admin.firestore())
    .then((r) => console.log("Reminders sent:", r))
    .catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run, keyFor, REMINDER_WINDOW_MS };
