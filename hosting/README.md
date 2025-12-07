# Nightscout Community Control Panel - VPS Setup Guide

This directory contains a complete automated setup system for deploying Nightscout Community Control Panel on a fresh Ubuntu 24.04 LTS VPS.

## Overview

The setup system automates the complete installation and configuration of:

- **Multiple Nightscout instances** running on PM2
- **Control Panel web application** for managing instances
- **MySQL/MariaDB** for control panel database
- **MongoDB** for Nightscout instance databases
- **BIND9** DNS server for subdomain management
- **Nginx** reverse proxy with wildcard SSL certificates
- **Let's Encrypt SSL** for HTTPS security
- **Fail2ban** for SSH protection
- **Automatic log rotation** and monitoring

## Prerequisites

- Fresh Ubuntu 24.04 LTS VPS (not pre-configured with other services)
- Minimum specs: 2 CPU cores, 4GB RAM, 40GB SSD
- Root or sudo access
- Domain name with DNS control
- Brevo API key for transactional emails
- Optional: OAuth credentials (GitHub, Google)

## Quick Start

### 1. SSH into Your VPS

```bash
ssh root@your-vps-ip
```

### 2. Download and Run Setup Script

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ktomy/nsromania-setup/main/hosting/vps-setup.sh)
```

Or if running locally:

```bash
sudo bash /path/to/hosting/vps-setup.sh
```

### 3. Follow the Interactive Wizard

The setup wizard will prompt you for:

- **Domain Configuration**: Your main domain (e.g., nsromania.info)
- **Database Passwords**: Root and user passwords for MySQL and MongoDB
- **Admin User**: Email, name for initial admin account
- **Email Service**: Brevo API credentials
- **OAuth Providers**: GitHub and Google credentials (optional)
- **reCAPTCHA**: Keys for form protection
- **SSL Configuration**: DNS provider (Cloudflare, Route53, or manual)

### 4. Installation Process

The script will automatically:

1. Update system packages
2. Create system users and configure permissions
3. Install Node.js 14 and 22 via NVM
4. Install and configure MySQL and MongoDB
5. Install and configure Nginx with SSL
6. Install and configure BIND9 DNS server
7. Install Nightscout master branch
8. Deploy control panel application
9. Configure firewall and security
10. Setup monitoring and log rotation
11. Verify installation

The entire process typically takes 20-30 minutes depending on VPS speed.

## Configuration

### Configuration File

All installation settings are saved to:
```
/opt/nsromania/.install-config.json
```

This file contains:
- Domain and database credentials
- API keys
- OAuth configuration
- Node.js paths

**Important**: This file contains sensitive information. Keep it secure or delete after installation:
```bash
rm /opt/nsromania/.install-config.json
```

### Environment Configuration

The control panel environment file is created at:
```
/opt/nsromania/setup/.env
```

This contains all runtime configuration for the application.

## Directory Structure

After installation:

```
/opt/nsromania/
├── setup/                    # Control panel application
│   ├── .env                  # Application environment
│   ├── ecosystem.config.js   # PM2 configuration
│   └── ...
├── nightscout/
│   ├── master/               # Nightscout master branch
│   │   ├── server.js
│   │   ├── package.json
│   │   └── ...
│   └── [other versions]/     # Future Nightscout versions
└── .install-config.json      # Installation configuration
```

## Service Management

### Control Panel

View application logs:
```bash
sudo su - nsromania -c 'pm2 logs nsromania-setup'
```

Restart application:
```bash
sudo su - nsromania -c 'pm2 restart nsromania-setup'
```

View all PM2 processes:
```bash
sudo su - nsromania -c 'pm2 list'
```

### System Services

Check service status:
```bash
systemctl status mysql
systemctl status mongod
systemctl status nginx
systemctl status bind9
systemctl status fail2ban
```

Restart a service:
```bash
systemctl restart nginx
systemctl restart bind9
```

## DNS Configuration

### Setting Up Your Domain's Nameservers

The BIND9 DNS server is configured to handle your domain. Update your domain registrar to use these nameservers:

- **Nameserver 1**: ns1.yourdomain.com
- **Nameserver 2**: ns2.yourdomain.com

Both NS records point to your VPS IP address.

**Note**: DNS propagation may take 24-48 hours.

## SSL Certificates

### Wildcard Certificate

A wildcard SSL certificate (`*.yourdomain.com`) is automatically obtained during setup using your selected DNS provider:

- **Cloudflare**: Requires Cloudflare API token
- **Route53**: Requires AWS credentials
- **Manual**: Requires manual DNS TXT record validation

Certificate files:
```
/etc/letsencrypt/live/yourdomain.com/
├── fullchain.pem     # Full certificate chain
├── privkey.pem       # Private key
├── cert.pem          # Certificate only
└── chain.pem         # Intermediate certificates
```

### SSL Auto-Renewal

SSL certificates are automatically renewed 30 days before expiry via Certbot cron job:
```
/etc/cron.d/certbot-renew
```

Check renewal status:
```bash
certbot certificates
```

## Firewall Configuration

### UFW Rules

The firewall is configured to allow:
- SSH (port 22)
- HTTP (port 80)
- HTTPS (port 443)
- DNS (port 53 TCP/UDP)

All other ports are blocked by default.

View firewall status:
```bash
ufw status verbose
```

### fail2ban SSH Protection

Automatically blocks IPs after 3 failed SSH attempts within 10 minutes.

View fail2ban logs:
```bash
tail -f /var/log/fail2ban.log
```

## Monitoring and Maintenance

### Health Checks

Automated health checks run every 5 minutes:
```bash
/usr/local/bin/nsromania-health-check.sh
```

Checks verify:
- Control panel responsiveness
- MySQL connectivity
- MongoDB connectivity
- Nginx running
- BIND9 running

Health check logs:
```bash
tail -f /var/log/nsromania-health.log
```

### Disk Space Monitoring

Daily disk space checks run at 2 AM:
```bash
/usr/local/bin/nsromania-disk-check.sh
```

Automatically cleans old logs if disk usage exceeds 80%.

### Log Rotation

Logs are automatically rotated daily:
- PM2 logs: Retained 14 days
- Nginx logs: Retained 14 days
- MySQL logs: Retained 7 days
- MongoDB logs: Retained 7 days

## Creating Nightscout Instances

Once the control panel is running:

1. Access https://yourdomain.com
2. Sign in with OAuth or magic link
3. Users can submit registration requests
4. Admin users can approve requests
5. Instances are automatically initialized with:
   - MongoDB database and user
   - DNS CNAME subdomain record
   - Nginx virtual host with SSL
   - PM2 process running Nightscout

## Port Allocation

Nightscout instances use ports in the range 11000-12000:

- **Formula**: `11000 + instance_id`
- **Example**: Instance #5 → Port 11005

Nginx reverse proxy handles HTTPS routing for all subdomains.

## Database Management

### MySQL Access

Access control panel database:
```bash
mysql -u nsromania -p nightscout
```

View users:
```sql
SELECT id, email, name, role FROM auth_user;
```

### MongoDB Access

Access MongoDB shell:
```bash
mongosh -u root -p [password] --authenticationDatabase admin
```

List Nightscout instance databases:
```javascript
db.adminCommand('listDatabases')
```

## Troubleshooting

### Control Panel Not Responding

1. Check PM2 process:
   ```bash
   sudo su - nsromania -c 'pm2 list'
   ```

2. View application logs:
   ```bash
   sudo su - nsromania -c 'pm2 logs nsromania-setup'
   ```

3. Check if port 3000 is listening:
   ```bash
   netstat -tuln | grep 3000
   ```

4. Restart application:
   ```bash
   sudo su - nsromania -c 'pm2 restart nsromania-setup'
   ```

### Database Connection Issues

1. Verify MySQL is running:
   ```bash
   systemctl status mysql
   ```

2. Test MySQL connection:
   ```bash
   mysql -u nsromania -p -e "SELECT 1" nightscout
   ```

3. Check MongoDB:
   ```bash
   systemctl status mongod
   ```

### DNS Issues

1. Verify BIND9 is running:
   ```bash
   systemctl status bind9
   ```

2. Test DNS resolution:
   ```bash
   dig @localhost yourdomain.com
   ```

3. Check zone file:
   ```bash
   named-checkzone yourdomain.com /etc/bind/zones/yourdomain.com
   ```

### SSL Certificate Issues

1. Check certificate status:
   ```bash
   certbot certificates
   ```

2. Manually renew certificate:
   ```bash
   certbot renew --force-renewal
   ```

3. Check Nginx SSL configuration:
   ```bash
   nginx -T | grep ssl
   ```

## Logging and Diagnostics

### Installation Log

Complete installation log:
```bash
tail -f /var/log/nsromania-setup.log
```

### Application Logs

PM2 application logs:
```bash
tail -f /home/nsromania/.pm2/logs/nsromania-setup-out.log
tail -f /home/nsromania/.pm2/logs/nsromania-setup-error.log
```

### System Service Logs

```bash
journalctl -u mysql -n 100
journalctl -u mongod -n 100
journalctl -u nginx -n 100
journalctl -u bind9 -n 100
journalctl -u fail2ban -n 100
```

## Security Considerations

### Initial Setup

1. SSH key-only authentication is recommended
2. Disable password-based SSH login after setup
3. Regularly update system packages
4. Monitor security logs

### Ongoing Maintenance

1. Keep systems updated: `apt update && apt upgrade`
2. Monitor disk space
3. Review authentication logs
4. Backup databases regularly
5. Rotate SSL certificates

### Credentials

Keep these credentials secure:
- MySQL root password
- MySQL user password
- MongoDB root password
- OAuth API keys
- Brevo API key
- reCAPTCHA keys

## Support and Issues

For issues or questions:

1. Check the troubleshooting section above
2. Review application logs
3. Verify all services are running
4. Check system resources (disk, memory, CPU)

## File Locations

Important file locations for reference:

```
Application Code:       /opt/nsromania/setup
Nightscout Code:        /opt/nsromania/nightscout/master
Configuration:          /opt/nsromania/.install-config.json
Application .env:       /opt/nsromania/setup/.env

