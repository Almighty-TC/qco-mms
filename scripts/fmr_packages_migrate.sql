-- ─── FMR PACKAGES (issuance packaging at approval) ───────────────────────────
-- Mirrors scn_packages (+ package_type_id, fmr_id) so FMR approval can record HOW the
-- material is issued: package type, L×W×H, gross/net weight, and DG details. Lines are
-- grouped into packages via fmr_lines.package_id (a line belongs to one package).
-- Run as QCO_admin (DDL + GRANT). App user (qmat_app) gets DML on the new table.

CREATE TABLE IF NOT EXISTS fmr_packages (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  fmr_id             INT NOT NULL,
  package_number     VARCHAR(50),
  package_type_id    INT,
  description        VARCHAR(500),
  length_mm          DECIMAL(10,2),
  width_mm           DECIMAL(10,2),
  height_mm          DECIMAL(10,2),
  gross_weight_kg    DECIMAL(10,3),
  net_weight_kg      DECIMAL(10,3),
  is_dangerous_goods TINYINT(1) DEFAULT 0,
  dg_class           VARCHAR(50),
  dg_un_number       VARCHAR(20),
  marks_numbers      TEXT,
  created_by         INT,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fmrpkg_fmr  (fmr_id),
  KEY idx_fmrpkg_type (package_type_id),
  CONSTRAINT fk_fmrpkg_fmr  FOREIGN KEY (fmr_id)          REFERENCES fmr_requests(id),
  CONSTRAINT fk_fmrpkg_type FOREIGN KEY (package_type_id) REFERENCES package_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A line belongs to one package (nullable until approved/assigned).
ALTER TABLE fmr_lines
  ADD COLUMN package_id INT NULL,
  ADD KEY idx_fmrline_package (package_id),
  ADD CONSTRAINT fk_fmrline_package FOREIGN KEY (package_id) REFERENCES fmr_packages(id);

-- App user needs DML on the new table (it never gets DDL).
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.fmr_packages TO 'qmat_app'@'%';
FLUSH PRIVILEGES;
