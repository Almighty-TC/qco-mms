// Date strings in lineSignature (server/routes/mto.js) — the no-change check and the upload
// dry-run counts. lineSignature isn't exported, so it is read from the route file's source
// together with parseSheetDate (which calls parseCalendarDate from utils/validate.js) and run in a
// vm context (no database, no endpoint).
// Exit code 1 on any failure. Usage: node tests/csv/lineSignatureDates.test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm')
const SERVER = path.join(__dirname, '..', '..', 'server')
const XLSX = require(path.join(SERVER, 'node_modules', 'xlsx'))
const src = fs.readFileSync(path.join(SERVER, 'routes', 'mto.js'), 'utf8')
function block(start) {
  const i = src.indexOf(start); if (i < 0) throw new Error(`${start} not found in routes/mto.js`)
  let depth = 0, j = src.indexOf('{', i)
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break }
  return src.slice(i, j + 1)
}
const { parseCalendarDate } = require(path.join(SERVER, 'utils', 'validate.js'))   // parseSheetDate calls it
const ctx = { XLSX, parseCalendarDate }; vm.createContext(ctx)
vm.runInContext(`${block('function parseSheetDate(')}\n${block('function lineSignature(')}\nthis.lineSignature = lineSignature`, ctx)
const sig = ros => ctx.lineSignature({ line_number: 'S-001', description: 'x', quantity: '1.000', uom: 'EA', wbs_code: '01', ros_date: ros, item_type: null, item_ref: null })
const db = (y, m, d) => new Date(y, m - 1, d)   // mysql2 DATE: a Date at server-local midnight

const pairs = [
  ['DB Date vs ISO text, same day', db(2024, 5, 1), '2024-05-01', true],
  ['DB Date vs DD/MM/YYYY, same day', db(2024, 5, 1), '01/05/2024', true],
  ['DB Date vs D/M/YYYY, same day', db(2024, 5, 1), '1/5/2024', true],
  ['DB Date vs DD-MM-YYYY, same day', db(2024, 5, 1), '01-05-2024', true],
  ['DB Date vs DD-Mon-YYYY', db(2024, 5, 1), '01-May-2024', true],
  ['DB Date vs ISO with a time', db(2024, 5, 1), '2024-05-01T10:00:00Z', true],
  ['DB Date vs padded ISO text', db(2024, 5, 1), '  2024-05-01  ', true],
  ['DB Date vs a different day (DD/MM/YYYY)', db(2024, 5, 1), '02/05/2024', false],
  ['DB Date vs a different day (ISO)', db(2024, 5, 1), '2024-05-02', false],
  ['31/12/2024 is 31 December', db(2024, 12, 31), '31/12/2024', true],
  ['01/02/2024 is 1 February', db(2024, 2, 1), '01/02/2024', true],
  ['01/02/2024 is not 2 January', db(2024, 1, 2), '01/02/2024', false],
  ['ISO text vs DD/MM/YYYY text, same day', '2024-05-01', '01/05/2024', true],
  ['blank vs null', '', null, true],
  ['null vs a DB Date', null, db(2024, 5, 1), false],
  ['"TBA" vs a DB Date', 'TBA', db(2024, 5, 1), false],
  ['"TBA" vs "TBA"', 'TBA', 'TBA', true],
  ['DB Date vs DB Date, same day', db(2024, 5, 1), db(2024, 5, 1), true],
  ['DB Date vs DB Date, different day', db(2024, 5, 1), db(2024, 5, 2), false],
  ['a file Date at the same local day', new Date(2024, 4, 1, 10, 0, 0), db(2024, 5, 1), true],
  ['a file Date one second before local midnight', new Date(2024, 3, 30, 23, 59, 59), db(2024, 5, 1), false],
]
let pass = 0, fail = 0
for (const [label, a, b, equal] of pairs) {
  const got = sig(a) === sig(b)
  if (got === equal) pass++
  else { fail++; console.log(`FAIL ${label}: expected ${equal ? 'equal' : 'different'}, got ${got ? 'equal' : 'different'} (${sig(a).split('|')[5]} vs ${sig(b).split('|')[5]})`) }
}
console.log(`lineSignature dates: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
