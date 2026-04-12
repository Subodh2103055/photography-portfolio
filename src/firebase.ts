import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Only initialize if we have the minimum required config
const isFirebaseConfigured = !!firebaseConfig.apiKey;

let app;
let auth: any;
let db: any;
let googleProvider: any;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app, import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID);
  googleProvider = new GoogleAuthProvider();

  // Sign in anonymously to allow likes without forced login
  signInAnonymously(auth).catch((error) => {
    console.error("Error signing in anonymously:", error);
  });
} else {
  console.warn("Firebase environment variables are missing. Some features may not work.");
  // Provide mock/null objects to prevent crashes in components
  auth = { onAuthStateChanged: () => () => {} };
  db = {};
  googleProvider = {};
}

export { auth, db, googleProvider };
