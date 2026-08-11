// ==========================================
// LUDO PLUS - FIREBASE CONFIGURATION
// ==========================================

// Import modular Firebase SDKs directly from CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

// Your exact Firebase Project Configuration
const strugxFirebaseConfig = {
    apiKey: "AIzaSyDv5XpW3oD5gzpXwiDosBSSU99VynA8ecs",
    authDomain: "hello-zeb.firebaseapp.com",
    databaseURL: "https://hello-zeb-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "hello-zeb",
    storageBucket: "hello-zeb.firebasestorage.app",
    messagingSenderId: "175982808701",
    appId: "1:175982808701:web:dc4c4400028066a21deb14"
};

// Initialize Firebase App
const app = initializeApp(strugxFirebaseConfig);

// Initialize Auth & Database
const auth = getAuth(app);
const db = getDatabase(app);

// Export instances to be used across other JS files
export { app, auth, db };

console.log("Firebase initialized successfully for Ludo Plus!");