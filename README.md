# Multi-Tenant Campus Resource Sharing Platform

A microservices-based platform for managing shared resources (lecture halls, labs, equipment) across university faculties with multi-tenant isolation, booking conflict prevention, and real-time notifications.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Nginx Gateway (:80/:443)           │
│           Rate Limiting + TLS Termination            │
├─────────┬──────────┬───────────┬──────────┬─────────┤
│ Tenant  │  User    │ Resource  │ Booking  │ Notify  │
│ Service │ Service  │ Service   │ Service  │ Service │
│  :3001  │  :3002   │  :3003    │  :3004   │  :3005  │
├─────────┴──────────┴───────────┴──────────┴─────────┤
│              @rso/shared (common lib)                │
├──────────────────────┬──────────────────────────────┤
│    Supabase (DB)     │         Redis (Events)        │
└──────────────────────┴──────────────────────────────┘
```

### Services

| Service | Port | Purpose |
|---------|------|---------|
| **Tenant** | 3001 | Faculty/department CRUD |
| **User** | 3002 | Profiles, signup, role management, Firebase claims |
| **Resource** | 3003 | Resource catalog, availability checks |
| **Booking** | 3004 | Booking CRUD, approve/reject workflow, conflict detection |
| **Notification** | 3005 | In-app notifications, email via Resend, Redis event consumer |
| **Gateway** | 80/443 | Nginx reverse proxy, rate limiting, TLS |
| **Redis** | 6379 | Event streaming between services |

### Tech Stack

- **Runtime:** Node.js 22 + TypeScript + Fastify
- **Database:** Supabase (PostgreSQL) with Row Level Security
- **Auth:** Firebase Authentication + Custom Claims
- **Events:** Redis Streams (pub/sub)
- **Email:** Resend API
- **Gateway:** Nginx with rate limiting
- **Containers:** Docker + Docker Compose
- **DNS/TLS:** Cloudflare (Origin Certificate, Full Strict mode)

---

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 22
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- A [Supabase](https://supabase.com/) project
- A [Firebase](https://firebase.google.com/) project with Authentication enabled
- A [Resend](https://resend.com/) account (for email notifications)

---

## Quick Start

### 1. Clone and Install

```bash
git clone <repo-url>
cd "Resource Share"
npm install
```

### 2. Configure Environment

```bash
cp infra/.env.example infra/.env
# Edit infra/.env with your actual secrets
```

Required secrets:
- **Firebase:** `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`
- **Firebase Admin SDK:** Place your service account JSON at `config/firebase-service-account.json`
- **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`
- **Resend:** `RESEND_API_KEY`

### 3. Run Database Migrations

