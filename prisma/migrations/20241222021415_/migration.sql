-- CreateTable
CREATE TABLE `ns_domain` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `active` TINYINT NOT NULL DEFAULT 1,
    `title` VARCHAR(128) NOT NULL,
    `domain` VARCHAR(64) NOT NULL,
    `port` INTEGER UNSIGNED NOT NULL,
    `db_exists` TINYINT NOT NULL DEFAULT 0,
    `api_secret` VARCHAR(32) NOT NULL,
    `enable` VARCHAR(1024) NOT NULL,
    `show_plugins` VARCHAR(1024) NOT NULL,
    `mmconnect_username` VARCHAR(32) NULL,
    `mmconnect_password` VARCHAR(32) NULL,
    `mmconnect_server` CHAR(2) NULL DEFAULT 'EU',
    `bridge_username` VARCHAR(32) NULL,
    `bridge_password` VARCHAR(32) NULL,
    `bridge_server` CHAR(2) NULL DEFAULT 'EU',
    `created` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `last_updated` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `db_password` VARCHAR(64) NULL,
    `nsversion` VARCHAR(50) NULL,

    UNIQUE INDEX `ns_domain_domain_key`(`domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ns_domain_environment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ns_domain_id` INTEGER UNSIGNED NOT NULL,
    `variable` VARCHAR(128) NOT NULL,
    `value` VARCHAR(4096) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_user` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `username` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `email_verified` DATETIME(3) NULL,
    `image` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `auth_user_username_key`(`username`),
    UNIQUE INDEX `auth_user_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_account` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `provider_account_id` VARCHAR(191) NOT NULL,
    `refresh_token` TEXT NULL,
    `access_token` TEXT NULL,
    `expires_at` INTEGER NULL,
    `token_type` VARCHAR(191) NULL,
    `scope` VARCHAR(191) NULL,
    `id_token` TEXT NULL,
    `session_state` VARCHAR(191) NULL,
    `refresh_token_expires_in` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `auth_account_user_id_idx`(`user_id`),
    UNIQUE INDEX `auth_account_provider_provider_account_id_key`(`provider`, `provider_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_session` (
    `id` VARCHAR(191) NOT NULL,
    `session_token` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `expires` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `auth_session_session_token_key`(`session_token`),
    INDEX `auth_session_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_verification_token` (
    `identifier` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `expires` DATETIME(3) NOT NULL,

    UNIQUE INDEX `auth_verification_token_identifier_token_key`(`identifier`, `token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_authenticator` (
    `credential_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `provider_account_id` VARCHAR(191) NOT NULL,
    `credential_public_key` VARCHAR(191) NOT NULL,
    `counter` INTEGER NOT NULL,
    `credential_device_type` VARCHAR(191) NOT NULL,
    `credential_backed_up` BOOLEAN NOT NULL,
    `transports` VARCHAR(191) NULL,

    UNIQUE INDEX `auth_authenticator_credential_id_key`(`credential_id`),
    PRIMARY KEY (`user_id`, `credential_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ns_domain_environment` ADD CONSTRAINT `ns_domain_environment_ns_domain_id_fkey` FOREIGN KEY (`ns_domain_id`) REFERENCES `ns_domain`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_account` ADD CONSTRAINT `auth_account_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_session` ADD CONSTRAINT `auth_session_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_authenticator` ADD CONSTRAINT `auth_authenticator_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
