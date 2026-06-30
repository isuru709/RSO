/**
 * Migration Runner — Applies SQL migrations to Supabase via REST API
 * 
 * Usage:
 *   npx tsx scripts/run-migrations.ts
 * 
 * Reads all .sql files from /supabase/migrations/ in alphabetical order
 * and executes them against your Supabase project using the service_role key.
 * 
 * Requirements:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env or infra/.env
 */

import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jpdotxyhemgkwlnlyhpz.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required');
  console.error('   Set it as an environment variable or in infra/.env');
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

async function executeSql(sql: string, filename: string): Promise<boolean> {
  const url = `${SUPABASE_URL}/rest/v1/rpc/`;

  // Use the Supabase SQL API (via pg_net or direct REST)
  // For hosted Supabase, we use the /rest/v1/ endpoint with raw SQL via RPC
  // Alternative: use the Supabase Management API or SQL Editor
  
  // The simplest approach for hosted Supabase is the SQL Editor API
  const sqlEditorUrl = `${SUPABASE_URL}/pg/query`;
  
  try {
    const response = await fetch(sqlEditorUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ query: sql }),
    });

    if (!response.ok) {
      // Try alternative endpoint
      const altResponse = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Prefer': 'return=representation',
        },
        body: sql,
      });

      if (!altResponse.ok) {
        const errorText = await response.text();
        console.error(`   ❌ Failed: ${errorText}`);
        return false;
      }
    }

    console.log(`   ✅ Applied successfully`);
    return true;
  } catch (err) {
    console.error(`   ❌ Error: ${(err as Error).message}`);
    return false;
  }
}

async function main() {
  console.log('🗄️  Supabase Migration Runner');
  console.log(`📡 Target: ${SUPABASE_URL}`);
  console.log('');

  // Read migration files in order
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found in', MIGRATIONS_DIR);
    process.exit(0);
  }

  console.log(`Found ${files.length} migration files:\n`);

  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    console.log(`📄 ${file}...`);
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    const success = await executeSql(sql, file);
    if (success) {
      successCount++;
    } else {
      failCount++;
      console.log(`\n⚠️  Migration ${file} failed. Stopping.`);
      console.log('   You can apply it manually in the Supabase Dashboard SQL Editor.');
      break;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${successCount} succeeded, ${failCount} failed`);
  
  if (failCount > 0) {
    console.log('\n📋 MANUAL FALLBACK:');
    console.log('   1. Go to https://supabase.com/dashboard/project/jpdotxyhemgkwlnlyhpz/sql');
    console.log('   2. Open each migration file in order');
    console.log('   3. Paste the SQL and click "Run"');
    console.log('   4. Verify in Table Editor that all tables are created');
    process.exit(1);
  }

  console.log('\n✅ All migrations applied successfully!');
  console.log('   Verify at: https://supabase.com/dashboard/project/jpdotxyhemgkwlnlyhpz/editor');
}

main().catch(console.error);
