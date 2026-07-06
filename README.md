# Discord Bot

A multi-server Discord bot using Node.js and `discord.js`.

## Features

- `/ban` - ban a user
- `/kick` - kick a user
- `/mute` - timeout a user
- `/unmute` - remove timeout
- `/warn` - save a warning for a user
- `/warnings` - view saved warnings
- `/purge` - delete recent messages
- `/setlogs` - choose the moderation log channel
- `/setwelcome` - choose the welcome channel and welcome message
- `/setresponse` - add a custom auto-response
- `/setresponce` - same as `/setresponse`, included for the common typo
- `/delresponse` - remove a custom auto-response
- `/responses` - list custom auto-responses
- `/settings` - view the server setup
- `/userinfo` - view user info
- `/serverinfo` - view server info
- `/ping` - check latency
- `/help` - show the command list

Most replies use Discord embeds for a cleaner UI.

## Local Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create a file named `.env` in this folder.

3. Add your Discord values:

   ```env
   DISCORD_TOKEN=your_bot_token_here
   CLIENT_ID=your_application_client_id_here
   ```

   Leave `GUILD_ID` empty or remove it for a multi-server bot.

4. In the Discord Developer Portal, open your application, go to **Bot**, and enable these privileged gateway intents:

   ```text
   Server Members Intent
   Message Content Intent
   ```

   These are needed for welcome messages and auto-responses.

5. Invite the bot with these OAuth2 scopes:

   ```text
   bot
   applications.commands
   ```

6. Give the bot permissions such as:

   ```text
   Ban Members
   Kick Members
   Moderate Members
   Manage Messages
   Send Messages
   View Channels
   Read Message History
   Use Slash Commands
   ```

7. Start the bot:

   ```powershell
   npm start
   ```

## Deploy

Use Railway or Render.

### Railway

1. Push this folder to GitHub.
2. Create a new Railway project from that GitHub repository.
3. Add these environment variables in Railway:

   ```env
   DISCORD_TOKEN=your_bot_token_here
   CLIENT_ID=your_application_client_id_here
   ```

4. Set the start command to:

   ```text
   npm start
   ```

5. Deploy.

### Render

1. Push this folder to GitHub.
2. Create a new **Background Worker** from that repository.
3. Use this build command:

   ```text
   npm install
   ```

4. Use this start command:

   ```text
   npm start
   ```

5. Add the same environment variables listed above, then deploy.

## Notes

Slash commands are global when `GUILD_ID` is not set, so they can take a little while to appear in every server.

Server settings, warnings, and auto-responses are saved locally in `data/guilds.json`.
