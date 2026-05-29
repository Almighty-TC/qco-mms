const express = require('express')
const bcrypt  = require('bcryptjs')
const router  = express.Router()
const db      = require('../db')
const { sendEmail, sendAlert, html }                  = require('../services/email')
const { generate, addToHistory, expiresAt: pwExpiry } = require('../utils/password')

// ─── VALID ENUMERATIONS ──────────────────────────────────────
// Validated against before writing to DB to prevent invalid data.
const VALID_ROLES = new Set([
  'admin', 'ceo', 'director', 'project_director', 'project_manager',
  'procurement_manager', 'procurement_officer',
  'expediting_manager', 'expeditor', 'logistics_manager',
  'warehouse', 'vendor', 'freight_forwarder', 'site_contractor', 'subcontractor', 'viewer',
])
const VALID_MODULES = new Set([
  'dashboard', 'procurement', 'expediting', 'vdrl', 'logistics',
  'material_control', 'traceability', 'document_inbox', 'audit', 'admin',
])
const VALID_RAG    = new Set(['red', 'amber', 'green', 'blue', 'grey'])
const VALID_STATUS = new Set(['active', 'inactive'])

// ─── ADMIN GUARD ────────────────────────────────────────────
// All routes in this file require role = 'admin' in the JWT.
// authenticateToken (applied in index.js) has already verified the
// token and set req.user; here we only check the role field.
router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
})

// ─── AUDIT LOG ──────────────────────────────────────────────
// Persists every admin action to the audit_log table.
// Falls back to console-only if the table doesn't exist yet.
function audit(req, action, resource) {
  const userId = req.user?.id
  const ip     = req.ip ?? null
  db.query(
    `INSERT INTO audit_log (user_id, action, resource, ip) VALUES (?, ?, ?, ?)`,
    [userId, action, resource, ip]
  ).catch(() => {
    // table may not exist yet; fall back to console log
    console.log(`[audit] user=${userId} action=${action} resource=${resource} ip=${ip}`)
  })
}

// ─── PAGINATION HELPER ──────────────────────────────────────
// Parses and clamps page/limit query params. Returns { page, limit, offset }.
function paginate(query) {
  const page   = Math.max(1, parseInt(query.page  || '1'))
  const limit  = Math.min(200, Math.max(1, parseInt(query.limit || '50')))
  return { page, limit, offset: (page - 1) * limit }
}

// ─── (admin-count endpoint removed) ────────────────────────
// Two-admin approval workflow removed. All admin actions are now
// performed by a single admin immediately with full audit logging.

// ═══════════════════════════════════════════════════════════
// ─── PROJECTS CRUD ──────────────────────────────────────────
// Preserved from previous version. Projects are also seeded from
// the dashboard but admin can create/edit/delete them here.
// ═══════════════════════════════════════════════════════════

router.get('/projects', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, code, name, phase,
             IFNULL(status,'active') AS status, rag,
             total_pos  AS totalPOs, at_risk AS atRisk, breached,
             client, start_date AS startDate, end_date AS endDate,
             created_at AS createdAt
      FROM projects ORDER BY created_at DESC
    `)
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/projects', async (req, res) => {
  const { code, name, phase, status, rag, client, startDate, endDate } = req.body
  if (!code?.trim() || !name?.trim()) return res.status(400).json({ error: 'Code and name are required' })
  if (rag && !VALID_RAG.has(rag))       return res.status(400).json({ error: 'Invalid RAG value' })
  if (status && !VALID_STATUS.has(status)) return res.status(400).json({ error: 'Status must be active or inactive' })
  try {
    const [r] = await db.query(
      `INSERT INTO projects (code, name, phase, status, rag, client, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [code.trim(), name.trim(), phase || null, status || 'active', rag || 'grey', client || null, startDate || null, endDate || null]
    )
    audit(req, 'project.create', `id=${r.insertId}`)
    const [[row]] = await db.query('SELECT * FROM projects WHERE id = ?', [r.insertId])
    res.status(201).json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Project code already exists' })
    res.status(500).json({ error: err.message })
  }
})

router.put('/projects/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { code, name, phase, status, rag, client, startDate, endDate } = req.body
  if (!code?.trim() || !name?.trim()) return res.status(400).json({ error: 'Code and name are required' })
  if (rag && !VALID_RAG.has(rag))       return res.status(400).json({ error: 'Invalid RAG value' })
  try {
    const [r] = await db.query(
      `UPDATE projects SET code=?,name=?,phase=?,status=?,rag=?,client=?,start_date=?,end_date=? WHERE id=?`,
      [code.trim(), name.trim(), phase||null, status||'active', rag||'grey', client||null, startDate||null, endDate||null, id]
    )
    if (!r.affectedRows) return res.status(404).json({ error: 'Project not found' })
    audit(req, 'project.update', `id=${id}`)
    const [[row]] = await db.query('SELECT * FROM projects WHERE id = ?', [id])
    res.json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Project code already exists' })
    res.status(500).json({ error: err.message })
  }
})

