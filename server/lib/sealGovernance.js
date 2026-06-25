// ─── CONTAINER SEAL GOVERNANCE (tamper-evidence) ──────────────────────────────
// Single enforcement point for writing scn_packages.seal_no / container_no, called by
// BOTH Expediting and Logistics so the governance can NEVER drift between modules.
// A seal number is tamper-evidence: once applied it attests the container was not
// opened in transit, so changing it is a governed, audited, reasoned act.
//
// RULING (locked — do NOT weaken):
//  • seal_no is SET-ONCE. The first write needs no reason (audited). ANY later change
//    (incl. clearing) REQUIRES a non-empty reason and is recorded (old→new + reason).
//    A change attempt without a reason → reject (SealGovernanceError, 422); the original
//    seal is left untouched and NO audit row is written (no audit noise on reject).
//  • The seal change and its audit_log row are written in the SAME transaction, and the
//    audit insert is FAILURE-PROPAGATING: if it fails, the seal change MUST roll back.
//    There is NO path where the seal changes without its audit row.
//
//  ⚠⚠ The non-blocking writeAudit (logistics.js:106) is FORBIDDEN on this path. It
//     wraps the insert in try/catch → console.error, which would let a seal change
//     persist even though its audit row failed — silently breaking tamper-evidence.
//     We insert audit_log DIRECTLY on the caller's transactional conn and let any error
//     PROPAGATE so the caller's rollback undoes the seal change. Do NOT "simplify" this
//     back to writeAudit, and do NOT wrap these inserts in a swallowing try/catch.
//
// The audit_log BEFORE-INSERT trigger auto-computes row_hash over the content fields
// (incl. reason_detail), so seal history is tamper-evident in the one hash chain.
//
// CONTRACT: every function here MUST be called inside a transaction (a conn from
// pool.getConnection() after beginTransaction()). On ANY throw the caller MUST rollback.

// Thrown for governance rejections (e.g. re-seal without a reason). `.status` lets the
// route map it to the right HTTP code without leaking internals.
class SealGovernanceError extends Error {
  constructor (message, status = 422) { super(message); this.name = 'SealGovernanceError'; this.status = status }
}

const norm = v => (v == null ? null : (String(v).trim() === '' ? null : String(v).trim()))

// ─── GOVERNED SEAL WRITE ──────────────────────────────────────
// Returns { changed, before, after, firstSet }. Throws SealGovernanceError on a
// reasonless re-seal (422) or missing package (404), and PROPAGATES any DB error from
// the audit insert (so the caller's rollback reverts the seal change).
async function setSealNo (conn, { packageId, scnId, newSeal, reason, userId, resource, ip, projectId }) {
  const next = norm(newSeal)

  // Lock the package row for the life of the txn — serialises concurrent seal writes so
  // two callers can't both read "unset" and both treat their write as a first-set.
  const [[pkg]] = await conn.query(
    'SELECT id, seal_no, container_type_id FROM scn_packages WHERE id=? AND scn_id=? FOR UPDATE', [packageId, scnId])
  if (!pkg) throw new SealGovernanceError('Package not found on this SCN.', 404)
  // Container-only: a seal is a container attribute. Enforced HERE (the single governance
  // point) so EVERY caller — Expediting and Logistics alike — rejects seal writes on a
  // non-container identically; neither route can drift.
  if (pkg.container_type_id == null) throw new SealGovernanceError('Container number / seal apply to containers only.')
  const current = norm(pkg.seal_no)

  if (current === next) return { changed: false, before: current, after: current } // no-op → no write, no audit

  const firstSet = current == null
  if (!firstSet && (reason == null || String(reason).trim() === '')) {
    // Re-seal / change / clear of an EXISTING seal → reason REQUIRED. Reject BEFORE any
    // write: original seal untouched, zero audit rows. (No audit noise on reject.)
    throw new SealGovernanceError('Changing an existing seal requires a reason.')
  }
  const reasonText = firstSet
    ? (norm(reason))                       // first-set: reason optional
    : String(reason).trim()                // re-seal: validated non-empty above

  // 1) Apply the seal change on the caller's transactional conn.
  await conn.query('UPDATE scn_packages SET seal_no=? WHERE id=? AND scn_id=?', [next, packageId, scnId])

  // 2) Audit IN THE SAME TXN, FAILURE-PROPAGATING. ⚠ Do NOT replace with writeAudit
  //    (non-blocking) and do NOT wrap in a swallowing try/catch: if this insert fails,
  //    the seal change above MUST roll back (caller's rollback). See module header.
  await conn.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id,
        before_value, after_value, reason_category, reason_detail, resource, ip)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [userId, 'seal_changed', 'scn_package', packageId, projectId ?? null,
     JSON.stringify({ seal_no: current }), JSON.stringify({ seal_no: next }),
     firstSet ? 'seal_initial' : 'seal_rechange', reasonText, resource || 'seal', ip || null])

  return { changed: true, before: current, after: next, firstSet }
}

// ─── FREE-EDIT CONTAINER NUMBER ───────────────────────────────
// container_no is a logistics identifier, not tamper-evidence → freely editable, no
// reason, no set-once lock. Light audit kept for traceability (in-txn for consistency;
// it is NOT a governance gate). Returns { changed, before, after }.
async function setContainerNo (conn, { packageId, scnId, newContainerNo, userId, resource, ip, projectId }) {
  const next = norm(newContainerNo)
  const [[pkg]] = await conn.query(
    'SELECT id, container_no, container_type_id FROM scn_packages WHERE id=? AND scn_id=? FOR UPDATE', [packageId, scnId])
  if (!pkg) throw new SealGovernanceError('Package not found on this SCN.', 404)
  // Container-only (same rule as setSealNo) — a container_no belongs to a container.
  if (pkg.container_type_id == null) throw new SealGovernanceError('Container number / seal apply to containers only.')
  const current = norm(pkg.container_no)
  if (current === next) return { changed: false, before: current, after: current }

  await conn.query('UPDATE scn_packages SET container_no=? WHERE id=? AND scn_id=?', [next, packageId, scnId])
  await conn.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id,
        before_value, after_value, resource, ip)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [userId, 'container_no_changed', 'scn_package', packageId, projectId ?? null,
     JSON.stringify({ container_no: current }), JSON.stringify({ container_no: next }),
     resource || 'container_no', ip || null])
  return { changed: true, before: current, after: next }
}

module.exports = { setSealNo, setContainerNo, SealGovernanceError }
