-- C-c: pending_changes — stages create/delete for wbs/commodity/equipment/mto until a domain confirmer applies it.
CREATE TABLE IF NOT EXISTS pending_changes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  module ENUM('wbs','commodity','equipment','mto') NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INT NULL,
  action ENUM('create','delete') NOT NULL,
  proposed JSON NULL, before_value JSON NULL,
  is_baseline_major TINYINT(1) NOT NULL DEFAULT 0,
  required_confirmer_role VARCHAR(50) NOT NULL,
  batch_id VARCHAR(40) NULL,
  status ENUM('pending','confirmed','rejected','superseded') NOT NULL DEFAULT 'pending',
  requested_by INT NOT NULL, requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirmed_by INT NULL, confirmed_at DATETIME NULL, confirm_comment TEXT NULL,
  CONSTRAINT fk_pc_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_pc_requester FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_pc_confirmer FOREIGN KEY (confirmed_by) REFERENCES users(id),
  KEY idx_pc_queue (project_id, module, status)
);
