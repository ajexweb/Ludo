// ==========================================
// LUDO PLUS - MASTER GAME ENGINE (FIXED)
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
let localTurnProcessed = false;

// --- Ludo Board Math (15x15 Grid mapped to X,Y) ---
const MAIN_PATH = [
    [6,13], [6,12], [6,11], [6,10], [6,9], [5,8], [4,8], [3,8], [2,8], [1,8], [0,8], [0,7], [0,6], 
    [1,6], [2,6], [3,6], [4,6], [5,6], [6,5], [6,4], [6,3], [6,2], [6,1], [6,0], [7,0], [8,0],    
    [8,1], [8,2], [8,3], [8,4], [8,5], [9,6], [10,6], [11,6], [12,6], [13,6], [14,6], [14,7], [14,8], 
    [13,8], [12,8], [11,8], [10,8], [9,8], [8,9], [8,10], [8,11], [8,12], [8,13], [8,14], [7,14], [6,14] 
];

const HOME_PATHS = {
    RED: [[7,13], [7,12], [7,11], [7,10], [7,9], [7,8]],
    BLUE: [[13,7], [12,7], [11,7], [10,7], [9,7], [8,7]],
    GRAY: [[7,1], [7,2], [7,3], [7,4], [7,5], [7,6]],
    GREEN: [[1,7], [2,7], [3,7], [4,7], [5,7], [6,7]]
};

const START_INDEX = { RED: 0, GREEN: 13, GRAY: 26, BLUE: 39 };
const SAFE_ZONES = [0, 8, 13, 21, 26, 34, 39, 47];

const HOME_BASES = {
    RED: [[2,11], [3,11], [2,12], [3,12]],
    BLUE: [[11,11], [12,11], [11,12], [12,12]],
    GREEN: [[2,2], [3,2], [2,3], [3,3]],
    GRAY: [[11,2], [12,2], [11,3], [12,3]]
};

const TURN_SEQUENCE_4P = ['RED', 'GREEN', 'GRAY', 'BLUE'];
const TURN_SEQUENCE_2P = ['RED', 'BLUE'];

// --- DOM Elements (FIXED: appContainer added) ---
const appContainer = document.getElementById('app-container'); 
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const gameLoader = document.getElementById('game-loader');

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
// 1. LOBBY SYSTEM (ROOMS)
// ==========================================
function initLobby() {
    gameLoader.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    appContainer.classList.remove('hidden'); // Ye pehle crash kar raha tha
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
// 3. GAME ENGINE & SYNC
// ==========================================
function initMatchSync(mId) {
    appContainer.classList.remove('hidden');
    drawBoardGrid();

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
        renderTokensOnBoard();
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
// 4. BOARD RENDERER
// ==========================================
function drawBoardGrid() {
    const board = document.getElementById('ludo-board');
    board.innerHTML = '';
    
    for(let r = 0; r < 15; r++) {
        for(let c = 0; c < 15; c++) {
            const cell = document.createElement('div');
            cell.id = `cell-${c}-${r}`;
            cell.style.border = '1px solid #ddd';
            cell.style.position = 'relative';
            
            if(r < 6 && c < 6) cell.style.backgroundColor = 'var(--ludo-green)';
            if(r < 6 && c > 8) cell.style.backgroundColor = 'var(--ludo-gray)';
            if(r > 8 && c < 6) cell.style.backgroundColor = 'var(--ludo-red)';
            if(r > 8 && c > 8) cell.style.backgroundColor = 'var(--ludo-blue)';

            if(r > 5 && r < 9 && c > 5 && c < 9) cell.style.backgroundColor = '#222';

            const isSafe = SAFE_ZONES.some(index => MAIN_PATH[index][0] === c && MAIN_PATH[index][1] === r);
            if(isSafe) cell.style.backgroundColor = '#e2e8f0';

            board.appendChild(cell);
        }
    }
}

function updatePlayersUI() {
    const colors = ['RED', 'BLUE', 'GREEN', 'GRAY'];
    colors.forEach(c => {
        const pDetails = Object.values(gameState.players).find(p => p.color === c);
        const nameEl = document.getElementById(`name-${c.toLowerCase()}`);
        if(nameEl) {
            nameEl.innerText = pDetails ? pDetails.username : '---';
        }
    });
}

function renderTokensOnBoard() {
    document.querySelectorAll('.goti').forEach(e => e.remove());

    Object.keys(gameState.tokens).forEach(color => {
        const positions = gameState.tokens[color];
        
        positions.forEach((pos, idx) => {
            let x, y;
            if (pos === -1) {
                x = HOME_BASES[color][idx][0];
                y = HOME_BASES[color][idx][1];
            } else if (pos < 52) {
                let actualIndex = (START_INDEX[color] + pos) % 52;
                x = MAIN_PATH[actualIndex][0];
                y = MAIN_PATH[actualIndex][1];
            } else if (pos < 58) {
                let homeIdx = pos - 52;
                x = HOME_PATHS[color][homeIdx][0];
                y = HOME_PATHS[color][homeIdx][1];
            } else {
                return;
            }

            const cell = document.getElementById(`cell-${x}-${y}`);
            if (cell) {
                const token = document.createElement('div');
                token.className = `goti bg-${color.toLowerCase()}`;
                token.style.width = '70%';
                token.style.height = '70%';
                token.style.borderRadius = '50%';
                token.style.position = 'absolute';
                token.style.top = '15%';
                token.style.left = '15%';
                token.style.border = '2px solid white';
                token.style.boxShadow = '0 2px 4px rgba(0,0,0,0.5)';
                token.style.cursor = 'pointer';
                token.style.zIndex = 10;
                
                if (gameState.currentTurn === myColor && color === myColor && gameState.diceValue > 0) {
                    token.style.boxShadow = '0 0 10px #FFF';
                    token.onclick = () => handleTokenMove(color, idx, pos);
                }
                
                cell.appendChild(token);
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
            setTimeout(() => checkMovePossibility(finalDice), 500);
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
        alert("No valid moves! Turn passed.");
        setTimeout(passTurn, 1000);
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
                                return -1; 
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
            alert("Victory! +80 Coins added.");
        });
    }
}

document.getElementById('btn-exit-game').addEventListener('click', () => {
    if(confirm("Are you sure? You will lose your 50 Coins entry fee.")) {
        window.location.replace('index.html');
    }
});