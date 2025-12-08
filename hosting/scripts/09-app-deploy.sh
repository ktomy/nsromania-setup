#!/bin/bash

################################################################################
# Control Panel Application Deployment
################################################################################

set -e

# Source parent script if functions not available
if ! type log_info >/dev/null 2>&1; then
    source "$(dirname "$0")/../vps-setup.sh"
fi

log_info "Deploying control panel application..."

# Ensure setup directory exists
mkdir -p "$SETUP_DIR"

# Clone repository
log_info "Cloning application repository..."
if [[ ! -d "$SETUP_DIR/.git" ]]; then
    git clone https://github.com/ktomy/nsromania-setup.git "$SETUP_DIR"
else
    log_info "Repository already exists, pulling latest changes..."
    cd "$SETUP_DIR"
    # Fix git dubious ownership issue when running as root
    git config --global --add safe.directory "$SETUP_DIR" 2>/dev/null || true
    git stash -q 2>/dev/null || true
    git pull
fi

cd "$SETUP_DIR"

# Set ownership
chown -R nsromania:nsromania "$SETUP_DIR"

# Ensure git can access the repository as nsromania user
sudo -u nsromania git config --global --add safe.directory "$SETUP_DIR" 2>/dev/null || true

# Generate .env file
log_info "Generating .env file..."

# Load values from config
DOMAIN=$(jq -r '.domain' "$CONFIG_FILE")
MYSQL_USER=$(jq -r '.mysql_user' "$CONFIG_FILE")
MYSQL_PASSWORD=$(jq -r '.mysql_password' "$CONFIG_FILE")
MONGO_ROOT_PASSWORD=$(jq -r '.mongo_root_password' "$CONFIG_FILE")
BREVO_API_KEY=$(jq -r '.brevo_api_key' "$CONFIG_FILE")
BREVO_SMTP_USER=$(jq -r '.brevo_smtp_user' "$CONFIG_FILE")
BREVO_SMTP_PASSWORD=$(jq -r '.brevo_smtp_password' "$CONFIG_FILE")
RECAPTCHA_SITE_KEY=$(jq -r '.recaptcha_site_key' "$CONFIG_FILE")
RECAPTCHA_SECRET_KEY=$(jq -r '.recaptcha_secret_key' "$CONFIG_FILE")
GITHUB_CLIENT_ID=$(jq -r '.github_client_id' "$CONFIG_FILE")
GITHUB_CLIENT_SECRET=$(jq -r '.github_client_secret' "$CONFIG_FILE")
GOOGLE_CLIENT_ID=$(jq -r '.google_client_id' "$CONFIG_FILE")
GOOGLE_CLIENT_SECRET=$(jq -r '.google_client_secret' "$CONFIG_FILE")
AUTH_SECRET=$(jq -r '.auth_secret' "$CONFIG_FILE")
NS_NODE_PATH=$(jq -r '.ns_node_path' "$CONFIG_FILE")
PORKBUN_API_KEY=$(jq -r '.porkbun_api_key' "$CONFIG_FILE")
PORKBUN_SECRET_KEY=$(jq -r '.porkbun_secret_key' "$CONFIG_FILE")

cat > "$SETUP_DIR/.env" << EOF
# Database Configuration
DATABASE_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@localhost:3306/nightscout"
SHADOW_DATABASE_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@localhost:3306/prisma_shadow"

# NextAuth Configuration
AUTH_SECRET="${AUTH_SECRET}"
AUTH_TRUST_HOST=true
NEXTAUTH_URL="https://${DOMAIN}"

# OAuth Providers
GITHUB_CLIENT_ID="${GITHUB_CLIENT_ID}"
GITHUB_CLIENT_SECRET="${GITHUB_CLIENT_SECRET}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET}"

# MongoDB Configuration (for Nightscout instances)
MONGO_URL="mongodb://root:${MONGO_ROOT_PASSWORD}@localhost:27017/?authSource=admin"

# Nightscout Runtime Configuration
NS_HOME="${NS_HOME}"
NS_NODE_PATH="${NS_NODE_PATH}"

# Email Service (Brevo)
BREVO_API_KEY="${BREVO_API_KEY}"
BREVO_SMTP_HOST="smtp-relay.brevo.com"
BREVO_SMTP_PORT=587
BREVO_SMTP_USER="${BREVO_SMTP_USER}"
BREVO_SMTP_PASSWORD="${BREVO_SMTP_PASSWORD}"

# reCAPTCHA
NEXT_PUBLIC_RECAPTCHA_SITE_KEY="${RECAPTCHA_SITE_KEY}"
RECAPTCHA_SECRET_KEY="${RECAPTCHA_SECRET_KEY}"

# DNS Management (Porkbun)
PORKBUN_API_KEY="${PORKBUN_API_KEY}"
PORKBUN_SECRET_KEY="${PORKBUN_SECRET_KEY}"
DOMAIN="${DOMAIN}"

# Application URLs
NEXT_PUBLIC_APP_URL="https://${DOMAIN}"
EOF

chmod 600 "$SETUP_DIR/.env"
chown nsromania:nsromania "$SETUP_DIR/.env"

log_success ".env file created"

# Install and build application as nsromania user
su - nsromania << EOSU
set -e

# Load NVM and use Node.js 22
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && \. "\$NVM_DIR/nvm.sh"
nvm use 22

cd "$SETUP_DIR"

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Generate Prisma client
echo "Generating Prisma client..."
npx prisma generate

# Build application
echo "Building application..."
pnpm build

echo "Application build completed"
EOSU

log_success "Application built successfully"

# Ensure log directory exists with proper permissions for PM2
LOG_DIR="/var/log/nsromania"
mkdir -p "$LOG_DIR"
chown nsromania:nsromania "$LOG_DIR"
chmod 755 "$LOG_DIR"

# Create PM2 ecosystem file
log_info "Creating PM2 ecosystem configuration..."

cat > "$SETUP_DIR/ecosystem.config.js" << 'EOF'
module.exports = {
  apps: [{
    name: 'nsromania-setup',
    cwd: '/opt/nsromania/setup',
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3000',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
    },
        error_file: '/var/log/nsromania/nsromania-setup-error.log',
        out_file: '/var/log/nsromania/nsromania-setup-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }]
}
EOF

chown nsromania:nsromania "$SETUP_DIR/ecosystem.config.js"

# Start application with PM2
log_info "Starting application with PM2..."

su - nsromania << EOSU
set -e

# Load NVM
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && \. "\$NVM_DIR/nvm.sh"
nvm use 22

cd "$SETUP_DIR"

# Delete old process if exists
pm2 delete nsromania-setup 2>/dev/null || true

# Start application
pm2 start ecosystem.config.js

# Save PM2 process list
pm2 save

echo "Application started successfully"
EOSU

log_success "Application started with PM2"

# Verify application is running
log_info "Verifying application..."
sleep 5

if curl -f http://localhost:3000 > /dev/null 2>&1; then
    log_success "Application is responding on port 3000"
else
    log_warning "Application may not be fully started yet"
fi

log_success "Control panel deployment completed"
