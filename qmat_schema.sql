-- MySQL dump 10.13  Distrib 9.3.0, for macos14.7 (arm64)
--
-- Host: qcosystem.mysql.database.azure.com    Database: qmat
-- ------------------------------------------------------
-- Server version	8.0.44-azure

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `acronyms`
--

DROP TABLE IF EXISTS `acronyms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `acronyms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `acronym` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `definition` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `module` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_by` int DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `acronym` (`acronym`),
  KEY `fk_acronyms_created_by` (`created_by`),
  CONSTRAINT `fk_acronyms_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=61 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `audit_log`
--

DROP TABLE IF EXISTS `audit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entity_id` int DEFAULT NULL,
  `project_id` int DEFAULT NULL,
  `before_value` json DEFAULT NULL,
  `after_value` json DEFAULT NULL,
  `reason_category` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reason_detail` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `resource` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created` (`created_at`),
  KEY `idx_audit_entity` (`entity_type`,`entity_id`),
  KEY `idx_audit_project` (`project_id`),
  CONSTRAINT `fk_audit_log_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_audit_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `date_change_log`
--

DROP TABLE IF EXISTS `date_change_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `date_change_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` int NOT NULL,
  `field_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `old_value` date DEFAULT NULL,
  `new_value` date DEFAULT NULL,
  `change_reason` text COLLATE utf8mb4_unicode_ci,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_dcl_created` (`created_by`),
  KEY `idx_dcl_entity` (`entity_type`,`entity_id`),
  KEY `idx_dcl_field` (`field_name`),
  KEY `idx_dcl_created_at` (`created_at`),
  CONSTRAINT `fk_dcl_created` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='General-purpose date change audit log. Covers ROS, ETA, ETD, contract dates across all entities.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `delegated_permissions`
--

