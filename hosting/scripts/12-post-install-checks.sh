#!/bin/bash

################################################################################
# Post-Installation Verification
################################################################################

# Do not exit on first failure; we want to gather all check results
set +e

# Source parent script if functions not available
if ! type log_info >/dev/null 2>&1; then
    source "$(dirname "$0")/../vps-setup.sh"
fi

log_info "Running post-installation checks..."

CHECKS_PASSED=0
CHECKS_FAILED=0

# Function to run a check
run_check() {
    local check_name=$1
    local check_command=$2

    echo -n "Checking $check_name... "
    local output
    output=$(eval "$check_command" 2>&1)
    local status=$?

    if [[ $status -eq 0 ]]; then
        echo -e "${GREEN}✓ PASSED${NC}"
        ((CHECKS_PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC}"
        ((CHECKS_FAILED++))
        if [[ -n "$output" ]]; then
            echo "    Output: $output"
        fi
    fi

    return 0
}

echo ""
echo -e "${BLUE}━━━ Service Status Checks ━━━${NC}"

# Check MySQL
run_check "MySQL service" "systemctl is-active --quiet mysql"
run_check "MySQL connection" "mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} nightscout -e 'SELECT 1' 2>/dev/null"

# Check MongoDB
run_check "MongoDB service" "systemctl is-active --quiet mongod"
run_check "MongoDB connection" "mongosh -u root -p ${MONGO_ROOT_PASSWORD} --authenticationDatabase admin --eval 'db.adminCommand(\"ping\")' 2>/dev/null"

# Check BIND9
run_check "BIND9 service" "systemctl is-active --quiet bind9"
run_check "DNS resolution" "dig @localhost ${DOMAIN} +short | grep -q '.'"

# Check Nginx
run_check "Nginx service" "systemctl is-active --quiet nginx"
run_check "Nginx configuration" "nginx -t 2>/dev/null"

# Check Firewall
run_check "UFW firewall" "ufw status | grep -q 'Status: active'"

# Check fail2ban
run_check "fail2ban service" "systemctl is-active --quiet fail2ban"

echo ""
echo -e "${BLUE}━━━ Application Checks ━━━${NC}"

# Check Nightscout installation
run_check "Nightscout master exists" "test -f ${NS_HOME}/master/server.js"
run_check "Nightscout package.json" "test -f ${NS_HOME}/master/package.json"

# Check Control Panel
run_check "Control panel directory" "test -d ${SETUP_DIR}"
run_check "Control panel .env" "test -f ${SETUP_DIR}/.env"
run_check "PM2 process running" "su - nsromania -c 'pm2 list | grep -q nsromania-setup'"
run_check "Control panel responding" "curl -f -s http://localhost:3000 > /dev/null"

echo ""
echo -e "${BLUE}━━━ SSL Certificate Checks ━━━${NC}"

# Check SSL certificates
run_check "SSL certificate exists" "test -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
run_check "SSL private key exists" "test -f /etc/letsencrypt/live/${DOMAIN}/privkey.pem"

echo ""
echo -e "${BLUE}━━━ Configuration Files Checks ━━━${NC}"

# Check configuration files
run_check "Nginx main site config" "test -f /etc/nginx/sites-available/setup"
run_check "Nginx template file" "test -f /etc/nginx/sites-available/_template"
run_check "BIND zone file" "test -f /etc/bind/zones/${DOMAIN}"
run_check "PM2 ecosystem config" "test -f ${SETUP_DIR}/ecosystem.config.js"

echo ""
echo -e "${BLUE}━━━ User and Permissions Checks ━━━${NC}"

# Check user and permissions
run_check "nsromania user exists" "id -u nsromania"
run_check "sudoers file exists" "test -f /etc/sudoers.d/nsromania"
run_check "Install directory ownership" "test -O ${INSTALL_DIR} || sudo -u nsromania test -O ${INSTALL_DIR}"

echo ""
echo -e "${BLUE}━━━ Database Content Checks ━━━${NC}"

# Check database tables exist
run_check "auth_user table exists" "mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} nightscout -e 'DESCRIBE auth_user' 2>/dev/null"
run_check "ns_domain table exists" "mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} nightscout -e 'DESCRIBE ns_domain' 2>/dev/null"
run_check "Admin user created" "mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} nightscout -e \"SELECT * FROM auth_user WHERE role='admin'\" 2>/dev/null | grep -q admin"

echo ""
echo -e "${BLUE}━━━ Network Connectivity Checks ━━━${NC}"

# Check network
VPS_IP=$(curl -s -4 ifconfig.me)
run_check "Public IP retrieved" "test -n '${VPS_IP}'"
run_check "Port 80 listening" "netstat -tuln | grep -q ':80 '"
run_check "Port 443 listening" "netstat -tuln | grep -q ':443 '"
run_check "Port 53 listening" "netstat -tuln | grep -q ':53 '"

echo ""
echo -e "${BLUE}━━━ Summary ━━━${NC}"
echo ""
echo "Total checks: $((CHECKS_PASSED + CHECKS_FAILED))"
echo -e "${GREEN}Passed: $CHECKS_PASSED${NC}"
echo -e "${RED}Failed: $CHECKS_FAILED${NC}"
echo ""

if [[ $CHECKS_FAILED -eq 0 ]]; then
    log_success "All verification checks passed!"
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✓ Your Nightscout Control Panel is ready to use!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
else
    log_warning "$CHECKS_FAILED checks failed. Please review the output above."
    echo ""
    echo "Common issues:"
    echo "  - SSL certificate: If manual DNS challenge, cert may need to be obtained manually"
    echo "  - Services may need a few minutes to fully start"
    echo "  - DNS propagation may take time for external checks"
    echo ""
fi

# Display service URLs and important information
echo -e "${BLUE}━━━ Access Information ━━━${NC}"
echo ""
echo "Control Panel: https://${DOMAIN}"
echo "Local access: http://localhost:3000"
echo "Public IP: ${VPS_IP}"
echo ""

echo -e "${BLUE}━━━ Service Management Commands ━━━${NC}"
echo ""
echo "View PM2 processes:"
echo "  sudo su - nsromania -c 'pm2 list'"
echo ""
echo "View PM2 logs:"
echo "  sudo su - nsromania -c 'pm2 logs nsromania-setup'"
echo ""
echo "Restart control panel:"
echo "  sudo su - nsromania -c 'pm2 restart nsromania-setup'"
echo ""
echo "Check service status:"
echo "  systemctl status mysql"
echo "  systemctl status mongod"
echo "  systemctl status nginx"
echo "  systemctl status bind9"
echo ""

echo -e "${BLUE}━━━ Important File Locations ━━━${NC}"
echo ""
echo "Application: ${SETUP_DIR}"
echo "Nightscout: ${NS_HOME}/master"
echo "Configuration: ${CONFIG_FILE}"
echo "Environment: ${SETUP_DIR}/.env"
echo "Installation log: ${LOG_FILE}"
echo ""
echo "Nginx configs: /etc/nginx/sites-available/"
echo "DNS zone: /etc/bind/zones/${DOMAIN}"
echo "PM2 logs: /home/nsromania/.pm2/logs/"
echo ""

echo -e "${BLUE}━━━ Next Steps ━━━${NC}"
echo ""
echo "1. Access your control panel at https://${DOMAIN}"
echo ""
echo "2. Sign in using one of these methods:"
echo "   - Magic link (email)"
echo "   - GitHub OAuth"
echo "   - Google OAuth"
echo ""
echo "3. Configure OAuth callback URLs:"
echo "   GitHub: https://${DOMAIN}/api/auth/callback/github"
echo "   Google: https://${DOMAIN}/api/auth/callback/google"
echo ""
echo "4. Your admin account (${ADMIN_EMAIL}) should already have admin privileges"
echo ""
echo "5. Start accepting Nightscout registration requests!"
echo ""

echo -e "${YELLOW}━━━ Security Reminder ━━━${NC}"
echo ""
echo "Important: The configuration file contains sensitive information:"
echo "  ${CONFIG_FILE}"
echo ""
echo "Consider:"
echo "  - Backing it up to a secure location"
echo "  - Deleting it from the server: rm ${CONFIG_FILE}"
echo ""

log_success "Post-installation verification completed"
