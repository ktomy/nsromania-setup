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

# Initialize all variables that will be used in the wizard
DOMAIN=""
MYSQL_ROOT_PASSWORD=""
MYSQL_USER=""
MYSQL_PASSWORD=""
MONGO_ROOT_PASSWORD=""
ADMIN_EMAIL=""
ADMIN_NAME=""
BREVO_API_KEY=""
RECAPTCHA_SITE_KEY=""
RECAPTCHA_SECRET_KEY=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
PORKBUN_API_KEY=""
PORKBUN_SECRET_KEY=""
AUTH_SECRET=""

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
        read -p "Do you want to continue anyway? (Y/n) [Y]: " continue_anyway
        continue_anyway=${continue_anyway:-y}
        if [[ "$continue_anyway" =~ ^[Nn] ]]; then
            exit 1
        fi
    fi
    
    log_success "Operating system check passed: Ubuntu $VERSION_ID"
}

# Function to perform DNS preflight check
check_dns_preflight() {
    local domain=$1
    
    log_info "Performing DNS preflight check for $domain..."
    
    # Check if domain nameservers are pointing to Porkbun
    local nameservers=$(dig +short NS "$domain" @8.8.8.8 | sort || echo "")
    
    if [[ -z "$nameservers" ]]; then
        log_warning "No nameservers found for $domain"
        log_warning "Please ensure your domain is using Porkbun nameservers:"
        log_warning "  - curitiba.ns.porkbun.com"
        log_warning "  - fortaleza.ns.porkbun.com"
        log_warning "  - maceio.ns.porkbun.com"
        log_warning "  - salvador.ns.porkbun.com"
        return 1
    fi
    
    log_info "Current nameservers for $domain:"
    echo "$nameservers" | while read ns; do
        log_info "  - $ns"
    done
    
    # Check if any Porkbun nameserver is present
    if echo "$nameservers" | grep -qi "porkbun.com"; then
        log_success "Domain is using Porkbun nameservers"
        return 0
    else
        log_warning "Domain is not using Porkbun nameservers"
        log_warning "Please update your domain's nameservers to:"
        log_warning "  - curitiba.ns.porkbun.com"
        log_warning "  - fortaleza.ns.porkbun.com"
        log_warning "  - maceio.ns.porkbun.com"
        log_warning "  - salvador.ns.porkbun.com"
        return 1
    fi
}

# Function to save wizard progress
save_wizard_progress() {
    local step=$1
    local progress_file="${INSTALL_DIR}/.wizard-progress.json"
    mkdir -p "$(dirname "$progress_file")"
    
    cat > "$progress_file" << EOF
{
  "last_step": "$step",
  "domain": "${DOMAIN:-}",
  "mysql_user": "${MYSQL_USER:-}",
  "admin_email": "${ADMIN_EMAIL:-}",
  "admin_name": "${ADMIN_NAME:-}",
  "brevo_api_key": "${BREVO_API_KEY:-}",
  "recaptcha_site_key": "${RECAPTCHA_SITE_KEY:-}",
  "recaptcha_secret_key": "${RECAPTCHA_SECRET_KEY:-}",
  "github_client_id": "${GITHUB_CLIENT_ID:-}",
  "github_client_secret": "${GITHUB_CLIENT_SECRET:-}",
  "google_client_id": "${GOOGLE_CLIENT_ID:-}",
  "google_client_secret": "${GOOGLE_CLIENT_SECRET:-}",
  "porkbun_api_key": "${PORKBUN_API_KEY:-}",
  "porkbun_secret_key": "${PORKBUN_SECRET_KEY:-}"
}
EOF
    chmod 600 "$progress_file"
}

