require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  REST,
  Routes
} = require("discord.js");
const { getGuild } = require("./lib/storage");
const ui = require("./lib/ui");

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in your .env file.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

const commands = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if (!command.data || !command.execute) {
    console.warn(`Skipping ${file}: command must export data and execute.`);
    continue;
  }

  client.commands.set(command.data.name, command);
  commands.push(command.data.toJSON());
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands
    });
    console.log(`Registered ${commands.length} command(s) for guild ${GUILD_ID}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log(`Registered ${commands.length} global command(s).`);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);
});

client.on(Events.GuildMemberAdd, async (member) => {
  const settings = getGuild(member.guild.id);
  if (!settings.welcomeChannelId) return;

  const channel = await member.guild.channels.fetch(settings.welcomeChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const message = settings.welcomeMessage
    .replaceAll("{user}", `${member}`)
    .replaceAll("{server}", member.guild.name);

  await channel.send(ui.success("Welcome", message));
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;

  const settings = getGuild(message.guild.id);
  const content = message.content.toLowerCase();

  for (const [trigger, reply] of Object.entries(settings.responses)) {
    if (content.includes(trigger)) {
      await message.reply({
        allowedMentions: { repliedUser: false },
        ...ui.info("Auto-response", reply)
      });
      break;
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);

    const response = {
      ...ui.danger("Command failed", "Something went wrong while running that command."),
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
});

registerCommands()
  .then(() => client.login(DISCORD_TOKEN))
  .catch((error) => {
    console.error("Failed to start bot:", error);
    process.exit(1);
  });
