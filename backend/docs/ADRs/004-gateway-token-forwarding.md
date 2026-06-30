# ADR-004: Gateway-Verified Firebase Token Forwarding

**Status:** Accepted  
**Date:** 2026-06-22

## Context

Downstream microservices need to know the identity (Firebase UID, tenant_id, app_role) of the requesting user. Options considered:

1. **Forward the raw Firebase ID token** and verify in each service.
2. **Verify at the gateway, re-sign an internal JWT**, forward the internal token to services.
3. **Verify at the gateway, inject claims as headers**, services trust the headers.

## Decision

**Option 1 — Forward the raw Firebase ID token.** Each service verifies it independently using `firebase-admin`'s `verifyIdToken()`, which caches Google's JWKS keys in-memory automatically.

## Rationale

1. **No key management overhead:** Option 2 requires generating, distributing, and rotating an internal signing key across all containers.
2. **Performance:** `firebase-admin` caches Google's public keys and auto-refreshes on expiry — verification is ~1ms after initial fetch. No per-request JWKS network call.
3. **Zero trust:** Each service independently verifies the token's cryptographic signature. Option 3 would trust the gateway not to be misconfigured.
4. **Simplicity:** The shared auth middleware handles this uniformly — no gateway-specific code needed.

## Consequences

- Each service includes `firebase-admin` as a dependency (via the shared package).
- First request after cold start may take ~200ms for JWKS fetch; subsequent requests are cached.
- If Firebase rotates keys, all services pick up new keys automatically (no manual intervention).
