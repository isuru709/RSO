# ADR-003: Resend for Transactional Email

**Status:** Accepted  
**Date:** 2026-06-22

## Context

The Notification Service needs to send actual emails for booking confirmations, conflict alerts, and optimization reports.

## Decision

**Resend** as the primary email provider, with **SMTP** (via nodemailer) as a configurable fallback.

## Rationale

1. **Developer experience:** Resend's Node.js SDK is TypeScript-first with a clean REST API — no SMTP configuration complexity.
2. **Free tier:** 100 emails/day on the free plan; sufficient for development and early deployment.
3. **Simplicity:** Single API key via env var `RESEND_API_KEY`.
4. **Flexibility:** An `EmailProvider` interface abstracts the transport — switching to SMTP or another provider requires only changing the `EMAIL_PROVIDER` env var.

## Consequences

- External dependency on Resend's API availability.
- Free tier has sending limits; paid plan needed for production scale.
- SMTP fallback available via `EMAIL_PROVIDER=smtp` with standard SMTP env vars.
