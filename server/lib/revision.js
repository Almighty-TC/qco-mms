// ─── MTO REVISION RULES (format + ordering) ──────────────────────────────────
// Single source of truth for revision validation and ordering, kept standalone so
// it is unit-testable in isolation (see scripts/test_revision.cjs). A revision is a
// dash-separated string of segments, e.g. "A", "A-7", "A-7-B".
//
// FORMAT:   max 10 chars; only letters, digits and dashes; no empty segments.
// SCHEME:   within one MTO's revision history each segment POSITION is consistently
//           typed (letter vs number). A new rev that puts a LETTER where the scheme
//           has a NUMBER (or vice-versa) at the same position is INVALID INPUT —
//           we do not try to order letter-vs-number; we reject it.
// ORDERING: compare segment by segment, left→right; the first differing segment
//           decides. Letters compare A→Z (case-insensitive; a longer pure-letter run
//           is later, so Z < AA). Numbers compare numerically (2 < 10). If every
//           shared segment is equal, the revision with MORE segments is NEWER
//           (A-1-1 > A-1).
//
// compareRevisions(a, b) → -1 | 0 | 1, and THROWS RevisionError on bad format or a
// scheme (type) mismatch — so callers surface a clear message instead of a silent
// mis-order. Format-only callers can use validateRevisionFormat().

class RevisionError extends Error {
  constructor(message, code) { super(message); this.name = 'RevisionError'; this.code = code } // code: 'FORMAT' | 'SCHEME'
}

const FORMAT_RE = /^[A-Za-z0-9-]{1,10}$/

// Returns an error string if the revision is malformed, else null.
function validateRevisionFormat(rev) {
  const s = String(rev == null ? '' : rev).trim()
  if (!FORMAT_RE.test(s))
    return 'Revision must be 1–10 characters using only letters, numbers and dashes (e.g. A, A-7, A-7-B).'
  if (s.split('-').some(seg => seg === ''))
    return 'Revision segments cannot be empty — no leading, trailing or double dashes.'
  return null
}

// Per-segment type: 'num' (all digits), 'alpha' (all letters), 'mixed' (both).
function segType(seg) {
  if (/^[0-9]+$/.test(seg)) return 'num'
  if (/^[A-Za-z]+$/.test(seg)) return 'alpha'
  return 'mixed'
}

// Compare two revisions. -1 if a<b (a older), 0 if equal, 1 if a>b (a newer).
// Throws RevisionError('FORMAT') / RevisionError('SCHEME').
function compareRevisions(a, b) {
  for (const r of [a, b]) {
    const e = validateRevisionFormat(r)
    if (e) throw new RevisionError(e, 'FORMAT')
  }
  const A = String(a).trim().split('-')
  const B = String(b).trim().split('-')
  const shared = Math.min(A.length, B.length)
  for (let i = 0; i < shared; i++) {
    const sa = A[i], sb = B[i]
    const ta = segType(sa), tb = segType(sb)
    if (ta !== tb)
      throw new RevisionError(
        `Revision format doesn't match this item's revision scheme (segment ${i + 1} is ${tb === 'num' ? 'a number' : 'letters'} here, got ${ta === 'num' ? 'a number' : 'letters'}).`,
        'SCHEME')
    if (sa.toUpperCase() === sb.toUpperCase()) continue
    if (ta === 'num') {
      const d = Number(sa) - Number(sb)
      if (d !== 0) return d < 0 ? -1 : 1
    } else {
      // alpha/mixed: case-insensitive; a longer pure-letter run is later (Z < AA).
      const ua = sa.toUpperCase(), ub = sb.toUpperCase()
      if (ta === 'alpha' && ua.length !== ub.length) return ua.length < ub.length ? -1 : 1
      if (ua !== ub) return ua < ub ? -1 : 1
    }
  }
  // All shared segments equal → more segments wins (A-1-1 newer than A-1).
  if (A.length !== B.length) return A.length < B.length ? -1 : 1
  return 0
}

module.exports = { RevisionError, validateRevisionFormat, compareRevisions }
