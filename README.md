# Flip 7 - Multiplayer Card Game

A real-time multiplayer browser-based implementation of the Flip 7 card game, supporting up to 18 players with stable player numbers and reconnection capabilities.

## Features

- **Real-time Multiplayer**: Up to 18 players can play simultaneously
- **Stable Player Numbers**: Players get assigned numbers 1-18 that persist across sessions
- **Player Reconnection**: Disconnected players can reconnect and resume their game
- **Admin Controls**: Admins can restart games and drop problematic players
- **Browser-based**: No downloads required, play directly in your web browser
- **Responsive Design**: Works on desktop and mobile devices

## Game Rules - Flip 7

Flip 7 is a card game similar to Crazy Eights with special rules:

1. **Objective**: Be the first player to get rid of all your cards
2. **Starting**: Each player receives an equal number of cards from a standard 52-card deck
3. **Gameplay**: 
   - Players take turns playing cards that match either the suit or rank of the top card
   - **Special Rule**: 7s can be played on any card
   - **Special Effect**: When a 7 is played, the direction of play reverses
4. **Winning**: First player to play all their cards wins

## Installation & Setup

### Prerequisites
- Node.js (version 14 or higher)
- npm (Node Package Manager)

### Installation
```bash
# Clone or download the project
cd flip7

# Install dependencies
npm install

# Start the server
npm start
```

The game will be available at `http://localhost:3000`

### Development Mode
```bash
# Run in development mode with auto-restart
npm run dev
```

## How to Play

### Joining a Game
1. Open your browser and navigate to `http://localhost:3000`
2. Enter your name
3. Optionally specify a player number (1-18) to reconnect to a previous session
4. Click "Join Game" or "Reconnect"

### Playing the Game
1. Wait for other players to join (minimum 2 players)
2. Any player can click "Start Game" to begin
3. Play cards that match the suit or rank of the top card, or play any 7
4. Click on cards in your hand to play them when it's your turn
5. First player to empty their hand wins!

### Admin Functions
Admins can use the admin panel with the password `admin123` (change in server.js):
- **Restart Game**: Clears the current game and allows a fresh start
- **Drop Player**: Forcibly disconnects a specific player number

## Technical Details

### Architecture
- **Backend**: Node.js with Express server
- **Real-time Communication**: Socket.IO for WebSocket connections
- **Frontend**: Vanilla HTML, CSS, and JavaScript
- **Player Management**: Stable slot system (1-18) with reconnection support

### Key Files
- `server.js`: Main server file with game logic and WebSocket handling
- `public/index.html`: Frontend HTML structure
- `public/styles.css`: Game styling and responsive design
- `public/game.js`: Frontend JavaScript game logic
- `package.json`: Project dependencies and scripts

### Configuration
- **Max Players**: 18 (configurable in server.js)
- **Default Port**: 3000 (configurable via PORT environment variable)
- **Admin Password**: `admin123` (change in server.js for production)

## Player Management System

### Stable Player Numbers
- Each player gets assigned a number from 1-18
- These numbers persist across disconnections and reconnections
- Players can specify their preferred number when joining (if available)

### Reconnection Process
1. Player enters their previous player number
2. Clicks "Reconnect" instead of "Join Game"  
3. If the slot exists and was previously occupied, player resumes their position
4. Player retains their cards and game state

### Admin Controls
Administrators can manage problematic situations:
- **Restart Game**: Useful when games get stuck or need a fresh start
- **Drop Player**: Removes a player who may be unresponsive or causing issues

## Deployment

### Local Development
```bash
npm start
```

### Production Deployment
1. Set environment variables:
   ```bash
   export PORT=3000
   ```
2. Change admin password in `server.js`
3. Run with process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start server.js --name "flip7-game"
   ```

### Environment Variables
- `PORT`: Server port (default: 3000)

## Troubleshooting

### Common Issues
1. **Game won't start**: Ensure at least 2 players have joined
2. **Can't reconnect**: Check that you're using the correct player number
3. **Cards won't play**: Ensure it's your turn and the card matches suit/rank or is a 7
4. **Connection issues**: Check that the server is running and accessible

### Admin Solutions
- Use admin controls to restart stuck games
- Drop unresponsive players to keep games moving
- Check server logs for connection issues

## Development

### Adding Features
The codebase is modular and well-commented. Key areas for expansion:
- **Game Logic**: Modify rules in `server.js`
- **UI/UX**: Update styles in `public/styles.css` and layout in `public/index.html`
- **Client Logic**: Enhance frontend behavior in `public/game.js`

### Testing
- Test with multiple browser tabs for local multiplayer simulation
- Use browser developer tools to simulate network issues
- Test reconnection by refreshing browser tabs

## License

MIT License - Feel free to modify and distribute as needed.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs for error messages  
3. Test with minimal setup (2 players, local network)