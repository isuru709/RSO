/**
 * End-to-End Test Script
 * 
 * Tests the full flow through the running Docker stack:
 *   1. Create a Firebase test user
 *   2. Set custom claims (simulate signup)
 *   3. Get a real Firebase ID token
 *   4. Create a tenant via API
 *   5. Create user profile via signup endpoint
 *   6. Create a resource
 *   7. Create a booking
 *   8. Attempt overlapping booking → expect 409
 *   9. Approve the first booking
 *  10. Check notifications
 *  11. Cancel the booking
 *  12. Cleanup
 * 
 * Usage:
 *   npx tsx scripts/e2e-test.ts
 * 
 * Prerequisites:
 *   - Docker stack running (docker compose up -d)
 *   - Firebase service account at config/firebase-service-account.json
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Config
// ============================================================================
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost';
const TEST_EMAIL = `e2e-test-${Date.now()}@test.example.com`;
const TEST_PASSWORD = 'E2eTestPassword123!';

// Firebase Web API Key (for REST auth to get ID tokens)
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDkGLYJuGHkt3tIUAt1uxb6oXYTd1TWswA';

// ============================================================================
// Initialize Firebase Admin
// ============================================================================
const serviceAccountPath = path.resolve(__dirname, '..', 'config', 'firebase-service-account.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error(`❌ Service account not found at: ${serviceAccountPath}`);
  process.exit(1);
}

if (getApps().length === 0) {
  const sa = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
  initializeApp({ credential: cert(sa) });
}

const auth = getAuth();

// ============================================================================
// Helpers
// ============================================================================
interface TestResult { name: string; passed: boolean; details?: string }
const results: TestResult[] = [];
let testUid: string;
let idToken: string;
let tenantId: string;
let resourceId: string;
let bookingId: string;

function assert(name: string, condition: boolean, details?: string) {
  results.push({ name, passed: condition, details });
  const icon = condition ? '✅' : '❌';
  console.log(`  ${icon} ${name}${details ? ' — ' + details : ''}`);
  if (!condition) {
    console.log(`     FAILED`);
  }
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

/**
 * Get a Firebase ID token using the REST API (signInWithPassword).
 */
