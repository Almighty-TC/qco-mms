// ─── MATERIAL CONTROL ROUTES ──────────────────────────────────
// Receipting, Stock Register, FMR Register, Warehouse Transfers.
// All routes require a valid JWT via authenticateToken.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken } = require('../middleware/auth')

router.use(authenticateToken)

// ─── QUARANTINE LOCATION (Phase 3) ────────────────────────────
// Damaged stock is held at this designated location_code (a "place"),
// with condition_status='quarantine', trace_hold=1, qty_available=0 —
// so it is never issuable. Released stock moves to a normal location.
const QUARANTINE_LOCATION = 'QUARANTINE'

// ─── ROLE GUARDS ──────────────────────────────────────────────
const RECEIPTING_ALLOWED = new Set(['admin','ceo','director','project_director','project_manager','procurement_manager','procurement_officer','expediting_manager','expeditor','logistics_manager','warehouse','materials_controller','quality_engineer'])
const APPROVAL_ALLOWED   = new Set(['admin','ceo','director','project_director','project_manager','materials_controller'])

// Subcontractors and freight_forwarders cannot access receipting or transfers
function rejectExternal(req, res, next) {
  const r = req.user?.role
  if (r === 'subcontractor' || r === 'freight_forwarder') return res.status(403).json({ error: 'Access denied for this role' })
  next()
}

