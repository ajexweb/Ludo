// ==========================================
// LUDO PLUS - WALLET & PAYMENT SCRIPT
// ==========================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { 
    ref, 
    onValue, 
    push, 
    set, 
    serverTimestamp, 
    query, 
    orderByChild, 
    equalTo 
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

// --- Global Variables ---
let currentUser = null;
let userData = null;
let selectedAmount = 0;

// --- DOM Elements ---
const appContainer = document.getElementById('app-container');
const walletLoader = document.getElementById('wallet-loader');

const step1Amount = document.getElementById('step-1-amount');
const step2Qr = document.getElementById('step-2-qr');
const step3Utr = document.getElementById('step-3-utr');

const amountBtns = document.querySelectorAll('.amount-btn');
const customAmountInput = document.getElementById('custom-amount-input');
const qrAmountDisplay = document.getElementById('qr-amount-display');
const utrInput = document.getElementById('utr-input');
const txHistoryList = document.getElementById('tx-history-list');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    walletLoader.classList.remove('hidden');
    
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            loadWalletData(user.uid);
            loadTransactionHistory(user.uid);
        } else {
            window.location.replace('auth.html');
        }
    });
});

// --- UI Helpers ---
window.showToast = function(message) {
    const toast = document.getElementById('notification-toast');
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
};

// --- Load Real-time Balance ---
function loadWalletData(uid) {
    const userRef = ref(db, `users/${uid}`);
    onValue(userRef, (snapshot) => {
        if (snapshot.exists()) {
            userData = snapshot.val();
            document.getElementById('display-balance').innerText = userData.coins || 0;
            
            // Hide loader once data is fetched
            walletLoader.classList.add('hidden');
            appContainer.classList.remove('hidden');
        }
    });
}

// --- Amount Selection Logic (Step 1) ---
amountBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        // Clear active states
        amountBtns.forEach(b => b.classList.remove('selected'));
        customAmountInput.value = ''; // Clear custom input
        
        // Set active
        e.target.classList.add('selected');
        selectedAmount = parseInt(e.target.getAttribute('data-amt'));
    });
});

customAmountInput.addEventListener('input', (e) => {
    // If user types in custom, clear button selections
    amountBtns.forEach(b => b.classList.remove('selected'));
    selectedAmount = parseInt(e.target.value) || 0;
});

// --- Proceed to QR (Step 1 -> Step 2) ---
document.getElementById('btn-continue-pay').addEventListener('click', () => {
    if (selectedAmount < 50) {
        window.showToast("Minimum deposit amount is ₹50");
        return;
    }
    
    // Switch Screens
    step1Amount.classList.add('hidden');
    qrAmountDisplay.innerText = selectedAmount;
    step2Qr.classList.remove('hidden');
});

// --- Cancel QR (Step 2 -> Step 1) ---
document.getElementById('btn-cancel-qr').addEventListener('click', () => {
    step2Qr.classList.add('hidden');
    step1Amount.classList.remove('hidden');
});

// --- Proceed to UTR (Step 2 -> Step 3) ---
document.getElementById('btn-i-have-paid').addEventListener('click', () => {
    step2Qr.classList.add('hidden');
    step3Utr.classList.remove('hidden');
});

// --- Submit UTR (Final Step) ---
document.getElementById('btn-submit-utr').addEventListener('click', () => {
    const utrValue = utrInput.value.trim();
    
    if (utrValue.length < 8) {
        window.showToast("Please enter a valid UTR / Transaction ID");
        return;
    }

    walletLoader.querySelector('#loader-text').innerText = "Submitting Request...";
    walletLoader.classList.remove('hidden');

    // Create Payment Request in Firebase
    const paymentsRef = ref(db, 'payments');
    const newPaymentRef = push(paymentsRef);
    
    const paymentData = {
        uid: currentUser.uid,
        playerId: userData.playerId,
        amount: selectedAmount,
        utr: utrValue,
        status: 'PENDING',
        createdAt: serverTimestamp()
    };

    set(newPaymentRef, paymentData).then(() => {
        walletLoader.classList.add('hidden');
        window.showToast("Payment request submitted! Admin will verify soon.");
        
        // Reset UI back to Step 1
        utrInput.value = '';
        amountBtns.forEach(b => b.classList.remove('selected'));
        customAmountInput.value = '';
        selectedAmount = 0;
        
        step3Utr.classList.add('hidden');
        step1Amount.classList.remove('hidden');
    }).catch(error => {
        walletLoader.classList.add('hidden');
        window.showToast("Error submitting request. Please try again.");
    });
});

// --- Load Transaction History (Ledger) ---
function loadTransactionHistory(uid) {
    // Query walletTransactions where uid matches current user
    const txQuery = query(ref(db, 'walletTransactions'), orderByChild('uid'), equalTo(uid));
    
    onValue(txQuery, (snapshot) => {
        txHistoryList.innerHTML = ''; // Clear list
        
        if (!snapshot.exists()) {
            txHistoryList.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:12px;">No transactions yet.</p>';
            return;
        }

        // Convert object to array and sort by time (newest first)
        const transactions = [];
        snapshot.forEach((childSnap) => {
            transactions.push(childSnap.val());
        });
        
        transactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // Render each transaction
        transactions.forEach(tx => {
            const txItem = document.createElement('div');
            txItem.className = 'tx-item';
            
            // Format Type Text
            const title = tx.type.replace('_', ' ');
            
            // Format Amount styling
            let amountStr = tx.amount;
            let amountClass = '';
            if (tx.amount > 0) {
                amountStr = `+${tx.amount}`;
                amountClass = 'positive';
            } else if (tx.amount < 0) {
                amountClass = 'negative';
            }

            // Date Formatting
            const dateStr = tx.timestamp ? new Date(tx.timestamp).toLocaleString() : 'Just now';

            // Status Badge for pending credits if any (Optional for ledger, mostly for manual UI)
            const badge = tx.status === 'PENDING' ? `<span class="status-badge badge-pending">PENDING</span>` : '';

            txItem.innerHTML = `
                <div class="tx-left">
                    <h4>${title} ${badge}</h4>
                    <small>${dateStr}</small>
                </div>
                <div class="tx-right ${amountClass}">${amountStr}</div>
            `;
            
            txHistoryList.appendChild(txItem);
        });
    });
}