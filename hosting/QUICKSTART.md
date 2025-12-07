# VPS Setup - Quick Start Guide

## 30-Second Overview

This is an **automated VPS deployment system** that transforms a fresh Ubuntu 24.04 LTS server into a complete Nightscout hosting platform with:

- ✅ Nightscout instance management
- ✅ Control panel web interface
- ✅ Automatic SSL certificates (wildcard)
- ✅ DNS server (BIND9)
- ✅ Multiple databases (MySQL, MongoDB)
- ✅ Reverse proxy (Nginx)
- ✅ Process management (PM2)
- ✅ Security hardening (UFW, fail2ban)
- ✅ Automated monitoring & health checks

## Installation (2-3 Steps)

### Step 1: Prepare Your VPS

1. Deploy a **fresh Ubuntu 24.04 LTS** VPS from your provider
2. Note your VPS IP address
3. SSH into the VPS as root

### Step 2: Run Setup Script

```bash
curl -fsSL https://raw.githubusercontent.com/ktomy/nsromania-setup/main/hosting/vps-setup.sh | sudo bash
```

### Step 3: Answer Setup Wizard

The interactive wizard asks for:
- **Domain name** (e.g., nsromania.info)
- **Database passwords**
- **Admin user email**
- **Email service** (Brevo API key)
- **Optional**: OAuth keys, reCAPTCHA keys

⏱️ **Installation time**: 20-30 minutes

## After Installation

### Access Your Platform

- **Control Panel**: https://yourdomain.com
- **Sign In Options**:
  - Email magic link
  - GitHub OAuth
  - Google OAuth
  - (Your email should have admin access)

### Managing Nightscout Instances

1. Users submit registration requests
2. Admin reviews and approves
3. Instance automatically created with:
   - MongoDB database
   - DNS subdomain
   - Nginx routing
   - PM2 process
   - SSL certificate

### Important Files

| Purpose | Location |
|---------|----------|
| Application Code | `/opt/nsromania/setup` |
| Nightscout Code | `/opt/nsromania/nightscout/master` |
| Application Config | `/opt/nsromania/setup/.env` |
| Installation Config | `/opt/nsromania/.install-config.json` |

## Common Commands

```bash
# View application status
sudo su - nsromania -c 'pm2 list'

# View application logs
sudo su - nsromania -c 'pm2 logs nsromania-setup'

# Restart application
sudo su - nsromania -c 'pm2 restart nsromania-setup'

# Check service status
systemctl status nginx
systemctl status bind9
systemctl status mysql
systemctl status mongod

# Access databases
mysql -u nsromania -p nightscout
mongosh -u root -p [password] --authenticationDatabase admin

# Test DNS
dig @localhost yourdomain.com

# Check firewall
ufw status verbose

# View health check log
tail -f /var/log/nsromania-health.log
```

## What Gets Installed?

| Component | Purpose |
|-----------|---------|
| **Ubuntu 24.04** | Operating system |
| **Node.js 14** | Nightscout runtime |
| **Node.js 22** | Control panel runtime |
| **MySQL** | Control panel database |
| **MongoDB** | Nightscout instance databases |
| **BIND9** | DNS server for subdomains |
| **Nginx** | Web server & reverse proxy |
| **PM2** | Process manager for apps |
| **Let's Encrypt** | SSL certificates |
| **UFW** | Firewall |
| **fail2ban** | SSH protection |
| **Certbot** | SSL auto-renewal |

## Port Allocation

- **80**: HTTP (redirects to 443)
- **443**: HTTPS (control panel + subdomains)
- **53**: DNS (UDP/TCP)
- **22**: SSH
- **3000**: Control panel (localhost only)
- **11000-12000**: Nightscout instances (localhost only)

## DNS Setup

After installation, update your domain registrar's nameservers:

```
Nameserver 1: ns1.yourdomain.com    (points to VPS IP)
Nameserver 2: ns2.yourdomain.com    (points to VPS IP)
```

**Timeline**: DNS changes take 24-48 hours to propagate

## Recommended VPS Specs

| Users | CPU | RAM | Storage |
|-------|-----|-----|---------|
| < 10 instances | 2 cores | 4GB | 40GB SSD |
| 10-20 instances | 4 cores | 8GB | 80GB SSD |
| > 20 instances | 8+ cores | 16GB+ | 200GB+ SSD |

## Security Features

✅ Wildcard SSL certificate for all subdomains  
✅ SSH key-only authentication recommended  
✅ Automatic firewall (UFW) with port blocking  
✅ fail2ban SSH brute-force protection  
✅ Automatic security updates  
✅ Health monitoring every 5 minutes  
✅ Disk space monitoring daily  

## Troubleshooting

**Control panel not responding?**
```bash
sudo su - nsromania -c 'pm2 logs nsromania-setup'
```

**DNS not working?**
```bash
dig @localhost yourdomain.com
systemctl status bind9
```

**Database connection errors?**
```bash
systemctl status mysql
systemctl status mongod
```

**SSL certificate issues?**
```bash
certbot certificates
certbot renew --force-renewal
```

## Next Steps

1. ✅ Deploy VPS
2. ✅ Run setup script
3. ✅ Configure OAuth (GitHub/Google)
4. ✅ Access control panel at https://yourdomain.com
5. ✅ Create admin account
6. ✅ Start accepting Nightscout registrations!

## Support Resources

- 📖 Full documentation: See `README.md` in this directory
- 🐛 Issues: Review logs in `/var/log/nsromania-setup.log`
- 💾 Databases: Located in `/var/lib/mysql` and `/var/lib/mongodb`
- 🔧 Service logs: Use `journalctl -u [service-name] -n 100`

---

**Ready to get started?**

```bash
curl -fsSL https://raw.githubusercontent.com/ktomy/nsromania-setup/main/hosting/vps-setup.sh | sudo bash
```

Good luck! 🚀
