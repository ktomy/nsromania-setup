#!/bin/bash

################################################################################
# Node.js and NVM Installation
################################################################################

set -e

source "$(dirname "$0")/../vps-setup.sh" 2>/dev/null || true

log_info "Installing NVM (Node Version Manager)..."

# Install NVM for nsromania user
su - nsromania << 'EOSU'
# Download and install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install Node.js 14 (for Nightscout)
echo "Installing Node.js 14..."
nvm install 14
nvm alias nightscout 14

# Install Node.js 22 (for Control Panel)
echo "Installing Node.js 22..."
nvm install 22
nvm alias default 22
nvm use default

# Install pnpm globally
echo "Installing pnpm..."
npm install -g pnpm

echo "Node.js installation complete"
node --version
npm --version
pnpm --version
EOSU

log_success "Node.js and NVM installed successfully"

# Also install NVM for root user for convenience
log_info "Installing NVM for root user..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Load NVM for current session
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install Node.js 22 for root
nvm install 22
nvm alias default 22
nvm use default

log_success "NVM setup completed for all users"
