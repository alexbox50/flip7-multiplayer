const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Game state
let gameState = {
    players: {},  // playerNumber -> {id, name, cards, connected, points, status}
    currentPlayer: 1,
    gameStarted: false,
    roundInProgress: false,
    deck: [],
    roundNumber: 1,
    roundStartPlayer: 1, // Track who started the current round
    adminPassword: 'admin123' // Simple admin authentication
};

// Player management - stable player numbers 1-18
const MAX_PLAYERS = 18;
const playerSlots = Array.from({length: MAX_PLAYERS}, (_, i) => ({
    number: i + 1,
    occupied: false,
    playerId: null
}));

// Flip 7 game logic
function createDeck() {
    const deck = [];
    
    // 1x card with value 1; 2x cards with value 2; ... 12x cards with value 12
    for (let value = 1; value <= 12; value++) {
        for (let count = 0; count < value; count++) {
            deck.push({ value: value, id: `${value}-${count}` });
        }
    }
    
    return shuffleDeck(deck);
}

function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function startNewRound() {
    gameState.deck = createDeck();
    gameState.roundInProgress = true;
    
    // Reset all players for new round
    Object.keys(gameState.players).forEach(playerNumber => {
        gameState.players[playerNumber].cards = [];
        gameState.players[playerNumber].status = 'playing'; // playing, stuck, bust, flip7
        gameState.players[playerNumber].hasDrawnFirstCard = false;
    });
    
    // Determine starting player (rotate from previous round)
    const playerNumbers = Object.keys(gameState.players).map(n => parseInt(n)).sort((a, b) => a - b);
    
    if (gameState.roundNumber === 1) {
        // First round: start with lowest numbered player
        gameState.roundStartPlayer = playerNumbers[0];
    } else {
        // Subsequent rounds: start with next player after previous round's starter
        const previousStarterIndex = playerNumbers.indexOf(gameState.roundStartPlayer);
        const nextStarterIndex = (previousStarterIndex + 1) % playerNumbers.length;
        gameState.roundStartPlayer = playerNumbers[nextStarterIndex];
    }
    
    gameState.currentPlayer = gameState.roundStartPlayer;
}

function drawCard(playerNumber) {
    if (gameState.deck.length === 0) {
        return null;
    }
    
    const card = gameState.deck.pop();
    gameState.players[playerNumber].cards.push(card);
    return card;
}

function hasCardValue(playerNumber, value) {
    return gameState.players[playerNumber].cards.some(card => card.value === value);
}

function calculateHandValue(playerNumber) {
    return gameState.players[playerNumber].cards.reduce((sum, card) => sum + card.value, 0);
}

function checkRoundEnd() {
    const playingPlayers = Object.values(gameState.players).filter(p => p.status === 'playing');
    return playingPlayers.length === 0;
}

function nextPlayer() {
    const playerNumbers = Object.keys(gameState.players).map(n => parseInt(n)).sort((a, b) => a - b);
    const currentIndex = playerNumbers.indexOf(gameState.currentPlayer);
    
    // Find next active player
    for (let i = 1; i <= playerNumbers.length; i++) {
        const nextIndex = (currentIndex + i) % playerNumbers.length;
        const nextPlayerNumber = playerNumbers[nextIndex];
        if (gameState.players[nextPlayerNumber].status === 'playing') {
            gameState.currentPlayer = nextPlayerNumber;
            return;
        }
    }
    
    // No active players left, round is over
    gameState.roundInProgress = false;
}

function getAvailablePlayerSlot() {
    return playerSlots.find(slot => !slot.occupied);
}

function releasePlayerSlot(playerNumber) {
    const slot = playerSlots.find(slot => slot.number === parseInt(playerNumber));
    if (slot) {
        slot.occupied = false;
        slot.playerId = null;
    }
}

function assignPlayerSlot(playerId) {
    const slot = getAvailablePlayerSlot();
    if (slot) {
        slot.occupied = true;
        slot.playerId = playerId;
        return slot.number;
    }
    return null;
}

