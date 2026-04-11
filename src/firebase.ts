import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

// Sign in anonymously to allow likes without forced login
signInAnonymously(auth).catch((error) => {
  console.error("Error signing in anonymously:", error);
});
