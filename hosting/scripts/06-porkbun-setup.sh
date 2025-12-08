#!/bin/bash

################################################################################
# Porkbun DNS Configuration via API
################################################################################

set -e

# Source parent script if functions not available
if ! type log_info >/dev/null 2>&1; then
    source "$(dirname "$0")/../vps-setup.sh"
fi

log_info "Configuring Porkbun DNS..."

# Get VPS public IP
VPS_IP=$(curl -s -4 ifconfig.me)

if [[ -z "$VPS_IP" ]]; then
    log_error "Could not determine VPS public IP address"
    exit 1
fi

log_info "VPS Public IP: $VPS_IP"

# Verify Porkbun API credentials
log_info "Verifying Porkbun API credentials..."

TEST_RESPONSE=$(curl -s -X POST "https://api.porkbun.com/api/json/v3/domain/listAll" \
    -H "Content-Type: application/json" \
    -d "{
        \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
        \"apikey\": \"$PORKBUN_API_KEY\"
    }")

if echo "$TEST_RESPONSE" | grep -q '"status":"ERROR"'; then
    log_error "Porkbun API authentication failed"
    log_error "Response: $TEST_RESPONSE"
    exit 1
fi

if ! echo "$TEST_RESPONSE" | grep -q '"status":"SUCCESS"'; then
    log_error "Unexpected Porkbun API response"
    log_error "Response: $TEST_RESPONSE"
    exit 1
fi

log_success "Porkbun API credentials verified"

# Create DNS record management script
log_info "Creating Porkbun DNS management helper script..."

cat > /usr/local/bin/porkbun-dns << 'EOF'
#!/bin/bash

# Porkbun DNS Management Script
# Usage: porkbun-dns <action> <subdomain> <ip>
# Actions: create, update, delete, list

PORKBUN_API_KEY="${PORKBUN_API_KEY}"
PORKBUN_SECRET_KEY="${PORKBUN_SECRET_KEY}"
DOMAIN="${DOMAIN}"
API_URL="https://api.porkbun.com/api/json/v3"

if [[ -z "$PORKBUN_API_KEY" || -z "$PORKBUN_SECRET_KEY" || -z "$DOMAIN" ]]; then
    echo "Error: Environment variables not set"
    echo "Required: PORKBUN_API_KEY, PORKBUN_SECRET_KEY, DOMAIN"
    exit 1
fi

ACTION=$1
SUBDOMAIN=$2
IP=$3

case "$ACTION" in
    create|update)
        if [[ -z "$SUBDOMAIN" || -z "$IP" ]]; then
            echo "Usage: $0 create|update <subdomain> <ip>"
            exit 1
        fi
        
        echo "Creating/Updating A record: $SUBDOMAIN.$DOMAIN -> $IP"
        
        RESPONSE=$(curl -s -X POST "$API_URL/dns/create/$DOMAIN" \
            -H "Content-Type: application/json" \
            -d "{
                \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
                \"apikey\": \"$PORKBUN_API_KEY\",
                \"name\": \"$SUBDOMAIN\",
                \"type\": \"A\",
                \"content\": \"$IP\",
                \"ttl\": \"300\"
            }")
        
        if echo "$RESPONSE" | grep -q '"status":"SUCCESS"'; then
            echo "✓ DNS record created/updated successfully"
        else
            echo "✗ Failed to create DNS record"
            echo "$RESPONSE"
            exit 1
        fi
        ;;
        
    delete)
        if [[ -z "$SUBDOMAIN" ]]; then
            echo "Usage: $0 delete <subdomain>"
            exit 1
        fi
        
        echo "Deleting A record: $SUBDOMAIN.$DOMAIN"
        
        # Get record ID first
        RECORDS=$(curl -s -X POST "$API_URL/dns/retrieve/$DOMAIN" \
            -H "Content-Type: application/json" \
            -d "{
                \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
                \"apikey\": \"$PORKBUN_API_KEY\"
            }")
        
        RECORD_ID=$(echo "$RECORDS" | jq -r ".records[] | select(.name==\"$SUBDOMAIN.$DOMAIN\" and .type==\"A\") | .id" | head -n1)
        
        if [[ -z "$RECORD_ID" || "$RECORD_ID" == "null" ]]; then
            echo "Record not found"
            exit 1
        fi
        
        RESPONSE=$(curl -s -X POST "$API_URL/dns/delete/$DOMAIN/$RECORD_ID" \
            -H "Content-Type: application/json" \
            -d "{
                \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
                \"apikey\": \"$PORKBUN_API_KEY\"
            }")
        
        if echo "$RESPONSE" | grep -q '"status":"SUCCESS"'; then
            echo "✓ DNS record deleted successfully"
        else
            echo "✗ Failed to delete DNS record"
            echo "$RESPONSE"
            exit 1
        fi
        ;;
        
    list)
        echo "Listing DNS records for $DOMAIN"
        
        RESPONSE=$(curl -s -X POST "$API_URL/dns/retrieve/$DOMAIN" \
            -H "Content-Type: application/json" \
            -d "{
                \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
                \"apikey\": \"$PORKBUN_API_KEY\"
            }")
        
        echo "$RESPONSE" | jq -r '.records[] | "\(.type)\t\(.name)\t\(.content)"'
        ;;
        
    *)
        echo "Usage: $0 <action> [subdomain] [ip]"
        echo "Actions:"
        echo "  create <subdomain> <ip>  - Create or update A record"
        echo "  update <subdomain> <ip>  - Same as create"
        echo "  delete <subdomain>       - Delete A record"
        echo "  list                     - List all DNS records"
        exit 1
        ;;
