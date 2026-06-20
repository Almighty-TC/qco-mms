// ─── TRACEABILITY SHARED UTILITIES ────────────────────────────
// Dark/light token set + date / byte formatters shared by the
// Traceability screen and its six modals. Mirrors the inline token
// pattern used across the other module screens.
import type React from 'react'

export { API } from '../../lib/api'

// ─── TOKENS ───────────────────────────────────────────────────
export interface Tokens {
  col: string; cardBg: string; bg: string; bd: string; sub: string; theadBg: string; rowBd: string
  inputBg: string
}
export const tokens = (dark: boolean): Tokens => ({
  col:     dark ? '#f1f5f9' : '#0f172a',
  cardBg:  dark ? '#1e293b' : '#fff',
  bg:      dark ? '#0f172a' : '#f4f7fb',
  bd:      `1px solid ${dark ? '#334155' : '#dde3ed'}`,
  sub:     '#94a3b8',
  theadBg: dark ? '#162032' : '#f8fafc',
  rowBd:   `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`,
  inputBg: dark ? '#0f172a' : '#f8fafc',
})

// ─── DATE FORMAT ──────────────────────────────────────────────
// Formats backend YYYY-MM-DD strings (the API DATE_FORMATs date
// columns, so no timezone shift) into "DD Mon YYYY". Pre-formatted
// display strings (e.g. trace lifecycle "12 Jan 2025") and the
// literal '—' pass through unchanged. Date parts are read directly —
// never via new Date() — so the calendar date is tz-independent.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDate = (d: string | null | undefined): string => {
  if (!d || d === '—') return '—'
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
  return d // already a display string like "12 Jan 2025"
}

// ─── BYTE FORMAT ──────────────────────────────────────────────
export const fmtBytes = (b: number | null | undefined): string => {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} kB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

// ─── MODAL SCRIM + SHELL STYLES ───────────────────────────────
export const scrimStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 6000,
}
export const centeredModal = (cardBg: string, bd: string, width: number): React.CSSProperties => ({
  position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
  background: cardBg, border: bd, borderRadius: 12, zIndex: 6001, width, maxWidth: '95vw',
  maxHeight: '88vh', overflow: 'auto', fontFamily: 'IBM Plex Sans, sans-serif',
  boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
})
