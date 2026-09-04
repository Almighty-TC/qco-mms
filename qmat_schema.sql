-- MySQL dump 10.13  Distrib 9.3.0, for macos14.7 (arm64)
--
-- Host: qcosystem.mysql.database.azure.com    Database: qmat
-- ------------------------------------------------------
-- Server version	8.0.45-azure

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
) ENGINE=InnoDB AUTO_INCREMENT=88 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `audit_checkpoint`
--

DROP TABLE IF EXISTS `audit_checkpoint`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_checkpoint` (
  `id` int NOT NULL AUTO_INCREMENT,
  `target` enum('audit_log','audit_review') COLLATE utf8mb4_unicode_ci NOT NULL,
  `through_id` int NOT NULL,
  `chain_head` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `row_count` int NOT NULL,
  `sealed_by` int DEFAULT NULL,
  `sealed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_ckpt_user` (`sealed_by`),
  KEY `idx_ckpt_target` (`target`,`id`),
  CONSTRAINT `fk_ckpt_user` FOREIGN KEY (`sealed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `row_hash` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created` (`created_at`),
  KEY `idx_audit_entity` (`entity_type`,`entity_id`),
  KEY `idx_audit_project` (`project_id`),
  CONSTRAINT `fk_audit_log_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_audit_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=579 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`QCO_admin`@`%`*/ /*!50003 TRIGGER `audit_log_bi` BEFORE INSERT ON `audit_log` FOR EACH ROW BEGIN
         IF NEW.created_at IS NULL THEN SET NEW.created_at = NOW(); END IF;
         SET NEW.row_hash = SHA2(CONCAT_WS('||', COALESCE(NEW.user_id,'∅'), COALESCE(NEW.action,'∅'), COALESCE(NEW.entity_type,'∅'), COALESCE(NEW.entity_id,'∅'), COALESCE(NEW.project_id,'∅'), COALESCE(NEW.before_value,'∅'), COALESCE(NEW.after_value,'∅'), COALESCE(NEW.reason_category,'∅'), COALESCE(NEW.reason_detail,'∅'), COALESCE(NEW.resource,'∅'), COALESCE(NEW.ip,'∅'), NEW.created_at), 256);
       END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`QCO_admin`@`%`*/ /*!50003 TRIGGER `audit_log_bu` BEFORE UPDATE ON `audit_log` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only (tamper-evidence)'; */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`QCO_admin`@`%`*/ /*!50003 TRIGGER `audit_log_bd` BEFORE DELETE ON `audit_log` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only (tamper-evidence)'; */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `audit_review`
--

