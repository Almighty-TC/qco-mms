// ─── API BASE (single source of truth) ──────────────────────
// The backend origin for every frontend request. Read from VITE_API_URL,
// which Vite INLINES at build time — so a deployed frontend must be BUILT
// with VITE_API_URL pointing at the backend (it cannot be changed at runtime).
// Falls back to localhost for local dev.
export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

// Convenience base for the REST API. Use `${API}/...` for endpoints, and
// API_BASE directly for non-/api paths (e.g. `${API_BASE}/docs/...`).
export const API = `${API_BASE}/api`
