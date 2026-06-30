# 🇱🇰 Ubuntu VM එකේ Deploy කරන ආකාරය — පියවරෙන් පියවර මාර්ගෝපදේශය

## මෙම මාර්ගෝපදේශය ගැන

මෙම document එකෙන් ඔබට **Multi-Tenant Campus Resource Sharing Platform** එක Ubuntu VM එකක deploy කරන ආකාරය පියවරෙන් පියවර පැහැදිලි කරනවා.

---

## අවශ්‍ය දේවල්

ඔබ ආරම්භ කිරීමට පෙර මේවා ඇති බව සහතික කර ගන්න:

| අවශ්‍ය දෙය | විස්තරය |
|------------|---------|
| Ubuntu VM | Ubuntu 22.04 හෝ 24.04 LTS (RAM: 2GB+, Storage: 20GB+) |
| SSH Access | VM එකට SSH වලින් connect වෙන්න පුළුවන් වෙන්න ඕනෙ |
| Domain Name | `pro.isuruhub.site` (Cloudflare DNS හරහා) |
| Supabase Account | Database එක සඳහා |
| Firebase Project | Authentication සඳහා |
| Resend Account | Email notifications සඳහා |

---

## පියවර 1: VM එකට SSH වෙන්න

```bash
ssh username@your-vm-ip
```

> [!NOTE]
> `username` සහ `your-vm-ip` ඔබේ VM එකේ credentials වලට වෙනස් කරන්න.

---

## පියවර 2: System එක Update කරන්න

```bash
sudo apt update && sudo apt upgrade -y
```

---

## පියවර 3: Docker Install කරන්න

```bash
# Docker GPG key එක add කරන්න
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Docker repository එක add කරන්න
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker install කරන්න
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# ඔබේ user එකට Docker access දෙන්න (sudo නැතිව run කරන්න)
sudo usermod -aG docker $USER

# Group change එක activate කරන්න
newgrp docker
```

**Docker install වුනාද check කරන්න:**
```bash
docker --version
docker compose version
```

---

## පියවර 4: Node.js Install කරන්න

```bash
# NodeSource repository එකෙන් Node.js 22 install කරන්න
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify කරන්න
node --version   # v22.x.x
npm --version    # 10.x.x
```

---

## පියවර 5: Project එක Copy කරන්න

### Option A: Git Clone (recommended)

```bash
cd ~
git clone <your-repo-url> "Resource Share"
cd "Resource Share"
```

### Option B: SCP (Git නැත්නම්)

ඔබේ local PC එකෙන්:
```bash
scp -r "c:\Users\isuru\Desktop\Python\Resource Share" username@vm-ip:~/
```

VM එකේ:
```bash
cd ~/Resource\ Share
```

---

## පියවර 6: Dependencies Install කරන්න

```bash
cd ~/Resource\ Share
npm install
```

---

## පියවර 7: Environment Variables Set කරන්න

```bash
# .env.example එක copy කරන්න
cp infra/.env.example infra/.env

# ඔබේ real secrets වලින් edit කරන්න
nano infra/.env
```

**වෙනස් කළ යුතු values:**

```env
# Firebase — ඔබේ project details
FIREBASE_PROJECT_ID=university-rso
FIREBASE_API_KEY=ඔබේ-api-key
FIREBASE_AUTH_DOMAIN=university-rso.firebaseapp.com

# Supabase — ඔබේ project details
SUPABASE_URL=https://jpdotxyhemgkwlnlyhpz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=ඔබේ-service-role-key
SUPABASE_ANON_KEY=ඔබේ-anon-key
SUPABASE_JWT_SECRET=ඔබේ-jwt-secret

# Resend — Email සඳහා
RESEND_API_KEY=ඔබේ-resend-api-key

# Production mode
NODE_ENV=production
```

> [!IMPORTANT]
> `nano` editor එකේ save කරන්න: `Ctrl+O` → `Enter` → `Ctrl+X`

---

## පියවර 8: Firebase Service Account Key Copy කරන්න

### Option A: SCP (local PC එකෙන්)

ඔබේ Windows PC එකෙන්:
```bash
scp "c:\Users\isuru\Desktop\Python\Resource Share\config\firebase-service-account.json" username@vm-ip:~/Resource\ Share/config/
```

### Option B: Manual (paste කරන්න)

```bash
mkdir -p ~/Resource\ Share/config
nano ~/Resource\ Share/config/firebase-service-account.json
# Firebase Console එකෙන් download කරපු JSON content එක paste කරන්න
```

---

## පියවර 9: Cloudflare SSL Certificate Setup

### 9.1: Cloudflare Origin Certificate Generate කරන්න

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) එකට login වෙන්න
2. ඔබේ domain එක select කරන්න → **SSL/TLS** → **Origin Server**
3. **Create Certificate** click කරන්න
4. Default settings use කරන්න → **Create**
5. **Certificate** එක සහ **Private Key** එක copy කරන්න

### 9.2: Certificate Files Create කරන්න

