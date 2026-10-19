// server.js — RemindME backend (Express + web-push + node-schedule)
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import webpush from 'web-push';
import schedule from 'node-schedule';

const {
  PORT = 4000,
  CLIENT_ORIGIN = 'http://localhost:5173',
  ADMIN_PASSWORD,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = 'mailto:you@example.com',
  ATTENDANCE_URL = 'https://example.com/attendance',
  TZ_OFFSET = '+03:00',
} = process.env;

if (!ADMIN_PASSWORD || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Missing ADMIN_PASSWORD / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in server/.env');
  process.exit(1);
}
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

/* ------------------------------------------------------------------ *
 * DATA STORAGE (boilerplate: in-memory object persisted to data.json)
 *
 * TODO(MongoDB/Supabase): replace loadDb()/saveDb() and the direct `db.*`
 * reads/writes below with real queries, e.g.
 *   - subscriptions -> a `subscriptions` collection/table, unique index on `endpoint`
 *   - calendar      -> a `sessions` collection/table  { date, startTime }
 *   - rules         -> a `timeout_rules` collection/table { offsetHours, message }
 * Keep rescheduleAll() — just have it read from the DB instead of `db`.
 * ------------------------------------------------------------------ */
const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data.json');
let db = {
  subscriptions: [], // PushSubscription JSON: { endpoint, keys: { p256dh, auth } }
  calendar: [], // [{ date: 'YYYY-MM-DD', startTime: 'HH:mm' }]
  rules: [], // [{ offsetHours: Number, message: String }]
};

function loadDb() {
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch {
    /* first run: no file yet */
  }
}
function saveDb() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

/* ------------------------------ Push ------------------------------ */
async function broadcast(message) {
  const payload = JSON.stringify({ title: 'RemindME', body: message, url: ATTENDANCE_URL });

  const results = await Promise.allSettled(
    db.subscriptions.map((sub) => webpush.sendNotification(sub, payload))
  );

  // 404/410 = the browser has unsubscribed; drop those so we stop retrying forever.
  const dead = new Set();
  results.forEach((r, i) => {
    if (r.status === 'rejected' && [404, 410].includes(r.reason?.statusCode)) {
      dead.add(db.subscriptions[i].endpoint);
    }
  });
  if (dead.size) {
    db.subscriptions = db.subscriptions.filter((s) => !dead.has(s.endpoint));
    saveDb();
  }
  console.log(`[push] "${message}" -> ${results.length - dead.size} device(s), ${dead.size} removed`);
}

/* ------------------------ Scheduling engine ------------------------ */
let activeJobs = [];

function clearJobs() {
  activeJobs.forEach((job) => job.cancel());
  activeJobs = [];
}

// Builds one job per (session x rule): fires at sessionStart + offsetHours.
// Called on boot and every time the admin saves the calendar or rules.
// node-schedule jobs live in memory only, which is why we rebuild on boot.
function rescheduleAll() {
  clearJobs();
  const now = Date.now();

  for (const session of db.calendar) {
    // e.g. "2026-11-03T10:00:00+03:00" — the offset makes this independent of server timezone
    const start = new Date(`${session.date}T${session.startTime}:00${TZ_OFFSET}`);
    if (Number.isNaN(start.getTime())) continue;

    for (const rule of db.rules) {
      const fireAt = new Date(start.getTime() + rule.offsetHours * 3_600_000);
      if (fireAt.getTime() <= now) continue; // skip the past

      const job = schedule.scheduleJob(fireAt, () => broadcast(rule.message));
      if (job) activeJobs.push(job);
    }
  }
  console.log(`[scheduler] ${activeJobs.length} job(s) scheduled`);
  return activeJobs.length;
}

/* ----------------------------- Validation ----------------------------- */
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function validateCalendar(calendar) {
  if (!Array.isArray(calendar)) return 'calendar must be an array';
  for (const [i, s] of calendar.entries()) {
    if (!isDate(s?.date)) return `calendar[${i}].date must be YYYY-MM-DD`;
    if (!isTime(s?.startTime)) return `calendar[${i}].startTime must be HH:mm (24h)`;
  }
  return null;
}

function validateRules(rules) {
  if (!Array.isArray(rules)) return 'rules must be an array';
  for (const [i, r] of rules.entries()) {
    if (typeof r?.offsetHours !== 'number' || !Number.isFinite(r.offsetHours) || r.offsetHours < 0)
      return `rules[${i}].offsetHours must be a number >= 0`;
    if (typeof r?.message !== 'string' || !r.message.trim()) return `rules[${i}].message is required`;
  }
  return null;
}

/* ------------------------------ Express ------------------------------ */
const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// Simple shared-password guard. TODO: replace with real auth (JWT / Supabase Auth).
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
function requireAdmin(req, res, next) {
  const supplied = req.get('x-admin-password') || '';
  if (!crypto.timingSafeEqual(sha(supplied), sha(ADMIN_PASSWORD))) {
    return res.status(401).json({ error: 'Wrong admin password.' });
  }
  next();
}

// Mentee: save device subscription (de-duplicated by endpoint).
app.post('/subscribe', (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: 'Invalid push subscription.' });
  }
  db.subscriptions = db.subscriptions.filter((s) => s.endpoint !== sub.endpoint);
  db.subscriptions.push(sub);
  saveDb();
  res.status(201).json({ ok: true });
});

// Admin: read current config.
app.get('/admin/config', requireAdmin, (_req, res) => {
  res.json({ calendar: db.calendar, rules: db.rules, subscribers: db.subscriptions.length });
});

// Admin: replace the session calendar, then reschedule.
app.post('/admin/calendar', requireAdmin, (req, res) => {
  const error = validateCalendar(req.body?.calendar);
  if (error) return res.status(400).json({ error });
  db.calendar = req.body.calendar;
  saveDb();
  res.json({ ok: true, scheduledJobs: rescheduleAll() });
});

// Admin: replace the timeout rules, then reschedule.
app.post('/admin/rules', requireAdmin, (req, res) => {
  const error = validateRules(req.body?.rules);
  if (error) return res.status(400).json({ error });
  db.rules = req.body.rules;
  saveDb();
  res.json({ ok: true, scheduledJobs: rescheduleAll() });
});

loadDb();
rescheduleAll();
app.listen(PORT, () => console.log(`RemindME API listening on http://localhost:${PORT}`));