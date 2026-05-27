-- ============================================================
-- QMAT — Quality Material & Asset Tracking
-- MySQL Database Schema v1.0
-- ============================================================

CREATE DATABASE IF NOT EXISTS qmat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE qmat;

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  initials      VARCHAR(5),
  role          ENUM('admin','qco_staff','expeditor','viewer','supplier') NOT NULL DEFAULT 'viewer',
  company       VARCHAR(255),
  phone         VARCHAR(50),
  is_active     BOOLEAN DEFAULT TRUE,
  last_login    DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE projects (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(50) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  phase         VARCHAR(100),
  status        ENUM('active','on-hold','complete','cancelled') DEFAULT 'active',
  rag           ENUM('red','amber','green','grey') DEFAULT 'green',
  total_pos     INT DEFAULT 0,
  at_risk       INT DEFAULT 0,
  breached      INT DEFAULT 0,
  progress_pct  DECIMAL(5,2) DEFAULT 0,
  created_by    INT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE wbs_nodes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  project_id    INT NOT NULL,
  parent_id     INT,
  code          VARCHAR(50) NOT NULL,
  description   VARCHAR(500) NOT NULL,
  discipline    VARCHAR(100),
  ros_date      DATE,
  notes         TEXT,
  sort_order    INT DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (parent_id) REFERENCES wbs_nodes(id)
);

