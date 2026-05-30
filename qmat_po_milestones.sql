-- MySQL dump 10.13  Distrib 8.0.38, for macos14 (x86_64)
--
-- Host: qcosystem.mysql.database.azure.com    Database: qmat
-- ------------------------------------------------------
-- Server version	8.0.44-azure

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

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
-- Dumping data for table `po_milestones`
--

LOCK TABLES `po_milestones` WRITE;
/*!40000 ALTER TABLE `po_milestones` DISABLE KEYS */;
/*!40000 ALTER TABLE `po_milestones` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-30 10:24:28
