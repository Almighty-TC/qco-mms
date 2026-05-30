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
-- Dumping data for table `acronyms`
--

LOCK TABLES `acronyms` WRITE;
/*!40000 ALTER TABLE `acronyms` DISABLE KEYS */;
INSERT INTO `acronyms` VALUES (1,'PO','Purchase Order','Procurement',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(2,'SCN','Shipment Control Note','Expediting',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(3,'VDRL','Vendor Document Requirements List','VDRL',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(4,'MTO','Material Take Off','Foundational',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(5,'WBS','Work Breakdown Structure','Foundational',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(6,'ROS','Required on Site','Foundational',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(7,'FMR','Field Material Requisition','Material Control',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(8,'AVL','Approved Vendor List','Admin',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(9,'ITP','Inspection Test Plan','Traceability',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(10,'MDR','Master Document Register','VDRL',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(11,'QA','Quality Assurance','Traceability',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(12,'QC','Quality Control','Traceability',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(13,'FAT','Factory Acceptance Test','Expediting',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(14,'SAT','Site Acceptance Test','Expediting',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(15,'NCR','Non-Conformance Report','Traceability',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(16,'RFI','Request for Information','Procurement',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(17,'BL','Bill of Lading','Logistics',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(18,'AWB','Air Waybill','Logistics',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(19,'COO','Certificate of Origin','Logistics',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(20,'MR','Material Requisition','Procurement',NULL,'2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03');
/*!40000 ALTER TABLE `acronyms` ENABLE KEYS */;
UNLOCK TABLES;

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
  CONSTRAINT `fk_audit_log_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_log`
--

LOCK TABLES `audit_log` WRITE;
/*!40000 ALTER TABLE `audit_log` DISABLE KEYS */;
INSERT INTO `audit_log` VALUES (1,4,'override.batch',NULL,NULL,NULL,NULL,NULL,NULL,'user=4 count=1','::1','2026-05-29 01:18:07'),(2,4,'override.reset',NULL,NULL,NULL,NULL,NULL,NULL,'user=4','::1','2026-05-29 01:18:07'),(3,4,'override.batch',NULL,NULL,NULL,NULL,NULL,NULL,'user=4 count=1','::1','2026-05-29 01:23:25'),(4,4,'override.reset',NULL,NULL,NULL,NULL,NULL,NULL,'user=4','::1','2026-05-29 01:23:25'),(5,4,'override.batch',NULL,NULL,NULL,NULL,NULL,NULL,'user=37 count=1','::1','2026-05-29 03:33:58'),(6,4,'override.batch',NULL,NULL,NULL,NULL,NULL,NULL,'user=37 count=1','::1','2026-05-29 03:34:03'),(7,4,'override.batch',NULL,NULL,NULL,NULL,NULL,NULL,'user=37 count=1','::1','2026-05-29 03:34:34'),(8,4,'override.reset',NULL,NULL,NULL,NULL,NULL,NULL,'user=37','::1','2026-05-29 03:34:55'),(9,4,'override.batch',NULL,NULL,NULL,NULL,NULL,NULL,'user=37 count=0','::1','2026-05-29 03:34:58'),(10,4,'permissions.update',NULL,NULL,NULL,NULL,NULL,NULL,'role=procurement_officer module=logistics','::1','2026-05-29 03:35:17'),(11,4,'override.reset',NULL,NULL,NULL,NULL,NULL,NULL,'user=37','::1','2026-05-29 05:46:15');
/*!40000 ALTER TABLE `audit_log` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `delegated_permissions`
--

LOCK TABLES `delegated_permissions` WRITE;
/*!40000 ALTER TABLE `delegated_permissions` DISABLE KEYS */;
/*!40000 ALTER TABLE `delegated_permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `expediting_register`
--

DROP TABLE IF EXISTS `expediting_register`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expediting_register` (
  `id` int NOT NULL AUTO_INCREMENT,
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
-- Dumping data for table `expediting_register`
--

LOCK TABLES `expediting_register` WRITE;
/*!40000 ALTER TABLE `expediting_register` DISABLE KEYS */;
/*!40000 ALTER TABLE `expediting_register` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `inco_terms`
--

LOCK TABLES `inco_terms` WRITE;
/*!40000 ALTER TABLE `inco_terms` DISABLE KEYS */;
INSERT INTO `inco_terms` VALUES (1,'EXW','Ex Works','Seller makes goods available at their premises. Buyer bears all costs and risks.','At sellers premises','Any mode','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(2,'FCA','Free Carrier','Seller delivers goods to named carrier. Risk transfers at point of delivery.','Named place of delivery','Any mode','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(3,'CPT','Carriage Paid To','Seller pays freight to named destination. Risk transfers to first carrier.','First carrier','Any mode','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(4,'CIP','Carriage and Insurance Paid To','Seller pays freight and insurance to named destination.','First carrier','Any mode','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(5,'DAP','Delivered at Place','Seller delivers goods ready for unloading at named destination.','Named destination','Any mode','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(6,'DPU','Delivered at Place Unloaded','Seller delivers and unloads goods at named destination.','Named destination after unloading','Any mode','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(7,'DDP','Delivered Duty Paid','Seller bears all costs including import duties to named destination.','Named destination','Any mode','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(8,'FAS','Free Alongside Ship','Seller delivers goods alongside vessel at named port.','Alongside vessel at named port','Sea and inland waterway','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(9,'FOB','Free On Board','Seller delivers on board vessel at named port. Risk transfers when goods on board.','On board vessel at named port','Sea and inland waterway','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(10,'CFR','Cost and Freight','Seller pays cost and freight to named destination port.','On board vessel','Sea and inland waterway','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(11,'CIF','Cost Insurance and Freight','Seller pays cost, insurance and freight to named destination port.','On board vessel','Sea and inland waterway','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03');
/*!40000 ALTER TABLE `inco_terms` ENABLE KEYS */;
UNLOCK TABLES;

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
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `password_history`
--

LOCK TABLES `password_history` WRITE;
/*!40000 ALTER TABLE `password_history` DISABLE KEYS */;
/*!40000 ALTER TABLE `password_history` ENABLE KEYS */;
UNLOCK TABLES;

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
  `uom_id` int DEFAULT NULL,
  `qty_allocated` decimal(10,3) DEFAULT '0.000',
  `qty_received` decimal(10,3) DEFAULT '0.000',
  `unit_price` decimal(15,4) DEFAULT NULL,
  `total_price` decimal(15,2) GENERATED ALWAYS AS ((`qty` * `unit_price`)) STORED,
  `ros_date` date DEFAULT NULL,
  `insp_type` enum('Class I','Class II','Class III') COLLATE utf8mb4_unicode_ci DEFAULT 'Class II',
  `cert_required` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vdrl_required` tinyint(1) DEFAULT '0',
  `status` enum('not-started','rfq','po-raised','in-production','shipped','received','closed') COLLATE utf8mb4_unicode_ci DEFAULT 'not-started',
  `rag` enum('red','amber','green','grey','blue') COLLATE utf8mb4_unicode_ci DEFAULT 'grey',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `po_id` (`po_id`),
  KEY `wbs_id` (`wbs_id`),
  KEY `fk_po_lines_uom_id` (`uom_id`),
  CONSTRAINT `fk_po_lines_uom_id` FOREIGN KEY (`uom_id`) REFERENCES `units_of_measure` (`id`),
  CONSTRAINT `po_lines_ibfk_1` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `po_lines_ibfk_2` FOREIGN KEY (`wbs_id`) REFERENCES `wbs_nodes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_lines`
--

LOCK TABLES `po_lines` WRITE;
/*!40000 ALTER TABLE `po_lines` DISABLE KEYS */;
INSERT INTO `po_lines` (`id`, `po_id`, `wbs_id`, `line_number`, `description`, `tag_number`, `qty`, `uom`, `uom_id`, `qty_allocated`, `qty_received`, `unit_price`, `ros_date`, `insp_type`, `cert_required`, `vdrl_required`, `status`, `rag`, `created_at`, `updated_at`) VALUES (1,1,NULL,'1','Main equipment unit',NULL,1.000,'EA',NULL,0.000,0.000,228000.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:08','2026-05-29 01:37:08'),(2,1,NULL,'2','Spare parts kit',NULL,1.000,'LOT',NULL,0.000,0.000,28500.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:08','2026-05-29 01:37:08'),(3,2,NULL,'1','Main equipment unit',NULL,1.000,'EA',NULL,0.000,0.000,1136000.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:08','2026-05-29 01:37:08'),(4,2,NULL,'2','Spare parts kit',NULL,1.000,'LOT',NULL,0.000,0.000,142000.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:08','2026-05-29 01:37:08'),(5,3,NULL,'1','Main equipment unit',NULL,1.000,'EA',NULL,0.000,0.000,156000.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:09','2026-05-29 01:37:09'),(6,3,NULL,'2','Spare parts kit',NULL,1.000,'LOT',NULL,0.000,0.000,19500.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:09','2026-05-29 01:37:09'),(7,4,NULL,'1','Main equipment unit',NULL,1.000,'EA',NULL,0.000,0.000,696000.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:09','2026-05-29 01:37:09'),(8,4,NULL,'2','Spare parts kit',NULL,1.000,'LOT',NULL,0.000,0.000,87000.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:09','2026-05-29 01:37:09'),(9,5,NULL,'1','Main equipment unit',NULL,1.000,'EA',NULL,0.000,0.000,272000.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:09','2026-05-29 01:37:09'),(10,5,NULL,'2','Spare parts kit',NULL,1.000,'LOT',NULL,0.000,0.000,34000.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:09','2026-05-29 01:37:09'),(11,6,NULL,'1','Main equipment unit',NULL,1.000,'EA',NULL,0.000,0.000,100000.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:09','2026-05-29 01:37:09'),(12,6,NULL,'2','Spare parts kit',NULL,1.000,'LOT',NULL,0.000,0.000,12500.0000,NULL,'Class II',NULL,0,'not-started','grey','2026-05-29 01:37:09','2026-05-29 01:37:09');
/*!40000 ALTER TABLE `po_lines` ENABLE KEYS */;
UNLOCK TABLES;

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
  CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `projects`
--

LOCK TABLES `projects` WRITE;
/*!40000 ALTER TABLE `projects` DISABLE KEYS */;
INSERT INTO `projects` VALUES (1,'PRJ-2024-001','Pilbara Gas Processing Plant','Phase 2','active','red','Woodside Energy Ltd','2024-03-01','2026-09-30',142,18,8,45.50,NULL,'2026-05-26 09:49:15','2026-05-28 16:43:28'),(2,'PRJ-2024-002','Hunter Valley Substation 132kV','Phase 1','active','amber','AGL Energy','2024-06-15','2025-12-31',67,4,0,62.00,NULL,'2026-05-26 09:49:15','2026-05-28 16:43:28'),(3,'PRJ-2023-008','Ord River Dam Upgrade','Phase 3','active','green','Snowy Hydro Ltd','2023-01-10','2025-06-30',89,1,0,88.50,NULL,'2026-05-26 09:49:15','2026-05-28 16:43:28'),(4,'PRJ-2025-001','Port Hedland LNG Terminal','Phase 1','active','blue','Santos Limited','2025-02-01','2027-03-31',12,0,0,12.00,NULL,'2026-05-26 09:49:15','2026-05-28 16:43:28');
/*!40000 ALTER TABLE `projects` ENABLE KEYS */;
UNLOCK TABLES;

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
  `status` enum('rfq','loa','po-raised','active','closed','cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'rfq',
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
  KEY `project_id` (`project_id`),
  KEY `created_by` (`created_by`),
  KEY `fk_po_supplier_id` (`supplier_id`),
  KEY `fk_po_inco_term_id` (`inco_term_id`),
  KEY `fk_po_warehouse_id` (`warehouse_id`),
  KEY `fk_po_owner_id` (`owner_id`),
  CONSTRAINT `fk_po_inco_term_id` FOREIGN KEY (`inco_term_id`) REFERENCES `inco_terms` (`id`),
  CONSTRAINT `fk_po_owner_id` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_po_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`),
  CONSTRAINT `fk_po_warehouse_id` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`),
  CONSTRAINT `purchase_orders_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `purchase_orders_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_orders`
--

LOCK TABLES `purchase_orders` WRITE;
/*!40000 ALTER TABLE `purchase_orders` DISABLE KEYS */;
INSERT INTO `purchase_orders` VALUES (1,1,'PO-2024-001','Control Valve Package','1.2.3','instrumentation','2025-06-30',25,1,1,NULL,NULL,NULL,NULL,NULL,'Emerson Electric',NULL,1,NULL,285000.00,'USD','po-raised','green','CIF',NULL,NULL,NULL,NULL,4,'2026-05-29 01:37:08','2026-05-29 01:37:08'),(2,1,'PO-2024-002','Structural Steel Supply','1.1.1','structural','2025-08-15',25,1,0,NULL,NULL,NULL,NULL,NULL,'BlueScope Steel',NULL,2,NULL,1420000.00,'AUD','active','green','EXW',NULL,NULL,NULL,NULL,4,'2026-05-29 01:37:08','2026-05-29 01:37:08'),(3,1,'PO-2024-003','HVAC Equipment','1.3.1','mechanical','2025-09-01',25,0,0,NULL,NULL,NULL,NULL,NULL,'Siemens Energy',NULL,3,NULL,195000.00,'EUR','rfq','green','DAP',NULL,NULL,NULL,NULL,4,'2026-05-29 01:37:08','2026-05-29 01:37:08'),(4,1,'PO-2024-004','MV Switchgear','1.4.2','electrical','2025-07-20',25,0,0,NULL,NULL,NULL,NULL,NULL,'ABB Australia',NULL,4,NULL,870000.00,'AUD','rfq','green','DDP',NULL,NULL,NULL,NULL,4,'2026-05-29 01:37:09','2026-05-29 01:37:09'),(5,2,'PO-2024-005','Pump Station Equipment','2.1.1','mechanical','2025-10-15',25,1,1,NULL,NULL,NULL,NULL,NULL,'Flowserve',NULL,5,NULL,340000.00,'USD','po-raised','green','FOB',NULL,NULL,NULL,NULL,4,'2026-05-29 01:37:09','2026-05-29 01:37:09'),(6,2,'PO-2024-006','Substation Protection Relays','2.2.3','electrical','2025-11-01',25,0,1,NULL,NULL,NULL,NULL,NULL,'Siemens Energy',NULL,3,NULL,125000.00,'EUR','closed','green','CIP',NULL,NULL,NULL,NULL,4,'2026-05-29 01:37:09','2026-05-29 01:37:09');
/*!40000 ALTER TABLE `purchase_orders` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `role_permissions`
--

LOCK TABLES `role_permissions` WRITE;
/*!40000 ALTER TABLE `role_permissions` DISABLE KEYS */;
INSERT INTO `role_permissions` VALUES (151,'admin','dashboard',1,1,1,1,1,0,1),(152,'admin','procurement',1,1,1,1,1,0,1),(153,'admin','expediting',1,1,1,1,1,0,1),(154,'admin','vdrl',1,1,1,1,1,0,1),(155,'admin','logistics',1,1,1,1,1,0,1),(156,'admin','material_control',1,1,1,1,1,0,1),(157,'admin','traceability',1,1,1,1,1,0,1),(158,'admin','document_inbox',1,1,1,1,1,0,1),(159,'admin','audit',1,1,1,1,1,0,1),(160,'admin','admin',1,1,1,1,1,0,1),(161,'ceo','dashboard',1,0,0,0,0,0,1),(162,'ceo','procurement',1,0,0,0,0,0,1),(163,'ceo','expediting',1,0,0,0,0,0,1),(164,'ceo','vdrl',1,0,0,0,0,0,1),(165,'ceo','logistics',1,0,0,0,0,0,1),(166,'ceo','material_control',1,0,0,0,0,0,1),(167,'ceo','traceability',1,0,0,0,0,0,1),(168,'ceo','document_inbox',1,0,0,0,0,0,1),(169,'ceo','audit',1,0,0,0,0,0,1),(170,'ceo','admin',1,0,0,0,0,0,1),(171,'director','dashboard',1,0,0,0,0,0,1),(172,'director','procurement',1,0,0,0,0,0,1),(173,'director','expediting',1,0,0,0,0,0,1),(174,'director','vdrl',1,0,0,0,0,0,1),(175,'director','logistics',1,0,0,0,0,0,1),(176,'director','material_control',1,0,0,0,0,0,1),(177,'director','traceability',1,0,0,0,0,0,1),(178,'director','document_inbox',1,0,0,0,0,0,1),(179,'director','audit',1,0,0,0,0,0,1),(180,'director','admin',1,0,0,0,0,0,1),(181,'project_director','dashboard',1,0,0,0,0,0,1),(182,'project_director','procurement',1,0,0,0,0,0,1),(183,'project_director','expediting',1,0,0,0,0,0,1),(184,'project_director','vdrl',1,0,0,0,0,0,1),(185,'project_director','logistics',1,0,0,0,0,0,1),(186,'project_director','material_control',1,0,0,0,0,0,1),(187,'project_director','traceability',1,0,0,0,0,0,1),(188,'project_director','document_inbox',1,0,0,0,0,0,1),(189,'project_director','audit',1,0,0,0,0,0,1),(190,'project_director','admin',0,0,0,0,0,0,1),(191,'project_manager','dashboard',1,0,0,0,0,0,1),(192,'project_manager','procurement',1,1,1,0,0,0,1),(193,'project_manager','expediting',1,1,1,0,0,0,1),(194,'project_manager','vdrl',1,1,1,0,0,0,1),(195,'project_manager','logistics',1,1,0,0,0,0,1),(196,'project_manager','material_control',1,0,0,0,0,0,1),(197,'project_manager','traceability',1,0,0,0,0,0,1),(198,'project_manager','document_inbox',1,1,0,0,0,0,1),(199,'project_manager','audit',0,0,0,0,0,0,1),(200,'project_manager','admin',0,0,0,0,0,0,1),(201,'procurement_manager','dashboard',1,0,0,0,0,0,1),(202,'procurement_manager','procurement',1,1,1,1,1,0,1),(203,'procurement_manager','expediting',1,0,0,0,0,0,1),(204,'procurement_manager','vdrl',1,1,0,0,0,0,1),(205,'procurement_manager','logistics',1,0,0,0,0,0,1),(206,'procurement_manager','material_control',0,0,0,0,0,0,1),(207,'procurement_manager','traceability',0,0,0,0,0,0,1),(208,'procurement_manager','document_inbox',1,1,0,0,0,0,1),(209,'procurement_manager','audit',1,0,0,0,0,0,1),(210,'procurement_manager','admin',0,0,0,0,0,0,1),(211,'procurement_officer','dashboard',1,0,0,0,0,0,0),(212,'procurement_officer','procurement',1,1,1,0,0,0,1),(213,'procurement_officer','expediting',1,0,0,0,0,0,1),(214,'procurement_officer','vdrl',1,1,0,0,0,0,1),(215,'procurement_officer','logistics',0,0,0,1,0,0,0),(216,'procurement_officer','material_control',0,0,0,0,0,0,1),(217,'procurement_officer','traceability',0,0,0,0,0,0,1),(218,'procurement_officer','document_inbox',1,0,0,0,0,0,1),(219,'procurement_officer','audit',0,0,0,0,0,0,1),(220,'procurement_officer','admin',0,0,0,0,0,0,1),(221,'expediting_manager','dashboard',1,0,0,0,0,0,1),(222,'expediting_manager','procurement',1,0,0,0,0,0,1),(223,'expediting_manager','expediting',1,1,1,1,1,0,1),(224,'expediting_manager','vdrl',1,1,1,0,0,0,1),(225,'expediting_manager','logistics',1,1,1,0,0,0,1),(226,'expediting_manager','material_control',0,0,0,0,0,0,1),(227,'expediting_manager','traceability',0,0,0,0,0,0,1),(228,'expediting_manager','document_inbox',1,1,1,0,0,0,1),(229,'expediting_manager','audit',1,0,0,0,0,0,1),(230,'expediting_manager','admin',0,0,0,0,0,0,1),(231,'expeditor','dashboard',1,0,0,0,0,0,1),(232,'expeditor','procurement',1,0,0,0,0,0,1),(233,'expeditor','expediting',1,1,1,0,0,0,1),(234,'expeditor','vdrl',1,1,0,0,0,0,1),(235,'expeditor','logistics',1,0,0,0,0,0,1),(236,'expeditor','material_control',0,0,0,0,0,0,1),(237,'expeditor','traceability',0,0,0,0,0,0,1),(238,'expeditor','document_inbox',1,1,0,0,0,0,1),(239,'expeditor','audit',0,0,0,0,0,0,1),(240,'expeditor','admin',0,0,0,0,0,0,1),(241,'logistics_manager','dashboard',1,0,0,0,0,0,1),(242,'logistics_manager','procurement',1,0,0,0,0,0,1),(243,'logistics_manager','expediting',1,0,0,0,0,0,1),(244,'logistics_manager','vdrl',0,0,0,0,0,0,1),(245,'logistics_manager','logistics',1,1,1,1,1,0,1),(246,'logistics_manager','material_control',1,1,1,0,0,0,1),(247,'logistics_manager','traceability',1,0,0,0,0,0,1),(248,'logistics_manager','document_inbox',1,1,1,0,0,0,1),(249,'logistics_manager','audit',0,0,0,0,0,0,1),(250,'logistics_manager','admin',0,0,0,0,0,0,1),(251,'warehouse','dashboard',1,0,0,0,0,0,1),(252,'warehouse','procurement',0,0,0,0,0,0,1),(253,'warehouse','expediting',0,0,0,0,0,0,1),(254,'warehouse','vdrl',0,0,0,0,0,0,1),(255,'warehouse','logistics',1,0,1,0,0,0,1),(256,'warehouse','material_control',1,1,1,1,0,0,1),(257,'warehouse','traceability',1,1,0,0,0,0,1),(258,'warehouse','document_inbox',1,0,0,0,0,0,1),(259,'warehouse','audit',0,0,0,0,0,0,1),(260,'warehouse','admin',0,0,0,0,0,0,1),(261,'vendor','dashboard',0,0,0,0,0,0,1),(262,'vendor','procurement',1,0,0,0,0,0,1),(263,'vendor','expediting',1,0,0,0,0,0,1),(264,'vendor','vdrl',1,1,0,0,0,0,1),(265,'vendor','logistics',0,0,0,0,0,0,1),(266,'vendor','material_control',0,0,0,0,0,0,1),(267,'vendor','traceability',0,0,0,0,0,0,1),(268,'vendor','document_inbox',1,1,0,0,0,0,1),(269,'vendor','audit',0,0,0,0,0,0,1),(270,'vendor','admin',0,0,0,0,0,0,1),(271,'freight_forwarder','dashboard',0,0,0,0,0,0,1),(272,'freight_forwarder','procurement',0,0,0,0,0,0,1),(273,'freight_forwarder','expediting',0,0,0,0,0,0,1),(274,'freight_forwarder','vdrl',0,0,0,0,0,0,1),(275,'freight_forwarder','logistics',1,0,1,0,0,0,1),(276,'freight_forwarder','material_control',0,0,0,0,0,0,1),(277,'freight_forwarder','traceability',0,0,0,0,0,0,1),(278,'freight_forwarder','document_inbox',1,1,0,0,0,0,1),(279,'freight_forwarder','audit',0,0,0,0,0,0,1),(280,'freight_forwarder','admin',0,0,0,0,0,0,1),(281,'site_contractor','dashboard',0,0,0,0,0,0,1),(282,'site_contractor','procurement',0,0,0,0,0,0,1),(283,'site_contractor','expediting',0,0,0,0,0,0,1),(284,'site_contractor','vdrl',0,0,0,0,0,0,1),(285,'site_contractor','logistics',0,0,0,0,0,0,1),(286,'site_contractor','material_control',1,0,0,0,0,0,1),(287,'site_contractor','traceability',1,0,0,0,0,0,1),(288,'site_contractor','document_inbox',1,0,0,0,0,0,1),(289,'site_contractor','audit',0,0,0,0,0,0,1),(290,'site_contractor','admin',0,0,0,0,0,0,1),(291,'subcontractor','dashboard',0,0,0,0,0,0,1),(292,'subcontractor','procurement',0,0,0,0,0,0,1),(293,'subcontractor','expediting',0,0,0,0,0,0,1),(294,'subcontractor','vdrl',0,0,0,0,0,0,1),(295,'subcontractor','logistics',0,0,0,0,0,0,1),(296,'subcontractor','material_control',1,0,0,0,0,0,1),(297,'subcontractor','traceability',0,0,0,0,0,0,1),(298,'subcontractor','document_inbox',1,0,0,0,0,0,1),(299,'subcontractor','audit',0,0,0,0,0,0,1),(300,'subcontractor','admin',0,0,0,0,0,0,1),(301,'viewer','dashboard',1,0,0,0,0,0,1),(302,'viewer','procurement',1,0,0,0,0,0,1),(303,'viewer','expediting',1,0,0,0,0,0,1),(304,'viewer','vdrl',1,0,0,0,0,0,1),(305,'viewer','logistics',1,0,0,0,0,0,1),(306,'viewer','material_control',1,0,0,0,0,0,1),(307,'viewer','traceability',1,0,0,0,0,0,1),(308,'viewer','document_inbox',1,0,0,0,0,0,1),(309,'viewer','audit',1,0,0,0,0,0,1),(310,'viewer','admin',0,0,0,0,0,0,1);
/*!40000 ALTER TABLE `role_permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `shipment_control_notes`
--

DROP TABLE IF EXISTS `shipment_control_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shipment_control_notes` (
  `id` int NOT NULL AUTO_INCREMENT,
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
  CONSTRAINT `shipment_control_notes_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `shipment_control_notes_ibfk_2` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `shipment_control_notes_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `shipment_control_notes`
--

LOCK TABLES `shipment_control_notes` WRITE;
/*!40000 ALTER TABLE `shipment_control_notes` DISABLE KEYS */;
/*!40000 ALTER TABLE `shipment_control_notes` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `supplier_addresses`
--

LOCK TABLES `supplier_addresses` WRITE;
/*!40000 ALTER TABLE `supplier_addresses` DISABLE KEYS */;
/*!40000 ALTER TABLE `supplier_addresses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `suppliers`
--

DROP TABLE IF EXISTS `suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `suppliers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
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
  CONSTRAINT `fk_suppliers_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `suppliers`
--

LOCK TABLES `suppliers` WRITE;
/*!40000 ALTER TABLE `suppliers` DISABLE KEYS */;
INSERT INTO `suppliers` VALUES (1,'Emerson Electric','EMR','USA','John Smith','john.smith@emerson.com','+1 314 553 2000',NULL,'active',NULL,'2026-05-27 19:51:32','2026-05-27 19:51:32'),(2,'BlueScope Steel','BLS','Australia','Procurement Team','procurement@bluescope.com','+61 2 9779 6111',NULL,'active',NULL,'2026-05-27 19:51:32','2026-05-27 19:51:32'),(3,'Siemens Energy','SIE','Germany','Hans Mueller','h.mueller@siemens-energy.com','+49 911 654 0',NULL,'active',NULL,'2026-05-27 19:51:32','2026-05-27 19:51:32'),(4,'ABB Australia','ABB','Australia','Sales Team','sales@au.abb.com','+61 2 9466 2000',NULL,'active',NULL,'2026-05-27 19:51:32','2026-05-27 19:51:32'),(5,'Flowserve','FLO','USA','Sales Team','sales@flowserve.com','+1 972 443 6500',NULL,'active',NULL,'2026-05-27 19:51:32','2026-05-27 19:51:32'),(6,'Tyco Valves','TYC','Australia','Info Team','info@tyco.com.au','+61 2 8870 5000',NULL,'active',NULL,'2026-05-27 19:51:32','2026-05-27 19:51:32');
/*!40000 ALTER TABLE `suppliers` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `system_settings`
--

LOCK TABLES `system_settings` WRITE;
/*!40000 ALTER TABLE `system_settings` DISABLE KEYS */;
INSERT INTO `system_settings` VALUES ('access_expiry_warning_days','30,14,7,1','2026-05-27 19:52:14'),('escalation_email','tchang@qcogroup.com.au, jneal@qcogroup.com.au','2026-05-28 00:41:06'),('external_user_approval_required','1','2026-05-28 00:41:06'),('min_admins_required','1','2026-05-28 00:41:06'),('password_expiry_days_external','30','2026-05-27 19:52:14'),('password_expiry_days_internal','90','2026-05-27 19:52:14'),('system_name','QCO Group MMS','2026-05-28 00:38:17');
/*!40000 ALTER TABLE `system_settings` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `units_of_measure`
--

LOCK TABLES `units_of_measure` WRITE;
/*!40000 ALTER TABLE `units_of_measure` DISABLE KEYS */;
INSERT INTO `units_of_measure` VALUES (1,'EA','Each','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(2,'NR','Number','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(3,'KG','Kilogram','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(4,'T','Tonne','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(5,'M','Metre','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(6,'MM','Millimetre','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(7,'M2','Square Metre','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(8,'M3','Cubic Metre','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(9,'L','Litre','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(10,'KL','Kilolitre','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(11,'SET','Set','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(12,'LOT','Lot','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(13,'PR','Pair','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(14,'LM','Linear Metre','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03'),(15,'KN','Kilonewton','active','2026-05-27 19:51:32',NULL,'2026-05-29 00:11:03');
/*!40000 ALTER TABLE `units_of_measure` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `user_permission_overrides`
--

LOCK TABLES `user_permission_overrides` WRITE;
/*!40000 ALTER TABLE `user_permission_overrides` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_permission_overrides` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `user_project_access`
--

LOCK TABLES `user_project_access` WRITE;
/*!40000 ALTER TABLE `user_project_access` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_project_access` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `user_wbs_access`
--

LOCK TABLES `user_wbs_access` WRITE;
/*!40000 ALTER TABLE `user_wbs_access` DISABLE KEYS */;
INSERT INTO `user_wbs_access` VALUES (1,30,1,'ALL',1,'2026-05-28 16:43:28'),(2,33,2,'ALL',1,'2026-05-28 16:43:28'),(3,33,4,'ALL',1,'2026-05-28 16:43:28'),(4,31,2,'ALL',1,'2026-05-28 16:43:28'),(5,31,4,'ALL',1,'2026-05-28 16:43:28'),(6,32,1,'ALL',1,'2026-05-28 16:43:28'),(7,32,3,'ALL',1,'2026-05-28 16:43:28'),(8,34,4,'ALL',1,'2026-05-28 16:43:28'),(9,60,1,'ALL',1,'2026-05-28 23:59:56'),(10,61,2,'ALL',1,'2026-05-28 23:59:56'),(11,62,3,'ALL',1,'2026-05-28 23:59:56'),(12,63,4,'ALL',1,'2026-05-28 23:59:56');
/*!40000 ALTER TABLE `user_wbs_access` ENABLE KEYS */;
UNLOCK TABLES;

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
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=72 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'admin@qco.com.au',NULL,'$2b$12$4FNfrUnUzsblTeVvE0PRCOC36v5MkWWbBmZw3EDL/TeWvqeXW1xfS','Admin User','AU','admin',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,NULL,1,'2026-05-26 14:42:53','2026-05-26 09:49:15','2026-05-28 21:05:41',1,'2026-08-26 10:08:02',0,NULL),(2,'j.morrison@qco.com.au',NULL,'$2b$10$Xm9H1xNT51CnveWug6XBB.hVa4CaVZBt/thxeVoPrBFYb2IfxUilK','J. Morrison','JM','expeditor',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,NULL,1,NULL,'2026-05-26 09:49:15','2026-05-28 21:05:41',0,NULL,0,NULL),(3,'h.mueller@siemens-energy.com',NULL,'$2b$10$Xm9H1xNT51CnveWug6XBB.hVa4CaVZBt/thxeVoPrBFYb2IfxUilK','Hans Mueller','HM','vendor',1,NULL,NULL,NULL,NULL,'Siemens Energy',NULL,NULL,NULL,1,NULL,'2026-05-26 09:49:15','2026-05-28 23:12:52',0,NULL,0,NULL),(4,'tchang@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Thomas Chang','TC','admin',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 403 285 201',1,'2026-05-29 20:03:27','2026-05-27 02:36:16','2026-05-29 20:03:27',0,NULL,0,NULL),(5,'sarah.johnson@qcogroup.com.au',NULL,'$2b$10$Xm9H1xNT51CnveWug6XBB.hVa4CaVZBt/thxeVoPrBFYb2IfxUilK','Sarah Johnson',NULL,'procurement_manager',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 412 345 678',1,NULL,'2026-05-27 19:51:31','2026-05-28 21:05:41',0,NULL,0,NULL),(6,'mike.thompson@qcogroup.com.au',NULL,'$2b$12$GFyZVVGj2OH6V7V3zVMzROSA0obqB.uJyO9mPHSTR6lXy.k8p2//W','Mike Thompson',NULL,'expediting_manager',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 423 456 789',1,NULL,'2026-05-27 19:51:31','2026-05-28 21:05:41',1,'2026-08-26 10:32:45',0,NULL),(7,'lisa.chen@qcogroup.com.au',NULL,'$2b$10$Xm9H1xNT51CnveWug6XBB.hVa4CaVZBt/thxeVoPrBFYb2IfxUilK','Lisa Chen',NULL,'warehouse',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 434 567 890',1,NULL,'2026-05-27 19:51:31','2026-05-28 21:05:41',0,NULL,0,NULL),(8,'james.wilson@steelco.com.au',NULL,'$2b$10$Xm9H1xNT51CnveWug6XBB.hVa4CaVZBt/thxeVoPrBFYb2IfxUilK','James Wilson',NULL,'vendor',1,NULL,NULL,NULL,NULL,'Steel Co',NULL,NULL,'+61 445 678 901',1,NULL,'2026-05-27 19:51:31','2026-05-28 23:12:52',0,NULL,0,NULL),(9,'emma.davis@freightfast.com.au',NULL,'$2b$10$Xm9H1xNT51CnveWug6XBB.hVa4CaVZBt/thxeVoPrBFYb2IfxUilK','Emma Davis',NULL,'freight_forwarder',1,NULL,NULL,NULL,NULL,'FreightFast',NULL,NULL,'+61 456 789 012',1,NULL,'2026-05-27 19:51:31','2026-05-28 23:12:52',0,NULL,0,NULL),(20,'gpolites@qcogroup.com.au',NULL,'$2b$12$X9cd4eF8bj.zYN9sFGFJF.6xLxLbWWk53kk5NZWJEmXk5hmWRJAUS','George Polites',NULL,'director',0,NULL,NULL,NULL,NULL,'QCO Group',NULL,NULL,NULL,1,NULL,'2026-05-28 16:05:41','2026-05-28 23:44:00',1,'2026-08-27 02:05:40',0,NULL),(21,'david.chen@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','David Chen',NULL,'ceo',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 000 001',1,NULL,'2026-05-28 16:42:31','2026-05-28 21:05:41',0,NULL,0,NULL),(22,'rachel.white@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Rachel White',NULL,'director',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 000 002',1,NULL,'2026-05-28 16:42:31','2026-05-28 21:05:41',0,NULL,0,NULL),(23,'paul.harris@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Paul Harris',NULL,'project_director',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 000 003',1,NULL,'2026-05-28 16:42:31','2026-05-28 21:05:41',0,NULL,0,NULL),(24,'kate.nguyen@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Kate Nguyen',NULL,'project_manager',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 000 004',1,NULL,'2026-05-28 16:42:31','2026-05-28 21:05:41',0,NULL,0,NULL),(25,'ben.smith@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Ben Smith',NULL,'procurement_officer',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 000 005',1,NULL,'2026-05-28 16:42:31','2026-05-28 21:05:41',0,NULL,0,NULL),(26,'tony.hall@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Tony Hall',NULL,'logistics_manager',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 000 006',1,NULL,'2026-05-28 16:42:31','2026-05-28 21:05:41',0,NULL,0,NULL),(27,'claire.wong@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Claire Wong',NULL,'viewer',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 000 007',1,NULL,'2026-05-28 16:42:31','2026-05-28 21:05:41',0,NULL,0,NULL),(28,'mark.jones@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Mark Jones',NULL,'expeditor',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 000 008',1,NULL,'2026-05-28 16:42:31','2026-05-28 21:05:41',0,NULL,0,NULL),(29,'peter.brown@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Peter Brown',NULL,'warehouse',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 000 009',1,NULL,'2026-05-28 16:42:31','2026-05-28 21:05:41',0,NULL,0,NULL),(30,'anna.petrova@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Anna Petrova',NULL,'project_manager',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 100 001',1,NULL,'2026-05-28 16:43:28','2026-05-28 21:05:41',0,NULL,0,NULL),(31,'james.okafor@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','James Okafor',NULL,'project_manager',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 100 002',1,NULL,'2026-05-28 16:43:28','2026-05-28 21:05:41',0,NULL,0,NULL),(32,'nina.walsh@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Nina Walsh',NULL,'expeditor',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 100 003',1,NULL,'2026-05-28 16:43:28','2026-05-28 21:05:41',0,NULL,0,NULL),(33,'carlos.reyes@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Carlos Reyes',NULL,'expeditor',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 100 004',1,NULL,'2026-05-28 16:43:28','2026-05-28 21:05:41',0,NULL,0,NULL),(34,'sophie.kim@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Sophie Kim',NULL,'site_contractor',1,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 100 005',1,NULL,'2026-05-28 16:43:28','2026-05-28 23:12:52',0,NULL,0,NULL),(35,'raj.patel@steelparts.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Raj Patel',NULL,'vendor',1,NULL,NULL,NULL,NULL,'Steel Parts Pty',NULL,NULL,'+61 400 100 006',1,NULL,'2026-05-28 16:43:28','2026-05-28 23:12:52',0,NULL,0,NULL),(36,'mei.lin@fastfreight.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Mei Lin',NULL,'freight_forwarder',1,NULL,NULL,NULL,NULL,'Fast Freight Pty',NULL,NULL,'+61 400 100 007',1,NULL,'2026-05-28 16:43:28','2026-05-28 23:12:52',0,NULL,0,NULL),(37,'alex.burns@qcogroup.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Alex Burns',NULL,'warehouse',0,NULL,NULL,NULL,NULL,'QCO Group','2024-01-01',NULL,'+61 400 100 008',1,NULL,'2026-05-28 16:43:28','2026-05-28 21:05:41',0,NULL,0,NULL),(56,'john.doe@supplier-abc.com',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','John Doe',NULL,'vendor',1,NULL,NULL,NULL,NULL,'Supplier ABC','2025-01-01','2026-12-31','+61 400 111 001',0,NULL,'2026-05-28 21:05:41','2026-05-28 21:05:41',0,NULL,0,NULL),(57,'mary.jones@techparts.com',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Mary Jones',NULL,'vendor',1,NULL,NULL,NULL,NULL,'Tech Parts Co','2024-06-01','2025-12-31','+61 400 111 002',0,NULL,'2026-05-28 21:05:41','2026-05-28 21:05:41',0,NULL,0,NULL),(58,'peter.chan@globalfreight.com',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Peter Chan',NULL,'freight_forwarder',1,NULL,NULL,NULL,NULL,'Global Freight','2025-03-01','2026-06-30','+61 400 111 003',0,NULL,'2026-05-28 21:05:41','2026-05-28 21:05:41',0,NULL,0,NULL),(59,'lisa.park@sitecontract.com',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Lisa Park',NULL,'site_contractor',1,NULL,NULL,NULL,NULL,'Site Contractors Pty Ltd','2025-07-01','2026-06-15','+61 400 111 004',0,NULL,'2026-05-28 21:05:41','2026-05-28 21:05:41',0,NULL,0,NULL),(60,'james.oconnor@pilbaragas.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','James O\'Connor',NULL,'project_manager',0,NULL,NULL,NULL,NULL,'Pilbara Gas Co','2024-01-01',NULL,'+61 400 200 001',1,NULL,'2026-05-28 23:40:52','2026-05-28 23:40:52',0,NULL,0,NULL),(61,'sarah.lim@huntervalley.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Sarah Lim',NULL,'project_director',0,NULL,NULL,NULL,NULL,'Hunter Valley Energy','2024-06-01',NULL,'+61 400 200 002',1,NULL,'2026-05-28 23:40:52','2026-05-28 23:40:52',0,NULL,0,NULL),(62,'david.nguyen@ordriver.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','David Nguyen',NULL,'viewer',0,NULL,NULL,NULL,NULL,'Ord River Authority','2023-01-01',NULL,'+61 400 200 003',1,NULL,'2026-05-28 23:40:53','2026-05-28 23:40:53',0,NULL,0,NULL),(63,'michelle.park@porthedland.com.au',NULL,'$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','Michelle Park',NULL,'project_manager',0,NULL,NULL,NULL,NULL,'Port Hedland LNG','2025-01-01',NULL,'+61 400 200 004',1,NULL,'2026-05-28 23:40:53','2026-05-28 23:40:53',0,NULL,0,NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `vdrl_alert_rules`
--

LOCK TABLES `vdrl_alert_rules` WRITE;
/*!40000 ALTER TABLE `vdrl_alert_rules` DISABLE KEYS */;
/*!40000 ALTER TABLE `vdrl_alert_rules` ENABLE KEYS */;
UNLOCK TABLES;

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
  CONSTRAINT `vdrl_documents_ibfk_1` FOREIGN KEY (`package_id`) REFERENCES `vdrl_packages` (`id`),
  CONSTRAINT `vdrl_documents_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `vdrl_documents`
--

LOCK TABLES `vdrl_documents` WRITE;
/*!40000 ALTER TABLE `vdrl_documents` DISABLE KEYS */;
/*!40000 ALTER TABLE `vdrl_documents` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `vdrl_expediting_log`
--

LOCK TABLES `vdrl_expediting_log` WRITE;
/*!40000 ALTER TABLE `vdrl_expediting_log` DISABLE KEYS */;
/*!40000 ALTER TABLE `vdrl_expediting_log` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `vdrl_mdr`
--

LOCK TABLES `vdrl_mdr` WRITE;
/*!40000 ALTER TABLE `vdrl_mdr` DISABLE KEYS */;
/*!40000 ALTER TABLE `vdrl_mdr` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `vdrl_packages`
--

LOCK TABLES `vdrl_packages` WRITE;
/*!40000 ALTER TABLE `vdrl_packages` DISABLE KEYS */;
/*!40000 ALTER TABLE `vdrl_packages` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `vdrl_review_comments`
--

LOCK TABLES `vdrl_review_comments` WRITE;
/*!40000 ALTER TABLE `vdrl_review_comments` DISABLE KEYS */;
/*!40000 ALTER TABLE `vdrl_review_comments` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `vdrl_revisions`
--

LOCK TABLES `vdrl_revisions` WRITE;
/*!40000 ALTER TABLE `vdrl_revisions` DISABLE KEYS */;
/*!40000 ALTER TABLE `vdrl_revisions` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `vdrl_transmittal_docs`
--

LOCK TABLES `vdrl_transmittal_docs` WRITE;
/*!40000 ALTER TABLE `vdrl_transmittal_docs` DISABLE KEYS */;
/*!40000 ALTER TABLE `vdrl_transmittal_docs` ENABLE KEYS */;
UNLOCK TABLES;

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
-- Dumping data for table `vdrl_transmittals`
--

LOCK TABLES `vdrl_transmittals` WRITE;
/*!40000 ALTER TABLE `vdrl_transmittals` DISABLE KEYS */;
/*!40000 ALTER TABLE `vdrl_transmittals` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `warehouses`
--

DROP TABLE IF EXISTS `warehouses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `warehouses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
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
-- Dumping data for table `warehouses`
--

LOCK TABLES `warehouses` WRITE;
/*!40000 ALTER TABLE `warehouses` DISABLE KEYS */;
INSERT INTO `warehouses` VALUES (1,'Perth Laydown Yard','PLY','123 Industrial Ave Perth WA','WA',NULL,NULL,NULL,NULL,NULL,'active',NULL,'2026-05-27 19:51:32','2026-05-27 19:51:32'),(2,'Brisbane Store','BRS','45 Port Rd Brisbane QLD','QLD',NULL,NULL,NULL,'Tiny Minds',NULL,'active',NULL,'2026-05-27 19:51:32','2026-05-29 00:49:51'),(3,'Site Laydown - Pilbara','SLP','Pilbara Gas Processing Plant Site','WA',NULL,NULL,NULL,NULL,NULL,'active',NULL,'2026-05-27 19:51:32','2026-05-27 19:51:32'),(4,'Melbourne Consolidation','MLC','78 Warehouse Dr Melbourne VIC','VIC',NULL,NULL,NULL,NULL,NULL,'active',NULL,'2026-05-27 19:51:32','2026-05-27 19:51:32'),(5,'Darwin Port Store','DPS','Darwin Port NT','NT',NULL,NULL,NULL,NULL,NULL,'active',NULL,'2026-05-27 19:51:32','2026-05-27 19:51:32');
/*!40000 ALTER TABLE `warehouses` ENABLE KEYS */;
UNLOCK TABLES;

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
  `sort_order` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `project_id` (`project_id`),
  KEY `parent_id` (`parent_id`),
  CONSTRAINT `wbs_nodes_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `wbs_nodes_ibfk_2` FOREIGN KEY (`parent_id`) REFERENCES `wbs_nodes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wbs_nodes`
--

LOCK TABLES `wbs_nodes` WRITE;
/*!40000 ALTER TABLE `wbs_nodes` DISABLE KEYS */;
/*!40000 ALTER TABLE `wbs_nodes` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-30 10:03:11
