// ─── SHARED INPUT VALIDATION HELPERS ─────────────────────────

// Ensure a sequence of dates is non-decreasing (logical ordering). Pass
// [label, value] pairs in the expected order; nulls/blanks are skipped, so it
// validates whatever subset is present. Returns an error string or null.
//   dateOrder([['CRD', crd], ['CCD', ccd], ['ETD', etd], ['ETA', eta]])
function dateOrder(pairs) {
  const present = pairs
    .filter(([, v]) => v != null && v !== '')
    .map(([label, v]) => [label, v, new Date(v)])
  for (const [label, raw, d] of present) {
    if (isNaN(d)) return `${label} is not a valid date.`
  }
  for (let i = 1; i < present.length; i++) {
    const [pl, , pd] = present[i - 1]
    const [cl, craw, cd] = present[i]
    if (cd < pd) {
      const f = d => d.toISOString().slice(0, 10)
      return `${cl} (${f(cd)}) cannot be earlier than ${pl} (${f(pd)}).`
    }
  }
  return null
}

// A multer file is present and not zero-byte.
function fileNotEmpty(file) {
  if (!file) return 'No file was uploaded.'
  if (!file.size && !(file.buffer && file.buffer.length)) return 'The uploaded file is empty.'
  return null
}

module.exports = { dateOrder, fileNotEmpty }
