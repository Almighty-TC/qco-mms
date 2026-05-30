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
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-30 10:24:41
