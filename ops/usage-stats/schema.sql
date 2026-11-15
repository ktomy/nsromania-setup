-- Daily per-instance request counts collected from the nginx access log.
-- Standalone table: intentionally NOT part of the Prisma schema. Apply manually with the mysql CLI.
CREATE TABLE IF NOT EXISTS ns_domain_daily_stats (
    domain      VARCHAR(64)  NOT NULL COMMENT 'subdomain (ns_domain.domain, lowercased)',
    day         DATE         NOT NULL,
    hits        INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'all requests',
    ok_hits     INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '2xx/3xx/101, excluding bot user agents',
    uploads     INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'POST/PUT to /api/',
    api_reads   INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'GET to /api/',
    web_hits    INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '/ and /socket.io/',
    unique_ips  INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'distinct client IPs (count only)',
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (domain, day),
    KEY idx_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
