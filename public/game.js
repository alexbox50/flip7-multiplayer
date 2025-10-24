class Flip7Game {
    constructor() {
        this.socket = io();
        this.playerNumber = null;
        this.playerName = null;
        this.gameState = null;
        this.isMyTurn = false;
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupSocketListeners();
    }

    initializeElements() {
        // Connection screen elements
        this.connectionScreen = document.getElementById('connection-screen');
        this.gameScreen = document.getElementById('game-screen');
        this.playerNameInput = document.getElementById('player-name');
        this.playerNumberInput = document.getElementById('player-number');
        this.joinBtn = document.getElementById('join-btn');
        this.reconnectBtn = document.getElementById('reconnect-btn');
        this.connectionStatus = document.getElementById('connection-status');

        // Game screen elements
        this.currentPlayerNumber = document.getElementById('current-player-number');
        this.currentPlayerName = document.getElementById('current-player-name');
        this.playersList = document.getElementById('players-list');
        this.startGameBtn = document.getElementById('start-game-btn');
        this.leaveGameBtn = document.getElementById('leave-game-btn');
        this.topCard = document.getElementById('top-card');
        this.directionIndicator = document.getElementById('direction-indicator');
        this.handCards = document.getElementById('hand-cards');
        this.currentTurn = document.getElementById('current-turn');
        this.gameMessage = document.getElementById('game-message');

        // Admin panel elements
        this.adminPassword = document.getElementById('admin-password');
        this.restartGameBtn = document.getElementById('restart-game-btn');
        this.dropPlayerNumber = document.getElementById('drop-player-number');
        this.dropPlayerBtn = document.getElementById('drop-player-btn');
    }

    setupEventListeners() {
        this.joinBtn.addEventListener('click', () => this.joinGame());
        this.reconnectBtn.addEventListener('click', () => this.reconnectPlayer());
        this.startGameBtn.addEventListener('click', () => this.startGame());
        this.leaveGameBtn.addEventListener('click', () => this.leaveGame());
        
        // Admin controls
        this.restartGameBtn.addEventListener('click', () => this.restartGame());
        this.dropPlayerBtn.addEventListener('click', () => this.dropPlayer());

        // Enter key handlers
        this.playerNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinGame();
        });
        
        this.playerNumberInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinGame();
        });
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            this.showStatus('Connected to server', 'success');
        });

        this.socket.on('disconnect', () => {
            this.showStatus('Disconnected from server', 'error');
        });

        this.socket.on('player-assigned', (data) => {
            this.playerNumber = data.playerNumber;
            this.playerName = data.name;
            this.currentPlayerNumber.textContent = data.playerNumber;
            this.currentPlayerName.textContent = data.name;
            
            if (data.reconnected) {
                this.showMessage('Successfully reconnected!', 'success');
            } else {
                this.showMessage(`Welcome! You are Player ${data.playerNumber}`, 'success');
            }
            
            this.showGameScreen();
        });

        this.socket.on('game-full', (data) => {
            this.showStatus(data.message, 'error');
        });

        this.socket.on('reconnect-failed', (data) => {
            this.showStatus(data.message, 'error');
        });

        this.socket.on('game-state', (gameState) => {
            this.gameState = gameState;
            this.updateGameDisplay();
        });

        this.socket.on('game-started', () => {
            this.showMessage('Game started!', 'success');
            this.startGameBtn.style.display = 'none';
        });

        this.socket.on('game-restarted', () => {
            this.showMessage('Game restarted by admin', 'info');
            this.startGameBtn.style.display = 'inline-block';
        });

        this.socket.on('card-played', (data) => {
            this.showMessage(`${data.playerName} played ${this.formatCard(data.card)}`, 'info');
        });

        this.socket.on('game-won', (data) => {
            this.showMessage(`🎉 ${data.winner} wins the game! 🎉`, 'success');
        });

        this.socket.on('player-disconnected', (data) => {
            this.showMessage(`${data.playerName} disconnected`, 'info');
        });

        this.socket.on('player-dropped', (data) => {
            this.showMessage(`${data.playerName} was dropped by admin`, 'info');
        });

        this.socket.on('invalid-move', (data) => {
            this.showMessage(data.message, 'error');
        });

        this.socket.on('start-error', (data) => {
            this.showMessage(data.message, 'error');
        });

        this.socket.on('admin-error', (data) => {
            this.showMessage(data.message, 'error');
        });
    }

    joinGame() {
        const playerName = this.playerNameInput.value.trim();
        const playerNumber = this.playerNumberInput.value;

        if (!playerName) {
            this.showStatus('Please enter your name', 'error');
            return;
        }

        this.socket.emit('join-game', {
            playerName,
            playerNumber: playerNumber ? parseInt(playerNumber) : null
        });
    }

    reconnectPlayer() {
        const playerNumber = this.playerNumberInput.value;
        
        if (!playerNumber) {
            this.showStatus('Please enter your player number to reconnect', 'error');
            return;
        }

        this.socket.emit('reconnect-player', {
            playerNumber: parseInt(playerNumber)
        });
    }

    startGame() {
        this.socket.emit('start-game');
    }

    leaveGame() {
        this.socket.disconnect();
        this.showConnectionScreen();
        this.showStatus('Left the game', 'info');
        
        // Reconnect after a short delay
        setTimeout(() => {
            this.socket.connect();
        }, 1000);
    }

    restartGame() {
        const password = this.adminPassword.value;
        if (!password) {
            this.showMessage('Please enter admin password', 'error');
            return;
        }

        this.socket.emit('admin-restart', { password });
        this.adminPassword.value = '';
    }

    dropPlayer() {
        const password = this.adminPassword.value;
        const playerNumber = this.dropPlayerNumber.value;
        
        if (!password) {
            this.showMessage('Please enter admin password', 'error');
            return;
        }
        
        if (!playerNumber) {
            this.showMessage('Please enter player number to drop', 'error');
            return;
        }

        this.socket.emit('admin-drop-player', { 
            password, 
            playerNumber: parseInt(playerNumber) 
        });
        
        this.dropPlayerNumber.value = '';
    }

    playCard(cardIndex) {
        if (!this.isMyTurn) {
            this.showMessage('Not your turn!', 'error');
            return;
        }

        this.socket.emit('play-card', { cardIndex });
    }

    updateGameDisplay() {
        if (!this.gameState) return;

        this.updatePlayersList();
        this.updateTopCard();
        this.updatePlayerHand();
        this.updateTurnIndicator();
        this.updateDirection();
    }

    updatePlayersList() {
        this.playersList.innerHTML = '';
        
        const sortedPlayers = Object.entries(this.gameState.players)
            .sort(([a], [b]) => parseInt(a) - parseInt(b));

        sortedPlayers.forEach(([playerNumber, player]) => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';
            
            if (parseInt(playerNumber) === this.gameState.currentPlayer) {
                playerItem.classList.add('current-turn');
            }
            
            if (!player.connected) {
                playerItem.classList.add('disconnected');
            }

            playerItem.innerHTML = `
                <span class="player-number">${playerNumber}</span>
                <span class="player-name">${player.name}</span>
                <span class="card-count">${player.cards.length}</span>
            `;

            this.playersList.appendChild(playerItem);
        });
    }

    updateTopCard() {
        if (this.gameState.discardPile && this.gameState.discardPile.length > 0) {
            const card = this.gameState.discardPile[this.gameState.discardPile.length - 1];
            this.topCard.innerHTML = this.renderCard(card);
        } else {
            this.topCard.innerHTML = '<div class="card">No cards</div>';
        }
    }

    updatePlayerHand() {
        this.handCards.innerHTML = '';
        
        if (!this.gameState.players[this.playerNumber]) return;
        
        const playerCards = this.gameState.players[this.playerNumber].cards;
        const topCard = this.gameState.discardPile[this.gameState.discardPile.length - 1];
        
        playerCards.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.innerHTML = this.renderCard(card);
            
            const cardDiv = cardElement.firstChild;
            
            // Check if card is playable
            if (this.isCardPlayable(card, topCard)) {
                cardDiv.classList.add('playable');
            }
            
            cardDiv.addEventListener('click', () => this.playCard(index));
            this.handCards.appendChild(cardDiv);
        });
    }

    updateTurnIndicator() {
        this.isMyTurn = this.gameState.currentPlayer === this.playerNumber;
        
        if (this.gameState.gameStarted) {
            const currentPlayer = this.gameState.players[this.gameState.currentPlayer];
            if (currentPlayer) {
                this.currentTurn.innerHTML = `Current turn: ${currentPlayer.name} (#${this.gameState.currentPlayer})`;
                
                if (this.isMyTurn) {
                    this.currentTurn.innerHTML += ' - <strong>YOUR TURN!</strong>';
                    this.currentTurn.style.color = '#ff6b35';
                } else {
                    this.currentTurn.style.color = '#ffffff';
                }
            }
        } else {
            this.currentTurn.innerHTML = 'Game not started';
            this.currentTurn.style.color = '#ffffff';
        }
    }

    updateDirection() {
        if (this.gameState.direction === 1) {
            this.directionIndicator.textContent = '↻';
            this.directionIndicator.classList.remove('direction-reverse');
        } else {
            this.directionIndicator.textContent = '↺';
            this.directionIndicator.classList.add('direction-reverse');
        }
    }

    isCardPlayable(card, topCard) {
        if (!this.gameState.gameStarted || !this.isMyTurn || !topCard) return false;
        
        return card.rank === '7' || 
               card.suit === topCard.suit || 
               card.rank === topCard.rank;
    }

    renderCard(card) {
        const suitSymbols = {
            'hearts': '♥',
            'diamonds': '♦',
            'clubs': '♣',
            'spades': '♠'
        };

        return `
            <div class="card ${card.suit}">
                <span class="card-rank">${card.rank}</span>
                <span class="card-suit">${suitSymbols[card.suit]}</span>
                <span class="card-center">${suitSymbols[card.suit]}</span>
            </div>
        `;
    }

    formatCard(card) {
        const suitSymbols = {
            'hearts': '♥',
            'diamonds': '♦',
            'clubs': '♣',
            'spades': '♠'
        };
        
        return `${card.rank}${suitSymbols[card.suit]}`;
    }

    showConnectionScreen() {
        this.connectionScreen.classList.remove('hidden');
        this.gameScreen.classList.add('hidden');
    }

    showGameScreen() {
        this.connectionScreen.classList.add('hidden');
        this.gameScreen.classList.remove('hidden');
    }

    showStatus(message, type) {
        this.connectionStatus.textContent = message;
        this.connectionStatus.className = type === 'error' ? 'status-error' : 'status-success';
    }

    showMessage(message, type) {
        this.gameMessage.innerHTML = `<div class="message ${type}">${message}</div>`;
        
        // Auto-clear message after 5 seconds
        setTimeout(() => {
            if (this.gameMessage.innerHTML.includes(message)) {
                this.gameMessage.innerHTML = '';
            }
        }, 5000);
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new Flip7Game();
});