Nginx Config:           /etc/nginx/sites-available/
Nginx Template:         /etc/nginx/sites-available/_template
Nginx Logs:             /var/log/nginx/

BIND9 Config:           /etc/bind/
BIND9 Zone:             /etc/bind/zones/yourdomain.com
BIND9 Logs:             journalctl -u bind9

MySQL Data:             /var/lib/mysql/
MySQL Logs:             /var/log/mysql/

MongoDB Data:           /var/lib/mongodb/
MongoDB Logs:           /var/log/mongodb/

SSL Certificates:       /etc/letsencrypt/live/yourdomain.com/
Certbot Logs:           /var/log/letsencrypt/

PM2 Config:             /opt/nsromania/setup/ecosystem.config.js
PM2 Logs:               /home/nsromania/.pm2/logs/
PM2 Home:               /home/nsromania/.pm2/

System Log:             /var/log/nsromania-setup.log
Health Check Log:       /var/log/nsromania-health.log

UFW Logs:               /var/log/ufw.log
fail2ban Logs:          /var/log/fail2ban.log
```

## Advanced Configuration

### Scaling for More Instances

For deployments with 20+ Nightscout instances:

1. Increase MongoDB heap size:
   ```bash
   # Edit /etc/mongod.conf
   storage:
     wiredTiger:
       engineConfig:
         cacheSizeGB: 4  # Increase based on available RAM
   ```

2. Increase Nginx worker processes:
   ```bash
   # Edit /etc/nginx/nginx.conf
   worker_processes auto;  # Use all CPU cores
   worker_connections 2048;  # Increase connection limit
   ```

3. Increase MySQL max connections:
   ```sql
   SET GLOBAL max_connections = 1000;
   ```

### Custom Nightscout Versions

Additional Nightscout versions can be installed manually:

```bash
cd /opt/nsromania/nightscout
git clone https://github.com/nightscout/cgm-remote-monitor.git version-15.0.0
cd version-15.0.0
nvm use 14
npm install --production
```

## Version Information

Current versions installed:

- **Ubuntu**: 24.04 LTS
- **Node.js**: 14 (Nightscout), 22 (Control Panel)
- **MySQL/MariaDB**: Latest
- **MongoDB**: 7.0
- **BIND9**: Latest
- **Nginx**: Latest
- **PM2**: Latest
- **Certbot**: Latest

---

**Last Updated**: December 2025

For the latest version and updates, visit: https://github.com/ktomy/nsromania-setup
