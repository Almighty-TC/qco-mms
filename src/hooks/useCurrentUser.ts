// ─── useCurrentUser ───────────────────────────────────────────
// Returns current user, role flags, and WBS scope data.
// isMCTeam: full internal team; isSubcontractor: external site; isForwarder: freight.
import { useAuth } from '../context/AuthContext'

const MC_TEAM_ROLES = new Set([
  'admin','ceo','director','project_director','project_manager',
  'procurement_manager','procurement_officer',
  'expediting_manager','expeditor','logistics_manager',
  'warehouse','quality_engineer','engineer','materials_controller',
  'senior_expeditor','junior_expeditor',
])

export function useCurrentUser() {
  const { user } = useAuth()
  const role = user?.role ?? ''

  return {
    user,
    role,
    isAdmin:         role === 'admin',
    isMCTeam:        MC_TEAM_ROLES.has(role),
    isSubcontractor: role === 'subcontractor',
    isForwarder:     role === 'freight_forwarder',
    isExternalUser:  role === 'subcontractor' || role === 'freight_forwarder' || role === 'vendor',
  }
}
