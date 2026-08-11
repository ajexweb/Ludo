// ==========================================
// LUDO PLUS - MAIN APPLICATION SCRIPT
// ==========================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { ref, onValue, get, set, push, serverTimestamp, onDisconnect, remove } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

// --- Global Variables ---
let currentUser = null;
let userData = null;
let currentMatchMode = 'GLOBAL'; // Can be 'GLOBAL' or 'ROOM'
let searchTimeout = null;

// --- DOM Elements ---
const splashScreen = document.getElementById('splash-screen');
const appContainer = document.getElementById('app-container');
const btnLogout = document.getElementById('btn-logout');

// --- Initialization & Auth Check ---
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is logged in
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            loadUserProfile(user.uid);
        } else {
            // Not logged in, redirect to auth page
            window.location.replace('auth.html');
        }
    });
});

// --- Load User Profile Realtime ---
function loadUserProfile(uid) {
    const userRef = ref(db, `users/${uid}`);
    
    // Listen for real-time updates (Coins, Stats, etc.)
    onValue(userRef, (snapshot) => {
        if (snapshot.exists()) {
            userData = snapshot.val();
            
            // Update UI
            document.getElementById('user-name').innerText = userData.username || 'Player';
            document.getElementById('user-player-id').innerText = userData.playerId || 'LP-----';
            document.getElementById('user-balance').innerText = userData.coins || 0;
            document.getElementById('stat-matches').innerText = userData.matches || 0;
            document.getElementById('stat-wins').innerText = userData.wins || 0;
            document.getElementById('stat-losses').innerText = userData.losses || 0;

            // Remove Splash Screen smoothly
            splashScreen.classList.remove('active');
            setTimeout(() => {
                splashScreen.classList.add('hidden');
                appContainer.classList.remove('hidden');
            }, 500);
        } else {
            showToast("Error: User data not found!");
            signOut(auth);
        }
    });
}

// --- Global UI Helpers ---
window.showModal = function(id) {
    document.getElementById(id).classList.remove('hidden');
};

window.closeModal = function(id) {
    document.getElementById(id).classList.add('hidden');
};

window.showToast = function(message) {
    const toast = document.getElementById('notification-toast');
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
};

// --- Balance Checker ---
function hasEnoughCoins(required = 50) {
    if (userData && userData.coins >= required) {
        return true;
    }
    showToast("Insufficient Balance! Minimum 50 Coins required.");
    setTimeout(() => {
        window.location.href = 'wallet.html';
    }, 1500);
    return false;
}

// --- Action Buttons Setup ---

// 1. Play Online (Global Match)
document.getElementById('btn-play-online').addEventListener('click', () => {
    currentMatchMode = 'GLOBAL';
    showModal('modal-choose-match');
});

// 2. Create Room (Private Match)
document.getElementById('btn-create-room').addEventListener('click', () => {
    currentMatchMode = 'ROOM';
    showModal('modal-choose-match');
});

// 3. Join Room (Enter ID)
document.getElementById('btn-join-room').addEventListener('click', () => {
    showModal('modal-join-room');
});

// 4. Settings/Profile
document.getElementById('nav-profile').addEventListener('click', (e) => {
    e.preventDefault();
    showModal('modal-settings');
});

// --- Match Size Selection (2 or 4 Players) ---
document.querySelectorAll('.match-size-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const players = e.currentTarget.getAttribute('data-players');
        closeModal('modal-choose-match');

        // Check if user has 50 coins before proceeding
        if (!hasEnoughCoins(50)) return;

        if (currentMatchMode === 'GLOBAL') {
            startGlobalMatchmaking(players);
        } else if (currentMatchMode === 'ROOM') {
            createPrivateRoom(players);
        }
    });
});

// --- Global Matchmaking Logic ---
function startGlobalMatchmaking(players) {
    showModal('modal-searching');
    let seconds = 0;
    const timerElement = document.getElementById('search-timer');
    
    // Timer UI
    searchTimeout = setInterval(() => {
        seconds++;
        timerElement.innerText = `00:${seconds < 10 ? '0' + seconds : seconds}`;
    }, 1000);

    // Path for matchmaking queue
    const queueRef = ref(db, `matchmaking/${players}_players/${currentUser.uid}`);
    
    const requestData = {
        uid: currentUser.uid,
        playerId: userData.playerId,
        username: userData.username,
        timestamp: serverTimestamp()
    };

    set(queueRef, requestData).then(() => {
        // Remove from queue if user disconnects while searching
        onDisconnect(queueRef).remove();

        // Listen for match found (Backend/Admin Engine will create match and set matchId here)
        onValue(queueRef, (snapshot) => {
            const data = snapshot.val();
            if (data && data.matchId) {
                // Match Found!
                clearInterval(searchTimeout);
                document.getElementById('search-status-text').innerText = "Match Found! Connecting...";
                document.getElementById('search-status-text').classList.add('text-green');
                
                // Redirect to Game Engine
                setTimeout(() => {
                    window.location.href = `game.html?matchId=${data.matchId}`;
                }, 1000);
            }
        });
    });
}

// Cancel Search
document.getElementById('btn-cancel-search').addEventListener('click', () => {
    clearInterval(searchTimeout);
    document.getElementById('search-timer').innerText = "00:00";
    closeModal('modal-searching');
    
    // Remove user from matchmaking queue
    if (currentUser) {
        remove(ref(db, `matchmaking/2_players/${currentUser.uid}`));
        remove(ref(db, `matchmaking/4_players/${currentUser.uid}`));
    }
});

// --- Create Private Room Logic ---
function createPrivateRoom(players) {
    // Generate unique Room ID (e.g., LP7K42)
    const randomChars = Math.random().toString(36).substring(2, 6).toUpperCase();
    const roomId = `LP${randomChars}`;

    const roomRef = ref(db, `rooms/${roomId}`);
    
    const roomData = {
        host: currentUser.uid,
        maxPlayers: parseInt(players),
        status: 'WAITING',
        createdAt: serverTimestamp(),
        players: {
            [currentUser.uid]: {
                playerId: userData.playerId,
                username: userData.username,
                isReady: true,
                color: 'RED' // Host gets Red by default
            }
        }
    };

    set(roomRef, roomData).then(() => {
        showToast("Room Created Successfully!");
        // Redirect to Room Lobby (handled in game.html)
        setTimeout(() => {
            window.location.href = `game.html?roomId=${roomId}`;
        }, 500);
    });
}

// --- Join Private Room Logic ---
document.getElementById('btn-submit-join').addEventListener('click', () => {
    const roomId = document.getElementById('join-room-id').value.trim().toUpperCase();
    const errorMsg = document.getElementById('join-error-msg');
    
    if (roomId.length < 6) {
        errorMsg.innerText = "Invalid Room ID";
        errorMsg.classList.remove('hidden');
        return;
    }

    if (!hasEnoughCoins(50)) return;

    // Check if room exists and is joinable
    get(ref(db, `rooms/${roomId}`)).then((snapshot) => {
        if (snapshot.exists()) {
            const room = snapshot.val();
            
            if (room.status !== 'WAITING') {
                errorMsg.innerText = "Match already started or finished.";
                errorMsg.classList.remove('hidden');
                return;
            }

            const currentPlayersCount = Object.keys(room.players || {}).length;
            if (currentPlayersCount >= room.maxPlayers) {
                errorMsg.innerText = "Room is full!";
                errorMsg.classList.remove('hidden');
                return;
            }

            // Valid room, redirect to game lobby to handle joining
            window.location.href = `game.html?roomId=${roomId}`;
            
        } else {
            errorMsg.innerText = "Room not found. Check the ID.";
            errorMsg.classList.remove('hidden');
        }
    });
});

// --- Logout Logic ---
btnLogout.addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.replace('auth.html');
    }).catch((error) => {
        showToast("Error logging out.");
    });
});