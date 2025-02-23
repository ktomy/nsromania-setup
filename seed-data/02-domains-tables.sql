use nightscout;
CREATE TABLE if not exists `ns_domain` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `active` tinyint NOT NULL DEFAULT '1',
  `title` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `domain` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `port` int unsigned NOT NULL,
  `db_exists` tinyint NOT NULL DEFAULT '0',
  `api_secret` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `enable` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `show_plugins` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `mmconnect_username` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mmconnect_password` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mmconnect_server` char(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'EU',
  `bridge_username` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bridge_password` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bridge_server` char(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'EU',
  `created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_updated` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `db_password` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nsversion` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `auth_user_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ns_domain_domain_key` (`domain`),
  KEY `ns_domain_auth_user_id_fkey` (`auth_user_id`),
  CONSTRAINT `ns_domain_auth_user_id_fkey` FOREIGN KEY (`auth_user_id`) REFERENCES `auth_user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=372 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE if not exists `ns_domain_environment` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ns_domain_id` int unsigned NOT NULL,
  `variable` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` varchar(4096) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ns_domain_environment_ns_domain_id_fkey` (`ns_domain_id`),
  CONSTRAINT `ns_domain_environment_ns_domain_id_fkey` FOREIGN KEY (`ns_domain_id`) REFERENCES `ns_domain` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=633 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
