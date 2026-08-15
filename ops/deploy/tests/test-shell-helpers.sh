#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DEPLOY_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

for script in \
    "$DEPLOY_DIR/activate-release.sh" \
    "$DEPLOY_DIR/authorized-command.sh" \
    "$DEPLOY_DIR/bootstrap-server.sh" \
    "$DEPLOY_DIR/build-artifact.sh" \
    "$DEPLOY_DIR/smoke-artifact.sh" \
    "$DEPLOY_DIR/update-deploy-helpers-on-server.sh" \
    "$DEPLOY_DIR/update-server-helpers.sh"; do
    bash -n "$script"
done

invalid_commands=(
    ''
    'bash'
    'deploy'
    'deploy 0123456789abcdef0123456789abcdef01234567'
    'deploy 0123456789abcdef0123456789abcdef01234567 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa extra'
    'deploy 0123456789ABCDEF0123456789ABCDEF01234567 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    'upload 0123456789abcdef0123456789abcdef01234567 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 0'
    'upload 0123456789abcdef0123456789abcdef01234567 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1;id'
    'preflight 0123456789abcdef0123456789abcdef01234567 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1'
    'scp -t /var/log/nightscout/incoming/file'
)

for command_value in "${invalid_commands[@]}"; do
    if SSH_ORIGINAL_COMMAND="$command_value" "$DEPLOY_DIR/authorized-command.sh" >/dev/null 2>&1; then
        echo "Dispatcher accepted forbidden command: $command_value" >&2
        exit 1
    fi
done

if rg -n -i \
    'prisma|migrate|db[[:space:]]+push|seed|mysql|mariadb|mongo(sh)?|pnpm|npm[[:space:]]+install|npx' \
    "$DEPLOY_DIR/activate-release.sh"; then
    echo 'Activation helper contains a forbidden database or package-management command.' >&2
    exit 1
fi

if rg -n -i \
    'prisma|migrate|db[[:space:]]+push|seed|mysql|mariadb|mongo(sh)?|pnpm|npm[[:space:]]+install|npx' \
    "$DEPLOY_DIR/update-deploy-helpers-on-server.sh"; then
    echo 'Helper receiver contains a forbidden database or package-management command.' >&2
    exit 1
fi

if rg -n \
    'pm2[[:space:]]+(start|stop|restart|delete|reload|save|kill|resurrect)' \
    "$DEPLOY_DIR/update-deploy-helpers-on-server.sh"; then
    echo 'Helper receiver contains a PM2 mutation command.' >&2
    exit 1
fi

grep -Fq 'trap rollback ERR HUP INT TERM' "$DEPLOY_DIR/activate-release.sh" || {
    echo 'Activation helper does not roll back after an SSH hangup.' >&2
    exit 1
}

if rg -n 'sudo[[:space:]]+-n|SUDO_PASSWORD|sudo[^\n]*-S' "$DEPLOY_DIR/update-server-helpers.sh"; then
    echo 'Local helper updater bypasses the required interactive sudo prompt.' >&2
    exit 1
fi

grep -Fq "sudo -- '\$REMOTE_UPDATER'" "$DEPLOY_DIR/update-server-helpers.sh" || {
    echo 'Local helper updater does not invoke the fixed root receiver.' >&2
    exit 1
}

if grep -Fq 'nsromania-update-deploy-helpers' "$DEPLOY_DIR/nsromania-github-deploy.sudoers"; then
    echo 'Helper receiver must not be passwordless in sudoers.' >&2
    exit 1
fi

if rg -n \
    'pm2[[:space:]]+(restart|stop|delete)[[:space:]]+(all|\*)|pm2[[:space:]]+(save|kill|resurrect)' \
    "$DEPLOY_DIR/activate-release.sh"; then
    echo 'Activation helper contains a broad PM2 command.' >&2
    exit 1
fi

echo 'Deployment shell helper checks passed.'
