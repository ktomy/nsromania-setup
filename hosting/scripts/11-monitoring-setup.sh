#!/bin/bash

################################################################################
# Logging and Monitoring Setup
################################################################################

set -e

source "$(dirname "$0")/../vps-setup.sh" 2>/dev/null || true

log_info "Configuring log rotation..."

# Create logrotate configuration for PM2 logs
cat > /etc/logrotate.d/nsromania << 'EOF'
/var/log/nsromania-setup-*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    missingok
    create 0644 nsromania nsromania
}

/home/nsromania/.pm2/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    missingok
    create 0644 nsromania nsromania
    su nsromania nsromania
    postrotate
        su - nsromania -c "pm2 reloadLogs" > /dev/null 2>&1 || true
    endscript
}
EOF

log_success "PM2 log rotation configured"

# Configure Nginx log rotation
cat > /etc/logrotate.d/nginx-nsromania << 'EOF'
/var/log/nginx/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    missingok
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
    endscript
}
EOF

log_success "Nginx log rotation configured"

# Configure MySQL log rotation
cat > /etc/logrotate.d/mysql-nsromania << 'EOF'
/var/log/mysql/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    missingok
    create 640 mysql adm
    sharedscripts
    postrotate
        test -x /usr/bin/mysqladmin || exit 0
        if [ -f /var/run/mysqld/mysqld.pid ]; then
            /usr/bin/mysqladmin --defaults-file=/etc/mysql/debian.cnf flush-logs
        fi
    endscript
}
EOF

log_success "MySQL log rotation configured"

# Configure MongoDB log rotation
cat > /etc/logrotate.d/mongodb-nsromania << 'EOF'
/var/log/mongodb/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    missingok
    create 0600 mongodb mongodb
    sharedscripts
    postrotate
        /bin/kill -SIGUSR1 `cat /var/lib/mongodb/mongod.lock 2>/dev/null` 2>/dev/null || true
    endscript
}
EOF

log_success "MongoDB log rotation configured"

# Test logrotate configuration
log_info "Testing logrotate configuration..."
logrotate -d /etc/logrotate.d/nsromania > /dev/null 2>&1 || log_warning "Logrotate test showed warnings"

# Create systemd service for control panel as backup to PM2
log_info "Creating systemd service as PM2 backup..."

cat > /etc/systemd/system/nsromania-setup.service << EOF
[Unit]
Description=Nightscout Community Control Panel
After=network.target mysql.service mongodb.service

[Service]
Type=forking
User=nsromania
Group=nsromania
WorkingDirectory=${SETUP_DIR}
Environment="PATH=/home/nsromania/.nvm/versions/node/v22.11.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=/home/nsromania/.nvm/versions/node/v22.11.0/bin/pm2 resurrect
ExecReload=/home/nsromania/.nvm/versions/node/v22.11.0/bin/pm2 reload all
ExecStop=/home/nsromania/.nvm/versions/node/v22.11.0/bin/pm2 kill
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nsromania-setup.service

log_success "Systemd service created"

# Create daily health check script
log_info "Creating health check script..."

cat > /usr/local/bin/nsromania-health-check.sh << 'EOF'
#!/bin/bash

# Check if control panel is responding
if ! curl -f http://localhost:3000 > /dev/null 2>&1; then
    echo "$(date): Control panel not responding, attempting restart" >> /var/log/nsromania-health.log
    su - nsromania -c "pm2 restart nsromania-setup"
fi

# Check MySQL
if ! mysqladmin ping -h localhost > /dev/null 2>&1; then
    echo "$(date): MySQL not responding" >> /var/log/nsromania-health.log
    systemctl restart mysql
fi

# Check MongoDB
if ! mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
    echo "$(date): MongoDB not responding" >> /var/log/nsromania-health.log
    systemctl restart mongod
fi

# Check Nginx
if ! systemctl is-active --quiet nginx; then
    echo "$(date): Nginx not running" >> /var/log/nsromania-health.log
    systemctl restart nginx
fi

# Check BIND9
if ! systemctl is-active --quiet bind9; then
    echo "$(date): BIND9 not running" >> /var/log/nsromania-health.log
    systemctl restart bind9
fi
EOF

chmod +x /usr/local/bin/nsromania-health-check.sh

# Create cron job for health checks (every 5 minutes)
cat > /etc/cron.d/nsromania-health << 'EOF'
# Health check every 5 minutes
*/5 * * * * root /usr/local/bin/nsromania-health-check.sh
EOF

log_success "Health check script created"

# Create disk space monitoring
cat > /usr/local/bin/nsromania-disk-check.sh << 'EOF'
#!/bin/bash

THRESHOLD=80
USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')

if [ "$USAGE" -gt "$THRESHOLD" ]; then
    echo "$(date): Disk usage is at ${USAGE}%" >> /var/log/nsromania-health.log
    # Clean old logs
    find /var/log -name "*.gz" -mtime +30 -delete
    find /home/nsromania/.pm2/logs -name "*.log" -mtime +30 -delete
fi
EOF

chmod +x /usr/local/bin/nsromania-disk-check.sh

# Add to daily cron
cat > /etc/cron.d/nsromania-disk << 'EOF'
# Disk space check daily at 2 AM
0 2 * * * root /usr/local/bin/nsromania-disk-check.sh
EOF

log_success "Disk space monitoring configured"

log_success "Logging and monitoring setup completed"
