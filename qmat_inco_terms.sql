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
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-30 10:24:19