router.delete('/projects/:id', async (req, res) => {
  const id     = parseInt(req.params.id)
  const reason = (req.body?.reason ?? '').toString().trim().slice(0, 255) || 'No reason provided'
  try {
    const [r] = await db.query('DELETE FROM projects WHERE id=?', [id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Project not found' })
    audit(req, 'project.delete', `id=${id} reason="${reason}"`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.patch('/projects/:id/status', async (req, res) => {
  const id     = parseInt(req.params.id)
  const status = req.body?.status
  if (!VALID_STATUS.has(status)) return res.status(400).json({ error: 'Status must be active or inactive' })
  try {
    const [r] = await db.query('UPDATE projects SET status=? WHERE id=?', [status, id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Project not found' })
    audit(req, 'project.status', `id=${id} status=${status}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── SUPPLIERS CRUD ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

// ─── HELPER: upsert supplier addresses ──────────────────────
// Called after creating or updating a supplier. Replaces all
// existing address rows with the submitted array.
async function upsertSupplierAddresses(supplierId, addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) return
  // Remove old rows then insert fresh — simpler than diffing by id
  await db.query('DELETE FROM supplier_addresses WHERE supplier_id = ?', [supplierId])
  for (const a of addresses) {
    await db.query(
      `INSERT INTO supplier_addresses
         (supplier_id, label, address_line1, address_line2, city, state, postcode, country,
          is_primary, is_pickup, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        supplierId,
        (a.label || 'Main').toString().slice(0, 100),
        (a.address_line1 || '').toString().slice(0, 255),
        (a.address_line2 || null),
        (a.city || null), (a.state || null), (a.postcode || null), (a.country || null),
        a.is_primary ? 1 : 0,
        a.is_pickup  ? 1 : 0,
        (a.notes || null),
      ]
    )
  }
}

router.get('/suppliers', async (req, res) => {
  try {
    // ─── INCLUDE ADDRESS COUNT + PRIMARY ADDRESS ─────────────
    // Degrades gracefully if supplier_addresses table doesn't exist yet.
    let rows
    try {
      ;[rows] = await db.query(
        `SELECT s.id, s.name, s.code, s.country, s.contact_name AS contactName,
                s.email, s.phone, s.status,
                COUNT(a.id)                                   AS addressCount,
                MAX(CASE WHEN a.is_primary = 1 THEN
                  CONCAT_WS(', ',
                    NULLIF(a.address_line1,''), NULLIF(a.city,''), NULLIF(a.state,''),
                    NULLIF(a.postcode,''), NULLIF(a.country,''))
                  ELSE NULL END)                              AS primaryAddressText
         FROM suppliers s
         LEFT JOIN supplier_addresses a ON a.supplier_id = s.id
         GROUP BY s.id
         ORDER BY s.name`
      )
    } catch {
      // supplier_addresses table not yet created — fall back
      ;[rows] = await db.query(
        `SELECT id, name, code, country, contact_name AS contactName, email, phone, status,
                0 AS addressCount, NULL AS primaryAddressText
         FROM suppliers ORDER BY name`
      )
    }
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── GET SUPPLIER DETAIL ─────────────────────────────────────
// Full supplier record with all addresses — used by edit modal.
router.get('/suppliers/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const [[row]] = await db.query(
      `SELECT id, name, code, country, contact_name AS contactName, email, phone, status FROM suppliers WHERE id=?`,
      [id]
    )
    if (!row) return res.status(404).json({ error: 'Supplier not found' })
    let addresses = []
    try {
      ;[addresses] = await db.query(
        `SELECT id, label, address_line1, address_line2, city, state, postcode, country,
                is_primary, is_pickup, notes
         FROM supplier_addresses WHERE supplier_id = ? ORDER BY is_primary DESC, id ASC`,
        [id]
      )
    } catch { /* table may not exist */ }
    res.json({ ...row, addresses })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── GET SUPPLIER ADDRESSES ONLY ────────────────────────────
// Used by Expediting SCN module to list pickup locations.
router.get('/suppliers/:id/addresses', async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const [rows] = await db.query(
      `SELECT id, label, address_line1, address_line2, city, state, postcode, country,
              is_primary, is_pickup, notes
       FROM supplier_addresses WHERE supplier_id = ? ORDER BY is_primary DESC, id ASC`,
      [id]
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/suppliers', async (req, res) => {
  const { name, code, country, contactName, email, phone, status, addresses } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  try {
    const [r] = await db.query(
      `INSERT INTO suppliers (name, code, country, contact_name, email, phone, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), code||null, country||null, contactName||null, email||null, phone||null, status||'active']
    )
    if (addresses?.length) await upsertSupplierAddresses(r.insertId, addresses)
    audit(req, 'supplier.create', `id=${r.insertId}`)
    const [[row]] = await db.query(
      `SELECT id, name, code, country, contact_name AS contactName, email, phone, status FROM suppliers WHERE id=?`,
      [r.insertId]
    )
    res.status(201).json(row)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put('/suppliers/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, code, country, contactName, email, phone, status, addresses } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  try {
    const [r] = await db.query(
      `UPDATE suppliers SET name=?,code=?,country=?,contact_name=?,email=?,phone=?,status=? WHERE id=?`,
      [name.trim(), code||null, country||null, contactName||null, email||null, phone||null, status||'active', id]
    )
    if (!r.affectedRows) return res.status(404).json({ error: 'Supplier not found' })
    if (addresses?.length) await upsertSupplierAddresses(id, addresses)
    audit(req, 'supplier.update', `id=${id}`)
    const [[row]] = await db.query(
      `SELECT id, name, code, country, contact_name AS contactName, email, phone, status FROM suppliers WHERE id=?`,
      [id]
    )
    res.json(row)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── TOGGLE SUPPLIER STATUS ──────────────────────────────────
// Used by the Deactivate/Activate button — sets status without
// touching any other fields.
router.patch('/suppliers/:id/status', async (req, res) => {
  const id     = parseInt(req.params.id)
  const { status } = req.body
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
  try {
    const [r] = await db.query('UPDATE suppliers SET status=? WHERE id=?', [status, id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Supplier not found' })
    audit(req, 'supplier.status', `id=${id} status=${status}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/suppliers/:id', async (req, res) => {
  const id     = parseInt(req.params.id)
  const reason = (req.body?.reason ?? '').toString().trim().slice(0, 255) || 'No reason provided'
  try {
    const [r] = await db.query('DELETE FROM suppliers WHERE id=?', [id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Supplier not found' })
    audit(req, 'supplier.delete', `id=${id} reason="${reason}"`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── USERS CRUD ─────────────────────────────────────────────
// Single-admin workflow: any admin can create, edit, deactivate,
// reactivate, delete, or reset passwords for any user immediately.
// Every mutation is logged to the audit trail with actor + reason.
// ═══════════════════════════════════════════════════════════

// ─── CHECK EMAIL UNIQUENESS ──────────────────────────────────
// Called before form submit on the client to give an immediate,
// specific error before attempting the full save.  Must be defined
// before GET /users/:id so Express does not treat "check-email"
// as an id parameter.
router.get('/users/check-email', async (req, res) => {
  const { email, excludeId } = req.query
  if (!email?.trim()) return res.status(400).json({ error: 'email is required' })
  try {
    let sql  = 'SELECT id FROM users WHERE email = ? LIMIT 1'
    const args = [email.trim().toLowerCase()]
    // When editing, exclude the user being edited from the uniqueness check
    if (excludeId) { sql = 'SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1'; args.push(parseInt(excludeId)) }
    const [rows] = await db.query(sql, args)
    res.json({ exists: rows.length > 0 })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── LIST USERS ─────────────────────────────────────────────
// Returns paginated user rows with a project_count subquery so the
// Projects column in the admin table shows how many projects each
// user has been assigned to via user_wbs_access.
router.get('/users', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req.query)
    const { role, status, is_external, search, user_type } = req.query

    let where  = '1=1'
    const args = []

    if (role && VALID_ROLES.has(role))        { where += ' AND u.role = ?';        args.push(role) }
    if (status === 'active')                  { where += ' AND u.is_active = 1'    }
    if (status === 'inactive')                { where += ' AND u.is_active = 0'    }
    if (is_external === 'true')               { where += ' AND u.is_external = 1'  }
    if (is_external === 'false')              { where += ' AND u.is_external = 0'  }
    if (user_type === 'external')             { where += ' AND u.is_external = 1'  }
    if (user_type === 'qco')                  { where += " AND u.is_external = 0 AND u.company = 'QCO Group'" }
    if (user_type === 'project_team')         { where += " AND u.is_external = 0 AND (u.company IS NULL OR u.company != 'QCO Group')" }
    if (search?.trim()) {
      where += ' AND (u.full_name LIKE ? OR u.email LIKE ? OR u.company LIKE ? OR u.staff_id LIKE ?)'
      const s = `%${search.trim()}%`
      args.push(s, s, s, s)
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM users u WHERE ${where}`, args
    )

    const [rows] = await db.query(
      `SELECT u.id, u.full_name AS fullName, u.email, u.role, u.company,
              IFNULL(u.staff_id, '') AS staffId,
              IFNULL(u.phone, '')    AS phone,
              u.is_active                                    AS isActive,
              u.is_external                                  AS isExternal,
              DATE_FORMAT(u.contract_start, '%Y-%m-%d')     AS contractStart,
              DATE_FORMAT(u.contract_end,   '%Y-%m-%d')     AS contractEnd,
              u.last_login                                   AS lastLogin,
              (SELECT COUNT(DISTINCT project_id)
               FROM user_wbs_access
               WHERE user_id = u.id) AS projectCount,
              (SELECT COUNT(*) > 0
               FROM user_permission_overrides
               WHERE user_id = u.id) AS hasCustomPermissions
       FROM users u
       WHERE ${where}
       ORDER BY u.full_name
       LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    )

    res.json({ rows, total, page, limit, pages: Math.ceil(total / limit) })
  } catch (err) {
    // Surface the actual DB error so admins can diagnose missing columns
    res.status(500).json({ error: `Database error: ${err.message}` })
  }
})

// ─── GET USER PROJECTS ──────────────────────────────────────
// Returns distinct projects assigned to a user via user_wbs_access.
router.get('/users/:id/projects', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT p.id, p.code, p.name
       FROM user_wbs_access w
       JOIN projects p ON p.id = w.project_id
       WHERE w.user_id = ?
       ORDER BY p.code`,
      [parseInt(req.params.id)]
    )
    res.json({ projects: rows })
  } catch (err) {
    res.status(500).json({ error: `Database error: ${err.message}` })
  }
})

// ─── GET SINGLE USER ────────────────────────────────────────
router.get('/users/:id', async (req, res) => {
  try {
    const [[user]] = await db.query(
      `SELECT id, full_name AS fullName, email, role, company,
              IFNULL(phone, '') AS phone,
              is_active AS isActive, is_external AS isExternal,
              DATE_FORMAT(contract_start, '%Y-%m-%d') AS contractStart,
              DATE_FORMAT(contract_end,   '%Y-%m-%d') AS contractEnd
       FROM users WHERE id = ?`,
      [parseInt(req.params.id)]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json(user)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── CREATE USER ────────────────────────────────────────────
// Single-admin workflow: any admin can create any user (internal or
// external) immediately. The account is active from the moment of
// creation (unless the admin explicitly unchecks the Active checkbox).
// A temp password is auto-generated, emailed to the user, and must
// be changed on first login. Everything is logged to the audit trail.
router.post('/users', async (req, res) => {
  const { fullName, email, role, company, staffId, phone, isActive, isExternal,
          contractStart, contractEnd } = req.body

  if (!fullName?.trim())      return res.status(400).json({ error: 'Full name is required' })
  if (!email?.trim())         return res.status(400).json({ error: 'Email is required' })
  if (!VALID_ROLES.has(role)) return res.status(400).json({ error: 'Invalid role' })

  // ─── ACTIVE FLAG ──────────────────────────────────────────────
  // External users are treated the same as internal — active unless
  // the admin explicitly marks them inactive in the form. No separate
  // approval step is required.
  const active    = isActive !== false
  // External users get shorter password expiry (30 days) as a
  // security measure for third-party accounts.
  const expiresAt = pwExpiry(Boolean(isExternal))
  const tempPass  = generate()

  try {
    const hash = await bcrypt.hash(tempPass, 12)
    const [r]  = await db.query(
      `INSERT INTO users
         (full_name, email, password_hash, role, company, staff_id, phone,
          is_active, is_external, contract_start, contract_end,
          force_password_change, password_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [fullName.trim(), email.trim().toLowerCase(), hash, role,
       company?.trim() || null, staffId?.trim() || null, phone?.trim() || null,
       active ? 1 : 0, isExternal ? 1 : 0,
       contractStart || null, contractEnd || null, expiresAt]
    )

    // ─── NON-FATAL: record temp password in history ──────────────────
    // Isolated so a missing password_history table does not block user
    // creation.
    try {
      await addToHistory(r.insertId, hash)
    } catch (histErr) {
      console.error('[user.create] password_history insert failed:', histErr.message)
    }

    audit(req, 'user.create',
      `id=${r.insertId} email=${email} external=${isExternal ? 1 : 0} by=${req.user.id}(${req.user.email})`
    )

    // ─── EMAIL CREDENTIALS TO USER ───────────────────────────────────
    await sendEmail(
      email.trim().toLowerCase(),
      'Your QCO Group MMS account has been created',
      html('Welcome to QCO Group MMS',
        `<p>Dear ${fullName},</p>
         <p>An account has been created for you on QCO Group MMS.</p>
         <table style="border-collapse:collapse;margin:12px 0">
           <tr><td style="padding:4px 12px 4px 0"><strong>Email:</strong></td><td>${email.trim().toLowerCase()}</td></tr>
           <tr><td style="padding:4px 12px 4px 0"><strong>Temporary Password:</strong></td><td style="font-family:monospace;font-size:15px">${tempPass}</td></tr>
         </table>
         <p><strong>You must change this password when you first log in.</strong> It expires in ${isExternal ? 30 : 90} days.</p>
         <p>Password requirements: minimum 8 characters, at least one uppercase letter, one lowercase letter, one number, and one special character (!@#$%^&*).</p>`
      )
    )

    const [[newUser]] = await db.query(
      `SELECT id, full_name AS fullName, email, role, company,
              IFNULL(phone, '') AS phone,
              is_active AS isActive, is_external AS isExternal,
              DATE_FORMAT(contract_start, '%Y-%m-%d') AS contractStart,
              DATE_FORMAT(contract_end,   '%Y-%m-%d') AS contractEnd
       FROM users WHERE id = ?`,
      [r.insertId]
    )
    res.status(201).json(newUser)
  } catch (err) {
    // ─── STRUCTURED ERROR RESPONSES ─────────────────────────────────
    console.error('[user.create] ERROR code=%s msg=%s', err.code, err.message)

    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A user with this email already exists' })
    }
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      return res.status(500).json({
        error: `Missing database column — ${err.message}. Run the SQL setup from Admin → System Settings → SQL Setup, then restart the server.`
      })
    }
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({
        error: `Missing database table — ${err.message}. Run the SQL setup from Admin → System Settings → SQL Setup, then restart the server.`
      })
    }
    res.status(500).json({ error: err.message || 'Unexpected database error — check server logs' })
  }
})

// ─── RESET PASSWORD ──────────────────────────────────────────
// Generates a new temp password, emails it to the user, and sets
// force_password_change so they must set a new one on next login.
router.post('/users/:id/reset-password', async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const [[user]] = await db.query(
      `SELECT id, full_name AS fullName, email, is_external AS isExternal
       FROM users WHERE id = ?`,
      [id]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })

    const tempPass  = generate()
    const hash      = await bcrypt.hash(tempPass, 12)
    const expiresAt = pwExpiry(Boolean(user.isExternal))

    await db.query(
      `UPDATE users
       SET password_hash = ?, force_password_change = 1, password_expires_at = ?
       WHERE id = ?`,
      [hash, expiresAt, id]
    )

    // Add to history so it cannot be reused after the forced change
    await addToHistory(id, hash)

    audit(req, 'user.reset_password', `id=${id} by=${req.user.id}`)

    await sendEmail(
      user.email,
      'Your QCO Group MMS password has been reset',
      html('Password Reset',
        `<p>Dear ${user.fullName},</p>
         <p>An administrator has reset your QCO Group MMS password.</p>
         <table style="border-collapse:collapse;margin:12px 0">
           <tr><td style="padding:4px 12px 4px 0"><strong>Email:</strong></td><td>${user.email}</td></tr>
           <tr><td style="padding:4px 12px 4px 0"><strong>Temporary Password:</strong></td><td style="font-family:monospace;font-size:15px">${tempPass}</td></tr>
         </table>
         <p><strong>You must change this password when you next log in.</strong></p>
         <p>If you did not request a password reset, contact your administrator immediately.</p>`
      )
    )

    res.json({ ok: true, message: `Password reset and emailed to ${user.email}` })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── UPDATE USER ────────────────────────────────────────────
// Single-admin: any admin can edit any user immediately. contractEnd
// is optional — omitting/clearing it sets it to NULL (no expiry).
// Audit logs the acting admin name + email for full traceability.
router.put('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { fullName, email, password, role, company, staffId, phone, isActive, isExternal,
          contractStart, contractEnd } = req.body

  if (!fullName?.trim())      return res.status(400).json({ error: 'Full name is required' })
  if (!email?.trim())         return res.status(400).json({ error: 'Email is required' })
  if (!VALID_ROLES.has(role)) return res.status(400).json({ error: 'Invalid role' })

  try {
    const [[current]] = await db.query(
      'SELECT full_name, email, role, is_active, is_external FROM users WHERE id=?', [id]
    )
    if (!current) return res.status(404).json({ error: 'User not found' })

    if (password) {
      const hash = await bcrypt.hash(password, 10)
      await db.query(
        `UPDATE users SET full_name=?,email=?,password_hash=?,role=?,company=?,staff_id=?,phone=?,
                          is_active=?,is_external=?,contract_start=?,contract_end=?
         WHERE id=?`,
        [fullName.trim(), email.trim().toLowerCase(), hash, role,
         company?.trim()||null, staffId?.trim()||null, phone?.trim()||null,
         isActive?1:0, isExternal?1:0, contractStart||null, contractEnd||null, id]
      )
    } else {
      await db.query(
        `UPDATE users SET full_name=?,email=?,role=?,company=?,staff_id=?,phone=?,
                          is_active=?,is_external=?,contract_start=?,contract_end=?
         WHERE id=?`,
        [fullName.trim(), email.trim().toLowerCase(), role,
         company?.trim()||null, staffId?.trim()||null, phone?.trim()||null,
         isActive?1:0, isExternal?1:0, contractStart||null, contractEnd||null, id]
      )
    }

    // ─── AUDIT: log before/after for key fields ───────────────────
    const changes = []
    if (current.full_name !== fullName.trim())         changes.push(`name: "${current.full_name}"→"${fullName.trim()}"`)
    if (current.email !== email.trim().toLowerCase())  changes.push(`email: "${current.email}"→"${email.trim().toLowerCase()}"`)
    if (current.role !== role)                         changes.push(`role: ${current.role}→${role}`)
    if (Number(current.is_active) !== (isActive?1:0)) changes.push(`active: ${current.is_active}→${isActive?1:0}`)
    audit(req, 'user.update',
      `id=${id} by=${req.user.id}(${req.user.email})` + (changes.length ? ` changes=[${changes.join(', ')}]` : '')
    )

    const [[user]] = await db.query(
      `SELECT id, full_name AS fullName, email, role, company,
              IFNULL(phone, '') AS phone,
              is_active AS isActive, is_external AS isExternal,
              DATE_FORMAT(contract_start, '%Y-%m-%d') AS contractStart,
              DATE_FORMAT(contract_end,   '%Y-%m-%d') AS contractEnd
       FROM users WHERE id = ?`,
      [id]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json(user)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already exists' })
    res.status(500).json({ error: err.message })
  }
})

// ─── DELETE USER ────────────────────────────────────────────
// Permanent hard delete. Accepts a `reason` in the request body —
// required by the UI (DeleteConfirmModal) and always logged to audit.
// Self-deletion is blocked to prevent accidental lockout.
router.delete('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' })
  const reason = (req.body?.reason ?? '').toString().trim().slice(0, 255) || 'No reason provided'
  try {
    const [[target]] = await db.query('SELECT full_name, email FROM users WHERE id=?', [id])
    if (!target) return res.status(404).json({ error: 'User not found' })
    const [r] = await db.query('DELETE FROM users WHERE id=?', [id])
    if (!r.affectedRows) return res.status(404).json({ error: 'User not found' })
    audit(req, 'user.delete',
      `id=${id} name="${target.full_name}" email=${target.email} ` +
      `reason="${reason}" by=${req.user.id}(${req.user.email})`
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── (approve endpoint removed) ─────────────────────────────
// The two-admin approval workflow has been removed. External users
// are created active immediately, same as internal users. The
// is_external flag is kept for filtering and contract-expiry logic.

// ─── DEACTIVATE USER ────────────────────────────────────────
// Soft action — disables login while preserving all data and history.
// Accepts a `reason` string for the audit trail. Self-deactivation
// is blocked to prevent accidental admin lockout.
router.post('/users/:id/deactivate', async (req, res) => {
  const id = parseInt(req.params.id)
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate your own account' })
  const reason = (req.body?.reason ?? '').toString().trim().slice(0, 255) || 'No reason provided'
  try {
    const [[target]] = await db.query('SELECT full_name, email FROM users WHERE id=?', [id])
    if (!target) return res.status(404).json({ error: 'User not found' })
    await db.query('UPDATE users SET is_active=0 WHERE id=?', [id])
    audit(req, 'user.deactivate',
      `id=${id} name="${target.full_name}" reason="${reason}" by=${req.user.id}(${req.user.email})`
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── REACTIVATE USER ────────────────────────────────────────
// Re-enables a previously deactivated account. No approval step
// required — any admin can reactivate any user immediately.
router.post('/users/:id/activate', async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const [[target]] = await db.query('SELECT full_name, email FROM users WHERE id=?', [id])
    if (!target) return res.status(404).json({ error: 'User not found' })
    await db.query('UPDATE users SET is_active=1 WHERE id=?', [id])
    audit(req, 'user.reactivate',
      `id=${id} name="${target.full_name}" by=${req.user.id}(${req.user.email})`
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── ROLE PERMISSIONS MATRIX ────────────────────────────────
// ═══════════════════════════════════════════════════════════

// ─── GET ALL PERMISSIONS ────────────────────────────────────
// Returns the full role_permissions table grouped by role then module.
router.get('/permissions', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, role, module, can_view, can_create, can_edit,
              can_approve, can_delete, wbs_scoped, is_default
       FROM role_permissions
       ORDER BY role, module`
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── GET PERMISSIONS FOR A SINGLE ROLE ──────────────────────
// Used by the User Overrides UI to show the base role dots.
// Admin role synthesises full access since it has no DB rows.
router.get('/permissions/role', async (req, res) => {
  const { role } = req.query
  if (!role || !VALID_ROLES.has(role)) return res.status(400).json({ error: 'Invalid role' })
  try {
    if (role === 'admin') {
      const rows = [...VALID_MODULES].map(module => ({
        id: null, role: 'admin', module,
        can_view: 1, can_create: 1, can_edit: 1,
        can_approve: 1, can_delete: 1, wbs_scoped: 0,
      }))
      return res.json(rows)
    }
    const [rows] = await db.query(
      `SELECT id, role, module, can_view, can_create, can_edit,
              can_approve, can_delete, wbs_scoped
       FROM role_permissions WHERE role = ?`,
      [role]
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── UPDATE PERMISSIONS FOR ROLE + MODULE ───────────────────
router.put('/permissions/:role/:module', async (req, res) => {
  const { role, module } = req.params
  if (!VALID_ROLES.has(role))    return res.status(400).json({ error: 'Invalid role' })
  if (!VALID_MODULES.has(module)) return res.status(400).json({ error: 'Invalid module' })
  if (role === 'admin') return res.status(400).json({ error: 'Admin role permissions cannot be modified' })

  const { can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped } = req.body

  try {
    await db.query(
      `INSERT INTO role_permissions
         (role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         can_view=VALUES(can_view), can_create=VALUES(can_create),
         can_edit=VALUES(can_edit), can_approve=VALUES(can_approve),
         can_delete=VALUES(can_delete), wbs_scoped=VALUES(wbs_scoped),
         is_default=0`,
      [role, module, can_view?1:0, can_create?1:0, can_edit?1:0,
       can_approve?1:0, can_delete?1:0, wbs_scoped?1:0]
    )
    audit(req, 'permissions.update', `role=${role} module=${module}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── USER PERMISSION OVERRIDES ──────────────────────────────
// Per-user overrides that take precedence over role defaults.
// ═══════════════════════════════════════════════════════════

router.get('/permissions/overrides/:userId', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT o.id, o.module, o.can_view, o.can_create, o.can_edit,
              o.can_approve, o.can_delete, o.overridden_at,
              u.full_name AS overriddenByName
       FROM user_permission_overrides o
       JOIN users u ON u.id = o.overridden_by
       WHERE o.user_id = ?`,
      [parseInt(req.params.userId)]
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/permissions/overrides', async (req, res) => {
  const { userId, module, can_view, can_create, can_edit, can_approve, can_delete } = req.body
  if (!userId || !module)          return res.status(400).json({ error: 'userId and module are required' })
  if (!VALID_MODULES.has(module))  return res.status(400).json({ error: 'Invalid module' })
  try {
    await db.query(
      `INSERT INTO user_permission_overrides
         (user_id, module, can_view, can_create, can_edit, can_approve, can_delete, overridden_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         can_view=VALUES(can_view), can_create=VALUES(can_create),
         can_edit=VALUES(can_edit), can_approve=VALUES(can_approve),
         can_delete=VALUES(can_delete), overridden_by=VALUES(overridden_by),
         overridden_at=NOW()`,
      [userId, module, can_view?1:0, can_create?1:0, can_edit?1:0,
       can_approve?1:0, can_delete?1:0, req.user.id]
    )
    audit(req, 'override.set', `user=${userId} module=${module}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/permissions/overrides/:id', async (req, res) => {
  try {
    const [r] = await db.query(
      'DELETE FROM user_permission_overrides WHERE id=?',
      [parseInt(req.params.id)]
    )
    if (!r.affectedRows) return res.status(404).json({ error: 'Override not found' })
    audit(req, 'override.delete', `id=${req.params.id}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── GET USER PERMISSION OVERRIDES (by userId in URL) ───────
// Convenience alias: GET /permissions/user/:userId
// Returns overrides + the user's current role for the UI.
router.get('/permissions/user/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId)
  try {
    const [[user]] = await db.query(
      'SELECT id, full_name AS fullName, email, role FROM users WHERE id=?', [userId]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })
    let overrides = []
    try {
      ;[overrides] = await db.query(
        `SELECT o.id, o.module, o.can_view, o.can_create, o.can_edit,
                o.can_approve, o.can_delete, o.overridden_at
         FROM user_permission_overrides o
         WHERE o.user_id = ?`,
        [userId]
      )
    } catch { /* table may not exist */ }
    res.json({ user, overrides })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── SAVE USER PERMISSION OVERRIDES (batch) ─────────────────
// POST /permissions/user/:userId — saves all override changes in one call.
// Body: { overrides: [{ module, can_view, can_create, can_edit, can_approve, can_delete }] }
// To remove an override for a module, omit it from the array or set all values null.
router.post('/permissions/user/:userId', async (req, res) => {
  const userId   = parseInt(req.params.userId)
  const { overrides } = req.body  // array of module override objects
  if (!Array.isArray(overrides))  return res.status(400).json({ error: 'overrides array required' })
  try {
    for (const o of overrides) {
      if (!o.module || !VALID_MODULES.has(o.module)) continue
      if (o.remove) {
        await db.query(
          'DELETE FROM user_permission_overrides WHERE user_id=? AND module=?', [userId, o.module]
        )
      } else {
        await db.query(
          `INSERT INTO user_permission_overrides
             (user_id, module, can_view, can_create, can_edit, can_approve, can_delete, overridden_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             can_view=VALUES(can_view), can_create=VALUES(can_create),
             can_edit=VALUES(can_edit), can_approve=VALUES(can_approve),
             can_delete=VALUES(can_delete), overridden_by=VALUES(overridden_by),
             overridden_at=NOW()`,
          [userId, o.module, o.can_view ?? 0, o.can_create ?? 0, o.can_edit ?? 0,
           o.can_approve ?? 0, o.can_delete ?? 0, req.user.id]
        )
      }
    }
    audit(req, 'override.batch', `user=${userId} count=${overrides.length}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── DELETE ALL USER PERMISSION OVERRIDES ───────────────────
// DELETE /permissions/user/:userId — resets user to role defaults.
router.delete('/permissions/user/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId)
  try {
    await db.query('DELETE FROM user_permission_overrides WHERE user_id=?', [userId])
    audit(req, 'override.reset', `user=${userId}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── WBS ACCESS ─────────────────────────────────────────────
// Scoped project access for roles where wbs_scoped = true.
// ═══════════════════════════════════════════════════════════

router.get('/wbs-access/:userId', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT w.id, w.wbs_code, w.project_id, p.name AS projectName,
              p.code AS projectCode, w.created_at AS grantedAt,
              u.full_name AS grantedByName
       FROM user_wbs_access w
       JOIN projects p ON p.id = w.project_id
       JOIN users u ON u.id = w.created_by
       WHERE w.user_id = ?`,
      [parseInt(req.params.userId)]
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/wbs-access', async (req, res) => {
  const { userId, projectId, wbsCode } = req.body
  if (!userId || !projectId || !wbsCode?.trim()) {
    return res.status(400).json({ error: 'userId, projectId and wbsCode are required' })
  }
  try {
    const [r] = await db.query(
      `INSERT INTO user_wbs_access (user_id, project_id, wbs_code, created_by)
       VALUES (?, ?, ?, ?)`,
      [userId, projectId, wbsCode.trim(), req.user.id]
    )
    audit(req, 'wbs.grant', `user=${userId} project=${projectId} wbs=${wbsCode}`)
    const [[row]] = await db.query('SELECT * FROM user_wbs_access WHERE id=?', [r.insertId])
    res.status(201).json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'WBS access already exists for this user/project' })
    res.status(500).json({ error: err.message })
  }
})

router.delete('/wbs-access/:id', async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM user_wbs_access WHERE id=?', [parseInt(req.params.id)])
    if (!r.affectedRows) return res.status(404).json({ error: 'WBS access not found' })
    audit(req, 'wbs.revoke', `id=${req.params.id}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── DELEGATED PERMISSIONS ──────────────────────────────────
// Time-limited delegation of a named permission from one user to another.
// ═══════════════════════════════════════════════════════════

router.get('/delegated', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.id, d.permission, d.granted_at, d.expires_at,
              gt.full_name AS grantedToName, gt.email AS grantedToEmail,
              gb.full_name AS grantedByName
       FROM delegated_permissions d
       JOIN users gt ON gt.id = d.granted_to
       JOIN users gb ON gb.id = d.granted_by
       ORDER BY d.granted_at DESC`
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/delegated', async (req, res) => {
  const { grantedTo, permission, expiresAt } = req.body
  if (!grantedTo || !permission?.trim()) {
    return res.status(400).json({ error: 'grantedTo and permission are required' })
  }
  try {
    const [r] = await db.query(
      `INSERT INTO delegated_permissions (granted_to, granted_by, permission, expires_at)
       VALUES (?, ?, ?, ?)`,
      [grantedTo, req.user.id, permission.trim(), expiresAt || null]
    )
    audit(req, 'delegation.grant', `to=${grantedTo} permission=${permission}`)
    const [[row]] = await db.query('SELECT * FROM delegated_permissions WHERE id=?', [r.insertId])
    res.status(201).json(row)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/delegated/:id', async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM delegated_permissions WHERE id=?', [parseInt(req.params.id)])
    if (!r.affectedRows) return res.status(404).json({ error: 'Delegation not found' })
    audit(req, 'delegation.revoke', `id=${req.params.id}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── NOTIFICATIONS ──────────────────────────────────────────
// In-app notification centre. Notifications are created by the
// system (expiry-checker, approval workflow) and read here.
// ═══════════════════════════════════════════════════════════

router.get('/notifications', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req.query)
    const { user_id, type, is_read } = req.query

    let where  = '1=1'
    const args = []
    if (user_id)             { where += ' AND n.user_id = ?';  args.push(parseInt(user_id)) }
    if (type)                { where += ' AND n.type = ?';     args.push(type) }
    if (is_read === 'true')  { where += ' AND n.is_read = 1';  }
    if (is_read === 'false') { where += ' AND n.is_read = 0';  }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM notifications n WHERE ${where}`, args
    )

    const [rows] = await db.query(
      `SELECT n.id, n.type, n.message, n.is_read AS isRead, n.created_at AS createdAt,
              u.full_name AS userName, u.email AS userEmail
       FROM notifications n
       JOIN users u ON u.id = n.user_id
       WHERE ${where}
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    )

    res.json({ rows, total, page, limit, pages: Math.ceil(total / limit) })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put('/notifications/:id/read', async (req, res) => {
  try {
    await db.query('UPDATE notifications SET is_read=1 WHERE id=?', [parseInt(req.params.id)])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put('/notifications/read-all', async (req, res) => {
  try {
    await db.query('UPDATE notifications SET is_read=1')
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/notifications/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM notifications WHERE id=?', [parseInt(req.params.id)])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── SYSTEM SETTINGS ────────────────────────────────────────
// Persistent key-value store for admin-configurable settings.
// The table is created via the SQL block in the System Settings tab.
// Only keys in EDITABLE_SETTING_KEYS can be written via the API to
// prevent arbitrary injection.
// ═══════════════════════════════════════════════════════════
// All keys that can be written via the API. Whitelist prevents arbitrary
// key injection. The table uses `key`/`value` columns (not setting_key/value).
const EDITABLE_SETTING_KEYS = new Set([
  'escalation_email',
  'password_expiry_days_internal',
  'password_expiry_days_external',
  'access_expiry_warning_days',
  'system_name',
])

router.get('/system-settings', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT `key` AS k, `value` AS v FROM system_settings')
    const settings = {}
    rows.forEach(r => { settings[r.k] = r.v ?? '' })
    res.json(settings)
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return res.json({})
    res.status(500).json({ error: err.message })
  }
})

router.put('/system-settings', async (req, res) => {
  const updates = req.body
  const keys = Object.keys(updates).filter(k => EDITABLE_SETTING_KEYS.has(k))
  if (keys.length === 0) return res.status(400).json({ error: 'No valid settings provided' })
  try {
    for (const key of keys) {
      await db.query(
        'INSERT INTO system_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)',
        [key, updates[key] ?? '']
      )
    }
    audit(req, 'system_settings.update', `keys=${keys.join(',')}`)
    res.json({ ok: true })
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ error: 'System settings table missing — run the migration script.' })
    }
    res.status(500).json({ error: err.message })
  }
})

// ─── SEND TEST EMAIL ────────────────────────────────────────
// Sends a test email to the requesting admin to confirm SMTP works.
router.post('/test-email', async (req, res) => {
  try {
    await sendEmail(
      req.user.email,
      'Test email — QCO Group MMS',
      html('SMTP Test', `<p>SMTP is configured correctly. This email was sent at ${new Date().toISOString()}.</p>`)
    )
    res.json({ ok: true, sentTo: req.user.email })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── WAREHOUSES CRUD ────────────────────────────────────────
// Master list of physical storage locations used across modules.
// ═══════════════════════════════════════════════════════════

router.get('/warehouses', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req.query)
    const { search, status } = req.query
    let where = '1=1'; const args = []
    if (search?.trim()) {
      where += ' AND (name LIKE ? OR code LIKE ? OR state LIKE ?)'
      const s = `%${search.trim()}%`; args.push(s, s, s)
    }
    if (status === 'active')   where += ' AND status = "active"'
    if (status === 'inactive') where += ' AND status = "inactive"'
    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM warehouses WHERE ${where}`, args)
    const [rows] = await db.query(
      `SELECT id, name, code, address, state,
              IFNULL(contact_name,'') AS contactName,
              IFNULL(phone,'') AS phone, status
       FROM warehouses WHERE ${where} ORDER BY name LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    )
    res.json({ rows, total, page, limit, pages: Math.ceil(total / limit) })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/warehouses', async (req, res) => {
  const { name, code, address, state, contactName, phone, status } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  if (!code?.trim()) return res.status(400).json({ error: 'Code is required' })
  try {
    const [r] = await db.query(
      `INSERT INTO warehouses (name, code, address, state, contact_name, phone, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), code.trim().toUpperCase(), address||null, state||null,
       contactName||null, phone||null, status||'active', req.user.id]
    )
    audit(req, 'warehouse.create', `id=${r.insertId}`)
    const [[row]] = await db.query(
      `SELECT id, name, code, address, state, IFNULL(contact_name,'') AS contactName,
              IFNULL(phone,'') AS phone, status FROM warehouses WHERE id=?`, [r.insertId]
    )
    res.status(201).json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Warehouse code already exists' })
    res.status(500).json({ error: err.message })
  }
})

router.put('/warehouses/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, code, address, state, contactName, phone, status } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  if (!code?.trim()) return res.status(400).json({ error: 'Code is required' })
  try {
    const [r] = await db.query(
      `UPDATE warehouses SET name=?,code=?,address=?,state=?,contact_name=?,phone=?,status=? WHERE id=?`,
      [name.trim(), code.trim().toUpperCase(), address||null, state||null,
       contactName||null, phone||null, status||'active', id]
    )
    if (!r.affectedRows) return res.status(404).json({ error: 'Warehouse not found' })
    audit(req, 'warehouse.update', `id=${id}`)
    const [[row]] = await db.query(
      `SELECT id, name, code, address, state, IFNULL(contact_name,'') AS contactName,
              IFNULL(phone,'') AS phone, status FROM warehouses WHERE id=?`, [id]
    )
    res.json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Warehouse code already exists' })
    res.status(500).json({ error: err.message })
  }
})

// ─── TOGGLE WAREHOUSE STATUS ─────────────────────────────────
router.patch('/warehouses/:id/status', async (req, res) => {
  const id     = parseInt(req.params.id)
  const { status } = req.body
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
  try {
    const [r] = await db.query('UPDATE warehouses SET status=? WHERE id=?', [status, id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Warehouse not found' })
    audit(req, 'warehouse.status', `id=${id} status=${status}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/warehouses/:id', async (req, res) => {
  const id     = parseInt(req.params.id)
  const reason = (req.body?.reason ?? '').toString().trim().slice(0, 255) || 'No reason provided'
  try {
    const [r] = await db.query('DELETE FROM warehouses WHERE id=?', [id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Warehouse not found' })
    audit(req, 'warehouse.delete', `id=${id} reason="${reason}"`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── UNITS OF MEASURE CRUD ──────────────────────────────────
// Reference list of UoM codes used on POs, MRs, and MTO lines.
// ═══════════════════════════════════════════════════════════

router.get('/uom', async (req, res) => {
  try {
    const { search, status } = req.query
    let where = '1=1'; const args = []
    if (search?.trim()) {
      where += ' AND (code LIKE ? OR description LIKE ?)'
      const s = `%${search.trim()}%`; args.push(s, s)
    }
    if (status === 'active')   where += ' AND status = "active"'
    if (status === 'inactive') where += ' AND status = "inactive"'
    const [rows] = await db.query(
      `SELECT id, code, description, status FROM units_of_measure WHERE ${where} ORDER BY code`,
      args
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/uom', async (req, res) => {
  const { code, description, status } = req.body
  if (!code?.trim())        return res.status(400).json({ error: 'Code is required' })
  if (!description?.trim()) return res.status(400).json({ error: 'Description is required' })
  try {
    const [r] = await db.query(
      `INSERT INTO units_of_measure (code, description, status) VALUES (?, ?, ?)`,
      [code.trim().toUpperCase(), description.trim(), status||'active']
    )
    audit(req, 'uom.create', `id=${r.insertId}`)
    const [[row]] = await db.query('SELECT id, code, description, status FROM units_of_measure WHERE id=?', [r.insertId])
    res.status(201).json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'UoM code already exists' })
    res.status(500).json({ error: err.message })
  }
})

router.put('/uom/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { code, description, status } = req.body
  if (!code?.trim())        return res.status(400).json({ error: 'Code is required' })
  if (!description?.trim()) return res.status(400).json({ error: 'Description is required' })
  try {
    const [r] = await db.query(
      `UPDATE units_of_measure SET code=?,description=?,status=? WHERE id=?`,
      [code.trim().toUpperCase(), description.trim(), status||'active', id]
    )
    if (!r.affectedRows) return res.status(404).json({ error: 'UoM not found' })
    audit(req, 'uom.update', `id=${id}`)
    const [[row]] = await db.query('SELECT id, code, description, status FROM units_of_measure WHERE id=?', [id])
    res.json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'UoM code already exists' })
    res.status(500).json({ error: err.message })
  }
})

// ─── TOGGLE UOM STATUS ───────────────────────────────────────
router.patch('/uom/:id/status', async (req, res) => {
  const id     = parseInt(req.params.id)
  const { status } = req.body
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
  try {
    const [r] = await db.query('UPDATE units_of_measure SET status=? WHERE id=?', [status, id])
    if (!r.affectedRows) return res.status(404).json({ error: 'UoM not found' })
    audit(req, 'uom.status', `id=${id} status=${status}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/uom/:id', async (req, res) => {
  const id     = parseInt(req.params.id)
  const reason = (req.body?.reason ?? '').toString().trim().slice(0, 255) || 'No reason provided'
  try {
    const [r] = await db.query('DELETE FROM units_of_measure WHERE id=?', [id])
    if (!r.affectedRows) return res.status(404).json({ error: 'UoM not found' })
    audit(req, 'uom.delete', `id=${id} reason="${reason}"`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── ACRONYMS CRUD ──────────────────────────────────────────
// Glossary of acronyms used across all MMS modules.
// ═══════════════════════════════════════════════════════════

router.get('/acronyms', async (req, res) => {
  try {
    const { search, module: mod } = req.query
    let where = '1=1'; const args = []
    if (search?.trim()) {
      where += ' AND (acronym LIKE ? OR definition LIKE ?)'
      const s = `%${search.trim()}%`; args.push(s, s)
    }
    if (mod?.trim()) { where += ' AND module = ?'; args.push(mod.trim()) }
    const [rows] = await db.query(
      `SELECT id, acronym, definition, IFNULL(module,'') AS module, IFNULL(notes,'') AS notes
       FROM acronyms WHERE ${where} ORDER BY acronym`,
      args
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/acronyms', async (req, res) => {
  const { acronym, definition, module: mod, notes } = req.body
  if (!acronym?.trim())    return res.status(400).json({ error: 'Acronym is required' })
  if (!definition?.trim()) return res.status(400).json({ error: 'Definition is required' })
  try {
    const [r] = await db.query(
      `INSERT INTO acronyms (acronym, definition, module, notes) VALUES (?, ?, ?, ?)`,
      [acronym.trim().toUpperCase(), definition.trim(), mod||null, notes||null]
    )
    audit(req, 'acronym.create', `id=${r.insertId}`)
    const [[row]] = await db.query(
      `SELECT id, acronym, definition, IFNULL(module,'') AS module, IFNULL(notes,'') AS notes
       FROM acronyms WHERE id=?`, [r.insertId]
    )
    res.status(201).json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Acronym already exists' })
    res.status(500).json({ error: err.message })
  }
})

router.put('/acronyms/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { acronym, definition, module: mod, notes } = req.body
  if (!acronym?.trim())    return res.status(400).json({ error: 'Acronym is required' })
  if (!definition?.trim()) return res.status(400).json({ error: 'Definition is required' })
  try {
    const [r] = await db.query(
      `UPDATE acronyms SET acronym=?,definition=?,module=?,notes=? WHERE id=?`,
      [acronym.trim().toUpperCase(), definition.trim(), mod||null, notes||null, id]
    )
    if (!r.affectedRows) return res.status(404).json({ error: 'Acronym not found' })
    audit(req, 'acronym.update', `id=${id}`)
    const [[row]] = await db.query(
      `SELECT id, acronym, definition, IFNULL(module,'') AS module, IFNULL(notes,'') AS notes
       FROM acronyms WHERE id=?`, [id]
    )
    res.json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Acronym already exists' })
    res.status(500).json({ error: err.message })
  }
})

router.delete('/acronyms/:id', async (req, res) => {
  const id     = parseInt(req.params.id)
  const reason = (req.body?.reason ?? '').toString().trim().slice(0, 255) || 'No reason provided'
  try {
    const [r] = await db.query('DELETE FROM acronyms WHERE id=?', [id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Acronym not found' })
    audit(req, 'acronym.delete', `id=${id} reason="${reason}"`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── INCO TERMS CRUD ────────────────────────────────────────
// International commercial terms used on Purchase Orders to
// define risk transfer point and transport cost responsibility.
// ═══════════════════════════════════════════════════════════

router.get('/inco-terms', async (req, res) => {
  try {
    const { search, status } = req.query
    let where = '1=1'; const args = []
    if (search?.trim()) {
      where += ' AND (code LIKE ? OR full_name LIKE ? OR transport_mode LIKE ?)'
      const s = `%${search.trim()}%`; args.push(s, s, s)
    }
    if (status === 'active')   where += ' AND status = "active"'
    if (status === 'inactive') where += ' AND status = "inactive"'
    const [rows] = await db.query(
      `SELECT id, code, full_name AS fullName,
              IFNULL(description,'') AS description,
              IFNULL(risk_transfer_point,'') AS riskTransferPoint,
              IFNULL(transport_mode,'') AS transportMode, status
       FROM inco_terms WHERE ${where} ORDER BY code`,
      args
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/inco-terms', async (req, res) => {
  const { code, fullName, description, riskTransferPoint, transportMode, status } = req.body
  if (!code?.trim())     return res.status(400).json({ error: 'Code is required' })
  if (!fullName?.trim()) return res.status(400).json({ error: 'Full name is required' })
  try {
    const [r] = await db.query(
      `INSERT INTO inco_terms (code, full_name, description, risk_transfer_point, transport_mode, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code.trim().toUpperCase(), fullName.trim(), description||null,
       riskTransferPoint||null, transportMode||null, status||'active']
    )
    audit(req, 'incoterm.create', `id=${r.insertId}`)
    const [[row]] = await db.query(
      `SELECT id, code, full_name AS fullName, IFNULL(description,'') AS description,
              IFNULL(risk_transfer_point,'') AS riskTransferPoint,
              IFNULL(transport_mode,'') AS transportMode, status
       FROM inco_terms WHERE id=?`, [r.insertId]
    )
    res.status(201).json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'INCO term code already exists' })
    res.status(500).json({ error: err.message })
  }
})

router.put('/inco-terms/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { code, fullName, description, riskTransferPoint, transportMode, status } = req.body
  if (!code?.trim())     return res.status(400).json({ error: 'Code is required' })
  if (!fullName?.trim()) return res.status(400).json({ error: 'Full name is required' })
  try {
    const [r] = await db.query(
      `UPDATE inco_terms SET code=?,full_name=?,description=?,risk_transfer_point=?,transport_mode=?,status=? WHERE id=?`,
      [code.trim().toUpperCase(), fullName.trim(), description||null,
       riskTransferPoint||null, transportMode||null, status||'active', id]
    )
    if (!r.affectedRows) return res.status(404).json({ error: 'INCO term not found' })
    audit(req, 'incoterm.update', `id=${id}`)
    const [[row]] = await db.query(
      `SELECT id, code, full_name AS fullName, IFNULL(description,'') AS description,
              IFNULL(risk_transfer_point,'') AS riskTransferPoint,
              IFNULL(transport_mode,'') AS transportMode, status
       FROM inco_terms WHERE id=?`, [id]
    )
    res.json(row)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'INCO term code already exists' })
    res.status(500).json({ error: err.message })
  }
})

// ─── TOGGLE INCO TERM STATUS ─────────────────────────────────
router.patch('/inco-terms/:id/status', async (req, res) => {
  const id     = parseInt(req.params.id)
  const { status } = req.body
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
  try {
    const [r] = await db.query('UPDATE inco_terms SET status=? WHERE id=?', [status, id])
    if (!r.affectedRows) return res.status(404).json({ error: 'INCO term not found' })
    audit(req, 'incoterm.status', `id=${id} status=${status}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/inco-terms/:id', async (req, res) => {
  const id     = parseInt(req.params.id)
  const reason = (req.body?.reason ?? '').toString().trim().slice(0, 255) || 'No reason provided'
  try {
    const [r] = await db.query('DELETE FROM inco_terms WHERE id=?', [id])
    if (!r.affectedRows) return res.status(404).json({ error: 'INCO term not found' })
    audit(req, 'incoterm.delete', `id=${id} reason="${reason}"`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
