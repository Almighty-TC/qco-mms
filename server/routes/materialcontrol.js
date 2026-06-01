// ─── MATERIAL CONTROL ROUTES ──────────────────────────────────
// Receipting, Stock Register, FMR Register, Warehouse Transfers.
// All routes require a valid JWT via authenticateToken.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken } = require('../middleware/auth')

router.use(authenticateToken)

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
    const tabStatus = {
      arrived:    ['arrived'],
      in_transit: ['in-transit', 'in_transit', 'pending'],
      customs:    ['customs_review'],
      shipments:  ['arrived','in-transit','in_transit','pending','customs_review'],
      transfers:  [], // warehouse_transfers handled separately
      all:        ['arrived','in-transit','in_transit','pending','customs_review','draft'],
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

    const arrived_count   = allRows.filter(r => r.status === 'arrived').length
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
    const [lines] = await db.query(
      `SELECT pl.id, pl.line_number, pl.description, pl.qty, pl.uom, pl.qty_assigned
       FROM po_lines pl WHERE pl.po_id = ?`,
      [scn.po_id || 0]
    )

    res.json({ ...scn, packages, lines })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/mc/:projectId/receipting/:scnId/complete — complete receipt (creates stock)
router.post('/:projectId/receipting/:scnId/complete', rejectExternal, async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)
    const pid   = Number(req.params.projectId)
    const { location_code, cargo_condition, actual_packages, notes, warehouse_id } = req.body
    const userId = req.user?.id || 1

    if (!location_code) return res.status(400).json({ error: 'Grid location is required' })

    const [[scn]] = await db.query('SELECT * FROM shipment_control_notes WHERE id = ?', [scnId])
    if (!scn) return res.status(404).json({ error: 'SCN not found' })

    // Mark SCN as received
    await db.query(
      'UPDATE shipment_control_notes SET status=?, ata=CURDATE() WHERE id=?',
      ['received', scnId]
    )

    // Create stock entries from packages
    const [pkgs] = await db.query('SELECT * FROM scn_packages WHERE scn_id=?', [scnId])
    for (const pkg of pkgs) {
      await db.query(
        `INSERT INTO warehouse_stock (project_id,warehouse_id,scn_id,item_code,description,wbs_code,qty,qty_available,uom,location_code,condition_status,vendor_name,received_date,received_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURDATE(),?)`,
        [pid, warehouse_id || scn.destination_warehouse_id || 1, scnId,
         `SCN-${scn.scn_ref}-PKG${pkg.package_number}`,
         pkg.description || scn.notes || 'Received goods',
         null, pkg.gross_weight_kg || 1, pkg.gross_weight_kg || 1, 'EA',
         location_code,
         cargo_condition === 'good' ? 'good' : cargo_condition === 'minor_damage' ? 'minor_damage' : 'major_damage',
         scn.vendor_name, userId]
      )
    }

    await writeAudit(userId, 'receipt_complete', 'scn', scnId,
      { status: scn.status },
      { status: 'received', location_code, cargo_condition },
      `/mc/${pid}/receipting/${scnId}/complete`)

    res.json({ success: true, stock_created: pkgs.length })
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
      conditions.push('(f.fmr_ref LIKE ? OR f.item_code LIKE ? OR f.description LIKE ? OR f.wbs_code LIKE ? OR f.requested_by_name LIKE ?)')
      params.push(q, q, q, q, q)
    }

    const [fmrs] = await db.query(
      `SELECT f.*,
         -- Check stock availability
         (SELECT COALESCE(SUM(qty_available),0) FROM warehouse_stock WHERE item_code=f.item_code AND project_id=f.project_id) AS stock_on_hand
       FROM fmr_requests f
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

// POST /api/mc/:projectId/fmr — raise new FMR (contractor)
router.post('/:projectId/fmr', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { item_code, description, wbs_code, qty_requested, uom, required_date, work_order_ref, requested_by_name, requested_by_company } = req.body
    const userId = req.user?.id || 1

    if (!description?.trim()) return res.status(400).json({ error: 'Description is required' })
    if (!qty_requested || qty_requested <= 0) return res.status(400).json({ error: 'Quantity must be greater than 0' })
    if (!required_date) return res.status(400).json({ error: 'Required date is required' })

    // Generate FMR ref
    const [[{ maxId }]] = await db.query("SELECT COALESCE(MAX(id),0) AS maxId FROM fmr_requests WHERE project_id=?", [pid])
    const year = new Date().getFullYear()
    const ref = `FMR-${year}-${String((maxId || 0) + 1).padStart(4,'0')}`

    const [result] = await db.query(
      `INSERT INTO fmr_requests (project_id,fmr_ref,item_code,description,wbs_code,qty_requested,uom,required_date,work_order_ref,requested_by_name,requested_by_company,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending_approval')`,
      [pid, ref, item_code||null, description.trim(), wbs_code||null, qty_requested, uom||'EA', required_date, work_order_ref||null, requested_by_name||null, requested_by_company||null]
    )
    const [[fmr]] = await db.query('SELECT * FROM fmr_requests WHERE id=?', [result.insertId])
    res.status(201).json(fmr)
  } catch (e) {
    console.error('[mc:fmr-create]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/mc/:projectId/fmr/:fmrId/approve — MC approves/rejects (subcontractor = 403)
router.put('/:projectId/fmr/:fmrId/approve', async (req, res) => {
  if (!APPROVAL_ALLOWED.has(req.user?.role)) return res.status(403).json({ error: 'Only Materials Controllers and Managers can approve FMRs' })
  try {
    const { fmrId } = req.params
    const { decision, approved_qty, rejection_reason } = req.body
    const userId = req.user?.id || 1

    if (!['approve_full','approve_partial','reject'].includes(decision))
      return res.status(400).json({ error: 'decision must be approve_full, approve_partial, or reject' })

    const [[fmr]] = await db.query('SELECT * FROM fmr_requests WHERE id=?', [fmrId])
    if (!fmr) return res.status(404).json({ error: 'FMR not found' })

    let newStatus, newApprovedQty
    if (decision === 'approve_full') {
      newStatus = 'approved'; newApprovedQty = fmr.qty_requested
    } else if (decision === 'approve_partial') {
      if (!approved_qty || approved_qty <= 0) return res.status(400).json({ error: 'approved_qty required for partial approval' })
      newStatus = 'approved'; newApprovedQty = approved_qty
    } else {
      if (!rejection_reason?.trim()) return res.status(400).json({ error: 'rejection_reason is required when rejecting' })
      newStatus = 'rejected'; newApprovedQty = 0
    }

    await db.query(
      'UPDATE fmr_requests SET status=?, approved_by=?, approved_at=NOW(), approved_qty=?, rejection_reason=? WHERE id=?',
      [newStatus, userId, newApprovedQty||null, rejection_reason||null, fmrId]
    )
    await writeAudit(userId, 'fmr_decision', 'fmr', fmrId,
      { status: fmr.status }, { status: newStatus, decision },
      `/mc/${req.params.projectId}/fmr/${fmrId}/approve`)

    const [[updated]] = await db.query('SELECT * FROM fmr_requests WHERE id=?', [fmrId])
    res.json({ success: true, fmr: updated })
  } catch (e) {
    console.error('[mc:fmr-approve]', e.message)
    res.status(500).json({ error: e.message })
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

router.post('/:projectId/transfers', rejectExternal, async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { item_code, description, wbs_code, qty, uom, from_warehouse_id, from_location, to_warehouse_id, to_location, requested_by_name, requested_by_company, est_pickup_date, notes } = req.body
    const userId = req.user?.id || 1

    if (!from_warehouse_id) return res.status(400).json({ error: 'Source warehouse is required' })
    if (!to_warehouse_id) return res.status(400).json({ error: 'Destination warehouse is required' })
    if (!description?.trim()) return res.status(400).json({ error: 'Description is required' })
    if (!qty || qty <= 0) return res.status(400).json({ error: 'Quantity must be greater than 0' })

    const year = new Date().getFullYear()
    const [[{ maxId }]] = await db.query("SELECT COALESCE(MAX(id),0) AS maxId FROM warehouse_transfers WHERE project_id=?", [pid])
    const ref = `TRF-${year}-${String((maxId || 0) + 1).padStart(4,'0')}`

    const [result] = await db.query(
      `INSERT INTO warehouse_transfers (project_id,transfer_ref,item_code,description,wbs_code,qty,uom,from_warehouse_id,from_location,to_warehouse_id,to_location,requested_by_name,requested_by_company,status,est_pickup_date,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'requested',?,?)`,
      [pid, ref, item_code||null, description.trim(), wbs_code||null, qty, uom||'EA',
       from_warehouse_id, from_location||null, to_warehouse_id, to_location||null,
       requested_by_name||null, requested_by_company||null, est_pickup_date||null, notes||null]
    )
    const [[tr]] = await db.query('SELECT t.*, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name FROM warehouse_transfers t LEFT JOIN warehouses fw ON t.from_warehouse_id=fw.id LEFT JOIN warehouses tw ON t.to_warehouse_id=tw.id WHERE t.id=?', [result.insertId])
    res.status(201).json(tr)
  } catch (e) {
    console.error('[mc:transfer-create]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/mc/:projectId/transfers/:transferId/status — advance status
router.put('/:projectId/transfers/:transferId/status', async (req, res) => {
  try {
    const { transferId } = req.params
    const { status } = req.body
    const userId = req.user?.id || 1

    const VALID_STATUSES = ['requested','in_transit','picked_up','delivered','complete']
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' })

    const [[tr]] = await db.query('SELECT * FROM warehouse_transfers WHERE id=?', [transferId])
    if (!tr) return res.status(404).json({ error: 'Transfer not found' })

    const dateField = status === 'picked_up' ? ', actual_pickup_date=CURDATE()' : status === 'delivered' ? ', delivered_date=CURDATE()' : ''
    await db.query(`UPDATE warehouse_transfers SET status=? ${dateField} WHERE id=?`, [status, transferId])
    await writeAudit(userId, 'transfer_status', 'warehouse_transfer', transferId,
      { status: tr.status }, { status },
      `/mc/${req.params.projectId}/transfers/${transferId}/status`)

    const [[updated]] = await db.query('SELECT t.*, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name FROM warehouse_transfers t LEFT JOIN warehouses fw ON t.from_warehouse_id=fw.id LEFT JOIN warehouses tw ON t.to_warehouse_id=tw.id WHERE t.id=?', [transferId])
    res.json({ success: true, transfer: updated })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/mc/:projectId/warehouses — list available warehouses
router.get('/:projectId/warehouses', async (req, res) => {
  try {
    const [whs] = await db.query('SELECT id, name, code, type, city FROM warehouses WHERE status=? ORDER BY name', ['active'])
    res.json(whs)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
