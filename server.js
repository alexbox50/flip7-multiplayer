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
    players: {},  // playerNumber -> {id, name, cards, connected}
    currentPlayer: 1,
    gameStarted: false,
    deck: [],
    discardPile: [],
    direction: 1, // 1 for clockwise, -1 for counterclockwise
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
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const deck = [];
    
    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push({ suit, rank, value: getRankValue(rank) });
        }
    }
    
    return shuffleDeck(deck);
}

function getRankValue(rank) {
    if (rank === 'A') return 1;
    if (rank === 'J') return 11;
    if (rank === 'Q') return 12;
    if (rank === 'K') return 13;
    return parseInt(rank);
}

function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function dealCards() {
    const activePlayers = Object.keys(gameState.players).length;
    const cardsPerPlayer = Math.floor(52 / activePlayers);
    
    gameState.deck = createDeck();
    
    // Deal cards to players
    Object.keys(gameState.players).forEach((playerNumber, index) => {
        gameState.players[playerNumber].cards = gameState.deck.splice(0, cardsPerPlayer);
    });
    
    // Start discard pile with first card
    if (gameState.deck.length > 0) {
        gameState.discardPile = [gameState.deck.pop()];
    }
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
                    number: parseInt(playerNumber)
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
                number: assignedNumber
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

    // Handle card play
    socket.on('play-card', (data) => {
        const { cardIndex } = data;
        const playerNumber = socket.playerNumber;
        
        if (!playerNumber || !gameState.players[playerNumber] || !gameState.gameStarted) {
            return;
        }
        
        const player = gameState.players[playerNumber];
        if (gameState.currentPlayer !== parseInt(playerNumber)) {
            socket.emit('invalid-move', { message: 'Not your turn' });
            return;
        }
        
        if (cardIndex < 0 || cardIndex >= player.cards.length) {
            socket.emit('invalid-move', { message: 'Invalid card' });
            return;
        }
        
        const playedCard = player.cards[cardIndex];
        const topCard = gameState.discardPile[gameState.discardPile.length - 1];
        
        // Flip 7 rules: play same suit or rank, or any 7
        if (playedCard.rank === '7' || 
            playedCard.suit === topCard.suit || 
            playedCard.rank === topCard.rank) {
            
            // Remove card from player's hand
            player.cards.splice(cardIndex, 1);
            gameState.discardPile.push(playedCard);
            
            // Special card effects
            if (playedCard.rank === '7') {
                // Reverse direction
                gameState.direction *= -1;
            }
            
            // Check for win condition
            if (player.cards.length === 0) {
                gameState.winner = playerNumber;
                io.to('game').emit('game-won', { winner: player.name, playerNumber });
                return;
            }
            
            // Next player's turn
            const playerNumbers = Object.keys(gameState.players).map(n => parseInt(n)).sort((a, b) => a - b);
            const currentIndex = playerNumbers.indexOf(gameState.currentPlayer);
            const nextIndex = (currentIndex + gameState.direction + playerNumbers.length) % playerNumbers.length;
            gameState.currentPlayer = playerNumbers[nextIndex];
            
            io.to('game').emit('game-state', gameState);
            io.to('game').emit('card-played', { 
                playerNumber, 
                playerName: player.name, 
                card: playedCard 
            });
        } else {
            socket.emit('invalid-move', { message: 'Invalid card play' });
        }
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
        });
        
        gameState.gameStarted = false;
        gameState.currentPlayer = 1;
        gameState.deck = [];
        gameState.discardPile = [];
        gameState.direction = 1;
        gameState.winner = null;
        
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

    // Start game
    socket.on('start-game', () => {
        const playerCount = Object.keys(gameState.players).length;
        if (playerCount < 2) {
            socket.emit('start-error', { message: 'Need at least 2 players to start' });
            return;
        }
        
        dealCards();
        gameState.gameStarted = true;
        gameState.currentPlayer = Math.min(...Object.keys(gameState.players).map(n => parseInt(n)));
        
        io.to('game').emit('game-started');
        io.to('game').emit('game-state', gameState);
        
        console.log('Game started with', playerCount, 'players');
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