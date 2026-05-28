// ─── COMPONENT BARREL ────────────────────────────────────────
// Central export file — import shared components from here in all modules:
//
//   import { DeleteConfirmModal, SimpleConfirmModal } from '../components'
//   import { DeleteConfirmModal } from '../../components'
//
// Adding a new shared component: export it here so every module picks
// it up automatically without hunting for the file path.

// ─── MODAL STANDARDS ─────────────────────────────────────────
// DeleteConfirmModal  — permanent deletion: reason dropdown + checkbox required
// SimpleConfirmModal  — reversible actions: deactivate, archive, status change
export { DeleteConfirmModal, DEFAULT_DELETE_REASONS } from './DeleteConfirmModal'
export { SimpleConfirmModal }                         from './SimpleConfirmModal'

// ─── TABLE PRIMITIVES ────────────────────────────────────────
export { HeaderCell, ResizeHandle } from './ResizableTable'

// ─── HELP MODAL ──────────────────────────────────────────────
export { HelpModal } from './HelpModal'
export type { HelpSection } from './HelpModal'
