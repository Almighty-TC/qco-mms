// ─── DB / WRITE ERROR GATE ───────────────────────────────────
// One place that turns common MySQL constraint errors into clean, user-facing
// responses instead of a raw 500. Drop-in replacement for the old
//   catch (e) { res.status(500).json({ error: e.message }) }
// pattern: call dbError(res, e) — known constraint violations become 409/400
// with a friendly message; anything else is a 500 with the route's fallback.
// Without a fallback, driver, system and built-in runtime errors get a generic
// message (see isUnsafe) and only code-less plain Errors pass their message through.

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

// Errors whose message can carry internals — the database user and host, SQL, file paths, property
// names: any error with a string code we don't map (ER_*, ERR_*, ECONN*, ENOENT, PROTOCOL_* …), an
// sqlState or a numeric errno (driver and system errors), and the built-in runtime error types. Their
// response is generic; the detail goes to the log only. Code-less plain Errors pass through as before.
const BUILTIN_ERRORS = [TypeError, ReferenceError, RangeError, SyntaxError, EvalError, URIError]
const isUnsafe = e => !!e && (
  (typeof e.code === 'string' && !Object.prototype.hasOwnProperty.call(STATUS, e.code)) ||
  e.sqlState != null || typeof e.errno === 'number' ||
  BUILTIN_ERRORS.some(T => e instanceof T))

// One log line per unmapped error: route, user and the error's own fields, then the stack.
// Never the request body, headers or token.
function logError(res, e) {
  const req = res?.req
  const detail = {
    method: req?.method, path: (req?.originalUrl ?? req?.url ?? '').split('?')[0] || undefined, user: req?.user?.id,
    code: e?.code, errno: e?.errno, sqlState: e?.sqlState, message: e?.sqlMessage ?? e?.message ?? String(e),
  }
  console.error('[error]', JSON.stringify(detail), e?.stack ? `\n${e.stack}` : '')
}

function dbError(res, e, fallback) {
  // App-thrown validation errors carry an http status — honour it verbatim.
  if (e && e.http) return res.status(e.http).json({ error: e.message })
  const code = e && e.code
  const msg = code && friendly(code, e)
  if (msg) return res.status(STATUS[code] || 400).json({ error: msg })
  // Unknown error → 500, with the detail logged server-side. A driver, system or built-in runtime
  // error never sends its own message to the client.
  logError(res, e)
  if (isUnsafe(e)) return res.status(500).json({ error: fallback || 'Internal server error' })
  return res.status(500).json({ error: fallback || (e && e.message) || 'Internal server error' })
}

module.exports = { dbError }
