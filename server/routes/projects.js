const express = require('express');
const router = express.Router();
const db = require('../db');

// ─── LIST ALL PROJECTS ──────────────────────────────────────
// Returns all projects ordered by creation date, with snake_case DB columns
// aliased to camelCase for consistent JSON output.
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
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
      FROM projects p
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
