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
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app, import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID);
    googleProvider = new GoogleAuthProvider();

    console.log("Firebase initialized successfully with project:", firebaseConfig.projectId);

    // Sign in anonymously to allow likes without forced login
    signInAnonymously(auth).then(() => {
      console.log("Signed in anonymously as:", auth.currentUser?.uid);
    }).catch((error) => {
      console.error("Error signing in anonymously. Make sure 'Anonymous' is enabled in Firebase Console > Authentication > Sign-in method.", error);
    });
  } catch (error) {
    console.error("Error initializing Firebase:", error);
    auth = { onAuthStateChanged: () => () => {} };
    db = {};
    googleProvider = {};
  }
} else {
  console.warn("Firebase environment variables are missing. Some features may not work.");
  // Provide mock/null objects to prevent crashes in components
  auth = { onAuthStateChanged: () => () => {} };
  db = {};
  googleProvider = {};
}

export { auth, db, googleProvider };
