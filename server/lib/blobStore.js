// ─── BLOB STORE — durable file storage with graceful disk fallback ───────────────
// Moves file storage off App Service local disk (ephemeral — lost on redeploy) onto
// Azure Blob (durable). The whole module is DEGRADE-SAFE: when AZURE_STORAGE_CONNECTION_STRING
// is absent or any blob op fails, every call returns null/false instead of throwing, so the
// callers' DUAL-READ FALLBACK keeps using local disk and nothing breaks. TC sets the
// connection string later; until then the app behaves exactly as it does today (disk-only).
//
// Stored value contract: the DB column holds the blob KEY (`<module>/<basename>`) when the
// file went to blob, or the module's legacy disk-path shape when it fell back to disk. The
// read side normalises EITHER to a key via keyFor() for the blob attempt, then falls back to
// the legacy disk resolution. NO schema change — same columns, the value is just a key now.
const path = require('path')
const { BlobServiceClient } = require('@azure/storage-blob')

// ─── ONE private container; we stream through the authed API (never SAS/public URLs) ───
const CONTAINER = 'uploads'

// Lazy, sticky client. _init is null until first use; then either a containerClient or false
// (tried-and-unavailable) so we never re-parse a bad/absent connection string on every call.
let _container = null   // ContainerClient once connected
let _init = null        // null = untried, false = unavailable, true = ready

function _connect() {
  if (_init !== null) return _init
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!conn || !conn.trim()) { _init = false; return false }   // ← absent → degrade to disk
  try {
    const svc = BlobServiceClient.fromConnectionString(conn)
    _container = svc.getContainerClient(CONTAINER)
    _init = true
    return true
  } catch (e) {
    console.error('[blobStore] connection-string parse failed — falling back to disk:', e.message)
    _init = false
    return false
  }
}

// True iff a usable connection string is configured. (Does not guarantee the container
// exists — putFile createIfNotExists handles that, and any failure degrades to disk.)
function isEnabled() {
  return _connect() === true
}

// keyFor(module, storedValue) → `<module>/<basename>`. THE common denominator across the
// three stored shapes: relative (uploads/po_documents/5/x.pdf), absolute
// (/home/site/wwwroot/uploads/scn-documents/x.pdf — the logistics case) and bare (x.pdf).
// path.basename handles all three (and is idempotent on an already-built key:
// basename('logistics/x.pdf') === 'x.pdf'). Pure — no I/O, safe to call always.
function keyFor(module, storedValue) {
  return `${module}/${path.basename(String(storedValue || ''))}`
}

// putFile(key, buffer, contentType) → key on success, null on absence/failure (never throws).
async function putFile(key, buffer, contentType) {
  if (!isEnabled()) return null
  try {
    await _container.createIfNotExists()   // private by default (no public access arg)
    const blob = _container.getBlockBlobClient(key)
    await blob.uploadData(buffer, contentType ? { blobHTTPHeaders: { blobContentType: contentType } } : undefined)
    return key
  } catch (e) {
    console.error(`[blobStore] putFile(${key}) failed — falling back to disk:`, e.message)
    return null
  }
}

// getFile(key) → a Readable stream, or null if blob is disabled / the blob is absent / any
// error. null is the fallback signal: the caller then reads from local disk. Never throws.
async function getFile(key) {
  if (!isEnabled()) return null
  try {
    const blob = _container.getBlockBlobClient(key)
    const resp = await blob.download()           // throws RestError 404 if the blob is absent
    return resp.readableStreamBody || null
  } catch (e) {
    if (e.statusCode !== 404) console.error(`[blobStore] getFile(${key}) error — falling back to disk:`, e.message)
    return null
  }
}

// persist(...) — the WRITE-path helper used by every upload route. Tries blob; on success
// returns { value: key, where: 'blob' } to store the key in the DB. On blob-absence/failure
// it writes the buffer to disk EXACTLY where the module used to (diskAbsPath) and returns
// { value: diskValue, where: 'disk' } — the module's existing stored shape — so today's
// disk-only behaviour is byte-for-byte preserved until the connection string is set.
const fs = require('fs')
async function persist({ key, diskAbsPath, buffer, contentType, diskValue }) {
  const ok = await putFile(key, buffer, contentType)
  if (ok) return { value: key, where: 'blob' }
  fs.mkdirSync(path.dirname(diskAbsPath), { recursive: true })
  fs.writeFileSync(diskAbsPath, buffer)
  return { value: diskValue, where: 'disk' }
}

module.exports = { CONTAINER, isEnabled, keyFor, putFile, getFile, persist }
