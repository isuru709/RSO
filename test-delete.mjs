import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyDkGLYJuGHkt3tIUAt1uxb6oXYTd1TWswA',
  authDomain: 'university-rso.firebaseapp.com',
  projectId: 'university-rso'
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

signInWithEmailAndPassword(auth, 'admin@campusrso.local', 'admin123').then(async cred => {
  const token = await cred.user.getIdToken();
  const res = await fetch('http://localhost:3002/api/v1/users', { headers: { Authorization: 'Bearer ' + token } });
  const data = await res.json();
  const student = data.data.find(u => u.email === 'student@test.com');
  if (student) {
    console.log('Found student, attempting delete...', student.firebase_uid);
    const delRes = await fetch('http://localhost:3002/api/v1/users/' + student.firebase_uid, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token }
    });
    console.log('Delete response:', delRes.status, await delRes.text());
  } else {
    console.log('Student not found');
  }
  process.exit(0);
}).catch(console.error);
