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
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-30 10:24:09
