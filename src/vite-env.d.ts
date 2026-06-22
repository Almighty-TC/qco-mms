/// <reference types="vite/client" />

// ─── TYPED BUILD-TIME ENV ────────────────────────────────────
// VITE_API_URL is inlined by Vite at build time (see src/lib/api.ts).
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  // 'true' enables the self-service forgot-password flow on the login page.
  // Off by default: the flow emails a temp password, so it must stay hidden
  // until SMTP is configured server-side (see src/pages/Login.tsx).
  readonly VITE_ENABLE_PASSWORD_RESET?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
