#!/bin/bash

################################################################################
# User and Permissions Setup
################################################################################

set -e

# Source parent script if functions not available
if ! type log_info >/dev/null 2>&1; then
    source "$(dirname "$0")/../vps-setup.sh"
fi

log_info "Creating nsromania user..."

# Create user if doesn't exist
if ! id -u nsromania > /dev/null 2>&1; then
    useradd -r -m -d /home/nsromania -s /bin/bash nsromania
    log_success "User nsromania created"
else
    log_info "User nsromania already exists"
fi

# Create install directories
log_info "Creating installation directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$SETUP_DIR"
mkdir -p "$NS_HOME"
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled
mkdir -p /etc/bind/zones

# Set ownership
chown -R nsromania:nsromania "$INSTALL_DIR"

log_info "Configuring sudo privileges..."

# Create sudoers file for nsromania user
cat > /etc/sudoers.d/nsromania << 'EOF'
# Allow nsromania user to reload nginx without password
nsromania ALL=(ALL) NOPASSWD: /usr/bin/systemctl reload nginx
nsromania ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart nginx
nsromania ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t

# Allow nsromania user to reload bind9 without password
nsromania ALL=(ALL) NOPASSWD: /usr/sbin/rndc reload
nsromania ALL=(ALL) NOPASSWD: /usr/sbin/rndc *

# Allow nsromania user to manage pm2
nsromania ALL=(ALL) NOPASSWD: /usr/bin/pm2 *
nsromania ALL=(ALL) NOPASSWD: /usr/local/bin/pm2 *
EOF

chmod 440 /etc/sudoers.d/nsromania

log_success "User setup completed"