// ─── AUDIT HELPER ─────────────────────────────────────────────
async function writeAudit(userId, action, entity, id, before, after, resource) {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id,action,entity_type,entity_id,before_value,after_value,resource) VALUES (?,?,?,?,?,?,?)`,
      [userId, action, entity, id,
       before ? JSON.stringify(before) : null,
       after  ? JSON.stringify(after)  : null,
       resource]
    )
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════
// RECEIPTING
// ═══════════════════════════════════════════════════════════════

// GET /api/mc/:projectId/receipting — subcontractors/forwarders blocked
router.get('/:projectId/receipting', rejectExternal, async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { tab, search, destination } = req.query

    // Status mapping by tab
    // 'partially_received' SCNs stay receivable (a remainder is still due),
    // so they appear alongside 'arrived' in the receipting queue.
    const tabStatus = {
      arrived:    ['arrived', 'partially_received'],
      in_transit: ['in-transit', 'in_transit', 'pending'],
      customs:    ['customs_review'],
      shipments:  ['arrived','partially_received','in-transit','in_transit','pending','customs_review'],
      transfers:  [], // warehouse_transfers handled separately
      all:        ['arrived','partially_received','in-transit','in_transit','pending','customs_review','draft'],
    }

    const statuses = tabStatus[tab] || tabStatus.all

    let conditions = ['s.project_id = ?']
    let params = [pid]

    if (statuses.length > 0) {
      conditions.push(`s.status IN (${statuses.map(() => '?').join(',')})`)
      params.push(...statuses)
    }

    if (search) {
      const q = `%${search}%`
      conditions.push('(s.scn_ref LIKE ? OR po.po_number LIKE ? OR COALESCE(s.vendor_name,po.vendor_name) LIKE ? OR s.origin_location LIKE ? OR w.name LIKE ?)')
      params.push(q, q, q, q, q)
    }
    if (destination && destination !== 'all') {
      conditions.push('s.destination_warehouse_id = ?')
      params.push(destination)
    }

    const [scns] = await db.query(
      `SELECT
         s.id, s.scn_ref, s.status, s.mode, s.eta, s.atd,
         s.origin_location, s.incoterms, s.forwarder_name,
         s.total_packages, s.total_weight_kg, s.notes,
         COALESCE(s.vendor_name, po.vendor_name) AS vendor_name,
         po.po_number AS po_ref,
         w.name AS destination_name, w.code AS destination_code,
         s.destination_warehouse_id,
         'SHIPMENT' AS type
       FROM shipment_control_notes s
       LEFT JOIN purchase_orders po ON s.po_id = po.id
       LEFT JOIN warehouses w ON s.destination_warehouse_id = w.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE s.status
           WHEN 'arrived' THEN 1
           WHEN 'customs_review' THEN 2
           WHEN 'in-transit' THEN 3
           ELSE 4
         END, s.eta ASC`,
      params
    )

    // Also get warehouse transfers if tab is 'transfers' or 'all'
    let transfers = []
    if (!tab || tab === 'all' || tab === 'transfers') {
      const tConds = ['t.project_id = ?']
      const tParams = [pid]
      if (tab === 'transfers') {
        tConds.push("t.status NOT IN ('complete')")
      }
      const [trows] = await db.query(
        `SELECT
           t.id, t.transfer_ref AS scn_ref, t.status, t.description AS item_description,
           t.qty, t.uom, t.wbs_code, t.est_pickup_date AS eta,
           t.from_location AS origin_location,
           t.requested_by_name AS vendor_name, t.requested_by_company,
           fw.name AS from_warehouse_name, tw.name AS destination_name, tw.code AS destination_code,
           'TRANSFER' AS type
         FROM warehouse_transfers t
         LEFT JOIN warehouses fw ON t.from_warehouse_id = fw.id
         LEFT JOIN warehouses tw ON t.to_warehouse_id = tw.id
         WHERE ${tConds.join(' AND ')}`,
        tParams
      )
      transfers = trows
    }

    // Pipeline counts
    const [allRows] = await db.query(
      'SELECT status FROM shipment_control_notes WHERE project_id = ? AND status NOT IN (?,?,?)',
      [pid, 'received', 'closed', 'delivered']
    )
    const [[tCount]] = await db.query(
      "SELECT COUNT(*) as n FROM warehouse_transfers WHERE project_id = ? AND status NOT IN ('complete')",
      [pid]
    )

    const arrived_count   = allRows.filter(r => ['arrived','partially_received'].includes(r.status)).length
    const transit_count   = allRows.filter(r => ['in-transit','in_transit','pending'].includes(r.status)).length
    const customs_count   = allRows.filter(r => r.status === 'customs_review').length
    const total_awaiting  = arrived_count + transit_count + customs_count + tCount.n

    res.json({
      data: [...scns, ...(tab === 'transfers' ? transfers : (tab && tab !== 'all' ? [] : transfers))],
      pipeline: {
        arrived: arrived_count,
        in_transit: transit_count,
        customs_hold: customs_count,
        transfers: tCount.n,
        total_awaiting,
      }
    })
  } catch (e) {
    console.error('[mc:receipting]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/mc/:projectId/receipting/:scnId — full detail for wizard step 1
router.get('/:projectId/receipting/:scnId', rejectExternal, async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)
    const [[scn]] = await db.query(
      `SELECT s.*, po.po_number AS po_ref, COALESCE(s.vendor_name,po.vendor_name) AS vendor_display,
              w.name AS destination_name, w.code AS destination_code
       FROM shipment_control_notes s
       LEFT JOIN purchase_orders po ON s.po_id = po.id
       LEFT JOIN warehouses w ON s.destination_warehouse_id = w.id
       WHERE s.id = ?`,
      [scnId]
    )
    if (!scn) return res.status(404).json({ error: 'SCN not found' })

    const [packages] = await db.query('SELECT * FROM scn_packages WHERE scn_id = ?', [scnId])
    // Heat/Lot P2a: the SCN's declared heats (P1) — the dropdown source for the
    // receipting heat picker, scoped to this shipment.
    const [heats] = await db.query(
      'SELECT id, heat_number, material_grade FROM scn_heats WHERE scn_id = ? ORDER BY heat_number', [scnId])
    // Phase 4: received-to-date is DERIVED from receipt_lines (single source of
    // truth — no qty_received/qty_assigned writes). remaining = ordered − received,
    // clamped ≥ 0 so over-receipt never shows a negative balance.
    const [lines] = await db.query(
      `SELECT pl.id, pl.line_number, pl.description, pl.qty, pl.uom, pl.qty_assigned,
              pl.wbs_code_snapshot, pl.tag_number, pl.equipment_tag, pl.commodity_id,
              COALESCE((SELECT SUM(rl.received_qty) FROM receipt_lines rl WHERE rl.po_line_id = pl.id), 0) AS received_to_date,
              GREATEST(0, pl.qty - COALESCE((SELECT SUM(rl.received_qty) FROM receipt_lines rl WHERE rl.po_line_id = pl.id), 0)) AS remaining
       FROM po_lines pl WHERE pl.po_id = ?`,
      [scn.po_id || 0]
    )

    res.json({ ...scn, packages, lines, heats })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/mc/:projectId/receipting/:scnId/complete — complete receipt (creates stock)
router.post('/:projectId/receipting/:scnId/complete', rejectExternal, async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)
    const pid   = Number(req.params.projectId)
    // Phase 1: `lines` carries the per-PO-line received quantities + discrepancy
    // detail the wizard now sends. `actual_packages` kept for back-compat.
    const { location_code, cargo_condition, actual_packages, notes, warehouse_id, lines } = req.body
    const userId = req.user?.id || 1

    if (!location_code) return res.status(400).json({ error: 'Grid location is required' })

    const [[scn]] = await db.query('SELECT * FROM shipment_control_notes WHERE id = ?', [scnId])
    if (!scn) return res.status(404).json({ error: 'SCN not found' })

    // Stamp arrival now; the OPEN-vs-CLOSED status is decided AFTER the lines are
    // persisted, based on received-to-date vs ordered (Phase 4 partial-remainder).
    await db.query('UPDATE shipment_control_notes SET ata=CURDATE() WHERE id=?', [scnId])

    const whId = warehouse_id || scn.destination_warehouse_id || 1
    const condition = cargo_condition === 'good' ? 'good'
      : cargo_condition === 'minor_damage' ? 'minor_damage'
      : cargo_condition === 'major_damage' ? 'major_damage' : 'good'

    let stockCreated = 0

    if (Array.isArray(lines) && lines.length > 0) {
      // ── Phase 1 path: receive against real PO lines ──────────
      // Persist each line to receipt_lines, then create stock from the
      // RECEIVED qty (not package weight). All received qty goes to
      // available stock for now — good/quarantine split is Phase 3.
      // Server-side validation: damaged units cannot exceed received qty.
      for (const ln of lines) {
        const rq = Number(ln.received_qty)
        const dq = Number(ln.damaged_qty || 0)
        if (rq >= 0 && dq > rq) {
          return res.status(422).json({ error: `Line ${ln.line_number || ln.po_line_id}: damaged qty (${dq}) cannot exceed received qty (${rq})` })
        }
        // Heat/Lot P2a: an off-list heat is allowed but REQUIRES a reason. Heat
        // itself stays optional (a line may be received with no heat at all).
        if (ln.heat_off_list && !(ln.heat_off_list_reason || '').trim()) {
          return res.status(422).json({ error: `Line ${ln.line_number || ln.po_line_id}: a reason is required for an off-list heat` })
        }
      }
      for (const ln of lines) {
        const receivedQty = Number(ln.received_qty)
        if (!(receivedQty >= 0)) continue
        const expectedQty = ln.expected_qty != null ? Number(ln.expected_qty) : null
        const damagedQty = Number(ln.damaged_qty || 0)
        const uom = ln.uom || 'EA'
        // Heat/Lot P2a: heat travels onto the receipt line + both holdings below.
        // Optional (heatNo may be null); off-list carries a flag + mandatory reason.
        const heatNo      = (ln.heat_number || '').trim() || null
        const heatOffList = ln.heat_off_list ? 1 : 0
        const heatReason  = heatOffList ? ((ln.heat_off_list_reason || '').trim() || null) : null

        await db.query(
          `INSERT INTO receipt_lines
             (project_id, scn_id, scn_ref, po_line_id, heat_number, heat_off_list, heat_off_list_reason,
              description, expected_qty, received_qty, damaged_qty, uom,
              discrepancy_type, discrepancy_notes, received_by, received_date)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURDATE())`,
          [pid, scnId, scn.scn_ref, ln.po_line_id || null, heatNo, heatOffList, heatReason,
           ln.description || null,
           expectedQty, receivedQty, damagedQty, uom,
           ln.discrepancy_type || null, ln.discrepancy_notes || null, userId])

        // ── Phase 3: split good vs damaged into DISTINCT per-line holdings ──
        // (HEAT-READY: never pooled into a shared row — each split is its own row.)
        const goodQty    = receivedQty - damagedQty
        const itemCode   = ln.item_code || (ln.po_line_id ? `${scn.scn_ref}-L${ln.line_number || ln.po_line_id}` : `SCN-${scn.scn_ref}`)
        const descr      = ln.description || scn.notes || 'Received goods'
        const wbs        = ln.wbs_code || null

        // Good qty → available at its normal grid location. Heat (P2a) travels onto it.
        if (goodQty > 0) {
          await db.query(
            `INSERT INTO warehouse_stock (project_id,warehouse_id,scn_id,po_line_id,item_code,description,wbs_code,qty,qty_available,uom,location_code,condition_status,trace_hold,vendor_name,heat_number,received_date,received_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,CURDATE(),?)`,
            [pid, whId, scnId, ln.po_line_id || null, itemCode, descr, wbs,
             goodQty, goodQty, uom, location_code, (damagedQty > 0 ? 'good' : condition), scn.vendor_name, heatNo, userId])
          stockCreated++
        }

        // Damaged qty → QUARANTINE location, NOT issuable (qty_available = 0). Same heat travels.
        if (damagedQty > 0) {
          await db.query(
            `INSERT INTO warehouse_stock (project_id,warehouse_id,scn_id,po_line_id,item_code,description,wbs_code,qty,qty_available,uom,location_code,condition_status,trace_hold,vendor_name,heat_number,received_date,received_by,notes)
             VALUES (?,?,?,?,?,?,?,?,0,?,?,?,1,?,?,CURDATE(),?,?)`,
            [pid, whId, scnId, ln.po_line_id || null, itemCode, descr, wbs,
             damagedQty, uom, QUARANTINE_LOCATION, 'quarantine', scn.vendor_name, heatNo, userId,
             `Damaged on receipt — ${ln.discrepancy_notes || 'pending QA review'}`])
          stockCreated++
        }
      }
    } else {
      // ── Fallback (SCN with no linked PO lines): legacy package path ──
      // TODO(phase-later): drop once every SCN receipts against PO lines.
      const [pkgs] = await db.query('SELECT * FROM scn_packages WHERE scn_id=?', [scnId])
      for (const pkg of pkgs) {
        await db.query(
          `INSERT INTO warehouse_stock (project_id,warehouse_id,scn_id,item_code,description,wbs_code,qty,qty_available,uom,location_code,condition_status,vendor_name,received_date,received_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURDATE(),?)`,
          [pid, whId, scnId,
           `SCN-${scn.scn_ref}-PKG${pkg.package_number}`,
           pkg.description || scn.notes || 'Received goods',
           null, pkg.gross_weight_kg || 1, pkg.gross_weight_kg || 1, 'EA',
           location_code, condition, scn.vendor_name, userId])
        stockCreated++
      }
    }

    // ── Phase 4: decide OPEN vs CLOSED from received-to-date vs ordered ──
    // Fully received = every PO line's SUM(receipt_lines.received_qty) >= ordered qty.
    // Otherwise the SCN stays open as 'partially_received' so the balance can be
    // received later. (Legacy package path has no PO lines → treat as 'received'.)
    let newStatus = 'received'
    if (scn.po_id) {
      const [[{ open_lines }]] = await db.query(
        `SELECT COUNT(*) AS open_lines FROM po_lines pl
         WHERE pl.po_id = ?
           AND pl.qty > COALESCE((SELECT SUM(rl.received_qty) FROM receipt_lines rl WHERE rl.po_line_id = pl.id), 0)`,
        [scn.po_id])
      newStatus = Number(open_lines) > 0 ? 'partially_received' : 'received'
    }
    await db.query('UPDATE shipment_control_notes SET status=? WHERE id=?', [newStatus, scnId])

    await writeAudit(userId, 'receipt_complete', 'scn', scnId,
      { status: scn.status },
      { status: newStatus, location_code, cargo_condition, lines: Array.isArray(lines) ? lines.length : 0 },
      `/mc/${pid}/receipting/${scnId}/complete`)

    res.json({ success: true, stock_created: stockCreated, scn_status: newStatus })
  } catch (e) {
    console.error('[mc:receipt-complete]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// STOCK REGISTER
// ═══════════════════════════════════════════════════════════════

// GET /api/mc/:projectId/stock
router.get('/:projectId/stock', async (req, res) => {
  try {
    const pid   = Number(req.params.projectId)
    const role  = req.user?.role
    const uid   = req.user?.id
    const { search, warehouse_id, wbs_code, show_holds } = req.query

    let conditions = ['s.project_id = ?']
    let params = [pid]

    // ─── SUBCONTRACTOR: scope to their WBS codes, hide location ──
    let isSubcontractor = role === 'subcontractor'
    let subWbsCodes = []
    if (isSubcontractor) {
      const [wbsRows] = await db.query(
        'SELECT wbs_code FROM user_wbs_access WHERE user_id=? AND project_id=?', [uid, pid]
      )
      subWbsCodes = wbsRows.map(r => r.wbs_code).filter(c => c !== 'ALL')
      if (subWbsCodes.length > 0) {
        const placeholders = subWbsCodes.map(() => 'LIKE ?').join(' OR ')
        conditions.push(`(s.wbs_code IS NULL OR ${subWbsCodes.map(() => 's.wbs_code LIKE ?').join(' OR ')})`)
        subWbsCodes.forEach(c => params.push(`${c}%`))
      }
    }

    if (warehouse_id && warehouse_id !== 'all') { conditions.push('s.warehouse_id = ?'); params.push(warehouse_id) }
    if (wbs_code && wbs_code !== 'all') { conditions.push('s.wbs_code LIKE ?'); params.push(`${wbs_code}%`) }
    if (show_holds === 'true' && !isSubcontractor) { conditions.push('(s.trace_hold=1 OR s.condition_status != ?)'); params.push('good') }
    if (search) {
      const q = `%${search}%`
      conditions.push('(s.item_code LIKE ? OR s.description LIKE ? OR s.wbs_code LIKE ? OR s.vendor_name LIKE ?)')
      params.push(q, q, q, q)
    }

    const [stockRaw] = await db.query(
      `SELECT s.*, w.name AS warehouse_name, w.code AS warehouse_code
       FROM warehouse_stock s
       JOIN warehouses w ON s.warehouse_id = w.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY w.name, s.location_code`,
      params
    )

    // Subcontractors: strip grid location and hold reason
    const stock = stockRaw.map(row => isSubcontractor
      ? { ...row, location_code: null, hold_reason: undefined }
      : row
    )

    const [[totals]] = await db.query(
      `SELECT COUNT(*) AS total_items,
              COUNT(DISTINCT s.warehouse_id) AS warehouse_count,
              SUM(CASE WHEN s.trace_hold=1 THEN 1 ELSE 0 END) AS trace_hold_count,
              SUM(CASE WHEN s.condition_status != 'good' THEN 1 ELSE 0 END) AS condition_issues
       FROM warehouse_stock s WHERE s.project_id = ?`,
      [pid]
    )

    res.json({ data: stock, totals, wbs_scopes: subWbsCodes })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/mc/:projectId/stock/:itemId/move — move to new location
router.put('/:projectId/stock/:itemId/move', async (req, res) => {
  try {
    const { itemId } = req.params
    const { new_location, new_warehouse_id } = req.body
    if (!new_location) return res.status(400).json({ error: 'new_location is required' })
    const userId = req.user?.id || 1

    const [[item]] = await db.query('SELECT * FROM warehouse_stock WHERE id=?', [itemId])
    if (!item) return res.status(404).json({ error: 'Stock item not found' })

    await db.query(
      'UPDATE warehouse_stock SET location_code=?, warehouse_id=COALESCE(?,warehouse_id) WHERE id=?',
      [new_location, new_warehouse_id || null, itemId]
    )
    await writeAudit(userId, 'stock_move', 'warehouse_stock', itemId,
      { location_code: item.location_code, warehouse_id: item.warehouse_id },
      { location_code: new_location, warehouse_id: new_warehouse_id || item.warehouse_id },
      `/mc/${req.params.projectId}/stock/${itemId}/move`)

    const [[updated]] = await db.query('SELECT * FROM warehouse_stock WHERE id=?', [itemId])
    res.json(updated)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/mc/:projectId/stock/:itemId/resolve — resolve a quarantined holding
// body: { action: 'release' | 'reject', reason (MANDATORY), to_location? }
//  release → condition_status='good', trace_hold=0, qty_available=qty, moved to a
//            normal location (to_location); the holding becomes issuable.
//  reject  → holding removed from stock entirely.
// Mandatory reason; logged via audit_log (matches stock_move / reasoned-change pattern).
router.post('/:projectId/stock/:itemId/resolve', rejectExternal, async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const itemId = Number(req.params.itemId)
    const userId = req.user?.id || 1
    const { action, reason, to_location } = req.body || {}

    if (!['release', 'reject'].includes(action)) return res.status(422).json({ error: "action must be 'release' or 'reject'" })
    if (!reason || !reason.trim()) return res.status(422).json({ error: 'A reason is required' })

    const [[item]] = await db.query('SELECT * FROM warehouse_stock WHERE id=? AND project_id=?', [itemId, pid])
    if (!item) return res.status(404).json({ error: 'Stock item not found' })
    if (item.condition_status !== 'quarantine') return res.status(422).json({ error: 'Only quarantined stock can be resolved' })

    if (action === 'release') {
      if (!to_location || !to_location.trim()) return res.status(422).json({ error: 'A destination (normal) location is required to release' })
      await db.query(
        `UPDATE warehouse_stock SET condition_status='good', trace_hold=0, qty_available=qty, location_code=? WHERE id=?`,
        [to_location.trim(), itemId])
      await writeAudit(userId, 'quarantine_release', 'warehouse_stock', itemId,
        { condition_status: 'quarantine', location_code: item.location_code, qty_available: item.qty_available },
        { condition_status: 'good', location_code: to_location.trim(), qty_available: item.qty, reason: reason.trim() },
        `/mc/${pid}/stock/${itemId}/resolve`)
    } else {
      await db.query('DELETE FROM warehouse_stock WHERE id=?', [itemId])
      await writeAudit(userId, 'quarantine_reject', 'warehouse_stock', itemId,
        { condition_status: 'quarantine', qty: item.qty, item_code: item.item_code },
        { removed: true, reason: reason.trim() },
        `/mc/${pid}/stock/${itemId}/resolve`)
    }
    res.json({ success: true, action })
  } catch (e) {
    console.error('[mc:stock-resolve]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// FMR REGISTER
// ═══════════════════════════════════════════════════════════════

// GET /api/mc/:projectId/fmr
router.get('/:projectId/fmr', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { search, status, wbs_scope, critical_only, pickup_window } = req.query

    let conditions = ['f.project_id = ?']
    let params = [pid]
    if (status && status !== 'all') { conditions.push('f.status = ?'); params.push(status) }
    if (critical_only === 'true') { conditions.push('f.is_critical_path = 1') }
    if (wbs_scope) {
      const scopes = wbs_scope.split(',').map(s => s.trim())
      const scopeConds = scopes.map(() => 'f.wbs_code LIKE ?').join(' OR ')
      conditions.push(`(${scopeConds})`)
      scopes.forEach(s => params.push(`${s}%`))
    }
    if (pickup_window) {
      const days = parseInt(pickup_window)
      if (!isNaN(days)) { conditions.push('f.required_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)'); params.push(days) }
    }
    if (search) {
      const q = `%${search}%`
      // Match the header OR any of its line items.
      conditions.push(`(f.fmr_ref LIKE ? OR f.item_code LIKE ? OR f.description LIKE ? OR f.wbs_code LIKE ? OR f.requested_by_name LIKE ?
        OR EXISTS (SELECT 1 FROM fmr_lines l WHERE l.fmr_id=f.id AND (l.item_code LIKE ? OR l.description LIKE ? OR l.wbs_code LIKE ?)))`)
      params.push(q, q, q, q, q, q, q, q)
    }

    const [fmrs] = await db.query(
      `SELECT f.*,
         w.code AS warehouse_code, w.name AS warehouse_name,
         (SELECT COUNT(*) FROM fmr_lines WHERE fmr_id=f.id) AS line_count,
         (SELECT COALESCE(SUM(qty_requested),0) FROM fmr_lines WHERE fmr_id=f.id) AS total_qty_requested,
         -- Check stock availability (header item, legacy summary)
         (SELECT COALESCE(SUM(qty_available),0) FROM warehouse_stock WHERE item_code=f.item_code AND project_id=f.project_id AND condition_status='good' AND trace_hold=0) AS stock_on_hand
       FROM fmr_requests f
       LEFT JOIN warehouses w ON w.id = f.warehouse_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE WHEN f.required_date < CURDATE() THEN 0 ELSE 1 END,
         f.required_date ASC`,
      params
    )

    // Counts
    const [[counts]] = await db.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status='pending_approval' THEN 1 ELSE 0 END) AS pending_approval,
         SUM(CASE WHEN status='partial_issued' THEN 1 ELSE 0 END) AS partial_issued,
         SUM(CASE WHEN status IN ('issued') AND DATE(updated_at)=CURDATE() THEN 1 ELSE 0 END) AS issued_today,
         SUM(CASE WHEN required_date < CURDATE() AND status NOT IN ('issued','rejected','cancelled') THEN 1 ELSE 0 END) AS overdue
       FROM fmr_requests WHERE project_id = ?`,
      [pid]
    )

    res.json({ data: fmrs, counts })
  } catch (e) {
    console.error('[mc:fmr]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── FMR WBS SCOPE HELPER ─────────────────────────────────────
// Returns 'ALL' (unrestricted) or an array of WBS-code prefixes the
// user may raise FMRs against. No user_wbs_access rows → treated as
// unrestricted (internal/admin staff who aren't WBS-scoped).
async function getFmrWbsScope(userId, pid) {
  if (!userId) return 'ALL'
  const [rows] = await db.query(
    `SELECT wbs_code FROM user_wbs_access WHERE user_id=? AND project_id=?`, [userId, pid])
  if (!rows.length) return 'ALL'
  if (rows.some(r => r.wbs_code === 'ALL')) return 'ALL'
  return rows.map(r => r.wbs_code)
}
const inScope = (scope, wbs) =>
  scope === 'ALL' || (wbs && scope.some(p => wbs === p || wbs.startsWith(p + '.') || wbs.startsWith(p)))

// GET /api/mc/:projectId/fmr/items — contractor item picker
// Searches warehouse_stock by q (name/code), warehouse_id, wbs_id (wbs_code).
// Restricts to the contractor's WBS scope. NEVER returns grid/bin location.
router.get('/:projectId/fmr/items', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { q, warehouse_id, wbs_id } = req.query
    const scope = await getFmrWbsScope(req.user?.id, pid)

    const conds = ['s.project_id = ?', 's.qty_available > 0', "s.condition_status != 'quarantine'"]
    const params = [pid]
    if (warehouse_id) { conds.push('s.warehouse_id = ?'); params.push(Number(warehouse_id)) }
    if (wbs_id)       { conds.push('s.wbs_code = ?');     params.push(wbs_id) }
    if (q && q.trim()) {
      const like = `%${q.trim()}%`
      conds.push('(s.item_code LIKE ? OR s.description LIKE ? OR s.wbs_code LIKE ?)')
      params.push(like, like, like)
    }
    // WBS scope restriction (skip when unrestricted).
    if (scope !== 'ALL') {
      if (!scope.length) return res.json({ data: [] })
      conds.push('(' + scope.map(() => 's.wbs_code = ? OR s.wbs_code LIKE ?').join(' OR ') + ')')
      scope.forEach(p => params.push(p, `${p}%`))
    }

    // NOTE: location_code (grid/bin) deliberately NOT selected — MC-internal only.
    const [rows] = await db.query(
      `SELECT s.id AS item_id, s.item_code, s.description, s.wbs_code,
              s.qty_available, s.uom, s.warehouse_id,
              w.code AS warehouse_code, w.name AS warehouse_name,
              CASE WHEN e.tag IS NOT NULL THEN 'equipment' ELSE 'commodity' END AS item_type,
              NULL AS ros_date
       FROM warehouse_stock s
       LEFT JOIN warehouses w ON w.id = s.warehouse_id
       LEFT JOIN equipment_list e ON e.tag = s.item_code AND e.project_id = s.project_id
       WHERE ${conds.join(' AND ')}
       ORDER BY s.warehouse_id, s.item_code`,
      params)
    res.json({ data: rows })
  } catch (e) {
    console.error('[mc:fmr-items]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/mc/:projectId/fmr — raise new MULTI-LINE FMR (contractor)
// body: { warehouse_id, work_order_ref, required_date, requested_by_name,
//         requested_by_company, lines: [{item_id,item_code,item_type,wbs_code,
//         qty_requested,uom,description,ros_date}] }
router.post('/:projectId/fmr', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const userId = req.user?.id || 1
    const { warehouse_id, required_date, work_order_ref, requested_by_name, requested_by_company, lines } = req.body

    // ── Header validation ─────────────────────────────────────
    if (!warehouse_id) return res.status(422).json({ error: 'A warehouse is required — one warehouse per FMR' })
    if (!Array.isArray(lines) || lines.length === 0) return res.status(422).json({ error: 'At least one line item is required' })
    if (!required_date) return res.status(422).json({ error: 'Required date is required' })

    const scope = await getFmrWbsScope(userId, pid)

    // ── Line validation ───────────────────────────────────────
    for (const ln of lines) {
      const wbs = ln.wbs_code
      const qty = Number(ln.qty_requested)
      if (!wbs) return res.status(422).json({ error: 'Each line needs a WBS' })
      if (!qty || qty <= 0) return res.status(422).json({ error: 'Each line needs a quantity greater than 0' })

      // (a) item must belong to the chosen warehouse
      if (ln.item_id) {
        const [[stock]] = await db.query(
          `SELECT warehouse_id FROM warehouse_stock WHERE id=? AND project_id=?`, [ln.item_id, pid])
        if (!stock) return res.status(422).json({ error: `Item ${ln.item_code || ''} not found in stock` })
        if (Number(stock.warehouse_id) !== Number(warehouse_id))
          return res.status(422).json({ error: 'Mixed warehouse not allowed — all items in one FMR must come from the same warehouse' })
      }
      // (b) WBS must be in the contractor's scope
      if (!inScope(scope, wbs))
        return res.status(422).json({ error: `WBS ${wbs} is outside your contract scope of work` })
      // (c) equipment lines: qty must be 1 and a single WBS
      if (ln.item_type === 'equipment' && qty !== 1)
        return res.status(422).json({ error: 'Equipment items are unique — quantity must be 1' })
    }

    // ── Generate ref + insert header (denormalised summary = first line) ──
    const [[{ maxId }]] = await db.query("SELECT COALESCE(MAX(id),0) AS maxId FROM fmr_requests WHERE project_id=?", [pid])
    const year = new Date().getFullYear()
    const ref = `FMR-${year}-${String((maxId || 0) + 1).padStart(4, '0')}`
    const first = lines[0]
    const totalQty = lines.reduce((s, l) => s + Number(l.qty_requested), 0)

    const [result] = await db.query(
      `INSERT INTO fmr_requests
         (project_id, warehouse_id, fmr_ref, item_code, description, wbs_code, qty_requested, uom,
          required_date, work_order_ref, requested_by_name, requested_by_company, requested_by_user, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending_approval')`,
      [pid, warehouse_id, ref, first.item_code || null, first.description || null, first.wbs_code || null,
       totalQty, first.uom || 'EA', required_date, work_order_ref || null,
       requested_by_name || null, requested_by_company || null, userId])
    const fmrId = result.insertId

    // ── Insert lines ──────────────────────────────────────────
    for (const ln of lines) {
      await db.query(
        `INSERT INTO fmr_lines (fmr_id, item_id, item_code, item_type, description, wbs_code,
           qty_requested, uom, line_status, ros_date)
         VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`,
        [fmrId, ln.item_id || null, ln.item_code || null, ln.item_type === 'equipment' ? 'equipment' : 'commodity',
         ln.description || null, ln.wbs_code, Number(ln.qty_requested), ln.uom || 'EA', ln.ros_date || required_date])
    }

    await writeAudit(userId, 'fmr_raised', 'fmr', fmrId, null,
      { fmr_ref: ref, warehouse_id, line_count: lines.length, total_qty: totalQty },
      `/mc/${pid}/fmr`)

    const [[fmr]] = await db.query('SELECT * FROM fmr_requests WHERE id=?', [fmrId])
    res.status(201).json({ ...fmr, line_count: lines.length })
  } catch (e) {
    console.error('[mc:fmr-create]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/mc/:projectId/fmr/:fmrId/detail — header + all lines
router.get('/:projectId/fmr/:fmrId/detail', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const fmrId = Number(req.params.fmrId)
    const [[fmr]] = await db.query(
      `SELECT f.*, w.code AS warehouse_code, w.name AS warehouse_name
       FROM fmr_requests f LEFT JOIN warehouses w ON w.id=f.warehouse_id
       WHERE f.id=? AND f.project_id=?`, [fmrId, pid])
    if (!fmr) return res.status(404).json({ error: 'FMR not found' })
    const [lines] = await db.query(
      `SELECT id, item_id, item_code, item_type, description, wbs_code,
              qty_requested, qty_approved, qty_issued, uom, line_status,
              DATE_FORMAT(ros_date, '%Y-%m-%d') AS ros_date
       FROM fmr_lines WHERE fmr_id=? ORDER BY id`, [fmrId])
    // Heat/Lot P4b-i: per-line issued-heat breakdown from the issue ledger, so the
    // View modal can show "issued 20 of H-A + 10 of H-B" (one row per line+heat).
    const [issuedHeats] = await db.query(
      `SELECT fmr_line_id, heat_number, SUM(qty) AS qty FROM fmr_issue_lines
       WHERE fmr_id=? GROUP BY fmr_line_id, heat_number ORDER BY fmr_line_id, heat_number`, [fmrId])
    for (const l of lines) l.issued_heats = issuedHeats.filter(h => h.fmr_line_id === l.id)
    res.json({ fmr, lines })
  } catch (e) {
    console.error('[mc:fmr-detail]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── PER-LINE ALLOCATION HELPER ───────────────────────────────
// All figures are real & deterministic for a line's item+WBS:
//   on_hand              = available stock in the FMR's warehouse
//   already_issued       = qty already issued across all FMRs (this item+WBS)
//   wbs_total_allocation = on_hand + already_issued (what was available to draw)
//   remaining_allocation = on_hand (the ceiling a fresh approval draws against)
// remaining_allocation is the WBS ceiling the approve endpoint enforces.
async function fmrLineAllocation(pid, warehouseId, itemCode, wbsCode) {
  const [[oh]] = await db.query(
    `SELECT COALESCE(SUM(qty_available),0) AS on_hand FROM warehouse_stock
     WHERE project_id=? AND item_code=? AND wbs_code=? AND condition_status='good' AND trace_hold=0${warehouseId ? ' AND warehouse_id=?' : ''}`,
    warehouseId ? [pid, itemCode, wbsCode, warehouseId] : [pid, itemCode, wbsCode])
  const [[iss]] = await db.query(
    `SELECT COALESCE(SUM(fl.qty_issued),0) AS issued
       FROM fmr_lines fl JOIN fmr_requests fr ON fr.id = fl.fmr_id
      WHERE fr.project_id=? AND fl.item_code=? AND fl.wbs_code=?`, [pid, itemCode, wbsCode])
  const on_hand = Number(oh.on_hand)
  const already_issued = Number(iss.issued)
  return {
    on_hand,
    already_issued,
    wbs_total_allocation: on_hand + already_issued,
    remaining_allocation: on_hand,
    in_transit: 0,
  }
}

// ─── FMR HEADER ROLL-UP ───────────────────────────────────────
// Derives the header status from the set of line statuses. Covers BOTH the
// approval phase and (P4a-i) the issue phase: once any line is issued, the
// header reflects issued / partial_issued (previously unreachable).
function rollUpStatus(lineStatuses) {
  if (lineStatuses.some(s => s === 'pending')) return 'pending_approval'
  // Issue phase — once consumption has begun on any line.
  const anyIssued = lineStatuses.some(s => s === 'issued' || s === 'partial_issued')
  if (anyIssued) {
    const active = lineStatuses.filter(s => s !== 'rejected')
    const allIssued = active.length > 0 && active.every(s => s === 'issued')
    return allIssued ? 'issued' : 'partial_issued'
  }
  // Approval phase.
  const anyApproved = lineStatuses.some(s => s === 'approved' || s === 'partially_approved')
  const anyRejected = lineStatuses.some(s => s === 'rejected')
  if (anyApproved && anyRejected) return 'partially_approved'
  if (anyRejected && !anyApproved) return 'rejected'
  return 'approved' // all approved / partially_approved
}

// GET /api/mc/:projectId/fmr/:fmrId/approval — header + lines + per-line allocation
// MC-internal: may include warehouse/grid context. Used by the approval modal.
router.get('/:projectId/fmr/:fmrId/approval', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const fmrId = Number(req.params.fmrId)
    const [[fmr]] = await db.query(
      `SELECT f.*, w.code AS warehouse_code, w.name AS warehouse_name
       FROM fmr_requests f LEFT JOIN warehouses w ON w.id=f.warehouse_id
       WHERE f.id=? AND f.project_id=?`, [fmrId, pid])
    if (!fmr) return res.status(404).json({ error: 'FMR not found' })

    const [lines] = await db.query(
      `SELECT id AS line_id, item_id, item_code, item_type, description, wbs_code,
              qty_requested, qty_issued, qty_approved, uom, line_status, approval_reason
       FROM fmr_lines WHERE fmr_id=? ORDER BY id`, [fmrId])

    const advanceDays = fmr.required_date
      ? Math.ceil((new Date(fmr.required_date).getTime() - Date.now()) / 86400000) : null

    const enriched = []
    for (const ln of lines) {
      const alloc = await fmrLineAllocation(pid, fmr.warehouse_id, ln.item_code, ln.wbs_code)
      const req_qty = Number(ln.qty_requested)
      enriched.push({
        ...ln,
        alloc,
        checks: {
          // Correct ceiling: pass only when the requested qty fits the remaining allocation.
          wbs_ceiling: { ok: req_qty <= alloc.remaining_allocation, requested: req_qty, remaining: alloc.remaining_allocation },
          stock: { ok: req_qty <= alloc.on_hand, on_hand: alloc.on_hand },
          advance: { ok: !(advanceDays !== null && advanceDays > 30), days: advanceDays },
        },
      })
    }
    res.json({ fmr, lines: enriched })
  } catch (e) {
    console.error('[mc:fmr-approval]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/mc/:projectId/fmr/:fmrId/approve — PER-LINE decisions (subcontractor = 403)
// body: { decisions: [{ line_id, decision: 'approve_full'|'approve_partial'|'reject',
//                       qty_approved?, reason? }] }
router.put('/:projectId/fmr/:fmrId/approve', async (req, res) => {
  if (!APPROVAL_ALLOWED.has(req.user?.role)) return res.status(403).json({ error: 'Only Materials Controllers and Managers can approve FMRs' })
  try {
    const pid = Number(req.params.projectId)
    const fmrId = Number(req.params.fmrId)
    const userId = req.user?.id || 1
    const { decisions } = req.body

    if (!Array.isArray(decisions) || decisions.length === 0)
      return res.status(422).json({ error: 'decisions array is required' })

    const [[fmr]] = await db.query('SELECT * FROM fmr_requests WHERE id=? AND project_id=?', [fmrId, pid])
    if (!fmr) return res.status(404).json({ error: 'FMR not found' })

    const [lineRows] = await db.query('SELECT * FROM fmr_lines WHERE fmr_id=?', [fmrId])
    const lineMap = new Map(lineRows.map(l => [l.id, l]))

    // ── Validate every decision before writing anything ────────
    const planned = []
    for (const d of decisions) {
      const line = lineMap.get(Number(d.line_id))
      if (!line) return res.status(422).json({ error: `Unknown line_id ${d.line_id}` })
      const reqQty = Number(line.qty_requested)
      const alloc = await fmrLineAllocation(pid, fmr.warehouse_id, line.item_code, line.wbs_code)

      if (d.decision === 'approve_full') {
        // WBS ceiling: a full approval that exceeds remaining allocation is blocked.
        if (reqQty > alloc.remaining_allocation)
          return res.status(422).json({ error: `Line ${line.item_code} (${line.wbs_code}): requested ${reqQty} exceeds remaining allocation of ${alloc.remaining_allocation} — approve partial up to ${alloc.remaining_allocation} instead`, line_id: line.id })
        planned.push({ line, status: 'approved', qty: reqQty, reason: null })

      } else if (d.decision === 'approve_partial') {
        const qty = Number(d.qty_approved)
        if (!(qty > 0 && qty < reqQty))
          return res.status(422).json({ error: `Line ${line.item_code}: partial qty must be greater than 0 and less than the requested ${reqQty}`, line_id: line.id })
        if (qty > alloc.remaining_allocation)
          return res.status(422).json({ error: `Line ${line.item_code}: ${qty} exceeds remaining allocation of ${alloc.remaining_allocation}`, line_id: line.id })
        if (!d.reason || !d.reason.trim())
          return res.status(422).json({ error: `Line ${line.item_code}: a reason is required for partial approval`, line_id: line.id })
        planned.push({ line, status: 'partially_approved', qty, reason: d.reason.trim() })

      } else if (d.decision === 'reject') {
        if (!d.reason || !d.reason.trim())
          return res.status(422).json({ error: `Line ${line.item_code}: a reason is required to reject`, line_id: line.id })
        planned.push({ line, status: 'rejected', qty: 0, reason: d.reason.trim() })

      } else {
        return res.status(422).json({ error: `Line ${d.line_id}: decision must be approve_full, approve_partial or reject` })
      }
    }

    // ── Apply per-line + write an audit row per decision ───────
    for (const p of planned) {
      await db.query(
        `UPDATE fmr_lines SET line_status=?, qty_approved=?, approval_reason=?, approved_by=?, approved_date=NOW() WHERE id=?`,
        [p.status, p.qty, p.reason, userId, p.line.id])
      await writeAudit(userId, 'fmr_line_decision', 'fmr_line', p.line.id,
        { line_status: p.line.line_status },
        { line_status: p.status, qty_approved: p.qty, reason: p.reason },
        `/mc/${pid}/fmr/${fmrId}/approve`)
    }

    // ── Recompute + persist header roll-up ─────────────────────
    const [allLines] = await db.query('SELECT line_status FROM fmr_lines WHERE fmr_id=?', [fmrId])
    const newStatus = rollUpStatus(allLines.map(l => l.line_status))
    const [[appQty]] = await db.query('SELECT COALESCE(SUM(qty_approved),0) AS q FROM fmr_lines WHERE fmr_id=?', [fmrId])
    await db.query(
      `UPDATE fmr_requests SET status=?, approved_by=?, approved_at=NOW(), approved_qty=? WHERE id=?`,
      [newStatus, userId, appQty.q, fmrId])
    await writeAudit(userId, 'fmr_decision', 'fmr', fmrId,
      { status: fmr.status }, { status: newStatus, lines_decided: planned.length },
      `/mc/${pid}/fmr/${fmrId}/approve`)

    const [[updated]] = await db.query('SELECT * FROM fmr_requests WHERE id=?', [fmrId])
    res.json({ success: true, fmr: updated, header_status: newStatus })
  } catch (e) {
    console.error('[mc:fmr-approve]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/mc/:projectId/fmr/:fmrId/issue — ISSUE the approved qty (Heat/Lot P4a-i).
// The missing consumption step: decrement issuable holdings and record the issue.
// One-click "issue approved qty"; auto-FIFO by received_date across issuable
// holdings (good + trace_hold=0 + qty_available>0) in the FMR's warehouse, item+wbs.
// Over-issue is impossible (each take is clamped to qty_available, holdings FOR
// UPDATE); if stock is short the line becomes partial_issued. Whole consumption
// in one pooled transaction. NO HEAT yet — fmr_issue_lines.heat_number is P4b.
router.post('/:projectId/fmr/:fmrId/issue', async (req, res) => {
  if (!APPROVAL_ALLOWED.has(req.user?.role)) return res.status(403).json({ error: 'Only Materials Controllers and Managers can issue FMRs' })
  const pid = Number(req.params.projectId)
  const fmrId = Number(req.params.fmrId)
  const userId = req.user?.id || 1

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [[fmr]] = await conn.query('SELECT * FROM fmr_requests WHERE id=? AND project_id=? FOR UPDATE', [fmrId, pid])
    if (!fmr) { await conn.rollback(); conn.release(); return res.status(404).json({ error: 'FMR not found' }) }
    // Only an approved FMR can be issued (partial_issued allowed → top up after restock).
    if (!['approved', 'partially_approved', 'partial_issued'].includes(fmr.status)) {
      await conn.rollback(); conn.release()
      return res.status(422).json({ error: `FMR must be approved before issuing (current status: ${fmr.status})` })
    }

    const [lines] = await conn.query('SELECT * FROM fmr_lines WHERE fmr_id=?', [fmrId])
    let totalIssued = 0
    let anyShort = false

    for (const line of lines) {
      const approved = Number(line.qty_approved || 0)
      const already  = Number(line.qty_issued || 0)
      let outstanding = approved - already
      if (!(outstanding > 0)) continue   // rejected (approved=0) or already fully issued

      // Issuable holdings — FIFO, locked. Quarantine AND trace_hold excluded.
      // heat_number (P4b-i) is recorded onto each ledger row below.
      const [holds] = await conn.query(
        `SELECT id, qty, qty_available, location_code, heat_number FROM warehouse_stock
         WHERE project_id=? AND warehouse_id=? AND item_code=? AND wbs_code=?
           AND condition_status='good' AND trace_hold=0 AND qty_available>0
         ORDER BY received_date ASC, created_at ASC FOR UPDATE`,
        [pid, fmr.warehouse_id, line.item_code, line.wbs_code])

      let lineIssued = 0
      for (const h of holds) {
        if (outstanding <= 0) break
        const take = Math.min(outstanding, Number(h.qty_available))   // clamp → never over-issue / negative
        if (!(take > 0)) continue
        const newQty   = Number(h.qty) - take
        const newAvail = Number(h.qty_available) - take
        if (newQty <= 0) await conn.query('DELETE FROM warehouse_stock WHERE id=?', [h.id])   // fully consumed → row removed (transfer pattern)
        else await conn.query('UPDATE warehouse_stock SET qty=?, qty_available=? WHERE id=?', [newQty, newAvail, h.id])
        await conn.query(
          `INSERT INTO fmr_issue_lines (fmr_id, fmr_line_id, stock_id, qty, heat_number, location_code, item_code, wbs_code, issued_by)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [fmrId, line.id, h.id, take, h.heat_number || null, h.location_code, line.item_code, line.wbs_code, userId])
        lineIssued += take
        outstanding -= take
      }

      if (lineIssued > 0) {
        const newIssued = already + lineIssued
        const lineStatus = newIssued >= approved ? 'issued' : 'partial_issued'
        await conn.query('UPDATE fmr_lines SET qty_issued=?, line_status=? WHERE id=?', [newIssued, lineStatus, line.id])
        totalIssued += lineIssued
      }
      if (outstanding > 0) anyShort = true   // stock short → this line stays partial
    }

    // Header roll-up (rollUpStatus now reaches issued / partial_issued).
    const [allLines] = await conn.query('SELECT line_status FROM fmr_lines WHERE fmr_id=?', [fmrId])
    const newStatus = rollUpStatus(allLines.map(l => l.line_status))
    const [[iq]] = await conn.query('SELECT COALESCE(SUM(qty_issued),0) AS q FROM fmr_lines WHERE fmr_id=?', [fmrId])
    await conn.query('UPDATE fmr_requests SET status=?, qty_issued=?, updated_at=NOW() WHERE id=?', [newStatus, iq.q, fmrId])

    await conn.commit()
    await writeAudit(userId, 'fmr_issue', 'fmr', fmrId,
      { status: fmr.status }, { status: newStatus, total_issued: totalIssued, short: anyShort },
      `/mc/${pid}/fmr/${fmrId}/issue`)

    const [[updated]] = await db.query('SELECT * FROM fmr_requests WHERE id=?', [fmrId])
    res.json({ success: true, total_issued: totalIssued, short: anyShort, header_status: newStatus, fmr: updated })
  } catch (e) {
    await conn.rollback()
    console.error('[mc:fmr-issue]', e.message)
    res.status(500).json({ error: e.message })
  } finally {
    conn.release()
  }
})

// ═══════════════════════════════════════════════════════════════
// WAREHOUSE TRANSFERS
// ═══════════════════════════════════════════════════════════════

// GET /api/mc/:projectId/transfers — external users blocked
router.get('/:projectId/transfers', rejectExternal, async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { search, status } = req.query

    let conditions = ['t.project_id = ?']
    let params = [pid]
    if (status && status !== 'all') { conditions.push('t.status = ?'); params.push(status) }
    if (search) {
      const q = `%${search}%`
      conditions.push('(t.transfer_ref LIKE ? OR t.item_code LIKE ? OR t.description LIKE ? OR t.wbs_code LIKE ? OR t.requested_by_name LIKE ?)')
      params.push(q, q, q, q, q)
    }

    const [transfers] = await db.query(
      `SELECT t.*,
              fw.name AS from_warehouse_name, fw.code AS from_warehouse_code,
              tw.name AS to_warehouse_name, tw.code AS to_warehouse_code
       FROM warehouse_transfers t
       LEFT JOIN warehouses fw ON t.from_warehouse_id = fw.id
       LEFT JOIN warehouses tw ON t.to_warehouse_id = tw.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.est_pickup_date ASC`,
      params
    )

    const [[counts]] = await db.query(
      `SELECT
         SUM(CASE WHEN status='requested' THEN 1 ELSE 0 END) AS requested,
         SUM(CASE WHEN status='in_transit' THEN 1 ELSE 0 END) AS in_transit,
         SUM(CASE WHEN status='picked_up' THEN 1 ELSE 0 END) AS picked_up,
         SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) AS complete
       FROM warehouse_transfers WHERE project_id=?`,
      [pid]
    )

    res.json({ data: transfers, counts })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET selectable transfer SOURCE holdings — clean good stock only.
// Quarantine + trace_hold are excluded from the picker (they route through the
// approval path, not free selection).
router.get('/:projectId/transfers/stock-options', rejectExternal, async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { warehouse_id } = req.query
    const conds = ['s.project_id = ?', 's.qty_available > 0', "s.condition_status = 'good'", 's.trace_hold = 0']
    const params = [pid]
    if (warehouse_id) { conds.push('s.warehouse_id = ?'); params.push(Number(warehouse_id)) }
    const [rows] = await db.query(
      `SELECT s.id, s.item_code, s.description, s.location_code, s.qty_available, s.uom, s.wbs_code,
              s.condition_status, s.heat_number, s.warehouse_id, w.name AS warehouse_name, w.code AS warehouse_code
       FROM warehouse_stock s LEFT JOIN warehouses w ON w.id = s.warehouse_id
       WHERE ${conds.join(' AND ')} ORDER BY s.item_code, s.location_code`, params)
    res.json({ data: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST create — STOCK-LINKED. Source is a real warehouse_stock holding (stock_id);
// item/uom/wbs/from-location are derived from it. The actual stock MOVE fires later
// at completion (not now). Quarantine/trace_hold source → pending_approval.
router.post('/:projectId/transfers', rejectExternal, async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { stock_id, qty, to_warehouse_id, to_location, requested_by_name, requested_by_company, est_pickup_date, notes } = req.body
    const userId = req.user?.id || 1

    if (!stock_id) return res.status(422).json({ error: 'A source stock holding is required' })
    if (!to_warehouse_id) return res.status(422).json({ error: 'Destination warehouse is required' })
    const moveQty = Number(qty)
    if (!(moveQty > 0)) return res.status(422).json({ error: 'Quantity must be greater than 0' })

    const [[src]] = await db.query('SELECT * FROM warehouse_stock WHERE id=? AND project_id=?', [stock_id, pid])
    if (!src) return res.status(404).json({ error: 'Source stock holding not found' })
    // Clean stock moves against qty_available; quarantine (qty_available=0 by design)
    // moves against its physical qty — and stays non-issuable at the destination.
    const movable = src.condition_status === 'quarantine' ? Number(src.qty) : Number(src.qty_available)
    if (moveQty > movable) return res.status(422).json({ error: `Quantity exceeds available (${movable} ${src.uom})` })
    const [[dw]] = await db.query('SELECT id FROM warehouses WHERE id=?', [to_warehouse_id])
    if (!dw) return res.status(422).json({ error: 'Destination warehouse not found' })

    // Quarantine / trace-hold stock requires MC approval; clean good stock is frictionless.
    const needsApproval = src.condition_status === 'quarantine' || src.trace_hold === 1
    const status = needsApproval ? 'pending_approval' : 'requested'

    const year = new Date().getFullYear()
    const [[{ maxId }]] = await db.query("SELECT COALESCE(MAX(id),0) AS maxId FROM warehouse_transfers WHERE project_id=?", [pid])
    const ref = `TRF-${year}-${String((maxId || 0) + 1).padStart(4,'0')}`

    const [result] = await db.query(
      `INSERT INTO warehouse_transfers (project_id,transfer_ref,stock_id,item_code,description,wbs_code,heat_number,qty,uom,from_warehouse_id,from_location,to_warehouse_id,to_location,requested_by_name,requested_by_company,requested_by_user,status,est_pickup_date,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pid, ref, src.id, src.item_code, src.description, src.wbs_code, src.heat_number, moveQty, src.uom,
       src.warehouse_id, src.location_code, to_warehouse_id, to_location || null,
       requested_by_name || null, requested_by_company || null, userId, status, est_pickup_date || null, notes || null])
    await writeAudit(userId, 'transfer_create', 'warehouse_transfer', result.insertId, null,
      { transfer_ref: ref, stock_id: src.id, qty: moveQty, status }, `/mc/${pid}/transfers`)

    const [[tr]] = await db.query('SELECT t.*, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name FROM warehouse_transfers t LEFT JOIN warehouses fw ON t.from_warehouse_id=fw.id LEFT JOIN warehouses tw ON t.to_warehouse_id=tw.id WHERE t.id=?', [result.insertId])
    res.status(201).json(tr)
  } catch (e) {
    console.error('[mc:transfer-create]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/mc/:projectId/transfers/:transferId/status — advance status.
// GATE: a 'pending_approval' transfer cannot be advanced here (must be approved
// first via /approve). The atomic stock MOVE fires once, on first completion.
router.put('/:projectId/transfers/:transferId/status', rejectExternal, async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { transferId } = req.params
    const { status } = req.body
    const userId = req.user?.id || 1

    const VALID_STATUSES = ['requested','in_transit','picked_up','delivered','complete']
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' })

    const [[tr]] = await db.query('SELECT * FROM warehouse_transfers WHERE id=? AND project_id=?', [transferId, pid])
    if (!tr) return res.status(404).json({ error: 'Transfer not found' })

    // Both halves of the real gate:
    if (tr.status === 'pending_approval') return res.status(403).json({ error: 'Transfer is pending approval — it must be approved before it can proceed' })
    if (tr.status === 'rejected')         return res.status(422).json({ error: 'Transfer was rejected and cannot be advanced' })

    const doneStates = ['delivered','complete']
    const firstCompletion = doneStates.includes(status) && !doneStates.includes(tr.status)

    // ── Atomic stock MOVE on first completion (stock-linked transfers only) ──
    // Split-holding: decrement source qty + qty_available; create a NEW DISTINCT
    // destination holding carrying identity + condition (never pooled). Conserves totals.
    if (firstCompletion && tr.stock_id) {
      const conn = await db.getConnection()
      try {
        await conn.beginTransaction()
        const [[src]] = await conn.query('SELECT * FROM warehouse_stock WHERE id=? FOR UPDATE', [tr.stock_id])
        if (!src) throw new Error('source holding no longer exists')
        const isQuar = src.condition_status === 'quarantine'
        const srcMovable = isQuar ? Number(src.qty) : Number(src.qty_available)
        if (Number(tr.qty) > srcMovable) throw new Error(`source no longer has ${tr.qty} available`)
        // Decrement source: qty always; qty_available too unless quarantine (already 0, non-issuable).
        const newQty   = Number(src.qty) - Number(tr.qty)
        const newAvail = isQuar ? 0 : Number(src.qty_available) - Number(tr.qty)
        if (newQty <= 0) await conn.query('DELETE FROM warehouse_stock WHERE id=?', [src.id])           // whole-holding move → row removed
        else await conn.query('UPDATE warehouse_stock SET qty=?, qty_available=? WHERE id=?', [newQty, newAvail, src.id])
        // Destination: distinct holding; quarantine stays non-issuable (qty_available 0).
        const destAvail = isQuar ? 0 : Number(tr.qty)
        await conn.query(
          `INSERT INTO warehouse_stock (project_id,warehouse_id,scn_id,po_line_id,commodity_id,equipment_tag,item_code,description,wbs_code,qty,qty_available,uom,location_code,condition_status,trace_hold,vendor_name,heat_number,received_date,received_by,notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [pid, tr.to_warehouse_id, src.scn_id, src.po_line_id, src.commodity_id, src.equipment_tag,
           src.item_code, src.description, src.wbs_code, Number(tr.qty), destAvail, src.uom,
           tr.to_location || src.location_code, src.condition_status, src.trace_hold, src.vendor_name,
           src.heat_number, src.received_date, userId, `Transferred via ${tr.transfer_ref} from ${src.location_code || '—'}`])
        await conn.commit()
      } catch (mErr) { await conn.rollback(); conn.release(); return res.status(422).json({ error: 'Stock move failed: ' + mErr.message }) }
      conn.release()
    }

    const dateField = status === 'picked_up' ? ', actual_pickup_date=CURDATE()' : status === 'delivered' ? ', delivered_date=CURDATE()' : ''
    await db.query(`UPDATE warehouse_transfers SET status=? ${dateField} WHERE id=?`, [status, transferId])
    await writeAudit(userId, 'transfer_status', 'warehouse_transfer', transferId,
      { status: tr.status }, { status, stock_moved: firstCompletion && !!tr.stock_id },
      `/mc/${pid}/transfers/${transferId}/status`)

    const [[updated]] = await db.query('SELECT t.*, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name FROM warehouse_transfers t LEFT JOIN warehouses fw ON t.from_warehouse_id=fw.id LEFT JOIN warehouses tw ON t.to_warehouse_id=tw.id WHERE t.id=?', [transferId])
    res.json({ success: true, transfer: updated })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/mc/:projectId/transfers/:transferId/approve — role-guarded (FMR pattern).
// Approve → re-enters the normal lifecycle as 'requested' (no 'approved' enum state;
// approval recorded via approved_by/at). Reject → terminal 'rejected' (never moves stock).
router.post('/:projectId/transfers/:transferId/approve', async (req, res) => {
  if (!APPROVAL_ALLOWED.has(req.user?.role)) return res.status(403).json({ error: 'Only Materials Controllers and Managers can approve transfers' })
  try {
    const pid = Number(req.params.projectId)
    const { transferId } = req.params
    const { decision, reason } = req.body || {}
    const userId = req.user?.id || 1
    if (!['approve','reject'].includes(decision)) return res.status(422).json({ error: "decision must be 'approve' or 'reject'" })

    const [[tr]] = await db.query('SELECT * FROM warehouse_transfers WHERE id=? AND project_id=?', [transferId, pid])
    if (!tr) return res.status(404).json({ error: 'Transfer not found' })
    if (tr.status !== 'pending_approval') return res.status(422).json({ error: 'Only transfers pending approval can be approved or rejected' })
    if (decision === 'reject' && (!reason || !reason.trim())) return res.status(422).json({ error: 'A reason is required to reject' })

    const newStatus = decision === 'approve' ? 'requested' : 'rejected'
    await db.query('UPDATE warehouse_transfers SET status=?, approved_by=?, approved_at=NOW(), approval_reason=? WHERE id=?',
      [newStatus, userId, reason ? reason.trim() : null, transferId])
    await writeAudit(userId, decision === 'approve' ? 'transfer_approved' : 'transfer_rejected', 'warehouse_transfer', transferId,
      { status: 'pending_approval' }, { status: newStatus, reason: reason ? reason.trim() : null },
      `/mc/${pid}/transfers/${transferId}/approve`)

    const [[updated]] = await db.query('SELECT t.*, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name FROM warehouse_transfers t LEFT JOIN warehouses fw ON t.from_warehouse_id=fw.id LEFT JOIN warehouses tw ON t.to_warehouse_id=tw.id WHERE t.id=?', [transferId])
    res.json({ success: true, transfer: updated })
  } catch (e) { console.error('[mc:transfer-approve]', e.message); res.status(500).json({ error: e.message }) }
})

// GET /api/mc/:projectId/warehouses — list available warehouses
router.get('/:projectId/warehouses', async (req, res) => {
  try {
    const [whs] = await db.query('SELECT id, name, code, type, city FROM warehouses WHERE status=? ORDER BY name', ['active'])
    res.json(whs)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
