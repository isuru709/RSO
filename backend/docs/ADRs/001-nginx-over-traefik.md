# ADR-001: Nginx over Traefik for API Gateway

**Status:** Accepted  
**Date:** 2026-06-22

## Context

The platform needs a reverse proxy / API gateway that:
- Terminates TLS using a Cloudflare Origin Certificate
- Routes by path prefix to 5 microservices
- Provides per-route rate limiting
- Exposes health-check endpoints

## Decision

**Nginx** over Traefik.

## Rationale

1. **Existing config:** A working `nginx.conf` with SSL termination, security headers, and rate limiting already exists in the project — adapting it is less effort than rewriting for Traefik.
2. **Rate limiting:** Nginx's `limit_req` module provides per-zone rate limiting with burst handling. Traefik's equivalent requires middleware chains that are more verbose to configure.
3. **Memory footprint:** Nginx uses ~5MB vs Traefik's ~50MB+ — significant on a single droplet.
4. **Maturity:** Nginx's SSL/TLS handling is battle-tested; the existing config already works correctly with Cloudflare Full (Strict) mode.

## Consequences

- No automatic service discovery (Docker labels); upstream blocks must be updated manually when services are added/renamed.
- No built-in dashboard; monitoring is via access/error logs.