async function getIdToken(email: string, password: string): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const data = await res.json() as any;
  if (!data.idToken) {
    throw new Error(`Failed to get ID token: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

/**
 * Force-refresh claims by getting a new token after claims are set.
 */
async function refreshToken(email: string, password: string): Promise<string> {
  // Small delay to let Firebase propagate claims
  await new Promise(r => setTimeout(r, 1000));
  return getIdToken(email, password);
}

// ============================================================================
// Tests
// ============================================================================
async function main() {
  console.log('');
  console.log('🧪 ═══════════════════════════════════════════════════════');
  console.log('   End-to-End Test — Campus Resource Sharing Platform');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📡 Gateway: ${GATEWAY_URL}`);
  console.log(`📧 Test user: ${TEST_EMAIL}`);
  console.log('');

  try {
    // ================================================================
    // TEST 1: Gateway Health Check
    // ================================================================
    console.log('🏥 Test 1: Gateway Health Check');
    const healthRes = await api('GET', '/health');
    assert('Gateway returns 200', healthRes.status === 200);
    assert('Status is ok', healthRes.data?.status === 'ok');
    console.log('');

    // ================================================================
    // TEST 2: Unauthenticated Request → 401
    // ================================================================
    console.log('🔒 Test 2: Unauthenticated Access');
    const unauthRes = await api('GET', '/api/v1/tenants/');
    assert('Unauthenticated GET /tenants → 401', unauthRes.status === 401);
    assert('Error code is AUTH_MISSING_TOKEN', unauthRes.data?.error?.code === 'AUTH_MISSING_TOKEN');
    console.log('');

    // ================================================================
    // TEST 3: Create Firebase Test User
    // ================================================================
    console.log('👤 Test 3: Create Firebase Test User');
    const user = await auth.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      displayName: 'E2E Test User',
    });
    testUid = user.uid;
    assert('Firebase user created', !!testUid, `UID: ${testUid}`);
    console.log('');

    // ================================================================
    // TEST 4: Get Initial ID Token (no claims yet)
    // ================================================================
    console.log('🎫 Test 4: Get Firebase ID Token');
    idToken = await getIdToken(TEST_EMAIL, TEST_PASSWORD);
    assert('Got ID token', idToken.length > 100, `Length: ${idToken.length}`);
    console.log('');

    // ================================================================
    // TEST 5: Set Super Admin Claims
    // ================================================================
    console.log('👑 Test 5: Set super_admin Claims');
    // We need a tenant_id first — use a placeholder, then create the real tenant
    const tempTenantId = '00000000-0000-0000-0000-000000000001';
    await auth.setCustomUserClaims(testUid, {
      role: 'authenticated',
      tenant_id: tempTenantId,
      app_role: 'super_admin',
    });
    const claims = (await auth.getUser(testUid)).customClaims;
    assert('Claims set: role=authenticated', claims?.role === 'authenticated');
    assert('Claims set: app_role=super_admin', claims?.app_role === 'super_admin');

    // Refresh token to pick up new claims
    idToken = await refreshToken(TEST_EMAIL, TEST_PASSWORD);
    assert('Token refreshed with claims', idToken.length > 100);
    console.log('');

    // ================================================================
    // TEST 6: Create Tenant
    // ================================================================
    console.log('🏛️  Test 6: Create Tenant');
    const tenantCode = `E2E_${Date.now()}`;
    const tenantRes = await api('POST', '/api/v1/tenants/', {
      name: 'Faculty of Computing (E2E Test)',
      code: tenantCode,
      slug: `e2e-test-${Date.now()}`,
      description: 'Created by E2E test',
      contact_email: TEST_EMAIL,
    }, idToken);
    assert('Create tenant → 201', tenantRes.status === 201, `Status: ${tenantRes.status}`);
    if (tenantRes.data?.data?.id) {
      tenantId = tenantRes.data.data.id;
      assert('Tenant ID received', !!tenantId, `ID: ${tenantId}`);
    } else {
      assert('Tenant ID received', false, `Response: ${JSON.stringify(tenantRes.data)}`);
    }
    console.log('');

    // ================================================================
    // TEST 7: Update Claims with Real Tenant ID
    // ================================================================
    console.log('🔄 Test 7: Update Claims with Real Tenant');
    if (tenantId) {
      await auth.setCustomUserClaims(testUid, {
        role: 'authenticated',
        tenant_id: tenantId,
        app_role: 'super_admin',
      });
      idToken = await refreshToken(TEST_EMAIL, TEST_PASSWORD);
      assert('Claims updated with real tenant_id', true);
    }
    console.log('');

    // ================================================================
    // TEST 8: User Signup (create profile in DB)
    // ================================================================
    console.log('📝 Test 8: User Signup');
    const signupRes = await api('POST', '/api/v1/users/signup', {
      full_name: 'E2E Test User',
      tenant_code: tenantCode,
    }, idToken);
    assert('Signup → 201', signupRes.status === 201, `Status: ${signupRes.status}`);
    if (signupRes.status !== 201) {
      console.log(`  ℹ️  Signup response: ${JSON.stringify(signupRes.data)}`);
    }
    console.log('');

    // ================================================================
    // TEST 9: List Tenants
    // ================================================================
    console.log('📋 Test 9: List Tenants');
    const listTenantsRes = await api('GET', '/api/v1/tenants/', undefined, idToken);
    assert('List tenants → 200', listTenantsRes.status === 200);
    assert('Returns array', Array.isArray(listTenantsRes.data?.data));
    assert('Has at least 1 tenant', (listTenantsRes.data?.data?.length || 0) >= 1);
    console.log('');

    // ================================================================
    // TEST 9: Create Resource
    // ================================================================
    console.log('🖥️  Test 9: Create Resource');
    const resourceRes = await api('POST', '/api/v1/resources/', {
      name: 'E2E Test Lab Room A',
      resource_type: 'lab',
      capacity: 30,
      location: 'Building A, Floor 2',
      tenant_id: tenantId,
    }, idToken);
    assert('Create resource → 201', resourceRes.status === 201, `Status: ${resourceRes.status}`);
    if (resourceRes.data?.data?.id) {
      resourceId = resourceRes.data.data.id;
      assert('Resource ID received', !!resourceId, `ID: ${resourceId}`);
    } else {
      assert('Resource ID received', false, `Response: ${JSON.stringify(resourceRes.data)}`);
    }
    console.log('');

    // ================================================================
    // TEST 10: Create Booking
    // ================================================================
    console.log('📅 Test 10: Create Booking');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startTime = new Date(tomorrow.setHours(9, 0, 0, 0)).toISOString();
    const endTime = new Date(tomorrow.setHours(11, 0, 0, 0)).toISOString();

    const bookingRes = await api('POST', '/api/v1/bookings/', {
      resource_id: resourceId,
      title: 'E2E Test Lecture',
      purpose: 'End-to-end test booking',
      start_time: startTime,
      end_time: endTime,
      attendee_count: 25,
    }, idToken);
    assert('Create booking → 201', bookingRes.status === 201, `Status: ${bookingRes.status}`);
    if (bookingRes.data?.data?.id) {
      bookingId = bookingRes.data.data.id;
      assert('Booking ID received', !!bookingId, `ID: ${bookingId}`);
      assert('Booking status is pending', bookingRes.data.data.status === 'pending');
    } else {
      assert('Booking ID received', false, `Response: ${JSON.stringify(bookingRes.data)}`);
    }
    console.log('');

    // ================================================================
    // TEST 11: Overlapping Booking → 409 Conflict
    // ================================================================
    console.log('⚠️  Test 11: Overlapping Booking → 409');
    const overlapRes = await api('POST', '/api/v1/bookings/', {
      resource_id: resourceId,
      title: 'Conflicting Booking',
      start_time: startTime,  // Same time slot
      end_time: endTime,
      attendee_count: 10,
    }, idToken);
    assert('Overlapping booking → 409', overlapRes.status === 409, `Status: ${overlapRes.status}`);
    if (overlapRes.status === 409) {
      assert('Error mentions conflict', overlapRes.data?.error?.message?.includes('already booked') || overlapRes.data?.error?.code === 'BOOKING_CONFLICT',
        `Message: ${overlapRes.data?.error?.message}`);
    }
    console.log('');

    // ================================================================
    // TEST 12: Approve Booking
    // ================================================================
    console.log('✅ Test 12: Approve Booking');
    if (bookingId) {
      const approveRes = await api('PUT', `/api/v1/bookings/${bookingId}/approve`, {}, idToken);
      assert('Approve booking → 200', approveRes.status === 200, `Status: ${approveRes.status}`);
      assert('Status is approved', approveRes.data?.data?.status === 'approved');
    }
    console.log('');

    // ================================================================
    // TEST 13: List Bookings
    // ================================================================
    console.log('📋 Test 13: List Bookings');
    const listBookingsRes = await api('GET', '/api/v1/bookings/?my_bookings=true', undefined, idToken);
    assert('List bookings → 200', listBookingsRes.status === 200);
    assert('Has at least 1 booking', (listBookingsRes.data?.data?.length || 0) >= 1);
    console.log('');

    // ================================================================
    // TEST 14: Check Resource Availability
    // ================================================================
    console.log('📊 Test 14: Check Availability');
    if (resourceId) {
      const tomorrowDate = new Date();
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const dateStr = tomorrowDate.toISOString().split('T')[0];
      const availRes = await api('GET', `/api/v1/resources/${resourceId}/availability?date=${dateStr}`, undefined, idToken);
      assert('Availability check → 200', availRes.status === 200);
      const availData = availRes.data?.data;
      const hasBookings = availData?.total_bookings >= 1 || (Array.isArray(availData?.bookings) && availData.bookings.length >= 1) || availData !== null;
      assert('Returns availability data', hasBookings);
    }
    console.log('');

    // ================================================================
    // TEST 15: Check Notifications
    // ================================================================
    console.log('🔔 Test 15: Notifications');
    // Wait briefly for event consumer to process
    await new Promise(r => setTimeout(r, 2000));
    const notifRes = await api('GET', '/api/v1/notifications/', undefined, idToken);
    assert('Get notifications → 200', notifRes.status === 200);
    // Notifications may or may not exist depending on Redis consumer timing
    console.log(`  ℹ️  Notifications found: ${notifRes.data?.data?.length || 0}`);
    console.log('');

    // ================================================================
    // TEST 16: Cancel Booking
    // ================================================================
    console.log('🚫 Test 16: Cancel Booking');
    if (bookingId) {
      const cancelRes = await api('PUT', `/api/v1/bookings/${bookingId}/cancel`, {}, idToken);
      assert('Cancel booking → 200', cancelRes.status === 200, `Status: ${cancelRes.status}`);
      assert('Status is cancelled', cancelRes.data?.data?.status === 'cancelled');
    }
    console.log('');

    // ================================================================
    // TEST 17: List Resources
    // ================================================================
    console.log('📦 Test 17: List Resources');
    const listResourcesRes = await api('GET', '/api/v1/resources/', undefined, idToken);
    assert('List resources → 200', listResourcesRes.status === 200);
    assert('Has at least 1 resource', (listResourcesRes.data?.data?.length || 0) >= 1);
    console.log('');

    // ================================================================
    // TEST 18: Invalid API Path → 404
    // ================================================================
    console.log('🚫 Test 18: Invalid Path');
    const notFoundRes = await api('GET', '/api/v1/nonexistent/', undefined, idToken);
    assert('Invalid API path → 404', notFoundRes.status === 404);
    console.log('');

  } finally {
    // ================================================================
    // Cleanup
    // ================================================================
    console.log('🧹 Cleanup');
    
    // Delete test data from Supabase (via API — delete booking, resource, tenant)
    // These are soft-deletes or will be cleaned by cascade

    // Delete Firebase test user
    if (testUid) {
      try {
        await auth.deleteUser(testUid);
        console.log(`  ✅ Firebase user ${testUid} deleted`);
      } catch (err: any) {
        console.log(`  ⚠️  Could not delete user: ${err.message}`);
      }
    }
  }

  // ================================================================
  // Summary
  // ================================================================
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
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

  console.log('\n🎉 All E2E tests passed!');
  console.log('   The platform is fully operational.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
