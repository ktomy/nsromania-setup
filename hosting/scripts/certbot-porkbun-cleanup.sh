#!/bin/bash

################################################################################
# Certbot Porkbun Cleanup Hook - Removes DNS TXT records after ACME challenge
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

if [[ -z "$DOMAIN" ]]; then
    echo "Error: CERTBOT_DOMAIN must be set by certbot"
    exit 1
fi

# Extract base domain and subdomain
BASE_DOMAIN=$DOMAIN

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

echo "Cleaning up DNS TXT record for $DOMAIN..."
echo "  Base domain: $BASE_DOMAIN"
echo "  Record name: $RECORD_NAME"

# Get all TXT records to find the one we created
RECORDS=$(curl -s -X POST "https://porkbun.com/api/json/v3/dns/retrieve/$BASE_DOMAIN" \
    -H "Content-Type: application/json" \
    -d "{
        \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
        \"apikey\": \"$PORKBUN_API_KEY\"
    }")

# Find the record ID for our TXT record
RECORD_ID=$(echo "$RECORDS" | grep -o '"id":"[^"]*","name":"'"$RECORD_NAME"'","type":"TXT"' | head -1 | grep -o '"id":"[^"]*"' | grep -o '[0-9]*' || echo "")

if [[ -z "$RECORD_ID" ]]; then
    echo "Warning: Could not find TXT record to clean up"
    exit 0
fi

# Delete the TXT record
RESPONSE=$(curl -s -X POST "https://porkbun.com/api/json/v3/dns/delete/$BASE_DOMAIN/$RECORD_ID" \
    -H "Content-Type: application/json" \
    -d "{
        \"secretapikey\": \"$PORKBUN_SECRET_KEY\",
        \"apikey\": \"$PORKBUN_API_KEY\"
    }")

if echo "$RESPONSE" | grep -q '"status":"SUCCESS"'; then
    echo "✓ TXT record cleaned up successfully"
    exit 0
else
    ERROR_MSG=$(echo "$RESPONSE" | grep -o '"message":"[^"]*"' | head -1)
    echo "Warning: Failed to clean up TXT record: $ERROR_MSG"
    exit 0  # Don't fail cleanup, cert was already obtained
fi
