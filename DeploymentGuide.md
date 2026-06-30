# 🌐 Deployment මාර්ගෝපදේශය — Campus RSO Platform

## 📌 සාරාංශය

මෙම මාර්ගෝපදේශය DigitalOcean server (168.144.45.214) එකේ RSO platform deploy කර Cloudflare DNS හරහා `pro.isuruhub.site` ලෙස host කරන ආකාරය පියවරෙන් පියවර පෙන්වයි.

### Deployment Architecture

```
User Browser
    ↓
Cloudflare (DNS + CDN + SSL)
    ↓  (pro.isuruhub.site → 168.144.45.214)
DigitalOcean Server (K3s Cluster)
    ↓
Nginx Gateway (Port 80/443)
    ↓
┌─────────────────────────────────────────┐
│  K3s Cluster (rso namespace)            │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Tenant   │ │ User     │ │Resource │ │
│  │ Service  │ │ Service  │ │Service  │ │
│  └──────────┘ └──────────┘ └─────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Booking  │ │Notific.  │ │ Redis   │ │
│  │ Service  │ │ Service  │ │         │ │
│  └──────────┘ └──────────┘ └─────────┘ │
└─────────────────────────────────────────┘
    ↓                            ↓
Supabase (Database)     Firebase (Auth)
```

---

## 🌍 Part 1: Cloudflare DNS Setup

### 1.1 Cloudflare එකට Login

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) visit කරන්න
2. ඔබේ account එකට login කරන්න
3. `isuruhub.site` domain select කරන්න

### 1.2 DNS Record Add කිරීම

**DNS** → **Records** → **Add Record**

| Type | Name | Content | Proxy Status | TTL |
|---|---|---|---|---|
| `A` | `pro` | `168.144.45.214` | ☁️ Proxied | Auto |

> [!IMPORTANT]
> **Proxy Status** "Proxied" (orange cloud ☁️) ලෙස තබන්න!
> මෙමගින් Cloudflare CDN, DDoS protection, සහ SSL ලැබේ.

### 1.3 DNS Propagation Verify

```bash
# DNS record check කිරීම
nslookup pro.isuruhub.site

# හෝ dig use කරන්න
dig pro.isuruhub.site +short
```

Output එක Cloudflare IP addresses පෙන්විය යුතුය (ඔබේ server IP නොවේ, Cloudflare proxy නිසා).

---

## 🔒 Part 2: Cloudflare SSL/TLS Setup

### 2.1 SSL Mode Set කිරීම

**SSL/TLS** → **Overview** → **Full (strict)** select කරන්න

```
Browser ←──HTTPS──→ Cloudflare ←──HTTPS──→ DigitalOcean Server
         CF SSL                   Origin Cert
```

### 2.2 Origin Certificate Generate

මෙම certificate ඔබේ server එක Cloudflare සමඟ encrypted communicate කිරීමට use කරයි.

1. **SSL/TLS** → **Origin Server** → **Create Certificate**
2. Settings:
   - **Private key type:** RSA (2048)
   - **Hostnames:** `pro.isuruhub.site`, `*.isuruhub.site`
   - **Certificate validity:** 15 years
3. **Create** click කරන්න
4. **Origin Certificate** copy → file save: `origin.pem`
5. **Private Key** copy → file save: `origin-key.pem`

> [!CAUTION]
> ⚠️ Private Key එක **එක් වරක් පමණි** display වේ!
> Create button click කිරීමට **පෙර** copy කරන්න!

### 2.3 Origin Certificates Server එකට Upload

```bash
# Local machine එකෙන් server එකට upload
scp origin.pem root@168.144.45.214:~/origin.pem
scp origin-key.pem root@168.144.45.214:~/origin-key.pem
```

### 2.4 Kubernetes SSL Secret Create

```bash
# Server එකේ
kubectl create secret generic ssl-origin-certs -n rso \
  --from-file=origin.pem=/root/origin.pem \
  --from-file=origin-key.pem=/root/origin-key.pem

# Files cleanup (security)
rm /root/origin.pem /root/origin-key.pem
```

