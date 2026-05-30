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
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-30 10:24:16
