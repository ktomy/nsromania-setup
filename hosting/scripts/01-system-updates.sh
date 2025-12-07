#!/bin/bash

################################################################################
# System Updates and Package Installation
################################################################################

set -e

# Source parent script if functions not available
if ! type log_info >/dev/null 2>&1; then
    source "$(dirname "$0")/../vps-setup.sh"
fi

log_info "Updating package lists..."
apt-get update -qq

log_info "Upgrading existing packages..."
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq

log_info "Installing essential packages..."
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    apt-transport-https \
    ca-certificates \
    curl \
    wget \
    gnupg \
    lsb-release \
    software-properties-common \
    git \
    build-essential \
    jq \
    htop \
    vim \
    nano \
    net-tools \
    dnsutils \
    unzip

log_success "System packages updated successfully"