---

## 🛡️ Part 3: Cloudflare Security Settings

### 3.1 Always Use HTTPS

**SSL/TLS** → **Edge Certificates** → **Always Use HTTPS** → ✅ **ON**

### 3.2 Minimum TLS Version

**SSL/TLS** → **Edge Certificates** → **Minimum TLS Version** → `TLS 1.2`

### 3.3 HSTS Enable (Optional)

**SSL/TLS** → **Edge Certificates** → **HTTP Strict Transport Security (HSTS)**
- **Enable HSTS:** ✅
- **Max Age:** 6 months
- **Include subdomains:** ✅

### 3.4 WAF (Web Application Firewall)

**Security** → **WAF** → **Managed Rules** → ✅ **ON**

> [!TIP]
> Cloudflare Free plan එකේ ද basic WAF protection ලැබේ.

---

## 🔥 Part 4: Cloudflare Firewall Rules

### 4.1 Rate Limiting Rule

**Security** → **WAF** → **Rate Limiting Rules** → **Create Rule**

| Setting | Value |
|---|---|
| Rule name | `API Rate Limit` |
| If... | URI Path contains `/api/` |
| Requests | 100 requests per 1 minute |
| Action | Block |

### 4.2 Bot Fight Mode

**Security** → **Bots** → **Bot Fight Mode** → ✅ **ON**

---

## 📡 Part 5: Server Firewall Setup

### 5.1 UFW (Uncomplicated Firewall) Configure

```bash
# Server එකේ
# SSH access allow
ufw allow 22/tcp

# HTTP & HTTPS (Cloudflare එකෙන් එන traffic)
ufw allow 80/tcp
ufw allow 443/tcp

# ArgoCD Dashboard (ඔබේ IP එකෙන් පමණක්)
ufw allow from <ඔබේ_home_IP> to any port 30443 proto tcp

# K3s API server (ඔබේ IP එකෙන් පමණක්)
ufw allow from <ඔබේ_home_IP> to any port 6443 proto tcp

# Firewall enable
ufw enable

# Status check
ufw status verbose
```

> [!WARNING]
> Firewall enable කිරීමට **පෙර** SSH (port 22) allow කර ඇති බව **තහවුරු කරන්න!**
> නැතහොත් server access අහිමි වේ!

### 5.2 Cloudflare Only Access (Optional)

Cloudflare IP ranges පමණක් port 80/443 access කිරීමට:

```bash
# Cloudflare IPv4 ranges allow
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  ufw allow from $ip to any port 80,443 proto tcp
done

# Default deny for 80/443
ufw default deny incoming
ufw allow 22/tcp
```

---

## 🚢 Part 6: First Deployment — Step by Step

### 6.1 Repo Clone & Config Files Upload

```bash
# Server එකේ
cd /root
git clone https://github.com/isuru709/RSO.git
cd RSO
```

### 6.2 All Secrets Create

```bash
# (1) Namespace
kubectl create namespace rso

# (2) Application secrets
kubectl create secret generic rso-secrets -n rso \
  --from-literal=SUPABASE_URL='<ඔබේ_SUPABASE_URL>' \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY='<ඔබේ_KEY>' \
  --from-literal=FIREBASE_API_KEY='<ඔබේ_FIREBASE_KEY>' \
  --from-literal=RESEND_API_KEY='<ඔබේ_RESEND_KEY>' \
  --from-literal=NOTIFICATION_FROM_EMAIL='onboarding@resend.dev' \
  --from-literal=EMAIL_PROVIDER='resend'

# (3) Firebase service account
kubectl create secret generic firebase-service-account -n rso \
  --from-file=firebase-service-account.json=/root/firebase-service-account.json

# (4) SSL certificates
kubectl create secret generic ssl-origin-certs -n rso \
  --from-file=origin.pem=/root/origin.pem \
  --from-file=origin-key.pem=/root/origin-key.pem

# (5) Nginx config
kubectl create configmap gateway-nginx-conf -n rso \
  --from-file=nginx.conf=/root/RSO/backend/infra/gateway/nginx.conf

# (6) GHCR pull secret
kubectl create secret docker-registry ghcr-secret -n rso \
  --docker-server=ghcr.io \
  --docker-username=isuru709 \
  --docker-password=<ඔබේ_GITHUB_PAT> \
  --docker-email=<ඔබේ_email>
```

