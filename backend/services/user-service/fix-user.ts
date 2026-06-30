/**
 * Fix user account for isurudananjaya907@gmail.com
 * Creates profile if missing, sets claims
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createClient } from '@supabase/supabase-js';

const serviceAccount = require('../../config/firebase-service-account.json');
initializeApp({ credential: cert(serviceAccount) });

const supabase = createClient(
  'https://jpdotxyhemgkwlnlyhpz.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

async function main() {
  const email = 'isurudananjaya907@gmail.com';

  // Step 1: Check if Firebase user exists
  let fbUser;
  try {
    fbUser = await getAuth().getUserByEmail(email);
    console.log('Firebase user found:', fbUser.uid);
    console.log('  Custom claims:', fbUser.customClaims);
  } catch (err: any) {
    console.log('Firebase user NOT found:', err.message);
    console.log('User needs to sign up again via the UI.');
    return;
  }

  // Step 2: Check if Supabase profile exists
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('firebase_uid', fbUser.uid)
    .single();

  console.log('Supabase profile:', profile ? 'EXISTS' : 'MISSING');
  if (error) console.log('  Error:', error.message);

  // Step 3: Get default tenant
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, code')
    .eq('code', 'ADMIN')
    .single();

  if (!tenant) {
    console.log('No ADMIN tenant found!');
    return;
  }
  console.log('Using tenant:', tenant.name, '(' + tenant.id + ')');

  // Step 4: Create profile if missing
  if (!profile) {
    const { data: newProfile, error: insertErr } = await supabase
      .from('user_profiles')
      .insert({
        firebase_uid: fbUser.uid,
        tenant_id: tenant.id,
        email: fbUser.email,
        full_name: fbUser.displayName || email.split('@')[0],
        role: 'student',
        member_id: null,
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Failed to create profile:', insertErr);
      return;
    }
    console.log('Profile CREATED:', newProfile.firebase_uid);
  }

  // Step 5: Set Firebase claims
  await getAuth().setCustomUserClaims(fbUser.uid, {
    role: 'authenticated',
    tenant_id: tenant.id,
    app_role: profile?.role || 'student',
  });
  console.log('Firebase claims SET');

  console.log('\n✅ Done! User should sign out and sign back in.');
}

main().catch(console.error);
