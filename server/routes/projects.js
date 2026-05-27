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
        id,
        code,
        name,
        rag,
        phase,
        total_pos  AS totalPOs,
        at_risk    AS atRisk,
        breached
      FROM projects
      ORDER BY created_at DESC
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
