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
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-30 10:24:39