esac
EOF

chmod +x /usr/local/bin/porkbun-dns

log_success "Porkbun DNS helper script created"

# Create or update environment file for the script
if [[ -f /etc/porkbun-dns.env ]]; then
    log_info "Porkbun environment file already exists"
else
    log_info "Creating Porkbun environment file..."
    cat > /etc/porkbun-dns.env << EOF
PORKBUN_API_KEY="${PORKBUN_API_KEY}"
PORKBUN_SECRET_KEY="${PORKBUN_SECRET_KEY}"
DOMAIN="${DOMAIN}"
EOF

    chmod 600 /etc/porkbun-dns.env
    log_success "Porkbun environment file created"
fi

log_success "Porkbun credentials configured"

# Check existing DNS records for the domain
log_info "Retrieving existing DNS records for $DOMAIN..."

EXISTING_RECORDS=$(curl -s -X POST "https://api.porkbun.com/api/json/v3/dns/retrieve/$DOMAIN" \
    -H "Content-Type: application/json" \
    -d "{
        \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
        \"apikey\": \"$PORKBUN_API_KEY\"
    }")

# Remove parked records (ALIAS/CNAME to pixie.porkbun.com)
PARKED_IDS=$(echo "$EXISTING_RECORDS" | jq -r --arg dom "$DOMAIN" '
    .records[]
    | select(
            ((.type == "CNAME") or (.type == "ALIAS"))
            and ((.content | ascii_downcase) == "pixie.porkbun.com")
            and (.name == "" or .name == $dom or .name == "*" or .name == "*" + $dom or .name == "@")
        )
    | .id
')

if [[ -n "$PARKED_IDS" ]]; then
    log_warning "Detected parked DNS records pointing to pixie.porkbun.com; removing them..."
    while IFS= read -r rid; do
        [[ -z "$rid" || "$rid" == "null" ]] && continue
        log_info "Deleting parked record id $rid..."
        RESP_DEL=$(curl -s -X POST "https://api.porkbun.com/api/json/v3/dns/delete/$DOMAIN/$rid" \
            -H "Content-Type: application/json" \
            -d "{\"secretapikey\": \"$PORKBUN_SECRET_KEY\", \"apikey\": \"$PORKBUN_API_KEY\"}")
        if echo "$RESP_DEL" | grep -q '"status":"SUCCESS"'; then
            log_success "Removed parked record id $rid"
        else
            log_warning "Failed to remove parked record id $rid: $RESP_DEL"
        fi
    done <<< "$PARKED_IDS"
    
    # Re-fetch records after deletions
    log_info "Re-fetching DNS records after cleanup..."
    EXISTING_RECORDS=$(curl -s -X POST "https://api.porkbun.com/api/json/v3/dns/retrieve/$DOMAIN" \
        -H "Content-Type: application/json" \
        -d "{\"secretapikey\": \"$PORKBUN_SECRET_KEY\", \"apikey\": \"$PORKBUN_API_KEY\"}")
else
    log_info "No parked pixie.porkbun.com records detected"
fi

# Check for root domain A record (empty name or explicit domain)
if echo "$EXISTING_RECORDS" | jq -e --arg dom "$DOMAIN" '.records[] | select(.type=="A" and (.name=="" or .name==$dom))' >/dev/null; then
    ROOT_A_EXISTS=true
    log_info "Root domain A record already exists"
else
    ROOT_A_EXISTS=false
fi

# Check for www CNAME
if echo "$EXISTING_RECORDS" | jq -e '.records[] | select(.type=="CNAME" and .name=="www")' >/dev/null; then
    WWW_EXISTS=true
    log_info "www CNAME already exists"
else
    WWW_EXISTS=false
fi

# Create main domain A record pointing to this VPS
log_info "Creating A record for $DOMAIN..."

if [[ "$ROOT_A_EXISTS" == "false" ]]; then
    RESPONSE=$(curl -s -X POST "https://api.porkbun.com/api/json/v3/dns/create/$DOMAIN" \
        -H "Content-Type: application/json" \
        -d "{
            \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
            \"apikey\": \"$PORKBUN_API_KEY\",
            \"name\": \"\",
            \"type\": \"A\",
            \"content\": \"$VPS_IP\",
            \"ttl\": \"300\"
        }")

    if echo "$RESPONSE" | grep -q '"status":"SUCCESS"'; then
        log_success "Main domain A record created: $DOMAIN -> $VPS_IP"
    elif echo "$RESPONSE" | grep -q '"status":"ERROR"'; then
        ERROR_MSG=$(echo "$RESPONSE" | grep -o '"message":"[^"]*"' | head -1)
        log_warning "Failed to create main domain A record: $ERROR_MSG"
    else
        log_warning "Failed to create main domain A record"
        log_info "Response: $RESPONSE"
    fi
else
    log_info "Root domain A record already exists"
fi

# Create www CNAME pointing to root domain
log_info "Ensuring www CNAME points to $DOMAIN..."

if [[ "$WWW_EXISTS" == "false" ]]; then
    RESPONSE=$(curl -s -X POST "https://api.porkbun.com/api/json/v3/dns/create/$DOMAIN" \
        -H "Content-Type: application/json" \
        -d "{
            \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
            \"apikey\": \"$PORKBUN_API_KEY\",
            \"name\": \"www\",
            \"type\": \"CNAME\",
            \"content\": \"$DOMAIN\",
            \"ttl\": \"300\"
        }")

    if echo "$RESPONSE" | grep -q '"status":"SUCCESS"'; then
        log_success "www CNAME created: www.$DOMAIN -> $DOMAIN"
    elif echo "$RESPONSE" | grep -q '"status":"ERROR"'; then
        ERROR_MSG=$(echo "$RESPONSE" | grep -o '"message":"[^"]*"' | head -1)
        log_warning "Failed to create www CNAME: $ERROR_MSG"
    else
        log_warning "Failed to create www CNAME"
        log_info "Response: $RESPONSE"
    fi
else
    log_info "www CNAME already exists"
fi

log_info "Verifying DNS records..."

# Wait a moment for DNS to propagate
sleep 2

# List all DNS records
log_info "Current DNS records:"
source /etc/porkbun-dns.env
/usr/local/bin/porkbun-dns list || log_warning "Could not retrieve DNS records"

log_success "Porkbun DNS configuration completed"

echo ""
log_info "You can manage DNS records using: porkbun-dns <action> <subdomain> <ip>"
log_info "Example: porkbun-dns create test 1.2.3.4"
echo ""
