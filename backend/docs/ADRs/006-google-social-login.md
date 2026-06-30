# ADR-006: Google Sign-In as Social Login Provider

**Status:** Accepted  
**Date:** 2026-06-22

## Context

The platform requires at least one social login provider in addition to Email/Password and OTP.

## Decision

**Google Sign-In** as the initial social login provider.

## Rationale

1. **University alignment:** Many universities use Google Workspace — students and staff likely already have Google accounts.
2. **Firebase integration:** Firebase Auth has first-class, zero-config Google Sign-In support.
3. **No additional credentials:** Enabling Google Sign-In in the Firebase Console requires no separate OAuth client registration (Firebase handles it internally).
4. **Extensibility:** Additional providers (GitHub, Microsoft) can be added later without architectural changes.

## Consequences

- Users without Google accounts must use Email/Password or phone OTP.
- Google Sign-In is a client-side flow; no server-side changes needed beyond the existing Firebase token verification.
