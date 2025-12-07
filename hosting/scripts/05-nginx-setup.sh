#!/bin/bash

################################################################################
# Nginx Web Server Installation and Configuration
################################################################################

set -e

# Source parent script if functions not available
if ! type log_info >/dev/null 2>&1; then
    source "$(dirname "$0")/../vps-setup.sh"
fi

log_info "Installing Nginx..."

DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx

systemctl start nginx
systemctl enable nginx

log_success "Nginx installed and started"

# Install Certbot for Let's Encrypt SSL
log_info "Installing Certbot and Porkbun DNS plugin..."

DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-pip

# Install Porkbun DNS plugin
pip3 install certbot-dns-porkbun --break-system-packages

log_success "Certbot and Porkbun plugin installed"

# Copy Nginx configuration templates
log_info "Installing Nginx configuration templates..."

TEMPLATE_DIR="$(dirname "$0")/../templates"

# Install main site configuration for control panel
cat > /etc/nginx/sites-available/setup << EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    # SSL certificates (will be configured after obtaining cert)
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Proxy settings
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Logging
    access_log /var/log/nginx/${DOMAIN}_access.log;
    error_log /var/log/nginx/${DOMAIN}_error.log;
}
EOF

# Install subdomain template for Nightscout instances
cat > /etc/nginx/sites-available/_template << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name [% subdomain %];

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name [% subdomain %];

    # Wildcard SSL certificate
    ssl_certificate /etc/letsencrypt/live/DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMAIN/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    
    # Proxy settings for Nightscout
    location / {
        proxy_pass http://localhost:[% port %];
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Logging
    access_log /var/log/nginx/[% subdomain %]_access.log;
    error_log /var/log/nginx/[% subdomain %]_error.log;
}
EOF

log_success "Nginx templates installed"

# Obtain SSL certificate
log_info "Obtaining wildcard SSL certificate for $DOMAIN..."

# Create Porkbun credentials file
mkdir -p /root/.secrets
cat > /root/.secrets/porkbun.ini << EOF
dns_porkbun_key=${PORKBUN_API_KEY}
dns_porkbun_secret=${PORKBUN_SECRET_KEY}
EOF
chmod 600 /root/.secrets/porkbun.ini

# Create environment file for hook scripts
log_info "Creating Porkbun environment file for hooks..."

cat > /etc/porkbun-dns.env << EOF
PORKBUN_API_KEY="${PORKBUN_API_KEY}"
PORKBUN_SECRET_KEY="${PORKBUN_SECRET_KEY}"
DOMAIN="${DOMAIN}"
EOF

chmod 600 /etc/porkbun-dns.env

log_success "Porkbun environment configured"

# Copy auth/cleanup hooks to system
log_info "Installing Porkbun certbot hooks..."

SCRIPTS_DIR="$(dirname "$0")"

cp "$SCRIPTS_DIR/certbot-porkbun-auth.sh" /usr/local/bin/certbot-porkbun-auth.sh
cp "$SCRIPTS_DIR/certbot-porkbun-cleanup.sh" /usr/local/bin/certbot-porkbun-cleanup.sh

chmod +x /usr/local/bin/certbot-porkbun-auth.sh
chmod +x /usr/local/bin/certbot-porkbun-cleanup.sh

log_success "Certbot hooks installed"

# Test Porkbun API authentication before running certbot
log_info "Testing Porkbun API authentication..."

TEST_RESPONSE=$(curl -s -X POST "https://api.porkbun.com/api/json/v3/domain/listAll" \
    -H "Content-Type: application/json" \
    -d "{
        \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
        \"apikey\": \"$PORKBUN_API_KEY\"
    }")

if echo "$TEST_RESPONSE" | grep -q '"status":"ERROR"'; then
    ERROR_MSG=$(echo "$TEST_RESPONSE" | grep -o '"message":"[^"]*"')
    log_error "Porkbun API authentication failed: $ERROR_MSG"
    log_error "Please verify your API key and secret"
    exit 1
fi

if echo "$TEST_RESPONSE" | grep -q '"status":"SUCCESS"'; then
    log_success "Porkbun API authentication successful"
else
    log_error "Unexpected Porkbun API response: $TEST_RESPONSE"
    exit 1
fi

# Verify domain is in account
log_info "Verifying domain exists in Porkbun account..."

DOMAIN_RESPONSE=$(curl -s -X POST "https://api.porkbun.com/api/json/v3/domain/get" \
    -H "Content-Type: application/json" \
    -d "{
        \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
        \"apikey\": \"$PORKBUN_API_KEY\",
        \"domain\": \"$DOMAIN\"
    }")

if echo "$DOMAIN_RESPONSE" | grep -q '"status":"ERROR"'; then
    ERROR_MSG=$(echo "$DOMAIN_RESPONSE" | grep -o '"message":"[^"]*"')
    log_warning "Domain verification failed: $ERROR_MSG"
    log_warning "Make sure the domain is registered in your Porkbun account"
else
    log_success "Domain $DOMAIN verified in Porkbun account"
fi

# Request wildcard certificate using Porkbun DNS challenge
# Using --manual mode with certbot and porkbun-dns helper script
log_info "Creating DNS records for ACME challenge..."

# First, let's use a custom approach with the porkbun-dns helper
# We'll request the cert with manual mode and handle DNS ourselves
certbot certonly \
    --manual \
    --preferred-challenges dns \
    --manual-auth-hook "/usr/local/bin/certbot-porkbun-auth.sh" \
    --manual-cleanup-hook "/usr/local/bin/certbot-porkbun-cleanup.sh" \
    --non-interactive \
    --agree-tos \
    --email "${ADMIN_EMAIL}" \
    -d "${DOMAIN}" \
    -d "*.${DOMAIN}" || {
    
    log_warning "Automated DNS challenge failed. Please create DNS records manually or re-run with interactive mode."
    log_info "For manual DNS challenge, you'll need to create TXT records for:"
    log_info "  _acme-challenge.${DOMAIN}"
    log_info "  _acme-challenge.*.${DOMAIN}"
    exit 1
}

log_success "SSL certificate obtained for $DOMAIN and *.${DOMAIN}"

# Update template with actual domain
sed -i "s/DOMAIN/${DOMAIN}/g" /etc/nginx/sites-available/_template

# Enable main site
ln -sf /etc/nginx/sites-available/setup /etc/nginx/sites-enabled/setup

# Remove default site if exists
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
nginx -t

# Reload Nginx
systemctl reload nginx

log_success "Nginx configuration completed"

# Setup SSL auto-renewal
log_info "Setting up SSL auto-renewal..."

cat > /etc/cron.d/certbot-renew << 'EOF'
# Renew Let's Encrypt certificates twice daily
0 0,12 * * * root certbot renew --quiet --post-hook "systemctl reload nginx"
EOF

log_success "SSL auto-renewal configured"
