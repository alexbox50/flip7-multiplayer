class Flip7Game {
    constructor() {
        this.socket = io();
        this.playerNumber = null;
        this.playerName = null;
        this.gameState = null;
        this.isMyTurn = false;
        this.animatingCard = null; // Track cards currently being animated
        this.pendingStartRoundBtn = false; // Track if Start Next Round button should show after animation
        this.awaitingSecondChance = false; // Track if buttons should stay disabled during duplicate handling
        
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
        this.drawBtn = document.getElementById('draw-btn');
        this.stickBtn = document.getElementById('stick-btn');
        this.turnStatus = document.getElementById('turn-status');
        
        // Freeze target selection elements
        this.freezeTargetSelect = document.getElementById('freeze-target-select');
        this.freezeApplyBtn = document.getElementById('freeze-apply-btn');
        
        // handCards element removed - cards now displayed in main players table
        // this.currentTurn element removed - turn indication now handled by table row highlighting
        // this.gameMessage element removed - game info now shown in table
        // this.leaderInfo element removed - points needed now shown in table column

        // Admin panel elements
        this.adminPassword = document.getElementById('admin-password');
        this.restartGameBtn = document.getElementById('restart-game-btn');
        this.dropPlayerNumber = document.getElementById('drop-player-number');
        this.dropPlayerBtn = document.getElementById('drop-player-btn');
        this.kickAllRestartBtn = document.getElementById('kick-all-restart-btn');

        // Track if we're showing a persistent round summary
        this.showingRoundSummary = false;
        
        // Track game completion state for winner highlighting
        this.gameComplete = false;
        this.gameWinners = null;
    }

    setupEventListeners() {
        this.joinBtn.addEventListener('click', () => this.joinGame());
        this.reconnectBtn.addEventListener('click', () => this.reconnectPlayer());
        this.startGameBtn.addEventListener('click', () => this.startGame());
        this.startRoundBtn.addEventListener('click', () => this.startNextRound());
        this.leaveGameBtn.addEventListener('click', () => this.leaveGame());
        this.drawBtn.addEventListener('click', () => this.drawCard());
        this.stickBtn.addEventListener('click', () => this.stick());
        
        // Freeze target selection
        this.freezeTargetSelect.addEventListener('change', () => this.updateFreezeApplyButton());
        this.freezeApplyBtn.addEventListener('click', () => this.applyFreeze());
        
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
            // Debug ignored cards in the received game state
            console.log(`CLIENT: Received game state update`);
            Object.keys(gameState.players).forEach(playerNum => {
                const player = gameState.players[playerNum];
                const ignoredCards = player.cards.filter(card => card.ignored);
                if (ignoredCards.length > 0) {
                    console.log(`CLIENT: Player ${playerNum} has ${ignoredCards.length} ignored card(s):`);
                    ignoredCards.forEach(card => {
                        console.log(`  - ${card.value} (id: ${card.id}, reason: ${card.ignoredReason || 'unknown'}, timestamp: ${card.ignoredTimestamp ? new Date(card.ignoredTimestamp).toLocaleTimeString() : 'none'})`);
                    });
                }
            });
            
            this.gameState = gameState;
            // If we're animating, only update hands but preserve current player highlighting
            if (this.animatingCard) {
                this.updatePlayersListOnly();
                this.updateDeckInfo();
                // Still need to update action buttons and turn indicator even during animation
                if (this.playerNumber && this.gameState.players[this.playerNumber]) {
                    this.updatePlayerHand();
                    this.updateActionButtons();
                }
                this.updateTurnIndicator();
            } else {
                this.updateGameDisplay();
            }
        });

        this.socket.on('game-started', () => {
            this.showMessage('Game started!', 'success');
            this.startGameBtn.style.display = 'none';
            
            // Clear game completion state when new game starts
            this.gameComplete = false;
            this.gameWinners = null;
            
            // Clear any winner highlighting from previous game
            const winnerRows = document.querySelectorAll('#players-table tr.game-winner');
            winnerRows.forEach(row => {
                row.classList.remove('game-winner');
            });
        });

        this.socket.on('round-started', (data) => {
            // Clear any persistent round summary when new round starts
            this.showingRoundSummary = false;
            
            // Clear game completion state when new round starts (new game)
            if (data.roundNumber === 1) {
                this.gameComplete = false;
                this.gameWinners = null;
                
                // Clear any winner highlighting from previous game
                const winnerRows = document.querySelectorAll('#players-table tr.game-winner');
                winnerRows.forEach(row => {
                    row.classList.remove('game-winner');
                });
            }
            
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
            
            // Show card draw animation for ALL players
            console.log(`Card drawn by player ${data.playerNumber}, triggering animation`);
            console.log('Card drawn data:', data);
            
            // Different messages for current player vs others
            if (data.playerNumber === this.playerNumber) {
                this.showMessage(`You drew: ${data.card.value}`, 'info');
            } else {
                this.showMessage(`${data.playerName} drew a card${data.isFirstCard ? ' (first card)' : ''}`, 'info');
            }
            
            // Check if we're already animating (to prevent conflicts with flip-seven event)
            if (this.animatingCard) {
                console.log('Already animating a card, skipping this animation');
                this.updateGameDisplay();
                return;
            }
            
            // Store the card data for animation (for any player)
            // The drawing player should remain highlighted during their animation
            this.animatingCard = {
                playerNumber: data.playerNumber,
                card: data.card,
                isBustCard: data.isBust || false, // Track if this might be a bust card
                isFlip7: data.isFlip7 || false, // Track if this is the 7th card
                preserveCurrentPlayer: data.playerNumber // Keep the drawing player highlighted during animation
            };
            
            // Update hands only, preserving current player highlighting during animation
            this.updatePlayersListOnly();
            
            // Add a small delay to ensure DOM is fully updated before measuring positions
            setTimeout(() => {
                console.log(`Starting animation for player ${data.playerNumber} after DOM update delay`);
                this.animateCardToHandWithFlip(data.playerNumber, data.card, () => {
                    console.log(`Animation completed for player ${data.playerNumber}, showing card`);
                    // Clear the animating card flag and do FULL update including current player highlighting
                    this.animatingCard = null;
                    
                    // If this is a duplicate card, show it in hand but keep buttons disabled
                    if (data.isDuplicate) {
                        console.log('Duplicate card animation completed, card visible in hand, buttons disabled');
                        // Set flag to keep buttons disabled during duplicate handling
                        this.awaitingSecondChance = true;
                        // Update display normally to show the card in hand
                        this.updateGameDisplay();
                    } else {
                        this.updateGameDisplay(); // This will now update current player highlighting after animation
                    }
                    
                    // Check if Start Next Round button is waiting to be shown
                    if (this.pendingStartRoundBtn) {
                        this.startRoundBtn.style.display = 'inline-block';
                        this.pendingStartRoundBtn = false;
                        console.log('Animation completed - showing Start Next Round button');
                    }
                    
                    // If this was a flip 7 card, we might need to trigger celebration
                    if (data.isFlip7) {
                        console.log('This was a flip 7 card, celebration should follow');
                    }
                });
            }, 50);
        });

        this.socket.on('player-stuck', (data) => {
            this.showMessage(`${data.playerName} stuck with ${data.handValue} points`, 'info');
        });

        this.socket.on('player-bust', (data) => {
            console.log('Player bust event received:', data);
            
            // Show bust card animation for ALL players who go bust
            console.log(`Player ${data.playerNumber} went bust, triggering bust card animation`);
            
            // Only animate if we have the drawn card data and not already animating
            if (data.drawnCard && !this.animatingCard) {
                // Set up animation for the bust card
                this.animatingCard = {
                    playerNumber: data.playerNumber,
                    card: data.drawnCard,
                    preserveCurrentPlayer: data.playerNumber // Keep the drawing player highlighted during animation
                };
                
                // Don't update player list here - let animation complete first to show BUST status after card lands
                
                // Animate the bust card, then show it briefly before it gets discarded
                setTimeout(() => {
                    this.animateCardToHandWithFlip(data.playerNumber, data.drawnCard, () => {
                        console.log(`Bust card animation completed for player ${data.playerNumber}`);
                        // Clear the animating card flag and do full update including current player highlighting
                        this.updatePlayerListAfterAnimation();
                        
                        // Then after a short delay, trigger the discard animation and update again
                        setTimeout(() => {
                            // The bust card should be discarded, so update display again
                            this.updateGameDisplay();
                        }, 1000);
                    });
                }, 50);
            } else {
                // Just update display if no animation possible
                this.updateGameDisplay();
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
            
            // Show Flip 7 animation for ALL players who achieve it
            console.log(`Player ${data.playerNumber} got Flip 7, attempting animation`);
            
            // Get the player's cards to find the 7th card (most recent)
            const player = this.gameState.players[data.playerNumber];
            if (player && player.cards && player.cards.length >= 7 && !this.animatingCard) {
                const seventhCard = player.cards[player.cards.length - 1]; // Last card should be the 7th
                console.log('Found 7th card for animation:', seventhCard);
                
                // Set up animation for the 7th card
                this.animatingCard = {
                    playerNumber: data.playerNumber,
                    card: seventhCard,
                    isFlip7Card: true,
                    preserveCurrentPlayer: data.playerNumber // Keep the drawing player highlighted during animation
                };
                
                // Update hands only, preserving current player highlighting during animation
                this.updatePlayersListOnly();
                
                // Animate the 7th card
                setTimeout(() => {
                    this.animateCardToHandWithFlip(data.playerNumber, seventhCard, () => {
                        console.log(`Flip 7 card animation completed for player ${data.playerNumber}`);
                        // Clear the animating card flag and do full update including current player highlighting
                        this.updatePlayerListAfterAnimation();
                        
                        // Add celebration effect after card appears
                        this.triggerFlip7Celebration(data);
                    });
                }, 50);
            } else {
                console.log('Could not find 7th card for animation or already animating, using fallback');
                this.updateGameDisplay();
                this.triggerFlip7Celebration(data);
            }
            
            this.showMessage(`🎉 ${data.playerName} hit FLIP 7! ${data.handValue} + 15 bonus = ${data.totalPoints} points!`, 'success');
        });

        this.socket.on('round-ended', (data) => {
            // IMMEDIATELY update player points from the round results
            data.results.forEach(result => {
                if (this.gameState.players[result.playerNumber]) {
                    this.gameState.players[result.playerNumber].points = result.totalPoints;
                }
            });
            
            // Refresh the UI to show updated points immediately
            this.updatePlayersList();
            
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
                
                // Delay showing Start Next Round button if card animation is in progress
                if (this.animatingCard) {
                    // Set flag to show button when animation completes
                    this.pendingStartRoundBtn = true;
                } else {
                    this.startRoundBtn.style.display = 'inline-block';
                }
            }
            
            // Make round summary persistent (stays until Start Next Round is pressed)
            const isPersistent = !data.gameComplete;
            this.showMessage(message, data.gameComplete ? 'success' : 'info', isPersistent);
        });

        this.socket.on('game-completed', (data) => {
            console.log('===== GAME COMPLETED =====');
            console.log('Winners:', data.winners.map(w => `Player ${w.playerNumber} (${w.playerName}): ${w.totalPoints} pts`));
            console.log('Final Scores:', data.finalScores.map(p => `Player ${p.playerNumber}: ${p.totalPoints} pts`));
            
            // Mark game as completed to override current player highlighting
            this.gameComplete = true;
            this.gameWinners = data.winners.map(w => w.playerNumber);
            
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
            
            // Highlight winners in the player list with continuous pulse
            setTimeout(() => {
                console.log('Game completed - clearing all highlights and adding continuous winner pulse');
                
                // Clear ALL existing highlights (current-turn)
                const allRows = document.querySelectorAll('#players-table tr.player-row');
                allRows.forEach(row => {
                    row.classList.remove('current-turn');
                });
                
                // Add persistent pulsing winner highlight
                data.winners.forEach(winner => {
                    const playerRow = document.querySelector(`#players-table tr[data-player="${winner.playerNumber}"]`);
                    if (playerRow) {
                        console.log(`Adding persistent game-winner pulse to player ${winner.playerNumber}`);
                        playerRow.classList.add('game-winner');
                    } else {
                        console.log(`Could not find row for game winner ${winner.playerNumber}`);
                    }
                });
                
                // Force refresh of the game display to ensure proper highlighting
                this.updateGameDisplay();
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
            
            // Clear game completion state
            this.gameComplete = false;
            this.gameWinners = null;
            
            this.updateGameDisplay();
            this.startGameBtn.style.display = 'inline-block';
            this.startGameBtn.textContent = 'Start Game';
            this.startRoundBtn.style.display = 'none';
        });

        this.socket.on('freeze-card-drawn', (data) => {
            // Show additional freeze card message
            this.showMessage(`${data.playerName} drew a Freeze card! ❄️ Choose a target to freeze.`, 'info');
            
            // Show freeze target selection UI if it's this player's freeze card
            if (data.playerNumber === this.playerNumber) {
                this.showFreezeTargetSelection();
            }
        });

        this.socket.on('freeze-card-discarded', (data) => {
            // Show message about freeze card being discarded
            this.showMessage(`${data.playerName} discards Freeze card`, 'info');
            
            // Animate the freeze card from hand to discard pile
            this.animateFreezeCardToDiscard(data.playerNumber, data.freezeCard);
        });

        this.socket.on('freeze-effect-applied', (data) => {
            this.showMessage(
                `${data.freezePlayerName} used Freeze on ${data.targetPlayerName}! ${data.targetPlayerName} is forced to Stick with ${data.targetHandValue} points.`, 
                'warning'
            );
            this.hideFreezeTargetSelection();
        });

        this.socket.on('second-chance-activated', (data) => {
            this.showMessage(
                `${data.playerName} used Second Chance! Duplicate card ignored.`, 
                'success'
            );
            
            // Clear the awaiting flag and set animation state for second chance sequence
            this.awaitingSecondChance = false;
            this.animatingCard = {
                playerNumber: data.playerNumber,
                card: data.duplicateCard,
                type: 'second-chance-sequence'
            };
            
            // Update UI to disable buttons immediately
            this.updateActionButtons();
            
            // Give players time to see the duplicate card before discarding (1.5 seconds)
            setTimeout(() => {
                // Start the animation sequence: duplicate out, then second chance out
                this.animateSecondChanceSequence(data);
            }, 1500);
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

    // Helper function to format remaining points (show + instead of - for negative values)
    formatRemainingPoints(value) {
        if (value < 0) {
            return '+' + Math.abs(value);
        }
        return value.toString();
    }

    // Helper function to format status display text
    formatStatusDisplay(status) {
        if (status === 'flip7') {
            return 'FLIP 7';
        }
        return status ? status.toUpperCase() : 'WAITING';
    }

    updateGameDisplay() {
        if (!this.gameState) {
            // Clear display when no game state
            this.playersList.innerHTML = '';
            // handCards element no longer exists - cards shown in players table
            // currentTurn element removed - turn indication now handled by table row highlighting
            this.deckCount.textContent = '0 cards';
            this.deckStack.innerHTML = '';
            this.currentRound.textContent = '1';
            this.uniqueCount.textContent = '0';
            this.totalValue.textContent = '0';
            // leaderInfo element removed - points needed now shown in table column
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
        
        // Control Start Game button visibility based on game state
        // Hide the button if game has actually started
        if (this.gameState.gameStarted) {
            this.startGameBtn.style.display = 'none';
        } else {
            this.startGameBtn.style.display = 'inline-block';
        }
    }

    // Helper function to calculate hand stats for any player
    calculateHandStats(cards, playerNumber = 'unknown') {
        if (!cards || cards.length === 0) {
            return { uniqueCount: 0, handValue: 0 };
        }
        
        // Apply same animation filtering as generatePlayerHandHTML to keep calculations consistent
        let filteredCards = cards;
        
        if (this.animatingCard && 
            this.animatingCard.playerNumber === parseInt(playerNumber) && 
            cards.length > 0) {
            
            if (this.animatingCard.type === 'freeze-discard') {
                // Remove the specific freeze card during freeze discard animation
                filteredCards = cards.filter(card => 
                    !(card.value === 'freeze' && card.id === this.animatingCard.card.id)
                );
            } else {
                // Remove the last card (most recently drawn) during normal draw animation
                filteredCards = cards.slice(0, -1);
            }
        }
        
        // Filter out freeze cards, second chance cards, bonus cards, multiplier cards, and ignored cards for duplicate checking
        console.log(`CLIENT: Filtering cards for player ${playerNumber}:`);
        filteredCards.forEach(card => {
            const isFreeze = card.value === 'freeze';
            const isSecondChance = card.value === 'second-chance';
            const isBonus = card.value === 'bonus';
            const isMultiplier = card.value === 'multiplier';
            const isIgnored = card.ignored;
            const willExclude = isFreeze || isSecondChance || isBonus || isMultiplier || isIgnored;
            
            console.log(`  Card ${card.value} (id: ${card.id}): ${willExclude ? 'EXCLUDED' : 'INCLUDED'}`);
            if (isIgnored) {
                console.log(`    -> Ignored reason: ${card.ignoredReason || 'unknown'}`);
                console.log(`    -> Ignored timestamp: ${card.ignoredTimestamp ? new Date(card.ignoredTimestamp).toLocaleTimeString() : 'none'}`);
            }
        });
        
        const numericCards = filteredCards.filter(card => 
            card.value !== 'freeze' && 
            card.value !== 'second-chance' && 
            card.value !== 'bonus' &&
            card.value !== 'multiplier' &&
            !card.ignored
        );
        const uniqueValues = new Set(numericCards.map(card => card.value));
        
        console.log(`CLIENT: Numeric cards for player ${playerNumber}: [${numericCards.map(c => c.value).join(', ')}]`);
        console.log(`CLIENT: Unique values: [${Array.from(uniqueValues).join(', ')}]`);
        
        // Calculate total hand value including bonus points and multiplier effects
        // First, find multiplier card
        let multiplier = 1;
        const multiplierCard = filteredCards.find(card => card.value === 'multiplier' && !card.ignored);
        if (multiplierCard) {
            multiplier = multiplierCard.multiplier;
        }
        
        // Calculate base scoring value (excluding multiplier cards)
        let baseValue = 0;
        filteredCards.forEach(card => {
            if (card.value !== 'freeze' && card.value !== 'second-chance' && card.value !== 'multiplier' && !card.ignored) {
                if (card.value === 'bonus') {
                    baseValue += card.bonusPoints;
                } else {
                    baseValue += card.value;
                }
            }
        });
        
        // Apply multiplier to base value
        const totalValue = baseValue * multiplier;
        
        return {
            uniqueCount: uniqueValues.size,
            handValue: totalValue
        };
    }

    // Calculate hand value for BUST players (excluding duplicates)
    calculatePreBustHandValue(cards, playerNumber = 'unknown') {
        if (!cards || cards.length === 0) {
            return 0;
        }
        
        // Apply same animation filtering as other functions to keep calculations consistent
        let filteredCards = cards;
        if (this.animatingCard && 
            this.animatingCard.playerNumber === parseInt(playerNumber) && 
            cards.length > 0) {
            
            if (this.animatingCard.type === 'freeze-discard') {
                // Remove the specific freeze card during freeze discard animation
                filteredCards = cards.filter(card => 
                    !(card.value === 'freeze' && card.id === this.animatingCard.card.id)
                );
            } else {
                // Remove the last card (most recently drawn) during normal draw animation
                filteredCards = cards.slice(0, -1);
            }
        }
        
        // Filter out special cards and ignored cards
        const numericCards = filteredCards.filter(card => 
            card.value !== 'freeze' && 
            card.value !== 'second-chance' && 
            card.value !== 'bonus' &&
            card.value !== 'multiplier' &&
            !card.ignored
        );
        
        // Group cards by value and keep only one of each (first occurrence)
        const seenValues = new Set();
        const uniqueCards = [];
        
        numericCards.forEach(card => {
            if (!seenValues.has(card.value)) {
                seenValues.add(card.value);
                uniqueCards.push(card);
            }
        });
        
        // Calculate multiplier
        let multiplier = 1;
        const multiplierCard = filteredCards.find(card => card.value === 'multiplier' && !card.ignored);
        if (multiplierCard) {
            multiplier = multiplierCard.multiplier;
        }
        
        // Calculate base value from unique cards plus bonus cards
        let baseValue = 0;
        uniqueCards.forEach(card => {
            baseValue += card.value;
        });
        
        // Add bonus cards
        filteredCards.forEach(card => {
            if (card.value === 'bonus' && !card.ignored) {
                baseValue += card.bonusPoints;
            }
        });
        
        // Apply multiplier
        return baseValue * multiplier;
    }

    updatePlayerListAfterAnimation() {
        // Clear the animation state and update current player highlighting to actual game state
        this.animatingCard = null;
        this.updateGameDisplay();
        
        // Check if Start Next Round button is waiting to be shown
        if (this.pendingStartRoundBtn) {
            this.startRoundBtn.style.display = 'inline-block';
            this.pendingStartRoundBtn = false;
            console.log('Flip 7 animation completed - showing Start Next Round button');
        }
    }

    updatePlayersListOnly() {
        // Update only the player hands without changing current player highlighting
        // This preserves the current turn visual state during animations
        
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

        // Function to get ranking display
        const getRankingDisplay = (rank, totalPlayers) => {
            if (totalPlayers === 1) return { emoji: '', text: '' };
            
            switch (rank) {
                case 1: return { emoji: '🥇', text: '1st' };
                case 2: return { emoji: '🥈', text: '2nd' };
                case 3: return { emoji: '🥉', text: '3rd' };
                default: return { emoji: '💩', text: `${rank}th` };
            }
        };

        // Determine which player should be highlighted as current
        const currentPlayerToHighlight = this.animatingCard?.preserveCurrentPlayer ?? this.gameState.currentPlayer;

        // Update each existing row without changing current-turn highlighting during animation
        playersByNumber.forEach(([playerNumber, player]) => {
            // Find existing row
            const existingRow = document.querySelector(`#players-table tr[data-player="${playerNumber}"]`);
            if (!existingRow) return;

            // Update classes based on preserved or actual current player
            let newClasses = 'player-row';
            if (parseInt(playerNumber) === currentPlayerToHighlight) {
                newClasses += ' current-turn';
            }
            if (!player.connected) {
                newClasses += ' disconnected';
            }
            
            // Regenerate the row content
            const playerRank = rankingMap.get(playerNumber) || playersByNumber.length;
            const rankDisplay = getRankingDisplay(playerRank, playersByNumber.length);
            
            const handCardsHTML = this.generatePlayerHandHTML(player.cards || [], playerNumber);
            const handStats = this.calculateHandStats(player.cards || [], playerNumber);
            
            // Don't show BUST or FLIP7 status during card animation - show previous status instead
            let displayStatus = player.status || 'waiting';
            if (this.animatingCard && 
                this.animatingCard.playerNumber === parseInt(playerNumber) && 
                (player.status === 'bust' || player.status === 'flip7')) {
                displayStatus = 'playing'; // Show as playing during animation
            }
            
            const statusClass = `status-${displayStatus}`;

            const playerPoints = player.points || 0;
            let pointsDisplay = `${playerPoints}`;
            if (playerPoints === highestScore && highestScore > 0 && playersAt200Plus.length > 0) {
                pointsDisplay = `🏆 ${playerPoints}`;
            }
            
            const pointsRemaining = Math.max(0, 200 - playerPoints);

            // Calculate potential points like in updatePlayersList()
            let displayHandValue = handStats.handValue;
            
            // During animation, use previous hand value (exclude the animated card)
            if (this.animatingCard && this.animatingCard.playerNumber === parseInt(playerNumber)) {
                // Calculate hand value without the animated card
                const cardsWithoutAnimated = (player.cards || []).slice(0, -1); // Remove last card
                const prevHandStats = this.calculateHandStats(cardsWithoutAnimated, playerNumber);
                displayHandValue = prevHandStats.handValue;
            }
            
            if (player.status === 'flip7' && displayStatus !== 'playing') {
                // Only add Flip 7 bonus if we're not hiding flip7 status during animation
                displayHandValue += 15;
            } else if (player.status === 'bust' && displayStatus !== 'playing') {
                // Only use bust hand value if we're not hiding bust status during animation
                displayHandValue = this.calculatePreBustHandValue(player.cards || [], playerNumber);
            }
            
            // Calculate potential points
            let calculatedPotentialPoints;
            const allPlayers = Object.values(this.gameState.players);
            const roundComplete = allPlayers.every(p => 
                p.status === 'stuck' || p.status === 'bust' || p.status === 'flip7' || p.status === 'waiting'
            );
            
            if (roundComplete && (player.status === 'stuck' || player.status === 'bust' || player.status === 'flip7')) {
                calculatedPotentialPoints = playerPoints;
            } else {
                if (player.status === 'bust') {
                    calculatedPotentialPoints = playerPoints;
                } else {
                    calculatedPotentialPoints = playerPoints + displayHandValue;
                }
            }
            
            const potentialPointsRemaining = 200 - calculatedPotentialPoints;
            
            // For bust players, calculate what they would have scored (for display in "Current" with strikethrough)
            let bustWouldHaveScored = null;
            if (player.status === 'bust' && displayStatus !== 'playing') {
                // Only show bust styling if we're not hiding bust status during animation
                bustWouldHaveScored = Math.max(0, 200 - (playerPoints + displayHandValue));
            }

            // Create points display with SAME CSS classes as updatePlayersList() to prevent disappearing during animations
            const pointsContainer = document.createElement('div');
            pointsContainer.className = 'dual-points';
            
            const currentPoints = document.createElement('span');
            currentPoints.className = 'current-points';
            currentPoints.textContent = playerPoints.toString();
            
            const divider1 = document.createElement('span');
            divider1.className = 'divider';
            divider1.textContent = ' / ';
            
            const potentialPointsSpan = document.createElement('span');
            potentialPointsSpan.className = 'potential-points';
            potentialPointsSpan.textContent = calculatedPotentialPoints.toString();
            
            pointsContainer.appendChild(currentPoints);
            pointsContainer.appendChild(divider1);
            pointsContainer.appendChild(potentialPointsSpan);
            
            // Create points remaining display with SAME CSS classes as updatePlayersList()
            const pointsRemainingContainer = document.createElement('div');
            pointsRemainingContainer.className = 'dual-points';
            
            const remainingPoints = document.createElement('span');
            remainingPoints.className = 'current-points';
            remainingPoints.textContent = pointsRemaining.toString();
            
            const divider2 = document.createElement('span');
            divider2.className = 'divider';
            divider2.textContent = ' / ';
            
            const potentialRemaining = document.createElement('span');
            if (player.status === 'bust' && bustWouldHaveScored !== null) {
                potentialRemaining.className = 'potential-points bust-would-have-scored';
                potentialRemaining.textContent = this.formatRemainingPoints(bustWouldHaveScored);
            } else {
                potentialRemaining.className = 'potential-points';
                potentialRemaining.textContent = this.formatRemainingPoints(potentialPointsRemaining);
            }
            
            pointsRemainingContainer.appendChild(remainingPoints);
            pointsRemainingContainer.appendChild(divider2);
            pointsRemainingContainer.appendChild(potentialRemaining);

            existingRow.innerHTML = `
                <td class="rank-cell">
                    <span class="rank-emoji">${rankDisplay.emoji}</span>
                    <span class="rank-text">${rankDisplay.text}</span>
                </td>
                <td class="player-number-cell">
                    <span class="player-number">${playerNumber}</span>
                </td>
                <td class="player-name-cell">
                    <span class="player-name">${player.name}</span>
                </td>
                <td class="points-cell"></td>
                <td class="points-remaining-cell"></td>
                <td class="status-cell">
                    <span class="status-indicator ${statusClass}">${this.formatStatusDisplay(displayStatus)}</span>
                </td>
                <td class="hand-value-cell">
                    <span class="${displayStatus === 'bust' ? 'bust-hand-value' : ''}">
                        ${displayHandValue}
                    </span>
                </td>
                <td class="hand-cell">
                    <div class="player-hand-display">${handCardsHTML}</div>
                </td>
            `;
            
            // Append the properly structured elements to preserve CSS classes during animations
            const pointsCell = existingRow.querySelector('.points-cell');
            const pointsRemainingCell = existingRow.querySelector('.points-remaining-cell');
            pointsCell.appendChild(pointsContainer);
            pointsRemainingCell.appendChild(pointsRemainingContainer);
            
            // Apply the updated classes (with preserved current-turn highlighting during animation)
            existingRow.className = newClasses;
        });

        // Leader info removed - points needed now shown in table column
    }

    updatePlayersList() {
        // Create document fragment to build new content without clearing existing content first
        const fragment = document.createDocumentFragment();
        
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
            if (totalPlayers === 1) return { emoji: '', text: '' };
            
            switch (rank) {
                case 1: return { emoji: '🥇', text: '1st' };
                case 2: return { emoji: '🥈', text: '2nd' };
                case 3: return { emoji: '🥉', text: '3rd' };
                default: return { emoji: '💩', text: `${rank}th` };
            }
        };

        playersByNumber.forEach(([playerNumber, player]) => {
            const playerRow = document.createElement('tr');
            playerRow.className = 'player-row';
            playerRow.setAttribute('data-player', playerNumber); // Add data attribute for identification
            
            // Only add current-turn highlighting if game is not complete
            // When game is complete, only winners should be highlighted with continuous pulse
            if (parseInt(playerNumber) === this.gameState.currentPlayer && !this.gameComplete) {
                playerRow.classList.add('current-turn');
            }
            
            // If game is complete and this player is a winner, add game-winner class
            if (this.gameComplete && this.gameWinners && this.gameWinners.includes(parseInt(playerNumber))) {
                playerRow.classList.add('game-winner');
            }
            
            if (!player.connected) {
                playerRow.classList.add('disconnected');
            }

            // Highlight players at target only
            const playerPoints = player.points || 0;
            if (playerPoints >= 200) {
                playerRow.classList.add('at-target');
            }

            // Don't show BUST status during bust card animation - show previous status instead
            let displayStatus = player.status || 'waiting';
            if (this.animatingCard && 
                this.animatingCard.playerNumber === parseInt(playerNumber) && 
                (player.status === 'bust' || player.status === 'flip7')) {
                displayStatus = 'playing'; // Show as playing during animation
            }
            
            const statusClass = `status-${displayStatus}`;
            
            // Get ranking display
            const playerRank = rankingMap.get(playerNumber) || playersByNumber.length;
            const rankDisplay = getRankingDisplay(playerRank, playersByNumber.length);
            
            // Generate hand cards HTML and calculate stats
            const handCardsHTML = this.generatePlayerHandHTML(player.cards || [], playerNumber);
            const handStats = this.calculateHandStats(player.cards || [], playerNumber);
            
            // Add Flip 7 bonus to hand value display if player achieved it
            let displayHandValue = handStats.handValue;
            
            // During animation, use previous hand value (exclude the animated card)
            if (this.animatingCard && this.animatingCard.playerNumber === parseInt(playerNumber)) {
                // Calculate hand value without the animated card
                const cardsWithoutAnimated = (player.cards || []).slice(0, -1); // Remove last card
                const prevHandStats = this.calculateHandStats(cardsWithoutAnimated, playerNumber);
                displayHandValue = prevHandStats.handValue;
            }
            
            if (player.status === 'flip7' && displayStatus !== 'playing') {
                // Only add Flip 7 bonus if we're not hiding flip7 status during animation
                displayHandValue += 15;
            } else if (player.status === 'bust' && displayStatus !== 'playing') {
                // Only use bust hand value if we're not hiding bust status during animation
                displayHandValue = this.calculatePreBustHandValue(player.cards || [], playerNumber);
            }
            
            // Calculate potential points (what player would get if they stuck now)
            let potentialPoints;
            
            // Check if round is completely over by looking at all player statuses
            const allPlayers = Object.values(this.gameState.players);
            const roundComplete = allPlayers.every(p => 
                p.status === 'stuck' || p.status === 'bust' || p.status === 'flip7' || p.status === 'waiting'
            );
            
            if (roundComplete && (player.status === 'stuck' || player.status === 'bust' || player.status === 'flip7')) {
                // Round is completely over - potential equals current points (already updated)
                potentialPoints = playerPoints;
            } else {
                // Round is still in progress OR player is still playing - show what they'd get if they stuck
                if (player.status === 'bust') {
                    // Bust players get no additional points
                    potentialPoints = playerPoints;
                } else {
                    // Show current points + hand value (what they'd get if round ended now)
                    potentialPoints = playerPoints + displayHandValue;
                }
            }
            
            const pointsRemaining = Math.max(0, 200 - playerPoints);
            const potentialPointsRemaining = 200 - potentialPoints;
            
            // For bust players, calculate what they would have scored (for display in "Current" with strikethrough)
            let bustWouldHaveScored = null;
            if (player.status === 'bust' && displayStatus !== 'playing') {
                // Only show bust styling if we're not hiding bust status during animation
                bustWouldHaveScored = Math.max(0, 200 - (playerPoints + displayHandValue));
            }
            

            
            playerRow.innerHTML = `
                <td class="rank-cell">
                    <span class="rank-emoji">${rankDisplay.emoji}</span>
                    <span class="rank-text">${rankDisplay.text}</span>
                </td>
                <td class="player-number-cell">
                    <span class="player-number">${playerNumber}</span>
                </td>
                <td class="player-name-cell">
                    <span class="player-name">${player.name}</span>
                </td>
                <td class="points-cell">
                    <div class="dual-points">
                        <span class="current-points">${playerPoints}</span>
                        <span class="divider"> / </span>
                        <span class="potential-points">${potentialPoints}</span>
                    </div>
                </td>
                <td class="points-remaining-cell">
                    <div class="dual-points">
                        <span class="current-remaining">${pointsRemaining}</span>
                        <span class="divider"> / </span>
                        ${player.status === 'bust' && bustWouldHaveScored !== null ? 
                            `<span class="potential-remaining bust-would-have-scored">${this.formatRemainingPoints(bustWouldHaveScored)}</span>` :
                            `<span class="potential-remaining ${potentialPointsRemaining <= 0 ? 'potential-winner' : ''}">${this.formatRemainingPoints(potentialPointsRemaining)}</span>`
                        }
                        ${potentialPointsRemaining <= 0 && player.status !== 'bust' ? '<span class="potential-crown">👑</span>' : ''}
                    </div>
                </td>
                <td class="status-cell">
                    <span class="status-indicator ${statusClass}">${this.formatStatusDisplay(displayStatus)}</span>
                </td>
                <td class="hand-value-cell">
                    <span class="${displayStatus === 'bust' ? 'bust-hand-value' : ''}">
                        ${displayHandValue}
                    </span>
                </td>
                <td class="hand-cell">
                    <div class="player-hand-display">${handCardsHTML}</div>
                </td>
            `;

            fragment.appendChild(playerRow);
        });

        // Replace all content atomically to prevent flickering during animations
        this.playersList.innerHTML = '';
        this.playersList.appendChild(fragment);

        // Leader info removed - points needed now shown in table column
    }

    updateLeaderInfo(sortedPlayers, playersAt200Plus) {
        // Leader info removed - points needed now shown in table column
    }

    updateDeckInfo() {
        const cardsRemaining = this.gameState.deck ? this.gameState.deck.length : 0;
        const discardCount = this.gameState.discardPile ? this.gameState.discardPile.length : 0;
        
        console.log(`Updating deck info: ${cardsRemaining} cards remaining, ${discardCount} discarded`);
        
        // Update text counters
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
        
        // Get the top card from the discard pile to show face-up
        const topCard = this.gameState.discardPile && this.gameState.discardPile.length > 0 
            ? this.gameState.discardPile[this.gameState.discardPile.length - 1]
            : null;
        
        // Calculate how many visual cards to show (max 10 for performance)
        const maxVisualCards = 10;
        const visualCardCount = Math.min(cardCount, maxVisualCards);
        
        // Create visual cards for the stack (face down except the top one)
        for (let i = 0; i < visualCardCount; i++) {
            const cardElement = document.createElement('div');
            
            if (i === visualCardCount - 1 && topCard) {
                // Top card - show face up
                cardElement.className = 'deck-stack-card face-up-discard-card';
                const colorClass = this.getCardColorClass(topCard.value);
                const suitSymbol = this.getCardSuit(topCard.value);
                let displayValue = topCard.value;
                if (topCard.value === 'freeze') displayValue = '❄';
                else if (topCard.value === 'second-chance') displayValue = '🔄';
                else if (topCard.value === 'bonus') displayValue = topCard.bonusPoints;
                else if (topCard.value === 'multiplier') displayValue = topCard.multiplier;
                
                // Different styling for special cards
                let cardColor = '#2c3e50'; // default black
                let cardBackground = 'linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%)';
                
                if (colorClass === 'red-card') {
                    cardColor = '#e74c3c';
                } else if (colorClass === 'freeze-card') {
                    cardColor = '#4682B4';
                    cardBackground = 'linear-gradient(145deg, #E0F6FF 0%, #B0E0E6 100%)';
                } else if (colorClass === 'second-chance-card') {
                    cardColor = '#28a745';
                    cardBackground = 'linear-gradient(145deg, #e8f5e8 0%, #d4edda 100%)';
                } else if (colorClass === 'bonus-card') {
                    cardColor = '#007BFF';
                    cardBackground = 'linear-gradient(145deg, #E3F2FD 0%, #BBDEFB 100%)';
                } else if (colorClass === 'multiplier-card') {
                    cardColor = '#007BFF';
                    cardBackground = 'linear-gradient(145deg, #E3F2FD 0%, #BBDEFB 100%)';
                }
                
                cardElement.style.cssText = `
                    background: ${cardBackground};
                    color: ${cardColor};
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    border: 1px solid #333;
                `;
                
                // For Freeze and Second Chance cards, show only one emoji to match the main card rendering
                if (topCard.value === 'freeze' || topCard.value === 'second-chance') {
                    cardElement.innerHTML = `
                        <div style="font-size: 1.5rem; line-height: 1; font-weight: bold;">${displayValue}</div>
                    `;
                } else {
                    cardElement.innerHTML = `
                        <div style="font-size: 1.25rem; line-height: 1; font-weight: bold;">${displayValue}</div>
                        <div style="font-size: 1rem; line-height: 1;">${suitSymbol}</div>
                    `;
                }
            } else {
                // Face down cards
                cardElement.className = 'deck-stack-card';
            }
            
            this.discardStack.appendChild(cardElement);
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
            targetX = handRect.left + 15; // cardWidth/2 (30px / 2)
            targetY = handRect.top + 21; // cardHeight/2 (42px / 2)
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
                let spacing = 32; // default mini-card width (30px) + gap (2px)
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
                targetX = handRect.left + 15; // cardWidth/2 (30px / 2)
                targetY = handRect.top + 21; // cardHeight/2 (42px / 2)
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
        
        // Set initial position and styling to match mini-card dimensions
        flyingCard.style.cssText = `
            position: fixed;
            left: ${startX - 15}px;
            top: ${startY - 21}px;
            width: 30px;
            height: 42px;
            z-index: 2000;
            background: linear-gradient(135deg, #1e3c72, #2a5298);
            border: 1px solid #333;
            border-radius: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.2rem;
            color: white;
            box-shadow: 0 4px 8px rgba(0,0,0,0.5);
            transform: rotateY(0deg);
            transition: all 0.8s ease-in-out;
        `;

        // Start with card back
        flyingCard.innerHTML = '<span style="font-size: 0.2rem;">🂠</span>';
        document.body.appendChild(flyingCard);

        // Animate to target position with flip
        setTimeout(() => {
            flyingCard.style.left = `${targetX - 15}px`;
            flyingCard.style.top = `${targetY - 21}px`;
            flyingCard.style.transform = `rotateY(180deg)`;
        }, 50);

        // Flip to show card face at midpoint
        setTimeout(() => {
            const colorClass = this.getCardColorClass(drawnCard.value);
            const suitSymbol = this.getCardSuit(drawnCard.value);
            
            let displayValue = drawnCard.value;
            if (drawnCard.value === 'freeze') displayValue = '❄';
            else if (drawnCard.value === 'second-chance') displayValue = '🔄';
            else if (drawnCard.value === 'bonus') displayValue = drawnCard.bonusPoints;
            else if (drawnCard.value === 'multiplier') displayValue = drawnCard.multiplier;
            
            // Different styling for special cards
            let cardColor = '#2c3e50';
            let cardBackground = 'linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%)';
            
            if (colorClass === 'red-card') {
                cardColor = '#e74c3c';
            } else if (colorClass === 'freeze-card') {
                cardColor = '#4682B4';
                cardBackground = 'linear-gradient(145deg, #E0F6FF 0%, #B0E0E6 100%)';
            } else if (colorClass === 'second-chance-card') {
                cardColor = '#28a745';
                cardBackground = 'linear-gradient(145deg, #e8f5e8 0%, #d4edda 100%)';
            } else if (colorClass === 'bonus-card') {
                cardColor = '#007BFF';
                cardBackground = 'linear-gradient(145deg, #E3F2FD 0%, #BBDEFB 100%)';
            } else if (colorClass === 'multiplier-card') {
                cardColor = '#007BFF';
                cardBackground = 'linear-gradient(145deg, #E3F2FD 0%, #BBDEFB 100%)';
            }
            
            flyingCard.style.background = cardBackground;
            flyingCard.style.color = cardColor;
            flyingCard.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <div style="font-size: 0.15rem; line-height: 1; font-weight: bold;">${displayValue}</div>
                    <div style="font-size: 0.1rem; line-height: 1;">${suitSymbol}</div>
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
        // Update isMyTurn property - still needed for button states
        this.isMyTurn = this.gameState.currentPlayer === this.playerNumber;
        // Turn indication is now handled by table row highlighting
    }

    updateActionButtons() {
        const player = this.gameState.players[this.playerNumber];
        const isMyTurn = this.gameState.currentPlayer === this.playerNumber;
        const canAct = isMyTurn && player && player.status === 'playing' && this.gameState.roundInProgress && !this.animatingCard && !this.awaitingSecondChance;
        
        // Check if this player drew a freeze card and must select a target
        const mustSelectFreezeTarget = this.gameState.freezeCardActive && 
                                      this.gameState.freezeCardPlayer === this.playerNumber;
        
        // Always keep consistent button text
        this.drawBtn.textContent = 'Twist';
        this.stickBtn.textContent = 'Stick';
        
        // Update turn status text based on game state
        if (this.turnStatus) {
            if (!this.gameState.roundInProgress) {
                this.turnStatus.textContent = "Waiting for game to start...";
            } else if (mustSelectFreezeTarget) {
                this.turnStatus.textContent = "Choose a player to stick with your Freeze card!";
            } else if (canAct) {
                // Only show "It's your turn!" when buttons are actually enabled
                this.turnStatus.textContent = "It's your turn!";
            } else {
                // Show waiting message for all other cases (including animations on our turn)
                this.turnStatus.textContent = "Waiting for your turn...";
            }
        }
        
        // Set enabled/disabled state - disable buttons if must select freeze target
        this.drawBtn.disabled = !canAct || mustSelectFreezeTarget;
        this.stickBtn.disabled = !canAct || mustSelectFreezeTarget || (player && !player.hasDrawnFirstCard);
        
        // Hide freeze target selection if it's no longer needed
        if (!this.gameState.freezeCardActive || this.gameState.freezeCardPlayer !== this.playerNumber) {
            this.hideFreezeTargetSelection();
        }
    }

    renderCard(card) {
        // Generate a consistent color based on card value
        const colorClass = this.getCardColorClass(card.value);
        const suitSymbol = this.getCardSuit(card.value);
        
        // Determine display value for the card
        let displayValue = card.value;
        if (card.value === 'bonus') {
            displayValue = card.bonusPoints || '?';
        } else if (card.value === 'multiplier') {
            displayValue = card.multiplier || '?';
        } else if (card.value === 'second-chance') {
            displayValue = 'Second Chance';
        }
        
        // Special rendering for Freeze cards to show only snowflake emoji in center
        if (card.value === 'freeze') {
            return `
                <div class="card ${colorClass}" data-value="${card.value}">
                    <div class="card-corner card-corner-top">
                        <div class="card-rank">Freeze</div>
                        <div class="card-suit"> </div>
                    </div>
                    <div class="card-center">
                        <div class="card-value-large">❄️</div>
                    </div>
                    <div class="card-corner card-corner-bottom">
                        <div class="card-rank">Card</div>
                        <div class="card-suit"> </div>
                    </div>
                </div>
            `;
        }
        
        // Special rendering for Second Chance cards to show only repeat emoji in center
        if (card.value === 'second-chance') {
            return `
                <div class="card ${colorClass}" data-value="${card.value}">
                    <div class="card-corner card-corner-top">
                        <div class="card-rank">2nd</div>
                        <div class="card-suit"> </div>
                    </div>
                    <div class="card-center">
                        <div class="card-value-large">🔄</div>
                    </div>
                    <div class="card-corner card-corner-bottom">
                        <div class="card-rank">Chance</div>
                        <div class="card-suit"> </div>
                    </div>
                </div>
            `;
        }
        
        // Special rendering for Multiplier cards with multiplier value on top and × underneath
        if (card.value === 'multiplier') {
            return `
                <div class="card ${colorClass}" data-value="${card.value}">
                    <div class="card-corner card-corner-top">
                        <div class="card-rank">${displayValue}</div>
                        <div class="card-suit">×</div>
                    </div>
                    <div class="card-center">
                        <div class="card-value-large">${displayValue}</div>
                        <div class="multiplier-symbol">×</div>
                    </div>
                    <div class="card-corner card-corner-bottom">
                        <div class="card-rank">${displayValue}</div>
                        <div class="card-suit">×</div>
                    </div>
                </div>
            `;
        }
        
        return `
            <div class="card ${colorClass}" data-value="${card.value}">
                <div class="card-corner card-corner-top">
                    <div class="card-rank">${displayValue}</div>
                    <div class="card-suit">${suitSymbol}</div>
                </div>
                <div class="card-center">
                    <div class="card-value-large">${displayValue}</div>
                    <div class="card-suit-large">${suitSymbol}</div>
                </div>
                <div class="card-corner card-corner-bottom">
                    <div class="card-rank">${displayValue}</div>
                    <div class="card-suit">${suitSymbol}</div>
                </div>
            </div>
        `;
    }

    getCardColorClass(value) {
        // Handle special cards
        if (value === 'freeze') return 'freeze-card';
        if (value === 'second-chance') return 'second-chance-card';
        if (value === 'bonus') return 'bonus-card';
        if (value === 'multiplier') return 'multiplier-card';
        
        // Alternate colors for visual variety while maintaining game logic
        if (value <= 3) return 'red-card';
        if (value <= 6) return 'black-card';
        if (value <= 9) return 'red-card';
        return 'black-card';
    }

    getCardSuit(value) {
        // Handle special cards
        if (value === 'freeze') return '❄️'; // Snowflake emoji for freeze cards
        if (value === 'second-chance') return '🔄'; // Refresh emoji for second chance cards
        if (value === 'bonus') return '+'; // Plus symbol for bonus points cards
        if (value === 'multiplier') return '×'; // Multiplication symbol for multiplier cards
        
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
        // Game message display removed - messages now shown via console or other UI elements
        console.log(`Game message (${type}): ${message}`);
        
        if (isPersistent) {
            this.showingRoundSummary = true;
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
                </div>
            </div>
            <div class="confetti-container"></div>
        `;
        
        document.body.appendChild(celebration);
        
        // Add confetti effect
        this.createConfetti(celebration.querySelector('.confetti-container'));
        
        // Remove celebration after 4 seconds
        setTimeout(() => {
            celebration.remove();
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
            return '';
        }

        // Filter out the animating card if this is the player who drew it
        let filteredCards = cards;
        
        if (this.animatingCard && 
            this.animatingCard.playerNumber === parseInt(playerNumber) && 
            cards.length > 0) {
            
            if (this.animatingCard.type === 'freeze-discard') {
                // Remove the specific freeze card during freeze discard animation
                filteredCards = cards.filter(card => 
                    !(card.value === 'freeze' && card.id === this.animatingCard.card.id)
                );
            } else {
                // Remove the last card (most recently drawn) during normal draw animation
                filteredCards = cards.slice(0, -1);
            }
            
            if (filteredCards.length === 0) {
                return '';
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
            
            let displayValue = card.value;
            if (card.value === 'freeze') displayValue = '❄';
            else if (card.value === 'second-chance') displayValue = '🔄';
            else if (card.value === 'bonus') displayValue = card.bonusPoints || '?';
            else if (card.value === 'multiplier') displayValue = card.multiplier || '?';
            
            let cardTitle = '';
            let additionalClasses = '';
            
            if (card.value === 'freeze') {
                if (card.used) {
                    cardTitle = 'Freeze Card ❄️ (Used)';
                    additionalClasses = 'used-freeze-card';
                } else {
                    cardTitle = 'Freeze Card ❄️';
                }
            } else if (card.value === 'second-chance') {
                cardTitle = 'Second Chance Card �';
            } else if (card.value === 'bonus') {
                cardTitle = `Bonus Points Card +${card.bonusPoints || '?'}`;
            } else if (card.value === 'multiplier') {
                cardTitle = `Multiplier Card ×${card.multiplier || '?'}`;
            } else if (card.ignored) {
                console.log(`CLIENT: Rendering ignored card:`, {
                    id: card.id,
                    value: card.value,
                    ignored: card.ignored,
                    ignoredReason: card.ignoredReason,
                    ignoredTimestamp: card.ignoredTimestamp,
                    timestamp: new Date(card.ignoredTimestamp).toLocaleTimeString()
                });
                cardTitle = `Duplicate ${card.value} (Ignored by ${card.ignoredReason || 'Second Chance'})`;
                additionalClasses = 'ignored-card';
            } else if (isDuplicate) {
                cardTitle = `Duplicate value ${card.value}`;
                additionalClasses = 'duplicate-card';
            } else {
                cardTitle = `${card.value} ${suitSymbol}`;
            }
            
            return `
                <div class="mini-card ${colorClass} ${additionalClasses}" 
                     title="${cardTitle}">
                    <div class="mini-card-value">${displayValue}</div>
                    <div class="mini-card-suit">${(card.value === 'freeze' || card.value === 'second-chance') ? '' : suitSymbol}</div>
                </div>
            `;
        }).join('');
    }

    // Freeze card methods
    showFreezeTargetSelection() {
        // Hide the normal action buttons
        this.drawBtn.classList.add('hidden');
        this.stickBtn.classList.add('hidden');
        
        // Populate the select with all playing players except the current player
        this.freezeTargetSelect.innerHTML = '<option value="">Choose player...</option>';
        
        if (this.gameState && this.gameState.players) {
            Object.entries(this.gameState.players).forEach(([playerNumber, player]) => {
                // Include all players that can be targeted (playing status and not the freeze card user)
                if (player.status === 'playing' && parseInt(playerNumber) !== this.playerNumber) {
                    const option = document.createElement('option');
                    option.value = playerNumber;
                    option.textContent = `Player ${playerNumber}: ${player.name}`;
                    this.freezeTargetSelect.appendChild(option);
                }
            });
            
            // Also allow targeting self
            const player = this.gameState.players[this.playerNumber];
            if (player && player.status === 'playing') {
                const option = document.createElement('option');
                option.value = this.playerNumber;
                option.textContent = `Player ${this.playerNumber}: ${player.name} (yourself)`;
                this.freezeTargetSelect.appendChild(option);
            }
        }
        
        // Show the freeze controls
        this.freezeTargetSelect.classList.remove('hidden');
        this.freezeApplyBtn.classList.remove('hidden');
        this.updateFreezeApplyButton();
    }

    hideFreezeTargetSelection() {
        // Hide the freeze controls
        this.freezeTargetSelect.classList.add('hidden');
        this.freezeApplyBtn.classList.add('hidden');
        this.freezeTargetSelect.value = '';
        this.freezeApplyBtn.disabled = true;
        
        // Show the normal action buttons again
        this.drawBtn.classList.remove('hidden');
        this.stickBtn.classList.remove('hidden');
    }

    updateFreezeApplyButton() {
        this.freezeApplyBtn.disabled = !this.freezeTargetSelect.value;
    }

    applyFreeze() {
        const targetPlayerNumber = parseInt(this.freezeTargetSelect.value);
        if (!targetPlayerNumber) return;
        
        this.socket.emit('freeze-target-selected', {
            targetPlayerNumber: targetPlayerNumber
        });
        
        this.hideFreezeTargetSelection();
    }

    // Second Chance animation sequence
    animateSecondChanceSequence(data) {
        // Animation state is already set by the event handler
        // Just start the animation sequence
        
        // First animate the duplicate card out to discard pile
        this.animateCardToDiscard(data.duplicateCard, data.playerNumber, () => {
            // Then animate the second chance card out to discard pile
            this.animateCardToDiscard(data.secondChanceCard, data.playerNumber, () => {
                // Clear animation state
                this.animatingCard = null;
                
                // Check if Start Next Round button is waiting to be shown
                if (this.pendingStartRoundBtn) {
                    this.startRoundBtn.style.display = 'inline-block';
                    this.pendingStartRoundBtn = false;
                    console.log('Second chance animation completed - showing Start Next Round button');
                }
                
                // Update UI to re-enable buttons if appropriate
                this.updateActionButtons();
                
                // Notify server that animation is complete
                this.socket.emit('second-chance-complete');
            });
        });
    }

    animateFreezeCardToDiscard(playerNumber, freezeCard) {
        // Set animation state to prevent game state updates from interfering
        this.animatingCard = {
            playerNumber: playerNumber,
            card: freezeCard,
            type: 'freeze-discard'
        };
        
        // Animate the freeze card from player's hand to discard pile
        this.animateCardToDiscard(freezeCard, playerNumber, () => {
            // Clear animation state
            this.animatingCard = null;
            
            // Check if Start Next Round button is waiting to be shown
            if (this.pendingStartRoundBtn) {
                this.startRoundBtn.style.display = 'inline-block';
                this.pendingStartRoundBtn = false;
                console.log('Freeze discard animation completed - showing Start Next Round button');
            }
            
            // Update action buttons to re-enable them if appropriate
            this.updateActionButtons();
            
            // Update will happen when server sends updated game state
        });
    }

    animateCardToDiscard(card, playerNumber, onComplete) {
        // Find the specific player's hand cell (same method as animateCardToHand)
        let handCell = null;
        const allRows = document.querySelectorAll('#players-table tr.player-row');
        
        for (const row of allRows) {
            const playerNumElement = row.querySelector('.player-number');
            if (playerNumElement && playerNumElement.textContent.trim() === playerNumber.toString()) {
                handCell = row.querySelector('.hand-cell');
                break;
            }
        }

        if (!handCell || !this.discardStack) {
            onComplete();
            return;
        }

        // Get exact positions (same method as animateCardToHand)
        const handRect = handCell.getBoundingClientRect();
        const discardRect = this.discardStack.getBoundingClientRect();
        
        // Calculate exact trajectory (same as animateCardToHand)
        const deltaX = (discardRect.left + discardRect.width/2) - (handRect.left + handRect.width/2);
        const deltaY = (discardRect.top + discardRect.height/2) - (handRect.top + handRect.height/2);

        // Create flying card with same structure as animateCardToHand
        const flyingCard = document.createElement('div');
        flyingCard.className = 'card-flying-to-discard';
        
        // Set exact starting position and CSS variables (same as animateCardToHand)
        flyingCard.style.cssText = `
            position: fixed;
            left: ${handRect.left + handRect.width/2 - 40}px;
            top: ${handRect.top + handRect.height/2 - 56}px;
            width: 80px;
            height: 112px;
            z-index: 2000;
            border: 2px solid #333;
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
            font-weight: bold;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            --target-x: ${deltaX}px;
            --target-y: ${deltaY}px;
        `;

        // Set card styling based on type (same color logic as other functions)
        const colorClass = this.getCardColorClass(card.value);
        const suitSymbol = this.getCardSuit(card.value);
        let displayValue = card.value;
        let cardColor = '#2c3e50';
        let cardBackground = 'linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%)';

        if (card.value === 'freeze') {
            displayValue = '❄';
            cardColor = '#4682B4';
            cardBackground = 'linear-gradient(145deg, #E0F6FF 0%, #B0E0E6 100%)';
        } else if (card.value === 'second-chance') {
            displayValue = '🔄';
            cardColor = '#28a745';
            cardBackground = 'linear-gradient(145deg, #e8f5e8 0%, #d4edda 100%)';
        } else if (colorClass === 'red-card') {
            cardColor = '#e74c3c';
        } else if (card.value.toString().startsWith('bonus')) {
            cardColor = '#007bff';
            cardBackground = 'linear-gradient(145deg, #e6f3ff 0%, #cce7ff 100%)';
            displayValue = `+${card.bonus}`;
        }

        flyingCard.style.background = cardBackground;
        flyingCard.style.color = cardColor;
        
        // For Freeze and Second Chance cards, show only one emoji to match the main card rendering
        if (card.value === 'freeze' || card.value === 'second-chance') {
            flyingCard.innerHTML = `
                <div style="font-size: 1.2rem; line-height: 1;">${displayValue}</div>
            `;
        } else {
            flyingCard.innerHTML = `
                <div style="font-size: 1rem; line-height: 1;">${displayValue}</div>
                <div style="font-size: 0.8rem; line-height: 1;">${suitSymbol}</div>
            `;
        }

        document.body.appendChild(flyingCard);

        // Remove the card after animation completes
        setTimeout(() => {
            if (flyingCard.parentNode) {
                flyingCard.remove();
            }
            onComplete();
        }, 1250); // cardToDiscard animation is 1.2s, plus buffer
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new Flip7Game();
});