// ==========================================
// LUDO PLUS - MASTER GAME ENGINE (PREMIUM UI & FAST SYNC)
// ==========================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { ref, onValue, get, set, update, runTransaction, serverTimestamp, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

// --- Global Variables ---
let currentUser = null;
let userData = null;
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('roomId');
const matchId = urlParams.get('matchId');

let isHost = false;
let myColor = null;
let gameState = null;

// --- Ludo Board Math (15x15 Grid mapped to X,Y) ---
const MAIN_PATH = [
    [6,13], [6,12], [6,11], [6,10], [6,9], [5,8], [4,8], [3,8], [2,8], [1,8], [0,8], [0,7], [0,6], // Red to Green
    [1,6], [2,6], [3,6], [4,6], [5,6], [6,5], [6,4], [6,3], [6,2], [6,1], [6,0], [7,0], [8,0],    // Green to Gray
    [8,1], [8,2], [8,3], [8,4], [8,5], [9,6], [10,6], [11,6], [12,6], [13,6], [14,6], [14,7], [14,8], // Gray to Blue
    [13,8], [12,8], [11,8], [10,8], [9,8], [8,9], [8,10], [8,11], [8,12], [8,13], [8,14], [7,14], [6,14] // Blue to Red
];

const HOME_PATHS = {
    RED: [[7,13], [7,12], [7,11], [7,10], [7,9], [7,8]],
    BLUE: [[13,7], [12,7], [11,7], [10,7], [9,7], [8,7]],
    GRAY: [[7,1], [7,2], [7,3], [7,4], [7,5], [7,6]],
    GREEN: [[1,7], [2,7], [3,7], [4,7], [5,7], [6,7]]
};

const START_INDEX = { RED: 0, GREEN: 13, GRAY: 26, BLUE: 39 };
const SAFE_ZONES = [0, 8, 13, 21, 26, 34, 39, 47];

// Exact math to place tokens visually inside the 4 circles of home base
const HOME_BASES = {
    RED: [[2,10.5], [3.5,10.5], [2,12], [3.5,12]],
    BLUE: [[10.5,10.5], [12,10.5], [10.5,12], [12,12]],
    GREEN: [[2,2], [3.5,2], [2,3.5], [3.5,3.5]],
    GRAY: [[10.5,2], [12,2], [10.5,3.5], [12,3.5]]
};

const TURN_SEQUENCE_4P = ['RED', 'GREEN', 'GRAY', 'BLUE'];
const TURN_SEQUENCE_2P = ['RED', 'BLUE'];

// --- DOM Elements ---
const appContainer = document.getElementById('app-container'); 
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const gameLoader = document.getElementById('game-loader');

// --- Inject Dynamic Game UI Styles (Smooth Animations & Board Graphics) ---
const boardStyles = document.createElement('style');
boardStyles.innerHTML = `
    .ludo-cell { border: 1px solid rgba(0,0,0,0.1); box-sizing: border-box; display: flex; align-items: center; justify-content: center; }
    .bg-safe { background-image: radial-gradient(circle, rgba(0,0,0,0.1) 20%, transparent 60%); }
    .goti { 
        position: absolute; width: 5.5%; height: 5.5%; border-radius: 50%; 
        border: 2px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.4); 
        transition: top 0.35s ease-in-out, left 0.35s ease-in-out; /* SMOOTH MOVEMENT */
        z-index: 20; cursor: pointer; transform: translate(-50%, -50%);
    }
    .base-container { position: absolute; width: 40%; height: 40%; padding: 6%; box-sizing: border-box; border: 1px solid rgba(0,0,0,0.2); }
    .base-inner { width: 100%; height: 100%; background: white; border-radius: 15px; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 15%; padding: 15%; box-sizing: border-box; box-shadow: inset 0 0 10px rgba(0,0,0,0.2); }
    .base-circle { width: 100%; height: 100%; border-radius: 50%; border: 2px solid rgba(0,0,0,0.1); }
    
    /* Center Home Polygon */
    .center-home {
        position: absolute; top: 40%; left: 40%; width: 20%; height: 20%;
        border-style: solid; border-width: calc(100% / 1.5); box-sizing: border-box;
        border-color: var(--ludo-gray) var(--ludo-blue) var(--ludo-red) var(--ludo-green);
    }
`;
document.head.appendChild(boardStyles);


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            fetchUserData();
        } else {
            window.location.replace('auth.html');
        }
    });
});

function fetchUserData() {
    get(ref(db, `users/${currentUser.uid}`)).then((snap) => {
        if(snap.exists()) {
            userData = snap.val();
            if (roomId) initLobby();
            else if (matchId) initMatchSync(matchId);
            else window.location.replace('index.html');
        }
    });
}

// ==========================================
// 1. LOBBY SYSTEM
// ==========================================
function initLobby() {
    gameLoader.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    appContainer.classList.remove('hidden');
    document.getElementById('lobby-room-id').innerText = roomId;

    const roomRef = ref(db, `rooms/${roomId}`);
    
    runTransaction(roomRef, (room) => {
        if (room) {
            if (!room.players[currentUser.uid]) {
                const pCount = Object.keys(room.players).length;
                if (pCount < room.maxPlayers) {
                    const colors = room.maxPlayers === 2 ? ['RED', 'BLUE'] : ['RED', 'BLUE', 'GREEN', 'GRAY'];
                    const usedColors = Object.values(room.players).map(p => p.color);
                    const availableColor = colors.find(c => !usedColors.includes(c));
                    
                    room.players[currentUser.uid] = {
                        playerId: userData.playerId,
                        username: userData.username,
                        color: availableColor,
                        isReady: true
                    };
                }
            }
        }
        return room;
    }).then((res) => {
        if(res.committed) {
            onValue(roomRef, (snap) => {
                const roomData = snap.val();
                if (!roomData) return;
                
                isHost = (roomData.host === currentUser.uid);
                myColor = roomData.players[currentUser.uid].color;
                updateLobbyUI(roomData);

                if (roomData.status === 'STARTED' && roomData.matchId) {
                    window.location.replace(`game.html?matchId=${roomData.matchId}`);
                }
            });
        }
    });

    document.getElementById('btn-copy-id').addEventListener('click', () => {
        navigator.clipboard.writeText(roomId);
        window.showToast("Room ID Copied!");
    });

    document.getElementById('btn-start-match').addEventListener('click', () => {
        startMatchExecution();
    });
}

function updateLobbyUI(roomData) {
    const list = document.getElementById('lobby-players-list');
    list.innerHTML = '';
    
    const players = Object.values(roomData.players);
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = `lobby-player-slot ${p.color.toLowerCase()}`;
        div.innerHTML = `
            <div class="slot-info">
                <div class="color-indicator bg-${p.color.toLowerCase()}"></div>
                <h4>${p.username} ${p.playerId === userData.playerId ? '(You)' : ''}</h4>
            </div>
            <span class="slot-status text-green">READY</span>
        `;
        list.appendChild(div);
    });

    if (isHost) {
        if (players.length === roomData.maxPlayers) {
            document.getElementById('btn-start-match').classList.remove('hidden');
            document.getElementById('lobby-wait-msg').classList.add('hidden');
        } else {
            document.getElementById('btn-start-match').classList.add('hidden');
        }
    }
}

// ==========================================
// 2. MATCH START & COIN DEDUCTION
// ==========================================
function startMatchExecution() {
    gameLoader.querySelector('#game-loader-text').innerText = "Processing Entry Fee...";
    gameLoader.classList.remove('hidden');
    
    if(userData.coins < 50) {
        alert("Insufficient Coins! Add balance to play.");
        gameLoader.classList.add('hidden');
        return;
    }

    const newMatchId = `M${Date.now()}`;
    const roomRef = ref(db, `rooms/${roomId}`);
    
    get(roomRef).then((snap) => {
        const roomData = snap.val();
        const tokens = {};
        
        Object.values(roomData.players).forEach(p => {
            tokens[p.color] = [-1, -1, -1, -1]; 
        });

        const matchData = {
            id: newMatchId,
            type: roomData.maxPlayers + 'P',
            status: 'PLAYING',
            players: roomData.players,
            tokens: tokens,
            currentTurn: 'RED',
            diceValue: 0,
            winner: null,
            createdAt: serverTimestamp()
        };

        set(ref(db, `matches/${newMatchId}`), matchData).then(() => {
            update(roomRef, { status: 'STARTED', matchId: newMatchId });
        });
    });
}

