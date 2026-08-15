# Production deployment

Production deployment is a manually triggered GitHub Actions workflow. It builds and tests an exact `main` commit, creates a checksummed standalone Next.js artifact, uploads it through a restricted SSH key, and activates it with automatic rollback.

## Safety invariants

- Deployment never runs a Prisma migration, `db push`, seed, database CLI, or database health query.
- GitHub receives no production database, OAuth, MongoDB, email, or application secrets.
- The server-only `.env` is copied into the candidate without being sourced or printed.
- The archive validator rejects hard links, devices, FIFOs, path traversal, link cycles, external links, and archive members below links; only pnpm's internal, fully resolved package symlinks are allowed.
- Before a live release is replaced, its complete directory is atomically renamed into `/var/log/nightscout/backup`.
- Failed releases are preserved. Backups are never automatically pruned.
- Only the root PM2 process named `setup-ns` is stopped and recreated with an explicit command, working directory, and Node interpreter. No global PM2 command is permitted.
- The production runtime is the audited `/usr/local/nvm/versions/node/v22.12.0/bin/node`.
- The existing saved PM2 reboot definition is left unchanged only after bootstrap proves it is the audited Node 22.12.0 `npm start` command; each artifact keeps `npm start` compatible by mapping it to `node server.js`.
- Local and public health checks call the DB-independent `/api/health` endpoint and require the exact deployed commit.

## GitHub environment

Create an environment named `production`, restrict it to exactly `main`, and configure a required reviewer before the first dispatch. If the person dispatching is the sole reviewer, leave "prevent self-review" disabled or add a different reviewer.

Environment secrets:

- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_SSH_KNOWN_HOSTS`

Environment variables:

- `PRODUCTION_SSH_HOST` (`nsromania.info`)
- `PRODUCTION_SSH_PORT` (`22`)
- `PRODUCTION_SSH_USER` (`nsdeploy`)
- `PRODUCTION_URL` (`https://setup.nsromania.info`)

Repository variable (it is public build-time data, so the build job does not need access to the protected environment):

- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`

Never add `DATABASE_URL`, `SHADOW_DATABASE_URL`, `MONGO_URL`, or another production credential to GitHub.

## One-time server bootstrap

Generate a dedicated passphrase-less ED25519 key for GitHub Actions. Bootstrap creates the locked, deployment-only `nsdeploy` account and installs the public key in its dedicated home with an OpenSSH forced command and `restrict`; it cannot obtain a shell, forward ports, or invoke arbitrary server commands. The ordinary `ktomy` account receives no passwordless deployment privilege.

Stage this directory and the public key on the production server, then run as root:

```bash
ops/deploy/bootstrap-server.sh /path/to/github-actions-deploy.pub
```

The bootstrap verifies Node, PM2, the current panel, and the existing firewall state before writing. It never changes firewall rules; if UFW is inactive, it emits a warning. It creates timestamped backups of every existing file it replaces, validates the narrow sudoers file with `visudo`, installs root-owned helpers, and changes `authorized_keys` last.

The sudo rule grants only:

```text
/usr/local/sbin/nsromania-activate-release <validated-commit> <validated-checksum>
```

GitHub protects the active workflow run from cancellation. Its concurrency model can replace an older pending deployment with a newer pending deployment; every run still deploys only its own exact, reviewed `main` SHA.

## Manual deployment

Open **Actions → Deploy production → Run workflow**, select `main`, and approve the `production` environment gate. GitHub serializes deployments and refuses any non-`main` ref.

The activation sequence is:

1. Verify the private artifact copy, structured archive contents, expanded size, disk space, inodes, pinned Node, current release, `.env`, and the one `setup-ns` PM2 process.
2. Extract and validate a sibling candidate without changing the live application.
3. Copy `.env` into the candidate with mode `0600`.
4. Stop only `setup-ns`.
5. Rename the complete live directory to a timestamped backup and atomically move the candidate into place.
6. Recreate only `setup-ns` with the standalone server, pinned Node interpreter, and exact live working directory; then require the exact commit from local and public `/api/health` endpoints.
7. On failure, preserve the failed release, restore the previous directory, restart it, and return a failed workflow result.

No deployment or rollback invokes `deploy_on_server.sh`, `hosting/vps-setup.sh`, or any database setup script.
