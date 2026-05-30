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
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-30 10:24:26
