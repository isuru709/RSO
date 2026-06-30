# ADR-005: Fastify as HTTP Framework

**Status:** Accepted  
**Date:** 2026-06-22

## Context

All five microservices need an HTTP framework for routing, request validation, and middleware.

## Decision

**Fastify** (v5) for all services.

## Rationale

1. **Performance:** ~2x throughput over Express in benchmarks, with lower latency per request.
2. **TypeScript ergonomics:** First-class TypeScript support with `@fastify/type-provider-typebox` for schema-based request/response validation.
3. **Built-in features:** JSON serialization, pino-based structured logging, and a plugin/decorator architecture that maps cleanly to our shared middleware pattern.
4. **Ecosystem:** Mature plugins for CORS (`@fastify/cors`), rate limiting, and other common needs.

## Consequences

- Team must learn Fastify's plugin/decorator pattern (different from Express middleware).
- Some Express-only npm packages may not be compatible (rare for server-side utilities).
