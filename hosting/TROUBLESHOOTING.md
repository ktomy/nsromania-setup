# VPS Setup - Troubleshooting Guide

## Common Issues and Solutions

### Installation Issues

#### ❌ "Permission denied" during installation

**Cause**: Not running with sudo or proper permissions

**Solution**:
```bash
# Make sure you're using sudo
sudo bash /path/to/vps-setup.sh

# Or use the curl method with sudo
curl -fsSL https://raw.githubusercontent.com/ktomy/nsromania-setup/main/hosting/vps-setup.sh | sudo bash
```

---

#### ❌ "OS is not Ubuntu 24.04"

**Cause**: Wrong OS version or wrong distro

**Solution**:
1. Verify your OS:
   ```bash
   cat /etc/os-release
   ```

2. If using different Ubuntu version, answer "yes" when prompted to continue

3. If using different distro, consider using Ubuntu 24.04

---

#### ❌ "DNS preflight check failed"

**Cause**: Domain A record not pointing to VPS IP

**Solution**:
1. Get your VPS IP:
   ```bash
   curl -4 ifconfig.me
   ```

2. Update your domain registrar's A record:
   - Domain: `yourdomain.com`
   - Record Type: `A`
   - Value: Your VPS IP

3. Wait for DNS propagation (up to 48 hours)

4. Test DNS:
   ```bash
   dig yourdomain.com
   ```

**Note**: Setup continues anyway with DNS preflight warning - you can complete installation

---

### Service Issues

#### ❌ Control Panel Not Responding

**Symptoms**: HTTPS connection timeout or ERR_CONNECTION_REFUSED

**Troubleshooting Steps**:

1. Check if PM2 process is running:
   ```bash
   sudo su - nsromania -c 'pm2 list'
   ```
   
   Look for `nsromania-setup` with status `online` (green)

2. Check application logs:
   ```bash
   sudo su - nsromania -c 'pm2 logs nsromania-setup --lines 100'
   ```
   
   Look for error messages

3. Verify port 3000 is listening:
   ```bash
   netstat -tuln | grep 3000
   ```
   
   Should show `127.0.0.1:3000 LISTEN`

4. Check Nginx is proxying correctly:
   ```bash
   nginx -T | grep -A 5 'proxy_pass'
   ```

5. Restart the application:
   ```bash
   sudo su - nsromania -c 'pm2 restart nsromania-setup'
   ```

6. Check systemctl service:
   ```bash
   systemctl status nsromania-setup.service
   ```

---

#### ❌ MySQL Connection Error

**Symptoms**: "Can't connect to MySQL server" or "Access denied"

**Troubleshooting Steps**:

1. Check if MySQL is running:
   ```bash
   systemctl status mysql
   ```

2. Restart MySQL:
   ```bash
   systemctl restart mysql
   ```

3. Test connection with known credentials:
   ```bash
   # Check your database password from config
   mysql -u nsromania -p nightscout -e "SELECT 1"
   ```

4. Check MySQL logs:
   ```bash
   journalctl -u mysql -n 50
   tail -f /var/log/mysql/error.log
   ```

5. Verify database exists:
   ```bash
   mysql -u root -p -e "SHOW DATABASES;"
   ```

6. Check user permissions:
   ```bash
   mysql -u root -p -e "SELECT user, host FROM mysql.user;"
   ```

---

#### ❌ MongoDB Connection Error

**Symptoms**: "MongoDB connection refused" or authentication errors

**Troubleshooting Steps**:

1. Check if MongoDB is running:
   ```bash
   systemctl status mongod
   ```

2. Restart MongoDB:
   ```bash
   systemctl restart mongod
   ```

3. Test MongoDB connection:
   ```bash
   mongosh --eval "db.adminCommand('ping')"
   ```

4. If authentication error, try without auth first:
   ```bash
   mongosh --eval "db.adminCommand('ping')" --noauth
   ```

5. Check MongoDB logs:
   ```bash
   journalctl -u mongod -n 50
   tail -f /var/log/mongodb/mongod.log
   ```

6. Verify root user exists:
   ```bash
   mongosh --eval "db.getUsers()" --authenticationDatabase admin
   ```

---

#### ❌ Nginx Not Responding

**Symptoms**: 502 Bad Gateway or connection timeout

**Troubleshooting Steps**:

1. Check if Nginx is running:
   ```bash
   systemctl status nginx
   ```

2. Restart Nginx:
   ```bash
   systemctl restart nginx
   ```

3. Test Nginx configuration:
   ```bash
   nginx -t
   ```
   
   Should show "syntax is ok" and "test is successful"

