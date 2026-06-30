-- ============================================================================
-- Migration 00001: Extensions
-- ============================================================================
-- pgcrypto: gen_random_uuid() for primary keys
-- btree_gist: required for the EXCLUDE constraint that prevents double-booking
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;
