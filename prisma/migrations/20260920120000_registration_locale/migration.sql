-- Historical registrations did not record a language; preserve Romanian for them.
ALTER TABLE `register_request` ADD COLUMN `locale` VARCHAR(2) NOT NULL DEFAULT 'ro';
ALTER TABLE `ns_domain` ADD COLUMN `registration_locale` VARCHAR(2) NOT NULL DEFAULT 'ro';
