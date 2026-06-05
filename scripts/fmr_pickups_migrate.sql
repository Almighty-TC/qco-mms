-- ─── FMR PICKUPS (Proof of Collection at issue/hand-over) ────────────────────
-- One row per pickup event (partial issuance ⇒ multiple pickups, each with its own PoC):
-- who collected, their company, a signature/photo file, notes, and when. Mirrors the
-- proof_of_custody concept in Logistics. Run as QCO_admin (DDL + GRANT).

CREATE TABLE IF NOT EXISTS fmr_pickups (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  fmr_id               INT NOT NULL,
  collected_by_name    VARCHAR(255) NOT NULL,
  collected_by_company VARCHAR(255),
  qty_issued           DECIMAL(15,3),          -- total collected in this event
  notes                TEXT,
  signature_file       VARCHAR(500),           -- PoC signature/photo (uploads/fmr-poc)
  signature_mime       VARCHAR(100),
  picked_up_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  issued_by            INT,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fmrpickup_fmr (fmr_id),
  CONSTRAINT fk_fmrpickup_fmr FOREIGN KEY (fmr_id) REFERENCES fmr_requests(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.fmr_pickups TO 'qmat_app'@'%';
FLUSH PRIVILEGES;
