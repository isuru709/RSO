/**
 * Supabase Client Wrapper — service_role singleton
 * 
 * All microservices use the service_role key to bypass RLS and enforce
 * tenant scoping in application code. RLS is defense-in-depth only.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

let client: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client using the service_role key.
 * The service_role key bypasses RLS — tenant scoping is enforced
 * in application code (handlers always filter by tenant_id from JWT).
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. ' +
      'Check your .env file or Docker compose environment.'
    );
  }

  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: 'public',
    },
  });

  logger.info({ url }, 'Supabase client initialized (service_role)');
  return client;
}

/**
 * Reset the client (useful for testing).
 */
export function resetSupabaseClient(): void {
  client = null;
}
