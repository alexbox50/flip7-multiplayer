const { spawn } = require('child_process');
const { io } = require('socket.io-client');

/**
 * Test server manager for starting/stopping the server during tests
 */
class TestServerManager {
    constructor(port = 3001) {
        this.port = port;
        this.serverProcess = null;
        this.serverUrl = `http://localhost:${port}`;
    }

    /**
     * Start the server for testing
     * @param {string} deckSequence - Optional deck sequence for testing
     * @returns {Promise<void>}
     */
    async startServer(deckSequence = null) {
        return new Promise((resolve, reject) => {
            const args = ['server.js', '--port', this.port.toString()];
            if (deckSequence) {
                args.push('--deck', deckSequence);
            }

            console.log(`Starting test server on port ${this.port}${deckSequence ? ' with deck: ' + deckSequence : ''}`);
            
            this.serverProcess = spawn('node', args, {
                cwd: process.cwd(),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let serverOutput = '';
            
            this.serverProcess.stdout.on('data', (data) => {
                serverOutput += data.toString();
                if (data.toString().includes(`running on 0.0.0.0:${this.port}`)) {
                    console.log(`Test server started successfully on port ${this.port}`);
                    resolve();
                }
            });

            this.serverProcess.stderr.on('data', (data) => {
                console.error('Server error:', data.toString());
            });

            this.serverProcess.on('error', (error) => {
                reject(new Error(`Failed to start server: ${error.message}`));
            });

            this.serverProcess.on('exit', (code, signal) => {
                if (code !== 0 && code !== null) {
                    reject(new Error(`Server exited with code ${code}`));
                }
            });

            // Timeout if server doesn't start within 10 seconds
            setTimeout(() => {
                if (this.serverProcess && !this.serverProcess.killed) {
                    reject(new Error(`Server startup timeout. Output: ${serverOutput}`));
                }
            }, 10000);
        });
    }

    /**
     * Stop the server
     * @returns {Promise<void>}
     */
    async stopServer() {
        return new Promise((resolve) => {
            if (this.serverProcess) {
                console.log(`Stopping test server on port ${this.port}`);
                this.serverProcess.on('exit', () => {
                    console.log('Test server stopped');
                    this.serverProcess = null;
                    resolve();
                });
                
                this.serverProcess.kill('SIGTERM');
                
                // Force kill if not stopped within 5 seconds
                setTimeout(() => {
                    if (this.serverProcess && !this.serverProcess.killed) {
                        console.log('Force killing test server');
                        this.serverProcess.kill('SIGKILL');
                        this.serverProcess = null;
                        resolve();
                    }
                }, 5000);
            } else {
                resolve();
            }
        });
    }

    /**
     * Wait for server to be ready for connections
     * @returns {Promise<void>}
     */
    async waitForServer() {
        return new Promise((resolve, reject) => {
            const maxAttempts = 50;
            let attempts = 0;

            const tryConnect = () => {
                attempts++;
                const testSocket = io(this.serverUrl, {
                    transports: ['websocket'],
                    timeout: 1000
                });

                testSocket.on('connect', () => {
                    testSocket.disconnect();
                    resolve();
                });

                testSocket.on('connect_error', () => {
                    if (attempts >= maxAttempts) {
                        reject(new Error(`Server not ready after ${maxAttempts} attempts`));
                        return;
                    }
                    setTimeout(tryConnect, 100);
                });
            };

            tryConnect();
        });
    }

    getServerUrl() {
        return this.serverUrl;
    }
}

module.exports = TestServerManager;