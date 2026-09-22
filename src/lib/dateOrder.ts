// ─── DATE-ORDERING VALIDATION (frontend mirror) ──────────────
// Mirror of server/utils/validate.js dateOrder — keep in sync; backend remains
// authoritative (the create route re-validates and rejects with 400). This copy
// exists only to give the CreateSCNWizard earliest, in-place feedback (inline at
// the fields + Confirm banner + Create gate) instead of a post-submit toast.
//
// Given [label, value] pairs in the expected order (any value may be empty/null),
// returns the first ordering violation as a descriptive message, or null. Only
// present dates are compared (blanks/nulls are skipped), in order — so it validates
// whatever subset the user has entered so far.
//   dateOrder([['CRD', crd], ['CCD', ccd], ['ETD', etd], ['ETA', eta]])
export function dateOrder(pairs: [string, string | null | undefined][]): string | null {
  const present = pairs
    .filter(([, v]) => v != null && v !== '')
    .map(([label, v]) => [label, v as string, new Date(v as string)] as const)
  for (const [label, , d] of present) {
    if (isNaN(d.getTime())) return `${label} is not a valid date.`
  }
  for (let i = 1; i < present.length; i++) {
    const [pl, , pd] = present[i - 1]
    const [cl, , cd] = present[i]
    if (cd < pd) {
      const f = (d: Date) => d.toISOString().slice(0, 10)
      return `${cl} (${f(cd)}) cannot be earlier than ${pl} (${f(pd)}).`
    }
  }
  return null
}