### 6.3 ArgoCD Application Deploy

```bash
kubectl apply -f /root/RSO/k8s/argocd/application.yaml
```

### 6.4 Deployment Verify

```bash
# Pods check
kubectl get pods -n rso -w

# Expected output (සියල්ල Running විය යුතුය):
# NAME                                    READY   STATUS    RESTARTS   AGE
# redis-xxx                               1/1     Running   0          1m
# tenant-service-xxx                      1/1     Running   0          1m
# user-service-xxx                        1/1     Running   0          1m
# resource-service-xxx                    1/1     Running   0          1m
# booking-service-xxx                     1/1     Running   0          1m
# notification-service-xxx                1/1     Running   0          1m
# gateway-xxx                             1/1     Running   0          1m

# Services check
kubectl get svc -n rso
```

---

## 🌐 Part 7: Domain Access Verify

### 7.1 HTTPS Access Test

```bash
# Server එකෙන්
curl -k https://localhost/health

# ඔබේ domain එකෙන්
curl https://pro.isuruhub.site/health
```

Expected response:
```json
{"status":"ok","gateway":"nginx"}
```

### 7.2 API Endpoints Test

```bash
# Resources endpoint
curl https://pro.isuruhub.site/api/v1/resources

# Health check
curl https://pro.isuruhub.site/health
```

### 7.3 Browser Test

Browser එකෙන් `https://pro.isuruhub.site` open කරන්න.

> [!NOTE]
> Frontend SPA serve කිරීමට Nginx gateway location `/` block update කිරීම අවශ්‍ය වේ.
> Production එකේදී frontend service එකට proxy pass කිරීම recommend කරයි.

---

## 🔄 Part 8: Continuous Deployment Flow

### කොහොමද deploy වෙන්නේ?

1. ✏️ ඔබ code change එකක් `main` branch එකට push කරයි
2. 🏗️ GitHub Actions automatically Docker images build කරයි
3. 📦 GHCR (GitHub Container Registry) එකට images push කරයි
4. 📝 `kustomization.yaml` file එකේ image tags update කරයි
5. 🔍 ArgoCD Git repo changes detect කරයි (≈3 min)
6. 🚀 ArgoCD automatically K8s cluster එක sync කරයි
7. ♻️ Rolling update — zero downtime deployment!
8. ✅ Health checks pass → deployment complete!

### Manual Rollback

```bash
# Previous version එකට rollback කිරීම
argocd app rollback rso-platform

# Specific revision එකට rollback
argocd app history rso-platform
argocd app rollback rso-platform <revision_number>
```

---

## 📊 Part 9: Monitoring & Maintenance

### 9.1 Pod Logs Check

```bash
# Specific service logs
kubectl logs -n rso -l app=booking-service --tail=100 -f

# Gateway logs
kubectl logs -n rso -l app=gateway --tail=50

# All services logs
kubectl logs -n rso --all-containers --tail=20
```

### 9.2 Resource Usage

```bash
# Node resources
kubectl top nodes

# Pod resources
kubectl top pods -n rso
```

### 9.3 Service Restart

```bash
# Single service restart
kubectl rollout restart -n rso deployment/booking-service

# All services restart
kubectl rollout restart -n rso deployment
```

### 9.4 Scaling (ඉදිරියේදී)

```bash
# Booking service 2 replicas ලෙස scale
kubectl scale deployment/booking-service -n rso --replicas=2
```

---

## 🛠️ Troubleshooting

### Problem: Site not loading

```bash
# 1. Pods running ද?
kubectl get pods -n rso

# 2. Gateway service exposed ද?
kubectl get svc gateway -n rso

# 3. Nginx config correct ද?
kubectl logs -n rso -l app=gateway

# 4. DNS correct ද?
nslookup pro.isuruhub.site
```