function endRound() {
    // Award points to players
    Object.keys(gameState.players).forEach(playerNumber => {
        const player = gameState.players[playerNumber];
        if (player.roundPoints !== undefined) {
            player.points += player.roundPoints;
        }
    });
    
    // Calculate who will start the next round
    const playerNumbers = Object.keys(gameState.players).map(n => parseInt(n)).sort((a, b) => a - b);
    const currentStarterIndex = playerNumbers.indexOf(gameState.roundStartPlayer);
    const nextStarterIndex = (currentStarterIndex + 1) % playerNumbers.length;
    const nextRoundStarter = playerNumbers[nextStarterIndex];
    const nextStarterName = gameState.players[nextRoundStarter]?.name || `Player ${nextRoundStarter}`;
    
    io.to('game').emit('round-ended', {
        roundNumber: gameState.roundNumber,
        results: Object.keys(gameState.players).map(pNum => ({
            playerNumber: pNum,
            playerName: gameState.players[pNum].name,
            roundPoints: gameState.players[pNum].roundPoints || 0,
            totalPoints: gameState.players[pNum].points,
            status: gameState.players[pNum].status
        })),
        nextRoundStarter: {
            playerNumber: nextRoundStarter,
            playerName: nextStarterName
        }
    });
    
    gameState.roundNumber++;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Handle player joining
    socket.on('join-game', (data) => {
        const { playerName, playerNumber } = data;
        
        // Check if specific player number requested and available
        if (playerNumber) {
            const slot = playerSlots.find(slot => slot.number === parseInt(playerNumber));
            if (slot && !slot.occupied) {
                slot.occupied = true;
                slot.playerId = socket.id;
                
                gameState.players[playerNumber] = {
                    id: socket.id,
                    name: playerName || `Player ${playerNumber}`,
                    cards: [],
                    connected: true,
                    number: parseInt(playerNumber),
                    points: 0,
                    status: 'waiting',
                    hasDrawnFirstCard: false
                };
                
                socket.playerNumber = playerNumber;
                socket.join('game');
                
                socket.emit('player-assigned', { playerNumber, name: gameState.players[playerNumber].name });
                io.to('game').emit('game-state', gameState);
                
                console.log(`Player ${playerName} assigned to slot ${playerNumber}`);
                return;
            }
        }
        
        // Assign next available slot
        const assignedNumber = assignPlayerSlot(socket.id);
        if (assignedNumber) {
            gameState.players[assignedNumber] = {
                id: socket.id,
                name: playerName || `Player ${assignedNumber}`,
                cards: [],
                connected: true,
                number: assignedNumber,
                points: 0,
                status: 'waiting',
                hasDrawnFirstCard: false
            };
            
            socket.playerNumber = assignedNumber;
            socket.join('game');
            
            socket.emit('player-assigned', { playerNumber: assignedNumber, name: gameState.players[assignedNumber].name });
            io.to('game').emit('game-state', gameState);
            
            console.log(`Player ${playerName} assigned to slot ${assignedNumber}`);
        } else {
            socket.emit('game-full', { message: 'Game is full (18 players max)' });
        }
    });

    // Handle player reconnection
    socket.on('reconnect-player', (data) => {
        const { playerNumber } = data;
        const slot = playerSlots.find(slot => slot.number === parseInt(playerNumber));
        
        if (slot && slot.occupied && gameState.players[playerNumber]) {
            // Update socket ID for reconnecting player
            gameState.players[playerNumber].id = socket.id;
            gameState.players[playerNumber].connected = true;
            slot.playerId = socket.id;
            
            socket.playerNumber = playerNumber;
            socket.join('game');
            
            socket.emit('player-assigned', { 
                playerNumber, 
                name: gameState.players[playerNumber].name,
                reconnected: true 
            });
            io.to('game').emit('game-state', gameState);
            
            console.log(`Player reconnected to slot ${playerNumber}`);
        } else {
            socket.emit('reconnect-failed', { message: 'Player slot not found or available' });
        }
    });

    // Handle player action (draw card, stick)
    socket.on('player-action', (data) => {
        const { action } = data; // 'draw' or 'stick'
        const playerNumber = socket.playerNumber;
        
        if (!playerNumber || !gameState.players[playerNumber] || !gameState.roundInProgress) {
            return;
        }
        
        const player = gameState.players[playerNumber];
        if (gameState.currentPlayer !== parseInt(playerNumber)) {
            socket.emit('invalid-move', { message: 'Not your turn' });
            return;
        }
        
        if (player.status !== 'playing') {
            socket.emit('invalid-move', { message: 'You are not actively playing' });
            return;
        }

        if (action === 'draw') {
            // First turn: must draw
            if (!player.hasDrawnFirstCard) {
                const drawnCard = drawCard(playerNumber);
                if (!drawnCard) {
                    socket.emit('game-error', { message: 'No cards left in deck' });
                    return;
                }
                
                player.hasDrawnFirstCard = true;
                
                io.to('game').emit('card-drawn', {
                    playerNumber,
                    playerName: player.name,
                    card: drawnCard,
                    isFirstCard: true
                });
                
                nextPlayer();
            } else {
                // Subsequent turns: twist
                const drawnCard = drawCard(playerNumber);
                if (!drawnCard) {
                    socket.emit('game-error', { message: 'No cards left in deck' });
                    return;
                }
                
                // Check for bust (same value already in hand)
                const cardValues = player.cards.map(c => c.value);
                const uniqueValues = new Set(cardValues);
                
                if (cardValues.length !== uniqueValues.size) {
                    // Player went bust
                    player.status = 'bust';
                    player.roundPoints = 0;
                    
                    io.to('game').emit('player-bust', {
                        playerNumber,
                        playerName: player.name,
                        drawnCard: drawnCard
                    });
                } else {
                    // Check for Flip 7 (7 unique values)
                    if (uniqueValues.size === 7) {
                        player.status = 'flip7';
                        const handValue = calculateHandValue(playerNumber);
                        player.roundPoints = handValue + 15;
                        
                        io.to('game').emit('flip-seven', {
                            playerNumber,
                            playerName: player.name,
                            handValue: handValue,
                            totalPoints: player.roundPoints
                        });
                        
                        // Round ends immediately
                        gameState.roundInProgress = false;
                        endRound();
                        return;
                    } else {
                        io.to('game').emit('card-drawn', {
                            playerNumber,
                            playerName: player.name,
                            card: drawnCard,
                            uniqueValues: uniqueValues.size
                        });
                    }
                }
                
                // Check if round should end
                if (checkRoundEnd()) {
                    endRound();
                } else {
                    nextPlayer();
                }
            }
        } else if (action === 'stick') {
            if (!player.hasDrawnFirstCard) {
                socket.emit('invalid-move', { message: 'Must draw at least one card before sticking' });
                return;
            }
            
            player.status = 'stuck';
            player.roundPoints = calculateHandValue(playerNumber);
            
            io.to('game').emit('player-stuck', {
                playerNumber,
                playerName: player.name,
                handValue: player.roundPoints
            });
            
            if (checkRoundEnd()) {
                endRound();
            } else {
                nextPlayer();
            }
        }
        
        io.to('game').emit('game-state', gameState);
    });

    // Admin functions
    socket.on('admin-restart', (data) => {
        const { password } = data;
        if (password !== gameState.adminPassword) {
            socket.emit('admin-error', { message: 'Invalid admin password' });
            return;
        }
        
        // Reset game state but keep players
        Object.keys(gameState.players).forEach(playerNumber => {
            gameState.players[playerNumber].cards = [];
            gameState.players[playerNumber].points = 0;
            gameState.players[playerNumber].status = 'waiting';
            gameState.players[playerNumber].hasDrawnFirstCard = false;
            gameState.players[playerNumber].roundPoints = undefined;
        });
        
        gameState.gameStarted = false;
        gameState.roundInProgress = false;
        gameState.currentPlayer = 1;
        gameState.deck = [];
        gameState.roundNumber = 1;
        gameState.roundStartPlayer = 1;
        
        io.to('game').emit('game-restarted');
        io.to('game').emit('game-state', gameState);
        
        console.log('Game restarted by admin');
    });

    socket.on('admin-drop-player', (data) => {
        const { password, playerNumber } = data;
        if (password !== gameState.adminPassword) {
            socket.emit('admin-error', { message: 'Invalid admin password' });
            return;
        }
        
        if (gameState.players[playerNumber]) {
            const droppedPlayer = gameState.players[playerNumber];
            delete gameState.players[playerNumber];
            releasePlayerSlot(playerNumber);
            
            // Disconnect the player's socket
            const playerSocket = io.sockets.sockets.get(droppedPlayer.id);
            if (playerSocket) {
                playerSocket.disconnect();
            }
            
            io.to('game').emit('player-dropped', { 
                playerNumber, 
                playerName: droppedPlayer.name 
            });
            io.to('game').emit('game-state', gameState);
            
            console.log(`Admin dropped player ${playerNumber}`);
        }
    });

    // Start game/round
    socket.on('start-game', () => {
        const playerCount = Object.keys(gameState.players).length;
        if (playerCount < 2) {
            socket.emit('start-error', { message: 'Need at least 2 players to start' });
            return;
        }
        
        if (!gameState.gameStarted) {
            gameState.gameStarted = true;
            io.to('game').emit('game-started');
            console.log('Game started with', playerCount, 'players');
        }
        
        startNewRound();
        const startingPlayerName = gameState.players[gameState.roundStartPlayer]?.name || `Player ${gameState.roundStartPlayer}`;
        io.to('game').emit('round-started', { 
            roundNumber: gameState.roundNumber,
            deckSize: gameState.deck.length,
            startingPlayer: {
                playerNumber: gameState.roundStartPlayer,
                playerName: startingPlayerName
            }
        });
        io.to('game').emit('game-state', gameState);
        
        console.log(`Round ${gameState.roundNumber} started with ${startingPlayerName}`);
    });

    socket.on('start-next-round', () => {
        if (!gameState.gameStarted) {
            socket.emit('start-error', { message: 'Game not started' });
            return;
        }
        
        startNewRound();
        const startingPlayerName = gameState.players[gameState.roundStartPlayer]?.name || `Player ${gameState.roundStartPlayer}`;
        io.to('game').emit('round-started', { 
            roundNumber: gameState.roundNumber,
            deckSize: gameState.deck.length,
            startingPlayer: {
                playerNumber: gameState.roundStartPlayer,
                playerName: startingPlayerName
            }
        });
        io.to('game').emit('game-state', gameState);
        
        console.log(`Round ${gameState.roundNumber} started with ${startingPlayerName}`);
    });

    socket.on('admin-kick-all-restart', (data) => {
        const { password } = data;
        if (password !== gameState.adminPassword) {
            socket.emit('admin-error', { message: 'Invalid admin password' });
            return;
        }
        
        console.log('Admin kicked all players and restarted game');
        
        // Disconnect all players except the admin who triggered this
        Object.keys(gameState.players).forEach(playerNumber => {
            const player = gameState.players[playerNumber];
            if (player.id !== socket.id) {
                const playerSocket = io.sockets.sockets.get(player.id);
                if (playerSocket) {
                    playerSocket.emit('kicked-by-admin', { message: 'You were kicked by admin - game reset' });
                    playerSocket.disconnect();
                }
            }
        });
        
        // Reset all game state completely
        gameState.players = {};
        gameState.currentPlayer = 1;
        gameState.gameStarted = false;
        gameState.roundInProgress = false;
        gameState.deck = [];
        gameState.roundNumber = 1;
        gameState.roundStartPlayer = 1;
        
        // Reset all player slots
        playerSlots.forEach(slot => {
            slot.occupied = false;
            slot.playerId = null;
        });
        
        // Broadcast the complete reset
        io.to('game').emit('game-completely-reset');
        socket.emit('admin-success', { message: 'All players kicked and game reset' });
        
        console.log('Game completely reset by admin');
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        if (socket.playerNumber && gameState.players[socket.playerNumber]) {
            gameState.players[socket.playerNumber].connected = false;
            io.to('game').emit('player-disconnected', { 
                playerNumber: socket.playerNumber,
                playerName: gameState.players[socket.playerNumber].name
            });
            io.to('game').emit('game-state', gameState);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Flip 7 server running on port ${PORT}`);
});