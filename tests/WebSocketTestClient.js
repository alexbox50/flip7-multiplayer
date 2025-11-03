const { io } = require('socket.io-client');

/**
 * WebSocket test client for integration testing with the real server
 * Provides utilities to connect multiple clients, send actions, and wait for expected game states
 */
class WebSocketTestClient {
    constructor(serverUrl = 'http://localhost:3000') {
        this.serverUrl = serverUrl;
        this.clients = new Map(); // clientId -> { socket, playerNumber, events }
        this.gameState = null;
        this.eventHistory = [];
    }

    /**
     * Create and connect a new client to the server
     * @param {string} clientId - Unique identifier for this client
     * @param {string} playerName - Name for the player
     * @returns {Promise<Object>} - Client object with socket and player info
     */
    async connectClient(clientId, playerName) {
        return new Promise((resolve, reject) => {
            const socket = io(this.serverUrl, {
                transports: ['websocket'],
                forceNew: true
            });

            const client = {
                socket,
                playerNumber: null,
                events: [],
                playerName
            };

            // Store all events for debugging
            const originalEmit = socket.emit;
            socket.emit = (...args) => {
                client.events.push({ type: 'sent', event: args[0], data: args[1] });
                this.eventHistory.push({ clientId, type: 'sent', event: args[0], data: args[1] });
                return originalEmit.apply(socket, args);
            };

            const originalOn = socket.on;
            socket.on = (event, callback) => {
                return originalOn.call(socket, event, (...args) => {
                    client.events.push({ type: 'received', event, data: args });
                    this.eventHistory.push({ clientId, type: 'received', event, data: args });
                    callback(...args);
                });
            };

            socket.on('connect', () => {
                console.log(`Client ${clientId} connected`);
            });

            socket.on('player-assigned', (data) => {
                client.playerNumber = data.playerNumber;
                console.log(`Client ${clientId} assigned player number ${data.playerNumber}`);
            });

            socket.on('game-state', (state) => {
                this.gameState = state;
                console.log(`Game state updated: Round ${state ? state.round : 'undefined'}, Current player: ${state ? state.currentPlayer : 'undefined'}`);
            });

            socket.on('player-list', (players) => {
                console.log(`Player list updated for ${clientId}:`, Object.keys(players));
            });

            socket.on('connect_error', (error) => {
                reject(new Error(`Failed to connect client ${clientId}: ${error.message}`));
            });

            // Wait a bit for connection and assignment
            setTimeout(() => {
                if (socket.connected) {
                    console.log(`Client ${clientId} sending join-game with name: ${playerName}`);
                    // Join the game with player name
                    socket.emit('join-game', { playerName });
                    this.clients.set(clientId, client);
                    resolve(client);
                } else {
                    reject(new Error(`Client ${clientId} failed to connect within timeout`));
                }
            }, 2000);
        });
    }

