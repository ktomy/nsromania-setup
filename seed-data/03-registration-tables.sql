use nightscout;
CREATE TABLE if not exists `register_email_validation` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email_address` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `validation_code` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sent_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE if not exists `register_request` (
  `id` int NOT NULL AUTO_INCREMENT,
  `owner_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_email` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subdomain` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `api_secret` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `data_source` varchar(32) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `dexcom_server` varchar(2) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dexcom_username` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dexcom_password` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `requested_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `chnged_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `chnged_by` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `registe_rqus_auth_user_id_fk` (`chnged_by`),
  CONSTRAINT `registe_rqus_auth_user_id_fk` FOREIGN KEY (`chnged_by`) REFERENCES `auth_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
