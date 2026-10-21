// ─── EXTERNAL ROLE NAVIGATION (ext-2, phase 1) ───────────────────────────────
// The screens each external role may open, matching the server's external gate
// (server/lib/externalGate.js): a screen is listed only when the gate allows the
// calls it needs. App.tsx builds the external sidebar from EXTERNAL_NAV alone and
// refuses any other page (deep links included) with a "Not available to your role"
// panel. Internal roles are unaffected. Phase 2 (supplier scoping) edits only the table.
//
// Ids are App.tsx's Page ids. A top-level entry opens `page`; an entry with `sub`
// is a group whose child pages are the only ones it allows (Materials Control,
// Foundational). 'dashboard' is Home — the project list; the Dashboard project
// view is never shown to external roles.

export type ExternalRole = 'vendor' | 'freight_forwarder' | 'site_contractor' | 'subcontractor'

export const EXTERNAL_ROLES: ReadonlySet<string> = new Set<ExternalRole>(['vendor', 'freight_forwarder', 'site_contractor', 'subcontractor'])

export interface ExternalNavEntry {
  id: string                                  // App.tsx page id, or the group id for a group
  label: string
  icon: string
  page: string                                // the page the entry opens
  sub?: { page: string; label: string }[]     // a group's allowed child pages
}

const HOME: ExternalNavEntry = { id: 'dashboard', label: 'Home', icon: '🏠', page: 'dashboard' }
const RFI: ExternalNavEntry = { id: 'rfi-meeting', label: 'Meetings & RFIs', icon: '📋', page: 'rfi-meeting' }
const LOGISTICS: ExternalNavEntry = { id: 'logistics', label: 'Logistics', icon: '🚚', page: 'logistics' }
const WBS: ExternalNavEntry = { id: 'foundational', label: 'Foundational', icon: '🏗', page: 'foundational-wbs', sub: [{ page: 'foundational-wbs', label: 'WBS' }] }
const STOCK_FMR: ExternalNavEntry = {
  id: 'materials-control', label: 'Materials Control', icon: '📦', page: 'mc-stock',
  sub: [{ page: 'mc-stock', label: 'Stock Register' }, { page: 'mc-fmr', label: 'FMR Register' }],
}
// ext-2c: the vendor's own screens (VendorPOScreen); never opened by any other role.
const MY_POS: ExternalNavEntry = { id: 'vendor-pos', label: 'My POs', icon: '🧾', page: 'vendor-pos' }
const VENDOR_ONLY_PAGES: ReadonlySet<string> = new Set([MY_POS.page])

// One table per role (phase 1). Order is the sidebar order; the first entry after
// Home is where an external user lands after choosing a project.
export const EXTERNAL_NAV: Record<ExternalRole, ExternalNavEntry[]> = {
  vendor:            [HOME, MY_POS, RFI],
  freight_forwarder: [HOME, LOGISTICS, RFI],
  site_contractor:   [HOME, WBS, STOCK_FMR, RFI],
  subcontractor:     [HOME, STOCK_FMR, RFI],
}

export function isExternal(role: string | null | undefined): boolean {
  return !!role && EXTERNAL_ROLES.has(role)
}

// The role's table, or null for an internal role.
export function externalNavFor(role: string | null | undefined): ExternalNavEntry[] | null {
  return isExternal(role) ? EXTERNAL_NAV[role as ExternalRole] : null
}

// True when the role may open pageId (and, for a group, the child subId).
// Internal roles may open everything this check covers except the vendor-only pages
// (their own guards still apply).
export function canOpen(role: string | null | undefined, pageId: string, subId?: string): boolean {
  const nav = externalNavFor(role)
  if (!nav) return !VENDOR_ONLY_PAGES.has(pageId)
  if (subId !== undefined) return nav.some(e => e.id === pageId && !!e.sub?.some(s => s.page === subId))
  return nav.some(e => (e.sub ? e.sub.some(s => s.page === pageId) : e.page === pageId))
}

// Forwarder SCN document view/download (documents.js) is refused by the gate until ext-1b
// adds the carrier check and the allowlist entry; set to true when ext-1b allows forwarder
// document downloads. While false, the Logistics screen hides 👁 and ↓ for external roles.
export const EXTERNAL_LOGISTICS_DOC_DOWNLOAD = false

// Where an external user lands after choosing a project: the first entry after Home.
export function landingPage(role: string | null | undefined): string {
  const nav = externalNavFor(role)
  return nav?.find(e => e.id !== HOME.id)?.page ?? HOME.page
}
