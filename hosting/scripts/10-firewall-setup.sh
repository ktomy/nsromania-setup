#!/bin/bash

################################################################################
# Firewall and Security Configuration
################################################################################

set -e

# Source parent script if functions not available
if ! type log_info >/dev/null 2>&1; then
    source "$(dirname "$0")/../vps-setup.sh"
fi

log_info "Configuring firewall (UFW)..."

# Install UFW if not already installed
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw

# Reset UFW to defaults
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (port 22)
ufw allow 22/tcp comment 'SSH'

# Allow HTTP (port 80)
ufw allow 80/tcp comment 'HTTP'

# Allow HTTPS (port 443)
ufw allow 443/tcp comment 'HTTPS'

# Allow DNS (port 53) - both TCP and UDP
ufw allow 53/tcp comment 'DNS TCP'
ufw allow 53/udp comment 'DNS UDP'

# Enable UFW
ufw --force enable

log_success "Firewall configured and enabled"

# Display firewall status
ufw status verbose

log_info "Installing fail2ban for SSH protection..."

DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban

# Create fail2ban configuration for SSH
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
destemail = root@localhost
sendername = Fail2Ban
action = %(action_mwl)s

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
maxretry = 3
bantime = 7200
EOF

# Start and enable fail2ban
systemctl restart fail2ban
systemctl enable fail2ban

log_success "fail2ban installed and configured"

# Configure secure SSH (optional recommendations)
log_info "Applying SSH security recommendations..."

# Backup original sshd_config
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Update SSH configuration (keeping password auth for now, but adding security)
cat >> /etc/ssh/sshd_config << 'EOF'

# Security hardening
MaxAuthTries 3
MaxSessions 10
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
PermitEmptyPasswords no
EOF

# Restart SSH service
systemctl restart sshd

log_success "SSH security enhanced"

log_info "Configuring automatic security updates..."

DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades

# Configure unattended upgrades
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
EOF

log_success "Automatic security updates enabled"

log_success "Security and firewall setup completed"
