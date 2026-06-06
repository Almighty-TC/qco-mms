-- ─── Multiple expeditors per PO (co-assignment) ──────────────
-- Access is now governed by membership here, not the single purchase_orders.
-- expeditor_id column (which is kept as the "lead" for display + back-compat).
CREATE TABLE IF NOT EXISTS po_expeditors (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  po_id        INT NOT NULL,
  user_id      INT NOT NULL,
  assigned_by  INT NULL,
  assigned_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_po_user (po_id, user_id),
  KEY idx_user (user_id),
  KEY idx_po (po_id),
  CONSTRAINT fk_poexp_po   FOREIGN KEY (po_id)   REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_poexp_user FOREIGN KEY (user_id) REFERENCES users(id)           ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Back-fill: every PO that already has a lead expeditor becomes a membership row.
INSERT IGNORE INTO po_expeditors (po_id, user_id, assigned_by, assigned_at)
  SELECT id, expeditor_id, expeditor_assigned_by, COALESCE(expeditor_assigned_at, NOW())
  FROM purchase_orders WHERE expeditor_id IS NOT NULL;

-- Least-privilege: the app user needs DML on the new table (new tables are not
-- covered by existing grants). Run as QCO_admin.
GRANT SELECT, INSERT, UPDATE, DELETE ON `qmat`.`po_expeditors` TO 'qmat_app'@'%';
FLUSH PRIVILEGES;
