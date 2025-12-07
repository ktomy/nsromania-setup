#!/bin/bash

################################################################################
# MySQL and MongoDB Installation and Configuration
################################################################################

set -e

# Source parent script if functions not available
if ! type log_info >/dev/null 2>&1; then
    source "$(dirname "$0")/../vps-setup.sh"
fi

# ============================================================================
# MySQL Installation
# ============================================================================

log_info "Installing MySQL Server..."

DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mysql-server

log_success "MySQL Server installed"

log_info "Securing MySQL installation..."

# Check if MySQL root password is already set
if mysql -uroot -e "SELECT 1" >/dev/null 2>&1; then
    log_info "MySQL root has no password yet, setting it now..."
    # Set root password and secure installation
    mysql << EOF
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PASSWORD}';
DELETE FROM mysql.user WHERE User='';
DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';
FLUSH PRIVILEGES;
EOF
    log_success "MySQL secured"
else
    log_info "MySQL root password already set, verifying access..."
    if ! mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "SELECT 1" >/dev/null 2>&1; then
        log_error "Cannot connect to MySQL with provided password"
        log_error "Either the password in config is wrong, or MySQL is already configured with a different password"
        log_error "To fix: systemctl stop mysql && apt-get purge -y mysql-server && rm -rf /var/lib/mysql"
        exit 1
    fi
    log_success "MySQL access verified"
fi

log_info "Creating nightscout database and user..."

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" << EOF
CREATE DATABASE IF NOT EXISTS nightscout CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'localhost' IDENTIFIED BY '${MYSQL_PASSWORD}';
GRANT ALL PRIVILEGES ON nightscout.* TO '${MYSQL_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF

log_success "Database nightscout created"

# Download and execute seed SQL files
log_info "Downloading and executing seed SQL files..."

SEED_DIR="/tmp/nsromania-seed-data"
mkdir -p "$SEED_DIR"

GITHUB_RAW="https://raw.githubusercontent.com/ktomy/nsromania-setup/main/seed-data"

for sql_file in 01-auth-tables.sql 02-domains-tables.sql 03-registration-tables.sql 04-example-data.sql; do
    log_info "Downloading $sql_file..."
    if ! curl -fsSL "$GITHUB_RAW/$sql_file" -o "$SEED_DIR/$sql_file"; then
        log_error "Failed to download $sql_file"
        exit 1
    fi
    
    log_info "Executing $sql_file..."
    mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" nightscout < "$SEED_DIR/$sql_file"
done

log_success "Seed data imported"

# Insert admin user
log_info "Creating admin user..."

# Generate a unique user ID
ADMIN_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" nightscout << EOF
INSERT INTO auth_user (id, email, name, email_verified, login_allowed, role, created_at, updated_at)
VALUES (
    '${ADMIN_ID}',
    '${ADMIN_EMAIL}',
    '${ADMIN_NAME}',
    NOW(),
    1,
    'admin',
    NOW(),
    NOW()
) ON DUPLICATE KEY UPDATE
    name = '${ADMIN_NAME}',
    role = 'admin',
    login_allowed = 1;
EOF

log_success "Admin user created: $ADMIN_EMAIL"

# ============================================================================
# MongoDB Installation
# ============================================================================

log_info "Installing MongoDB..."

# Import MongoDB GPG key
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
   gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

# Add MongoDB repository
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
    tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Update package list
apt-get update -qq

# Install MongoDB
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mongodb-org

# Start MongoDB
systemctl start mongod
systemctl enable mongod

log_success "MongoDB installed and started"

log_info "Configuring MongoDB authentication..."

# Wait for MongoDB to be ready
sleep 3

# Create root user
mongosh --eval "
db.getSiblingDB('admin').createUser({
  user: 'root',
  pwd: '${MONGO_ROOT_PASSWORD}',
  roles: [ { role: 'root', db: 'admin' } ]
})
"

log_success "MongoDB root user created"

# Enable authentication in MongoDB config
log_info "Enabling MongoDB authentication..."

cat > /etc/mongod.conf << 'EOF'
# mongod.conf
storage:
  dbPath: /var/lib/mongodb
  journal:
    enabled: true

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log

net:
  port: 27017
  bindIp: 127.0.0.1

processManagement:
  timeZoneInfo: /usr/share/zoneinfo

security:
  authorization: enabled
EOF

# Restart MongoDB with authentication enabled
systemctl restart mongod

# Wait for MongoDB to be ready after restart
log_info "Waiting for MongoDB to restart..."
sleep 5

# Check if MongoDB is running
if ! systemctl is-active --quiet mongod; then
    log_error "MongoDB failed to start after enabling authentication"
    log_error "Check logs: journalctl -u mongod -n 50"
    exit 1
fi

log_success "MongoDB authentication enabled"

# Verify database connections
log_info "Verifying database connections..."

# Test MySQL connection
if mysql -u"${MYSQL_USER}" -p"${MYSQL_PASSWORD}" nightscout -e "SELECT 1;" > /dev/null 2>&1; then
    log_success "MySQL connection verified"
else
    log_error "MySQL connection failed"
    exit 1
fi

# Test MongoDB connection with retries
log_info "Testing MongoDB connection..."
MONGO_RETRY=0
MONGO_MAX_RETRIES=5
MONGO_CONNECTED=false

while [ $MONGO_RETRY -lt $MONGO_MAX_RETRIES ]; do
    if mongosh -u root -p "${MONGO_ROOT_PASSWORD}" --authenticationDatabase admin --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
        MONGO_CONNECTED=true
        break
    fi
    MONGO_RETRY=$((MONGO_RETRY + 1))
    if [ $MONGO_RETRY -lt $MONGO_MAX_RETRIES ]; then
        log_info "MongoDB not ready yet, retrying in 2 seconds... (attempt $MONGO_RETRY/$MONGO_MAX_RETRIES)"
        sleep 2
    fi
done

if [ "$MONGO_CONNECTED" = true ]; then
    log_success "MongoDB connection verified"
else
    log_error "MongoDB connection failed after $MONGO_MAX_RETRIES attempts"
    log_error "Check MongoDB status: systemctl status mongod"
    log_error "Check MongoDB logs: tail -n 50 /var/log/mongodb/mongod.log"
    exit 1
fi

log_success "Database setup completed successfully"