CREATE TABLE purchase_orders (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  project_id    INT NOT NULL,
  po_number     VARCHAR(100) NOT NULL UNIQUE,
  vendor_name   VARCHAR(255) NOT NULL,
  vendor_code   VARCHAR(100),
  description   VARCHAR(500),
  value         DECIMAL(15,2),
  currency      VARCHAR(10) DEFAULT 'AUD',
  status        ENUM('rfq','loa','po-raised','active','closed','cancelled') DEFAULT 'rfq',
  rag           ENUM('red','amber','green','grey','blue') DEFAULT 'green',
  incoterms     VARCHAR(20),
  contract_delivery_date DATE,
  estimated_delivery_date DATE,
  created_by    INT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE po_lines (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  po_id         INT NOT NULL,
  wbs_id        INT,
  line_number   VARCHAR(20) NOT NULL,
  description   VARCHAR(500) NOT NULL,
  tag_number    VARCHAR(100),
  qty           DECIMAL(10,3),
  uom           VARCHAR(20) DEFAULT 'EA',
  qty_allocated DECIMAL(10,3) DEFAULT 0,
  qty_received  DECIMAL(10,3) DEFAULT 0,
  ros_date      DATE,
  insp_type     ENUM('Class I','Class II','Class III') DEFAULT 'Class II',
  cert_required VARCHAR(255),
  vdrl_required BOOLEAN DEFAULT FALSE,
  status        ENUM('not-started','rfq','po-raised','in-production','shipped','received','closed') DEFAULT 'not-started',
  rag           ENUM('red','amber','green','grey','blue') DEFAULT 'grey',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (wbs_id) REFERENCES wbs_nodes(id)
);

CREATE TABLE vdrl_packages (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  project_id    INT NOT NULL,
  po_id         INT,
  package_ref   VARCHAR(100) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  vendor_name   VARCHAR(255),
  po_number     VARCHAR(100),
  status        ENUM('draft','active','closed') DEFAULT 'active',
  total_docs    INT DEFAULT 0,
  submitted     INT DEFAULT 0,
  overdue       INT DEFAULT 0,
  abf_total     INT DEFAULT 0,
  abf_cleared   INT DEFAULT 0,
  progress_pct  DECIMAL(5,2) DEFAULT 0,
  supplier_user_id INT,
  created_by    INT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (supplier_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE vdrl_documents (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  package_id      INT NOT NULL,
  doc_number      VARCHAR(100) NOT NULL,
  title           VARCHAR(500) NOT NULL,
  doc_type        ENUM('Drawing','Datasheet','Procedure','Certificate','Manual','Report','Calculation','Specification') NOT NULL,
  discipline      VARCHAR(100),
  revision        VARCHAR(10) DEFAULT 'A',
  purpose         ENUM('IFA','IFC','IFR','IFI','AFC') DEFAULT 'IFA',
  status          ENUM('Not submitted','Under review','Approved','Overdue','Resubmit') DEFAULT 'Not submitted',
  required_date   DATE,
  promised_date   DATE,
  submitted_date  DATE,
  abf_required    BOOLEAN DEFAULT FALSE,
  abf_cleared     BOOLEAN DEFAULT FALSE,
  cert_required   BOOLEAN DEFAULT FALSE,
  mdr_required    BOOLEAN DEFAULT TRUE,
  review_days     INT DEFAULT 14,
  transmittal_ref VARCHAR(100),
  spec_reference  VARCHAR(255),
  tag_number      VARCHAR(255),
  po_line_ref     VARCHAR(100),
  notes           TEXT,
  created_by      INT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (package_id) REFERENCES vdrl_packages(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE vdrl_revisions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  document_id   INT NOT NULL,
  revision      VARCHAR(10) NOT NULL,
  submitted_by  INT,
  submitted_at  DATETIME,
  review_code   ENUM('C1','C2','C3','C4'),
  reviewed_by   INT,
  reviewed_at   DATETIME,
  file_name     VARCHAR(500),
  file_path     VARCHAR(1000),
  notes         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES vdrl_documents(id),
  FOREIGN KEY (submitted_by) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE TABLE vdrl_review_comments (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  document_id   INT NOT NULL,
  revision_id   INT,
  comment_ref   VARCHAR(20),
  comment_text  TEXT NOT NULL,
  severity      ENUM('Hold','Minor','Info') DEFAULT 'Minor',
  resolution    ENUM('Open','Closed') DEFAULT 'Open',
  raised_by     INT,
  supplier_response TEXT,
  responded_at  DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES vdrl_documents(id),
  FOREIGN KEY (revision_id) REFERENCES vdrl_revisions(id),
  FOREIGN KEY (raised_by) REFERENCES users(id)
);

CREATE TABLE vdrl_expediting_log (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  package_id    INT NOT NULL,
  document_id   INT,
  action_type   ENUM('desk-email','phone-call','formal-letter','field-visit','management-escalation') NOT NULL,
  action_date   DATE NOT NULL,
  performed_by  INT,
  description   TEXT,
  new_promised_date DATE,
  vendor_response TEXT,
  escalation_level ENUM('desk','field','management') DEFAULT 'desk',
  visible_to_supplier BOOLEAN DEFAULT TRUE,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (package_id) REFERENCES vdrl_packages(id),
  FOREIGN KEY (document_id) REFERENCES vdrl_documents(id),
  FOREIGN KEY (performed_by) REFERENCES users(id)
);

CREATE TABLE vdrl_transmittals (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  package_id    INT NOT NULL,
  transmittal_no VARCHAR(100) NOT NULL UNIQUE,
  issued_date   DATE NOT NULL,
  issued_by     INT,
  to_contact_id INT,
  purpose       ENUM('IFA','IFC','IFR','IFI','AFC') DEFAULT 'IFA',
  reply_required_by DATE,
  status        ENUM('Awaiting reply','Reply received','Approved','Closed') DEFAULT 'Awaiting reply',
  notes         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (package_id) REFERENCES vdrl_packages(id),
  FOREIGN KEY (issued_by) REFERENCES users(id),
  FOREIGN KEY (to_contact_id) REFERENCES users(id)
);

CREATE TABLE vdrl_transmittal_docs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  transmittal_id  INT NOT NULL,
  document_id     INT NOT NULL,
  FOREIGN KEY (transmittal_id) REFERENCES vdrl_transmittals(id),
  FOREIGN KEY (document_id) REFERENCES vdrl_documents(id)
);

CREATE TABLE vdrl_mdr (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  package_id      INT NOT NULL,
  document_id     INT NOT NULL,
  category        VARCHAR(100),
  asbuilt_rev     VARCHAR(10),
  received_date   DATE,
  closeout_status ENUM('Outstanding','Under review','Accepted','Rejected') DEFAULT 'Outstanding',
  certified       BOOLEAN DEFAULT FALSE,
  notes           TEXT,
  updated_by      INT,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (package_id) REFERENCES vdrl_packages(id),
  FOREIGN KEY (document_id) REFERENCES vdrl_documents(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE vdrl_alert_rules (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  package_id    INT,
  rule_type     ENUM('abf-overdue','review-clock','promised-date-missed','non-abf-overdue','mdr-milestone','no-response-escalate') NOT NULL,
  severity      ENUM('danger','warn','info') DEFAULT 'warn',
  is_active     BOOLEAN DEFAULT TRUE,
  threshold_value INT DEFAULT 0,
  notify_role   VARCHAR(100),
  escalation_days INT DEFAULT 7,
  auto_action   VARCHAR(100),
  created_by    INT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (package_id) REFERENCES vdrl_packages(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE expediting_register (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  po_id         INT NOT NULL,
  rag           ENUM('red','amber','green','grey','blue') DEFAULT 'grey',
  cdd           DATE,
  edd           DATE,
  last_contact  DATE,
  next_action   DATE,
  expeditor_id  INT,
  notes         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (expeditor_id) REFERENCES users(id)
);

CREATE TABLE shipment_control_notes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  project_id    INT NOT NULL,
  scn_ref       VARCHAR(100) NOT NULL UNIQUE,
  po_id         INT,
  vendor_name   VARCHAR(255),
  incoterms     VARCHAR(20),
  etd           DATE,
  atd           DATE,
  eta           DATE,
  ata           DATE,
  status        ENUM('draft','pending','in-transit','arrived','received','closed') DEFAULT 'draft',
  mode          ENUM('air','sea','road','rail') DEFAULT 'sea',
  bl_number     VARCHAR(100),
  container_ref VARCHAR(100),
  notes         TEXT,
  created_by    INT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

INSERT INTO users (email, password_hash, full_name, initials, role, company) VALUES
('admin@qco.com.au', '$2b$10$placeholder_hash_change_this', 'Admin User', 'AU', 'admin', 'QCO'),
('j.morrison@qco.com.au', '$2b$10$placeholder_hash_change_this', 'J. Morrison', 'JM', 'expeditor', 'QCO'),
('h.mueller@siemens-energy.com', '$2b$10$placeholder_hash_change_this', 'Hans Mueller', 'HM', 'supplier', 'Siemens Energy');

INSERT INTO projects (code, name, phase, status, rag, total_pos, at_risk, breached, progress_pct) VALUES
('PRJ-2024-001', 'Pilbara Gas Processing Plant', 'Phase 2', 'active', 'red', 142, 18, 8, 45.5),
('PRJ-2024-002', 'Hunter Valley Substation 132kV', 'Phase 1', 'active', 'amber', 67, 4, 0, 62.0),
('PRJ-2023-008', 'Ord River Dam Upgrade', 'Phase 3', 'active', 'green', 89, 1, 0, 88.5),
('PRJ-2025-001', 'Port Hedland LNG Terminal', 'Phase 1', 'active', 'blue', 12, 0, 0, 12.0);

SELECT 'QMAT schema created successfully!' AS result;