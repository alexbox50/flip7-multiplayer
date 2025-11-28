# Flip 7 Multiplayer Card Game

This is a real-time multiplayer browser-based card game implementing the Flip 7 card game rules.

## Project Structure
- Node.js backend with Express server
- WebSocket support for real-time multiplayer gameplay
- HTML/CSS/JavaScript frontend
- Supports up to 18 players with stable player numbers
- Admin functionality for game management

## Key Features
- Real-time multiplayer gameplay via WebSockets
- Player reconnection support with stable player numbers (1-18)
- Admin controls: restart game, drop players
- Single game instance support
- Browser-based interface

## Development Guidelines
- Use ES6+ JavaScript features
- Follow RESTful API patterns for HTTP endpoints
- Use WebSocket events for real-time game state updates
- Implement proper error handling for network issues
- Ensure responsive design for various screen sizes

## Debugging Guidelines
- Close and restart the browser before every test involving Playwright to ensure a clean state
- Every terminal command should start in a new terminal (do not reuse terminals)