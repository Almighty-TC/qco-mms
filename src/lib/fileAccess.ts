// ─── AUTHED FILE ACCESS — Download + View ─────────────────────────────────────
// THE pattern for every document-listing screen. Both go through the configured
// axios instance, which attaches the JWT via the request interceptor (AuthContext),
// so the request is authenticated. NEVER use window.open(apiURL) on a protected
// route — that omits the Authorization header and 401s.
//
//   downloadFile — authed blob fetch → anchor download (save to disk).
//   viewFile     — authed blob fetch → object URL → window.open (view in a new tab).
//
// Both serve correctly post-blob-migration: every backend serve point is dual-read
// (blob-first, disk-fallback), so the SAME call streams a blob file or a legacy
// on-disk file transparently.
import axios from 'axios'

async function fetchBlob(url: string): Promise<{ blob: Blob; type: string }> {
  const res = await axios.get(url, { responseType: 'blob' })
  const type = (res.headers['content-type'] as string) || 'application/octet-stream'
  return { blob: new Blob([res.data], { type }), type }
}

// Authed download → triggers a browser save with the given filename.
export async function downloadFile(url: string, filename?: string): Promise<void> {
  const { blob } = await fetchBlob(url)
  const objUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objUrl
  a.download = filename || 'document'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objUrl), 1000)
}

// Renderable types we can coax inline when the server sends a generic Content-Type. Some
// document sources have no mime column (e.g. scn_documents, foundational_certificates) so the
// resolver serves application/octet-stream — which makes window.open DOWNLOAD instead of
// render. We infer a better type from the file extension for these. Anything not listed
// (docx/xlsx/…) stays generic and the browser downloads it — expected, not a bug.
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  txt: 'text/plain', csv: 'text/csv', html: 'text/html', htm: 'text/html',
}

// Authed view → opens the file in a new tab from a blob URL (no auth header needed on a
// blob: URL, and the fetch that built it WAS authed). This is the only safe "view in
// browser" — a raw window.open(apiURL) would 401. When the server's Content-Type is generic
// (octet-stream / missing), infer a renderable MIME from the filename extension so PDFs and
// images render INLINE rather than downloading. Pass `filename` so the extension is available.
export async function viewFile(url: string, filename?: string): Promise<void> {
  const { blob, type } = await fetchBlob(url)
  let viewBlob = blob
  if ((!type || type === 'application/octet-stream') && filename) {
    const ext = filename.split('.').pop()?.toLowerCase()
    const inferred = ext ? EXT_MIME[ext] : undefined
    if (inferred) viewBlob = new Blob([blob], { type: inferred })   // re-type for inline render
  }
  const objUrl = URL.createObjectURL(viewBlob)
  window.open(objUrl, '_blank')
  setTimeout(() => URL.revokeObjectURL(objUrl), 60_000)
}