4. Check Nginx error logs:
   ```bash
   tail -f /var/log/nginx/*.log
   ```

5. Verify control panel is listening:
   ```bash
   netstat -tuln | grep 3000
   ```

6. Check if Nginx can reach localhost:3000:
   ```bash
   curl http://localhost:3000
   ```

---

### DNS Issues

#### ❌ DNS Not Resolving

**Symptoms**: Can't resolve domain or subdomains

**Troubleshooting Steps**:

1. Check if BIND9 is running:
   ```bash
   systemctl status bind9
   ```

2. Test local DNS resolution:
   ```bash
   dig @localhost yourdomain.com
   ```
   
   Should show your VPS IP in ANSWER section

3. Test external DNS resolution:
   ```bash
   dig yourdomain.com @8.8.8.8
   ```

4. Check zone file syntax:
   ```bash
   named-checkzone yourdomain.com /etc/bind/zones/yourdomain.com
   ```

5. Check BIND9 configuration:
   ```bash
   named-checkconf -z
   ```

6. View BIND9 logs:
   ```bash
   journalctl -u bind9 -n 100
   tail -f /var/log/syslog | grep named
   ```

7. Reload BIND9:
   ```bash
   sudo rndc reload
   ```

---

#### ❌ Subdomains Not Created After Instance Registration

**Symptoms**: Instance created but subdomain doesn't resolve

**Troubleshooting Steps**:

1. Check DNS zone file for CNAME records:
   ```bash
   grep CNAME /etc/bind/zones/yourdomain.com
   ```

2. Reload DNS:
   ```bash
   sudo rndc reload
   ```

3. Check application logs for DNS errors:
   ```bash
   sudo su - nsromania -c 'pm2 logs nsromania-setup --lines 50'
   ```

4. Check BIND9 zone loading:
   ```bash
   sudo rndc status
   ```

---

### SSL Certificate Issues

#### ❌ SSL Certificate Not Trusted

**Symptoms**: Browser warning about invalid certificate

**Troubleshooting Steps**:

1. Check certificate status:
   ```bash
   certbot certificates
   ```

2. Check if Nginx is using the certificate:
   ```bash
   nginx -T | grep ssl_certificate
   ```

3. Verify certificate files exist:
   ```bash
   ls -la /etc/letsencrypt/live/yourdomain.com/
   ```

4. Check certificate validity:
   ```bash
   openssl x509 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem -noout -dates
   ```

5. Manually renew certificate:
   ```bash
   certbot renew --force-renewal
   ```

6. Reload Nginx after renewal:
   ```bash
   systemctl reload nginx
   ```

---

#### ❌ SSL Certificate Renewal Failed

**Symptoms**: Certificate expiring soon or Certbot errors

**Troubleshooting Steps**:

1. Check Certbot logs:
   ```bash
   tail -f /var/log/letsencrypt/letsencrypt.log
   ```

2. Test DNS challenge:
   ```bash
   # For Cloudflare
   certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini -d yourdomain.com --dry-run
   ```

3. Check DNS API credentials:
   ```bash
   cat /etc/letsencrypt/cloudflare.ini  # For Cloudflare
   ```

4. Manually verify DNS records:
   ```bash
   dig _acme-challenge.yourdomain.com
   ```

5. Try force renewal:
   ```bash
   certbot renew --force-renewal --verbose
   ```

---

### Firewall and Security Issues

#### ❌ Can't Access Control Panel (Port Blocked)

**Symptoms**: Connection timeout to HTTPS

**Troubleshooting Steps**:

1. Check UFW firewall status:
   ```bash
   ufw status verbose
   ```

2. Allow ports if needed:
   ```bash
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```

3. Check iptables rules:
   ```bash
   sudo iptables -L -n
   ```

4. Verify Nginx is listening on port 443:
   ```bash
   netstat -tuln | grep 443
   ```

---

#### ❌ SSH Brute Force Protection Too Strict

**Symptoms**: Can't SSH after multiple login attempts

**Troubleshooting Steps**:

1. Check fail2ban status:
   ```bash
   sudo fail2ban-client status sshd
   ```

2. Check if your IP is banned:
   ```bash
   sudo fail2ban-client status sshd | grep "Banned"
   ```

3. Unban an IP:
   ```bash
   sudo fail2ban-client set sshd unbanip YOUR_IP
   ```

4. Adjust fail2ban rules if needed:
   ```bash
   sudo nano /etc/fail2ban/jail.local
   sudo systemctl restart fail2ban
   ```

---

### Database Issues

#### ❌ Can't Create Nightscout Instance (Database Error)

