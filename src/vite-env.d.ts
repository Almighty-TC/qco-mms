/// <reference types="vite/client" />

// ─── TYPED BUILD-TIME ENV ────────────────────────────────────
// VITE_API_URL is inlined by Vite at build time (see src/lib/api.ts).
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