// ==========================================
// 3. GAME ENGINE & SYNC (FAST REALTIME)
// ==========================================
function initMatchSync(mId) {
    appContainer.classList.remove('hidden');
    drawVisualBoard(); // Draw the beautiful board once

    const matchRef = ref(db, `matches/${mId}`);
    
    onValue(matchRef, (snap) => {
        const data = snap.val();
        if(!data) return;
        
        gameState = data;
        myColor = data.players[currentUser.uid]?.color || null;

        deductEntryFeeOnce(mId);

        gameLoader.classList.add('hidden');
        lobbyScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        document.getElementById('game-match-id').innerText = `#${mId.substring(0,8)}`;

        updatePlayersUI();
        updateTokensOptimized(); // Uses CSS transitions for smooth sliding
        handleTurnUI();
        
        if(data.winner && data.winner === myColor) {
            document.getElementById('modal-match-result').classList.remove('hidden');
        }
    });
}

function deductEntryFeeOnce(mId) {
    const feeRef = ref(db, `matches/${mId}/feePaid/${currentUser.uid}`);
    get(feeRef).then(snap => {
        if(!snap.exists()) {
            const userCoinRef = ref(db, `users/${currentUser.uid}/coins`);
            runTransaction(userCoinRef, (currentCoins) => {
                return (currentCoins || 0) >= 50 ? currentCoins - 50 : currentCoins;
            }).then(() => {
                set(feeRef, true);
                push(ref(db, 'walletTransactions'), {
                    uid: currentUser.uid,
                    type: 'MATCH_ENTRY',
                    amount: -50,
                    reference: mId,
                    timestamp: serverTimestamp()
                });
            });
        }
    });
}

// ==========================================
// 4. BEAUTIFUL BOARD RENDERER (IMAGE-LIKE)
// ==========================================
function drawVisualBoard() {
    const board = document.getElementById('ludo-board');
    board.innerHTML = '';
    board.style.backgroundColor = 'white';
    board.style.position = 'relative';
    
    // Draw 15x15 Grid Cells
    for(let r = 0; r < 15; r++) {
        for(let c = 0; c < 15; c++) {
            const cell = document.createElement('div');
            cell.className = 'ludo-cell';
            
            // Home Paths (Colored)
            if (c == 7 && r >= 9 && r <= 13) cell.style.backgroundColor = 'var(--ludo-red)';
            if (r == 7 && c >= 9 && c <= 13) cell.style.backgroundColor = 'var(--ludo-blue)';
            if (r == 7 && c >= 1 && c <= 5) cell.style.backgroundColor = 'var(--ludo-green)';
            if (c == 7 && r >= 1 && r <= 5) cell.style.backgroundColor = 'var(--ludo-gray)';

            // Start Zones (Colored)
            if (c == 6 && r == 13) cell.style.backgroundColor = 'var(--ludo-red)';
            if (c == 13 && r == 8) cell.style.backgroundColor = 'var(--ludo-blue)';
            if (c == 1 && r == 6) cell.style.backgroundColor = 'var(--ludo-green)';
            if (c == 8 && r == 1) cell.style.backgroundColor = 'var(--ludo-gray)';

            // Safe Zones indicator (Star/Shadow)
            const isSafe = SAFE_ZONES.some(index => MAIN_PATH[index][0] === c && MAIN_PATH[index][1] === r);
            if(isSafe) cell.classList.add('bg-safe');

            board.appendChild(cell);
        }
    }

    // Overlay Corner Bases (Green, Gray, Red, Blue)
    const basePositions = [
        { color: 'GREEN', class: 'bg-green', top: '0%', left: '0%' },
        { color: 'GRAY', class: 'bg-gray', top: '0%', left: '60%' },
        { color: 'RED', class: 'bg-red', top: '60%', left: '0%' },
        { color: 'BLUE', class: 'bg-blue', top: '60%', left: '60%' }
    ];

    basePositions.forEach(base => {
        const baseDiv = document.createElement('div');
        baseDiv.className = `base-container ${base.class}`;
        baseDiv.style.top = base.top;
        baseDiv.style.left = base.left;
        
        // Inner white box and 4 circles
        baseDiv.innerHTML = `
            <div class="base-inner">
                <div class="base-circle ${base.class}"></div>
                <div class="base-circle ${base.class}"></div>
                <div class="base-circle ${base.class}"></div>
                <div class="base-circle ${base.class}"></div>
            </div>
        `;
        board.appendChild(baseDiv);
    });

    // Overlay Center Triangle Finish
    const centerHome = document.createElement('div');
    centerHome.className = 'center-home';
    board.appendChild(centerHome);
}

