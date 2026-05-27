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
  'warehouse', 'vendor', 'freight_forwarder', 'site_contractor', 'viewer',
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
// Logs every admin action with the acting user's ID, action type,
// target resource, and a timestamp.  Written to console in dev;
// can be wired to an audit_log table if needed.
function audit(req, action, resource) {
  console.log(`[audit] user=${req.user.id} action=${action} resource=${resource} ip=${req.ip}`)
}

// ─── PAGINATION HELPER ──────────────────────────────────────
// Parses and clamps page/limit query params. Returns { page, limit, offset }.
function paginate(query) {
  const page   = Math.max(1, parseInt(query.page  || '1'))
  const limit  = Math.min(200, Math.max(1, parseInt(query.limit || '50')))
  return { page, limit, offset: (page - 1) * limit }
}

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
  const id = parseInt(req.params.id)
  try {
    const [r] = await db.query('DELETE FROM projects WHERE id=?', [id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Project not found' })
    audit(req, 'project.delete', `id=${id}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── SUPPLIERS CRUD ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

router.get('/suppliers', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, code, country, contact_name AS contactName, email, phone, status
       FROM suppliers ORDER BY name`
    )
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/suppliers', async (req, res) => {
  const { name, code, country, contactName, email, phone, status } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  try {
    const [r] = await db.query(
      `INSERT INTO suppliers (name, code, country, contact_name, email, phone, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), code||null, country||null, contactName||null, email||null, phone||null, status||'active']
    )
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
  const { name, code, country, contactName, email, phone, status } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  try {
    const [r] = await db.query(
      `UPDATE suppliers SET name=?,code=?,country=?,contact_name=?,email=?,phone=?,status=? WHERE id=?`,
      [name.trim(), code||null, country||null, contactName||null, email||null, phone||null, status||'active', id]
    )
    if (!r.affectedRows) return res.status(404).json({ error: 'Supplier not found' })
    audit(req, 'supplier.update', `id=${id}`)
    const [[row]] = await db.query(
      `SELECT id, name, code, country, contact_name AS contactName, email, phone, status FROM suppliers WHERE id=?`,
      [id]
    )
    res.json(row)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/suppliers/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const [r] = await db.query('DELETE FROM suppliers WHERE id=?', [id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Supplier not found' })
    audit(req, 'supplier.delete', `id=${id}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══════════════════════════════════════════════════════════
// ─── USERS CRUD + APPROVAL WORKFLOW ─────────────────────────
// External users (is_external=true) require two distinct admins to
// approve before is_active is set to true.  Internal users are
// activated immediately on creation.
// ═══════════════════════════════════════════════════════════

// ─── LIST USERS ─────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req.query)
    const { role, status, is_external, search } = req.query

    let where  = '1=1'
    const args = []

    if (role && VALID_ROLES.has(role))        { where += ' AND u.role = ?';                    args.push(role) }
    if (status === 'active')                  { where += ' AND u.is_active = 1';               }
    if (status === 'inactive')                { where += ' AND u.is_active = 0';               }
    if (is_external === 'true')               { where += ' AND u.is_external = 1';             }
    if (is_external === 'false')              { where += ' AND u.is_external = 0';             }
    if (search?.trim()) {
      where += ' AND (u.full_name LIKE ? OR u.email LIKE ? OR u.company LIKE ?)'
      const s = `%${search.trim()}%`
      args.push(s, s, s)
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM users u WHERE ${where}`, args
    )

    const [rows] = await db.query(
      `SELECT u.id, u.full_name AS fullName, u.email, u.role, u.company,
              u.is_active AS isActive, u.is_external AS isExternal,
              u.contract_start AS contractStart, u.contract_end AS contractEnd,
              u.approved_by AS approvedBy, u.approved_at AS approvedAt,
              u.second_approved_by AS secondApprovedBy, u.second_approved_at AS secondApprovedAt,
              u.last_login AS lastLogin,
              a1.full_name AS approvedByName, a2.full_name AS secondApprovedByName
       FROM users u
       LEFT JOIN users a1 ON a1.id = u.approved_by
       LEFT JOIN users a2 ON a2.id = u.second_approved_by
       WHERE ${where}
       ORDER BY u.full_name
       LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    )

    res.json({ rows, total, page, limit, pages: Math.ceil(total / limit) })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── GET SINGLE USER ────────────────────────────────────────
router.get('/users/:id', async (req, res) => {
  try {
    const [[user]] = await db.query(
      `SELECT id, full_name AS fullName, email, role, company,
              is_active AS isActive, is_external AS isExternal,
              contract_start AS contractStart, contract_end AS contractEnd,
              approved_by AS approvedBy, second_approved_by AS secondApprovedBy
       FROM users WHERE id = ?`,
      [parseInt(req.params.id)]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json(user)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── CREATE USER ────────────────────────────────────────────
// Admin creates the account with a randomly generated temp password.
// force_password_change is set so the user must set their own
// password on first login.  Credentials are emailed to the user.
router.post('/users', async (req, res) => {
  const { fullName, email, role, company, isActive, isExternal,
          contractStart, contractEnd } = req.body

  if (!fullName?.trim())      return res.status(400).json({ error: 'Full name is required' })
  if (!email?.trim())         return res.status(400).json({ error: 'Email is required' })
  if (!VALID_ROLES.has(role)) return res.status(400).json({ error: 'Invalid role' })

  // External users are created inactive; they need two-admin approval.
  const active    = isExternal ? false : (isActive !== false)
  const tempPass  = generate()
  const expiresAt = pwExpiry(Boolean(isExternal))

  try {
    const hash = await bcrypt.hash(tempPass, 12)
    const [r]  = await db.query(
      `INSERT INTO users
         (full_name, email, password_hash, role, company,
          is_active, is_external, contract_start, contract_end,
          force_password_change, password_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [fullName.trim(), email.trim().toLowerCase(), hash, role,
       company?.trim() || null, active ? 1 : 0,
       isExternal ? 1 : 0,
       contractStart || null, contractEnd || null, expiresAt]
    )

    // Record initial password in history so it cannot be reused
    await addToHistory(r.insertId, hash)

    audit(req, 'user.create', `id=${r.insertId} email=${email}`)

    // Email credentials to the new user
    await sendEmail(
      email.trim().toLowerCase(),
      'Your QCO MMS account has been created',
      html('Welcome to QCO MMS',
        `<p>Dear ${fullName},</p>
         <p>An account has been created for you on QCO MMS.</p>
         <table style="border-collapse:collapse;margin:12px 0">
           <tr><td style="padding:4px 12px 4px 0"><strong>Email:</strong></td><td>${email.trim().toLowerCase()}</td></tr>
           <tr><td style="padding:4px 12px 4px 0"><strong>Temporary Password:</strong></td><td style="font-family:monospace;font-size:15px">${tempPass}</td></tr>
         </table>
         <p><strong>You must change this password when you first log in.</strong> It expires in ${isExternal ? 30 : 90} days.</p>
         <p>Password requirements: minimum 8 characters, at least one uppercase letter, one lowercase letter, one number, and one special character (!@#$%^&*).</p>`
      )
    )

    // Alert admins if external user needs approval
    if (isExternal) {
      await sendAlert(
        `New external user requires approval: ${fullName}`,
        html('External User Approval Required',
          `<p>A new external user has been created and requires two-admin approval before activation.</p>
           <ul>
             <li><strong>Name:</strong> ${fullName}</li>
             <li><strong>Email:</strong> ${email}</li>
             <li><strong>Role:</strong> ${role}</li>
             <li><strong>Company:</strong> ${company || 'N/A'}</li>
           </ul>
           <p>Log in to QCO MMS Admin → External Users to approve.</p>`
        )
      )
    }

    const [[newUser]] = await db.query(
      `SELECT id, full_name AS fullName, email, role, company,
              is_active AS isActive, is_external AS isExternal,
              contract_start AS contractStart, contract_end AS contractEnd
       FROM users WHERE id = ?`,
      [r.insertId]
    )
    res.status(201).json(newUser)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already exists' })
    res.status(500).json({ error: err.message })
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
      'Your QCO MMS password has been reset',
      html('Password Reset',
        `<p>Dear ${user.fullName},</p>
         <p>An administrator has reset your QCO MMS password.</p>
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
router.put('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { fullName, email, password, role, company, isActive, isExternal,
          contractStart, contractEnd } = req.body

  if (!fullName?.trim())    return res.status(400).json({ error: 'Full name is required' })
  if (!email?.trim())       return res.status(400).json({ error: 'Email is required' })
  if (!VALID_ROLES.has(role)) return res.status(400).json({ error: 'Invalid role' })

  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10)
      await db.query(
        `UPDATE users SET full_name=?,email=?,password_hash=?,role=?,company=?,
                          is_active=?,is_external=?,contract_start=?,contract_end=?
         WHERE id=?`,
        [fullName.trim(), email.trim().toLowerCase(), hash, role,
         company?.trim()||null, isActive?1:0, isExternal?1:0,
         contractStart||null, contractEnd||null, id]
      )
    } else {
      await db.query(
        `UPDATE users SET full_name=?,email=?,role=?,company=?,
                          is_active=?,is_external=?,contract_start=?,contract_end=?
         WHERE id=?`,
        [fullName.trim(), email.trim().toLowerCase(), role,
         company?.trim()||null, isActive?1:0, isExternal?1:0,
         contractStart||null, contractEnd||null, id]
      )
    }

    audit(req, 'user.update', `id=${id}`)
    const [[user]] = await db.query(
      `SELECT id, full_name AS fullName, email, role, company,
              is_active AS isActive, is_external AS isExternal,
              contract_start AS contractStart, contract_end AS contractEnd,
              approved_by AS approvedBy, second_approved_by AS secondApprovedBy
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
router.delete('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' })
  try {
    const [r] = await db.query('DELETE FROM users WHERE id=?', [id])
    if (!r.affectedRows) return res.status(404).json({ error: 'User not found' })
    audit(req, 'user.delete', `id=${id}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── APPROVE EXTERNAL USER ──────────────────────────────────
// Two distinct admins must call this endpoint before the external
// user is activated.  The first call sets approved_by; the second
// call (by a different admin) sets second_approved_by and activates
// the account.  Calling it a third time is a no-op.
router.post('/users/:id/approve', async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const [[user]] = await db.query(
      `SELECT id, full_name AS fullName, email, is_external AS isExternal,
              is_active AS isActive, approved_by AS approvedBy,
              second_approved_by AS secondApprovedBy
       FROM users WHERE id = ?`,
      [id]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (!user.isExternal) return res.status(400).json({ error: 'User is not external' })
    if (user.isActive && user.secondApprovedBy) {
      return res.status(400).json({ error: 'User already fully approved and active' })
    }

    // ── First approval ───────────────────────────────────
    if (!user.approvedBy) {
      if (req.user.id === id) {
        return res.status(400).json({ error: 'Cannot approve your own account' })
      }
      await db.query(
        `UPDATE users SET approved_by=?, approved_at=NOW() WHERE id=?`,
        [req.user.id, id]
      )
      audit(req, 'user.approve_first', `id=${id}`)

      // Notify user that first approval was received
      await sendEmail(user.email, 'Access request received — QCO MMS',
        html('Access Request Update',
          `<p>Dear ${user.fullName},</p>
           <p>Your QCO MMS access request has received its first approval. A second admin approval is still required before your account is activated.</p>
           <p>You will receive another email once your access is fully approved.</p>`
        )
      )

      return res.json({ message: 'First approval recorded. Awaiting second admin approval.', approvals: 1 })
    }

    // ── Second approval ──────────────────────────────────
    if (user.secondApprovedBy) {
      return res.status(400).json({ error: 'Already has two approvals' })
    }
    if (user.approvedBy === req.user.id) {
      return res.status(400).json({ error: 'Second approval must come from a different admin' })
    }

    await db.query(
      `UPDATE users SET second_approved_by=?, second_approved_at=NOW(), is_active=1 WHERE id=?`,
      [req.user.id, id]
    )
    audit(req, 'user.approve_second', `id=${id}`)

    // Notify user that their account is now active
    await sendEmail(user.email, 'Access approved — QCO MMS',
      html('Access Approved',
        `<p>Dear ${user.fullName},</p>
         <p>Your QCO MMS access request has been <strong>fully approved</strong>. You can now log in at your project's QMAT URL.</p>`
      )
    )

    res.json({ message: 'Second approval recorded. User is now active.', approvals: 2, isActive: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── ACTIVATE / DEACTIVATE ──────────────────────────────────
router.post('/users/:id/deactivate', async (req, res) => {
  const id = parseInt(req.params.id)
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate your own account' })
  try {
    await db.query('UPDATE users SET is_active=0 WHERE id=?', [id])
    audit(req, 'user.deactivate', `id=${id}`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/users/:id/activate', async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    await db.query('UPDATE users SET is_active=1 WHERE id=?', [id])
    audit(req, 'user.activate', `id=${id}`)
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

// ─── SEND TEST EMAIL ────────────────────────────────────────
// Sends a test email to the requesting admin to confirm SMTP works.
router.post('/test-email', async (req, res) => {
  try {
    await sendEmail(
      req.user.email,
      'Test email — QCO MMS',
      html('SMTP Test', `<p>SMTP is configured correctly. This email was sent at ${new Date().toISOString()}.</p>`)
    )
    res.json({ ok: true, sentTo: req.user.email })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