DROP TABLE IF EXISTS `audit_review`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_review` (
  `id` int NOT NULL AUTO_INCREMENT,
  `audit_log_id` int NOT NULL,
  `reviewed_by` int NOT NULL,
  `reviewed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `review_status` enum('reviewed','flagged') COLLATE utf8mb4_unicode_ci NOT NULL,
  `review_note` text COLLATE utf8mb4_unicode_ci,
  `row_hash` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_ar_user` (`reviewed_by`),
  KEY `idx_ar_latest` (`audit_log_id`,`reviewed_at`),
  KEY `idx_ar_status` (`review_status`),
  CONSTRAINT `fk_ar_audit` FOREIGN KEY (`audit_log_id`) REFERENCES `audit_log` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ar_user` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`QCO_admin`@`%`*/ /*!50003 TRIGGER `audit_review_bi` BEFORE INSERT ON `audit_review` FOR EACH ROW BEGIN
         IF NEW.reviewed_at IS NULL THEN SET NEW.reviewed_at = NOW(); END IF;
         SET NEW.row_hash = SHA2(CONCAT_WS('||', COALESCE(NEW.audit_log_id,'∅'), COALESCE(NEW.reviewed_by,'∅'), COALESCE(NEW.review_status,'∅'), COALESCE(NEW.review_note,'∅'), NEW.reviewed_at), 256);
       END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`QCO_admin`@`%`*/ /*!50003 TRIGGER `audit_review_bu` BEFORE UPDATE ON `audit_review` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_review is append-only (tamper-evidence)'; */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`QCO_admin`@`%`*/ /*!50003 TRIGGER `audit_review_bd` BEFORE DELETE ON `audit_review` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_review is append-only (tamper-evidence)' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `bafo_exchanges`
--

DROP TABLE IF EXISTS `bafo_exchanges`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bafo_exchanges` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bafo_id` int NOT NULL,
  `bid_id` int NOT NULL,
  `revised_value` decimal(15,2) NOT NULL,
  `note` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `logged_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bafoex_bafo` (`bafo_id`),
  KEY `idx_bafoex_bid` (`bid_id`),
  KEY `fk_bafoex_logged_by` (`logged_by`),
  CONSTRAINT `fk_bafoex_bafo` FOREIGN KEY (`bafo_id`) REFERENCES `tender_bafo` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bafoex_bid` FOREIGN KEY (`bid_id`) REFERENCES `tender_bids` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bafoex_logged_by` FOREIGN KEY (`logged_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `commodity_library`
--

DROP TABLE IF EXISTS `commodity_library`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `commodity_library` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'EA',
  `wbs_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wbs_node_id` int DEFAULT NULL,
  `estimated_qty` decimal(12,3) DEFAULT NULL,
  `trace_level` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'None',
  `preservation` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'None',
  `preferred_vendor` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `status` enum('active','inactive') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comm_code_proj` (`project_id`,`code`),
  KEY `idx_comm_project` (`project_id`),
  KEY `idx_comm_wbs_node` (`wbs_node_id`),
  CONSTRAINT `fk_comm_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8285 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `container_types`
--

DROP TABLE IF EXISTS `container_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `container_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `outer_length_mm` decimal(10,2) DEFAULT NULL,
  `outer_width_mm` decimal(10,2) DEFAULT NULL,
  `outer_height_mm` decimal(10,2) DEFAULT NULL,
  `inner_length_mm` decimal(10,2) DEFAULT NULL,
  `inner_width_mm` decimal(10,2) DEFAULT NULL,
  `inner_height_mm` decimal(10,2) DEFAULT NULL,
  `tare_weight_kg` decimal(10,2) DEFAULT NULL,
  `capacity_m3` decimal(10,3) DEFAULT NULL,
  `max_payload_kg` decimal(10,2) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `currencies`
--

DROP TABLE IF EXISTS `currencies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `currencies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `symbol` varchar(5) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
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
) ENGINE=InnoDB AUTO_INCREMENT=1134 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='General-purpose date change audit log. Covers ROS, ETA, ETD, contract dates across all entities.';
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
-- Table structure for table `equipment_list`
--

DROP TABLE IF EXISTS `equipment_list`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `equipment_list` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `tag` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `equipment_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Vessel',
  `wbs_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wbs_node_id` int DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `area_location` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `criticality` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'C-Standard',
  `spec` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `trace_class` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'None',
  `po_reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vendor` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `weight_kg` decimal(10,2) DEFAULT NULL,
  `size_lwh` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Not started',
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_equip_tag_proj` (`project_id`,`tag`),
  KEY `idx_equip_project` (`project_id`),
  KEY `idx_equip_wbs_node` (`wbs_node_id`),
  CONSTRAINT `fk_equip_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3426 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `expediting_child_items`
--

DROP TABLE IF EXISTS `expediting_child_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expediting_child_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_line_id` int NOT NULL,
  `sub_number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` decimal(15,4) DEFAULT NULL,
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cdd` date DEFAULT NULL,
  `forecast_ready_date` date DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'not_started',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `po_line_id` (`po_line_id`),
  CONSTRAINT `expediting_child_items_ibfk_1` FOREIGN KEY (`po_line_id`) REFERENCES `po_lines` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `expediting_forecast_history`
--

DROP TABLE IF EXISTS `expediting_forecast_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expediting_forecast_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` int NOT NULL,
  `field_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `old_value` date DEFAULT NULL,
  `new_value` date DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `changed_by` int NOT NULL,
  `changed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
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
-- Table structure for table `fmr_issue_lines`
--

DROP TABLE IF EXISTS `fmr_issue_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fmr_issue_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fmr_id` int NOT NULL,
  `fmr_line_id` int NOT NULL,
  `stock_id` int DEFAULT NULL,
  `qty` decimal(15,4) NOT NULL,
  `heat_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `item_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wbs_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `issued_by` int DEFAULT NULL,
  `issued_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fil_fmr` (`fmr_id`),
  KEY `idx_fil_line` (`fmr_line_id`),
  KEY `idx_fil_stock` (`stock_id`)
) ENGINE=InnoDB AUTO_INCREMENT=251 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fmr_lines`
--

DROP TABLE IF EXISTS `fmr_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fmr_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fmr_id` int NOT NULL,
  `item_id` int DEFAULT NULL,
  `item_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `item_type` enum('commodity','equipment') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'commodity',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wbs_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qty_requested` decimal(15,3) NOT NULL,
  `qty_issued` decimal(15,3) NOT NULL DEFAULT '0.000',
  `qty_approved` decimal(15,4) DEFAULT NULL,
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'EA',
  `line_status` enum('pending','approved','partially_approved','partial_issued','issued','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `approval_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approved_by` int DEFAULT NULL,
  `approved_date` datetime DEFAULT NULL,
  `ros_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `package_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_fmr_lines_fmr` (`fmr_id`),
  KEY `idx_fmrline_package` (`package_id`),
  CONSTRAINT `fk_fmr_lines_fmr` FOREIGN KEY (`fmr_id`) REFERENCES `fmr_requests` (`id`),
  CONSTRAINT `fk_fmrline_package` FOREIGN KEY (`package_id`) REFERENCES `fmr_packages` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=536 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fmr_packages`
--

DROP TABLE IF EXISTS `fmr_packages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fmr_packages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fmr_id` int NOT NULL,
  `package_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `package_type_id` int DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `length_mm` decimal(10,2) DEFAULT NULL,
  `width_mm` decimal(10,2) DEFAULT NULL,
  `height_mm` decimal(10,2) DEFAULT NULL,
  `gross_weight_kg` decimal(10,3) DEFAULT NULL,
  `net_weight_kg` decimal(10,3) DEFAULT NULL,
  `is_dangerous_goods` tinyint(1) DEFAULT '0',
  `dg_class` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dg_un_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `marks_numbers` text COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fmrpkg_fmr` (`fmr_id`),
  KEY `idx_fmrpkg_type` (`package_type_id`),
  CONSTRAINT `fk_fmrpkg_fmr` FOREIGN KEY (`fmr_id`) REFERENCES `fmr_requests` (`id`),
  CONSTRAINT `fk_fmrpkg_type` FOREIGN KEY (`package_type_id`) REFERENCES `package_types` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fmr_pickups`
--

DROP TABLE IF EXISTS `fmr_pickups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fmr_pickups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fmr_id` int NOT NULL,
  `collected_by_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `collected_by_company` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qty_issued` decimal(15,3) DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `signature_file` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `signature_mime` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `picked_up_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `issued_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fmrpickup_fmr` (`fmr_id`),
  CONSTRAINT `fk_fmrpickup_fmr` FOREIGN KEY (`fmr_id`) REFERENCES `fmr_requests` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fmr_requests`
--

DROP TABLE IF EXISTS `fmr_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fmr_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `warehouse_id` int DEFAULT NULL,
  `fmr_ref` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `item_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `wbs_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qty_requested` decimal(15,3) NOT NULL,
  `qty_issued` decimal(15,3) DEFAULT '0.000',
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'EA',
  `required_date` date DEFAULT NULL,
  `work_order_ref` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requested_by_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requested_by_company` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requested_by_user` int DEFAULT NULL,
  `status` enum('pending_approval','approved','partially_approved','partial_issued','issued','rejected','cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'pending_approval',
  `is_critical_path` tinyint(1) DEFAULT '0',
  `approved_by` int DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `approved_qty` decimal(15,3) DEFAULT NULL,
  `rejection_reason` text COLLATE utf8mb4_unicode_ci,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fmr_ref` (`fmr_ref`),
  KEY `project_id` (`project_id`),
  CONSTRAINT `fmr_requests_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=400 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `foundational_certificates`
--

DROP TABLE IF EXISTS `foundational_certificates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `foundational_certificates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity_type` enum('commodity','equipment') COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` int NOT NULL,
  `project_id` int NOT NULL,
  `cert_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ref_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `applies_to` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `issue_date` date DEFAULT NULL,
  `filename` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `status` enum('Verified','Pending QA','Rejected','Expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Pending QA',
  `uploaded_by` int DEFAULT NULL,
  `uploaded_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fcert_entity` (`entity_type`,`entity_id`),
  KEY `idx_fcert_project` (`project_id`),
  CONSTRAINT `fk_fcert_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=211 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `item_number` int DEFAULT '1',
  `timing` enum('pre_delivery','post_delivery') COLLATE utf8mb4_unicode_ci DEFAULT 'pre_delivery',
  `witness_required` tinyint(1) DEFAULT '0',
  `certificate_required` tinyint(1) DEFAULT '0',
  `planned_date` date DEFAULT NULL,
  `forecast_date` date DEFAULT NULL,
  `status` enum('not_started','in_progress','complete','on_hold','waived') COLLATE utf8mb4_unicode_ci DEFAULT 'not_started',
  `completion_date` date DEFAULT NULL,
  `completion_notes` text COLLATE utf8mb4_unicode_ci,
  `po_line_id` int DEFAULT NULL,
  `is_deleted` tinyint(1) DEFAULT '0',
  `notes` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `fk_itp_created` (`created_by`),
  KEY `idx_itp_po` (`po_id`),
  CONSTRAINT `fk_itp_created` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_itp_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Inspection and test plan requirements per PO. Links to itp_items for individual checklist entries.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `meeting_actions`
--

DROP TABLE IF EXISTS `meeting_actions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_actions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `record_id` int NOT NULL,
  `project_id` int NOT NULL,
  `seq` int NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `assigned_to` int DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `status` enum('open','in_progress','done','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `closed_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_record` (`record_id`),
  KEY `ix_proj_status` (`project_id`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=404 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `meeting_attendees`
--

DROP TABLE IF EXISTS `meeting_attendees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_attendees` (
  `id` int NOT NULL AUTO_INCREMENT,
  `record_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `attendee_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `attendee_org` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attended` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `ix_record` (`record_id`)
) ENGINE=InnoDB AUTO_INCREMENT=213 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
-- Table structure for table `mto_lines`
--

DROP TABLE IF EXISTS `mto_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mto_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `mto_id` int NOT NULL,
  `revision` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `line_number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `wbs_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(15,3) DEFAULT NULL,
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ros_date` date DEFAULT NULL,
  `inspection_class` enum('Class I','Class II','Class III') COLLATE utf8mb4_unicode_ci DEFAULT 'Class II',
  `vdrl_required` tinyint(1) DEFAULT '0',
  `po_ref` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('not-started','rfq','po-raised') COLLATE utf8mb4_unicode_ci DEFAULT 'not-started',
  `is_deleted` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `mto_id` (`mto_id`),
  CONSTRAINT `mto_lines_ibfk_1` FOREIGN KEY (`mto_id`) REFERENCES `mto_registers` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=24901 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mto_registers`
--

DROP TABLE IF EXISTS `mto_registers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mto_registers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `current_revision` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT 'A',
  `owner` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `status` enum('active','superseded') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `line_count` int DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `project_id` (`project_id`),
  CONSTRAINT `mto_registers_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=96 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mto_revisions`
--

DROP TABLE IF EXISTS `mto_revisions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mto_revisions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `mto_id` int NOT NULL,
  `revision` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `uploaded_by` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `line_count` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `file_path` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `mime_type` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `mto_id` (`mto_id`),
  CONSTRAINT `mto_revisions_ibfk_1` FOREIGN KEY (`mto_id`) REFERENCES `mto_registers` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=189 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=34 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `package_types`
--

DROP TABLE IF EXISTS `package_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `package_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pending_changes`
--

DROP TABLE IF EXISTS `pending_changes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pending_changes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `module` enum('wbs','commodity','equipment','mto') COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` int DEFAULT NULL,
  `action` enum('create','delete') COLLATE utf8mb4_unicode_ci NOT NULL,
  `proposed` json DEFAULT NULL,
  `before_value` json DEFAULT NULL,
  `is_baseline_major` tinyint(1) NOT NULL DEFAULT '0',
  `required_confirmer_role` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_id` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','confirmed','rejected','superseded') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `requested_by` int NOT NULL,
  `requested_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `confirmed_by` int DEFAULT NULL,
  `confirmed_at` datetime DEFAULT NULL,
  `confirm_comment` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `fk_pc_requester` (`requested_by`),
  KEY `fk_pc_confirmer` (`confirmed_by`),
  KEY `idx_pc_queue` (`project_id`,`module`,`status`),
  CONSTRAINT `fk_pc_confirmer` FOREIGN KEY (`confirmed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_pc_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_pc_requester` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Time-stamped action note feed per PO. is_internal controls vendor portal visibility.';
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
) ENGINE=InnoDB AUTO_INCREMENT=2217 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PO approval chain. Supports multi-step approval levels. Records every decision with timestamp.';
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
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Signed PO documents and amendments. Versioned — all prior versions retained for audit.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `po_expeditors`
--

DROP TABLE IF EXISTS `po_expeditors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `po_expeditors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_id` int NOT NULL,
  `user_id` int NOT NULL,
  `assigned_by` int DEFAULT NULL,
  `assigned_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_po_user` (`po_id`,`user_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_po` (`po_id`),
  CONSTRAINT `fk_poexp_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_poexp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=550 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
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
  `heat_number` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `forecast_ready_date` date DEFAULT NULL,
  `commodity_id` int DEFAULT NULL,
  `equipment_tag` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `equipment_tag_ref` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qty_assigned` decimal(15,4) DEFAULT '0.0000',
  PRIMARY KEY (`id`),
  KEY `fk_po_lines_uom_id` (`uom_id`),
  KEY `idx_pol_po` (`po_id`),
  KEY `idx_pol_wbs` (`wbs_id`),
  KEY `idx_pol_cdd` (`cdd`),
  KEY `idx_pol_tag` (`tag_number`),
  CONSTRAINT `fk_po_lines_uom_id` FOREIGN KEY (`uom_id`) REFERENCES `units_of_measure` (`id`),
  CONSTRAINT `po_lines_ibfk_1` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `po_lines_ibfk_2` FOREIGN KEY (`wbs_id`) REFERENCES `wbs_nodes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=17920 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `planned_date` date DEFAULT NULL,
  `forecast_changed_count` int DEFAULT '0',
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
) ENGINE=InnoDB AUTO_INCREMENT=13308 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Actual milestones per PO. Seeded from templates but fully editable. Drives the variable-length milestone progress bar.';
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
  `value_impact` decimal(15,2) DEFAULT NULL,
  `schedule_impact_days` int DEFAULT NULL,
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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Variation orders against a PO. Commercial and schedule impact tracked with full approval chain.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `project_health_history`
--

DROP TABLE IF EXISTS `project_health_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_health_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `score` tinyint unsigned NOT NULL,
  `recorded_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_proj_recorded` (`project_id`,`recorded_at`)
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `project_health_weights`
--

DROP TABLE IF EXISTS `project_health_weights`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_health_weights` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `module_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `weight` tinyint unsigned NOT NULL,
  `updated_by` int DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_proj_module` (`project_id`,`module_key`)
) ENGINE=InnoDB AUTO_INCREMENT=126 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `at_risk_days_threshold` int NOT NULL DEFAULT '30',
  `approval_threshold_1` decimal(15,2) DEFAULT NULL,
  `approval_threshold_2` decimal(15,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `created_by` (`created_by`),
  KEY `fk_proj_trace_set` (`traceability_set_by`),
  CONSTRAINT `fk_proj_trace_set` FOREIGN KEY (`traceability_set_by`) REFERENCES `users` (`id`),
  CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=28 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `tender_id` int DEFAULT NULL,
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
  `handover_point` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
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
  KEY `idx_po_tender` (`tender_id`),
  CONSTRAINT `fk_po_cp_set` FOREIGN KEY (`critical_path_set_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_po_exp_assigned` FOREIGN KEY (`expeditor_assigned_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_po_expeditor` FOREIGN KEY (`expeditor_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_po_inco_term_id` FOREIGN KEY (`inco_term_id`) REFERENCES `inco_terms` (`id`),
  CONSTRAINT `fk_po_owner_id` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_po_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`),
  CONSTRAINT `fk_po_tender` FOREIGN KEY (`tender_id`) REFERENCES `tender_packages` (`id`),
  CONSTRAINT `fk_po_warehouse_id` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`),
  CONSTRAINT `purchase_orders_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `purchase_orders_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2312 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `receipt_lines`
--

DROP TABLE IF EXISTS `receipt_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `receipt_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `scn_id` int NOT NULL,
  `scn_ref` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `po_line_id` int DEFAULT NULL,
  `additional_item_id` int DEFAULT NULL,
  `source_scn_package_id` int DEFAULT NULL,
  `scn_heat_id` int DEFAULT NULL,
  `heat_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `heat_off_list` tinyint(1) NOT NULL DEFAULT '0',
  `heat_off_list_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `expected_qty` decimal(15,4) DEFAULT NULL,
  `received_qty` decimal(15,4) NOT NULL,
  `damaged_qty` decimal(15,4) NOT NULL DEFAULT '0.0000',
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `discrepancy_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `discrepancy_notes` text COLLATE utf8mb4_unicode_ci,
  `received_by` int DEFAULT NULL,
  `received_date` date DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rl_scn` (`scn_id`),
  KEY `idx_rl_poline` (`po_line_id`),
  KEY `idx_rl_project` (`project_id`),
  KEY `idx_rl_additem` (`additional_item_id`),
  KEY `idx_rl_srcpkg` (`source_scn_package_id`),
  KEY `idx_rl_scnheat` (`scn_heat_id`),
  CONSTRAINT `fk_rl_additem` FOREIGN KEY (`additional_item_id`) REFERENCES `scn_additional_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rl_scnheat` FOREIGN KEY (`scn_heat_id`) REFERENCES `scn_heats` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rl_srcpkg` FOREIGN KEY (`source_scn_package_id`) REFERENCES `scn_packages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=5747 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rfi_meeting_records`
--

DROP TABLE IF EXISTS `rfi_meeting_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rfi_meeting_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `record_type` enum('rfi','meeting') COLLATE utf8mb4_unicode_ci NOT NULL,
  `ref` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `priority` enum('low','normal','high','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  `link_type` enum('project','wbs','po','scn') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'project',
  `link_id` int DEFAULT NULL,
  `link_label` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raised_by` int NOT NULL,
  `assigned_to` int DEFAULT NULL,
  `raised_date` date NOT NULL,
  `due_date` date DEFAULT NULL,
  `closed_date` date DEFAULT NULL,
  `response` text COLLATE utf8mb4_unicode_ci,
  `created_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ref` (`project_id`,`ref`),
  KEY `ix_proj_type_status` (`project_id`,`record_type`,`status`),
  KEY `ix_assignee` (`project_id`,`assigned_to`)
) ENGINE=InnoDB AUTO_INCREMENT=576 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=673 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `commodity_id` int DEFAULT NULL,
  `equipment_tag` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wbs_code_snapshot` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ros_date` date DEFAULT NULL,
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
  CONSTRAINT `fk_sai_parent` FOREIGN KEY (`parent_po_line_id`) REFERENCES `po_lines` (`id`),
  CONSTRAINT `fk_scnai_created` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_scnai_scn` FOREIGN KEY (`scn_id`) REFERENCES `shipment_control_notes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Off-PO items added to an SCN (consumables, packaging materials, etc. not on original PO lines).';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scn_documents`
--

DROP TABLE IF EXISTS `scn_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scn_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scn_id` int NOT NULL,
  `package_id` int DEFAULT NULL,
  `heat_id` int DEFAULT NULL,
  `document_type` enum('Commercial Invoice','Packing List','Bill of Lading','Airway Bill','Certificate of Origin','Insurance Certificate','Dangerous Goods Declaration','Customs Entry','Other','Proof of Custody','Mill Test Certificate') COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `uploaded_by` int DEFAULT NULL,
  `uploaded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `notes` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `scn_id` (`scn_id`),
  KEY `idx_scndocs_pkg` (`package_id`),
  KEY `idx_scndocs_heat` (`heat_id`),
  CONSTRAINT `fk_scndocs_heat` FOREIGN KEY (`heat_id`) REFERENCES `scn_heats` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_scndocs_pkg` FOREIGN KEY (`package_id`) REFERENCES `scn_packages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `scn_documents_ibfk_1` FOREIGN KEY (`scn_id`) REFERENCES `shipment_control_notes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1986 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scn_heats`
--

DROP TABLE IF EXISTS `scn_heats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scn_heats` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scn_id` int NOT NULL,
  `heat_number` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `material_grade` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mill_cert_ref` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `po_line_id` int DEFAULT NULL,
  `package_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_scn_heat` (`scn_id`,`heat_number`),
  KEY `idx_scn` (`scn_id`),
  KEY `idx_scnheats_pkg` (`package_id`),
  CONSTRAINT `fk_scn_heats_scn` FOREIGN KEY (`scn_id`) REFERENCES `shipment_control_notes` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_scnheats_pkg` FOREIGN KEY (`package_id`) REFERENCES `scn_packages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3733 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scn_lines`
--

DROP TABLE IF EXISTS `scn_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scn_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scn_id` int NOT NULL,
  `po_line_id` int DEFAULT NULL,
  `additional_item_id` int DEFAULT NULL,
  `qty` decimal(10,3) NOT NULL,
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_scnlines_poline` (`po_line_id`),
  KEY `fk_scnlines_additem` (`additional_item_id`),
  KEY `idx_scnlines_scn` (`scn_id`),
  CONSTRAINT `fk_scnlines_additem` FOREIGN KEY (`additional_item_id`) REFERENCES `scn_additional_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_scnlines_poline` FOREIGN KEY (`po_line_id`) REFERENCES `po_lines` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_scnlines_scn` FOREIGN KEY (`scn_id`) REFERENCES `shipment_control_notes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_scnlines_one_ref` CHECK (((`po_line_id` is not null) <> (`additional_item_id` is not null)))
) ENGINE=InnoDB AUTO_INCREMENT=65 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scn_package_lines`
--

DROP TABLE IF EXISTS `scn_package_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scn_package_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `package_id` int NOT NULL,
  `scn_line_id` int NOT NULL,
  `qty` decimal(10,3) NOT NULL,
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pkglines_pkg` (`package_id`),
  KEY `idx_pkglines_scnline` (`scn_line_id`),
  CONSTRAINT `fk_pkglines_pkg` FOREIGN KEY (`package_id`) REFERENCES `scn_packages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pkglines_scnline` FOREIGN KEY (`scn_line_id`) REFERENCES `scn_lines` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=59 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scn_packages`
--

DROP TABLE IF EXISTS `scn_packages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scn_packages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scn_id` int NOT NULL,
  `parent_package_id` int DEFAULT NULL,
  `container_type_id` int DEFAULT NULL,
  `container_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `seal_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `package_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `length_mm` decimal(10,2) DEFAULT NULL,
  `width_mm` decimal(10,2) DEFAULT NULL,
  `height_mm` decimal(10,2) DEFAULT NULL,
  `gross_weight_kg` decimal(10,3) DEFAULT NULL,
  `net_weight_kg` decimal(10,3) DEFAULT NULL,
  `is_dangerous_goods` tinyint(1) DEFAULT '0',
  `dg_class` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dg_un_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `marks_numbers` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `scn_id` (`scn_id`),
  KEY `idx_scnpkg_parent` (`parent_package_id`),
  KEY `idx_scnpkg_ctype` (`container_type_id`),
  CONSTRAINT `fk_scnpkg_ctype` FOREIGN KEY (`container_type_id`) REFERENCES `container_types` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_scnpkg_parent` FOREIGN KEY (`parent_package_id`) REFERENCES `scn_packages` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `scn_packages_ibfk_1` FOREIGN KEY (`scn_id`) REFERENCES `shipment_control_notes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2325 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scn_status_log`
--

DROP TABLE IF EXISTS `scn_status_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scn_status_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scn_id` int NOT NULL,
  `from_status` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_status` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `changed_by` int NOT NULL,
  `changed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `notes` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `scn_id` (`scn_id`),
  CONSTRAINT `scn_status_log_ibfk_1` FOREIGN KEY (`scn_id`) REFERENCES `shipment_control_notes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=45 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `packed_by_type` enum('internal','vendor','forwarder') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'internal',
  `packaging_delegated_to` int DEFAULT NULL,
  `packaging_status` enum('pending','complete') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `packaging_completed_at` datetime DEFAULT NULL,
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
  `cargo_ready_date` date DEFAULT NULL,
  `cargo_collection_date` date DEFAULT NULL,
  `etd` date DEFAULT NULL,
  `atd` date DEFAULT NULL,
  `eta` date DEFAULT NULL,
  `ata` date DEFAULT NULL,
  `customs_cleared` tinyint(1) NOT NULL DEFAULT '0',
  `customs_cleared_date` date DEFAULT NULL,
  `customs_cleared_by` int DEFAULT NULL,
  `status` enum('draft','pending','in-transit','customs_review','arrived','partially_received','received','closed','pending_pickup','in_transit','pending_delivery','delivered') COLLATE utf8mb4_unicode_ci DEFAULT 'draft',
  `mode` enum('air','sea','road','rail','courier','multi') COLLATE utf8mb4_unicode_ci DEFAULT 'sea',
  `transport_modes` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transport_mode_notes` text COLLATE utf8mb4_unicode_ci,
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
  KEY `idx_scn_pkg_delegate` (`packaging_delegated_to`),
  CONSTRAINT `fk_scn_dest_wh` FOREIGN KEY (`destination_warehouse_id`) REFERENCES `warehouses` (`id`),
  CONSTRAINT `fk_scn_forwarder` FOREIGN KEY (`forwarder_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_scn_notif_by` FOREIGN KEY (`forwarder_notified_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_scn_pkg_delegate` FOREIGN KEY (`packaging_delegated_to`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_scn_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`),
  CONSTRAINT `shipment_control_notes_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `shipment_control_notes_ibfk_2` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `shipment_control_notes_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2241 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type` enum('registered','remittance','shipping') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'registered',
  `address_line1` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address_line2` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `state` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `postcode` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_primary` tinyint(1) DEFAULT '0',
  `is_pickup` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `notes` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `supplier_id` (`supplier_id`),
  KEY `fk_sa_created_by` (`created_by`),
  CONSTRAINT `fk_sa_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_sa_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=163 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=345 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
-- Table structure for table `tender_approvals`
--

DROP TABLE IF EXISTS `tender_approvals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tender_approvals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tender_id` int NOT NULL,
  `approver_id` int NOT NULL,
  `approval_level` tinyint unsigned NOT NULL DEFAULT '1',
  `status` enum('pending','approved','rejected','unapproved') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `comments` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `actioned_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ta_tender` (`tender_id`),
  KEY `idx_ta_approver` (`approver_id`),
  KEY `idx_ta_status` (`status`),
  CONSTRAINT `fk_ta_approver` FOREIGN KEY (`approver_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_ta_tender` FOREIGN KEY (`tender_id`) REFERENCES `tender_packages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tender approval chain. Mirrors po_approvals — multi-step, threshold-gated (projects.approval_threshold_1/2), records every decision.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tender_bafo`
--

DROP TABLE IF EXISTS `tender_bafo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tender_bafo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tender_id` int NOT NULL,
  `mode` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `launched` tinyint(1) NOT NULL DEFAULT '0',
  `closed` tinyint(1) NOT NULL DEFAULT '0',
  `skipped` tinyint(1) NOT NULL DEFAULT '0',
  `close_date` date DEFAULT NULL,
  `shortlist_json` json DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bafo_tender` (`tender_id`),
  KEY `fk_bafo_created_by` (`created_by`),
  CONSTRAINT `fk_bafo_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_bafo_tender` FOREIGN KEY (`tender_id`) REFERENCES `tender_packages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_bafo_mode` CHECK ((`mode` in (_utf8mb4'formal',_utf8mb4'negotiation')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tender_bafo_commercial`
--

DROP TABLE IF EXISTS `tender_bafo_commercial`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tender_bafo_commercial` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bafo_id` int NOT NULL,
  `bid_id` int NOT NULL,
  `commercial_value` decimal(15,2) NOT NULL,
  `unsealed_at` datetime DEFAULT NULL,
  `unsealed_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bafo_commercial` (`bafo_id`,`bid_id`),
  KEY `idx_bafo_commercial_sealed` (`unsealed_at`),
  KEY `fk_bafo_commercial_bid` (`bid_id`),
  KEY `fk_bafo_commercial_unsealed_by` (`unsealed_by`),
  CONSTRAINT `fk_bafo_commercial_bafo` FOREIGN KEY (`bafo_id`) REFERENCES `tender_bafo` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bafo_commercial_bid` FOREIGN KEY (`bid_id`) REFERENCES `tender_bids` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bafo_commercial_unsealed_by` FOREIGN KEY (`unsealed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `chk_bafo_commercial_unseal_pair` CHECK ((((`unsealed_at` is null) and (`unsealed_by` is null)) or ((`unsealed_at` is not null) and (`unsealed_by` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tender_bid_commercial`
--

DROP TABLE IF EXISTS `tender_bid_commercial`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tender_bid_commercial` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bid_id` int NOT NULL,
  `commercial_value` decimal(15,2) NOT NULL,
  `unsealed_at` datetime DEFAULT NULL,
  `unsealed_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_commercial_bid` (`bid_id`),
  KEY `idx_commercial_sealed` (`unsealed_at`),
  KEY `fk_commercial_unsealed_by` (`unsealed_by`),
  CONSTRAINT `fk_commercial_bid` FOREIGN KEY (`bid_id`) REFERENCES `tender_bids` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_commercial_unsealed_by` FOREIGN KEY (`unsealed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `chk_commercial_unseal_pair` CHECK ((((`unsealed_at` is null) and (`unsealed_by` is null)) or ((`unsealed_at` is not null) and (`unsealed_by` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tender_bids`
--

DROP TABLE IF EXISTS `tender_bids`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tender_bids` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tender_id` int NOT NULL,
  `supplier_id` int NOT NULL,
  `round` tinyint NOT NULL DEFAULT '1',
  `submitted_at` datetime DEFAULT NULL,
  `currency` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'AUD',
  `tech_doc_count` int NOT NULL DEFAULT '0',
  `comm_doc_count` int NOT NULL DEFAULT '0',
  `prelim_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `prelim_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitted',
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bid_round` (`tender_id`,`supplier_id`,`round`),
  KEY `idx_bids_tender` (`tender_id`),
  KEY `idx_bids_supplier` (`supplier_id`),
  KEY `fk_bids_created_by` (`created_by`),
  CONSTRAINT `fk_bids_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_bids_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`),
  CONSTRAINT `fk_bids_tender` FOREIGN KEY (`tender_id`) REFERENCES `tender_packages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_bids_prelim` CHECK ((`prelim_status` in (_utf8mb4'pending',_utf8mb4'pass',_utf8mb4'fail'))),
  CONSTRAINT `chk_bids_status` CHECK ((`status` in (_utf8mb4'submitted',_utf8mb4'withdrawn',_utf8mb4'shortlisted',_utf8mb4'rejected')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tender_clarifications`
--

DROP TABLE IF EXISTS `tender_clarifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tender_clarifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tender_id` int NOT NULL,
  `ref` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `supplier_id` int DEFAULT NULL,
  `question` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `response` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `addendum` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `created_by` int DEFAULT NULL,
  `responded_by` int DEFAULT NULL,
  `responded_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_clar_ref` (`tender_id`,`ref`),
  KEY `idx_clar_tender` (`tender_id`),
  KEY `fk_clar_supplier` (`supplier_id`),
  KEY `fk_clar_created_by` (`created_by`),
  KEY `fk_clar_responded_by` (`responded_by`),
  CONSTRAINT `fk_clar_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_clar_responded_by` FOREIGN KEY (`responded_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_clar_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`),
  CONSTRAINT `fk_clar_tender` FOREIGN KEY (`tender_id`) REFERENCES `tender_packages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_clar_status` CHECK ((`status` in (_utf8mb4'open',_utf8mb4'answered')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tender_criteria`
--

DROP TABLE IF EXISTS `tender_criteria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tender_criteria` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tender_id` int NOT NULL,
  `criterion_key` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `weight` int NOT NULL,
  `mandatory` tinyint(1) NOT NULL DEFAULT '0',
  `min_score` int DEFAULT NULL,
  `display_order` int NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_criteria_key` (`tender_id`,`criterion_key`),
  KEY `idx_criteria_tender` (`tender_id`),
  CONSTRAINT `fk_criteria_tender` FOREIGN KEY (`tender_id`) REFERENCES `tender_packages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_criteria_min_score` CHECK (((`min_score` is null) or (`min_score` between 0 and 100))),
  CONSTRAINT `chk_criteria_weight` CHECK ((`weight` between 5 and 60))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tender_documents`
--

DROP TABLE IF EXISTS `tender_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tender_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tender_id` int NOT NULL,
  `doc_key` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `required` tinyint(1) NOT NULL DEFAULT '0',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `file_path` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `uploaded_by` int DEFAULT NULL,
  `uploaded_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_doc_key` (`tender_id`,`doc_key`),
  KEY `idx_docs_tender` (`tender_id`),
  KEY `fk_docs_uploaded_by` (`uploaded_by`),
  CONSTRAINT `fk_docs_tender` FOREIGN KEY (`tender_id`) REFERENCES `tender_packages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_docs_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`),
  CONSTRAINT `chk_docs_status` CHECK ((`status` in (_utf8mb4'pending',_utf8mb4'uploaded',_utf8mb4'waived')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tender_evaluations`
--

DROP TABLE IF EXISTS `tender_evaluations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tender_evaluations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tender_id` int NOT NULL,
  `bid_id` int NOT NULL,
  `tech_score` int DEFAULT NULL,
  `comm_score` int DEFAULT NULL,
  `combined_score` decimal(6,2) DEFAULT NULL,
  `rank_position` int DEFAULT NULL,
  `scores_json` json DEFAULT NULL,
  `evaluated_by` int DEFAULT NULL,
  `evaluated_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_eval_bid` (`bid_id`),
  KEY `idx_eval_tender` (`tender_id`),
  KEY `fk_eval_evaluated_by` (`evaluated_by`),
  CONSTRAINT `fk_eval_bid` FOREIGN KEY (`bid_id`) REFERENCES `tender_bids` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_eval_evaluated_by` FOREIGN KEY (`evaluated_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_eval_tender` FOREIGN KEY (`tender_id`) REFERENCES `tender_packages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_eval_comm` CHECK (((`comm_score` is null) or (`comm_score` between 0 and 100))),
  CONSTRAINT `chk_eval_tech` CHECK (((`tech_score` is null) or (`tech_score` between 0 and 100)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tender_packages`
--

DROP TABLE IF EXISTS `tender_packages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tender_packages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `ref` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `discipline` enum('mechanical','electrical','instrumentation','civil','piping','structural') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `procurement_mode` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `stage` enum('planning','prequalification','invitation','clarifications','tendering','evaluation','recommendation','award') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'planning',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `currency` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'AUD',
  `estimated_value` decimal(15,2) DEFAULT NULL,
  `wbs_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `owner_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tender_ref` (`project_id`,`ref`),
  KEY `idx_tenders_project` (`project_id`),
  KEY `idx_tenders_stage` (`stage`),
  KEY `idx_tenders_status` (`status`),
  KEY `fk_tenders_owner` (`owner_id`),
  KEY `fk_tenders_created_by` (`created_by`),
  CONSTRAINT `fk_tenders_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_tenders_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_tenders_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `chk_tenders_mode` CHECK ((`procurement_mode` in (_utf8mb4'private_negotiated',_utf8mb4'private_competitive',_utf8mb4'mdb_funded'))),
  CONSTRAINT `chk_tenders_status` CHECK ((`status` in (_utf8mb4'active',_utf8mb4'standstill',_utf8mb4'awarded',_utf8mb4'on_hold',_utf8mb4'cancelled')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tender_prequalifications`
--

DROP TABLE IF EXISTS `tender_prequalifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tender_prequalifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `supplier_id` int NOT NULL,
  `category` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `discipline` enum('mechanical','electrical','instrumentation','civil','piping','structural') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `round_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `valid_from` date DEFAULT NULL,
  `valid_to` date DEFAULT NULL,
  `notes` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_prequal_scope` (`project_id`,`supplier_id`,`category`),
  KEY `idx_prequal_project` (`project_id`),
  KEY `idx_prequal_supplier` (`supplier_id`),
  KEY `idx_prequal_round` (`round_status`),
  KEY `fk_prequal_created_by` (`created_by`),
  CONSTRAINT `fk_prequal_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_prequal_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_prequal_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`),
  CONSTRAINT `chk_prequal_round` CHECK ((`round_status` in (_utf8mb4'pending',_utf8mb4'qualified',_utf8mb4'conditional',_utf8mb4'not_qualified')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `traceability_cert_versions`
--

DROP TABLE IF EXISTS `traceability_cert_versions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `traceability_cert_versions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cert_id` int NOT NULL,
  `rev` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `heat_ref` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `applies_to` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `status` enum('pending','received','verified','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'verified',
  `created_by` int DEFAULT NULL,
  `created_by_name` varchar(180) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_date` datetime DEFAULT NULL,
  `verified_by_name` varchar(180) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tcv_cert` (`cert_id`)
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `traceability_certs`
--

DROP TABLE IF EXISTS `traceability_certs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `traceability_certs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `category` enum('vdrl','approval') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'vdrl',
  `po_id` int DEFAULT NULL,
  `po_ref` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vendor_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tag` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `document_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cert_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `item_scope` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `heat_ref` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `applies_to` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `issue_date` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `received_date` date DEFAULT NULL,
  `is_required` tinyint NOT NULL DEFAULT '1',
  `uploader` varchar(180) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `status` enum('pending','received','verified','rejected','overdue') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `priority` enum('normal','high') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  `uploaded_by` int DEFAULT NULL,
  `uploaded_date` datetime DEFAULT NULL,
  `verified_by` int DEFAULT NULL,
  `verified_date` datetime DEFAULT NULL,
  `reject_reason` text COLLATE utf8mb4_unicode_ci,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `file_path` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mime_type` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tc_project` (`project_id`),
  KEY `idx_tc_category` (`category`),
  KEY `idx_tc_status` (`status`),
  KEY `idx_tc_tag` (`tag`)
) ENGINE=InnoDB AUTO_INCREMENT=3618 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `traceability_chases`
--

DROP TABLE IF EXISTS `traceability_chases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `traceability_chases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `hold_id` int NOT NULL,
  `sent_email` tinyint NOT NULL DEFAULT '0',
  `recipient` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subject` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `body` text COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tch_hold` (`hold_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `traceability_holds`
--

DROP TABLE IF EXISTS `traceability_holds`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `traceability_holds` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `tag` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `item` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hold_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `since_date` date DEFAULT NULL,
  `age_days` int DEFAULT NULL,
  `chase_count` int NOT NULL DEFAULT '0',
  `related_cert_id` int DEFAULT NULL,
  `vendor_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vendor_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','released') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `released_by` int DEFAULT NULL,
  `released_date` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_th_project` (`project_id`),
  KEY `idx_th_status` (`status`),
  KEY `idx_th_tag` (`tag`)
) ENGINE=InnoDB AUTO_INCREMENT=216 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `traceability_trace_lifecycle`
--

DROP TABLE IF EXISTS `traceability_trace_lifecycle`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `traceability_trace_lifecycle` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `tag` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stage` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ref` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_date` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actor` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail` text COLLATE utf8mb4_unicode_ci,
  `node_state` enum('complete','warning','blocked','pending') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `badge` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_tl_project` (`project_id`),
  KEY `idx_tl_tag` (`tag`)
) ENGINE=InnoDB AUTO_INCREMENT=49 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=311 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=721 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `file_path` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `mime_type` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `package_id` (`package_id`),
  KEY `created_by` (`created_by`),
  KEY `idx_vdrl_status` (`status`),
  CONSTRAINT `vdrl_documents_ibfk_1` FOREIGN KEY (`package_id`) REFERENCES `vdrl_packages` (`id`),
  CONSTRAINT `vdrl_documents_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4235 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=1319 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
-- Table structure for table `warehouse_stock`
--

DROP TABLE IF EXISTS `warehouse_stock`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `warehouse_stock` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `warehouse_id` int NOT NULL,
  `scn_id` int DEFAULT NULL,
  `po_line_id` int DEFAULT NULL,
  `additional_item_id` int DEFAULT NULL,
  `receipt_line_id` int DEFAULT NULL,
  `commodity_id` int DEFAULT NULL,
  `equipment_tag` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `item_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `wbs_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qty` decimal(15,3) NOT NULL DEFAULT '0.000',
  `qty_available` decimal(15,3) NOT NULL DEFAULT '0.000',
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'EA',
  `location_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `condition_status` enum('good','minor_damage','major_damage','quarantine') COLLATE utf8mb4_unicode_ci DEFAULT 'good',
  `trace_hold` tinyint(1) DEFAULT '0',
  `vendor_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `heat_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `received_date` date DEFAULT NULL,
  `received_by` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `warehouse_id` (`warehouse_id`),
  KEY `idx_ws_proj_item` (`project_id`,`item_code`),
  KEY `idx_ws_additem` (`additional_item_id`),
  KEY `idx_ws_receiptline` (`receipt_line_id`),
  CONSTRAINT `fk_ws_additem` FOREIGN KEY (`additional_item_id`) REFERENCES `scn_additional_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ws_receiptline` FOREIGN KEY (`receipt_line_id`) REFERENCES `receipt_lines` (`id`) ON DELETE SET NULL,
  CONSTRAINT `warehouse_stock_ibfk_1` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`),
  CONSTRAINT `warehouse_stock_ibfk_2` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6041 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `warehouse_transfers`
--

DROP TABLE IF EXISTS `warehouse_transfers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `warehouse_transfers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `transfer_ref` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stock_id` int DEFAULT NULL,
  `item_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `wbs_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `heat_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qty` decimal(15,3) NOT NULL,
  `uom` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'EA',
  `from_warehouse_id` int DEFAULT NULL,
  `from_location` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_warehouse_id` int DEFAULT NULL,
  `to_location` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requested_by_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requested_by_company` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requested_by_user` int DEFAULT NULL,
  `status` enum('requested','pending_approval','in_transit','picked_up','delivered','complete','rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'requested',
  `approved_by` int DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `approval_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `est_pickup_date` date DEFAULT NULL,
  `actual_pickup_date` date DEFAULT NULL,
  `delivered_date` date DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `stock_moved_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transfer_ref` (`transfer_ref`),
  KEY `project_id` (`project_id`),
  KEY `from_warehouse_id` (`from_warehouse_id`),
  KEY `to_warehouse_id` (`to_warehouse_id`),
  CONSTRAINT `warehouse_transfers_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `warehouse_transfers_ibfk_2` FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses` (`id`),
  CONSTRAINT `warehouse_transfers_ibfk_3` FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=265 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `warehouses`
--

DROP TABLE IF EXISTS `warehouses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `warehouses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int DEFAULT NULL,
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
  KEY `idx_wh_project` (`project_id`),
  CONSTRAINT `fk_warehouses_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_wh_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=86 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `forecast_start` date DEFAULT NULL,
  `forecast_end` date DEFAULT NULL,
  `actual_start` date DEFAULT NULL,
  `actual_end` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wbs_owner` (`owner_id`),
  KEY `idx_wbs_project` (`project_id`),
  KEY `idx_wbs_parent` (`parent_id`),
  KEY `idx_wbs_code` (`code`),
  CONSTRAINT `fk_wbs_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `wbs_nodes_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `wbs_nodes_ibfk_2` FOREIGN KEY (`parent_id`) REFERENCES `wbs_nodes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2693 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed
