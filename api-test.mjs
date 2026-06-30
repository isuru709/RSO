const BASE_URL = 'http://localhost:5173/api/v1';

async function test() {
  console.log('--- Starting API E2E Test ---');
  
  // 1. Admin login
  console.log('1. Logging in as Admin...');
  const adminLoginRes = await fetch(`${BASE_URL}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@campusrso.local', password: 'admin123' })
  });
  if (!adminLoginRes.ok) throw new Error('Admin login failed: ' + await adminLoginRes.text());
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.data.token;
  console.log('Admin login successful!');

  // 2. Create Student User
  const studentEmail = `student_${Date.now()}@test.com`;
  console.log(`2. Creating student user (${studentEmail})...`);
  const createUserRes = await fetch(`${BASE_URL}/users/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      email: studentEmail,
      password: 'student123',
      full_name: 'API Test Student',
      role: 'student',
      member_id: '12345'
    })
  });
  if (!createUserRes.ok) throw new Error('Create student failed: ' + await createUserRes.text());
  console.log('Student created successfully!');

  // 3. Student Login
  console.log('3. Logging in as Student...');
  const studentLoginRes = await fetch(`${BASE_URL}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: studentEmail, password: 'student123' })
  });
  if (!studentLoginRes.ok) throw new Error('Student login failed: ' + await studentLoginRes.text());
  const studentData = await studentLoginRes.json();
  const studentToken = studentData.data.token;
  console.log('Student login successful!');

  // 4. Get an EQUIPMENT resource
  console.log('4. Finding an EQUIPMENT resource...');
  const resourcesRes = await fetch(`${BASE_URL}/resources`, {
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  const resourcesData = await resourcesRes.json();
  const equipment = resourcesData.data.find(r => r.category === 'EQUIPMENT');
  if (!equipment) throw new Error('No EQUIPMENT resource found in the database!');
  console.log(`Found equipment: ${equipment.name} (ID: ${equipment.id})`);

  // 5. Student books the equipment
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const startTime = tomorrow.toISOString();
  tomorrow.setHours(11, 0, 0, 0);
  const endTime = tomorrow.toISOString();

  console.log('5. Student booking the equipment...');
  const studentBookingRes = await fetch(`${BASE_URL}/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    },
    body: JSON.stringify({
      resource_id: equipment.id,
      start_time: startTime,
      end_time: endTime,
      title: 'Student Test Project',
      purpose: 'Testing API'
    })
  });
  if (!studentBookingRes.ok) throw new Error('Student booking failed: ' + await studentBookingRes.text());
  const studentBooking = await studentBookingRes.json();
  console.log('Student booking created! Status: ' + studentBooking.data.status);

  // 6. Admin books the SAME equipment at the SAME time
  console.log('6. Admin booking the SAME equipment to test priority bumping...');
  const adminBookingRes = await fetch(`${BASE_URL}/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      resource_id: equipment.id,
      start_time: startTime,
      end_time: endTime,
      title: 'Admin Override Test',
      purpose: 'Testing Priority Engine'
    })
  });
  if (!adminBookingRes.ok) throw new Error('Admin booking failed: ' + await adminBookingRes.text());
  console.log('Admin booking created successfully!');

  // 7. Verify student booking status
  console.log('7. Verifying student booking status was bumped...');
  const verifyRes = await fetch(`${BASE_URL}/bookings`, {
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  const verifyData = await verifyRes.json();
  const myBooking = verifyData.data.find(b => b.id === studentBooking.data.id);
  console.log(`Student booking status is now: ${myBooking.status}`);

  if (myBooking.status === 'bumped') {
    console.log('SUCCESS: Priority bumping logic works perfectly!');
  } else {
    console.error('ERROR: Booking was not bumped! Status is ' + myBooking.status);
  }
}

test().catch(console.error);