**Symptoms**: Instance creation fails with database error

**Troubleshooting Steps**:

1. Check MongoDB root user:
   ```bash
   mongosh -u root -p [password] --authenticationDatabase admin --eval "db.adminCommand('listDatabases')"
   ```

2. Check MongoDB authentication:
   ```bash
   mongosh --eval "db.adminCommand('ping')" --authenticationDatabase admin
   ```

3. Verify nsromania application has MongoDB access:
   ```bash
   curl http://localhost:3000/api/health
   ```

4. Check application .env file:
   ```bash
   grep MONGO_URL /opt/nsromania/setup/.env
   ```

---

#### ❌ Database Disk Space Full

**Symptoms**: Application errors, database failures

**Troubleshooting Steps**:

1. Check disk usage:
   ```bash
   df -h
   ```

2. Find large directories:
   ```bash
   du -sh /var/lib/mysql/*
   du -sh /var/lib/mongodb/*
   ```

3. Check log sizes:
   ```bash
   du -sh /var/log/*
   ```

4. Clean old logs:
   ```bash
   sudo logrotate -f /etc/logrotate.d/*
   ```

5. Clean temporary files:
   ```bash
   sudo rm -rf /tmp/*
   ```

---

### Performance Issues

#### ❌ Slow Application Performance

**Symptoms**: Slow page loads or timeouts

**Troubleshooting Steps**:

1. Check system resources:
   ```bash
   top
   free -h
   df -h
   ```

2. Check if swap is being used:
   ```bash
   free -h
   ```
   If yes, increase RAM or optimize

3. Check database performance:
   ```bash
   mysql -u nsromania -p -e "SHOW PROCESSLIST;" nightscout
   ```

4. Check MongoDB performance:
   ```bash
   mongosh --eval "db.currentOp()"
   ```

5. Increase MySQL max connections if needed:
   ```bash
   mysql -u root -p -e "SET GLOBAL max_connections = 500;"
   ```

6. Monitor application:
   ```bash
   sudo su - nsromania -c 'pm2 monit'
   ```

---

## Diagnostic Commands

Quick reference for common diagnostics:

```bash
# System health
uname -a
df -h
free -h
top -b -n 1 | head -15

# Services status
systemctl status mysql mongod nginx bind9 fail2ban
systemctl --failed

# Network
netstat -tuln
ss -tuln
curl -4 ifconfig.me

# DNS
dig yourdomain.com
dig @localhost yourdomain.com
nslookup yourdomain.com

# Application
sudo su - nsromania -c 'pm2 status'
sudo su - nsromania -c 'pm2 logs --lines 50'

# SSL Certificates
certbot certificates
openssl x509 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem -noout -text

# Logs
tail -f /var/log/nsromania-setup.log
tail -f /var/log/nsromania-health.log
tail -f /var/log/syslog | grep -i error

# Database connectivity
mysql -u nsromania -p -e "SELECT 1" nightscout
mongosh --eval "db.adminCommand('ping')"
```

## Log File Locations

| Log | Location |
|-----|----------|
| Installation | `/var/log/nsromania-setup.log` |
| Health checks | `/var/log/nsromania-health.log` |
| Application output | `/home/nsromania/.pm2/logs/nsromania-setup-out.log` |
| Application errors | `/home/nsromania/.pm2/logs/nsromania-setup-error.log` |
| Nginx access | `/var/log/nginx/*.log` |
| MySQL | `/var/log/mysql/error.log` |
| MongoDB | `/var/log/mongodb/mongod.log` |
| BIND9 | Systemd journal: `journalctl -u bind9` |
| fail2ban | `/var/log/fail2ban.log` |
| SSH | `/var/log/auth.log` |
| System | `/var/log/syslog` |

---

## Still Having Issues?

1. **Collect diagnostics**:
   ```bash
   bash <<'EOF'
   echo "=== System Info ==="
   uname -a
   echo "=== Disk Space ==="
   df -h
   echo "=== Services ==="
   systemctl list-units --state=failed
   echo "=== Recent Errors ==="
   tail -f /var/log/syslog | head -20
   EOF
   ```

2. **Check all logs** for error messages

3. **Verify configuration files** haven't been modified

4. **Restart services** in order:
   ```bash
   systemctl restart mysql
   systemctl restart mongod
   systemctl restart bind9
   systemctl restart nginx
   sudo su - nsromania -c 'pm2 restart nsromania-setup'
   ```

5. **Review installation log**:
   ```bash
   tail -f /var/log/nsromania-setup.log
   ```

---

For more help, see `README.md` for full documentation.
