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
        this.deckStack = document.getElementById('deck-stack');
        this.discardCount = document.getElementById('discard-count');
        this.discardStack = document.getElementById('discard-stack');
        this.currentRound = document.getElementById('current-round');
        this.cardsLeft = document.getElementById('cards-left');
        this.drawBtn = document.getElementById('draw-btn');
        this.stickBtn = document.getElementById('stick-btn');
        this.handCards = document.getElementById('hand-cards');
        this.uniqueCount = document.getElementById('unique-count');
        this.totalValue = document.getElementById('total-value');
        this.currentTurn = document.getElementById('current-turn');
        this.gameMessage = document.getElementById('game-message');
        this.leaderInfo = document.getElementById('leader-info');

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

        this.socket.on('deck-replenished', (data) => {
            this.showMessage(`📚 Discard pile shuffled into new draw pile! (${data.newDeckSize} cards)`, 'info');
        });

        this.socket.on('game-restarted', () => {
            this.showMessage('Game restarted by admin', 'info');
            this.startGameBtn.style.display = 'inline-block';
            this.startGameBtn.textContent = 'Start Game';
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
            
            // Sort results by total points for display
            const sortedResults = [...data.results].sort((a, b) => b.totalPoints - a.totalPoints);
            
            sortedResults.forEach(result => {
                message += `${result.playerName}: +${result.roundPoints} pts (Total: ${result.totalPoints}) [${result.status}]\n`;
            });
            
            if (data.gameComplete) {
                message += `\n🎉 GAME COMPLETE! 🎉\n`;
                data.winners.forEach(winner => {
                    message += `Winner: ${winner.playerName} with ${winner.totalPoints} points!\n`;
                });
                this.startRoundBtn.style.display = 'none';
                this.startGameBtn.style.display = 'inline-block';
                this.startGameBtn.textContent = 'Start New Game';
            } else {
                const playersAt200Plus = sortedResults.filter(r => r.totalPoints >= 200);
                if (playersAt200Plus.length > 0) {
                    const topScore = playersAt200Plus[0].totalPoints;
                    const leaders = playersAt200Plus.filter(r => r.totalPoints === topScore);
                    if (leaders.length > 1) {
                        message += `\n🔥 TIE at ${topScore} points! Continue playing to break the tie.\n`;
                    }
                }
                
                if (data.nextRoundStarter) {
                    message += `\nNext round starts with: ${data.nextRoundStarter.playerName} (#${data.nextRoundStarter.playerNumber})`;
                }
                this.startRoundBtn.style.display = 'inline-block';
            }
            
            this.showMessage(message, data.gameComplete ? 'success' : 'info');
        });

        this.socket.on('game-completed', (data) => {
            let message = '🏆 FINAL RESULTS 🏆\n\n';
            data.winners.forEach(winner => {
                message += `🥇 ${winner.playerName}: ${winner.totalPoints} points\n`;
            });
            message += '\nFinal Standings:\n';
            data.finalScores.forEach((player, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                message += `${medal} ${player.playerName}: ${player.totalPoints} points\n`;
            });
            
            this.showMessage(message, 'success');
            
            // Highlight winners in the player list
            setTimeout(() => {
                data.winners.forEach(winner => {
                    const playerItems = Array.from(this.playersList.children);
                    playerItems.forEach(item => {
                        const playerNumber = item.querySelector('.player-number').textContent;
                        if (parseInt(playerNumber) === winner.playerNumber) {
                            item.classList.add('game-winner');
                        }
                    });
                });
            }, 100);
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
            this.startGameBtn.textContent = 'Start Game';
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
            this.deckCount.textContent = '0 cards';
            this.deckStack.innerHTML = '';
            this.currentRound.textContent = '1';
            this.uniqueCount.textContent = '0';
            this.totalValue.textContent = '0';
            this.leaderInfo.textContent = 'No leader yet';
            this.drawBtn.disabled = true;
            this.stickBtn.disabled = true;
            return;
        }

        this.updatePlayersList(); // This now includes leader info update
        this.updateDeckInfo();
        
        if (this.playerNumber && this.gameState.players[this.playerNumber]) {
            this.updatePlayerHand();
            this.updateActionButtons();
        }
        
        this.updateTurnIndicator();
    }

    updatePlayersList() {
        this.playersList.innerHTML = '';
        
        // Sort by player number (sequential order)
        const playersByNumber = Object.entries(this.gameState.players)
            .sort(([a], [b]) => parseInt(a) - parseInt(b));

        // Create ranking based on points (descending)
        const playerRankings = Object.entries(this.gameState.players)
            .map(([num, player]) => ({
                playerNumber: num,
                points: player.points || 0
            }))
            .sort((a, b) => b.points - a.points);

        // Create ranking map with tied players getting same rank
        const rankingMap = new Map();
        let currentRank = 1;
        for (let i = 0; i < playerRankings.length; i++) {
            const player = playerRankings[i];
            if (i > 0 && playerRankings[i-1].points !== player.points) {
                currentRank = i + 1;
            }
            rankingMap.set(player.playerNumber, currentRank);
        }

        const highestScore = playerRankings.length > 0 ? playerRankings[0].points : 0;
        const playersAt200Plus = playerRankings.filter(p => p.points >= 200);

        // Function to get ranking emoji and text
        const getRankingDisplay = (rank, totalPlayers) => {
            if (totalPlayers === 1) return { emoji: '👤', text: '' };
            
            switch (rank) {
                case 1: return { emoji: '👑', text: '1st' };
                case 2: return { emoji: '🥈', text: '2nd' };
                case 3: return { emoji: '🥉', text: '3rd' };
                case 4: return { emoji: '🏅', text: '4th' };
                case 5: return { emoji: '⭐', text: '5th' };
                default: return { emoji: '📍', text: `${rank}th` };
            }
        };

        playersByNumber.forEach(([playerNumber, player]) => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';
            
            if (parseInt(playerNumber) === this.gameState.currentPlayer) {
                playerItem.classList.add('current-turn');
            }
            
            if (!player.connected) {
                playerItem.classList.add('disconnected');
            }

            // Highlight leaders and players at target
            const playerPoints = player.points || 0;
            if (playerPoints === highestScore && highestScore > 0) {
                playerItem.classList.add('leader');
            }
            if (playerPoints >= 200) {
                playerItem.classList.add('at-target');
            }

            const statusClass = `status-${player.status || 'waiting'}`;
            
            // Get ranking display
            const playerRank = rankingMap.get(playerNumber) || playersByNumber.length;
            const rankDisplay = getRankingDisplay(playerRank, playersByNumber.length);
            
            playerItem.innerHTML = `
                <span class="player-number">${playerNumber}</span>
                <span class="player-name">${player.name}</span>
                <span class="ranking-display" title="Current ranking">
                    <span class="rank-emoji">${rankDisplay.emoji}</span>
                    <span class="rank-text">${rankDisplay.text}</span>
                </span>
                <span class="card-count">${player.cards.length}</span>
                <span class="player-points">${playerPoints}pts</span>
                <span class="status-indicator ${statusClass}">${player.status || 'waiting'}</span>
            `;

            this.playersList.appendChild(playerItem);
        });

        // Update leader info - convert playerRankings back to sortedPlayers format for compatibility
        const sortedPlayers = playerRankings.map(p => [p.playerNumber, this.gameState.players[p.playerNumber]]);
        this.updateLeaderInfo(sortedPlayers, playersAt200Plus);
    }

    updateLeaderInfo(sortedPlayers, playersAt200Plus) {
        if (sortedPlayers.length === 0) {
            this.leaderInfo.textContent = 'No players';
            return;
        }

        const leader = sortedPlayers[0][1];
        const leaderPoints = leader.points || 0;
        
        if (playersAt200Plus.length > 0) {
            const topScore = playersAt200Plus[0].points;
            const winners = playersAt200Plus.filter(p => p.points === topScore);
            
            if (winners.length === 1) {
                const winnerPlayer = this.gameState.players[winners[0].playerNumber];
                this.leaderInfo.innerHTML = `🏆 ${winnerPlayer.name}: ${topScore} pts<br><small>Game should end!</small>`;
            } else {
                this.leaderInfo.innerHTML = `🔥 ${winners.length}-way tie at ${topScore} pts<br><small>Continue until tie broken</small>`;
            }
        } else {
            const pointsNeeded = 200 - leaderPoints;
            this.leaderInfo.innerHTML = `👑 ${leader.name}: ${leaderPoints} pts<br><small>${pointsNeeded} to target</small>`;
        }
    }

    updateDeckInfo() {
        const cardsRemaining = this.gameState.deck ? this.gameState.deck.length : 0;
        const discardCount = this.gameState.discardPile ? this.gameState.discardPile.length : 0;
        
        // Update text counters
        this.cardsLeft.textContent = cardsRemaining;
        
        if (this.deckCount) {
            this.deckCount.textContent = `${cardsRemaining} card${cardsRemaining !== 1 ? 's' : ''}`;
        }
        
        if (this.discardCount) {
            this.discardCount.textContent = `${discardCount} card${discardCount !== 1 ? 's' : ''}`;
        }
        
        // Update round number
        if (this.gameState.roundNumber) {
            this.currentRound.textContent = this.gameState.roundNumber;
        }
        
        // Create visual card stacks
        if (this.deckStack) {
            this.updateDeckStack(cardsRemaining);
        }
        
        if (this.discardStack) {
            this.updateDiscardStack(discardCount);
        }
    }

    updateDeckStack(cardCount) {
        // Clear existing stack
        this.deckStack.innerHTML = '';
        
        if (cardCount === 0) {
            // Show empty deck message
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-deck';
            emptyMessage.textContent = 'Empty';
            emptyMessage.style.cssText = `
                color: #666;
                font-style: italic;
                text-align: center;
                margin-top: 40px;
            `;
            this.deckStack.appendChild(emptyMessage);
            return;
        }
        
        // Calculate how many visual cards to show (max 10 for performance)
        const maxVisualCards = 10;
        const visualCardCount = Math.min(cardCount, maxVisualCards);
        
        // Calculate spacing based on available height and number of cards
        const maxHeight = 100; // Available height in pixels
        const cardThickness = Math.min(3, maxHeight / Math.max(visualCardCount, 1));
        
        // Create visual cards
        for (let i = 0; i < visualCardCount; i++) {
            const cardElement = document.createElement('div');
            cardElement.className = 'deck-stack-card';
            
            // Position cards with slight offset for 3D effect
            const bottomOffset = i * cardThickness;
            const horizontalOffset = i * 0.5; // Slight horizontal offset
            
            cardElement.style.cssText = `
                bottom: ${bottomOffset}px;
                left: ${horizontalOffset}px;
                z-index: ${maxVisualCards - i};
            `;
            
            this.deckStack.appendChild(cardElement);
        }
        
        // Add indicator if there are more cards than visual representation
        if (cardCount > maxVisualCards) {
            const moreIndicator = document.createElement('div');
            moreIndicator.textContent = `+${cardCount - maxVisualCards}`;
            moreIndicator.style.cssText = `
                position: absolute;
                top: -5px;
                right: -5px;
                background: #ff6b35;
                color: white;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                font-size: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                z-index: ${maxVisualCards + 1};
            `;
            this.deckStack.appendChild(moreIndicator);
        }
    }

    updateDiscardStack(cardCount) {
        // Clear existing stack
        this.discardStack.innerHTML = '';
        
        if (cardCount === 0) {
            // Show empty discard message
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-discard';
            emptyMessage.textContent = 'Empty';
            emptyMessage.style.cssText = `
                color: #666;
                font-style: italic;
                text-align: center;
                margin-top: 40px;
            `;
            this.discardStack.appendChild(emptyMessage);
            return;
        }
        
        // Calculate how many visual cards to show (max 10 for performance)
        const maxVisualCards = 10;
        const visualCardCount = Math.min(cardCount, maxVisualCards);
        
        // Calculate spacing based on available height and number of cards
        const maxHeight = 100; // Available height in pixels
        const cardThickness = Math.min(3, maxHeight / Math.max(visualCardCount, 1));
        
        // Create visual cards (different style for discard pile)
        for (let i = 0; i < visualCardCount; i++) {
            const cardElement = document.createElement('div');
            cardElement.className = 'deck-stack-card discard-card';
            
            // Position cards with slight offset for 3D effect
            const bottomOffset = i * cardThickness;
            const horizontalOffset = i * 0.5; // Slight horizontal offset
            
            cardElement.style.cssText = `
                bottom: ${bottomOffset}px;
                left: ${horizontalOffset}px;
                z-index: ${maxVisualCards - i};
                background: linear-gradient(135deg, #654321, #8b4513);
                border-color: #4a2c17;
            `;
            
            this.discardStack.appendChild(cardElement);
        }
        
        // Add indicator if there are more cards than visual representation
        if (cardCount > maxVisualCards) {
            const moreIndicator = document.createElement('div');
            moreIndicator.textContent = `+${cardCount - maxVisualCards}`;
            moreIndicator.style.cssText = `
                position: absolute;
                top: -5px;
                right: -5px;
                background: #8b4513;
                color: white;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                font-size: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                z-index: ${maxVisualCards + 1};
            `;
            this.discardStack.appendChild(moreIndicator);
        }
    }

    updatePlayerHand() {
        if (!this.handCards) {
            console.error('handCards element not found');
            return;
        }
        
        this.handCards.innerHTML = '';
        
        if (!this.gameState.players[this.playerNumber]) {
            // No player data - reset displays
            if (this.uniqueCount) this.uniqueCount.textContent = '0';
            if (this.totalValue) this.totalValue.textContent = '0';
            return;
        }
        
        const playerCards = this.gameState.players[this.playerNumber].cards || [];
        
        // Calculate unique values and total
        const uniqueValues = new Set(playerCards.map(card => card.value));
        const totalValue = playerCards.reduce((sum, card) => sum + card.value, 0);
        
        if (this.uniqueCount) this.uniqueCount.textContent = uniqueValues.size;
        if (this.totalValue) this.totalValue.textContent = totalValue;

        // Count occurrences of each value to identify duplicates
        const valueCounts = {};
        playerCards.forEach(card => {
            valueCounts[card.value] = (valueCounts[card.value] || 0) + 1;
        });

        playerCards.forEach((card, index) => {
            try {
                const cardHTML = this.renderCard(card);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = cardHTML.trim();
                const actualCard = tempDiv.firstElementChild;
                
                if (!actualCard) {
                    console.error('Failed to create card element for:', card, 'HTML:', cardHTML);
                    return;
                }
                
                // Mark duplicates with special styling
                if (valueCounts[card.value] > 1) {
                    actualCard.classList.add('duplicate-card');
                    actualCard.title = `Duplicate value ${card.value} (${valueCounts[card.value]} cards)`;
                }
                
                // Add animation delay for newly drawn cards
                actualCard.style.animationDelay = `${index * 0.1}s`;
                actualCard.classList.add('card-appear');
                
                this.handCards.appendChild(actualCard);
            } catch (error) {
                console.error('Error creating card:', error, card);
            }
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
        this.stickBtn.disabled = !canAct || (player && !player.hasDrawnFirstCard);
        
        if (isMyTurn && canAct) {
            if (!player.hasDrawnFirstCard) {
                this.drawBtn.textContent = 'Draw First Card';
                this.stickBtn.textContent = 'Stick (Must draw first)';
            } else {
                this.drawBtn.textContent = 'Twist (Draw Card)';
                this.stickBtn.textContent = 'Stick';
            }
        } else {
            // Reset button text when not player's turn
            this.drawBtn.textContent = 'Draw Card';
            this.stickBtn.textContent = 'Stick';
        }
    }

    renderCard(card) {
        // Generate a consistent color based on card value
        const colorClass = this.getCardColorClass(card.value);
        const suitSymbol = this.getCardSuit(card.value);
        
        return `
            <div class="card ${colorClass}" data-value="${card.value}">
                <div class="card-corner card-corner-top">
                    <div class="card-rank">${card.value}</div>
                    <div class="card-suit">${suitSymbol}</div>
                </div>
                <div class="card-center">
                    <div class="card-value-large">${card.value}</div>
                    <div class="card-suit-large">${suitSymbol}</div>
                </div>
                <div class="card-corner card-corner-bottom">
                    <div class="card-rank">${card.value}</div>
                    <div class="card-suit">${suitSymbol}</div>
                </div>
            </div>
        `;
    }

    getCardColorClass(value) {
        // Alternate colors for visual variety while maintaining game logic
        if (value <= 3) return 'red-card';
        if (value <= 6) return 'black-card';
        if (value <= 9) return 'red-card';
        return 'black-card';
    }

    getCardSuit(value) {
        // Assign suit symbols based on value for visual variety
        if (value <= 3) return '♥'; // Hearts (red)
        if (value <= 6) return '♠'; // Spades (black)
        if (value <= 9) return '♦'; // Diamonds (red)
        return '♣'; // Clubs (black)
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