Apply the SQL migrations to your Supabase project via the [SQL Editor](https://supabase.com/dashboard/project/_/sql):

Run each file in order from `supabase/migrations/`:
1. `001_extensions.sql`
2. `002_tenants.sql`
3. `003_user_profiles.sql`
4. `004_resources.sql`
5. `005_bookings.sql`
6. `006_notifications.sql`
7. `007_optimization_logs.sql`
8. `008_rls_policies.sql`
9. `009_triggers_functions.sql`

### 4. Configure Firebase

1. Enable **Email/Password** and **Google** sign-in in Firebase Console → Authentication → Sign-in method
2. Download the Admin SDK service account key and save as `config/firebase-service-account.json`
3. See `docs/firebase-setup.md` for detailed instructions

### 5. Build and Run

```bash
# Build all TypeScript services
npm run build --workspaces

# Start with Docker Compose
cd infra
docker compose up -d
```

### 6. Verify

```bash
# Gateway health check
curl http://localhost/health
# → {"status":"ok","gateway":"nginx"}

# All services return 401 (auth required) — correct!
curl http://localhost/api/v1/tenants/
# → {"success":false,"error":{"code":"AUTH_MISSING_TOKEN",...}}
```

---

## API Reference

All endpoints require a Firebase ID token: `Authorization: Bearer <token>`

### Tenants (`/api/v1/tenants/`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/tenants/` | Any | List tenants (paginated) |
| GET | `/api/v1/tenants/:id` | Any | Get tenant by ID |
| POST | `/api/v1/tenants/` | super_admin | Create tenant |
| PUT | `/api/v1/tenants/:id` | tenant_admin+ | Update tenant |
| DELETE | `/api/v1/tenants/:id` | super_admin | Deactivate tenant |
| GET | `/api/v1/tenants/:id/stats` | tenant_admin+ | Tenant statistics |

### Users (`/api/v1/users/`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/users/signup` | Any (Firebase token) | Create profile + set claims |
| GET | `/api/v1/users/me` | Any | Get own profile |
| GET | `/api/v1/users/` | tenant_admin+ | List users (paginated) |
| GET | `/api/v1/users/:uid` | Any | Get user by UID |
| PUT | `/api/v1/users/:uid` | Self or admin | Update profile |
| PUT | `/api/v1/users/:uid/role` | tenant_admin+ | Change user role |
| DELETE | `/api/v1/users/:uid` | tenant_admin+ | Deactivate user |

### Resources (`/api/v1/resources/`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/resources/` | Any | List resources (paginated, filterable) |
| GET | `/api/v1/resources/:id` | Any | Get resource |
| POST | `/api/v1/resources/` | tenant_admin+ | Create resource |
| PUT | `/api/v1/resources/:id` | tenant_admin+ | Update resource |
| DELETE | `/api/v1/resources/:id` | tenant_admin+ | Retire resource |
| GET | `/api/v1/resources/:id/availability` | Any | Check availability by date |

### Bookings (`/api/v1/bookings/`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/bookings/` | Any | List bookings (filterable) |
| GET | `/api/v1/bookings/:id` | Any | Get booking |
| POST | `/api/v1/bookings/` | Any | Create booking |
| PUT | `/api/v1/bookings/:id/approve` | tenant_admin+ | Approve booking |
| PUT | `/api/v1/bookings/:id/reject` | tenant_admin+ | Reject booking |
| PUT | `/api/v1/bookings/:id/cancel` | Owner or admin | Cancel booking |
| GET | `/api/v1/bookings/optimization/stats` | tenant_admin+ | Optimization logs |

### Notifications (`/api/v1/notifications/`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/notifications/` | Any | Get own notifications |
| PUT | `/api/v1/notifications/:id/read` | Any | Mark as read |
| PUT | `/api/v1/notifications/read-all` | Any | Mark all as read |
| GET | `/api/v1/notifications/unread-count` | Any | Get unread count |

---

## Multi-Tenancy

Every user belongs to exactly one tenant (faculty). Data isolation is enforced at two levels:

1. **Application layer** — Every query filters by `tenant_id` from the JWT claims
2. **Database layer** — Supabase RLS policies scope all queries by `tenant_id`

### Roles

| Role | Permissions |
|------|-------------|
| `student` | View resources, create bookings, view own bookings/notifications |
| `lecturer` | Same as student |
| `staff` | Same as student |
| `tenant_admin` | Manage resources, approve/reject bookings, manage users within tenant |
| `super_admin` | Full access across all tenants |

---

## Project Structure

```
Resource Share/
├── config/                      # Firebase service account key
├── docs/                        # Setup guides
│   ├── firebase-setup.md
│   └── supabase-firebase-setup.md
├── infra/                       # Docker + Gateway
│   ├── docker-compose.yml
│   ├── Dockerfile.service
│   ├── .env / .env.example
│   └── gateway/
│       ├── nginx.conf
│       └── ssl/                 # Cloudflare Origin Certificate
├── scripts/                     # Migration & test scripts
│   ├── run-migrations.ts
│   ├── verify-rls.ts
│   └── test-firebase-claims.ts
├── services/
│   ├── shared/                  # @rso/shared — common library
│   │   └── src/
│   │       ├── auth-middleware.ts
│   │       ├── supabase-client.ts
│   │       ├── redis-client.ts
│   │       ├── error-handler.ts
│   │       ├── logger.ts
│   │       ├── role-guard.ts
│   │       └── types.ts
│   ├── tenant-service/
│   ├── user-service/
│   ├── resource-service/
│   ├── booking-service/
│   └── notification-service/
├── supabase/
│   └── migrations/              # 9 ordered SQL migration files
├── package.json                 # npm workspaces root
└── tsconfig.base.json
```

---

## Development

```bash
# Build all services
npm run build --workspaces

# Run a single service locally (without Docker)
npm run dev -w services/tenant-service

# Run Firebase claims test
npx tsx scripts/test-firebase-claims.ts

# Run RLS verification
npx tsx scripts/verify-rls.ts
```

---

## Cloudflare DNS Setup

1. Add an **A record** pointing `pro.isuruhub.site` to your server's IP
2. Set SSL/TLS mode to **Full (Strict)**
3. Generate an **Origin Certificate** in Cloudflare dashboard
4. Save the certificate and key to `infra/gateway/ssl/origin.pem` and `origin-key.pem`

---

## License

Private — University of Kelaniya
