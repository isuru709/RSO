# Firebase Project Setup Guide

This guide documents how to configure the Firebase project (`university-rso`) for the Resource Sharing Platform.

## Prerequisites

- Access to the [Firebase Console](https://console.firebase.google.com/project/university-rso)
- Firebase Admin SDK service account key (already at `/config/firebase-service-account.json`)

---

## Step 1: Enable Authentication Providers

Go to [Firebase Console → Authentication → Sign-in method](https://console.firebase.google.com/project/university-rso/authentication/providers)

### 1.1 Email/Password

1. Click **Email/Password**
2. Toggle **Enable** → ON
3. Optionally toggle **Email link (passwordless sign-in)** → ON
4. Click **Save**

### 1.2 Google Sign-In

1. Click **Google**
2. Toggle **Enable** → ON
3. Set a **Project support email** (e.g., `isurudananjaya907@gmail.com`)
4. Click **Save**

### 1.3 Phone Authentication (Optional)

1. Click **Phone**
2. Toggle **Enable** → ON
3. For testing, add a test phone number under **Phone numbers for testing**
4. Click **Save**

> [!NOTE]
> Phone auth requires SMS costs. For development, Email/Password + Google Sign-In is sufficient.

---

## Step 2: Firebase Admin SDK

The Admin SDK service account key is located at:
```
/config/firebase-service-account.json
```

This is referenced in the `.env` file as:
```
FIREBASE_SERVICE_ACCOUNT_PATH=../config/firebase-service-account.json
```

The Admin SDK is used by services to:
- Verify Firebase ID tokens
- Set custom claims on users
- Create/manage users programmatically

---

## Step 3: Custom Claims Architecture

Every Firebase user MUST have these custom claims set after signup:

```json
{
  "role": "authenticated",
  "tenant_id": "<uuid>",
  "app_role": "student | lecturer | tenant_admin | super_admin"
}
```

### Why these claims matter

| Claim | Purpose |
|-------|---------|
| `role` | **Required by Supabase.** Determines which Postgres role (`authenticated` vs `anon`) executes queries. Firebase does NOT set this by default. |
| `tenant_id` | UUID of the user's faculty. Used by every RLS policy to scope data to the correct tenant. |
| `app_role` | Application-level role. Used by RLS policies and the `role-guard` middleware to enforce RBAC. |

### How claims are set

The `setUserClaims()` helper in the User Service sets these claims via `firebase-admin`:

```typescript
import { getAuth } from 'firebase-admin/auth';

await getAuth().setCustomUserClaims(uid, {
  role: 'authenticated',
  tenant_id: tenantId,
  app_role: appRole,
});
```

### When claims are set

1. **After signup** — The `/api/v1/users/signup` endpoint creates the user profile and sets initial claims
2. **On role change** — The `/api/v1/users/:uid/role` endpoint updates claims when a tenant_admin changes a user's role
3. **Client must refresh** — After claims are set, the client must call `getIdToken(true)` to force-refresh the token

---

## Step 4: Client-Side Integration

### Firebase Client Config

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyDkGLYJuGHkt3tIUAt1uxb6oXYTd1TWswA",
  authDomain: "university-rso.firebaseapp.com",
  projectId: "university-rso",
  storageBucket: "university-rso.firebasestorage.app",
  messagingSenderId: "848649911619",
  appId: "1:848649911619:web:302e540c182d5fc8cbc3f6",
  measurementId: "G-HNFT8F8HED"
};
```

### Auth Flow

```
1. User signs in with Firebase (Email/Password or Google)
2. Client gets ID token: await user.getIdToken()
3. Client calls POST /api/v1/users/signup with { tenant_code } + Bearer token
4. Server creates user_profiles row + sets custom claims
5. Client refreshes token: await user.getIdToken(true)
6. All subsequent API calls use the refreshed token with claims
```

---

## Troubleshooting

### "auth/claims-too-large"
Custom claims payload must be under 1000 bytes. Our payload (~100 bytes) is well within limits.

### Token doesn't have claims after signup
The client MUST call `getIdToken(true)` (with `true` to force refresh) after the signup endpoint returns. Without this, the cached token won't have the new claims.

### "auth/insufficient-permission"
Ensure the service account key has the `Firebase Admin SDK Administrator` role.
