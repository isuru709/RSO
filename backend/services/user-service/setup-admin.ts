import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load .env
const envPath = resolve('../../infra/.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.substring(0, eq).trim()] = t.substring(eq + 1).trim();
  }
}

const sa = JSON.parse(readFileSync('../../config/firebase-service-account.json', 'utf-8'));
initializeApp({ credential: cert(sa) });
const adminAuth = getAuth();
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log('=== STEP 1: Clean all test/demo data ===\n');

  // Delete all rows from tables (order matters due to FK constraints)
  const tables = ['notifications', 'optimization_logs', 'bookings', 'resources', 'user_profiles', 'tenants'];
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    // user_profiles uses firebase_uid as PK
    if (error && table === 'user_profiles') {
      const { error: e2 } = await supabase.from(table).delete().neq('firebase_uid', '___none___');
      if (e2) console.error(`  ✗ ${table}:`, e2.message);
      else console.log(`  ✓ Cleaned ${table}`);
    } else if (error) {
      console.error(`  ✗ ${table}:`, error.message);
    } else {
      console.log(`  ✓ Cleaned ${table}`);
    }
  }

  // Delete all Firebase users
  console.log('\n  Cleaning Firebase users...');
  const listResult = await adminAuth.listUsers(100);
  for (const u of listResult.users) {
    await adminAuth.deleteUser(u.uid);
    console.log(`  ✓ Deleted Firebase user: ${u.email || u.uid}`);
  }

  console.log('\n=== STEP 2: Create admin tenant ===\n');

  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .insert({
      name: 'University Administration',
      code: 'ADMIN',
      slug: 'admin',
      description: 'Central university administration',
      contact_email: 'admin@university.edu',
    })
    .select()
    .single();

  if (tenantErr) { console.error('Tenant error:', tenantErr); process.exit(1); }
  console.log(`  ✓ Created tenant: ${tenant.name} (${tenant.id})`);

  console.log('\n=== STEP 3: Create admin Firebase user ===\n');

  const email = 'admin@campusrso.local';
  const password = 'admin123';

  const adminUser = await adminAuth.createUser({
    email,
    password,
    displayName: 'System Administrator',
  });

  await adminAuth.setCustomUserClaims(adminUser.uid, {
    role: 'authenticated',
    app_role: 'main_admin',
    tenant_id: tenant.id,
  });

  console.log(`  ✓ Created Firebase user: ${email} / ${password}`);
  console.log(`  ✓ UID: ${adminUser.uid}`);
  console.log(`  ✓ Claims: main_admin`);

  console.log('\n=== STEP 4: Create admin user_profile ===\n');

  const { error: profileErr } = await supabase
    .from('user_profiles')
    .insert({
      firebase_uid: adminUser.uid,
      tenant_id: tenant.id,
      email,
      full_name: 'System Administrator',
      role: 'main_admin',
    });

  if (profileErr) { console.error('Profile error:', profileErr); process.exit(1); }
  console.log(`  ✓ Created user_profile row`);

  console.log('\n========================================');
  console.log('  ADMIN SETUP COMPLETE');
  console.log('========================================');
  console.log(`  Username: admin`);
  console.log(`  Password: admin`);
  console.log(`  Email:    ${email}`);
  console.log(`  Role:     main_admin`);
  console.log(`  Tenant:   ${tenant.name}`);
  console.log('========================================\n');

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
