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
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-30 10:24:11
