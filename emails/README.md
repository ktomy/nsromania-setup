# Welcome email language

Email HTML is rendered from this directory and sent through Brevo's transactional
email API as `htmlContent`. No Brevo-hosted template IDs or dashboard changes are
needed.

The registration endpoint saves the form's validated `Accept-Language` (`en` or
`ro`) in `register_request.locale`. Approval copies it to
`ns_domain.registration_locale`. The domain welcome-email action uses this saved
language, including for resends, regardless of the administrator's language.
Romanian uses `welcome.html`; English uses `welcome_en.html`.

The schema change in `prisma/migrations/20260920120000_registration_locale/migration.sql`
must be applied before running this application version against an existing
database. Both columns default to `ro`, preserving historical behavior where the
original language is unknown. The production deployment workflow does not apply
or ship migrations; database changes require separate handling under the
repository's operations rules.

Production schema update completed on 2026-09-19 at 22:39 UTC using direct MySQL
DDL, as explicitly requested. Both columns were added with `ALGORITHM=INSTANT`
and a five-second metadata lock timeout while holding the deployment lock.
Existing column definitions were verified unchanged; all 128 registration
requests and 363 domains initially have `ro`. Local and public health checks
passed. Prisma migrations were not run, and the application was not deployed.
Do not reapply these column additions to production.

A restricted backup of both tables and the executed SQL is retained on the server:
`/var/log/nightscout/backup/registration-locale-ddl-20260919T223927Z.ZjU4R1`.

Validation and sign-in emails retain their existing language and templates.
