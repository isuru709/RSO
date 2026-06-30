const fs = require('fs');
const { initializeApp: initAdmin, cert } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');

async function testToken() {
  const sa = JSON.parse(fs.readFileSync('../../config/firebase-service-account.json', 'utf8'));
  initAdmin({ credential: cert(sa) });

  const apiKey = 'AIzaSyDkGLYJuGHkt3tIUAt1uxb6oXYTd1TWswA';
  // Attempt to sign in via REST API
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@campusrso.local',
      password: 'adminpassword',
      returnSecureToken: true
    })
  });
  
  const data = await res.json();
  if (data.error) {
    console.error('Login failed:', data.error);
    return;
  }
  
  const token = data.idToken;
  console.log('Got token for:', data.email);

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    console.log('Verified token successfully! UID:', decoded.uid);
  } catch (err) {
    console.error('Verification failed!');
    console.error('Code:', err.code);
    console.error('Message:', err.message);
  }
}

testToken();
