#!/bin/bash

################################################################################
# PM2 Process Manager Installation
################################################################################

set -e

source "$(dirname "$0")/../vps-setup.sh" 2>/dev/null || true

log_info "Installing PM2 globally..."

# Install PM2 for nsromania user
su - nsromania << 'EOSU'
# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use default

# Install PM2
npm install -g pm2

# Setup PM2 startup script
pm2 startup systemd -u nsromania --hp /home/nsromania

echo "PM2 installation complete"
pm2 --version
EOSU

# Run the generated startup command
log_info "Configuring PM2 startup..."
env PATH=$PATH:/home/nsromania/.nvm/versions/node/$(su - nsromania -c '. ~/.nvm/nvm.sh && node --version')/bin /home/nsromania/.nvm/versions/node/$(su - nsromania -c '. ~/.nvm/nvm.sh && node --version')/bin/pm2 startup systemd -u nsromania --hp /home/nsromania

log_success "PM2 installed and configured successfully"
