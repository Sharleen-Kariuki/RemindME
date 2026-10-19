// src/pages/MenteeDashboard.jsx — lightweight; no heavy deps allowed here.
import { useEffect, useState } from 'react';
import { API_URL, VAPID_PUBLIC_KEY } from '../config.js';

// The Push API wants the VAPID key as a Uint8Array, not a base64url string.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function MenteeDashboard() {
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const [permission, setPermission] = useState(supported ? Notification.permission : 'unsupported');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // On load, check whether this device is already subscribed.
  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {});
  }, [supported]);

  async function enableReminders() {
    setError('');
    setBusy(true);
    try {
      if (!VAPID_PUBLIC_KEY) throw new Error('Missing VITE_VAPID_PUBLIC_KEY in client/.env');

      // 1. Ask for permission (must be triggered by a user gesture — this click).
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') throw new Error('Notifications were not allowed on this device.');

      // 2. Subscribe through the service worker's PushManager.
      const reg = await navigator.serviceWorker.ready;
      const subscription =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true, // required by browsers: every push must show a notification
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));

      // 3. Send it to the backend. PushSubscription has toJSON() => { endpoint, keys }.
      const res = await fetch(`${API_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!res.ok) throw new Error('Could not save your subscription. Try again.');
      setSubscribed(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <h1>RemindME</h1>
      <p className="muted">Get a nudge on your phone when it’s time to log your session attendance.</p>

      {!supported && (
        <p className="notice error">
          This browser can’t receive push notifications. On iPhone, add RemindME to your Home Screen
          first (Share → Add to Home Screen), then open it from there.
        </p>
      )}

      {supported && permission === 'denied' && (
        <p className="notice error">
          Notifications are blocked. Turn them back on in your browser’s site settings, then reload.
        </p>
      )}

      {supported && subscribed && permission === 'granted' && (
        <p className="notice ok">You’re set. Reminders will arrive on this device.</p>
      )}

      {supported && !subscribed && permission !== 'denied' && (
        <button onClick={enableReminders} disabled={busy}>
          {busy ? 'Turning on…' : 'Turn on reminders'}
        </button>
      )}

      {error && <p className="notice error">{error}</p>}
    </main>
  );
}