### Problem: 502 Bad Gateway

```bash
# Backend services healthy ද?
kubectl get pods -n rso

# Specific service logs
kubectl logs -n rso -l app=booking-service --tail=50

# Service endpoints resolve වෙනවද?
kubectl get endpoints -n rso
```

### Problem: SSL Error

```bash
# SSL secret exists ද?
kubectl get secret ssl-origin-certs -n rso

# Cloudflare SSL mode correct ද?
# Dashboard → SSL/TLS → "Full (strict)" ද?

# Origin certificate valid ද?
kubectl get secret ssl-origin-certs -n rso -o jsonpath='{.data.origin\.pem}' | base64 -d | openssl x509 -noout -dates
```

### Problem: ArgoCD OutOfSync

```bash
# ArgoCD app status
argocd app get rso-platform

# Force sync
argocd app sync rso-platform --force

# Hard refresh
argocd app get rso-platform --hard-refresh
```

---

## ✅ Complete Deployment Checklist

### Server Setup
- [ ] SSH access ක්‍රියාත්මකයි
- [ ] K3s install කර ඇත
- [ ] ArgoCD install කර ඇත
- [ ] UFW firewall configure කර ඇත

### Cloudflare Setup
- [ ] `A` record (`pro` → `168.144.45.214`) add කර ඇත
- [ ] Proxy status: Proxied ☁️
- [ ] SSL mode: Full (strict)
- [ ] Origin Certificate generate කර ඇත
- [ ] Always Use HTTPS: ON

### Kubernetes Secrets
- [ ] `rso-secrets` — application env vars
- [ ] `firebase-service-account` — Firebase SA JSON
- [ ] `ssl-origin-certs` — Cloudflare Origin certs
- [ ] `gateway-nginx-conf` — Nginx ConfigMap
- [ ] `ghcr-secret` — GHCR pull authentication

### CI/CD Pipeline
- [ ] GitHub Actions workflow push කර ඇත
- [ ] First build success ✅
- [ ] Images GHCR එකේ ඇත
- [ ] ArgoCD sync success ✅
- [ ] `https://pro.isuruhub.site` load වේ ✅

---

## 📁 Project File Structure

```
RSO/
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions CI Pipeline
├── k8s/
│   ├── argocd/
│   │   └── application.yaml      # ArgoCD Application resource
│   ├── base/
│   │   ├── namespace.yaml         # rso namespace
│   │   ├── configmap.yaml         # Non-secret config
│   │   ├── redis.yaml             # Redis deployment
│   │   ├── services.yaml          # 5 microservice deployments
│   │   ├── gateway.yaml           # Nginx gateway
│   │   └── kustomization.yaml     # Base kustomization
│   └── overlays/
│       └── production/
│           └── kustomization.yaml # Production overlay (ArgoCD watches)
├── backend/
│   ├── infra/
│   │   ├── docker-compose.yml     # Local development
│   │   ├── .env                   # Local secrets
│   │   └── gateway/
│   │       ├── nginx.conf         # API Gateway config
│   │       └── ssl/               # Local SSL certs
│   └── services/
│       ├── tenant-service/        # + Dockerfile
│       ├── user-service/          # + Dockerfile
│       ├── resource-service/      # + Dockerfile
│       ├── booking-service/       # + Dockerfile
│       └── notification-service/  # + Dockerfile
├── frontend/
│   ├── Dockerfile                 # Frontend Docker build
│   └── nginx.conf                 # Frontend SPA Nginx config
├── CI-CDGuide.md                  # 📘 CI/CD මාර්ගෝපදේශය (සිංහල)
└── DeploymentGuide.md             # 📘 Deployment මාර්ගෝපදේශය (සිංහල)
```

---

> [!TIP]
> 🎉 **සුබ පැතුම්!** ඔබේ Campus RSO Platform දැන් production-ready CI/CD pipeline එකක් සමඟ deploy වී ඇත!
> `main` branch එකට push කරන සෑම code change එකක්ම automatically deploy වේ!