function updatePlayersUI() {
    const colors = ['RED', 'BLUE', 'GREEN', 'GRAY'];
    colors.forEach(c => {
        const pDetails = Object.values(gameState.players).find(p => p.color === c);
        const nameEl = document.getElementById(`name-${c.toLowerCase()}`);
        if(nameEl) nameEl.innerText = pDetails ? pDetails.username : '---';
    });
}

// --- OPTIMIZED SMOOTH TOKEN RENDERING ---
function updateTokensOptimized() {
    const board = document.getElementById('ludo-board');

    Object.keys(gameState.tokens).forEach(color => {
        const positions = gameState.tokens[color];
        
        positions.forEach((pos, idx) => {
            let x, y;
            if (pos === -1) {
                // In Base
                x = HOME_BASES[color][idx][0];
                y = HOME_BASES[color][idx][1];
            } else if (pos < 52) {
                // On Board Path
                let actualIndex = (START_INDEX[color] + pos) % 52;
                x = MAIN_PATH[actualIndex][0];
                y = MAIN_PATH[actualIndex][1];
            } else if (pos < 58) {
                // Inside Home Finish Line
                let homeIdx = pos - 52;
                x = HOME_PATHS[color][homeIdx][0];
                y = HOME_PATHS[color][homeIdx][1];
            } else {
                return; // Finished
            }

            // Calculate precise percentage coordinates
            const leftPercent = (x * (100 / 15)) + (100 / 30); // Center of cell
            const topPercent = (y * (100 / 15)) + (100 / 30);  // Center of cell

            // Check if token exists, update its position smoothly
            let tokenEl = document.getElementById(`token-${color}-${idx}`);
            if (!tokenEl) {
                tokenEl = document.createElement('div');
                tokenEl.id = `token-${color}-${idx}`;
                tokenEl.className = `goti bg-${color.toLowerCase()}`;
                board.appendChild(tokenEl);
            }

            // Triggers CSS transition for smooth glide
            tokenEl.style.left = `${leftPercent}%`;
            tokenEl.style.top = `${topPercent}%`;

            // Reset interactions
            tokenEl.onclick = null;
            tokenEl.style.boxShadow = '0 4px 6px rgba(0,0,0,0.4)';
            tokenEl.style.zIndex = (pos === -1) ? 10 : 20;
            
            // Highlight and enable click if it's my turn
            if (gameState.currentTurn === myColor && color === myColor && gameState.diceValue > 0) {
                tokenEl.style.boxShadow = '0 0 15px #FFF, 0 0 5px #FFF';
                tokenEl.style.zIndex = 30;
                tokenEl.onclick = () => handleTokenMove(color, idx, pos);
            }
        });
    });
}

// ==========================================
// 5. TURN & DICE LOGIC 
// ==========================================
function handleTurnUI() {
    document.querySelectorAll('.player-profile').forEach(el => el.classList.remove('active-turn'));
    
    const activeProfile = document.getElementById(`profile-${gameState.currentTurn.toLowerCase()}`);
    if(activeProfile) activeProfile.classList.add('active-turn');

    renderDice(gameState.currentTurn, gameState.diceValue);

    if (gameState.currentTurn === myColor && gameState.diceValue === 0) {
        const diceBox = document.getElementById(`dice-${myColor.toLowerCase()}`);
        diceBox.style.cursor = 'pointer';
        diceBox.onclick = rollDice;
    }
}

function renderDice(color, value) {
    const diceBox = document.getElementById(`dice-${color.toLowerCase()}`);
    if(!diceBox) return;
    
    const diceSVG = value > 0 ? `<svg viewBox="0 0 24 24"><text x="12" y="16" font-size="14" fill="white" text-anchor="middle" font-weight="bold">${value}</text></svg>` : `<span style="font-size:10px; color:white;">ROLL</span>`;
    
    diceBox.innerHTML = diceSVG;
    diceBox.onclick = null; 
}