```bash
# SSL directory එක create කරන්න
mkdir -p ~/Resource\ Share/infra/gateway/ssl

# Certificate එක paste කරන්න
nano ~/Resource\ Share/infra/gateway/ssl/origin.pem
# -----BEGIN CERTIFICATE----- .... -----END CERTIFICATE----- paste කරන්න

# Private key එක paste කරන්න
nano ~/Resource\ Share/infra/gateway/ssl/origin-key.pem
# -----BEGIN PRIVATE KEY----- .... -----END PRIVATE KEY----- paste කරන්න

# Permissions secure කරන්න
chmod 600 ~/Resource\ Share/infra/gateway/ssl/origin-key.pem
```

### 9.3: Cloudflare DNS Setup

1. **Cloudflare Dashboard** → **DNS** → **Records**
2. **A Record** add කරන්න:
   - Name: `pro`
   - Content: `ඔබේ VM එකේ IP address`
   - Proxy status: **Proxied** (orange cloud)
3. **SSL/TLS** → Encryption mode: **Full (Strict)**

---

## පියවර 10: Build සහ Deploy කරන්න 🚀

```bash
cd ~/Resource\ Share

# TypeScript build කරන්න
npm run build --workspaces

# Docker images build කරන්න සහ start කරන්න
cd infra
docker compose up -d --build
```

**Build එක ටිකක් වෙලා ගන්නවා (පළමු වතාවට ~5 minutes).**

---

## පියවර 11: Deploy Verify කරන්න

### 11.1: Containers Check කරන්න

```bash
docker compose ps
```

මේ containers 7ම **running** වෙන්න ඕනෙ:

| Container | Status |
|-----------|--------|
| rso-gateway | ✅ Running |
| rso-tenant-service | ✅ Running |
| rso-user-service | ✅ Running |
| rso-resource-service | ✅ Running |
| rso-booking-service | ✅ Running |
| rso-notification-service | ✅ Running |
| rso-redis | ✅ Running |

### 11.2: Health Check

```bash
# Local health check
curl http://localhost/health
# Expected: {"status":"ok","gateway":"nginx"}

# External health check (Cloudflare හරහා)
curl https://pro.isuruhub.site/health
# Expected: {"status":"ok","gateway":"nginx"}
```

### 11.3: API Test

```bash
# Auth නැතිව request එකක් — 401 ආව නම් හරි!
curl http://localhost/api/v1/tenants/
# Expected: {"success":false,"error":{"code":"AUTH_MISSING_TOKEN",...}}
```

---

## පියවර 12: Firewall Setup

```bash
# HTTP/HTTPS ports open කරන්න
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp    # SSH
sudo ufw enable
sudo ufw status
```

---

## 🔧 Troubleshooting — ගැටලු විසඳීම

### Container එකක් crash වුනොත්

```bash
# Logs බලන්න
docker compose logs tenant-service
docker compose logs booking-service

# Restart කරන්න
docker compose restart tenant-service
```

### Port 80 already in use

```bash
# Port 80 use කරන process එක find කරන්න
sudo lsof -i :80

# Apache/Nginx ඉවත් කරන්න
sudo systemctl stop apache2
sudo systemctl disable apache2
```

### Database Connection Error

```bash
# .env file එකේ SUPABASE_URL හරිද check කරන්න
cat infra/.env | grep SUPABASE

# Service logs බලන්න
docker compose logs tenant-service | tail -20
```

### Docker Build Fail වුනොත්

```bash
# Clean build
docker compose down
docker system prune -f
docker compose up -d --build
```

---

## 📋 Useful Commands — ප්‍රයෝජනවත් Commands

```bash
# ===== Status =====
docker compose ps                    # Containers බලන්න
docker compose logs -f               # Live logs බලන්න
docker compose logs booking-service  # එක service එකක logs

# ===== Restart =====
docker compose restart               # සියල්ල restart කරන්න
docker compose restart gateway       # Gateway එක විතරක් restart

# ===== Stop/Start =====
docker compose down                  # සියල්ල stop කරන්න
docker compose up -d                 # සියල්ල start කරන්න

# ===== Update =====
git pull                             # Code update ගන්න
npm run build --workspaces           # Rebuild TypeScript
cd infra && docker compose up -d --build  # Rebuild Docker
```

---

## 🔄 Auto-Restart Setup (Server Reboot වුනොත්)

```bash
# Docker service auto-start enable කරන්න
sudo systemctl enable docker

# Restart policy verify කරන්න
# docker-compose.yml එකේ restart: unless-stopped set වෙලා තියෙන නිසා
# VM restart වුනත් containers automatically start වෙනවා
```

---

## ✅ Checklist — Deploy කරාට පස්සේ

- [ ] `docker compose ps` — containers 7ම running
- [ ] `curl http://localhost/health` — `{"status":"ok"}`
- [ ] `curl https://pro.isuruhub.site/health` — `{"status":"ok"}`
- [ ] Firebase Authentication enable කරලා
- [ ] Supabase migrations apply කරලා
- [ ] SSL certificate files set කරලා
- [ ] Firewall ports open කරලා (80, 443, 22)
- [ ] Domain DNS A record set කරලා

---

> [!TIP]
> ගැටලුවක් ආවොත්, `docker compose logs -f` command එකෙන් live logs බලන්න. බොහෝ ගැටලු environment variables wrong වීම නිසා වෙනවා — `.env` file එක carefully check කරන්න.

---

*මෙම guide එක සැකසුවේ: Resource Sharing Platform Development Team*
*Last Updated: 2026-06-23*
