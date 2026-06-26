// ─── PACKAGING HELPERS (Pass 2) ───────────────────────────────
// Shared by the SCN wizard (CreateSCNWizard) and the Logistics PackagesTab so the
// container-fit rule can't drift between the two surfaces.

export interface ContainerTypeLite {
  id: number; code: string; description?: string
  inner_length_mm?: number | null; inner_width_mm?: number | null; inner_height_mm?: number | null
}

// Per-type relaxation is derived from the ISO code SUFFIX (container_types has no category
// column — the data-driven signal is the code: DC/HC/RF enclosed, OT open-top, FR flat-rack):
//   • Enclosed (…DC, …HC, …RF) → enforce all three dimensions (L, W, H).
//   • Open Top (…OT)           → enforce L, W; RELAX height (over-height is the point).
//   • Flat Rack (…FR)          → out-of-gauge by design → do NOT block on dimension.
export function containerEnforcesHeight(code: string): boolean {
  const c = (code || '').toUpperCase()
  return !(c.endsWith('OT') || c.endsWith('FR'))   // OT/FR relax height
}
export function containerIsOutOfGauge(code: string): boolean {
  return (code || '').toUpperCase().endsWith('FR')  // flat rack — no dimension block
}

// Returns the list of violated dimensions (['length','width','height']) for a package
// nested in a container, honouring the per-type relaxation, or null if it fits / N/A.
// All inputs in MILLIMETRES (callers convert cm→mm before calling).
export function containerDimViolations(
  pkg: { length_mm?: number | string | null; width_mm?: number | string | null; height_mm?: number | string | null },
  ct?: ContainerTypeLite | null,
): ('length' | 'width' | 'height')[] | null {
  if (!ct) return null
  if (containerIsOutOfGauge(ct.code)) return null   // flat rack — carries out-of-gauge, never blocked
  const L = Number(pkg.length_mm) || 0
  const W = Number(pkg.width_mm) || 0
  const H = Number(pkg.height_mm) || 0
  const out: ('length' | 'width' | 'height')[] = []
  if (ct.inner_length_mm != null && L > Number(ct.inner_length_mm) + 1e-6) out.push('length')
  if (ct.inner_width_mm != null && W > Number(ct.inner_width_mm) + 1e-6) out.push('width')
  if (containerEnforcesHeight(ct.code) && ct.inner_height_mm != null && H > Number(ct.inner_height_mm) + 1e-6) out.push('height')
  return out.length ? out : null
}

// One-line user message for a violation.
export function containerDimMessage(violations: ('length' | 'width' | 'height')[], ct: ContainerTypeLite): string {
  return `Package exceeds the ${ct.code} container inner ${violations.join('/')} ` +
    `(inner L×W×H ${ct.inner_length_mm}×${ct.inner_width_mm}×${ct.inner_height_mm} mm). ` +
    `Use a flat rack or open top for out-of-gauge cargo.`
}
