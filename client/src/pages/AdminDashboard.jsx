// src/pages/AdminDashboard.jsx — lazy-loaded; mentees never download this file.
import { useState } from 'react';
import { API_URL } from '../config.js';

// SECURITY NOTE: The password is NOT hardcoded in this file (it would be readable by
// anyone who opens the JS bundle). The prompt below just sends what you type to the
// server in an `x-admin-password` header, and the server (ADMIN_PASSWORD env var)
// decides. Replace with real auth (JWT / Supabase Auth) later.
async function adminFetch(path, password, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function parseSessions(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Calendar JSON must be an array.');
  return parsed;
}

export default function AdminDashboard() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);

  const [sessions, setSessions] = useState([]); // [{ date: '2026-11-03', startTime: '10:00' }]
  const [rules, setRules] = useState([]); // [{ offsetHours: 1, message: '...' }]
  const [mode, setMode] = useState('form'); // 'form' | 'json'
  const [jsonText, setJsonText] = useState('[]');
  const [status, setStatus] = useState(null); // { type: 'ok' | 'error', text }

  async function handleLogin(e) {
    e.preventDefault();
    setStatus(null);
    try {
      const config = await adminFetch('/admin/config', password);
      setSessions(config.calendar || []);
      setRules(config.rules || []);
      setAuthed(true);
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    }
  }

  // ---- Calendar helpers ----
  const updateSession = (i, field, value) =>
    setSessions((s) => s.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  const addSession = () => setSessions((s) => [...s, { date: '', startTime: '' }]);
  const removeSession = (i) => setSessions((s) => s.filter((_, idx) => idx !== i));

  function switchMode(next) {
    setStatus(null);
    try {
      if (next === 'json') setJsonText(JSON.stringify(sessions, null, 2));
      if (next === 'form') setSessions(parseSessions(jsonText));
      setMode(next);
    } catch (err) {
      setStatus({ type: 'error', text: `Invalid JSON: ${err.message}` });
    }
  }

  // ---- Rule helpers ----
  const updateRule = (i, field, value) =>
    setRules((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  const addRule = () => setRules((r) => [...r, { offsetHours: 1, message: '' }]);
  const removeRule = (i) => setRules((r) => r.filter((_, idx) => idx !== i));

  async function handleSave(e) {
    e.preventDefault();
    setStatus(null);
    try {
      const calendar = mode === 'json' ? parseSessions(jsonText) : sessions;
      const cleanRules = rules.map((r) => ({
        offsetHours: Number(r.offsetHours),
        message: String(r.message).trim(),
      }));

      await adminFetch('/admin/calendar', password, {
        method: 'POST',
        body: JSON.stringify({ calendar }),
      });
      const result = await adminFetch('/admin/rules', password, {
        method: 'POST',
        body: JSON.stringify({ rules: cleanRules }),
      });

      setSessions(calendar);
      setStatus({ type: 'ok', text: `Saved. ${result.scheduledJobs} reminder(s) scheduled.` });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    }
  }

  // ---------- Password gate ----------
  if (!authed) {
    return (
      <main className="page narrow">
        <h1>Admin sign in</h1>
        <form onSubmit={handleLogin} className="stack">
          <label>
            Admin password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit">Sign in</button>
        </form>
        {status && <p className={`notice ${status.type}`}>{status.text}</p>}
      </main>
    );
  }

  // ---------- Dashboard ----------
  return (
    <main className="page">
      <h1>Session reminders</h1>

      <form onSubmit={handleSave} className="stack">
        <section>
          <div className="row between">
            <h2>Session calendar</h2>
            <div className="row">
              <button type="button" className="ghost" onClick={() => switchMode(mode === 'form' ? 'json' : 'form')}>
                {mode === 'form' ? 'Edit as JSON' : 'Edit as form'}
              </button>
            </div>
          </div>

          {mode === 'json' ? (
            <textarea
              rows={10}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
              aria-label="Session calendar JSON"
            />
          ) : (
            <>
              {sessions.length === 0 && <p className="muted">No sessions yet. Add the first one.</p>}
              {sessions.map((s, i) => (
                <div className="row" key={i}>
                  <input
                    type="date"
                    value={s.date}
                    onChange={(e) => updateSession(i, 'date', e.target.value)}
                    aria-label={`Session ${i + 1} date`}
                    required
                  />
                  <input
                    type="time"
                    value={s.startTime}
                    onChange={(e) => updateSession(i, 'startTime', e.target.value)}
                    aria-label={`Session ${i + 1} start time`}
                    required
                  />
                  <button type="button" className="ghost" onClick={() => removeSession(i)}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className="ghost" onClick={addSession}>Add session</button>
            </>
          )}
        </section>

        <section>
          <h2>Timeout rules</h2>
          <p className="muted">Send a message this many hours after a session starts. Use 0 for the start time.</p>
          {rules.length === 0 && <p className="muted">No rules yet. Add one to start sending reminders.</p>}
          {rules.map((r, i) => (
            <div className="row" key={i}>
              <label className="inline">
                After
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={r.offsetHours}
                  onChange={(e) => updateRule(i, 'offsetHours', e.target.value)}
                  style={{ width: '5rem' }}
                  required
                />
                hours
              </label>
              <input
                type="text"
                placeholder="Message to send"
                value={r.message}
                onChange={(e) => updateRule(i, 'message', e.target.value)}
                aria-label={`Rule ${i + 1} message`}
                style={{ flex: 1 }}
                required
              />
              <button type="button" className="ghost" onClick={() => removeRule(i)}>Remove</button>
            </div>
          ))}
          <button type="button" className="ghost" onClick={addRule}>Add rule</button>
        </section>

        <button type="submit">Save and reschedule</button>
        {status && <p className={`notice ${status.type}`} role="status">{status.text}</p>}
      </form>
    </main>
  );
}