DROP TABLE IF EXISTS `delegated_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `delegated_permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `granted_to` int NOT NULL,
  `granted_by` int NOT NULL,
  `permission` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `granted_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `granted_to` (`granted_to`),
  KEY `granted_by` (`granted_by`),
  CONSTRAINT `delegated_permissions_ibfk_1` FOREIGN KEY (`granted_to`) REFERENCES `users` (`id`),
  CONSTRAINT `delegated_permissions_ibfk_2` FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `expediting_register`
--

DROP TABLE IF EXISTS `expediting_register`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expediting_register` (
  `id` int NOT NULL AUTO_INCREMENT,
  `status` enum('pre_expediting','active','complete','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `material_desc` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `group_category` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `po_id` int NOT NULL,
  `rag` enum('red','amber','green','grey','blue') COLLATE utf8mb4_unicode_ci DEFAULT 'grey',
  `cdd` date DEFAULT NULL,
  `edd` date DEFAULT NULL,
  `last_contact` date DEFAULT NULL,
  `next_action` date DEFAULT NULL,
  `expeditor_id` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `po_id` (`po_id`),
  KEY `expeditor_id` (`expeditor_id`),
  CONSTRAINT `expediting_register_ibfk_1` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `expediting_register_ibfk_2` FOREIGN KEY (`expeditor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inco_terms`
--

DROP TABLE IF EXISTS `inco_terms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inco_terms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `full_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `risk_transfer_point` text COLLATE utf8mb4_unicode_ci,
  `transport_mode` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_by` int DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `fk_inco_terms_created_by` (`created_by`),
  CONSTRAINT `fk_inco_terms_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=34 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `itp_items`
--

DROP TABLE IF EXISTS `itp_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `itp_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `requirement_id` int NOT NULL,
  `item_number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','passed','failed','waived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `actioned_by` int DEFAULT NULL,
  `actioned_at` datetime DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_itpi_actioned` (`actioned_by`),
  KEY `idx_itpi_req` (`requirement_id`),
  KEY `idx_itpi_status` (`status`),
  CONSTRAINT `fk_itpi_actioned` FOREIGN KEY (`actioned_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_itpi_req` FOREIGN KEY (`requirement_id`) REFERENCES `itp_requirements` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Individual ITP checklist items. Status tracked per item with actioned_by and timestamp.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `itp_requirements`
--

DROP TABLE IF EXISTS `itp_requirements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `itp_requirements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_id` int NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `inspection_type` enum('witness','review','hold_point','document') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'review',
  `is_mandatory` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_itp_created` (`created_by`),
  KEY `idx_itp_po` (`po_id`),
  CONSTRAINT `fk_itp_created` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_itp_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Inspection and test plan requirements per PO. Links to itp_items for individual checklist entries.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `milestone_template_steps`
--

DROP TABLE IF EXISTS `milestone_template_steps`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `milestone_template_steps` (
  `id` int NOT NULL AUTO_INCREMENT,
  `template_id` int NOT NULL,
  `step_order` tinyint NOT NULL DEFAULT '1',
  `label` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `is_required` tinyint(1) NOT NULL DEFAULT '1',
  `default_offset_days` int DEFAULT NULL COMMENT 'Days before ROS to auto-calc target_date',
  `notify_on_complete` tinyint(1) NOT NULL DEFAULT '0',
  `notify_roles` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Comma-separated roles to notify',
  `created_by` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mts_order` (`template_id`,`step_order`),
  KEY `fk_mts_created` (`created_by`),
  KEY `fk_mts_updated` (`updated_by`),
  KEY `idx_mts_template_id` (`template_id`),
  CONSTRAINT `fk_mts_created` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_mts_template` FOREIGN KEY (`template_id`) REFERENCES `milestone_templates` (`id`),
  CONSTRAINT `fk_mts_updated` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Ordered steps within a milestone template. Seeded into po_milestones on PO creation.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `milestone_templates`
--

DROP TABLE IF EXISTS `milestone_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `milestone_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `commodity_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `project_id` int DEFAULT NULL COMMENT 'NULL = system-wide; set = project-specific override',
  `is_system_default` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_mt_created` (`created_by`),
  KEY `fk_mt_updated` (`updated_by`),
  KEY `fk_mt_deleted` (`deleted_by`),
  KEY `idx_mt_project_id` (`project_id`),
  KEY `idx_mt_is_active` (`is_active`),
  KEY `idx_mt_is_system` (`is_system_default`),
  CONSTRAINT `fk_mt_created` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_mt_deleted` FOREIGN KEY (`deleted_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_mt_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_mt_updated` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Reusable milestone templates. Seeds po_milestones on PO creation.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_read` tinyint(1) DEFAULT '0',
  `related_entity_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `related_entity_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `idx_notif_read` (`is_read`),
  KEY `idx_notif_created` (`created_at`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `password_history`
--

DROP TABLE IF EXISTS `password_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ph_user` (`user_id`),
  CONSTRAINT `fk_pw_history_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `po_action_notes`
--

DROP TABLE IF EXISTS `po_action_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `po_action_notes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_id` int NOT NULL,
  `note_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_internal` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1=QCO internal only, 0=visible in vendor portal',
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_pan_created` (`created_by`),
  KEY `idx_pan_po` (`po_id`),
  KEY `idx_pan_created_at` (`created_at`),
  CONSTRAINT `fk_pan_created` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_pan_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Time-stamped action note feed per PO. is_internal controls vendor portal visibility.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `po_approvals`
--

DROP TABLE IF EXISTS `po_approvals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `po_approvals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_id` int NOT NULL,
  `approver_id` int NOT NULL,
  `approval_level` tinyint unsigned NOT NULL DEFAULT '1',
  `status` enum('pending','approved','rejected','unapproved') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `comments` text COLLATE utf8mb4_unicode_ci,
  `actioned_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pa_po` (`po_id`),
  KEY `idx_pa_approver` (`approver_id`),
  KEY `idx_pa_status` (`status`),
  CONSTRAINT `fk_pa_approver` FOREIGN KEY (`approver_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_pa_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PO approval chain. Supports multi-step approval levels. Records every decision with timestamp.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `po_documents`
--

DROP TABLE IF EXISTS `po_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `po_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_id` int NOT NULL,
  `doc_type` enum('signed_po','amendment','variation','correspondence','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'signed_po',
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Original filename as uploaded',
  `file_path` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Internal server path — never a public URL',
  `file_size_bytes` int unsigned DEFAULT NULL,
  `mime_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `version` tinyint unsigned NOT NULL DEFAULT '1',
  `is_current` tinyint(1) NOT NULL DEFAULT '1' COMMENT 'Only one current version per doc_type per PO',
  `description` text COLLATE utf8mb4_unicode_ci,
  `uploaded_by` int NOT NULL,
  `uploaded_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_pd_uploaded` (`uploaded_by`),
  KEY `idx_pd_po` (`po_id`),
  KEY `idx_pd_type` (`doc_type`),
  KEY `idx_pd_current` (`po_id`,`doc_type`,`is_current`),
  KEY `idx_pd_uploaded_at` (`uploaded_at`),
  CONSTRAINT `fk_pd_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pd_uploaded` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Signed PO documents and amendments. Versioned — all prior versions retained for audit.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `po_hold_reasons`
--

DROP TABLE IF EXISTS `po_hold_reasons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `po_hold_reasons` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_id` int NOT NULL,
  `hold_type` enum('commercial','design_freeze','funding','quality','scope_change','other') COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `raised_by` int NOT NULL,
  `raised_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_released` tinyint(1) NOT NULL DEFAULT '0',
  `released_by` int DEFAULT NULL,
  `released_at` datetime DEFAULT NULL,
  `release_note` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `fk_phr_raised` (`raised_by`),
  KEY `fk_phr_released` (`released_by`),
  KEY `idx_phr_po` (`po_id`),
  KEY `idx_phr_is_released` (`is_released`),
  KEY `idx_phr_hold_type` (`hold_type`),
  CONSTRAINT `fk_phr_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_phr_raised` FOREIGN KEY (`raised_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_phr_released` FOREIGN KEY (`released_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Formal hold register per PO. Hold blocks shipment and receipting. Full raise/release audit trail.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `po_lines`
--

DROP TABLE IF EXISTS `po_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `po_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_id` int NOT NULL,
  `wbs_id` int DEFAULT NULL,
  `line_number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tag_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qty` decimal(10,3) DEFAULT NULL,
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'EA',
  `cdd` date DEFAULT NULL,
  `uom_id` int DEFAULT NULL,
  `qty_allocated` decimal(10,3) DEFAULT '0.000',
  `qty_received` decimal(10,3) DEFAULT '0.000',
  `unit_price` decimal(15,4) DEFAULT NULL,
  `total_price` decimal(15,2) GENERATED ALWAYS AS ((`qty` * `unit_price`)) STORED,
  `ros_date` date DEFAULT NULL,
  `heat_number_required` tinyint(1) NOT NULL DEFAULT '0',
  `supplier_name_snapshot` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wbs_code_snapshot` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `insp_type` enum('Class I','Class II','Class III') COLLATE utf8mb4_unicode_ci DEFAULT 'Class II',
  `cert_required` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vdrl_required` tinyint(1) DEFAULT '0',
  `status` enum('not-started','rfq','po-raised','in-production','shipped','received','closed') COLLATE utf8mb4_unicode_ci DEFAULT 'not-started',
  `rag` enum('red','amber','green','grey','blue') COLLATE utf8mb4_unicode_ci DEFAULT 'grey',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_po_lines_uom_id` (`uom_id`),
  KEY `idx_pol_po` (`po_id`),
  KEY `idx_pol_wbs` (`wbs_id`),
  KEY `idx_pol_cdd` (`cdd`),
  CONSTRAINT `fk_po_lines_uom_id` FOREIGN KEY (`uom_id`) REFERENCES `units_of_measure` (`id`),
  CONSTRAINT `po_lines_ibfk_1` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `po_lines_ibfk_2` FOREIGN KEY (`wbs_id`) REFERENCES `wbs_nodes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `po_milestones`
--

DROP TABLE IF EXISTS `po_milestones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `po_milestones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_id` int NOT NULL,
  `template_step_id` int DEFAULT NULL COMMENT 'NULL if manually added (not from template)',
  `step_order` tinyint NOT NULL DEFAULT '1',
  `label` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `target_date` date DEFAULT NULL COMMENT 'Planned completion date',
  `forecast_date` date DEFAULT NULL COMMENT 'Latest expeditor forecast',
  `actual_date` date DEFAULT NULL COMMENT 'Set when status = complete',
  `status` enum('not_started','in_progress','complete','overdue','waived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_started',
  `is_required` tinyint(1) NOT NULL DEFAULT '1',
  `completed_by` int DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `waived_by` int DEFAULT NULL,
  `waived_reason` text COLLATE utf8mb4_unicode_ci,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_pm_template` (`template_step_id`),
  KEY `fk_pm_completed` (`completed_by`),
  KEY `fk_pm_waived` (`waived_by`),
  KEY `fk_pm_created` (`created_by`),
  KEY `fk_pm_updated` (`updated_by`),
  KEY `fk_pm_deleted` (`deleted_by`),
  KEY `idx_pm_po_id` (`po_id`),
  KEY `idx_pm_status` (`status`),
  KEY `idx_pm_target_date` (`target_date`),
  KEY `idx_pm_forecast_date` (`forecast_date`),
  CONSTRAINT `fk_pm_completed` FOREIGN KEY (`completed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_pm_created` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_pm_deleted` FOREIGN KEY (`deleted_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_pm_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `fk_pm_template` FOREIGN KEY (`template_step_id`) REFERENCES `milestone_template_steps` (`id`),
  CONSTRAINT `fk_pm_updated` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_pm_waived` FOREIGN KEY (`waived_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Actual milestones per PO. Seeded from templates but fully editable. Drives the variable-length milestone progress bar.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `po_variations`
--

DROP TABLE IF EXISTS `po_variations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `po_variations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_id` int NOT NULL,
  `variation_number` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `requested_by` int NOT NULL,
  `approved_by` int DEFAULT NULL,
  `status` enum('draft','pending_approval','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `approved_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pv_number` (`po_id`,`variation_number`),
  KEY `fk_pv_requested` (`requested_by`),
  KEY `fk_pv_approved` (`approved_by`),
  KEY `idx_pv_po` (`po_id`),
  KEY `idx_pv_status` (`status`),
  CONSTRAINT `fk_pv_approved` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_pv_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pv_requested` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Variation orders against a PO. Commercial and schedule impact tracked with full approval chain.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `projects`
--

DROP TABLE IF EXISTS `projects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `projects` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phase` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','on-hold','complete','cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `traceability_required` tinyint(1) NOT NULL DEFAULT '0',
  `traceability_set_by` int DEFAULT NULL,
  `traceability_set_at` datetime DEFAULT NULL,
  `rag` enum('red','amber','green','grey','blue') COLLATE utf8mb4_unicode_ci DEFAULT 'green',
  `client` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `total_pos` int DEFAULT '0',
  `at_risk` int DEFAULT '0',
  `breached` int DEFAULT '0',
  `progress_pct` decimal(5,2) DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `created_by` (`created_by`),
  KEY `fk_proj_trace_set` (`traceability_set_by`),
  CONSTRAINT `fk_proj_trace_set` FOREIGN KEY (`traceability_set_by`) REFERENCES `users` (`id`),
  CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `purchase_orders`
--

DROP TABLE IF EXISTS `purchase_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `po_number` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `po_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wbs_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `group_category` enum('mechanical','electrical','instrumentation','civil','piping','structural') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ros_date` date DEFAULT NULL,
  `owner_id` int DEFAULT NULL,
  `is_critical_path` tinyint(1) DEFAULT '0',
  `critical_path_set_by` int DEFAULT NULL,
  `critical_path_set_at` datetime DEFAULT NULL,
  `is_locked` tinyint(1) DEFAULT '0',
  `milestone_po_date` date DEFAULT NULL,
  `milestone_fat_date` date DEFAULT NULL,
  `milestone_esd_date` date DEFAULT NULL,
  `milestone_eta_date` date DEFAULT NULL,
  `milestone_ros_date` date DEFAULT NULL,
  `vendor_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vendor_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `supplier_id` int DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `value` decimal(15,2) DEFAULT NULL,
  `currency` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT 'AUD',
  `status` enum('rfq','loa','po-raised','active','closed','cancelled','pending_approval','pending_director_approval') COLLATE utf8mb4_unicode_ci DEFAULT 'rfq',
  `expeditor_id` int DEFAULT NULL,
  `expeditor_assigned_at` datetime DEFAULT NULL,
  `expeditor_assigned_by` int DEFAULT NULL,
  `pre_expediting_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `rag` enum('red','amber','green','grey','blue') COLLATE utf8mb4_unicode_ci DEFAULT 'green',
  `incoterms` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `inco_term_id` int DEFAULT NULL,
  `warehouse_id` int DEFAULT NULL,
  `contract_delivery_date` date DEFAULT NULL,
  `estimated_delivery_date` date DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `po_number` (`po_number`),
  KEY `created_by` (`created_by`),
  KEY `fk_po_inco_term_id` (`inco_term_id`),
  KEY `fk_po_warehouse_id` (`warehouse_id`),
  KEY `fk_po_owner_id` (`owner_id`),
  KEY `fk_po_exp_assigned` (`expeditor_assigned_by`),
  KEY `fk_po_cp_set` (`critical_path_set_by`),
  KEY `idx_po_expeditor` (`expeditor_id`),
  KEY `idx_po_critical_path` (`is_critical_path`),
  KEY `idx_po_project` (`project_id`),
  KEY `idx_po_supplier` (`supplier_id`),
  KEY `idx_po_status` (`status`),
  CONSTRAINT `fk_po_cp_set` FOREIGN KEY (`critical_path_set_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_po_exp_assigned` FOREIGN KEY (`expeditor_assigned_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_po_expeditor` FOREIGN KEY (`expeditor_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_po_inco_term_id` FOREIGN KEY (`inco_term_id`) REFERENCES `inco_terms` (`id`),
  CONSTRAINT `fk_po_owner_id` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_po_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`),
  CONSTRAINT `fk_po_warehouse_id` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`),
  CONSTRAINT `purchase_orders_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `purchase_orders_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `role_permissions`
--

DROP TABLE IF EXISTS `role_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `role` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `can_view` tinyint(1) DEFAULT '0',
  `can_create` tinyint(1) DEFAULT '0',
  `can_edit` tinyint(1) DEFAULT '0',
  `can_approve` tinyint(1) DEFAULT '0',
  `can_delete` tinyint(1) DEFAULT '0',
  `wbs_scoped` tinyint(1) DEFAULT '0',
  `is_default` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_module` (`role`,`module`)
) ENGINE=InnoDB AUTO_INCREMENT=314 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ros_change_log`
--

DROP TABLE IF EXISTS `ros_change_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ros_change_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity_type` enum('purchase_order','wbs_node','po_line') COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` int NOT NULL,
  `old_ros_date` date NOT NULL,
  `new_ros_date` date NOT NULL,
  `change_reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `impact_assessment` text COLLATE utf8mb4_unicode_ci,
  `approved_by` int DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_rcl_created` (`created_by`),
  KEY `fk_rcl_approved` (`approved_by`),
  KEY `idx_rcl_entity` (`entity_type`,`entity_id`),
  KEY `idx_rcl_created_at` (`created_at`),
  CONSTRAINT `fk_rcl_approved` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_rcl_created` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Immutable log of every ROS date change. Contractually significant — full history with reason and approval.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scn_additional_items`
--

DROP TABLE IF EXISTS `scn_additional_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scn_additional_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scn_id` int NOT NULL,
  `parent_po_line_id` int DEFAULT NULL,
  `is_variation` tinyint(1) NOT NULL DEFAULT '0',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` decimal(10,3) DEFAULT NULL,
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_scnai_created` (`created_by`),
  KEY `idx_scnai_scn` (`scn_id`),
  KEY `fk_sai_parent` (`parent_po_line_id`),
  CONSTRAINT `fk_scnai_created` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_scnai_scn` FOREIGN KEY (`scn_id`) REFERENCES `shipment_control_notes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sai_parent` FOREIGN KEY (`parent_po_line_id`) REFERENCES `po_lines` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Off-PO items added to an SCN. is_variation=1 + parent_po_line_id = a linked off-PO variation (e.g. crate for a pump line); never rolls into the parent line qty.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shipment_control_notes`
--

DROP TABLE IF EXISTS `shipment_control_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shipment_control_notes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `supplier_id` int DEFAULT NULL,
  `forwarder_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `forwarder_user_id` int DEFAULT NULL,
  `origin_location` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `destination_warehouse_id` int DEFAULT NULL,
  `is_critical_path` tinyint(1) NOT NULL DEFAULT '0',
  `total_packages` int unsigned DEFAULT NULL,
  `total_weight_kg` decimal(15,3) DEFAULT NULL,
  `rag` enum('green','amber','red') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pickup_contact_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pickup_contact_phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pickup_contact_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `forwarder_notified` tinyint(1) NOT NULL DEFAULT '0',
  `forwarder_notified_at` datetime DEFAULT NULL,
  `forwarder_notified_by` int DEFAULT NULL,
  `project_id` int NOT NULL,
  `scn_ref` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `po_id` int DEFAULT NULL,
  `vendor_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `incoterms` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `etd` date DEFAULT NULL,
  `atd` date DEFAULT NULL,
  `eta` date DEFAULT NULL,
  `ata` date DEFAULT NULL,
  `status` enum('draft','pending','in-transit','arrived','received','closed') COLLATE utf8mb4_unicode_ci DEFAULT 'draft',
  `mode` enum('air','sea','road','rail') COLLATE utf8mb4_unicode_ci DEFAULT 'sea',
  `bl_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `container_ref` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `scn_ref` (`scn_ref`),
  KEY `project_id` (`project_id`),
  KEY `po_id` (`po_id`),
  KEY `created_by` (`created_by`),
  KEY `fk_scn_forwarder` (`forwarder_user_id`),
  KEY `fk_scn_notif_by` (`forwarder_notified_by`),
  KEY `idx_scn_supplier` (`supplier_id`),
  KEY `idx_scn_critical` (`is_critical_path`),
  KEY `idx_scn_dest_wh` (`destination_warehouse_id`),
  CONSTRAINT `fk_scn_dest_wh` FOREIGN KEY (`destination_warehouse_id`) REFERENCES `warehouses` (`id`),
  CONSTRAINT `fk_scn_forwarder` FOREIGN KEY (`forwarder_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_scn_notif_by` FOREIGN KEY (`forwarder_notified_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_scn_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`),
  CONSTRAINT `shipment_control_notes_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `shipment_control_notes_ibfk_2` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `shipment_control_notes_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `supplier_addresses`
--

DROP TABLE IF EXISTS `supplier_addresses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `supplier_addresses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `supplier_id` int NOT NULL,
  `type` enum('registered','remittance','shipping') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'registered',
  `line1` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `line2` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `state` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `postcode` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_primary` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `supplier_id` (`supplier_id`),
  KEY `fk_sa_created_by` (`created_by`),
  CONSTRAINT `fk_sa_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_sa_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `suppliers`
--

DROP TABLE IF EXISTS `suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `suppliers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `avl_status` enum('approved','conditional','pending','suspended','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `categories` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `website` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `abn` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `country` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `fk_suppliers_created_by` (`created_by`),
  KEY `idx_sup_avl_status` (`avl_status`),
  CONSTRAINT `fk_suppliers_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `system_settings`
--

DROP TABLE IF EXISTS `system_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_settings` (
  `key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` text COLLATE utf8mb4_unicode_ci,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `units_of_measure`
--

DROP TABLE IF EXISTS `units_of_measure`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `units_of_measure` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_by` int DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `fk_uom_created_by` (`created_by`),
  CONSTRAINT `fk_uom_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=46 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_permission_overrides`
--

DROP TABLE IF EXISTS `user_permission_overrides`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_permission_overrides` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `module` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `can_view` tinyint(1) DEFAULT NULL,
  `can_create` tinyint(1) DEFAULT NULL,
  `can_edit` tinyint(1) DEFAULT NULL,
  `can_approve` tinyint(1) DEFAULT NULL,
  `can_delete` tinyint(1) DEFAULT NULL,
  `overridden_by` int NOT NULL,
  `overridden_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_module` (`user_id`,`module`),
  CONSTRAINT `user_permission_overrides_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_project_access`
--

DROP TABLE IF EXISTS `user_project_access`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_project_access` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `project_id` int NOT NULL,
  `access_level` enum('view','edit','manage') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'view',
  `granted_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_project` (`user_id`,`project_id`),
  KEY `project_id` (`project_id`),
  KEY `fk_upa_granted_by` (`granted_by`),
  CONSTRAINT `fk_upa_granted_by` FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_upa_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_upa_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_wbs_access`
--

DROP TABLE IF EXISTS `user_wbs_access`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_wbs_access` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `project_id` int NOT NULL,
  `wbs_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_type` enum('full','fmr_only','view_only') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'full',
  `created_by` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wbs_access` (`user_id`,`project_id`,`wbs_code`),
  KEY `project_id` (`project_id`),
  KEY `fk_user_wbs_created_by` (`created_by`),
  CONSTRAINT `fk_user_wbs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `user_wbs_access_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `user_wbs_access_ibfk_2` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `staff_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `full_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `initials` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'viewer',
  `is_external` tinyint(1) NOT NULL DEFAULT '0',
  `approved_by` int DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `second_approved_by` int DEFAULT NULL,
  `second_approved_at` datetime DEFAULT NULL,
  `company` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contract_start` date DEFAULT NULL,
  `contract_end` date DEFAULT NULL,
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `last_login` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `force_password_change` tinyint(1) NOT NULL DEFAULT '0',
  `password_expires_at` datetime DEFAULT NULL,
  `emergency_override` tinyint(1) NOT NULL DEFAULT '0',
  `emergency_override_reason` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_usr_role` (`role`),
  KEY `idx_usr_active` (`is_active`),
  KEY `idx_usr_company` (`company`)
) ENGINE=InnoDB AUTO_INCREMENT=72 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vdrl_alert_rules`
--

DROP TABLE IF EXISTS `vdrl_alert_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vdrl_alert_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `package_id` int DEFAULT NULL,
  `rule_type` enum('abf-overdue','review-clock','promised-date-missed','non-abf-overdue','mdr-milestone','no-response-escalate') COLLATE utf8mb4_unicode_ci NOT NULL,
  `severity` enum('danger','warn','info') COLLATE utf8mb4_unicode_ci DEFAULT 'warn',
  `is_active` tinyint(1) DEFAULT '1',
  `threshold_value` int DEFAULT '0',
  `notify_role` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `escalation_days` int DEFAULT '7',
  `auto_action` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `package_id` (`package_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `vdrl_alert_rules_ibfk_1` FOREIGN KEY (`package_id`) REFERENCES `vdrl_packages` (`id`),
  CONSTRAINT `vdrl_alert_rules_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vdrl_documents`
--

DROP TABLE IF EXISTS `vdrl_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vdrl_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `package_id` int NOT NULL,
  `doc_number` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `doc_type` enum('Drawing','Datasheet','Procedure','Certificate','Manual','Report','Calculation','Specification') COLLATE utf8mb4_unicode_ci NOT NULL,
  `discipline` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `revision` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT 'A',
  `purpose` enum('IFA','IFC','IFR','IFI','AFC') COLLATE utf8mb4_unicode_ci DEFAULT 'IFA',
  `status` enum('Not submitted','Under review','Approved','Overdue','Resubmit') COLLATE utf8mb4_unicode_ci DEFAULT 'Not submitted',
  `required_date` date DEFAULT NULL,
  `promised_date` date DEFAULT NULL,
  `submitted_date` date DEFAULT NULL,
  `abf_required` tinyint(1) DEFAULT '0',
  `abf_cleared` tinyint(1) DEFAULT '0',
  `cert_required` tinyint(1) DEFAULT '0',
  `mdr_required` tinyint(1) DEFAULT '1',
  `review_days` int DEFAULT '14',
  `transmittal_ref` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `spec_reference` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_number` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `po_line_ref` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `package_id` (`package_id`),
  KEY `created_by` (`created_by`),
  KEY `idx_vdrl_status` (`status`),
  CONSTRAINT `vdrl_documents_ibfk_1` FOREIGN KEY (`package_id`) REFERENCES `vdrl_packages` (`id`),
  CONSTRAINT `vdrl_documents_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vdrl_expediting_log`
--

DROP TABLE IF EXISTS `vdrl_expediting_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vdrl_expediting_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `package_id` int NOT NULL,
  `document_id` int DEFAULT NULL,
  `action_type` enum('desk-email','phone-call','formal-letter','field-visit','management-escalation') COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_date` date NOT NULL,
  `performed_by` int DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `new_promised_date` date DEFAULT NULL,
  `vendor_response` text COLLATE utf8mb4_unicode_ci,
  `escalation_level` enum('desk','field','management') COLLATE utf8mb4_unicode_ci DEFAULT 'desk',
  `visible_to_supplier` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `package_id` (`package_id`),
  KEY `document_id` (`document_id`),
  KEY `performed_by` (`performed_by`),
  CONSTRAINT `vdrl_expediting_log_ibfk_1` FOREIGN KEY (`package_id`) REFERENCES `vdrl_packages` (`id`),
  CONSTRAINT `vdrl_expediting_log_ibfk_2` FOREIGN KEY (`document_id`) REFERENCES `vdrl_documents` (`id`),
  CONSTRAINT `vdrl_expediting_log_ibfk_3` FOREIGN KEY (`performed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vdrl_mdr`
--

DROP TABLE IF EXISTS `vdrl_mdr`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vdrl_mdr` (
  `id` int NOT NULL AUTO_INCREMENT,
  `package_id` int NOT NULL,
  `document_id` int NOT NULL,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `asbuilt_rev` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `received_date` date DEFAULT NULL,
  `closeout_status` enum('Outstanding','Under review','Accepted','Rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'Outstanding',
  `certified` tinyint(1) DEFAULT '0',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `updated_by` int DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `package_id` (`package_id`),
  KEY `document_id` (`document_id`),
  KEY `updated_by` (`updated_by`),
  CONSTRAINT `vdrl_mdr_ibfk_1` FOREIGN KEY (`package_id`) REFERENCES `vdrl_packages` (`id`),
  CONSTRAINT `vdrl_mdr_ibfk_2` FOREIGN KEY (`document_id`) REFERENCES `vdrl_documents` (`id`),
  CONSTRAINT `vdrl_mdr_ibfk_3` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vdrl_packages`
--

DROP TABLE IF EXISTS `vdrl_packages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vdrl_packages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `po_id` int DEFAULT NULL,
  `package_ref` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vendor_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `po_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','active','closed') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `total_docs` int DEFAULT '0',
  `submitted` int DEFAULT '0',
  `overdue` int DEFAULT '0',
  `abf_total` int DEFAULT '0',
  `abf_cleared` int DEFAULT '0',
  `progress_pct` decimal(5,2) DEFAULT '0.00',
  `supplier_user_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `package_ref` (`package_ref`),
  KEY `project_id` (`project_id`),
  KEY `po_id` (`po_id`),
  KEY `supplier_user_id` (`supplier_user_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `vdrl_packages_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `vdrl_packages_ibfk_2` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `vdrl_packages_ibfk_3` FOREIGN KEY (`supplier_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `vdrl_packages_ibfk_4` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vdrl_review_comments`
--

DROP TABLE IF EXISTS `vdrl_review_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vdrl_review_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `document_id` int NOT NULL,
  `revision_id` int DEFAULT NULL,
  `comment_ref` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `comment_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `severity` enum('Hold','Minor','Info') COLLATE utf8mb4_unicode_ci DEFAULT 'Minor',
  `resolution` enum('Open','Closed') COLLATE utf8mb4_unicode_ci DEFAULT 'Open',
  `raised_by` int DEFAULT NULL,
  `supplier_response` text COLLATE utf8mb4_unicode_ci,
  `responded_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `document_id` (`document_id`),
  KEY `revision_id` (`revision_id`),
  KEY `raised_by` (`raised_by`),
  CONSTRAINT `vdrl_review_comments_ibfk_1` FOREIGN KEY (`document_id`) REFERENCES `vdrl_documents` (`id`),
  CONSTRAINT `vdrl_review_comments_ibfk_2` FOREIGN KEY (`revision_id`) REFERENCES `vdrl_revisions` (`id`),
  CONSTRAINT `vdrl_review_comments_ibfk_3` FOREIGN KEY (`raised_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vdrl_revisions`
--

DROP TABLE IF EXISTS `vdrl_revisions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vdrl_revisions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `document_id` int NOT NULL,
  `revision` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `submitted_by` int DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `review_code` enum('C1','C2','C3','C4') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewed_by` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `file_name` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_path` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `document_id` (`document_id`),
  KEY `submitted_by` (`submitted_by`),
  KEY `reviewed_by` (`reviewed_by`),
  CONSTRAINT `vdrl_revisions_ibfk_1` FOREIGN KEY (`document_id`) REFERENCES `vdrl_documents` (`id`),
  CONSTRAINT `vdrl_revisions_ibfk_2` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`),
  CONSTRAINT `vdrl_revisions_ibfk_3` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vdrl_transmittal_docs`
--

DROP TABLE IF EXISTS `vdrl_transmittal_docs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vdrl_transmittal_docs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `transmittal_id` int NOT NULL,
  `document_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `transmittal_id` (`transmittal_id`),
  KEY `document_id` (`document_id`),
  CONSTRAINT `vdrl_transmittal_docs_ibfk_1` FOREIGN KEY (`transmittal_id`) REFERENCES `vdrl_transmittals` (`id`),
  CONSTRAINT `vdrl_transmittal_docs_ibfk_2` FOREIGN KEY (`document_id`) REFERENCES `vdrl_documents` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vdrl_transmittals`
--

DROP TABLE IF EXISTS `vdrl_transmittals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vdrl_transmittals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `package_id` int NOT NULL,
  `transmittal_no` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `issued_date` date NOT NULL,
  `issued_by` int DEFAULT NULL,
  `to_contact_id` int DEFAULT NULL,
  `purpose` enum('IFA','IFC','IFR','IFI','AFC') COLLATE utf8mb4_unicode_ci DEFAULT 'IFA',
  `reply_required_by` date DEFAULT NULL,
  `status` enum('Awaiting reply','Reply received','Approved','Closed') COLLATE utf8mb4_unicode_ci DEFAULT 'Awaiting reply',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transmittal_no` (`transmittal_no`),
  KEY `package_id` (`package_id`),
  KEY `issued_by` (`issued_by`),
  KEY `to_contact_id` (`to_contact_id`),
  CONSTRAINT `vdrl_transmittals_ibfk_1` FOREIGN KEY (`package_id`) REFERENCES `vdrl_packages` (`id`),
  CONSTRAINT `vdrl_transmittals_ibfk_2` FOREIGN KEY (`issued_by`) REFERENCES `users` (`id`),
  CONSTRAINT `vdrl_transmittals_ibfk_3` FOREIGN KEY (`to_contact_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vendor_contacts`
--

DROP TABLE IF EXISTS `vendor_contacts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendor_contacts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `supplier_id` int NOT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `job_title` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mobile` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_vc_created` (`created_by`),
  KEY `fk_vc_updated` (`updated_by`),
  KEY `fk_vc_deleted` (`deleted_by`),
  KEY `idx_vc_supplier_id` (`supplier_id`),
  KEY `idx_vc_email` (`email`),
  KEY `idx_vc_is_active` (`is_active`),
  CONSTRAINT `fk_vc_created` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_vc_deleted` FOREIGN KEY (`deleted_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_vc_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`),
  CONSTRAINT `fk_vc_updated` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Vendor-side contacts per supplier. Not system users. Referenced by VDRL transmittals, proof of custody, SCN documents.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `warehouses`
--

DROP TABLE IF EXISTS `warehouses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `warehouses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` enum('laydown','store','consolidation','port','site') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'store',
  `capacity` decimal(15,2) DEFAULT NULL,
  `capacity_unit` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_dg_rated` tinyint(1) NOT NULL DEFAULT '0',
  `is_secured` tinyint(1) NOT NULL DEFAULT '1',
  `is_climate_controlled` tinyint(1) NOT NULL DEFAULT '0',
  `default_zone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `operating_hours` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `manager` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lifting_capability` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `state` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `postcode` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `fk_warehouses_created_by` (`created_by`),
  CONSTRAINT `fk_warehouses_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wbs_nodes`
--

DROP TABLE IF EXISTS `wbs_nodes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wbs_nodes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `parent_id` int DEFAULT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `discipline` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ros_date` date DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `owner_id` int DEFAULT NULL,
  `planned_start` date DEFAULT NULL,
  `planned_end` date DEFAULT NULL,
  `rag` enum('green','amber','red','blue') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wbs_owner` (`owner_id`),
  KEY `idx_wbs_project` (`project_id`),
  KEY `idx_wbs_parent` (`parent_id`),
  KEY `idx_wbs_code` (`code`),
  CONSTRAINT `fk_wbs_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `wbs_nodes_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `wbs_nodes_ibfk_2` FOREIGN KEY (`parent_id`) REFERENCES `wbs_nodes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-30 10:53:40
