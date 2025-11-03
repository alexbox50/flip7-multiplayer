const WebSocketTestClient = require('./WebSocketTestClient');
const TestServerManager = require('./TestServerManager');

describe('Flip 3 Card Integration Test', () => {
    let serverManager;
    let testClient;

    beforeAll(async () => {
        // Start server on a different port for testing
        serverManager = new TestServerManager(3001);
        await serverManager.startServer('f3,11,11'); // Flip 3, then two 11s
        await serverManager.waitForServer();
        
        testClient = new WebSocketTestClient(serverManager.getServerUrl());
    }, 30000); // 30 second timeout for server startup

    afterAll(async () => {
        if (testClient) {
            await testClient.cleanup();
        }
        if (serverManager) {
            await serverManager.stopServer();
        }
    });

    test('Flip 3 card assignment and compelled twists', async () => {
        // Connect three players
        await testClient.connectClient('player1', 'Alice');
        await testClient.connectClient('player2', 'Bob');
        await testClient.connectClient('player3', 'Charlie');

        // Wait for all players to be assigned and initial game state
        await testClient.waitForGameState(state => {
            console.log('Waiting for players, current state:', state ? Object.keys(state.players || {}).length : 'no state');
            return state && Object.keys(state.players || {}).length === 3;
        }, 15000);

        // Start the game (uses the predefined deck: f3,11,11)
        await testClient.startGameWithDeck('f3,11,11');

        // Wait for game to start and first player to have their turn
        await testClient.waitForGameState(state => 
            state && state.roundInProgress && state.currentPlayer === 1
        );

        testClient.printGameState();

        // Player 1 draws the first card (Flip 3)
        await testClient.playerAction('player1', 'twist');

        // Wait for the card to be drawn
        await testClient.waitForGameState(state => {
            const player = state && state.players[1];
            const hand = player && (player.hand || player.cards || []);
            return hand && hand.length === 1;
        });

        testClient.printGameState();

        // Player 1 should now have the Flip 3 card
        const player1 = testClient.getPlayer('player1');
        const hand = player1.hand || player1.cards || [];
        expect(hand).toHaveLength(1);
        expect(hand[0].value).toBe('flip-3');

        // Player 1 assigns Flip 3 to Player 3
        await testClient.playerAction('player1', 'assign-flip3', { targetPlayer: 3 });

        // Wait for assignment to complete and turn to switch to Player 3
        await testClient.waitForGameState(state => 
            state && state.currentPlayer === 3 && state.flip3CompelledTwist
        );

        testClient.printGameState();

        // Verify Flip 3 compelled twist state
        const gameState = testClient.getGameState();
        expect(gameState.flip3CompelledTwist).toBeTruthy();
        expect(gameState.flip3CompelledTwist.targetPlayerNumber).toBe(3);
        expect(gameState.flip3CompelledTwist.twistsRemaining).toBe(3);

        // Player 3 performs first compelled twist (draws 11)
        await testClient.playerAction('player3', 'flip3-twist');
        
        // Wait for twist to complete
        await testClient.waitForGameState(state => 
            state && state.flip3CompelledTwist && state.flip3CompelledTwist.twistsRemaining === 2
        );

        testClient.printGameState();

        // Verify first twist
        const player3AfterTwist1 = testClient.getPlayer('player3');
        const hand1 = player3AfterTwist1.hand || player3AfterTwist1.cards || [];
        expect(hand1).toHaveLength(2);
        expect(hand1.some(card => card.value === 11)).toBeTruthy();

        // Player 3 performs second compelled twist (draws second 11)
        await testClient.playerAction('player3', 'flip3-twist');
        
        // Wait for second card to be drawn
        await testClient.waitForGameState(state => {
            const player = state && state.players[3];
            const hand = player && (player.hand || player.cards || []);
            return hand && hand.length === 3; // flip-3 + two 11s
        });

        testClient.printGameState();

        // Player 3 performs third and final compelled twist - this should complete the sequence
        await testClient.playerAction('player3', 'flip3-twist');

        // Wait a moment for the final state to settle
        await new Promise(resolve => setTimeout(resolve, 500));

        testClient.printGameState();

        // Verify final state
        const finalGameState = testClient.getGameState();
        const finalPlayer3 = finalGameState.players[3];
        
        // Player 3 should be bust with 3 cards (flip-3 + two 11s)
        expect(finalPlayer3.status).toBe('bust');
        const finalHand = finalPlayer3.hand || finalPlayer3.cards || [];
        expect(finalHand).toHaveLength(3);
        
        // Check that player has the expected cards
        const cardValues = finalHand.map(card => card.value);
        expect(cardValues).toContain('flip-3');
        expect(cardValues.filter(v => v === 11)).toHaveLength(2);
        
        // Flip 3 compelled twist should be completed
        expect(finalGameState.flip3CompelledTwist).toBeFalsy();
        
        // Turn should have moved to next player (Player 2)
        expect(finalGameState.currentPlayer).toBe(2);

        console.log('✅ Flip 3 test completed successfully');
        console.log('Event History:', testClient.getEventHistory().slice(-10)); // Last 10 events for debugging
    }, 30000); // 30 second timeout for the entire test
});