function rollDice() {
    if(gameState.currentTurn !== myColor || gameState.diceValue !== 0) return;
    
    const diceBox = document.getElementById(`dice-${myColor.toLowerCase()}`);
    diceBox.innerHTML = `<span style="font-size:10px; color:white;">...</span>`; 

    const commandRef = ref(db, `matches/${matchId}/adminCommand/${myColor}`);
    get(commandRef).then((snap) => {
        let finalDice = 0;
        
        if (snap.exists() && snap.val() !== null) {
            finalDice = snap.val();
            update(ref(db, `matches/${matchId}`), { 
                [`adminCommand/${myColor}`]: null 
            });
        } else {
            finalDice = Math.floor(Math.random() * 6) + 1;
        }

        update(ref(db, `matches/${matchId}`), {
            diceValue: finalDice,
            lastAction: serverTimestamp()
        }).then(() => {
            setTimeout(() => checkMovePossibility(finalDice), 400); // Fast feedback
        });
    });
}

function checkMovePossibility(dice) {
    const myTokens = gameState.tokens[myColor];
    let canMove = false;

    myTokens.forEach(pos => {
        if (pos === -1 && dice === 6) canMove = true; 
        if (pos !== -1 && pos + dice <= 57) canMove = true; 
    });

    if (!canMove) {
        window.showToast("No valid moves! Turn passed.");
        setTimeout(passTurn, 800);
    }
}

// ==========================================
// 6. MOVEMENT & CAPTURE LOGIC
// ==========================================
function handleTokenMove(color, tIndex, currentPos) {
    const dice = gameState.diceValue;
    if (dice === 0) return;

    let newPos = currentPos;

    if (currentPos === -1) {
        if (dice === 6) newPos = 0; 
        else return; 
    } else {
        newPos = currentPos + dice;
        if (newPos > 57) return; 
    }

    let tokensUpdates = { ...gameState.tokens };
    let captured = false;
    
    if (newPos < 52 && currentPos !== -1) {
        let globalNewPos = (START_INDEX[color] + newPos) % 52;
        
        if (!SAFE_ZONES.includes(globalNewPos)) {
            Object.keys(tokensUpdates).forEach(otherCol => {
                if (otherCol !== color) {
                    tokensUpdates[otherCol] = tokensUpdates[otherCol].map(otherPos => {
                        if (otherPos > -1 && otherPos < 52) {
                            let otherGlobalPos = (START_INDEX[otherCol] + otherPos) % 52;
                            if (otherGlobalPos === globalNewPos) {
                                captured = true;
                                return -1; // Send back to base (smooth glide back)
                            }
                        }
                        return otherPos;
                    });
                }
            });
        }
    }

    tokensUpdates[color][tIndex] = newPos;
    const isWinner = tokensUpdates[color].every(p => p === 57);

    let updates = {
        tokens: tokensUpdates,
        diceValue: 0 
    };

    if (isWinner) {
        updates.winner = color;
        updates.status = 'FINISHED';
        processWinReward(color);
    } else {
        if (dice !== 6 && !captured) {
            updates.currentTurn = getNextTurn(color);
        }
    }

    update(ref(db, `matches/${matchId}`), updates);
}

function getNextTurn(current) {
    const seq = gameState.type === '4P' ? TURN_SEQUENCE_4P : TURN_SEQUENCE_2P;
    let idx = seq.indexOf(current);
    return seq[(idx + 1) % seq.length];
}

function getNextTurn(current) {
    const seq = gameState.type === '4P' ? TURN_SEQUENCE_4P : TURN_SEQUENCE_2P;
    let idx = seq.indexOf(current);
    return seq[(idx + 1) % seq.length];
}

function passTurn() {
    update(ref(db, `matches/${matchId}`), {
        diceValue: 0,
        currentTurn: getNextTurn(myColor)
    });
}

function processWinReward(winnerColor) {
    if (myColor === winnerColor) {
        runTransaction(ref(db, `users/${currentUser.uid}/coins`), (coins) => {
            return (coins || 0) + 80;
        }).then(() => {
            push(ref(db, 'walletTransactions'), {
                uid: currentUser.uid,
                type: 'MATCH_WIN',
                amount: 80,
                reference: matchId,
                timestamp: serverTimestamp()
            });
            window.showToast("Victory! +80 Coins added.");
        });
    }
}

document.getElementById('btn-exit-game').addEventListener('click', () => {
    if(confirm("Are you sure? You will lose your 50 Coins entry fee.")) {
        window.location.replace('index.html');
    }
});