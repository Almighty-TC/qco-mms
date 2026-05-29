// ─── USER COLOUR SYSTEM ──────────────────────────────────────────────────────
// Single source of truth for the three user-type colour tiers used system-wide.
// Every module that renders user rows or user-type indicators MUST import from
// this file — never hardcode these colours inline anywhere.
//
// Colour is conveyed by the LEFT BORDER STRIPE on table rows only.
// Company names are displayed as plain text in the COMPANY column — no pills.
//
// Three tiers:
//   qco      → orange (#E84E0F) — QCO Group internal staff
//   project  → green  (#2E7D32) — Client/partner project team (not QCO, not external)
//   external → blue   (#1D6FA4) — Vendors, freight forwarders, site contractors, subcontractors
//
// Exported API:
//   USER_COLOURS           — constant record with all tier objects (border colour + label)
//   EXTERNAL_ROLE_SET      — Set of role names that are always treated as external
//   getUserColour()        — classify a user into one of the three tiers
//   getUserRowStyle()      — CSSProperties for the 3px inset left-edge stripe on a <td>

// ─── COLOUR CONSTANTS ────────────────────────────────────────────────────────
// border: the hex colour used for the inset box-shadow row stripe.
// label:  human-readable tier name shown in the ? help legend and footer legend.
// Note:   'bg' field removed — pills are no longer used. Colour = stripe only.
export const USER_COLOURS = {
  qco: {
    border: '#E84E0F',
    label:  'QCO Group — Internal',
  },
  project: {
    border: '#2E7D32',
    label:  'Project Team — Client/Partner',
  },
  external: {
    border: '#1D6FA4',
    label:  'External — Vendor/Contractor/Freight',
  },
} as const

// ─── EXTERNAL ROLE SET ────────────────────────────────────────────────────────
// Roles whose holders are always treated as external regardless of the isExternal
// DB flag. Belt-and-suspenders: the DB flag is authoritative but this guards
// against data inconsistencies for display purposes only.
export const EXTERNAL_ROLE_SET = new Set([
  'vendor',
  'freight_forwarder',
  'site_contractor',
  'subcontractor',
])

// ─── GET USER COLOUR ─────────────────────────────────────────────────────────
// Returns the colour-tier object for a given user. Pass company and role from
// any API response. Accepts isExternal as an optional third param (preferred
// when the DB flag is available) for the most accurate classification.
export function getUserColour(
  company: string | null,
  role: string,
  isExternal?: boolean,
): typeof USER_COLOURS[keyof typeof USER_COLOURS] {
  // External: DB flag wins; role name is the fallback signal.
  if (isExternal || EXTERNAL_ROLE_SET.has(role)) return USER_COLOURS.external
  // QCO Group internal staff.
  if (company === 'QCO Group') return USER_COLOURS.qco
  // Everyone else — client-side / project-team partner.
  return USER_COLOURS.project
}

// ─── GET USER ROW STYLE ───────────────────────────────────────────────────────
// Returns a React CSSProperties object with a 3px inset left-edge box-shadow
// for use on the leftmost <td> of any user table row. The inset shadow approach
// avoids layout shift (unlike border-left which adds 3px to the cell width) and
// is immune to overflow:clip clipping on the table wrapper.
export function getUserRowStyle(
  company: string | null,
  role: string,
  isExternal?: boolean,
): React.CSSProperties {
  const colour = getUserColour(company, role, isExternal)
  return {
    boxShadow:   `inset 3px 0 0 ${colour.border}`,
    paddingLeft: 9, // 12px normal − 3px stripe = 9px so text doesn't sit on the stripe
  }
}
