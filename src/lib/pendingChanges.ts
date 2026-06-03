// ─── PENDING-CHANGES PROPOSER HELPER ─────────────────────────
// Proposer roles (project_control, engineering_lead) cannot write gated records
// directly — the backend queueGate returns a 409 marked { requiresApproval:true }
// and writes nothing. This helper turns that block into the second step of the
// governance flow: it POSTs the change to /pending-changes/:pid/submit so a domain
// confirmer can apply it. The UI adds NO governance logic — the backend still
// enforces who may submit and who must confirm; this only completes the round-trip.
import axios from 'axios'

const API = 'http://localhost:3001/api'

export type GatedModule = 'wbs' | 'commodity' | 'equipment' | 'mto'
export type GatedAction = 'create' | 'delete'

export interface ApprovalResult {
  id: number
  status: string
  is_baseline_major: boolean
  required_confirmer_role: string
}

// ─── 409 DISCRIMINATOR ───────────────────────────────────────
// True only for the governance-routing 409 (requiresApproval marker) — NOT for a
// genuine conflict 409 such as a duplicate code, which must still show as an error.
export function isApprovalRequired(e: unknown): boolean {
  const er = e as { response?: { status?: number; data?: { requiresApproval?: boolean } } }
  return er?.response?.status === 409 && er.response.data?.requiresApproval === true
}

// ─── SUBMIT TO THE APPROVAL QUEUE ────────────────────────────
// `proposed` is the exact create/delete payload the confirmer will apply later.
export async function submitForApproval(
  projectId: number | string, module: GatedModule, action: GatedAction, proposed: unknown,
): Promise<ApprovalResult> {
  const { data } = await axios.post(`${API}/pending-changes/${projectId}/submit`, { module, action, proposed })
  return data as ApprovalResult
}

// ─── HUMAN LABEL FOR THE CONFIRMER ROLE ──────────────────────
const ROLE_LABELS: Record<string, string> = {
  project_controls_manager: 'Project Controls Manager',
  engineering_lead:         'Engineering Lead',
  project_manager:          'Project Manager',
}
export function confirmerLabel(role: string): string {
  return ROLE_LABELS[role] || role.replace(/_/g, ' ')
}

// ─── READY-MADE SUCCESS MESSAGE ──────────────────────────────
// Acknowledges the action as submitted (not failed) and points to where it lands.
export function approvalToast(r: ApprovalResult): string {
  const major = r.is_baseline_major ? ' (baseline-major)' : ''
  return `Submitted to the approval queue${major} — pending ${confirmerLabel(r.required_confirmer_role)} confirmation. Track it under Pending Changes.`
}
