# Discord Bot

A feature-rich Discord bot with moderation tools, logging, chat filtering, and auto-moderation features.

## Features

- **Moderation**: Kick, ban, mute, warn members
- **Logging**: Log all moderation actions to a designated channel
- **Chat Filter**: Block specific words
- **Anti-Ping System**: Prevent @everyone and @here mentions
- **Invite Filter**: Automatically delete Discord invites
- **User/Server Info**: Get detailed information about users and servers
- **Channel Management**: Lock/unlock channels

## Setup

### 1. Prerequisites
- Node.js 18+ installed
- A Discord bot created on [Discord Developer Portal](https://discord.com/developers/applications)
- Your bot token and client ID

### 2. Installation

```bash
npm install
```

### 3. Environment Variables

Create a `.env` file in the root directory (copy from `.env.example`):

```
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
```

### 4. Running Locally

```bash
npm start
```

## Deployment

### Railway (Recommended for beginners)
1. Push to GitHub
2. Connect Railway to your GitHub repo
3. Add environment variables (`DISCORD_TOKEN`, `CLIENT_ID`) in Railway dashboard
4. Deploy

### Replit
1. Create a new Replit project from GitHub
2. Add secrets (`DISCORD_TOKEN`, `CLIENT_ID`)
3. Run `npm start`

### VPS (DigitalOcean, AWS, etc.)
1. Clone repository
2. Run `npm install`
3. Set environment variables
4. Use a process manager like `pm2` to keep bot running

## Commands

- `/ping` - Check bot latency
- `/help` - Show all commands
- `/kick <member>` - Kick a member
- `/ban <member>` - Ban a member
- `/mute <member>` - Mute a member
- `/warn <user> <reason>` - Warn a user
- `/filter add/remove/list` - Manage word filter
- `/antiping on/off` - Toggle anti-ping system
- `/lock` / `/unlock` - Lock/unlock channel
- And more...

## License

MIT
