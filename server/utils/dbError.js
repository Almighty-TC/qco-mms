// ─── DB / WRITE ERROR GATE ───────────────────────────────────
// One place that turns common MySQL constraint errors into clean, user-facing
// responses instead of a raw 500. Drop-in replacement for the old
//   catch (e) { res.status(500).json({ error: e.message }) }
// pattern: call dbError(res, e) — known constraint violations become 409/400
// with a friendly message; anything else keeps the previous behaviour
// (status 500 with the route's fallback or the error message), so it is a
// safe, backwards-compatible swap.

function friendly(code, e) {
  switch (code) {
    case 'ER_DUP_ENTRY': {
      const m = /Duplicate entry '(.+?)' for key/.exec(e.sqlMessage || e.message || '')
      return m ? `"${m[1]}" already exists — it must be unique.` : 'That record already exists.'
    }
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return 'A linked record does not exist (it may have been removed). Refresh and try again.'
    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return 'This record is still used by other records and cannot be deleted.'
    case 'ER_DATA_TOO_LONG':
      return 'One of the values is too long for its field.'
    case 'ER_BAD_NULL_ERROR':
      return 'A required field is missing.'
    case 'ER_TRUNCATED_WRONG_VALUE':
    case 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD':
    case 'WARN_DATA_TRUNCATED':
      return 'A value has the wrong format for its field.'
    case 'ER_WARN_DATA_OUT_OF_RANGE':
      return 'A number is out of the allowed range.'
    default:
      return null
  }
}

const STATUS = {
  ER_DUP_ENTRY: 409,
  ER_NO_REFERENCED_ROW: 400, ER_NO_REFERENCED_ROW_2: 400,
  ER_ROW_IS_REFERENCED: 409, ER_ROW_IS_REFERENCED_2: 409,
  ER_DATA_TOO_LONG: 400, ER_BAD_NULL_ERROR: 400,
  ER_TRUNCATED_WRONG_VALUE: 400, ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: 400,
  WARN_DATA_TRUNCATED: 400, ER_WARN_DATA_OUT_OF_RANGE: 400,
}

function dbError(res, e, fallback) {
  // App-thrown validation errors carry an http status — honour it verbatim.
  if (e && e.http) return res.status(e.http).json({ error: e.message })
  const code = e && e.code
  const msg = code && friendly(code, e)
  if (msg) return res.status(STATUS[code] || 400).json({ error: msg })
  // Unknown error → previous behaviour (500), but log the detail server-side.
  console.error('[error]', code || '', (e && (e.sqlMessage || e.message)) || e)
  return res.status(500).json({ error: fallback || (e && e.message) || 'Internal server error' })
}

module.exports = { dbError }
