#!/bin/bash

################################################################################
# PM2 Process Manager Installation
################################################################################

set -e

# Source parent script if functions not available
if ! type log_info >/dev/null 2>&1; then
    source "$(dirname "$0")/../vps-setup.sh"
fi

log_info "Installing PM2 globally..."

# Check if PM2 is already installed
if su - nsromania -c '. ~/.nvm/nvm.sh && npm list -g pm2 >/dev/null 2>&1'; then
    log_info "PM2 is already installed"
    PM2_VERSION=$(su - nsromania -c '. ~/.nvm/nvm.sh && pm2 --version')
    log_info "Current PM2 version: $PM2_VERSION"
else
    # Install PM2 for nsromania user
    su - nsromania << 'EOSU'
# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use default

# Install PM2
npm install -g pm2

echo "PM2 installation complete"
pm2 --version
EOSU
    log_success "PM2 installed successfully"
fi

# Check if PM2 startup service is already configured
if systemctl is-enabled pm2-nsromania >/dev/null 2>&1; then
    log_info "PM2 startup service is already configured"
else
    log_info "Configuring PM2 startup..."
    
    # Get the node version path
    NODE_VERSION=$(su - nsromania -c '. ~/.nvm/nvm.sh && node --version' 2>/dev/null | sed 's/^v//')
    NODE_PATH="/home/nsromania/.nvm/versions/node/v${NODE_VERSION}/bin"
    
    # Run the startup command as nsromania user
    su - nsromania << EOSU
. ~/.nvm/nvm.sh
nvm use default
pm2 startup systemd -u nsromania --hp /home/nsromania
EOSU

    log_success "PM2 startup service configured"
fi

log_success "PM2 installed and configured successfully"
