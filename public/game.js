class Flip7Game {
    constructor() {
        this.socket = io();
        this.playerNumber = null;
        this.playerName = null;
        this.gameState = null;
        this.isMyTurn = false;
        this.animatingCard = null; // Track cards currently being animated
        
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
        // handCards element removed - cards now displayed in main players table
        this.currentTurn = document.getElementById('current-turn');
        this.gameMessage = document.getElementById('game-message');
        this.leaderInfo = document.getElementById('leader-info');

        // Admin panel elements
        this.adminPassword = document.getElementById('admin-password');
        this.restartGameBtn = document.getElementById('restart-game-btn');
        this.dropPlayerNumber = document.getElementById('drop-player-number');
        this.dropPlayerBtn = document.getElementById('drop-player-btn');
        this.kickAllRestartBtn = document.getElementById('kick-all-restart-btn');

        // Track if we're showing a persistent round summary
        this.showingRoundSummary = false;
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
            // Clear any persistent round summary when new round starts
            this.showingRoundSummary = false;
            
            // Animate cards flying to discard pile if not the first round
            if (data.roundNumber > 1) {
                this.animateCardsToDiscard();
            }
            
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
            this.showingRoundSummary = false;
            this.showMessage('Game restarted by admin', 'info');
            this.startGameBtn.style.display = 'inline-block';
            this.startGameBtn.textContent = 'Start Game';
            this.startRoundBtn.style.display = 'none';
        });

        this.socket.on('card-drawn', (data) => {
            console.log('===== CARD-DRAWN EVENT =====');
            console.log('Card drawn event received:', data);
            console.log('Current player number:', this.playerNumber);
            console.log('Drawing player number:', data.playerNumber);
            console.log('Is my turn?', data.playerNumber === this.playerNumber);
            
            // For the drawing player, animate first then update display
            if (data.playerNumber === this.playerNumber) {
                console.log('Card drawn by current player, triggering animation');
                console.log('Card drawn data:', data);
                this.showMessage(`You drew: ${data.card.value}`, 'info');
                
                // Check if we're already animating (to prevent conflicts with flip-seven event)
                if (this.animatingCard) {
                    console.log('Already animating a card, skipping this animation');
                    this.updateGameDisplay();
                    return;
                }
                
                // Store the card data for animation (even if it might be a bust)
                this.animatingCard = {
                    playerNumber: data.playerNumber,
                    card: data.card,
                    isBustCard: data.isBust || false, // Track if this might be a bust card
                    isFlip7: data.isFlip7 || false // Track if this is the 7th card
                };
                
                // Update display first (without the animating card)
                this.updateGameDisplay();
                
                // Add a small delay to ensure DOM is fully updated before measuring positions
                setTimeout(() => {
                    console.log('Starting animation after DOM update delay');
                    this.animateCardToHandWithFlip(data.playerNumber, data.card, () => {
                        console.log('Animation completed, showing card');
                        // Clear the animating card flag and update display to show all cards
                        this.animatingCard = null;
                        this.updateGameDisplay();
                        
                        // If this was a flip 7 card, we might need to trigger celebration
                        if (data.isFlip7) {
                            console.log('This was a flip 7 card, celebration should follow');
                        }
                    });
                }, 50);
            } else {
                // For other players, update display to show deck changes but no animation
                this.updateGameDisplay();
                this.showMessage(`${data.playerName} drew a card${data.isFirstCard ? ' (first card)' : ''}`, 'info');
            }
        });

        this.socket.on('player-stuck', (data) => {
            this.showMessage(`${data.playerName} stuck with ${data.handValue} points`, 'info');
        });

        this.socket.on('player-bust', (data) => {
            console.log('Player bust event received:', data);
            
            // If it's the current player who went bust, trigger animation for the bust card
            if (data.playerNumber === this.playerNumber) {
                console.log('Current player went bust, triggering bust card animation');
                
                // Set up animation for the bust card
                this.animatingCard = {
                    playerNumber: data.playerNumber,
                    card: data.drawnCard
                };
                
                // Update display without the bust card first
                this.updateGameDisplay();
                
                // Animate the bust card, then show it briefly before it gets discarded
                setTimeout(() => {
                    this.animateCardToHandWithFlip(data.playerNumber, data.drawnCard, () => {
                        console.log('Bust card animation completed');
                        // Clear the animating card flag and update to show the bust card briefly
                        this.animatingCard = null;
                        this.updateGameDisplay();
                        
                        // Then after a short delay, trigger the discard animation and update again
                        setTimeout(() => {
                            // The bust card should be discarded, so update display again
                            this.updateGameDisplay();
                        }, 1000);
                    });
                }, 50);
            }
            
            this.showMessage(`${data.playerName} went BUST! Drew duplicate value ${data.drawnCard.value}`, 'error');
        });

        this.socket.on('flip-seven', (data) => {
            console.log('===== FLIP-SEVEN EVENT =====');
            console.log('Flip 7 event received:', data);
            console.log('Current player number:', this.playerNumber);
            console.log('Flip 7 player number:', data.playerNumber);
            console.log('Is my flip 7?', data.playerNumber === this.playerNumber);
            console.log('Has drawnCard data?', !!data.drawnCard);
            
            // If it's the current player who got Flip 7, try to animate the 7th card
            if (data.playerNumber === this.playerNumber) {
                console.log('Current player got Flip 7, attempting animation');
                
                // Get the player's cards to find the 7th card (most recent)
                const player = this.gameState.players[data.playerNumber];
                if (player && player.cards && player.cards.length >= 7) {
                    const seventhCard = player.cards[player.cards.length - 1]; // Last card should be the 7th
                    console.log('Found 7th card for animation:', seventhCard);
                    
                    // Set up animation for the 7th card
                    this.animatingCard = {
                        playerNumber: data.playerNumber,
                        card: seventhCard,
                        isFlip7Card: true
                    };
                    
                    // Update display without the 7th card first
                    this.updateGameDisplay();
                    
                    // Animate the 7th card
                    setTimeout(() => {
                        this.animateCardToHandWithFlip(data.playerNumber, seventhCard, () => {
                            console.log('Flip 7 card animation completed');
                            // Clear the animating card flag and update to show the 7th card
                            this.animatingCard = null;
                            this.updateGameDisplay();
                            
                            // Add celebration effect after card appears
                            this.triggerFlip7Celebration(data);
                        });
                    }, 50);
                } else {
                    console.log('Could not find 7th card for animation, using fallback');
                    this.updateGameDisplay();
                    this.triggerFlip7Celebration(data);
                }
            } else {
                // For other players, just update display
                this.updateGameDisplay();
                this.triggerFlip7Celebration(data);
            }
            
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
            
            // Make round summary persistent (stays until Start Next Round is pressed)
            const isPersistent = !data.gameComplete;
            this.showMessage(message, data.gameComplete ? 'success' : 'info', isPersistent);
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
        // Clear the persistent round summary
        if (this.showingRoundSummary) {
            this.gameMessage.innerHTML = '';
            this.showingRoundSummary = false;
        }
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
            // handCards element no longer exists - cards shown in players table
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

    // Helper function to calculate hand stats for any player
    calculateHandStats(cards) {
        if (!cards || cards.length === 0) {
            return { uniqueCount: 0, handValue: 0 };
        }
        
        const uniqueValues = new Set(cards.map(card => card.value));
        const totalValue = cards.reduce((sum, card) => sum + card.value, 0);
        
        return {
            uniqueCount: uniqueValues.size,
            handValue: totalValue
        };
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
            const playerRow = document.createElement('tr');
            playerRow.className = 'player-row';
            
            if (parseInt(playerNumber) === this.gameState.currentPlayer) {
                playerRow.classList.add('current-turn');
            }
            
            if (!player.connected) {
                playerRow.classList.add('disconnected');
            }

            // Highlight leaders and players at target
            const playerPoints = player.points || 0;
            if (playerPoints === highestScore && highestScore > 0) {
                playerRow.classList.add('leader');
            }
            if (playerPoints >= 200) {
                playerRow.classList.add('at-target');
            }

            const statusClass = `status-${player.status || 'waiting'}`;
            
            // Get ranking display
            const playerRank = rankingMap.get(playerNumber) || playersByNumber.length;
            const rankDisplay = getRankingDisplay(playerRank, playersByNumber.length);
            
            // Generate hand cards HTML and calculate stats
            const handCardsHTML = this.generatePlayerHandHTML(player.cards || [], playerNumber);
            const handStats = this.calculateHandStats(player.cards || []);
            
            playerRow.innerHTML = `
                <td class="rank-cell">
                    <span class="rank-emoji">${rankDisplay.emoji}</span>
                    <span class="rank-text">${rankDisplay.text}</span>
                </td>
                <td class="player-cell">
                    <span class="player-number">${playerNumber}</span>
                    <span class="player-name">${player.name}</span>
                </td>
                <td class="card-count-cell">${player.cards.length}</td>
                <td class="unique-cell">${handStats.uniqueCount}</td>
                <td class="hand-value-cell">${handStats.handValue}</td>
                <td class="points-cell">${playerPoints}pts</td>
                <td class="status-cell">
                    <span class="status-indicator ${statusClass}">${player.status || 'waiting'}</span>
                </td>
                <td class="hand-cell">
                    <div class="player-hand-display">${handCardsHTML}</div>
                </td>
            `;

            this.playersList.appendChild(playerRow);
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
        
        console.log(`Updating deck info: ${cardsRemaining} cards remaining, ${discardCount} discarded`);
        
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
        console.log(`Updating deck stack with ${cardCount} cards`);
        
        // Clear existing stack
        this.deckStack.innerHTML = '';
        
        if (cardCount === 0) {
            console.log('Deck is empty, showing empty message');
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
        console.log(`Creating ${visualCardCount} visual cards for deck stack`);
        for (let i = 0; i < visualCardCount; i++) {
            const cardElement = document.createElement('div');
            cardElement.className = 'deck-stack-card';
            
            this.deckStack.appendChild(cardElement);
        }
        console.log(`Deck stack now has ${this.deckStack.children.length} visual elements`);
        
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

    // Enhanced animation function for card flying from deck to hand with flip
    animateCardToHandWithFlip(targetPlayerNumber, drawnCard, onComplete) {
        if (!this.deckStack) {
            console.log('Deck stack element not found');
            onComplete();
            return;
        }

        // Check if deck has any cards to animate from
        let topCard = this.deckStack.querySelector('.deck-stack-card:last-child');
        if (!topCard) {
            console.log('No visual cards in deck, creating temporary card for animation');
            topCard = document.createElement('div');
            topCard.className = 'deck-stack-card';
            this.deckStack.appendChild(topCard);
        }

        // Find the target player's hand display to get the exact landing position
        let targetHandDisplay = null;
        const allRows = document.querySelectorAll('#players-table tr.player-row');
        for (const row of allRows) {
            const playerNumElement = row.querySelector('.player-number');
            if (playerNumElement && playerNumElement.textContent.trim() === targetPlayerNumber.toString()) {
                targetHandDisplay = row.querySelector('.player-hand-display');
                break;
            }
        }

        if (!targetHandDisplay) {
            console.log(`No hand display found for player ${targetPlayerNumber}`);
            onComplete();
            return;
        }

        // Calculate where the new card will appear in the hand (at the end)
        const handRect = targetHandDisplay.getBoundingClientRect();
        
        // Get currently visible cards (filtered, without the animating card)
        const visibleCards = targetHandDisplay.querySelectorAll('.mini-card');
        
        let targetX, targetY;
        
        if (visibleCards.length === 0) {
            // First card: position at the start of the hand area
            targetX = handRect.left + 40; // cardWidth/2
            targetY = handRect.top + 56; // cardHeight/2
        } else {
            // Debug: Let's see what cards are currently visible
            const currentVisibleCards = targetHandDisplay.querySelectorAll('.mini-card');
            console.log(`Before calculation: ${currentVisibleCards.length} visible cards`);
            currentVisibleCards.forEach((card, i) => {
                const rect = card.getBoundingClientRect();
                console.log(`Card ${i}: left=${rect.left}, right=${rect.right}, top=${rect.top}`);
            });
            
            // Get the player's current card count from game state
            const player = this.gameState.players[targetPlayerNumber];
            const totalCards = player ? player.cards.length : 0;
            console.log(`Player ${targetPlayerNumber} has ${totalCards} total cards in game state`);
            console.log(`Cards in game state:`, player ? player.cards.map(c => c.value) : 'no player data');
            
            // Simple approach: position next to the rightmost visible card
            if (currentVisibleCards.length > 0) {
                const lastVisibleCard = currentVisibleCards[currentVisibleCards.length - 1];
                const lastRect = lastVisibleCard.getBoundingClientRect();
                
                // Position directly to the right with the same spacing as between existing cards
                let spacing = 82; // default card width + gap
                if (currentVisibleCards.length >= 2) {
                    const secondLastCard = currentVisibleCards[currentVisibleCards.length - 2];
                    const secondLastRect = secondLastCard.getBoundingClientRect();
                    spacing = lastRect.left - secondLastRect.left; // actual spacing between cards
                    console.log(`Measured spacing between cards: ${spacing}px`);
                }
                
                targetX = lastRect.left + spacing;
                targetY = lastRect.top + (lastRect.height / 2);
                
                console.log(`Positioning next to last visible card: targetX=${targetX}, targetY=${targetY}`);
            } else {
                // First card position
                targetX = handRect.left + 40;
                targetY = handRect.top + 56;
                console.log(`First card position: targetX=${targetX}, targetY=${targetY}`);
            }
        }
        
        console.log(`Card position calculation: visibleCards=${visibleCards.length}, target=(${targetX}, ${targetY})`)

        // Clone the card for animation
        const flyingCard = topCard.cloneNode(true);
        flyingCard.classList.remove('deck-stack-card');
        flyingCard.classList.add('card-flying-to-hand-flip');
        
        // Get deck position for starting point
        const deckRect = this.deckStack.getBoundingClientRect();
        const startX = deckRect.left + deckRect.width / 2;
        const startY = deckRect.top + deckRect.height / 2;
        
        // Set initial position and styling
        flyingCard.style.cssText = `
            position: fixed;
            left: ${startX - 40}px;
            top: ${startY - 56}px;
            width: 80px;
            height: 112px;
            z-index: 2000;
            background: linear-gradient(135deg, #1e3c72, #2a5298);
            border: 2px solid #333;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            color: white;
            box-shadow: 0 8px 16px rgba(0,0,0,0.5);
            transform: rotateY(0deg);
            transition: all 0.8s ease-in-out;
        `;

        // Start with card back
        flyingCard.innerHTML = '<span style="font-size: 2rem;">🂠</span>';
        document.body.appendChild(flyingCard);

        // Animate to target position with flip
        setTimeout(() => {
            flyingCard.style.left = `${targetX - 40}px`;
            flyingCard.style.top = `${targetY - 56}px`;
            flyingCard.style.transform = `rotateY(180deg)`;
        }, 50);

        // Flip to show card face at midpoint
        setTimeout(() => {
            const colorClass = this.getCardColorClass(drawnCard.value);
            const suitSymbol = this.getCardSuit(drawnCard.value);
            flyingCard.style.background = 'linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%)';
            flyingCard.style.color = colorClass === 'red-card' ? '#e74c3c' : '#2c3e50';
            flyingCard.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <div style="font-size: 1.25rem; line-height: 1;">${drawnCard.value}</div>
                    <div style="font-size: 1rem; line-height: 1;">${suitSymbol}</div>
                </div>
            `;
        }, 400);

        // Complete animation and update display
        setTimeout(() => {
            flyingCard.remove();
            onComplete();
        }, 800);

        console.log(`Card animation: deck at (${startX}, ${startY}) → hand at (${targetX}, ${targetY})`);
    }

    // Animation function for card flying from deck to hand
    animateCardToHand(targetPlayerNumber = null) {
        // First ensure deck has visual cards
        if (!this.deckStack) {
            console.log('Deck stack element not found');
            return;
        }

        // Check if deck has any cards to animate from
        let topCard = this.deckStack.querySelector('.deck-stack-card:last-child');
        
        if (!topCard) {
            // If no cards visible, create a temporary one for animation
            console.log('No visual cards in deck, creating temporary card for animation');
            topCard = document.createElement('div');
            topCard.className = 'deck-stack-card';
            this.deckStack.appendChild(topCard);
        }

        // Clone the card for animation
        const flyingCard = topCard.cloneNode(true);
        flyingCard.classList.remove('deck-stack-card');
        flyingCard.classList.add('card-flying-to-hand');
        
        // Get deck position for starting point
        const deckRect = this.deckStack.getBoundingClientRect();
        
        // Get target position (specific player's hand column in the table)
        let playerRow = null;
        
        if (targetPlayerNumber) {
            // Find the specific player's row by looking for their player number
            const allRows = document.querySelectorAll('#players-table tr.player-row');
            for (const row of allRows) {
                const playerNumElement = row.querySelector('.player-number');
                if (playerNumElement && playerNumElement.textContent.trim() === targetPlayerNumber.toString()) {
                    playerRow = row.querySelector('.hand-cell');
                    break;
                }
            }
        } else {
            // Fallback to current-turn player
            playerRow = document.querySelector(`#players-table tr.current-turn .hand-cell`);
        }
        
        let targetX = window.innerWidth * 0.8; // fallback position
        let targetY = window.innerHeight * 0.3;
        
        if (playerRow) {
            const handRect = playerRow.getBoundingClientRect();
            targetX = handRect.left + handRect.width / 2;
            targetY = handRect.top + handRect.height / 2;
            console.log(`Animation target: player ${targetPlayerNumber || 'current'} hand cell at (${targetX}, ${targetY})`);
        } else {
            console.log(`No hand cell found for player ${targetPlayerNumber || 'current'}, using fallback position`);
        }
        
        // Calculate the trajectory
        const deltaX = targetX - (deckRect.left + 10);
        const deltaY = targetY - (deckRect.top + 10);
        console.log(`Card animation: deck at (${deckRect.left + 10}, ${deckRect.top + 10}) → hand at (${targetX}, ${targetY}), delta (${deltaX}, ${deltaY})`);
        
        // Style the flying card with CSS variables for animation endpoint
        flyingCard.style.cssText = `
            position: fixed;
            left: ${deckRect.left + 10}px;
            top: ${deckRect.top + 10}px;
            width: 80px;
            height: 112px;
            z-index: 2000;
            background: linear-gradient(135deg, #1e3c72, #2a5298);
            border: 2px solid #333;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            color: white;
            box-shadow: 0 8px 16px rgba(0,0,0,0.5);
            transform: rotateX(5deg) rotateY(-2deg);
            --target-x: ${deltaX}px;
            --target-y: ${deltaY}px;
        `;
        
        // Add card back symbol
        flyingCard.innerHTML = '<span style="font-size: 2rem;">🂠</span>';
        
        document.body.appendChild(flyingCard);
        console.log('Flying card created and added to DOM');

        // Remove the original top card immediately to show deck reduction
        setTimeout(() => {
            if (topCard.parentNode) {
                topCard.remove();
            }
        }, 50);
        
        // Remove flying card after animation completes
        setTimeout(() => {
            if (flyingCard.parentNode) {
                flyingCard.remove();
                console.log('Flying card animation completed and removed');
            }
        }, 1200);
    }

    // Animation function for cards flying from hand to discard pile at round end
    animateCardsToDiscard() {
        if (!this.gameState || !this.gameState.players[this.playerNumber]) return;
        
        const playerCards = this.gameState.players[this.playerNumber].cards || [];
        if (playerCards.length === 0) return;

        // Animate each card with a slight delay
        playerCards.forEach((card, index) => {
            setTimeout(() => {
                this.createFlyingCardToDiscard(card, index);
            }, index * 100); // 100ms delay between each card
        });
    }

    createFlyingCardToDiscard(card, index) {
        // Create a flying card element
        const flyingCard = document.createElement('div');
        flyingCard.classList.add('card-flying-to-discard');
        
        // Get the rendered card appearance
        const cardHtml = this.renderCard(card);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHtml;
        const renderedCard = tempDiv.firstElementChild;
        
        // Get starting position from the player's row in the table
        const playerRow = document.querySelector(`#players-table tr.current-turn .hand-cell`);
        let startLeft = window.innerWidth * 0.7; // fallback
        let startTop = window.innerHeight * 0.3;
        
        if (playerRow) {
            const handRect = playerRow.getBoundingClientRect();
            startLeft = handRect.left + (index * 20);
            startTop = handRect.top + handRect.height / 2;
        }
        
        // Get target position (discard pile)
        const discardRect = this.discardStack.getBoundingClientRect();
        const targetX = discardRect.left + discardRect.width / 2;
        const targetY = discardRect.top + discardRect.height / 2;
        
        const deltaX = targetX - startLeft;
        const deltaY = targetY - startTop;
        
        flyingCard.style.cssText = `
            position: fixed;
            left: ${startLeft}px;
            top: ${startTop}px;
            width: 80px;
            height: 112px;
            z-index: 1000;
            background: ${renderedCard ? renderedCard.style.background : 'linear-gradient(145deg, #fff 0%, #f0f0f0 100%)'};
            border: 2px solid #333;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            color: ${renderedCard ? renderedCard.style.color : '#333'};
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            --target-x: ${deltaX}px;
            --target-y: ${deltaY}px;
        `;
        
        if (renderedCard) {
            flyingCard.innerHTML = renderedCard.innerHTML;
        }
        
        document.body.appendChild(flyingCard);
        
        // Remove flying card after animation completes
        setTimeout(() => {
            if (flyingCard.parentNode) {
                flyingCard.remove();
            }
        }, 1000);
    }

    updatePlayerHand() {
        // Hand display is now integrated into the players table
        // This function is kept for compatibility but no longer manages a separate hand display
        if (!this.gameState || !this.gameState.players[this.playerNumber]) {
            return;
        }
        
        // The hand information is now displayed in the main players table
        // All hand rendering is handled by updatePlayersList()
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

    showMessage(message, type, isPersistent = false) {
        this.gameMessage.innerHTML = `<div class="message ${type}">${message}</div>`;
        
        if (isPersistent) {
            this.showingRoundSummary = true;
        } else {
            // Auto-clear message after 5 seconds (but not if showing round summary)
            setTimeout(() => {
                if (!this.showingRoundSummary && this.gameMessage.innerHTML.includes(message)) {
                    this.gameMessage.innerHTML = '';
                }
            }, 5000);
        }
    }

    triggerFlip7Celebration(data) {
        // Create celebration overlay
        const celebration = document.createElement('div');
        celebration.className = 'flip7-celebration';
        celebration.innerHTML = `
            <div class="celebration-content">
                <h1 class="celebration-title">🎉 FLIP 7! 🎉</h1>
                <div class="celebration-details">
                    <div class="player-name">${data.playerName}</div>
                    <div class="celebration-score">
                        <span class="hand-value">${data.handValue}</span>
                        <span class="bonus">+15 bonus</span>
                        <span class="equals">=</span>
                        <span class="total-points">${data.totalPoints} points!</span>
                    </div>
                    <div class="celebration-subtitle">7 unique card values!</div>
                </div>
            </div>
            <div class="confetti-container"></div>
        `;
        
        document.body.appendChild(celebration);
        
        // Add confetti effect
        this.createConfetti(celebration.querySelector('.confetti-container'));
        
        // Add special glow to player's row in table instead of handCards
        if (data.playerNumber === this.playerNumber) {
            const playerRow = document.querySelector(`#players-table tr.current-turn`);
            if (playerRow) {
                playerRow.classList.add('flip7-glow');
            }
        }
        
        // Remove celebration after 4 seconds
        setTimeout(() => {
            celebration.remove();
            const playerRow = document.querySelector(`#players-table tr.flip7-glow`);
            if (playerRow) {
                playerRow.classList.remove('flip7-glow');
            }
        }, 4000);
    }

    createConfetti(container) {
        const colors = ['#ff6b35', '#f7931e', '#ffd700', '#4CAF50', '#2196F3', '#9C27B0'];
        
        for (let i = 0; i < 50; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti-piece';
            confetti.style.cssText = `
                position: absolute;
                width: 10px;
                height: 10px;
                background-color: ${colors[Math.floor(Math.random() * colors.length)]};
                left: ${Math.random() * 100}%;
                animation: confetti-fall ${2 + Math.random() * 3}s linear forwards;
                animation-delay: ${Math.random() * 2}s;
            `;
            container.appendChild(confetti);
        }
    }

    generatePlayerHandHTML(cards, playerNumber) {
        if (!cards || cards.length === 0) {
            return '<span class="no-cards">No cards</span>';
        }

        // Filter out the animating card if this is the player who drew it
        let filteredCards = cards;
        if (this.animatingCard && 
            this.animatingCard.playerNumber === parseInt(playerNumber) && 
            cards.length > 0) {
            // Remove the last card (most recently drawn) during animation
            filteredCards = cards.slice(0, -1);
            if (filteredCards.length === 0) {
                return '<span class="no-cards">Drawing card...</span>';
            }
        }

        // Count occurrences of each value to identify duplicates
        const valueCounts = {};
        filteredCards.forEach(card => {
            valueCounts[card.value] = (valueCounts[card.value] || 0) + 1;
        });

        return filteredCards.map(card => {
            const colorClass = this.getCardColorClass(card.value);
            const suitSymbol = this.getCardSuit(card.value);
            const isDuplicate = valueCounts[card.value] > 1;
            
            return `
                <div class="mini-card ${colorClass} ${isDuplicate ? 'duplicate-card' : ''}" 
                     title="${isDuplicate ? `Duplicate value ${card.value}` : `${card.value} ${suitSymbol}`}">
                    <div class="mini-card-value">${card.value}</div>
                    <div class="mini-card-suit">${suitSymbol}</div>
                </div>
            `;
        }).join('');
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new Flip7Game();
});