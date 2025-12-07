#!/bin/bash

################################################################################
# Certbot Porkbun Auth Hook - Creates DNS TXT records for ACME challenge
################################################################################

set -e

# Load Porkbun credentials
if [[ ! -f /etc/porkbun-dns.env ]]; then
    echo "Error: /etc/porkbun-dns.env not found"
    exit 1
fi

source /etc/porkbun-dns.env

# Get validation data from certbot
DOMAIN=$CERTBOT_DOMAIN
VALIDATION=$CERTBOT_VALIDATION

if [[ -z "$DOMAIN" || -z "$VALIDATION" ]]; then
    echo "Error: CERTBOT_DOMAIN and CERTBOT_VALIDATION must be set by certbot"
    exit 1
fi

# Extract base domain and subdomain
BASE_DOMAIN=$DOMAIN
CHALLENGE_SUBDOMAIN="_acme-challenge"

# If domain contains wildcard, extract base domain
if [[ "$DOMAIN" == \*.* ]]; then
    BASE_DOMAIN="${DOMAIN#*.}"
fi

# Build the full record name
if [[ "$DOMAIN" == "$BASE_DOMAIN" ]]; then
    # Root domain challenge
    RECORD_NAME="_acme-challenge"
else
    # Subdomain challenge
    RECORD_NAME="_acme-challenge.$(echo $DOMAIN | sed "s/\.${BASE_DOMAIN}$//")"
fi

echo "Creating DNS TXT record for $DOMAIN..."
echo "  Base domain: $BASE_DOMAIN"
echo "  Record name: $RECORD_NAME"
echo "  Validation: $VALIDATION"

# Create TXT record via Porkbun API
RESPONSE=$(curl -s -X POST "https://api.porkbun.com/api/json/v3/dns/create/$BASE_DOMAIN" \
    -H "Content-Type: application/json" \
    -d "{
        \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
        \"apikey\": \"$PORKBUN_API_KEY\",
        \"name\": \"$RECORD_NAME\",
        \"type\": \"TXT\",
        \"content\": \"$VALIDATION\",
        \"ttl\": \"600\"
    }")

if echo "$RESPONSE" | grep -q '"status":"SUCCESS"'; then
    echo "✓ TXT record created successfully"
    # Wait for DNS propagation
    echo "Waiting 60 seconds for DNS propagation..."
    sleep 60
    exit 0
else
    ERROR_MSG=$(echo "$RESPONSE" | grep -o '"message":"[^"]*"' | head -1)
    echo "✗ Failed to create TXT record: $ERROR_MSG"
    echo "Response: $RESPONSE"
    exit 1
fi
