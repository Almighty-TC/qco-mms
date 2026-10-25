const express = require('express');
const router = express.Router();
const db = require('../db');
const { dbError } = require('../utils/dbError');
const { EXTERNAL_ROLES } = require('../middleware/permissions');

// External roles see only the projects they hold a user_wbs_access grant for (the same
// grant requireProjectScope checks); internal roles are unchanged.
const GRANTED = 'SELECT 1 FROM user_wbs_access WHERE user_id = ? AND project_id = ? LIMIT 1';

// 3T174 (TC's answer): external roles do not receive a project's project-wide PO health (the
// RAG and the PO counts). The keys stay, as null, because the Home cards read absent counts as 0.
const withoutPoHealth = (row, keys) => ({ ...row, ...Object.fromEntries(keys.map(k => [k, null])) });
const LIST_HEALTH = ['rag', 'totalPOs', 'breached', 'atRisk'];

// 3T177: GET /:id gives external roles only the identity keys GET / returns (no PO health,
// progress, client, dates or approval thresholds); internal roles get the whole row.
const IDENTITY = ['id', 'code', 'name', 'phase'];
const identityOf = row => Object.fromEntries(IDENTITY.map(k => [k, row[k]]));

// ─── LIST ALL PROJECTS ──────────────────────────────────────
// Returns all projects ordered by creation date, with snake_case DB columns
// aliased to camelCase for consistent JSON output. External roles: granted projects only.
router.get('/', async (req, res) => {
  try {
    const external = EXTERNAL_ROLES.has(req.user?.role);
    const sql = `
      SELECT
        p.id,
        p.code,
        p.name,
        p.rag,
        p.phase,
        (SELECT COUNT(*) FROM purchase_orders po WHERE po.project_id = p.id) AS totalPOs,
        (SELECT COUNT(*) FROM purchase_orders po
         WHERE po.project_id = p.id
           AND po.contract_delivery_date IS NOT NULL
           AND po.contract_delivery_date < CURDATE()
           AND po.status NOT IN ('complete','cancelled','closed')) AS breached,
        (SELECT COUNT(*) FROM purchase_orders po
         WHERE po.project_id = p.id
           AND po.contract_delivery_date IS NOT NULL
           AND po.contract_delivery_date >= CURDATE()
           AND po.contract_delivery_date < DATE_ADD(CURDATE(), INTERVAL 30 DAY)
           AND po.status NOT IN ('complete','cancelled','closed')) AS atRisk
      FROM projects p${external ? `
      WHERE p.id IN (SELECT a.project_id FROM user_wbs_access a WHERE a.user_id = ?)` : ''}
      ORDER BY p.created_at DESC
    `;
    const [rows] = external ? await db.query(sql, [req.user.id]) : await db.query(sql);
    res.json(external ? rows.map(r => withoutPoHealth(r, LIST_HEALTH)) : rows);
  } catch (err) {
    dbError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const external = EXTERNAL_ROLES.has(req.user?.role);
    if (external) {
      const [grant] = await db.query(GRANTED, [req.user.id, Number(req.params.id)]);
      if (!grant.length) return res.status(403).json({ error: 'No project access' });
    }
    const [rows] = await db.query('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    res.json(external ? identityOf(rows[0]) : rows[0]);
  } catch (err) {
    dbError(res, err);
  }
});

module.exports = router;