    /**
     * Wait for a specific game state condition
     * @param {Function} condition - Function that returns true when condition is met
     * @param {number} timeout - Maximum time to wait in milliseconds
     * @returns {Promise<Object>} - The game state when condition is met
     */
    async waitForGameState(condition, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const checkCondition = () => {
                if (condition(this.gameState)) {
                    resolve(this.gameState);
                    return;
                }
                
                if (Date.now() - startTime > timeout) {
                    reject(new Error(`Timeout waiting for game state condition. Last state: ${JSON.stringify(this.gameState, null, 2)}`));
                    return;
                }
                
                setTimeout(checkCondition, 100);
            };
            
            checkCondition();
        });
    }

    /**
     * Wait for a specific event on a client
     * @param {string} clientId - Client to wait for event on
     * @param {string} eventName - Name of the event to wait for
     * @param {number} timeout - Maximum time to wait in milliseconds
     * @returns {Promise<*>} - Event data
     */
    async waitForEvent(clientId, eventName, timeout = 5000) {
        const client = this.clients.get(clientId);
        if (!client) {
            throw new Error(`Client ${clientId} not found`);
        }

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Timeout waiting for event ${eventName} on client ${clientId}`));
            }, timeout);

            client.socket.on(eventName, (data) => {
                clearTimeout(timeoutId);
                resolve(data);
            });
        });
    }

    /**
     * Start a new game with custom deck
     * @param {string} deckSequence - Deck sequence like "f3,11,11"
     * @returns {Promise<void>}
     */
    async startGameWithDeck(deckSequence) {
        // Get the first client as admin
        const firstClient = Array.from(this.clients.values())[0];
        if (!firstClient) {
            throw new Error('No clients connected to start game');
        }

        console.log(`Starting game with deck: ${deckSequence}`);
        firstClient.socket.emit('start-game');
        
        // Wait for game to start
        await this.waitForGameState(state => state && state.roundInProgress, 10000);
    }

    /**
     * Execute a player action
     * @param {string} clientId - Client to perform action
     * @param {string} action - Action type: 'twist', 'stick', 'assign-freeze', 'assign-flip3', etc.
     * @param {Object} data - Additional data for the action
     * @returns {Promise<void>}
     */
    async playerAction(clientId, action, data = {}) {
        const client = this.clients.get(clientId);
        if (!client) {
            throw new Error(`Client ${clientId} not found`);
        }

        console.log(`Player ${client.playerNumber} (${clientId}) performing action: ${action}`, data);

        switch (action) {
            case 'twist':
                client.socket.emit('player-action', { action: 'draw' });
                break;
            case 'stick':
                client.socket.emit('player-action', { action: 'stick' });
                break;
            case 'assign-freeze':
                if (!data.targetPlayer) {
                    throw new Error('assign-freeze requires targetPlayer');
                }
                client.socket.emit('freeze-target-selected', { targetPlayerNumber: data.targetPlayer });
                break;
            case 'assign-flip3':
                if (!data.targetPlayer) {
                    throw new Error('assign-flip3 requires targetPlayer');
                }
                client.socket.emit('flip-3-assignment', { targetPlayerNumber: data.targetPlayer });
                break;
            case 'flip3-twist':
                client.socket.emit('player-action', { action: 'draw' });
                break;
            case 'give-second-chance':
                if (!data.targetPlayer) {
                    throw new Error('give-second-chance requires targetPlayer');
                }
                client.socket.emit('give-second-chance', { targetPlayerNumber: data.targetPlayer });
                break;
            default:
                throw new Error(`Unknown action: ${action}`);
        }

        // Small delay to allow server processing
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    /**
     * Get the current game state
     * @returns {Object} - Current game state
     */
    getGameState() {
        return this.gameState;
    }

    /**
     * Get player information by client ID
     * @param {string} clientId - Client ID
     * @returns {Object} - Player info from game state
     */
    getPlayer(clientId) {
        const client = this.clients.get(clientId);
        if (!client || !this.gameState) {
            return null;
        }
        return this.gameState.players[client.playerNumber];
    }

    /**
     * Get event history for debugging
     * @returns {Array} - All events sent/received
     */
    getEventHistory() {
        return this.eventHistory;
    }

    /**
     * Print game state summary for debugging
     */
    printGameState() {
        if (!this.gameState) {
            console.log('No game state available');
            return;
        }

        console.log('\n=== GAME STATE SUMMARY ===');
        console.log(`Round: ${this.gameState.round}`);
        console.log(`Current Player: ${this.gameState.currentPlayer}`);
        console.log(`Round In Progress: ${this.gameState.roundInProgress}`);
        
        Object.entries(this.gameState.players).forEach(([playerNum, player]) => {
            const handSize = player.hand ? player.hand.length : (player.cards ? player.cards.length : 0);
            console.log(`Player ${playerNum}: ${player.name} - ${player.status} - Hand: ${handSize} cards - Score: ${player.handValue || 'N/A'}`);
        });
        console.log('==========================\n');
    }

    /**
     * Disconnect all clients and cleanup
     */
    async cleanup() {
        console.log('Cleaning up test clients...');
        for (const [clientId, client] of this.clients) {
            client.socket.disconnect();
            console.log(`Disconnected client ${clientId}`);
        }
        this.clients.clear();
        this.gameState = null;
        this.eventHistory = [];
    }
}

module.exports = WebSocketTestClient;