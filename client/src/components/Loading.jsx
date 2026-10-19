// src/components/Loading.jsx — Suspense fallback while the Admin chunk downloads.
export default function Loading() {
    return (
      <div className="page" role="status" aria-live="polite">
        <p className="muted">Loading…</p>
      </div>
    );
  }