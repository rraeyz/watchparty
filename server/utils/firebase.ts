import config from "../config.ts";
import admin from "firebase-admin";

// Accounts are optional. A malformed credential should disable logins, not
// take the whole server down, so validate before initializing and fall back to
// running without Firebase if anything is off.
let firebaseReady = false;

if (config.FIREBASE_ADMIN_SDK_CONFIG) {
  try {
    const serviceAccount = JSON.parse(config.FIREBASE_ADMIN_SDK_CONFIG);
    if (typeof serviceAccount?.private_key !== "string") {
      throw new Error(
        'missing "private_key" — paste the whole service account JSON file',
      );
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: config.FIREBASE_DATABASE_URL,
    });
    firebaseReady = true;
  } catch (e) {
    console.error(
      "[FIREBASE] Admin SDK config is invalid, accounts are disabled:",
      e instanceof Error ? e.message : e,
    );
  }
}

export async function validateUserToken(uid: string, token: string) {
  if (!firebaseReady) {
    return undefined;
  }
  if (!token) {
    return undefined;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (uid !== decoded.uid) {
      // Valid but for wrong user
      return undefined;
    }
    return decoded;
  } catch (e) {
    // Promise rejects if verification failed
    console.log(e);
    return undefined;
  }
}

export async function writeData(key: string, value: string) {
  if (!firebaseReady) {
    return;
  }
  await admin.database().ref(key).set(value);
}

export async function getUserByEmail(email: string) {
  if (!firebaseReady) {
    return null;
  }
  try {
    return await admin.auth().getUserByEmail(email);
  } catch (e: any) {
    console.log(email, e.message);
  }
  return null;
}

export async function getUser(uid: string) {
  if (!firebaseReady) {
    return null;
  }
  return await admin.auth().getUser(uid);
}

export async function getUserEmail(uid: string) {
  if (!firebaseReady) {
    return null;
  }
  const user = await admin.auth().getUser(uid);
  return user.email;
}

export async function deleteUser(uid: string) {
  if (!firebaseReady) {
    return null;
  }
  return admin.auth().deleteUser(uid);
}
