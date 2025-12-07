#!/bin/bash

################################################################################
# Nightscout Master Installation
################################################################################

set -e

# Source parent script if functions not available
if ! type log_info >/dev/null 2>&1; then
    source "$(dirname "$0")/../vps-setup.sh"
fi

log_info "Installing Nightscout dependencies..."

# Ensure NS_HOME directory exists
mkdir -p "$NS_HOME"
chown nsromania:nsromania "$NS_HOME"

# Install Nightscout as nsromania user
su - nsromania << EOSU
set -e

# Load NVM
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && \. "\$NVM_DIR/nvm.sh"

# Create master directory
mkdir -p "${NS_HOME}/master"
cd "${NS_HOME}/master"

# Clone Nightscout repository
echo "Cloning Nightscout repository..."
if [ ! -d ".git" ]; then
    git clone https://github.com/nightscout/cgm-remote-monitor.git .
else
    echo "Repository already exists, pulling latest changes..."
    git pull
fi

# Switch to Node.js 14 (required for Nightscout)
nvm use 14

# Install dependencies
echo "Installing Nightscout dependencies..."
npm install --production

# Verify installation
if [ ! -f "package.json" ]; then
    echo "ERROR: package.json not found"
    exit 1
fi

if [ ! -f "server.js" ]; then
    echo "ERROR: server.js not found"
    exit 1
fi

# Check package name
PACKAGE_NAME=\$(node -p "require('./package.json').name")
if [ "\$PACKAGE_NAME" != "nightscout" ]; then
    echo "ERROR: Invalid package name: \$PACKAGE_NAME"
    exit 1
fi

PACKAGE_VERSION=\$(node -p "require('./package.json').version")
echo "Nightscout version: \$PACKAGE_VERSION"

echo "Nightscout master installation completed successfully"
EOSU

log_success "Nightscout master installed"

# Get Node.js 14 path for NS_NODE_PATH
log_info "Determining Node.js 14 path..."
NODE_14_PATH=$(su - nsromania -c '. ~/.nvm/nvm.sh && nvm use 14 > /dev/null 2>&1 && which node')

if [[ -z "$NODE_14_PATH" ]]; then
    log_error "Could not determine Node.js 14 path"
    exit 1
fi

log_info "Node.js 14 path: $NODE_14_PATH"

# Update config file with NS paths
log_info "Updating configuration..."
if [[ -f "$CONFIG_FILE" ]]; then
    # Add NS_HOME and NS_NODE_PATH to config
    jq --arg ns_home "$NS_HOME" \
       --arg ns_node "$NODE_14_PATH" \
       '. + {ns_home: $ns_home, ns_node_path: $ns_node}' \
       "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    
    export NS_NODE_PATH="$NODE_14_PATH"
fi

log_success "Nightscout installation completed successfully"
log_info "Nightscout location: ${NS_HOME}/master"
log_info "Node.js path: $NODE_14_PATH"
