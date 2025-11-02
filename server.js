const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Parse command line arguments
const args = process.argv.slice(2);
let customDeck = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--deck' && i + 1 < args.length) {
        customDeck = args[i + 1];
        console.log('🎯 Using custom deck:', customDeck);
        break;
    }
}

// Parse custom deck specification
function parseCustomDeck(deckSpec) {
    if (!deckSpec) return null;
    
    const cards = deckSpec.split(',');
    const deck = [];
    const cardCounts = {};  // Track counts for unique IDs
    
    cards.forEach((cardSpec) => {
        const spec = cardSpec.trim().toLowerCase();
        let card = null;
        
        // Initialize counter for this card type
        if (!cardCounts[spec]) {
            cardCounts[spec] = 0;
        }
        
        if (spec === 'c') {
            // Second Chance card
            card = { value: 'second-chance', id: `second-chance-${cardCounts[spec]}` };
        } else if (spec === 'f') {
            // Freeze card
            card = { value: 'freeze', id: `freeze-${cardCounts[spec]}` };
        } else if (spec === 'f3') {
            // Flip 3 card
            card = { value: 'flip-3', id: `flip-3-${cardCounts[spec]}` };
        } else if (spec === 'm') {
            // Multiplier card
            card = { value: 'multiplier', multiplier: 2, id: `multiplier-${cardCounts[spec]}` };
        } else if (spec.startsWith('b')) {
            // Bonus card (e.g., b2, b4, b6, b8, b10)
            const bonusValue = parseInt(spec.substring(1));
            if (bonusValue && [2, 4, 6, 8, 10].includes(bonusValue)) {
                card = { value: 'bonus', bonusPoints: bonusValue, id: `bonus-${bonusValue}-${cardCounts[spec]}` };
            }
        } else {
            // Numeric card (including 0)
            const value = parseInt(spec);
            if (!isNaN(value) && value >= 0 && value <= 12) {
                card = { value: value, id: `${value}-${cardCounts[spec]}` };
            }
        }
        
        if (card) {
            deck.push(card);
            cardCounts[spec]++;
        } else {
            console.error(`❌ Invalid card specification: "${cardSpec}"`);
            console.log('Valid formats: c=second-chance, f=freeze, f3=flip-3, m=multiplier, b2/b4/b6/b8/b10=bonus, 0-12=numeric');
        }
    });
    
    console.log(`🎯 Created custom deck with ${deck.length} cards:`, deck.map(c => c.value).join(', '));
    return deck;
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Game state
let gameState = {
    players: {},  // playerNumber -> {id, name, cards, connected, points, status}
    spectators: {}, // socketId -> {id, name}
    currentPlayer: 1,
    gameStarted: false,
    roundInProgress: false,
    deck: [],
    discardPile: [], // Cards discarded from players' hands
    roundNumber: 1,
    roundStartPlayer: 1, // Track who started the current round
    adminPassword: 'admin123', // Simple admin authentication
    freezeCardActive: false, // Track if a freeze card is waiting for target selection
    freezeCardPlayer: null, // Player who drew the freeze card
    secondChanceActive: false, // Track if a second chance rescue is in progress
    secondChancePlayer: null, // Player using second chance
    duplicateCard: null // The duplicate card being rescued
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
    // Always create the normal deck first
    const deck = [];
    
    // Add 1 Zero card (value 0, counts toward Flip 7 but gives no points)
    deck.push({ value: 0, id: '0-0' });
    
    // 1x card with value 1; 2x cards with value 2; ... 12x cards with value 12
    for (let value = 1; value <= 12; value++) {
        for (let count = 0; count < value; count++) {
            deck.push({ value: value, id: `${value}-${count}` });
        }
    }
    
    // Add 3 Freeze cards
    for (let count = 0; count < 3; count++) {
        deck.push({ value: 'freeze', id: `freeze-${count}` });
    }
    
    // Add 3 Second Chance cards
    for (let count = 0; count < 3; count++) {
        deck.push({ value: 'second-chance', id: `second-chance-${count}` });
    }
    
    // Add 3 Flip 3 cards
    for (let count = 0; count < 3; count++) {
        deck.push({ value: 'flip-3', id: `flip-3-${count}` });
    }
    
    // Add 5 Bonus Points cards (+2, +4, +6, +8, +10)
    const bonusValues = [2, 4, 6, 8, 10];
    bonusValues.forEach((value, index) => {
        deck.push({ value: 'bonus', bonusPoints: value, id: `bonus-${value}` });
    });
    
    // Add 1 Multiplier card (2x multiplier)
    deck.push({ value: 'multiplier', multiplier: 2, id: 'multiplier-2' });
    
    console.log(`Created normal deck with ${deck.length} cards (including 1 zero card, 1 multiplier card)`);
    
    // Always shuffle the normal deck first
    const shuffledDeck = shuffleDeck(deck);
    
    // Check if custom deck is specified to prepend
    if (customDeck) {
        const parsedCustomCards = parseCustomDeck(customDeck);
        if (parsedCustomCards && parsedCustomCards.length > 0) {
            console.log('🎯 Prepending custom cards to shuffled normal deck');
            
            // Since deck.pop() draws from the end, we need to add custom cards at the end
            // in reverse order so they are drawn in the specified order
            const reversedCustomCards = [...parsedCustomCards].reverse();
            shuffledDeck.push(...reversedCustomCards);
            
            console.log(`Final deck has ${shuffledDeck.length} cards total`);
            console.log(`Custom cards (in draw order): ${parsedCustomCards.map(c => c.value).join(', ')}`);
            
            return shuffledDeck;
        }
    }
    
    // No custom deck, return the shuffled normal deck
    return shuffledDeck;
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
    // Only create a fresh deck for the first round of a new game
    if (gameState.roundNumber === 1) {
        gameState.deck = createDeck();
        gameState.discardPile = [];
    }
    // For subsequent rounds, continue with existing deck and discard pile
    
    gameState.roundInProgress = true;
    
    // Debug logging for round start
    console.log('=== ROUND START DEBUG ===');
    console.log(`Round ${gameState.roundNumber} starting`);
    console.log(`Total deck size: ${gameState.deck.length}`);
    if (gameState.deck.length > 0) {
        console.log(`Top card: ${gameState.deck[gameState.deck.length - 1].value} (id: ${gameState.deck[gameState.deck.length - 1].id})`);
    }
    if (gameState.deck.length > 1) {
        console.log(`Next card: ${gameState.deck[gameState.deck.length - 2].value} (id: ${gameState.deck[gameState.deck.length - 2].id})`);
    }
    console.log('=========================');
    
    // Reset freeze card state
    gameState.freezeCardActive = false;
    gameState.freezeCardPlayer = null;
    
    // Reset second chance state
    gameState.secondChanceActive = false;
    gameState.secondChancePlayer = null;
    gameState.duplicateCard = null;
    
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
    // If deck is empty, shuffle discard pile into deck
    if (gameState.deck.length === 0 && gameState.discardPile.length > 0) {
        console.log('Draw pile empty, shuffling discard pile into new draw pile');
        
        // Clean all cards by removing ignored flags and other temporary properties
        const cleanedCards = gameState.discardPile.map(card => {
            const cleanCard = { ...card };
            delete cleanCard.ignored;
            delete cleanCard.ignoredReason;
            delete cleanCard.ignoredTimestamp;
            
            console.log(`Cleaning card ${cleanCard.value} (id: ${cleanCard.id}) - removed ignored flags`);
            return cleanCard;
        });
        
        gameState.deck = shuffleDeck(cleanedCards);
        gameState.discardPile = [];
        
        // Notify all players that deck was replenished
        io.to('game').emit('deck-replenished', {
            newDeckSize: gameState.deck.length
        });
    }
    
    if (gameState.deck.length === 0) {
        return null;
    }
    
    const card = gameState.deck.pop();
    console.log(`=== CARD DRAWN ===`);
    console.log(`Player ${playerNumber} drew: ${card.value} (id: ${card.id})`);
    console.log(`Card ignored status: ${card.ignored || false}`);
    console.log(`Card ignored reason: ${card.ignoredReason || 'none'}`);
    console.log(`Cards remaining in deck: ${gameState.deck.length}`);
    if (gameState.deck.length > 0) {
        console.log(`New top card: ${gameState.deck[gameState.deck.length - 1].value} (id: ${gameState.deck[gameState.deck.length - 1].id})`);
    }
    console.log('==================');
    
    gameState.players[playerNumber].cards.push(card);
    return card;
}

function hasCardValue(playerNumber, value) {
    return gameState.players[playerNumber].cards.some(card => card.value === value);
}

function calculateBaseScoringValue(playerNumber) {
    const player = gameState.players[playerNumber];
    
    // Calculate base score (excluding multiplier cards)
    return player.cards.reduce((sum, card) => {
        // Skip non-scoring cards (including multiplier)
        if (card.value === 'freeze' || card.value === 'second-chance' || card.value === 'flip-3' || card.value === 'multiplier') {
            return sum;
        }
        // Ignored duplicate cards don't contribute to hand value
        if (card.ignored) {
            return sum;
        }
        // Bonus Points cards add their bonus value to hand total
        if (card.value === 'bonus') {
            return sum + card.bonusPoints;
        }
        return sum + card.value;
    }, 0);
}

function calculateHandValue(playerNumber) {
    const player = gameState.players[playerNumber];
    console.log(`=== CALCULATING HAND VALUE ===`);
    console.log(`Player ${playerNumber} (${player.name})`);
    console.log(`Total cards in hand: ${player.cards.length}`);
    
    // Check for multiplier card first
    let multiplier = 1;
    const multiplierCard = player.cards.find(card => card.value === 'multiplier' && !card.ignored);
    if (multiplierCard) {
        multiplier = multiplierCard.multiplier;
        console.log(`  -> Found: Multiplier card (${multiplier}x)`);
    }
    
    // Calculate base score (excluding multiplier cards)
    const baseScore = player.cards.reduce((sum, card) => {
        console.log(`Processing card: ${card.value} (id: ${card.id})`);
        
        // Skip non-scoring cards (including multiplier)
        if (card.value === 'freeze' || card.value === 'second-chance' || card.value === 'flip-3' || card.value === 'multiplier') {
            console.log(`  -> Skipped: Special card (${card.value})`);
            return sum;
        }
        // Ignored duplicate cards don't contribute to hand value
        if (card.ignored) {
            console.log(`  -> Skipped: Ignored card (reason: ${card.ignoredReason || 'unknown'}, timestamp: ${card.ignoredTimestamp || 'none'})`);
            return sum;
        }
        // Bonus Points cards add their bonus value to hand total
        if (card.value === 'bonus') {
            console.log(`  -> Added: Bonus card (+${card.bonusPoints})`);
            return sum + card.bonusPoints;
        }
        console.log(`  -> Added: Regular card (${card.value})`);
        return sum + card.value;
    }, 0);
    
    // Apply multiplier to base score
    const finalScore = baseScore * multiplier;
    
    console.log(`Base score: ${baseScore}`);
    if (multiplier > 1) {
        console.log(`Multiplier applied: ${baseScore} x ${multiplier} = ${finalScore}`);
    }
    console.log(`Final hand value: ${finalScore}`);
    console.log('===============================');
    return finalScore;
}

function checkRoundEnd() {
    const playingPlayers = Object.values(gameState.players).filter(p => p.status === 'playing');
    return playingPlayers.length === 0;
}

function nextPlayer() {
    // Debug logging for draw pile state
    console.log('=== TURN CHANGE DEBUG ===');
    console.log(`Current player: ${gameState.currentPlayer}`);
    console.log(`Draw pile size: ${gameState.deck.length}`);
    if (gameState.deck.length > 0) {
        console.log(`Top card on draw pile: ${gameState.deck[gameState.deck.length - 1].value} (id: ${gameState.deck[gameState.deck.length - 1].id})`);
    } else {
        console.log('Draw pile is empty');
    }
    if (gameState.deck.length > 1) {
        console.log(`Next card on draw pile: ${gameState.deck[gameState.deck.length - 2].value} (id: ${gameState.deck[gameState.deck.length - 2].id})`);
    } else {
        console.log('No next card available');
    }
    console.log(`Discard pile size: ${gameState.discardPile.length}`);
    console.log('========================');
    
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
    // Move all player cards to discard pile, cleaning any temporary flags
    Object.keys(gameState.players).forEach(playerNumber => {
        const player = gameState.players[playerNumber];
        if (player.cards && player.cards.length > 0) {
            // Clean cards before moving to discard pile
            const cleanedCards = player.cards.map(card => {
                const cleanCard = { ...card };
                delete cleanCard.ignored;
                delete cleanCard.ignoredReason;
                delete cleanCard.ignoredTimestamp;
                
                console.log(`End round: Cleaning card ${cleanCard.value} (id: ${cleanCard.id}) from player ${playerNumber}`);
                return cleanCard;
            });
            
            gameState.discardPile.push(...cleanedCards);
        }
    });
    
    // Award points to players
    console.log('=== AWARDING ROUND POINTS ===');
    Object.keys(gameState.players).forEach(playerNumber => {
        const player = gameState.players[playerNumber];
        const oldPoints = player.points;
        const roundPoints = player.roundPoints || 0;
        if (player.roundPoints !== undefined) {
            player.points += player.roundPoints;
        }
        console.log(`Player ${playerNumber} (${player.name}): ${oldPoints} + ${roundPoints} = ${player.points} points`);
    });
    
    // Check for game completion (200+ points)
    const playersWithScores = Object.values(gameState.players)
        .map(player => ({ ...player, totalPoints: player.points }))
        .sort((a, b) => b.totalPoints - a.totalPoints);
    
    console.log('=== FINAL SCORES FOR GAME COMPLETION CHECK ===');
    playersWithScores.forEach(player => {
        console.log(`Player ${player.number} (${player.name}): ${player.totalPoints} points`);
    });
    
    const highestScore = playersWithScores[0]?.totalPoints || 0;
    const playersAt200Plus = playersWithScores.filter(p => p.totalPoints >= 200);
    
    console.log(`=== GAME COMPLETION LOGIC ===`);
    console.log(`Highest score: ${highestScore}`);
    console.log(`Players at 200+: ${playersAt200Plus.length}`);
    playersAt200Plus.forEach(p => {
        console.log(`  - Player ${p.number} (${p.name}): ${p.totalPoints} points`);
    });
    
    let gameComplete = false;
    let winners = [];
    
    if (playersAt200Plus.length > 0) {
        // Find all players with the highest score among those with 200+
        const topScore = playersAt200Plus[0].totalPoints;
        const topScorers = playersAt200Plus.filter(p => p.totalPoints === topScore);
        
        console.log(`Top score among 200+ players: ${topScore}`);
        console.log(`Number of players with top score: ${topScorers.length}`);
        topScorers.forEach(p => {
            console.log(`  - Top scorer: Player ${p.number} (${p.name}): ${p.totalPoints} points`);
        });
        
        if (topScorers.length === 1) {
            // Single winner with highest score over 200
            gameComplete = true;
            winners = topScorers;
            console.log(`GAME COMPLETE! Winner: Player ${winners[0].number} (${winners[0].name}) with ${winners[0].totalPoints} points`);
        } else {
            // Tie at the top - continue playing until tie is broken
            gameComplete = false;
            console.log(`TIE at top score - game continues`);
        }
    } else {
        console.log(`No players at 200+ points - game continues`);
    }
    
    // Calculate who will start the next round (if game continues)
    let nextRoundStarter = null;
    let nextStarterName = null;
    if (!gameComplete) {
        const playerNumbers = Object.keys(gameState.players).map(n => parseInt(n)).sort((a, b) => a - b);
        const currentStarterIndex = playerNumbers.indexOf(gameState.roundStartPlayer);
        const nextStarterIndex = (currentStarterIndex + 1) % playerNumbers.length;
        nextRoundStarter = playerNumbers[nextStarterIndex];
        nextStarterName = gameState.players[nextRoundStarter]?.name || `Player ${nextRoundStarter}`;
    }
    
    const roundResults = {
        roundNumber: gameState.roundNumber,
        results: Object.keys(gameState.players).map(pNum => ({
            playerNumber: pNum,
            playerName: gameState.players[pNum].name,
            roundPoints: gameState.players[pNum].roundPoints || 0,
            totalPoints: gameState.players[pNum].points,
            status: gameState.players[pNum].status
        })),
        gameComplete: gameComplete,
        winners: winners.map(w => ({
            playerNumber: w.number,
            playerName: w.name,
            totalPoints: w.totalPoints
        }))
    };
    
    if (!gameComplete && nextRoundStarter) {
        roundResults.nextRoundStarter = {
            playerNumber: nextRoundStarter,
            playerName: nextStarterName
        };
    }
    
    io.to('game').emit('round-ended', roundResults);
    
    if (gameComplete) {
        gameState.gameStarted = false;
        gameState.roundInProgress = false;
        
        const winnerData = winners.map(w => ({
            playerNumber: w.number,
            playerName: w.name,
            totalPoints: w.totalPoints
        }));
        
        console.log('=== SENDING GAME-COMPLETED EVENT ===');
        console.log('Winner data being sent:', winnerData);
        
        io.to('game').emit('game-completed', {
            winners: winnerData,
            finalScores: playersWithScores.map(p => ({
                playerNumber: p.number,
                playerName: p.name,
                totalPoints: p.totalPoints
            }))
        });
        console.log(`Game completed! Winner(s):`, winners.map(w => w.name).join(', '));
    } else {
        gameState.roundNumber++;
    }
}

function startFlip3Drawing(flip3State) {
    console.log(`=== STARTING FLIP 3 DRAWING ===`);
    console.log(`Target player: ${flip3State.targetPlayerNumber}`);
    console.log(`Cards to flip: ${flip3State.cardsToFlip}`);
    
    // Function to draw the next card in the sequence
    function drawNextFlip3Card() {
        if (flip3State.cardsToFlip === 0) {
            // All cards drawn, process any set-aside cards
            finishFlip3Drawing(flip3State);
            return;
        }
        
        const targetPlayerNumber = flip3State.targetPlayerNumber;
        const targetPlayer = gameState.players[targetPlayerNumber];
        
        // Check for bust before drawing
        const currentHandValue = calculateHandValue(targetPlayerNumber);
        if (currentHandValue >= 21) {
            console.log(`Player ${targetPlayerNumber} is bust (${currentHandValue}), skipping remaining Flip 3 cards`);
            
            // Announce bust and skip remaining cards
            io.to('game').emit('flip-3-bust', {
                playerNumber: targetPlayerNumber,
                playerName: targetPlayer.name,
                handValue: currentHandValue,
                skippedCards: flip3State.cardsToFlip
            });
            
            finishFlip3Drawing(flip3State);
            return;
        }
        
        // Draw the next card
        const drawnCard = drawCard(targetPlayerNumber);
        if (!drawnCard) {
            console.log('No cards left in deck during Flip 3');
            finishFlip3Drawing(flip3State);
            return;
        }
        
        flip3State.flippedCards.push(drawnCard);
        flip3State.cardsToFlip--;
        
        console.log(`Flip 3: Drew ${drawnCard.value} for player ${targetPlayerNumber}, ${flip3State.cardsToFlip} cards remaining`);
        
        // Emit the card draw
        io.to('game').emit('flip-3-card-drawn', {
            playerNumber: targetPlayerNumber,
            playerName: targetPlayer.name,
            card: drawnCard,
            cardsRemaining: flip3State.cardsToFlip
        });
        
        // Handle special cards
        if (drawnCard.value === 'second-chance') {
            // Second Chance must be assigned immediately
            console.log(`Second Chance drawn during Flip 3, must be assigned immediately`);
            
            // Set up assignment state
            gameState.secondChanceAssignment = {
                playerNumber: targetPlayerNumber,
                card: drawnCard,
                duringFlip3: true,
                flip3State: flip3State
            };
            
            // Show assignment UI
            io.to('game').emit('show-second-chance-selection', {
                playerNumber: targetPlayerNumber,
                playerName: targetPlayer.name,
                availablePlayers: Object.keys(gameState.players)
                    .filter(pNum => pNum !== targetPlayerNumber.toString() && gameState.players[pNum].status === 'playing')
                    .map(pNum => ({
                        number: parseInt(pNum),
                        name: gameState.players[pNum].name
                    }))
            });
            
            return; // Wait for assignment before continuing
            
        } else if (drawnCard.value === 'freeze' || drawnCard.value === 'flip-3') {
            // Set aside Freeze and Flip 3 cards for later assignment
            console.log(`${drawnCard.value} card set aside during Flip 3`);
            
            // Remove from player's hand and add to set-aside
            const cardIndex = targetPlayer.cards.findIndex(card => card.id === drawnCard.id);
            if (cardIndex !== -1) {
                targetPlayer.cards.splice(cardIndex, 1);
                flip3State.setAsideCards.push(drawnCard);
            }
            
            io.to('game').emit('flip-3-card-set-aside', {
                playerNumber: targetPlayerNumber,
                playerName: targetPlayer.name,
                card: drawnCard
            });
        }
        
        // Check for Flip 7 after this card
        const newHandValue = calculateHandValue(targetPlayerNumber);
        if (newHandValue === 21) {
            console.log(`Player ${targetPlayerNumber} hit Flip 7 during Flip 3!`);
            
            io.to('game').emit('flip-3-flip-7', {
                playerNumber: targetPlayerNumber,
                playerName: targetPlayer.name,
                handValue: newHandValue
            });
            
            // Skip remaining cards
            finishFlip3Drawing(flip3State);
            return;
        }
        
        // Continue with next card after a short delay
        setTimeout(() => {
            drawNextFlip3Card();
        }, 1500);
    }
    
    // Start the drawing sequence
    drawNextFlip3Card();
}

function finishFlip3Drawing(flip3State) {
    console.log(`=== FINISHING FLIP 3 DRAWING ===`);
    console.log(`Set aside cards: ${flip3State.setAsideCards.length}`);
    
    const targetPlayerNumber = flip3State.targetPlayerNumber;
    const targetPlayer = gameState.players[targetPlayerNumber];
    
    // Emit completion
    io.to('game').emit('flip-3-completed', {
        playerNumber: targetPlayerNumber,
        playerName: targetPlayer.name,
        flippedCards: flip3State.flippedCards,
        setAsideCards: flip3State.setAsideCards
    });
    
    // Handle set-aside cards
    if (flip3State.setAsideCards.length > 0) {
        // Process set-aside cards one at a time
        processNextSetAsideCard(flip3State, 0);
    } else {
        // No set-aside cards, continue normal game flow
        continueAfterFlip3();
    }
}

function processNextSetAsideCard(flip3State, cardIndex) {
    if (cardIndex >= flip3State.setAsideCards.length) {
        // All set-aside cards processed
        continueAfterFlip3();
        return;
    }
    
    const card = flip3State.setAsideCards[cardIndex];
    const targetPlayerNumber = flip3State.targetPlayerNumber;
    
    console.log(`Processing set-aside card ${cardIndex + 1}/${flip3State.setAsideCards.length}: ${card.value}`);
    
    if (card.value === 'freeze') {
        // Set up freeze assignment
        gameState.freezeAssignment = {
            playerNumber: targetPlayerNumber,
            card: card
        };
        
        // Show freeze target selection
        io.to('game').emit('show-freeze-target-selection', {
            playerNumber: targetPlayerNumber,
            playerName: gameState.players[targetPlayerNumber].name,
            availablePlayers: Object.keys(gameState.players)
                .filter(pNum => pNum !== targetPlayerNumber.toString() && gameState.players[pNum].status === 'playing')
                .map(pNum => ({
                    number: parseInt(pNum),
                    name: gameState.players[pNum].name
                }))
        });
        
        // Store continuation info
        gameState.freezeAssignment.continueSetAside = {
            flip3State: flip3State,
            nextCardIndex: cardIndex + 1
        };
        
    } else if (card.value === 'flip-3') {
        // Set up flip-3 assignment
        gameState.flip3Assignment = {
            playerNumber: targetPlayerNumber,
            card: card
        };
        
        // Show flip-3 target selection
        io.to('game').emit('show-flip3-selection', {
            playerNumber: targetPlayerNumber,
            playerName: gameState.players[targetPlayerNumber].name,
            availablePlayers: Object.keys(gameState.players)
                .filter(pNum => gameState.players[pNum].status === 'playing')
                .map(pNum => ({
                    number: parseInt(pNum),
                    name: gameState.players[pNum].name
                }))
        });
        
        // Store continuation info
        gameState.flip3Assignment.continueSetAside = {
            flip3State: flip3State,
            nextCardIndex: cardIndex + 1
        };
    }
}

function continueAfterFlip3() {
    console.log('Continuing game flow after Flip 3 completion');
    
    // Continue with normal turn progression
    if (checkRoundEnd()) {
        endRound();
    } else {
        nextPlayer();
    }
    
    io.to('game').emit('game-state', gameState);
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Handle player joining
    socket.on('join-game', (data) => {
        const { playerName } = data;
        
        if (!playerName || !playerName.trim()) {
            socket.emit('join-failed', { message: 'Please enter a valid name' });
            return;
        }

        const trimmedName = playerName.trim();
        
        // Check if a player with this exact name already exists
        const existingPlayerEntry = Object.entries(gameState.players).find(
            ([num, player]) => player.name.toLowerCase() === trimmedName.toLowerCase()
        );
        
        if (existingPlayerEntry) {
            const [existingPlayerNumber, existingPlayer] = existingPlayerEntry;
            
            if (existingPlayer.connected) {
                // Name is taken by a connected player - reject
                socket.emit('join-failed', { message: 'This name is already taken by a connected player. Please choose a different name.' });
                return;
            } else {
                // Disconnected player with same name - auto-reconnect
                const slot = playerSlots.find(slot => slot.number === parseInt(existingPlayerNumber));
                if (slot && slot.occupied) {
                    // Reconnect to existing player slot
                    existingPlayer.id = socket.id;
                    existingPlayer.connected = true;
                    slot.playerId = socket.id;
                    
                    socket.playerNumber = parseInt(existingPlayerNumber);
                    socket.join('game');
                    
                    socket.emit('player-assigned', { 
                        playerNumber: parseInt(existingPlayerNumber), 
                        name: existingPlayer.name,
                        reconnected: true 
                    });
                    io.to('game').emit('game-state', gameState);
                    
                    console.log(`Player ${trimmedName} reconnected to slot ${existingPlayerNumber}`);
                    return;
                }
            }
        }
        
        // No existing player with this name - assign new slot
        const assignedNumber = assignPlayerSlot(socket.id);
        if (assignedNumber) {
            gameState.players[assignedNumber] = {
                id: socket.id,
                name: trimmedName,
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
            
            console.log(`Player ${trimmedName} assigned to new slot ${assignedNumber}`);
        } else {
            socket.emit('game-full', { message: 'Game is full (18 players max)' });
        }
    });

    // Handle spectator joining
    socket.on('spectate-game', (data) => {
        const { spectatorName } = data;
        
        if (!spectatorName || !spectatorName.trim()) {
            socket.emit('join-failed', { message: 'Please enter a valid name' });
            return;
        }

        const trimmedName = spectatorName.trim();
        
        // Add spectator to game state
        gameState.spectators[socket.id] = {
            id: socket.id,
            name: trimmedName
        };
        
        socket.isSpectator = true;
        socket.join('game');
        
        socket.emit('spectator-assigned', { name: trimmedName });
        
        // Emit updated game state including spectator count
        io.to('game').emit('game-state', gameState);
        io.to('game').emit('spectator-count', { count: Object.keys(gameState.spectators).length });
        
        console.log(`Spectator ${trimmedName} joined`);
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

        // Prevent actions if player has drawn a freeze card and must select a target
        if (gameState.freezeCardActive && gameState.freezeCardPlayer === parseInt(playerNumber)) {
            socket.emit('invalid-move', { message: 'You must select a target for your Freeze card first' });
            return;
        }

        // Emit action notification for spectators
        io.to('game').emit('player-action-performed', {
            playerNumber,
            action: action === 'draw' ? 'twist' : 'stick' // Convert 'draw' to 'twist' for display
        });

        if (action === 'draw') {
            // First turn: must draw
            if (!player.hasDrawnFirstCard) {
                const drawnCard = drawCard(playerNumber);
                if (!drawnCard) {
                    socket.emit('game-error', { message: 'No cards left in deck' });
                    return;
                }
                
                player.hasDrawnFirstCard = true;
                
                console.log('=== FIRST DRAW COMPLETED ===');
                console.log(`Player ${playerNumber} drew: ${drawnCard.value} (id: ${drawnCard.id})`);
                console.log(`Player now has ${player.cards.length} cards total`);
                console.log('=========================');
                
                // Check if it's a Freeze card
                if (drawnCard.value === 'freeze') {
                    // Keep freeze card in hand for display, but set freeze state
                    gameState.freezeCardActive = true;
                    gameState.freezeCardPlayer = playerNumber;
                    
                    // First send regular card-drawn event for animation
                    io.to('game').emit('card-drawn', {
                        playerNumber,
                        playerName: player.name,
                        card: drawnCard,
                        isFirstCard: true
                    });
                    
                    // Then send freeze-card-drawn event to trigger target selection UI
                    setTimeout(() => {
                        io.to('game').emit('freeze-card-drawn', {
                            playerNumber,
                            playerName: player.name,
                            card: drawnCard,
                            isFirstCard: true
                        });
                    }, 1000); // Delay to allow animation to complete
                    
                    // Don't advance turn yet - player needs to select target
                    io.to('game').emit('game-state', gameState);
                    return;
                }
                
                // Check if it's a Second Chance card
                if (drawnCard.value === 'second-chance') {
                    console.log('=== SECOND CHANCE CARD DRAWN (FIRST DRAW) ===');
                    // Check if player now has multiple Second Chance cards (including the one just drawn)
                    const existingSecondChanceCards = player.cards.filter(c => c.value === 'second-chance');
                    console.log(`Player ${playerNumber} now has ${existingSecondChanceCards.length} Second Chance cards`);
                    console.log('Second Chance card IDs:', existingSecondChanceCards.map(c => c.id));
                    
                    if (existingSecondChanceCards.length >= 2) {
                        console.log('Multiple Second Chance cards detected - initiating duplicate handling (FIRST DRAW)');
                        // Player now has multiple Second Chance cards - need to give the duplicate to another player or discard
                        const activePlayers = Object.values(gameState.players).filter(p => 
                            p.number !== playerNumber && 
                            p.status === 'playing' && 
                            p.cards.length > 0 &&
                            !p.cards.some(card => card.value === 'second-chance') // Exclude players who already have Second Chance cards
                        );
                        
                        console.log(`Found ${activePlayers.length} eligible players for Second Chance transfer`);
                        
                        if (activePlayers.length > 0) {
                            // Show UI to pick another player
                            gameState.duplicateSecondChance = {
                                playerNumber: playerNumber,
                                card: drawnCard,
                                availablePlayers: activePlayers.map(p => ({
                                    playerNumber: p.number,
                                    name: p.name
                                }))
                            };
                            
                            console.log('Sending duplicate-second-chance event with data:', gameState.duplicateSecondChance);
                            
                            io.to('game').emit('card-drawn', {
                                playerNumber,
                                playerName: player.name,
                                card: drawnCard,
                                isFirstCard: true
                            });
                            
                            io.to('game').emit('duplicate-second-chance', {
                                playerNumber,
                                playerName: player.name,
                                availablePlayers: gameState.duplicateSecondChance.availablePlayers
                            });
                            
                            io.to('game').emit('game-state', gameState);
                            return;
                        } else {
                            // No other players - discard automatically after a brief delay
                            // First show the card being drawn normally
                            io.to('game').emit('card-drawn', {
                                playerNumber,
                                playerName: player.name,
                                card: drawnCard,
                                isFirstCard: true
                            });
                            
                            io.to('game').emit('game-state', gameState);
                            
                            // Wait 1.5 seconds before starting auto-discard animation
                            setTimeout(() => {
                                // Start the discard animation on client
                                io.to('game').emit('second-chance-discarded', {
                                    playerNumber,
                                    playerName: player.name,
                                    card: drawnCard,
                                    reason: 'no-eligible-players'
                                });
                                
                                // Wait for animation to complete before updating game state
                                setTimeout(() => {
                                    // Remove the duplicate Second Chance card from the player's hand
                                    const cardIndex = player.cards.findIndex(card => 
                                        card.value === 'second-chance' && card.id === drawnCard.id
                                    );
                                    if (cardIndex !== -1) {
                                        player.cards.splice(cardIndex, 1);
                                    }
                                    
                                    gameState.discardPile.push(drawnCard);
                                    
                                    nextPlayer();
                                    io.to('game').emit('game-state', gameState);
                                }, 1250); // Animation takes 1.25 seconds
                            }, 1500);
                            
                            return;
                        }
                    } else {
                        console.log('First Second Chance card - keeping in hand normally (FIRST DRAW)');
                        // First Second Chance card - keep in hand normally
                        io.to('game').emit('card-drawn', {
                            playerNumber,
                            playerName: player.name,
                            card: drawnCard,
                            isFirstCard: true
                        });
                        
                        nextPlayer();
                        io.to('game').emit('game-state', gameState);
                        return;
                    }
                    console.log('===============================================');
                }
                
                // Check if it's a Bonus Points card
                if (drawnCard.value === 'bonus') {
                    // Bonus Points cards are kept in hand and turn ends normally
                    io.to('game').emit('card-drawn', {
                        playerNumber,
                        playerName: player.name,
                        card: drawnCard,
                        isFirstCard: true
                    });
                    
                    nextPlayer();
                    io.to('game').emit('game-state', gameState);
                    return;
                }
                
                // Check if it's a Flip 3 card
                if (drawnCard.value === 'flip-3') {
                    // Remove the Flip 3 card from the player's hand first (it gets assigned, not kept)
                    const cardIndex = player.cards.findIndex(c => c.id === drawnCard.id);
                    if (cardIndex !== -1) {
                        player.cards.splice(cardIndex, 1);
                    }
                    
                    // Show UI to assign the Flip 3 card to a player
                    gameState.flip3Assignment = {
                        playerNumber: playerNumber,
                        card: drawnCard,
                        assignerName: player.name
                    };
                    
                    io.to('game').emit('card-drawn', {
                        playerNumber,
                        playerName: player.name,
                        card: drawnCard,
                        isFirstCard: true
                    });
                    
                    // Show Flip 3 assignment UI to the player who drew it
                    io.to('game').emit('show-flip3-selection', {
                        playerNumber,
                        playerName: player.name,
                        availablePlayers: Object.keys(gameState.players)
                            .filter(pNum => gameState.players[pNum].status === 'playing')
                            .map(pNum => ({
                                number: parseInt(pNum),
                                name: gameState.players[pNum].name
                            }))
                    });
                    
                    io.to('game').emit('game-state', gameState);
                    return;
                }
                
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
                
                // Check if it's a Freeze card
                if (drawnCard.value === 'freeze') {
                    // Keep freeze card in hand for display, but set freeze state
                    gameState.freezeCardActive = true;
                    gameState.freezeCardPlayer = playerNumber;
                    
                    // First send regular card-drawn event for animation
                    io.to('game').emit('card-drawn', {
                        playerNumber,
                        playerName: player.name,
                        card: drawnCard,
                        isFirstCard: false
                    });
                    
                    // Then send freeze-card-drawn event to trigger target selection UI
                    setTimeout(() => {
                        io.to('game').emit('freeze-card-drawn', {
                            playerNumber,
                            playerName: player.name,
                            card: drawnCard,
                            isFirstCard: false
                        });
                    }, 1000); // Delay to allow animation to complete
                    
                    // Don't advance turn yet - player needs to select target
                    io.to('game').emit('game-state', gameState);
                    return;
                }
                
                // Check if it's a Second Chance card
                if (drawnCard.value === 'second-chance') {
                    console.log('=== SECOND CHANCE CARD DRAWN (SECOND DRAW) ===');
                    // Check if player now has multiple Second Chance cards (including the one just drawn)
                    const existingSecondChanceCards = player.cards.filter(c => c.value === 'second-chance');
                    console.log(`Player ${playerNumber} now has ${existingSecondChanceCards.length} Second Chance cards`);
                    console.log('Second Chance card IDs:', existingSecondChanceCards.map(c => c.id));
                    
                    if (existingSecondChanceCards.length >= 2) {
                        console.log('Multiple Second Chance cards detected - initiating duplicate handling (SECOND DRAW)');
                        // Player now has multiple Second Chance cards - need to give the duplicate to another player or discard
                        const activePlayers = Object.values(gameState.players).filter(p => 
                            p.number !== playerNumber && 
                            p.status === 'playing' && 
                            p.cards.length > 0 &&
                            !p.cards.some(card => card.value === 'second-chance') // Exclude players who already have Second Chance cards
                        );
                        
                        if (activePlayers.length > 0) {
                            // Show UI to pick another player
                            gameState.duplicateSecondChance = {
                                playerNumber: playerNumber,
                                card: drawnCard,
                                availablePlayers: activePlayers.map(p => ({
                                    playerNumber: p.number,
                                    name: p.name
                                }))
                            };
                            
                            io.to('game').emit('card-drawn', {
                                playerNumber,
                                playerName: player.name,
                                card: drawnCard,
                                isFirstCard: false
                            });
                            
                            io.to('game').emit('duplicate-second-chance', {
                                playerNumber,
                                playerName: player.name,
                                availablePlayers: gameState.duplicateSecondChance.availablePlayers
                            });
                            
                            io.to('game').emit('game-state', gameState);
                            return;
                        } else {
                            // No other players - discard automatically after a brief delay
                            // First show the card being drawn normally
                            io.to('game').emit('card-drawn', {
                                playerNumber,
                                playerName: player.name,
                                card: drawnCard,
                                isFirstCard: false
                            });
                            
                            io.to('game').emit('game-state', gameState);
                            
                            // Wait 1.5 seconds before starting auto-discard animation
                            setTimeout(() => {
                                // Start the discard animation on client
                                io.to('game').emit('second-chance-discarded', {
                                    playerNumber,
                                    playerName: player.name,
                                    card: drawnCard,
                                    reason: 'no-eligible-players'
                                });
                                
                                // Wait for animation to complete before updating game state
                                setTimeout(() => {
                                    // Remove the duplicate Second Chance card from the player's hand
                                    const cardIndex = player.cards.findIndex(card => 
                                        card.value === 'second-chance' && card.id === drawnCard.id
                                    );
                                    if (cardIndex !== -1) {
                                        player.cards.splice(cardIndex, 1);
                                    }
                                    
                                    gameState.discardPile.push(drawnCard);
                                    
                                    // Check if round should end
                                    if (checkRoundEnd()) {
                                        endRound();
                                    } else {
                                        nextPlayer();
                                    }
                                    io.to('game').emit('game-state', gameState);
                                }, 1250); // Animation takes 1.25 seconds
                            }, 1500);
                            
                            return;
                        }
                    } else {
                        // First Second Chance card - keep in hand normally
                        io.to('game').emit('card-drawn', {
                            playerNumber,
                            playerName: player.name,
                            card: drawnCard,
                            isFirstCard: false
                        });
                        
                        // Check if round should end
                        if (checkRoundEnd()) {
                            endRound();
                        } else {
                            nextPlayer();
                        }
                        io.to('game').emit('game-state', gameState);
                        return;
                    }
                }
                
                // Check if it's a Bonus Points card
                if (drawnCard.value === 'bonus') {
                    // Bonus Points cards are kept in hand and turn ends
                    io.to('game').emit('card-drawn', {
                        playerNumber,
                        playerName: player.name,
                        card: drawnCard,
                        isFirstCard: false
                    });
                    
                    // Check if round should end
                    if (checkRoundEnd()) {
                        endRound();
                    } else {
                        nextPlayer();
                    }
                    io.to('game').emit('game-state', gameState);
                    return;
                }
                
                // Check if it's a Flip 3 card
                if (drawnCard.value === 'flip-3') {
                    // Remove the Flip 3 card from the player's hand first (it gets assigned, not kept)
                    const cardIndex = player.cards.findIndex(c => c.id === drawnCard.id);
                    if (cardIndex !== -1) {
                        player.cards.splice(cardIndex, 1);
                    }
                    
                    // Show UI to assign the Flip 3 card to a player
                    gameState.flip3Assignment = {
                        playerNumber: playerNumber,
                        card: drawnCard,
                        assignerName: player.name
                    };
                    
                    io.to('game').emit('card-drawn', {
                        playerNumber,
                        playerName: player.name,
                        card: drawnCard,
                        isFirstCard: false
                    });
                    
                    // Show Flip 3 assignment UI to the player who drew it
                    io.to('game').emit('show-flip3-selection', {
                        playerNumber,
                        playerName: player.name,
                        availablePlayers: Object.keys(gameState.players)
                            .filter(pNum => gameState.players[pNum].status === 'playing')
                            .map(pNum => ({
                                number: parseInt(pNum),
                                name: gameState.players[pNum].name
                            }))
                    });
                    
                    io.to('game').emit('game-state', gameState);
                    return;
                }
                
                // Check for bust (same value already in hand)
                // Exclude freeze cards, second chance cards, bonus cards, and ignored cards from value calculations
                // Also exclude the newly drawn card from the existing hand check
                console.log(`=== FILTERING CARDS FOR DUPLICATE CHECK ===`);
                console.log(`Player ${playerNumber} total cards: ${player.cards.length}`);
                player.cards.forEach(card => {
                    const isFreeze = card.value === 'freeze';
                    const isSecondChance = card.value === 'second-chance';
                    const isBonus = card.value === 'bonus';
                    const isIgnored = card.ignored;
                    const isNewCard = card.id === drawnCard.id;
                    const willExclude = isFreeze || isSecondChance || isBonus || isIgnored || isNewCard;
                    
                    console.log(`  Card ${card.value} (id: ${card.id}): ${willExclude ? 'EXCLUDED' : 'INCLUDED'}`);
                    if (isFreeze) console.log(`    -> Reason: Freeze card`);
                    if (isSecondChance) console.log(`    -> Reason: Second Chance card`);
                    if (isBonus) console.log(`    -> Reason: Bonus card`);
                    if (isIgnored) console.log(`    -> Reason: Ignored (${card.ignoredReason || 'unknown reason'})`);
                    if (isNewCard) console.log(`    -> Reason: Newly drawn card`);
                });
                
                const existingCardValues = player.cards.filter(c => 
                    c.value !== 'freeze' && 
                    c.value !== 'second-chance' && 
                    c.value !== 'flip-3' &&
                    c.value !== 'bonus' &&
                    !c.ignored &&
                    c.id !== drawnCard.id // Exclude the card we just drew
                ).map(c => c.value);
                
                console.log(`Cards considered for duplicate check: [${existingCardValues.join(', ')}]`);
                console.log('==========================================');
                
                // Check if the newly drawn card's value already exists in the hand
                const isDuplicate = existingCardValues.includes(drawnCard.value);
                
                console.log(`=== DUPLICATE CHECK ===`);
                console.log(`Player ${playerNumber} drew: ${drawnCard.value} (id: ${drawnCard.id})`);
                console.log(`Existing card values: [${existingCardValues.join(', ')}]`);
                console.log(`Is duplicate: ${isDuplicate}`);
                console.log('========================');
                
                if (isDuplicate) {
                    // Check if player has Second Chance cards to use
                    const secondChanceCards = player.cards.filter(c => c.value === 'second-chance');
                    
                    if (secondChanceCards.length > 0) {
                        // Use Second Chance - mark duplicate as ignored and trigger animation sequence
                        console.log(`=== MARKING CARD AS IGNORED ===`);
                        console.log(`Player ${playerNumber} (${player.name})`);
                        console.log(`Drawn card: ${drawnCard.value} (id: ${drawnCard.id})`);
                        console.log(`Second Chance cards available: ${secondChanceCards.length}`);
                        console.log(`Second Chance card IDs: [${secondChanceCards.map(c => c.id).join(', ')}]`);
                        console.log(`Reason: Using Second Chance to ignore duplicate`);
                        
                        drawnCard.ignored = true;
                        drawnCard.ignoredReason = 'second-chance-used';
                        drawnCard.ignoredTimestamp = Date.now();
                        
                        console.log(`Card ${drawnCard.id} marked as ignored with reason: ${drawnCard.ignoredReason}`);
                        console.log('===============================');
                        
                        gameState.secondChanceActive = true;
                        gameState.secondChancePlayer = playerNumber;
                        gameState.duplicateCard = drawnCard;
                        
                        // First send normal card-drawn event for animation
                        io.to('game').emit('card-drawn', {
                            playerNumber,
                            playerName: player.name,
                            card: drawnCard,
                            isFirstCard: false,
                            isDuplicate: true // Flag to indicate this will trigger second chance
                        });
                        
                        // Then trigger second chance sequence after animation
                        setTimeout(() => {
                            io.to('game').emit('second-chance-activated', {
                                playerNumber,
                                playerName: player.name,
                                duplicateCard: drawnCard,
                                secondChanceCard: secondChanceCards[0]
                            });
                        }, 2000); // 2-second delay as specified
                        
                        io.to('game').emit('game-state', gameState);
                        return;
                    } else {
                        // Player went bust - no Second Chance available
                        player.status = 'bust';
                        player.roundPoints = 0;
                        
                        io.to('game').emit('player-bust', {
                            playerNumber,
                            playerName: player.name,
                            drawnCard: drawnCard
                        });
                    }
                } else {
                    // Check for Flip 7 (7 unique values including the newly drawn card)
                    console.log(`=== FILTERING CARDS FOR FLIP 7 CHECK ===`);
                    const allCardValues = player.cards.filter(c => 
                        c.value !== 'freeze' && 
                        c.value !== 'second-chance' && 
                        c.value !== 'bonus' &&
                        c.value !== 'multiplier' &&
                        !c.ignored
                    ).map(c => c.value);
                    const uniqueValues = new Set(allCardValues);
                    
                    console.log(`All card values for Flip 7 check: [${allCardValues.join(', ')}]`);
                    console.log(`Unique values: [${Array.from(uniqueValues).join(', ')}] (${uniqueValues.size} unique)`);
                    console.log('=======================================');
                    
                    if (uniqueValues.size === 7) {
                        player.status = 'flip7';
                        
                        // For Flip 7: multiply only the scoring cards, then add 15 bonus
                        const baseScoringValue = calculateBaseScoringValue(playerNumber);
                        const multiplierCard = player.cards.find(card => card.value === 'multiplier' && !card.ignored);
                        const multiplier = multiplierCard ? multiplierCard.multiplier : 1;
                        const multipliedScore = baseScoringValue * multiplier;
                        const handValue = multipliedScore; // This is what we report as handValue
                        player.roundPoints = multipliedScore + 15; // Add Flip 7 bonus after multiplication
                        
                        console.log(`=== FLIP 7 ACHIEVED ===`);
                        console.log(`Player ${playerNumber} (${player.name}) achieved Flip 7!`);
                        console.log(`Base scoring: ${baseScoringValue}, Multiplier: ${multiplier}x, Multiplied: ${multipliedScore}, +15 bonus = ${player.roundPoints}`);
                        console.log(`Player ${playerNumber} current total: ${player.points} + ${player.roundPoints} = ${player.points + player.roundPoints}`);
                        
                        // When Flip 7 occurs, all remaining PLAYING players should be set to STUCK
                        // This ensures consistent game state and proper round point calculation
                        console.log(`=== SETTING ALL PLAYING PLAYERS TO STUCK ===`);
                        Object.keys(gameState.players).forEach(otherPlayerNumber => {
                            const otherPlayer = gameState.players[otherPlayerNumber];
                            if (otherPlayer.status === 'playing' && parseInt(otherPlayerNumber) !== parseInt(playerNumber)) {
                                console.log(`Setting Player ${otherPlayerNumber} (${otherPlayer.name}) from PLAYING to STUCK`);
                                otherPlayer.status = 'stuck';
                                // Calculate their round points based on current hand
                                otherPlayer.roundPoints = calculateHandValue(parseInt(otherPlayerNumber));
                                console.log(`Player ${otherPlayerNumber} round points: ${otherPlayer.roundPoints}`);
                            }
                        });
                        
                        // Send updated game state so client can show the 7th card
                        io.to('game').emit('game-state', gameState);
                        
                        // Then send flip-seven event for celebration
                        io.to('game').emit('flip-seven', {
                            playerNumber,
                            playerName: player.name,
                            handValue: handValue,
                            totalPoints: player.roundPoints,
                            cards: player.cards // Include the full hand with 7 cards
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
                
                // For regular cards in twist, advance turn after drawing
                console.log(`=== REGULAR CARD TWIST ===`);
                console.log(`Player ${playerNumber} drew regular card ${drawnCard.value}, turn should advance`);
                console.log('===========================');
                
                // Check if round should end
                if (checkRoundEnd()) {
                    endRound();
                } else {
                    nextPlayer();
                }
                io.to('game').emit('game-state', gameState);
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

    // Handle freeze card target selection
    socket.on('freeze-target-selected', (data) => {
        const { targetPlayerNumber } = data;
        const playerNumber = socket.playerNumber;
        
        if (!playerNumber || !gameState.players[playerNumber] || !gameState.roundInProgress) {
            return;
        }
        
        if (!gameState.freezeCardActive || gameState.freezeCardPlayer !== parseInt(playerNumber)) {
            socket.emit('invalid-move', { message: 'No freeze card active or not your freeze card' });
            return;
        }
        
        const targetPlayer = gameState.players[targetPlayerNumber];
        if (!targetPlayer || targetPlayer.status !== 'playing') {
            socket.emit('invalid-move', { message: 'Invalid target player' });
            return;
        }
        
        // Find the freeze card but don't remove it yet (wait for animation)
        const freezePlayer = gameState.players[playerNumber];
        let freezeCardIndex = freezePlayer.cards.findIndex(card => card.value === 'freeze' && !card.used);
        let freezeCard = null;
        
        // If no unused freeze card found, look for any freeze card
        if (freezeCardIndex === -1) {
            freezeCardIndex = freezePlayer.cards.findIndex(card => card.value === 'freeze');
        }
        
        if (freezeCardIndex !== -1) {
            freezeCard = freezePlayer.cards[freezeCardIndex];
            // Mark it as used but keep it in hand during animation
            freezeCard.used = true;
        }
        
        // Emit freeze action notification for spectators
        io.to('game').emit('freeze-target-selected-action', {
            playerNumber,
            targetPlayerNumber,
            targetPlayerName: targetPlayer.name
        });

        // Apply freeze effect - force target to stick
        targetPlayer.status = 'stuck';
        targetPlayer.roundPoints = calculateHandValue(targetPlayerNumber);
        
        // Clear freeze card state
        gameState.freezeCardActive = false;
        gameState.freezeCardPlayer = null;
        
        // Emit freeze card discard animation event first
        if (freezeCard) {
            io.to('game').emit('freeze-card-discarded', {
                playerNumber: playerNumber,
                playerName: gameState.players[playerNumber].name,
                freezeCard: freezeCard
            });
        }
        
        // Then emit the freeze effect and update game state after animation
        setTimeout(() => {
            // Now actually remove the freeze card from hand and add to discard pile
            if (freezeCard && freezeCardIndex !== -1) {
                freezePlayer.cards.splice(freezeCardIndex, 1);
                gameState.discardPile.push(freezeCard);
            }
            
            io.to('game').emit('freeze-effect-applied', {
                freezePlayerNumber: playerNumber,
                freezePlayerName: gameState.players[playerNumber].name,
                targetPlayerNumber: targetPlayerNumber,
                targetPlayerName: targetPlayer.name,
                targetHandValue: targetPlayer.roundPoints
            });
            
            // Send updated game state after animation
            io.to('game').emit('game-state', gameState);
        }, 1100);
        
        // Check if this was part of set-aside processing
        if (gameState.freezeAssignment && gameState.freezeAssignment.continueSetAside) {
            const { flip3State, nextCardIndex } = gameState.freezeAssignment.continueSetAside;
            gameState.freezeAssignment = null;
            
            // Continue processing set-aside cards
            setTimeout(() => {
                processNextSetAsideCard(flip3State, nextCardIndex);
            }, 1200);
        } else {
            // Normal freeze handling
            if (checkRoundEnd()) {
                endRound();
            } else {
                nextPlayer();
            }
        }
        
        io.to('game').emit('game-state', gameState);
    });

    // Handle Second Chance animation completion
    socket.on('second-chance-complete', () => {
        const playerNumber = socket.playerNumber;
        
        if (!playerNumber || !gameState.secondChanceActive || gameState.secondChancePlayer !== parseInt(playerNumber)) {
            return;
        }
        
        const player = gameState.players[playerNumber];
        
        // Remove the duplicate card and one Second Chance card from hand
        const duplicateCard = gameState.duplicateCard;
        const duplicateIndex = player.cards.findIndex(card => 
            card.value === duplicateCard.value && card.id === duplicateCard.id
        );
        if (duplicateIndex !== -1) {
            const removedDuplicate = player.cards.splice(duplicateIndex, 1)[0];
            gameState.discardPile.push(removedDuplicate);
        }
        
        const secondChanceIndex = player.cards.findIndex(card => card.value === 'second-chance');
        if (secondChanceIndex !== -1) {
            const removedSecondChance = player.cards.splice(secondChanceIndex, 1)[0];
            gameState.discardPile.push(removedSecondChance);
        }
        
        // Clear Second Chance state
        gameState.secondChanceActive = false;
        gameState.secondChancePlayer = null;
        gameState.duplicateCard = null;
        
        // Continue with normal turn progression
        if (checkRoundEnd()) {
            endRound();
        } else {
            nextPlayer();
        }
        
        io.to('game').emit('game-state', gameState);
    });

    // Handle giving duplicate Second Chance card to another player
    socket.on('give-second-chance', (data) => {
        const playerNumber = socket.playerNumber;
        const { targetPlayerNumber } = data;
        
        console.log('=== GIVE SECOND CHANCE EVENT ===');
        console.log('Player number:', playerNumber);
        console.log('Target player:', targetPlayerNumber);
        console.log('Duplicate Second Chance state:', gameState.duplicateSecondChance);
        console.log('================================');
        
        if (!playerNumber || !gameState.duplicateSecondChance || 
            gameState.duplicateSecondChance.playerNumber !== parseInt(playerNumber)) {
            console.log('Give Second Chance event rejected - invalid state');
            return;
        }
        
        const player = gameState.players[playerNumber];
        const targetPlayer = gameState.players[targetPlayerNumber];
        
        if (!player || !targetPlayer || targetPlayer.status !== 'playing') {
            return;
        }
        
        // Remove the duplicate Second Chance card from the current player's hand
        const duplicateCard = gameState.duplicateSecondChance.card;
        const cardIndex = player.cards.findIndex(card => 
            card.value === 'second-chance' && card.id === duplicateCard.id
        );
        if (cardIndex !== -1) {
            player.cards.splice(cardIndex, 1);
        }
        
        // Give the duplicate Second Chance card to the target player
        targetPlayer.cards.push(duplicateCard);
        
        // Clear duplicate Second Chance state
        gameState.duplicateSecondChance = null;
        
        // Emit the transfer event
        io.to('game').emit('second-chance-transferred', {
            fromPlayerNumber: playerNumber,
            fromPlayerName: player.name,
            toPlayerNumber: targetPlayerNumber,
            toPlayerName: targetPlayer.name,
            card: duplicateCard
        });
        
        // Check if this was during Flip 3 and need to continue
        if (gameState.secondChanceAssignment && gameState.secondChanceAssignment.duringFlip3) {
            const flip3State = gameState.secondChanceAssignment.flip3State;
            gameState.secondChanceAssignment = null;
            
            console.log('Second Chance assigned during Flip 3, continuing drawing sequence');
            
            // Continue the Flip 3 drawing sequence after a short delay
            setTimeout(() => {
                // Resume drawing cards for Flip 3
                startFlip3Drawing({
                    ...flip3State,
                    cardsToFlip: flip3State.cardsToFlip // Continue with remaining cards
                });
            }, 1500);
            
        } else {
            // Continue with normal turn progression
            if (checkRoundEnd()) {
                endRound();
            } else {
                nextPlayer();
            }
        }
        
        io.to('game').emit('game-state', gameState);
    });

    // Handle Flip 3 card assignment
    socket.on('flip-3-assignment', (data) => {
        if (!gameState.flip3Assignment) {
            return;
        }
        
        const { targetPlayerNumber } = data;
        const player = gameState.players[socket.playerNumber];
        
        if (!player || socket.playerNumber !== gameState.flip3Assignment.playerNumber) {
            return;
        }
        
        // Validate target player
        if (!gameState.players[targetPlayerNumber] || targetPlayerNumber === socket.playerNumber) {
            socket.emit('error', { message: 'Invalid target player' });
            return;
        }
        
        console.log(`Flip 3 assigned to player ${targetPlayerNumber} by player ${socket.playerNumber}`);
        
        // Check if this was part of set-aside processing
        if (gameState.flip3Assignment && gameState.flip3Assignment.continueSetAside) {
            const { flip3State, nextCardIndex } = gameState.flip3Assignment.continueSetAside;
            
            // Clear the assignment state
            gameState.flip3Assignment = null;
            
            // Hide selection UI from all players
            io.to('game').emit('hide-flip3-selection');
            
            // Emit assignment notification
            io.to('game').emit('flip-3-assigned', {
                assignedBy: socket.playerNumber,
                assignedByName: player.name,
                targetPlayer: targetPlayerNumber,
                targetPlayerName: gameState.players[targetPlayerNumber].name,
                fromSetAside: true
            });
            
            // Continue processing set-aside cards
            setTimeout(() => {
                processNextSetAsideCard(flip3State, nextCardIndex);
            }, 1500);
            
        } else {
            // Normal Flip 3 assignment - start new drawing sequence
            const flip3State = {
                targetPlayerNumber: parseInt(targetPlayerNumber),
                cardsToFlip: 3,
                flippedCards: [],
                setAsideCards: []
            };
            
            // Clear the assignment state
            gameState.flip3Assignment = null;
            
            // Hide selection UI from all players
            io.to('game').emit('hide-flip3-selection');
            
            // Emit assignment notification
            io.to('game').emit('flip-3-assigned', {
                assignedBy: socket.playerNumber,
                assignedByName: player.name,
                targetPlayer: targetPlayerNumber,
                targetPlayerName: gameState.players[targetPlayerNumber].name
            });
            
            // Start the three-card drawing procedure
            startFlip3Drawing(flip3State);
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
        gameState.discardPile = [];
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
            // Starting a new game - reset all player points and stats
            console.log('=== NEW GAME START - RESETTING ALL SCORES ===');
            Object.keys(gameState.players).forEach(playerNumber => {
                const oldPoints = gameState.players[playerNumber].points || 0;
                gameState.players[playerNumber].points = 0;
                gameState.players[playerNumber].roundPoints = undefined;
                gameState.players[playerNumber].cards = [];
                gameState.players[playerNumber].status = 'waiting';
                gameState.players[playerNumber].hasDrawnFirstCard = false;
                console.log(`Player ${playerNumber}: ${oldPoints} -> 0 points`);
            });
            
            // Reset game state
            gameState.roundNumber = 1;
            gameState.roundStartPlayer = 1;
            gameState.currentPlayer = 1;
            gameState.deck = [];
            gameState.discardPile = [];
            gameState.roundInProgress = false;
            
            gameState.gameStarted = true;
            io.to('game').emit('game-started');
            console.log(`New game started with ${playerCount} players - all scores reset to 0`);
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
        gameState.discardPile = [];
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
        } else if (socket.isSpectator && gameState.spectators[socket.id]) {
            // Remove spectator from game state
            delete gameState.spectators[socket.id];
            io.to('game').emit('spectator-count', { count: Object.keys(gameState.spectators).length });
            console.log('Spectator disconnected');
        }
    });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
    console.log(`Flip 7 server running on ${HOST}:${PORT}`);
    if (customDeck) {
        console.log('🎯 Custom deck enabled for testing');
        console.log('   Example: --deck "1,c,2,c" creates a 4-card deck (1, second-chance, 2, second-chance)');
        console.log('   Card types: c=second-chance, f=freeze, f3=flip-3, m=multiplier, b2/b4/b6/b8/b10=bonus, 0-12=numeric');
    } else {
        console.log('💡 Tip: Use --deck "card1,card2,..." for predictable testing (e.g., --deck "1,c,2,c")');
    }
});