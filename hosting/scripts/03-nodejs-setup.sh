#!/bin/bash

################################################################################
# Node.js and NVM Installation
################################################################################

set -e

# Source parent script if functions not available
if ! type log_info >/dev/null 2>&1; then
    source "$(dirname "$0")/../vps-setup.sh"
fi

log_info "Installing NVM (Node Version Manager)..."

# Install NVM for nsromania user
su - nsromania << 'EOSU'
# Check if NVM is already installed
if [ -d "$HOME/.nvm" ]; then
    echo "NVM is already installed for nsromania user"
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
else
    # Download and install NVM
    echo "Installing NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    
    # Load NVM
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

# Check and install Node.js 14 (for Nightscout)
if nvm ls 14 >/dev/null 2>&1; then
    echo "Node.js 14 is already installed"
else
    echo "Installing Node.js 14..."
    nvm install 14
fi
nvm alias nightscout 14

# Check and install Node.js 22 (for Control Panel)
if nvm ls 22 >/dev/null 2>&1; then
    echo "Node.js 22 is already installed"
else
    echo "Installing Node.js 22..."
    nvm install 22
fi
nvm alias default 22
nvm use default

# Check and install pnpm globally
if command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is already installed"
else
    echo "Installing pnpm..."
    npm install -g pnpm
fi

echo "Node.js installation complete"
node --version
npm --version
pnpm --version
EOSU

log_success "Node.js and NVM installed successfully"

# Also install NVM for root user for convenience
log_info "Installing NVM for root user..."

if [ -d "$HOME/.nvm" ]; then
    log_info "NVM is already installed for root user"
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
else
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    
    # Load NVM for current session
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

# Check and install Node.js 22 for root
if nvm ls 22 >/dev/null 2>&1; then
    log_info "Node.js 22 is already installed for root"
else
    nvm install 22
fi
nvm alias default 22
nvm use default

log_success "NVM setup completed for all users"
