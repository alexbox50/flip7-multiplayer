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
        this.startRoundBtn = document.getElementById('start-round-btn');
        this.leaveGameBtn = document.getElementById('leave-game-btn');
        this.deckCount = document.getElementById('deck-count');
        this.currentRound = document.getElementById('current-round');
        this.cardsLeft = document.getElementById('cards-left');
        this.drawBtn = document.getElementById('draw-btn');
        this.stickBtn = document.getElementById('stick-btn');
        this.handCards = document.getElementById('hand-cards');
        this.uniqueCount = document.getElementById('unique-count');
        this.totalValue = document.getElementById('total-value');
        this.currentTurn = document.getElementById('current-turn');
        this.gameMessage = document.getElementById('game-message');

        // Admin panel elements
        this.adminPassword = document.getElementById('admin-password');
        this.restartGameBtn = document.getElementById('restart-game-btn');
        this.dropPlayerNumber = document.getElementById('drop-player-number');
        this.dropPlayerBtn = document.getElementById('drop-player-btn');
        this.kickAllRestartBtn = document.getElementById('kick-all-restart-btn');
    }

    setupEventListeners() {
        this.joinBtn.addEventListener('click', () => this.joinGame());
        this.reconnectBtn.addEventListener('click', () => this.reconnectPlayer());
        this.startGameBtn.addEventListener('click', () => this.startGame());
        this.startRoundBtn.addEventListener('click', () => this.startNextRound());
        this.leaveGameBtn.addEventListener('click', () => this.leaveGame());
        this.drawBtn.addEventListener('click', () => this.drawCard());
        this.stickBtn.addEventListener('click', () => this.stick());
        
        // Admin controls
        this.restartGameBtn.addEventListener('click', () => this.restartGame());
        this.dropPlayerBtn.addEventListener('click', () => this.dropPlayer());
        this.kickAllRestartBtn.addEventListener('click', () => this.kickAllAndRestart());

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

        this.socket.on('round-started', (data) => {
            let message = `Round ${data.roundNumber} started!`;
            if (data.startingPlayer) {
                message += ` ${data.startingPlayer.playerName} goes first.`;
                if (data.startingPlayer.playerNumber === this.playerNumber) {
                    message += ` Draw your first card!`;
                }
            }
            this.showMessage(message, 'info');
            this.startRoundBtn.style.display = 'none';
            this.currentRound.textContent = data.roundNumber;
            this.cardsLeft.textContent = data.deckSize;
        });

        this.socket.on('game-restarted', () => {
            this.showMessage('Game restarted by admin', 'info');
            this.startGameBtn.style.display = 'inline-block';
            this.startRoundBtn.style.display = 'none';
        });

        this.socket.on('card-drawn', (data) => {
            if (data.playerNumber === this.playerNumber) {
                this.showMessage(`You drew: ${data.card.value}`, 'info');
            } else {
                this.showMessage(`${data.playerName} drew a card${data.isFirstCard ? ' (first card)' : ''}`, 'info');
            }
            // Force update display after card is drawn
            this.updateGameDisplay();
        });

        this.socket.on('player-stuck', (data) => {
            this.showMessage(`${data.playerName} stuck with ${data.handValue} points`, 'info');
        });

        this.socket.on('player-bust', (data) => {
            this.showMessage(`${data.playerName} went BUST! Drew duplicate value ${data.drawnCard.value}`, 'error');
        });

        this.socket.on('flip-seven', (data) => {
            this.showMessage(`🎉 ${data.playerName} hit FLIP 7! ${data.handValue} + 15 bonus = ${data.totalPoints} points!`, 'success');
        });

        this.socket.on('round-ended', (data) => {
            let message = `Round ${data.roundNumber - 1} Results:\n`;
            data.results.forEach(result => {
                message += `${result.playerName}: ${result.roundPoints} points (${result.status})\n`;
            });
            if (data.nextRoundStarter) {
                message += `\nNext round will start with: ${data.nextRoundStarter.playerName} (#${data.nextRoundStarter.playerNumber})`;
            }
            this.showMessage(message, 'info');
            this.startRoundBtn.style.display = 'inline-block';
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

        this.socket.on('admin-success', (data) => {
            this.showMessage(data.message, 'success');
        });

        this.socket.on('kicked-by-admin', (data) => {
            alert(data.message);
            this.showConnectionScreen();
            this.showStatus('Kicked by admin - game was reset', 'error');
        });

        this.socket.on('game-completely-reset', () => {
            this.showMessage('Game was completely reset by admin', 'info');
            this.gameState = null;
            this.updateGameDisplay();
            this.startGameBtn.style.display = 'inline-block';
            this.startRoundBtn.style.display = 'none';
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

    startNextRound() {
        this.socket.emit('start-next-round');
    }

    drawCard() {
        this.socket.emit('player-action', { action: 'draw' });
    }

    stick() {
        this.socket.emit('player-action', { action: 'stick' });
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

    kickAllAndRestart() {
        const password = this.adminPassword.value;
        if (!password) {
            this.showMessage('Please enter admin password', 'error');
            return;
        }

        if (confirm('This will kick ALL players and completely restart the game. Are you sure?')) {
            this.socket.emit('admin-kick-all-restart', { password });
            this.adminPassword.value = '';
        }
    }

    // Removed playCard function - no longer needed for Flip 7

    updateGameDisplay() {
        if (!this.gameState) {
            // Clear display when no game state
            this.playersList.innerHTML = '';
            this.handCards.innerHTML = '';
            this.currentTurn.innerHTML = 'No game in progress';
            this.cardsLeft.textContent = '0';
            this.currentRound.textContent = '1';
            this.uniqueCount.textContent = '0';
            this.totalValue.textContent = '0';
            this.drawBtn.disabled = true;
            this.stickBtn.disabled = true;
            return;
        }

        this.updatePlayersList();
        this.updateDeckInfo();
        this.updatePlayerHand();
        this.updateTurnIndicator();
        this.updateActionButtons();
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

            const statusClass = `status-${player.status || 'waiting'}`;
            
            playerItem.innerHTML = `
                <span class="player-number">${playerNumber}</span>
                <span class="player-name">${player.name}</span>
                <span class="card-count">${player.cards.length}</span>
                <span class="player-points">${player.points || 0}pts</span>
                <span class="status-indicator ${statusClass}">${player.status || 'waiting'}</span>
            `;

            this.playersList.appendChild(playerItem);
        });
    }

    updateDeckInfo() {
        if (this.gameState.deck) {
            this.cardsLeft.textContent = this.gameState.deck.length;
            if (this.gameState.roundNumber) {
                this.currentRound.textContent = this.gameState.roundNumber;
            }
        }
    }

    updatePlayerHand() {
        this.handCards.innerHTML = '';
        
        if (!this.gameState.players[this.playerNumber]) {
            // No player data - reset displays
            this.uniqueCount.textContent = '0';
            this.totalValue.textContent = '0';
            return;
        }
        
        const playerCards = this.gameState.players[this.playerNumber].cards || [];
        
        // Calculate unique values and total
        const uniqueValues = new Set(playerCards.map(card => card.value));
        const totalValue = playerCards.reduce((sum, card) => sum + card.value, 0);
        
        this.uniqueCount.textContent = uniqueValues.size;
        this.totalValue.textContent = totalValue;

        playerCards.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.innerHTML = this.renderCard(card);
            this.handCards.appendChild(cardElement.firstChild);
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

    updateActionButtons() {
        const player = this.gameState.players[this.playerNumber];
        const isMyTurn = this.gameState.currentPlayer === this.playerNumber;
        const canAct = isMyTurn && player && player.status === 'playing' && this.gameState.roundInProgress;
        
        this.drawBtn.disabled = !canAct;
        this.stickBtn.disabled = !canAct || !player.hasDrawnFirstCard;
        
        if (isMyTurn && canAct) {
            if (!player.hasDrawnFirstCard) {
                this.drawBtn.textContent = 'Draw First Card';
                this.stickBtn.textContent = 'Stick (Must draw first)';
            } else {
                this.drawBtn.textContent = 'Twist (Draw Card)';
                this.stickBtn.textContent = 'Stick';
            }
        }
    }

    renderCard(card) {
        return `
            <div class="card">
                <span class="card-center">${card.value}</span>
            </div>
        `;
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