# ADR-002: Redis Streams over RabbitMQ for Message Broker

**Status:** Accepted  
**Date:** 2026-06-22

## Context

The platform needs an async message broker for:
- Booking event fan-out (created, approved, rejected, conflict)
- Optimization job scheduling and consumption
- Notification dispatch triggering

## Decision

**Redis Streams** (using the same Redis instance already needed for caching and rate-limit counters).

## Rationale

1. **Single moving part:** Redis is already required for resource-availability caching. Using Redis Streams avoids adding RabbitMQ as a second infrastructure dependency.
2. **Sufficient complexity:** Our event patterns are simple — point-to-point delivery or fan-out to 1–2 consumer groups. We don't need exchange routing, dead-letter queues, or durable multi-consumer guarantees.
3. **Consumer groups:** Redis Streams supports consumer groups with message acknowledgment, pending entry lists, and re-delivery — enough for our reliability needs.
4. **Operational simplicity:** One fewer container to monitor, secure, and update.

## Consequences

- No built-in retry with exponential backoff (must implement in application code).
- No exchange-based routing; stream names act as topics.
- If Redis goes down, both caching and messaging are affected (single point of failure — acceptable for a single-droplet deployment).