# Function to load wizard progress
load_wizard_progress() {
    local progress_file="${INSTALL_DIR}/.wizard-progress.json"
    
    if [[ ! -f "$progress_file" ]]; then
        return 1
    fi
    
    DOMAIN=$(jq -r '.domain // ""' "$progress_file")
    MYSQL_USER=$(jq -r '.mysql_user // ""' "$progress_file")
    ADMIN_EMAIL=$(jq -r '.admin_email // ""' "$progress_file")
    ADMIN_NAME=$(jq -r '.admin_name // ""' "$progress_file")
    BREVO_API_KEY=$(jq -r '.brevo_api_key // ""' "$progress_file")
    RECAPTCHA_SITE_KEY=$(jq -r '.recaptcha_site_key // ""' "$progress_file")
    RECAPTCHA_SECRET_KEY=$(jq -r '.recaptcha_secret_key // ""' "$progress_file")
    GITHUB_CLIENT_ID=$(jq -r '.github_client_id // ""' "$progress_file")
    GITHUB_CLIENT_SECRET=$(jq -r '.github_client_secret // ""' "$progress_file")
    GOOGLE_CLIENT_ID=$(jq -r '.google_client_id // ""' "$progress_file")
    GOOGLE_CLIENT_SECRET=$(jq -r '.google_client_secret // ""' "$progress_file")
    PORKBUN_API_KEY=$(jq -r '.porkbun_api_key // ""' "$progress_file")
    PORKBUN_SECRET_KEY=$(jq -r '.porkbun_secret_key // ""' "$progress_file")
    
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
    
    # Try to load previous progress (use || true to prevent set -e from exiting)
    if load_wizard_progress || true; then
        if [[ -f "${INSTALL_DIR}/.wizard-progress.json" ]]; then
            log_info "Found previous wizard session"
            echo ""
            read -p "Resume from previous session? (Y/n) [Y]: " resume_wizard
            resume_wizard=${resume_wizard:-y}
            if [[ "$resume_wizard" =~ ^[Yy] ]]; then
                # Clear all loaded values
                DOMAIN=""
                MYSQL_USER=""
                ADMIN_EMAIL=""
                ADMIN_NAME=""
                BREVO_API_KEY=""
                RECAPTCHA_SITE_KEY=""
                RECAPTCHA_SECRET_KEY=""
                GITHUB_CLIENT_ID=""
                GITHUB_CLIENT_SECRET=""
            GOOGLE_CLIENT_ID=""
            GOOGLE_CLIENT_SECRET=""
            PORKBUN_API_KEY=""
            PORKBUN_SECRET_KEY=""
        fi
    fi
fi

echo ""
    
    # Domain configuration
    echo -e "${BLUE}━━━ Domain Configuration ━━━${NC}"
    if [[ -n "$DOMAIN" ]]; then
        log_info "Previous value: $DOMAIN"
        read -p "Press Enter to keep, or enter new domain: " new_domain
        if [[ -n "$new_domain" ]]; then
            DOMAIN="$new_domain"
        fi
    else
        read -p "Enter your domain name (e.g., nsromania.info): " DOMAIN
    fi
    
    while [[ -z "$DOMAIN" || ! "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]]; do
        log_error "Invalid domain name"
        read -p "Enter your domain name: " DOMAIN
    done
    
    save_wizard_progress "domain"
    
    # Perform DNS preflight check (warning only)
    if ! check_dns_preflight "$DOMAIN"; then
        log_warning "DNS preflight check failed, but continuing..."
        echo ""
        read -p "Press Enter to continue..."
    fi
    
    echo ""
    
    # Database configuration
    echo -e "${BLUE}━━━ Database Configuration ━━━${NC}"
    echo -e "${YELLOW}⚠️  IMPORTANT: Generated passwords will be shown once and NOT saved!${NC}"
    echo -e "${YELLOW}    Please write them down in a secure location.${NC}"
    echo ""
    
    read -p "Generate MySQL root password automatically? (Y/n) [Y]: " gen_mysql_root
    gen_mysql_root=${gen_mysql_root:-y}
    if [[ "$gen_mysql_root" =~ ^[Yy] ]]; then
        MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24)
        echo -e "${GREEN}Generated MySQL root password: ${MYSQL_ROOT_PASSWORD}${NC}"
        echo -e "${YELLOW}⚠️  WRITE THIS DOWN - It will not be shown again!${NC}"
        read -p "Press Enter after you have saved this password..." _
    else
        read -p "MySQL root password: " -s MYSQL_ROOT_PASSWORD
        echo ""
        while [[ -z "$MYSQL_ROOT_PASSWORD" ]]; do
            log_error "MySQL root password cannot be empty"
            read -p "MySQL root password: " -s MYSQL_ROOT_PASSWORD
            echo ""
        done
    fi
    
    if [[ -n "$MYSQL_USER" ]]; then
        log_info "Previous MySQL user: $MYSQL_USER"
        read -p "Press Enter to keep, or enter new user: " new_user
        if [[ -n "$new_user" ]]; then
            MYSQL_USER="$new_user"
        fi
    else
        read -p "MySQL database user (default: nsromania): " MYSQL_USER
        MYSQL_USER=${MYSQL_USER:-nsromania}
    fi
    
    read -p "Generate MySQL user password automatically? (Y/n) [Y]: " gen_mysql_pass
    gen_mysql_pass=${gen_mysql_pass:-y}
    if [[ "$gen_mysql_pass" =~ ^[Yy] ]]; then
        MYSQL_PASSWORD=$(openssl rand -base64 24)
        echo -e "${GREEN}Generated MySQL password for $MYSQL_USER: ${MYSQL_PASSWORD}${NC}"
        echo -e "${YELLOW}⚠️  WRITE THIS DOWN - It will not be shown again!${NC}"
        read -p "Press Enter after you have saved this password..." _
    else
        read -p "MySQL database user password: " -s MYSQL_PASSWORD
        echo ""
        while [[ -z "$MYSQL_PASSWORD" ]]; do
            log_error "MySQL user password cannot be empty"
            read -p "MySQL database user password: " -s MYSQL_PASSWORD
            echo ""
        done
    fi
    
    read -p "Generate MongoDB root password automatically? (Y/n) [Y]: " gen_mongo_pass
    gen_mongo_pass=${gen_mongo_pass:-y}
    if [[ "$gen_mongo_pass" =~ ^[Yy] ]]; then
        MONGO_ROOT_PASSWORD=$(openssl rand -base64 24)
        echo -e "${GREEN}Generated MongoDB root password: ${MONGO_ROOT_PASSWORD}${NC}"
        echo -e "${YELLOW}⚠️  WRITE THIS DOWN - It will not be shown again!${NC}"
        read -p "Press Enter after you have saved this password..." _
    else
        read -p "MongoDB root password: " -s MONGO_ROOT_PASSWORD
        echo ""
        while [[ -z "$MONGO_ROOT_PASSWORD" ]]; do
            log_error "MongoDB root password cannot be empty"
            read -p "MongoDB root password: " -s MONGO_ROOT_PASSWORD
            echo ""
        done
    fi
    
    save_wizard_progress "database"
    
    echo ""
    
    # Admin user configuration
    echo -e "${BLUE}━━━ Admin User Configuration ━━━${NC}"
    if [[ -n "$ADMIN_EMAIL" ]]; then
        log_info "Previous admin email: $ADMIN_EMAIL"
        read -p "Press Enter to keep, or enter new email: " new_email
        if [[ -n "$new_email" ]]; then
            ADMIN_EMAIL="$new_email"
        fi
    else
        read -p "Admin email: " ADMIN_EMAIL
    fi
    
    while [[ -z "$ADMIN_EMAIL" || ! "$ADMIN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; do
        log_error "Invalid email address"
        read -p "Admin email: " ADMIN_EMAIL
    done
    
    if [[ -n "$ADMIN_NAME" ]]; then
        log_info "Previous admin name: $ADMIN_NAME"
        read -p "Press Enter to keep, or enter new name: " new_name
        if [[ -n "$new_name" ]]; then
            ADMIN_NAME="$new_name"
        fi
    else
        read -p "Admin name: " ADMIN_NAME
    fi
    
    while [[ -z "$ADMIN_NAME" ]]; do
        log_error "Admin name cannot be empty"
        read -p "Admin name: " ADMIN_NAME
    done
    
    save_wizard_progress "admin"
    
    echo ""
    
    # Email service configuration (Brevo API only)
    echo -e "${BLUE}━━━ Email Service Configuration (Brevo) ━━━${NC}"
    if [[ -n "$BREVO_API_KEY" ]]; then
        log_info "Previous Brevo API key found"
        read -p "Press Enter to keep, or enter new API key: " new_key
        if [[ -n "$new_key" ]]; then
            BREVO_API_KEY="$new_key"
        fi
    else
        read -p "Brevo API key: " BREVO_API_KEY
    fi
    
    while [[ -z "$BREVO_API_KEY" ]]; do
        log_error "Brevo API key is required"
        read -p "Brevo API key: " BREVO_API_KEY
    done
    
    save_wizard_progress "email"
    
    echo ""
    
    # reCAPTCHA configuration
    echo -e "${BLUE}━━━ reCAPTCHA Configuration ━━━${NC}"
    if [[ -n "$RECAPTCHA_SITE_KEY" ]]; then
        log_info "Previous reCAPTCHA site key found"
        read -p "Press Enter to keep, or enter new site key: " new_site_key
        if [[ -n "$new_site_key" ]]; then
            RECAPTCHA_SITE_KEY="$new_site_key"
        fi
    else
        read -p "reCAPTCHA site key: " RECAPTCHA_SITE_KEY
    fi
    
    if [[ -n "$RECAPTCHA_SECRET_KEY" ]]; then
        log_info "Previous reCAPTCHA secret key found"
        read -p "Press Enter to keep, or enter new secret key: " new_secret_key
        if [[ -n "$new_secret_key" ]]; then
            RECAPTCHA_SECRET_KEY="$new_secret_key"
        fi
    else
        read -p "reCAPTCHA secret key: " RECAPTCHA_SECRET_KEY
    fi
    
    save_wizard_progress "recaptcha"
    
    echo ""
    
    # OAuth configuration (optional)
    echo -e "${BLUE}━━━ OAuth Configuration (Optional) ━━━${NC}"
    echo "Press Enter to skip if you don't have OAuth credentials yet"
    echo ""
    
    if [[ -n "$GITHUB_CLIENT_ID" ]]; then
        log_info "Previous GitHub Client ID: $GITHUB_CLIENT_ID"
        read -p "Press Enter to keep, or enter new ID: " new_gh_id
        if [[ -n "$new_gh_id" ]]; then
            GITHUB_CLIENT_ID="$new_gh_id"
            GITHUB_CLIENT_SECRET=""  # Reset secret if ID changes
        fi
    else
        read -p "GitHub Client ID (optional): " GITHUB_CLIENT_ID
    fi
    
    if [[ -n "$GITHUB_CLIENT_ID" ]]; then
        if [[ -n "$GITHUB_CLIENT_SECRET" ]]; then
            log_info "Previous GitHub Client Secret found"
            read -p "Press Enter to keep, or enter new secret: " new_gh_secret
            if [[ -n "$new_gh_secret" ]]; then
                GITHUB_CLIENT_SECRET="$new_gh_secret"
            fi
        else
            read -p "GitHub Client Secret: " GITHUB_CLIENT_SECRET
        fi
    else
        GITHUB_CLIENT_SECRET=""
    fi
    
    echo ""
    
    if [[ -n "$GOOGLE_CLIENT_ID" ]]; then
        log_info "Previous Google Client ID found"
        read -p "Press Enter to keep, or enter new ID: " new_g_id
        if [[ -n "$new_g_id" ]]; then
            GOOGLE_CLIENT_ID="$new_g_id"
            GOOGLE_CLIENT_SECRET=""  # Reset secret if ID changes
        fi
    else
        read -p "Google Client ID (optional): " GOOGLE_CLIENT_ID
    fi
    
    if [[ -n "$GOOGLE_CLIENT_ID" ]]; then
        if [[ -n "$GOOGLE_CLIENT_SECRET" ]]; then
            log_info "Previous Google Client Secret found"
            read -p "Press Enter to keep, or enter new secret: " new_g_secret
            if [[ -n "$new_g_secret" ]]; then
                GOOGLE_CLIENT_SECRET="$new_g_secret"
            fi
        else
            read -p "Google Client Secret: " GOOGLE_CLIENT_SECRET
        fi
    else
        GOOGLE_CLIENT_SECRET=""
    fi
    
    save_wizard_progress "oauth"
    
    echo ""
    
    # Porkbun DNS Configuration for SSL and DNS management
    echo -e "${BLUE}━━━ Porkbun DNS Configuration ━━━${NC}"
    echo "Porkbun will be used for DNS management and SSL certificate validation."
    echo ""
    
    if [[ -n "$PORKBUN_API_KEY" ]]; then
        log_info "Previous Porkbun API Key found"
        read -p "Press Enter to keep, or enter new API key: " new_pb_key
        if [[ -n "$new_pb_key" ]]; then
            PORKBUN_API_KEY="$new_pb_key"
        fi
    else
        read -p "Porkbun API Key: " PORKBUN_API_KEY
    fi
    
    while [[ -z "$PORKBUN_API_KEY" ]]; do
        log_error "Porkbun API Key is required"
        read -p "Porkbun API Key: " PORKBUN_API_KEY
    done
    
    if [[ -n "$PORKBUN_SECRET_KEY" ]]; then
        log_info "Previous Porkbun Secret Key found"
        read -p "Press Enter to keep, or enter new secret key: " new_pb_secret
        if [[ -n "$new_pb_secret" ]]; then
            PORKBUN_SECRET_KEY="$new_pb_secret"
        fi
    else
        read -p "Porkbun Secret Key: " PORKBUN_SECRET_KEY
    fi
    
    while [[ -z "$PORKBUN_SECRET_KEY" ]]; do
        log_error "Porkbun Secret Key is required"
        read -p "Porkbun Secret Key: " PORKBUN_SECRET_KEY
    done
    
    save_wizard_progress "porkbun"
    
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
  "recaptcha_site_key": "$RECAPTCHA_SITE_KEY",
  "recaptcha_secret_key": "$RECAPTCHA_SECRET_KEY",
  "github_client_id": "$GITHUB_CLIENT_ID",
  "github_client_secret": "$GITHUB_CLIENT_SECRET",
  "google_client_id": "$GOOGLE_CLIENT_ID",
  "google_client_secret": "$GOOGLE_CLIENT_SECRET",
  "auth_secret": "$AUTH_SECRET",
  "porkbun_api_key": "$PORKBUN_API_KEY",
  "porkbun_secret_key": "$PORKBUN_SECRET_KEY",
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
    echo "DNS Provider: Porkbun"
    echo "Install Directory: $INSTALL_DIR"
    echo ""
    
    # Validate confirmation input
    local confirm
    while true; do
        read -p "Is this configuration correct? (Y/n) [Y]: " confirm
        confirm=${confirm:-y}
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            break
        elif [[ "$confirm" =~ ^[Nn]$ ]]; then
            log_error "Installation cancelled by user"
            rm -f "$CONFIG_FILE"
            exit 1
        else
            log_warning "Please answer 'y' or 'n'"
        fi
    done
    
    # Remove wizard progress file after successful completion
    rm -f "${INSTALL_DIR}/.wizard-progress.json"
    
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
    export RECAPTCHA_SITE_KEY=$(jq -r '.recaptcha_site_key' "$CONFIG_FILE")
    export RECAPTCHA_SECRET_KEY=$(jq -r '.recaptcha_secret_key' "$CONFIG_FILE")
    export GITHUB_CLIENT_ID=$(jq -r '.github_client_id' "$CONFIG_FILE")
    export GITHUB_CLIENT_SECRET=$(jq -r '.github_client_secret' "$CONFIG_FILE")
    export GOOGLE_CLIENT_ID=$(jq -r '.google_client_id' "$CONFIG_FILE")
    export GOOGLE_CLIENT_SECRET=$(jq -r '.google_client_secret' "$CONFIG_FILE")
    export AUTH_SECRET=$(jq -r '.auth_secret' "$CONFIG_FILE")
    export PORKBUN_API_KEY=$(jq -r '.porkbun_api_key' "$CONFIG_FILE")
    export PORKBUN_SECRET_KEY=$(jq -r '.porkbun_secret_key' "$CONFIG_FILE")
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
    local start_step=1
    if [[ ! -f "$CONFIG_FILE" ]]; then
        run_wizard
    else
        log_info "Found existing configuration file"
        read -p "Use existing configuration? (Y/n) [Y]: " use_existing
        use_existing=${use_existing:-y}
        if [[ "$use_existing" =~ ^[Nn] ]]; then
            rm -f "$CONFIG_FILE"
            run_wizard
        else
            echo ""
            echo "Available steps to resume from:"
            echo "  1. System Updates and Package Installation"
            echo "  2. User and Permissions Setup"
            echo "  3. Node.js and NVM Installation"
            echo "  4. MySQL and MongoDB Installation"
            echo "  5. Nginx Web Server Configuration"
            echo "  6. Porkbun DNS Configuration"
            echo "  7. PM2 Process Manager Installation"
            echo "  8. Nightscout Master Installation"
            echo "  9. Control Panel Deployment"
            echo " 10. Firewall and Security Configuration"
            echo " 11. Logging and Monitoring Setup"
            echo " 12. Post-Installation Verification"
            read -p "Start from which step (1-12) [1]: " start_step_input
            start_step=${start_step_input:-1}
            if ! [[ "$start_step" =~ ^[0-9]+$ ]] || (( start_step < 1 || start_step > 12 )); then
                log_warning "Invalid step selected, defaulting to step 1"
                start_step=1
            fi
            # Check if MySQL is already installed and configured
            if command -v mysql >/dev/null 2>&1; then
                log_warning "MySQL appears to be already installed."
                log_warning "If you encounter password errors, you may need to:"
                log_warning "1. Stop and remove MySQL: systemctl stop mysql && apt-get purge -y mysql-server mysql-client"
                log_warning "2. Remove data directory: rm -rf /var/lib/mysql"
                log_warning "3. Re-run this script with fresh passwords"
                echo ""
                read -p "Continue with existing configuration? (Y/n) [Y]: " continue_anyway
                continue_anyway=${continue_anyway:-y}
                if [[ "$continue_anyway" =~ ^[Nn] ]]; then
                    log_error "Installation cancelled. Please clean up and start fresh."
                    exit 1
                fi
            fi
        fi
    fi
    
    # Load configuration
    load_config
    
    # Determine scripts directory
    local SCRIPTS_DIR
    local REPO_DIR
    
    if [[ -d "$SCRIPT_DIR/scripts" ]]; then
        # Running from local repo
        SCRIPTS_DIR="$SCRIPT_DIR/scripts"
        REPO_DIR="$(dirname "$SCRIPT_DIR")"
        log_info "Using local scripts from $SCRIPTS_DIR"
    else
        # Clone the repository
        REPO_DIR="/tmp/nsromania-setup-repo"
        SCRIPTS_DIR="$REPO_DIR/hosting/scripts"
        
        if [[ -d "$REPO_DIR" ]]; then
            log_info "Repository already cloned, pulling latest changes..."
            cd "$REPO_DIR"
            git stash -q 2>/dev/null || true  # Stash any local changes
            git pull -q origin main || log_warning "Failed to pull latest changes, using existing files"
        else
            log_info "Cloning repository from GitHub..."
            if ! git clone -q https://github.com/ktomy/nsromania-setup.git "$REPO_DIR"; then
                log_error "Failed to clone repository"
                exit 1
            fi
            log_success "Repository cloned successfully"
        fi
        
        # Make all scripts executable
        chmod +x "$SCRIPTS_DIR"/*.sh
    fi
    
    # Export paths for use by scripts
    export REPO_DIR
    export SEED_DATA_DIR="$REPO_DIR/seed-data"
    
    # Export functions and variables for child scripts
    export -f log_info log_success log_warning log_error show_progress
    export RED GREEN YELLOW BLUE NC
    export INSTALL_DIR SETUP_DIR NS_HOME LOG_FILE CONFIG_FILE
    export DOMAIN MYSQL_ROOT_PASSWORD MYSQL_USER MYSQL_PASSWORD
    export MONGO_ROOT_PASSWORD ADMIN_EMAIL ADMIN_NAME
    export BREVO_API_KEY RECAPTCHA_SITE_KEY RECAPTCHA_SECRET_KEY
    export GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET
    export GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
    export AUTH_SECRET PORKBUN_API_KEY PORKBUN_SECRET_KEY
    export CF_API_TOKEN CF_EMAIL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    
    # Execute installation scripts in sequence
    local total_steps=12
    local current_step=0
    
    # Step 1: System Updates
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (System Updates) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "System Updates and Package Installation"
        bash "$SCRIPTS_DIR/01-system-updates.sh"
    fi
    
    # Step 2: User Setup
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (User Setup) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "User and Permissions Setup"
        bash "$SCRIPTS_DIR/02-user-setup.sh"
    fi
    
    # Step 3: Node.js Setup
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (Node.js Setup) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "Node.js and NVM Installation"
        bash "$SCRIPTS_DIR/03-nodejs-setup.sh"
    fi
    
    # Step 4: Database Setup
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (Database Setup) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "MySQL and MongoDB Installation"
        bash "$SCRIPTS_DIR/04-database-setup.sh"
    fi
    
    # Step 5: Nginx Setup
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (Nginx Setup) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "Nginx Web Server Configuration"
        bash "$SCRIPTS_DIR/05-nginx-setup.sh"
    fi
    
    # Step 6: DNS Setup (Porkbun API)
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (Porkbun DNS) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "Porkbun DNS Configuration"
        bash "$SCRIPTS_DIR/06-porkbun-setup.sh"
    fi
    
    # Step 7: PM2 Setup
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (PM2 Setup) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "PM2 Process Manager Installation"
        bash "$SCRIPTS_DIR/07-pm2-setup.sh"
    fi
    
    # Step 8: Nightscout Installation
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (Nightscout Installation) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "Nightscout Master Installation"
        bash "$SCRIPTS_DIR/08-nightscout-install.sh"
    fi
    
    # Step 9: Control Panel Deployment
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (Control Panel Deployment) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "Control Panel Deployment"
        bash "$SCRIPTS_DIR/09-app-deploy.sh"
    fi
    
    # Step 10: Firewall Setup
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (Firewall and Security) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "Firewall and Security Configuration"
        bash "$SCRIPTS_DIR/10-firewall-setup.sh"
    fi
    
    # Step 11: Monitoring Setup
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (Monitoring Setup) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "Logging and Monitoring Setup"
        bash "$SCRIPTS_DIR/11-monitoring-setup.sh"
    fi
    
    # Step 12: Post-Install Checks
    current_step=$((current_step + 1))
    if (( current_step < start_step )); then
        log_info "Skipping Step $current_step (Post-Installation Verification) - starting from step $start_step"
    else
        show_progress $current_step $total_steps "Post-Installation Verification"
        bash "$SCRIPTS_DIR/12-post-install-checks.sh"
    fi
    
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
