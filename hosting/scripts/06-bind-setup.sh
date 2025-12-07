#!/bin/bash

################################################################################
# BIND9 DNS Server Installation and Configuration
################################################################################

set -e

source "$(dirname "$0")/../vps-setup.sh" 2>/dev/null || true

log_info "Installing BIND9..."

DEBIAN_FRONTEND=noninteractive apt-get install -y -qq bind9 bind9utils bind9-doc

log_success "BIND9 installed"

log_info "Configuring BIND9..."

# Create zones directory if doesn't exist
mkdir -p /etc/bind/zones

# Configure named.conf.local
cat > /etc/bind/named.conf.local << EOF
//
// Local zones configuration
//

zone "${DOMAIN}" {
    type master;
    file "/etc/bind/zones/${DOMAIN}";
    allow-update { none; };
};

// Allow queries from anywhere
allow-query { any; };
EOF

# Get VPS public IP
VPS_IP=$(curl -s -4 ifconfig.me)

# Create zone file
cat > /etc/bind/zones/${DOMAIN} << EOF
;
; BIND data file for ${DOMAIN}
;
\$TTL    300
@       IN      SOA     ns1.${DOMAIN}. admin.${DOMAIN}. (
                        $(date +%Y%m%d%H)      ; Serial (YYYYMMDDnn)
                        3600                    ; Refresh
                        1800                    ; Retry
                        604800                  ; Expire
                        300 )                   ; Negative Cache TTL
;
; Name servers
@       IN      NS      ns1.${DOMAIN}.
@       IN      NS      ns2.${DOMAIN}.

; A records
@       IN      A       ${VPS_IP}
ns1     IN      A       ${VPS_IP}
ns2     IN      A       ${VPS_IP}
www     IN      A       ${VPS_IP}

; Wildcard for subdomains (will also add specific CNAME records)
*       IN      A       ${VPS_IP}

; CNAME records for Nightscout instances will be added here by the application
EOF

# Set ownership - bind user needs to read, nsromania needs to write
chown bind:nsromania /etc/bind/zones/${DOMAIN}
chmod 664 /etc/bind/zones/${DOMAIN}
chown bind:nsromania /etc/bind/zones
chmod 775 /etc/bind/zones

# Configure named.conf.options with forwarders
cat > /etc/bind/named.conf.options << 'EOF'
options {
    directory "/var/cache/bind";
    
    // Forwarders - use Google and Cloudflare DNS
    forwarders {
        8.8.8.8;
        8.8.4.4;
        1.1.1.1;
        1.0.0.1;
    };
    
    // Allow recursion for local queries
    recursion yes;
    allow-recursion { any; };
    
    // Listen on all interfaces
    listen-on { any; };
    listen-on-v6 { any; };
    
    // Security
    dnssec-validation auto;
    
    auth-nxdomain no;    # conform to RFC1035
};
EOF

# Generate rndc key
log_info "Generating rndc key..."
rndc-confgen -a
chmod 640 /etc/bind/rndc.key
chown root:bind /etc/bind/rndc.key

# Check configuration
named-checkconf
named-checkzone "${DOMAIN}" /etc/bind/zones/${DOMAIN}

# Start and enable BIND9
systemctl restart bind9
systemctl enable bind9

log_success "BIND9 configured and started"

# Verify zone loaded
log_info "Verifying DNS zone..."
sleep 2

if rndc status > /dev/null 2>&1; then
    log_success "BIND9 is running"
else
    log_error "BIND9 failed to start"
    exit 1
fi

# Test DNS resolution
log_info "Testing DNS resolution..."
if dig @localhost "${DOMAIN}" +short | grep -q "${VPS_IP}"; then
    log_success "DNS resolution working correctly"
else
    log_warning "DNS resolution test inconclusive"
fi

log_success "BIND9 setup completed"

# Display NS records information
echo ""
log_info "━━━ DNS Configuration Instructions ━━━"
echo "Please configure the following NS records at your domain registrar:"
echo ""
echo "  NS records for ${DOMAIN}:"
echo "    ns1.${DOMAIN} -> ${VPS_IP}"
echo "    ns2.${DOMAIN} -> ${VPS_IP}"
echo ""
echo "  At your domain registrar, set:"
echo "    Nameserver 1: ns1.${DOMAIN}"
echo "    Nameserver 2: ns2.${DOMAIN}"
echo ""
echo "Note: DNS propagation may take 24-48 hours"
echo ""
