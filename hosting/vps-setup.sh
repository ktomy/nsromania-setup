#!/bin/bash

################################################################################
# Nightscout Community Control Panel - VPS Setup Script
# 
# This script automates the complete setup of a fresh Ubuntu 24.04 LTS VPS
# to host multiple Nightscout instances with the control panel.
#
# Prerequisites:
# - Fresh Ubuntu 24.04 LTS VPS
# - Root or sudo access
# - Domain name with DNS control
# - Brevo API key for email sending
# - (Optional) OAuth credentials for GitHub/Google authentication
#
# Usage: 
#   Direct: sudo bash vps-setup.sh
#   Remote: bash <(curl -fsSL https://raw.githubusercontent.com/ktomy/nsromania-setup/main/hosting/vps-setup.sh)
################################################################################

set -e  # Exit on error
set -u  # Exit on undefined variable

# Redirect stdin from tty to allow interactive input when piped
exec < /dev/tty

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Global variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/nsromania"
SETUP_DIR="${INSTALL_DIR}/setup"
NS_HOME="${INSTALL_DIR}/nightscout"
LOG_FILE="/var/log/nsromania-setup.log"
CONFIG_FILE="${INSTALL_DIR}/.install-config.json"

# Function to print colored messages
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

# Function to display progress
show_progress() {
    local current=$1
    local total=$2
    local message=$3
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Step $current of $total: $message${NC}"
    echo -e "${BLUE}========================================${NC}"
}

# Function to check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root or with sudo"
        exit 1
    fi
}

# Function to verify Ubuntu 24.04
check_os() {
    log_info "Checking operating system..."
    
    if [[ ! -f /etc/os-release ]]; then
        log_error "Cannot determine OS version"
        exit 1
    fi
    
    source /etc/os-release
    
    if [[ "$ID" != "ubuntu" ]]; then
        log_error "This script is designed for Ubuntu. Detected: $ID"
        exit 1
    fi
    
    if [[ "$VERSION_ID" != "24.04" ]]; then
        log_warning "This script is optimized for Ubuntu 24.04. Detected: $VERSION_ID"
        read -p "Do you want to continue anyway? (yes/no): " continue_anyway
        if [[ "$continue_anyway" != "yes" ]]; then
            exit 1
        fi
    fi
    
    log_success "Operating system check passed: Ubuntu $VERSION_ID"
}

# Function to perform DNS preflight check
check_dns_preflight() {
    local domain=$1
    
    log_info "Performing DNS preflight check for $domain..."
    
    # Get VPS public IP
    local vps_ip=$(curl -s -4 ifconfig.me || echo "")
    
    if [[ -z "$vps_ip" ]]; then
        log_warning "Could not determine VPS public IP address"
        return 1
    fi
    
    log_info "VPS public IP: $vps_ip"
    
    # Check A record for main domain
    local domain_ip=$(dig +short A "$domain" @8.8.8.8 | head -n1 || echo "")
    
    if [[ -z "$domain_ip" ]]; then
        log_warning "DNS A record for $domain not found"
        log_warning "Please ensure you have created an A record pointing $domain to $vps_ip"
        return 1
    fi
    
    if [[ "$domain_ip" != "$vps_ip" ]]; then
        log_warning "DNS A record for $domain points to $domain_ip but VPS IP is $vps_ip"
        log_warning "Please update your DNS A record to point to $vps_ip"
        return 1
    fi
    
    log_success "DNS preflight check passed"
    return 0
}

# Function to display banner
show_banner() {
    clear
    echo -e "${GREEN}"
    cat << "EOF"
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   Nightscout Community Control Panel - VPS Setup         ║
    ║                                                           ║
    ║   This wizard will guide you through the complete        ║
    ║   installation of the Nightscout hosting platform        ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    echo ""
}

