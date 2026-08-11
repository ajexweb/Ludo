// ==========================================
// LUDO PLUS - AUTHENTICATION SCRIPT (UPDATED)
// ==========================================

import { auth, db } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    onAuthStateChanged 
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { 
    ref, 
    set, 
    push, 
    serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

// --- Global Variables ---
let isRegistering = false; // YEH NAYA FLAG HAI

// --- DOM Elements ---
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const formLogin = document.getElementById('login-form');
const formRegister = document.getElementById('register-form');
const authLoader = document.getElementById('auth-loader');
const loaderText = document.getElementById('loader-text');
const errorMsg = document.getElementById('auth-error-msg');

// --- Check if already logged in ---
onAuthStateChanged(auth, (user) => {
    // Agar user log in hai aur naya account register NAHI kar raha hai, tabhi redirect karo
    if (user && !isRegistering) {
        window.location.replace('index.html');
    }
});

// --- Tab Switching Logic ---
tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
    hideError();
});

tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    formRegister.classList.remove('hidden');
    formLogin.classList.add('hidden');
    hideError();
});

// --- UI Helpers ---
function showLoader(text) {
    loaderText.innerText = text;
    authLoader.classList.remove('hidden');
}

function hideLoader() {
    authLoader.classList.add('hidden');
}

function showError(message) {
    errorMsg.innerText = message;
    errorMsg.classList.remove('hidden');
    hideLoader();
}

function hideError() {
    errorMsg.classList.add('hidden');
}

window.showToast = function(message) {
    const toast = document.getElementById('notification-toast');
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
};

// --- Helper: Generate Unique Player ID ---
function generatePlayerID() {
    const randomNum = Math.floor(100000 + Math.random() * 900000); 
    return `LP${randomNum}`;
}

// --- LOGIN LOGIC ---
formLogin.addEventListener('submit', (e) => {
    e.preventDefault();
    hideError();
    
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    showLoader("Logging in...");

    signInWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            showToast("Login Successful!");
            // onAuthStateChanged will handle redirection automatically
        })
        .catch((error) => {
            showError(getAuthErrorMessage(error.code));
        });
});

// --- REGISTER LOGIC ---
formRegister.addEventListener('submit', (e) => {
    e.preventDefault();
    hideError();

    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password').value;

    if (password !== confirmPassword) {
        showError("Passwords do not match!");
        return;
    }
    if (password.length < 6) {
        showError("Password must be at least 6 characters.");
        return;
    }

    showLoader("Creating Account...");
    isRegistering = true; // Lock the redirect

    createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            const user = userCredential.user;
            const newPlayerId = generatePlayerID();

            const userData = {
                playerId: newPlayerId,
                username: username,
                email: email,
                coins: 100, 
                matches: 0,
                wins: 0,
                losses: 0,
                createdAt: serverTimestamp(),
                status: 'ACTIVE'
            };

            const userRef = ref(db, `users/${user.uid}`);
            const transRef = push(ref(db, 'walletTransactions'));
            const transactionData = {
                uid: user.uid,
                type: 'WELCOME_BONUS',
                amount: 100,
                reference: 'NEW_ACCOUNT',
                timestamp: serverTimestamp(),
                status: 'COMPLETED'
            };

            // Dono database writes jab tak successful na hon, wait karo
            Promise.all([
                set(userRef, userData),
                set(transRef, transactionData)
            ]).then(() => {
                showToast("Account Created! +100 Coins Received.");
                // Write successful, ab manually redirect karo
                setTimeout(() => {
                    window.location.replace('index.html');
                }, 1000);
            }).catch((dbError) => {
                isRegistering = false;
                showError("Account created, but database access denied. Check Firebase Rules.");
            });

        })
        .catch((error) => {
            isRegistering = false;
            showError(getAuthErrorMessage(error.code));
        });
});

// --- Auth Error Message Formatter ---
function getAuthErrorMessage(errorCode) {
    switch (errorCode) {
        case 'auth/email-already-in-use':
            return 'This email is already registered. Please login.';
        case 'auth/invalid-email':
            return 'Invalid email address format.';
        case 'auth/user-not-found':
            return 'No account found with this email.';
        case 'auth/wrong-password':
            return 'Incorrect password. Try again.';
        case 'auth/network-request-failed':
            return 'Network error. Please check your connection.';
        default:
            return 'Authentication failed. Please try again.';
    }
}