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
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-30 10:24:29