# Function to run configuration wizard
run_wizard() {
    show_banner
    
    log_info "Starting configuration wizard..."
    echo ""
    
    # Domain configuration
    echo -e "${BLUE}━━━ Domain Configuration ━━━${NC}"
    read -p "Enter your domain name (e.g., nsromania.info): " DOMAIN
    while [[ -z "$DOMAIN" || ! "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]]; do
        log_error "Invalid domain name"
        read -p "Enter your domain name: " DOMAIN
    done
    
    # Perform DNS preflight check (warning only)
    if ! check_dns_preflight "$DOMAIN"; then
        log_warning "DNS preflight check failed, but continuing..."
        echo ""
        read -p "Press Enter to continue..."
    fi
    
    echo ""
    
    # Database configuration
    echo -e "${BLUE}━━━ Database Configuration ━━━${NC}"
    read -p "MySQL root password: " -s MYSQL_ROOT_PASSWORD
    echo ""
    while [[ -z "$MYSQL_ROOT_PASSWORD" ]]; do
        log_error "MySQL root password cannot be empty"
        read -p "MySQL root password: " -s MYSQL_ROOT_PASSWORD
        echo ""
    done
    
    read -p "MySQL database user (default: nsromania): " MYSQL_USER
    MYSQL_USER=${MYSQL_USER:-nsromania}
    
    read -p "MySQL database user password: " -s MYSQL_PASSWORD
    echo ""
    while [[ -z "$MYSQL_PASSWORD" ]]; do
        log_error "MySQL user password cannot be empty"
        read -p "MySQL database user password: " -s MYSQL_PASSWORD
        echo ""
    done
    
    read -p "MongoDB root password: " -s MONGO_ROOT_PASSWORD
    echo ""
    while [[ -z "$MONGO_ROOT_PASSWORD" ]]; do
        log_error "MongoDB root password cannot be empty"
        read -p "MongoDB root password: " -s MONGO_ROOT_PASSWORD
        echo ""
    done
    
    echo ""
    
    # Admin user configuration
    echo -e "${BLUE}━━━ Admin User Configuration ━━━${NC}"
    read -p "Admin email: " ADMIN_EMAIL
    while [[ -z "$ADMIN_EMAIL" || ! "$ADMIN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; do
        log_error "Invalid email address"
        read -p "Admin email: " ADMIN_EMAIL
    done
    
    read -p "Admin name: " ADMIN_NAME
    while [[ -z "$ADMIN_NAME" ]]; do
        log_error "Admin name cannot be empty"
        read -p "Admin name: " ADMIN_NAME
    done
    
    echo ""
    
    # Email service configuration (Brevo)
    echo -e "${BLUE}━━━ Email Service Configuration (Brevo) ━━━${NC}"
    read -p "Brevo API key: " BREVO_API_KEY
    while [[ -z "$BREVO_API_KEY" ]]; do
        log_error "Brevo API key is required"
        read -p "Brevo API key: " BREVO_API_KEY
    done
    
    read -p "Brevo SMTP user: " BREVO_SMTP_USER
    while [[ -z "$BREVO_SMTP_USER" ]]; do
        log_error "Brevo SMTP user is required"
        read -p "Brevo SMTP user: " BREVO_SMTP_USER
    done
    
    read -p "Brevo SMTP password: " -s BREVO_SMTP_PASSWORD
    echo ""
    while [[ -z "$BREVO_SMTP_PASSWORD" ]]; do
        log_error "Brevo SMTP password is required"
        read -p "Brevo SMTP password: " -s BREVO_SMTP_PASSWORD
        echo ""
    done
    
    echo ""
    
    # reCAPTCHA configuration
    echo -e "${BLUE}━━━ reCAPTCHA Configuration ━━━${NC}"
    read -p "reCAPTCHA site key: " RECAPTCHA_SITE_KEY
    read -p "reCAPTCHA secret key: " RECAPTCHA_SECRET_KEY
    
    echo ""
    
    # OAuth configuration (optional)
    echo -e "${BLUE}━━━ OAuth Configuration (Optional) ━━━${NC}"
    echo "Press Enter to skip if you don't have OAuth credentials yet"
    echo ""
    
    read -p "GitHub Client ID (optional): " GITHUB_CLIENT_ID
    if [[ -n "$GITHUB_CLIENT_ID" ]]; then
        read -p "GitHub Client Secret: " GITHUB_CLIENT_SECRET
    else
        GITHUB_CLIENT_SECRET=""
    fi
    
    echo ""
    
    read -p "Google Client ID (optional): " GOOGLE_CLIENT_ID
    if [[ -n "$GOOGLE_CLIENT_ID" ]]; then
        read -p "Google Client Secret: " GOOGLE_CLIENT_SECRET
    else
        GOOGLE_CLIENT_SECRET=""
    fi
    
    echo ""
    
    # DNS provider for SSL wildcard certificate
    echo -e "${BLUE}━━━ SSL Certificate Configuration ━━━${NC}"
    echo "For wildcard SSL certificate, we need DNS API access."
    echo "Supported providers: cloudflare, route53, manual"
    echo ""
    read -p "DNS provider (cloudflare/route53/manual): " DNS_PROVIDER
    DNS_PROVIDER=${DNS_PROVIDER:-manual}
    
    if [[ "$DNS_PROVIDER" == "cloudflare" ]]; then
        read -p "Cloudflare API Token: " CF_API_TOKEN
        read -p "Cloudflare Email: " CF_EMAIL
    elif [[ "$DNS_PROVIDER" == "route53" ]]; then
        read -p "AWS Access Key ID: " AWS_ACCESS_KEY_ID
        read -p "AWS Secret Access Key: " -s AWS_SECRET_ACCESS_KEY
        echo ""
    fi
    
    # Generate AUTH_SECRET (32 random bytes, base64 encoded)
    AUTH_SECRET=$(openssl rand -base64 32)
    
    # Save configuration
    mkdir -p "$(dirname "$CONFIG_FILE")"
    cat > "$CONFIG_FILE" << EOF
{
  "domain": "$DOMAIN",
  "mysql_root_password": "$MYSQL_ROOT_PASSWORD",
  "mysql_user": "$MYSQL_USER",
  "mysql_password": "$MYSQL_PASSWORD",
  "mongo_root_password": "$MONGO_ROOT_PASSWORD",
  "admin_email": "$ADMIN_EMAIL",
  "admin_name": "$ADMIN_NAME",
  "brevo_api_key": "$BREVO_API_KEY",
  "brevo_smtp_user": "$BREVO_SMTP_USER",
  "brevo_smtp_password": "$BREVO_SMTP_PASSWORD",
  "recaptcha_site_key": "$RECAPTCHA_SITE_KEY",
  "recaptcha_secret_key": "$RECAPTCHA_SECRET_KEY",
  "github_client_id": "$GITHUB_CLIENT_ID",
  "github_client_secret": "$GITHUB_CLIENT_SECRET",
  "google_client_id": "$GOOGLE_CLIENT_ID",
  "google_client_secret": "$GOOGLE_CLIENT_SECRET",
  "auth_secret": "$AUTH_SECRET",
  "dns_provider": "$DNS_PROVIDER",
  "install_dir": "$INSTALL_DIR",
  "setup_dir": "$SETUP_DIR",
  "ns_home": "$NS_HOME"
}
EOF
    
    chmod 600 "$CONFIG_FILE"
    
    log_success "Configuration saved to $CONFIG_FILE"
    echo ""
    
    # Display configuration summary
    echo -e "${BLUE}━━━ Configuration Summary ━━━${NC}"
    echo "Domain: $DOMAIN"
    echo "MySQL User: $MYSQL_USER"
    echo "Admin Email: $ADMIN_EMAIL"
    echo "Admin Name: $ADMIN_NAME"
    echo "DNS Provider: $DNS_PROVIDER"
    echo "Install Directory: $INSTALL_DIR"
    echo ""
    
    read -p "Is this configuration correct? (yes/no): " confirm
    if [[ "$confirm" != "yes" ]]; then
        log_error "Installation cancelled by user"
        rm -f "$CONFIG_FILE"
        exit 1
    fi
    
    log_success "Configuration confirmed"
}

# Function to load configuration
load_config() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        log_error "Configuration file not found. Please run the wizard first."
        exit 1
    fi
    
    # Export variables from config file
    export DOMAIN=$(jq -r '.domain' "$CONFIG_FILE")
    export MYSQL_ROOT_PASSWORD=$(jq -r '.mysql_root_password' "$CONFIG_FILE")
    export MYSQL_USER=$(jq -r '.mysql_user' "$CONFIG_FILE")
    export MYSQL_PASSWORD=$(jq -r '.mysql_password' "$CONFIG_FILE")
    export MONGO_ROOT_PASSWORD=$(jq -r '.mongo_root_password' "$CONFIG_FILE")
    export ADMIN_EMAIL=$(jq -r '.admin_email' "$CONFIG_FILE")
    export ADMIN_NAME=$(jq -r '.admin_name' "$CONFIG_FILE")
    export BREVO_API_KEY=$(jq -r '.brevo_api_key' "$CONFIG_FILE")
    export BREVO_SMTP_USER=$(jq -r '.brevo_smtp_user' "$CONFIG_FILE")
    export BREVO_SMTP_PASSWORD=$(jq -r '.brevo_smtp_password' "$CONFIG_FILE")
    export RECAPTCHA_SITE_KEY=$(jq -r '.recaptcha_site_key' "$CONFIG_FILE")
    export RECAPTCHA_SECRET_KEY=$(jq -r '.recaptcha_secret_key' "$CONFIG_FILE")
    export GITHUB_CLIENT_ID=$(jq -r '.github_client_id' "$CONFIG_FILE")
    export GITHUB_CLIENT_SECRET=$(jq -r '.github_client_secret' "$CONFIG_FILE")
    export GOOGLE_CLIENT_ID=$(jq -r '.google_client_id' "$CONFIG_FILE")
    export GOOGLE_CLIENT_SECRET=$(jq -r '.google_client_secret' "$CONFIG_FILE")
    export AUTH_SECRET=$(jq -r '.auth_secret' "$CONFIG_FILE")
    export DNS_PROVIDER=$(jq -r '.dns_provider' "$CONFIG_FILE")
}

# Main installation function
main() {
    # Initialize log file
    mkdir -p "$(dirname "$LOG_FILE")"
    touch "$LOG_FILE"
    chmod 644 "$LOG_FILE"
    
    log_info "Nightscout Community Control Panel - VPS Setup Started"
    log_info "Timestamp: $(date)"
    
    # Preliminary checks
    check_root
    check_os
    
    # Run wizard if config doesn't exist
    if [[ ! -f "$CONFIG_FILE" ]]; then
        run_wizard
    else
        log_info "Found existing configuration file"
        read -p "Use existing configuration? (yes/no): " use_existing
        if [[ "$use_existing" != "yes" ]]; then
            rm -f "$CONFIG_FILE"
            run_wizard
        fi
    fi
    
    # Load configuration
    load_config
    
    # Determine scripts directory
    local SCRIPTS_DIR
    if [[ -d "$SCRIPT_DIR/scripts" ]]; then
        SCRIPTS_DIR="$SCRIPT_DIR/scripts"
    else
        # Download scripts from GitHub if not running from repo
        SCRIPTS_DIR="/tmp/nsromania-setup-scripts"
        mkdir -p "$SCRIPTS_DIR"
        log_info "Downloading installation scripts..."
        # This will be implemented to download from GitHub releases
    fi
    
    # Execute installation scripts in sequence
    local total_steps=12
    local current_step=0
    
    # Step 1: System Updates
    ((current_step++))
    show_progress $current_step $total_steps "System Updates and Package Installation"
    bash "$SCRIPTS_DIR/01-system-updates.sh"
    
    # Step 2: User Setup
    ((current_step++))
    show_progress $current_step $total_steps "User and Permissions Setup"
    bash "$SCRIPTS_DIR/02-user-setup.sh"
    
    # Step 3: Node.js Setup
    ((current_step++))
    show_progress $current_step $total_steps "Node.js and NVM Installation"
    bash "$SCRIPTS_DIR/03-nodejs-setup.sh"
    
    # Step 4: Database Setup
    ((current_step++))
    show_progress $current_step $total_steps "MySQL and MongoDB Installation"
    bash "$SCRIPTS_DIR/04-database-setup.sh"
    
    # Step 5: Nginx Setup
    ((current_step++))
    show_progress $current_step $total_steps "Nginx Web Server Configuration"
    bash "$SCRIPTS_DIR/05-nginx-setup.sh"
    
    # Step 6: BIND9 DNS Setup
    ((current_step++))
    show_progress $current_step $total_steps "BIND9 DNS Server Configuration"
    bash "$SCRIPTS_DIR/06-bind-setup.sh"
    
    # Step 7: PM2 Setup
    ((current_step++))
    show_progress $current_step $total_steps "PM2 Process Manager Installation"
    bash "$SCRIPTS_DIR/07-pm2-setup.sh"
    
    # Step 8: Nightscout Installation
    ((current_step++))
    show_progress $current_step $total_steps "Nightscout Master Installation"
    bash "$SCRIPTS_DIR/08-nightscout-install.sh"
    
    # Step 9: Control Panel Deployment
    ((current_step++))
    show_progress $current_step $total_steps "Control Panel Deployment"
    bash "$SCRIPTS_DIR/09-app-deploy.sh"
    
    # Step 10: Firewall Setup
    ((current_step++))
    show_progress $current_step $total_steps "Firewall and Security Configuration"
    bash "$SCRIPTS_DIR/10-firewall-setup.sh"
    
    # Step 11: Monitoring Setup
    ((current_step++))
    show_progress $current_step $total_steps "Logging and Monitoring Setup"
    bash "$SCRIPTS_DIR/11-monitoring-setup.sh"
    
    # Step 12: Post-Install Checks
    ((current_step++))
    show_progress $current_step $total_steps "Post-Installation Verification"
    bash "$SCRIPTS_DIR/12-post-install-checks.sh"
    
    # Display success message
    echo ""
    echo -e "${GREEN}"
    cat << "EOF"
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   🎉 Installation Complete! 🎉                           ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    echo ""
    
    log_success "Installation completed successfully!"
    echo ""
    echo -e "${BLUE}━━━ Access Information ━━━${NC}"
    echo "Control Panel URL: https://$DOMAIN"
    echo "Admin Email: $ADMIN_EMAIL"
    echo "Admin Name: $ADMIN_NAME"
    echo ""
    echo -e "${BLUE}━━━ Next Steps ━━━${NC}"
    echo "1. Log in to the control panel using your OAuth provider or magic link"
    echo "2. Your account should already have admin privileges"
    echo "3. Review the registration requests and approve new Nightscout instances"
    echo "4. Configure your OAuth callback URLs in GitHub/Google:"
    echo "   - GitHub: https://$DOMAIN/api/auth/callback/github"
    echo "   - Google: https://$DOMAIN/api/auth/callback/google"
    echo ""
    echo -e "${BLUE}━━━ Important Files ━━━${NC}"
    echo "Configuration: $CONFIG_FILE"
    echo "Application: $SETUP_DIR"
    echo "Nightscout: $NS_HOME"
    echo "Logs: $LOG_FILE"
    echo ""
    echo -e "${YELLOW}Note: Please save your configuration file securely and delete it after setup!${NC}"
    echo ""
}

# Run main function
main "$@"
