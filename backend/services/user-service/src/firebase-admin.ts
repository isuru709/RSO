/**
 * Firebase Admin SDK Initialization
 * 
 * Initializes the Firebase Admin SDK with the service account credentials.
 * This module should be imported once at service startup.
 */

import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import * as path from 'path';
import * as fs from 'fs';

let firebaseApp: App;

export function initFirebaseAdmin(): App {
  // Don't re-initialize if already done
  if (getApps().length > 0) {
    firebaseApp = getApps()[0];
    return firebaseApp;
  }

  // Resolve service account path
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.resolve(__dirname, '..', '..', '..', 'config', 'firebase-service-account.json');

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      `Firebase service account key not found at: ${serviceAccountPath}\n` +
      `Set FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS env var.`
    );
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));

  firebaseApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
  });

  return firebaseApp;
}

export { firebaseApp };
