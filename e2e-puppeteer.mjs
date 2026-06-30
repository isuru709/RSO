import puppeteer from 'puppeteer';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('--- Starting E2E Browser Test ---');
  const browser = await puppeteer.launch({ headless: false, args: ['--window-size=1366,768'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });

  try {
    // 1. Admin login
    console.log('1. Admin logging in...');
    await page.goto('http://localhost:5173/login');
    await page.waitForSelector('input[type="text"]');
    await page.type('input[type="text"]', 'admin@campusrso.local');
    await page.type('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    // Wait for dashboard to load
    await page.waitForSelector('.nav-item');
    console.log('Admin login successful!');
    await delay(1000);

    // 2. Go to Users page
    console.log('2. Navigating to Users page...');
    const usersLink = await page.$$('::-p-xpath(//span[contains(text(), "Users")])');
    if (usersLink.length > 0) {
      await usersLink[0].click();
    } else {
      await page.goto('http://localhost:5173/admin/users');
    }
    
    await delay(2000);
    
    // 3. Register Student User
    console.log('3. Registering a student user...');
    const registerBtn = await page.$$('::-p-xpath(//button[contains(., "Register")])');
    if (registerBtn.length > 0) {
      await registerBtn[0].click();
      await delay(1000);
      
      const studentEmail = `student_${Date.now()}@test.com`;
      await page.type('input[placeholder*="John Doe"]', 'Test Student');
      await page.type('input[placeholder*="user@university"]', studentEmail);
      await page.type('input[placeholder*="Min 6 characters"]', 'student123');
      await page.type('input[placeholder*="230571F"]', '12345');
      
      await page.select('select', 'student');
      
      const createBtn = await page.$$('::-p-xpath(//button[contains(., "Create")])');
      if (createBtn.length > 0) await createBtn[createBtn.length - 1].click();
      
      console.log('Student created: ' + studentEmail);
      await delay(3000); // Wait for toast and DB
      
      // Log out
      console.log('Logging out admin...');
      await page.evaluate(() => {
        window.localStorage.clear();
        window.location.href = '/login';
      });
      await delay(2000);
      
      // 4. Student login
      console.log('4. Student logging in...');
      await page.waitForSelector('input[type="text"]');
      await page.type('input[type="text"]', studentEmail);
      await page.type('input[type="password"]', 'student123');
      await page.click('button[type="submit"]');
      await delay(3000);
      
      // 5. Student books equipment
      console.log('5. Student booking equipment...');
      await page.goto('http://localhost:5173/bookings');
      await delay(2000);
      
      const newBookingBtn = await page.$$('::-p-xpath(//button[contains(., "New Booking")])');
      if (newBookingBtn.length > 0) await newBookingBtn[0].click();
      await delay(1000);
      
      // Find equipment option
      await page.waitForSelector('select');
      const equipmentOptionValue = await page.evaluate(() => {
        const select = document.querySelector('select');
        const options = Array.from(select.options);
        // Find one that contains 'EQUIPMENT' or just pick the first valid one 
        // (student restricted to equipment anyway)
        for (const opt of options) {
          if (opt.value && opt.value !== '') return opt.value;
        }
        return null;
      });
      
      if (!equipmentOptionValue) throw new Error("No equipment found to book");
      await page.select('select', equipmentOptionValue);
      
      await page.type('input[type="date"]', '2027-01-01');
      await page.type('input[type="time"]', '10:00');
      // Tab to next time input
      await page.keyboard.press('Tab');
      await page.keyboard.type('11:00');
      
      await page.type('input[placeholder*="Title"]', 'Student Project');
      
      const submitBookingBtn = await page.$$('::-p-xpath(//button[contains(., "Create Booking") or contains(., "Submit")])');
      if (submitBookingBtn.length > 0) await submitBookingBtn[submitBookingBtn.length - 1].click();
      
      console.log('Student booking created!');
      await delay(3000);
      
      // Log out
      console.log('Logging out student...');
      await page.evaluate(() => {
        window.localStorage.clear();
        window.location.href = '/login';
      });
      await delay(2000);
      
      // 6. Admin overrides booking
      console.log('6. Admin logging back in to override booking...');
      await page.waitForSelector('input[type="text"]');
      await page.type('input[type="text"]', 'admin@campusrso.local');
      await page.type('input[type="password"]', 'admin123');
      await page.click('button[type="submit"]');
      await delay(3000);
      
      console.log('Admin creating exact same booking...');
      await page.goto('http://localhost:5173/bookings');
      await delay(2000);
      
      const newBookingBtn2 = await page.$$('::-p-xpath(//button[contains(., "New Booking")])');
      if (newBookingBtn2.length > 0) await newBookingBtn2[0].click();
      await delay(1000);
      
      await page.select('select', equipmentOptionValue);
      await page.type('input[type="date"]', '2027-01-01');
      await page.type('input[type="time"]', '10:00');
      await page.keyboard.press('Tab');
      await page.keyboard.type('11:00');
      await page.type('input[placeholder*="Title"]', 'Admin Override');
      
      const submitBookingBtn2 = await page.$$('::-p-xpath(//button[contains(., "Create Booking") or contains(., "Submit")])');
      if (submitBookingBtn2.length > 0) await submitBookingBtn2[submitBookingBtn2.length - 1].click();
      
      console.log('Admin booking submitted!');
      await delay(4000);
      
      console.log('7. Verifying Bumped status in the table...');
      await page.goto('http://localhost:5173/bookings');
      await delay(3000);
      
      const pageText = await page.evaluate(() => document.body.innerText);
      if (pageText.includes('Bumped')) {
        console.log('✅ SUCCESS: Found "Bumped" status on the bookings page! Priority bumping works!');
      } else {
        console.log('❌ ERROR: Did not find "Bumped" status on the page.');
      }
      
    } else {
      console.log('Register button not found!');
    }
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await browser.close();
  }
}

runTest();
