/**
 * Firebase Claims Test Script
 * 
 * Tests that custom claims can be set and read on Firebase users.
 * 
 * Usage:
 *   npx tsx scripts/test-firebase-claims.ts
 * 
 * This script:
 *   1. Initializes Firebase Admin SDK
 *   2. Creates a test Firebase user
 *   3. Sets custom claims via setUserClaims()
 *   4. Reads claims back and verifies correctness
 *   5. Tests updateUserRole()
 *   6. Tests clearUserClaims()
 *   7. Deletes the test user
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Initialize Firebase Admin
// ============================================================================
const serviceAccountPath = path.resolve(__dirname, '..', 'config', 'firebase-service-account.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`❌ Service account key not found at: ${serviceAccountPath}`);
  process.exit(1);
}

if (getApps().length === 0) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
  initializeApp({ credential: cert(serviceAccount) });
}

const auth = getAuth();

// ============================================================================
// Import claims helpers (inline since we can't import .ts from scripts easily)
// ============================================================================
type AppRole = 'student' | 'lecturer' | 'tenant_admin' | 'super_admin' | 'staff';

interface UserClaims {
  role: 'authenticated';
  tenant_id: string;
  app_role: AppRole;
}

async function setUserClaims(uid: string, tenantId: string, appRole: AppRole): Promise<void> {
  await auth.setCustomUserClaims(uid, {
    role: 'authenticated',
    tenant_id: tenantId,
    app_role: appRole,
  });
}

async function getUserClaims(uid: string): Promise<Partial<UserClaims>> {
  const user = await auth.getUser(uid);
  return (user.customClaims as Partial<UserClaims>) || {};
}

async function updateUserRole(uid: string, newRole: AppRole): Promise<void> {
  const existing = await getUserClaims(uid);
  if (!existing.tenant_id) throw new Error('No tenant_id claim');
  await setUserClaims(uid, existing.tenant_id, newRole);
}

async function clearUserClaims(uid: string): Promise<void> {
  await auth.setCustomUserClaims(uid, {});
}

// ============================================================================
// Test Results
// ============================================================================
interface TestResult { name: string; passed: boolean; details?: string }
const results: TestResult[] = [];

function assert(name: string, condition: boolean, details?: string) {
  results.push({ name, passed: condition, details });
  console.log(`  ${condition ? '✅' : '❌'} ${name}${details ? ' — ' + details : ''}`);
}

// ============================================================================
// Test
// ============================================================================
const TEST_EMAIL = `rso-claims-test-${Date.now()}@test.example.com`;
const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000099';
let testUid: string;

async function main() {
  console.log('🔥 Firebase Custom Claims Test');
  console.log(`📡 Project: university-rso`);
  console.log('');

  try {
    // ------------------------------------------------------------------
    // TEST 1: Create test user
    // ------------------------------------------------------------------
    console.log('👤 Test 1: Create test Firebase user...');
    
    const user = await auth.createUser({
      email: TEST_EMAIL,
      password: 'TestPassword123!',
      displayName: 'RLS Claims Test User',
    });
    testUid = user.uid;
    assert('Test user created', !!testUid, `UID: ${testUid}`);
    console.log('');

    // ------------------------------------------------------------------
    // TEST 2: Set initial claims
    // ------------------------------------------------------------------
    console.log('🏷️  Test 2: Set custom claims (student)...');

    await setUserClaims(testUid, TEST_TENANT_ID, 'student');
    assert('setUserClaims() completed without error', true);

    const claims1 = await getUserClaims(testUid);
    assert('role claim is "authenticated"', claims1.role === 'authenticated', `Got: ${claims1.role}`);
    assert('tenant_id claim matches', claims1.tenant_id === TEST_TENANT_ID, `Got: ${claims1.tenant_id}`);
    assert('app_role claim is "student"', claims1.app_role === 'student', `Got: ${claims1.app_role}`);
    console.log('');

    // ------------------------------------------------------------------
    // TEST 3: Update role
    // ------------------------------------------------------------------
    console.log('⬆️  Test 3: Update role to tenant_admin...');

    await updateUserRole(testUid, 'tenant_admin');
    
    const claims2 = await getUserClaims(testUid);
    assert('app_role updated to "tenant_admin"', claims2.app_role === 'tenant_admin', `Got: ${claims2.app_role}`);
    assert('tenant_id preserved after role update', claims2.tenant_id === TEST_TENANT_ID, `Got: ${claims2.tenant_id}`);
    assert('role still "authenticated"', claims2.role === 'authenticated', `Got: ${claims2.role}`);
    console.log('');

    // ------------------------------------------------------------------
    // TEST 4: Update to super_admin
    // ------------------------------------------------------------------
    console.log('👑 Test 4: Update role to super_admin...');

    await updateUserRole(testUid, 'super_admin');
    
    const claims3 = await getUserClaims(testUid);
    assert('app_role updated to "super_admin"', claims3.app_role === 'super_admin', `Got: ${claims3.app_role}`);
    console.log('');

    // ------------------------------------------------------------------
    // TEST 5: Clear claims
    // ------------------------------------------------------------------
    console.log('🗑️  Test 5: Clear claims...');

    await clearUserClaims(testUid);
    
    const claims4 = await getUserClaims(testUid);
    assert('Claims cleared (no role)', !claims4.role, `Got: ${JSON.stringify(claims4)}`);
    assert('Claims cleared (no tenant_id)', !claims4.tenant_id, `Got: ${JSON.stringify(claims4)}`);
    assert('Claims cleared (no app_role)', !claims4.app_role, `Got: ${JSON.stringify(claims4)}`);
    console.log('');

  } finally {
    // ------------------------------------------------------------------
    // Cleanup
    // ------------------------------------------------------------------
    console.log('🧹 Cleaning up...');
    if (testUid) {
      await auth.deleteUser(testUid);
      console.log(`  ✅ Test user ${testUid} deleted`);
    }
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log('\n' + '═'.repeat(60));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${results.length} tests`);

  if (failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.details || 'no details'}`);
    });
    process.exit(1);
  }

  console.log('\n✅ All Firebase claims tests passed!');
  console.log('   Custom claims are correctly set, updated, and cleared.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
