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

// Authed view → opens the file in a new tab from a blob URL (no auth header needed
// on a blob: URL, and the fetch that built it WAS authed). This is the only safe
// "view in browser" — a raw window.open(apiURL) would 401.
export async function viewFile(url: string): Promise<void> {
  const { blob } = await fetchBlob(url)
  const objUrl = URL.createObjectURL(blob)
  window.open(objUrl, '_blank')
  setTimeout(() => URL.revokeObjectURL(objUrl), 60_000)
}
