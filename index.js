require('dotenv').config();
const http = require('http');
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  EmbedBuilder,
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');

// ==================== CONFIGURATION ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const KICK_CLIENT_ID = process.env.KICK_CLIENT_ID;
const KICK_CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;

// ==================== UI THEME ====================
// Palette pulled from the "Full Moon" client theme reference: Discord-native status
// colors (green/yellow/red/purple) plus a signature gold accent for highlights.
const THEME = {
  success: 0x43b581,   // theme --green
  error: 0xf04747,     // theme --red
  warning: 0xfaa61a,   // theme --yellow
  info: 0x3b6ea5,      // steel blue (kept — theme has no dedicated "info" color)
  primary: 0x2c3e50,   // deep slate navy — base/neutral embed color
  danger: 0xf04747,
  mute: 0xfaa61a,
  level: 0x546e8a,     // slate blue-gray
  kick: 0x53fc18,      // Kick's own brand green — kept for recognizability
  streaming: 0x593695, // theme --purple — Discord's native "streaming" status color
  accent: 0xffe066,    // theme's signature gold — selected-channel / mention highlight color
};
const BRAND_NAME = 'Full Moon';
const FOOTER_ICON = 'https://cdn.discordapp.com/emojis/879640511815659570.gif';
const brandFooter = (text) => ({ text: `${BRAND_NAME}  •  ${text}`, iconURL: FOOTER_ICON });
const brandAuthor = () => ({ name: `${BRAND_NAME}`, iconURL: client.user?.displayAvatarURL() || FOOTER_ICON });
const DIVIDER = '─────────────────────────';
const GOLD_ACCENT = '✦'; // theme's gold highlight, used as a small bullet on key fields

// Welcome banner image — shown as the big image on the welcome embed.
// NOTE: this was originally a signed Discord CDN attachment link (with ?ex=&is=&hm= params),
// which expire after ~24h. Those query params have been stripped since they're single-use;
// if the image stops loading, re-upload the GIF to your bot (see /assets/welcome-banner.gif
// fallback pattern) instead of relying on a Discord CDN link.
const WELCOME_BANNER_URL = 'https://cdn.discordapp.com/attachments/1268947950361645137/1514952441811046543/standard_35.gif';

// Small status-badge helper for consistent on/off/live indicators across embeds.
function statusBadge(isActive, onLabel = 'Enabled', offLabel = 'Disabled') {
  return isActive ? `🟢 ${onLabel}` : `⚪ ${offLabel}`;
}

// ==================== DATA STORAGE ====================
const warnings = {};
const antiPing = {};
const chatFilters = {};
const logChannels = {};
const welcomeChannels = {};
const autoRoles = {};
const welcomeEnabled = {};
const welcomeMessages = {};
const userLevels = {};
const snipedMessages = {};
const levelSystemEnabled = {};
const kickAnnouncements = {}; // guildId -> { kickUsername, channelId, roleId, messageTemplate, isLive, lastSessionId }

const DEFAULT_WELCOME_MESSAGE = "Welcome to **{server}**, {user}!\nWe're glad to have you here.";
const DEFAULT_KICK_MESSAGE = '🔴 **{streamer}** just went live on Kick!';

const DEFAULT_FILTER_WORDS = [
  'fuck', 'fucker', 'fucking', 'shit', 'bullshit', 'bitch', 'asshole', 'bastard',
  'dick', 'piss', 'cunt', 'whore', 'slut', 'douchebag', 'motherfucker',
  'चूतिया', 'भोसड़ी', 'मादरचोद', 'बहनचोद', 'रंडी', 'गांडू', 'लौड़ा', 'साला', 'कमीना', 'हरामी',
  'chutiya', 'chutiye', 'bhosdi', 'bhosdike', 'bhosadi', 'madarchod', 'mc', 'bc',
  'bhenchod', 'behenchod', 'randi', 'gandu', 'gaandu', 'lauda', 'lund', 'loda',
  'saala kutta', 'kamina', 'kamine', 'harami', 'chodu', 'chinal', 'raand', 'suar',
];

const LOG_ACTIONS = {
  general: { label: 'General (fallback for everything else)', emoji: '📋' },
  ban: { label: 'Bans', emoji: '🔨' },
  kick: { label: 'Kicks', emoji: '👢' },
  mute: { label: 'Mutes / Unmutes', emoji: '🔇' },
  warn: { label: 'Warnings (issued & cleared)', emoji: '⚠️' },
  purge: { label: 'Purge / Clear', emoji: '🧹' },
  lock: { label: 'Channel Lock / Unlock', emoji: '🔒' },
  antiping: { label: 'Anti-Ping / Invite Filter', emoji: '🛡️' },
  message: { label: 'Message Edits & Deletes', emoji: '✏️' },
  member: { label: 'Member Join / Leave', emoji: '👤' },
};
const LOG_ACTION_CHOICES = Object.entries(LOG_ACTIONS).map(([value, meta]) => ({ name: `${meta.emoji} ${meta.label}`, value }));

async function sendLog(guild, embed, action = 'general') {
  const guildConfig = logChannels[guild.id];
  if (!guildConfig) return;
  const channelId = guildConfig[action] || guildConfig.general;
  if (!channelId) return;
  try {
    const channel = await guild.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Error sending log:', error);
  }
}

// ==================== LEVEL SYSTEM HELPERS ====================
function getUserLevelData(guildId, userId) {
  if (!userLevels[guildId]) userLevels[guildId] = {};
  if (!userLevels[guildId][userId]) {
    userLevels[guildId][userId] = { xp: 0, lastMessage: 0 };
  }
  return userLevels[guildId][userId];
}
function getLevelFromXp(xp) {
  return Math.floor(Math.sqrt(xp / 100));
}
function getXpForLevel(level) {
  return level * level * 100;
}
function progressBar(current, total, size = 12) {
  const pct = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
  const filled = Math.round(size * pct);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)} ${Math.round(pct * 100)}%`;
}

// ==================== KICK LIVE ANNOUNCEMENT HELPERS ====================
const KICK_POLL_INTERVAL_MS = 3 * 60 * 1000; // conservative — avoid hammering Kick's API
let kickAppToken = null;
let kickAppTokenExpiresAt = 0;

/** Fetches (and caches) a Kick app access token via the client-credentials grant. */
async function getKickAppToken() {
  if (kickAppToken && Date.now() < kickAppTokenExpiresAt - 30_000) {
    return kickAppToken;
  }
  if (!KICK_CLIENT_ID || !KICK_CLIENT_SECRET) {
    throw new Error('KICK_CLIENT_ID / KICK_CLIENT_SECRET not configured');
  }
  const res = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: KICK_CLIENT_ID,
      client_secret: KICK_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Kick token request failed: ${res.status}`);
  const data = await res.json();
  kickAppToken = data.access_token;
  kickAppTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return kickAppToken;
}

/** Looks up a public Kick channel (and its livestream, if any) by slug/username. */
async function fetchKickChannel(slug) {
  const token = await getKickAppToken();
  const res = await fetch(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Kick API returned ${res.status}`);
  const body = await res.json();
  const channel = body?.data?.[0];
  if (!channel) throw new Error('Channel not found');
  return channel;
}

/** Renders a Kick announcement message template, substituting {streamer} {url} {role}. */
function renderKickMessage(template, { kickUsername, channelData, roleId }) {
  const rendered = template
    .replaceAll('{streamer}', channelData?.slug || kickUsername)
    .replaceAll('{url}', `https://kick.com/${kickUsername}`)
    .replaceAll('{role}', roleId ? `<@&${roleId}>` : '');

  // If a role is configured but the template didn't reference {role}, ping it anyway.
  if (roleId && !template.includes('{role}')) {
    return `<@&${roleId}> ${rendered}`;
  }
  return rendered;
}

function buildKickLiveEmbed(slug, channel) {
  const stream = channel.stream;
  return new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setTitle(`🔴 ${channel.slug || slug} is now LIVE on Kick!`)
    .setURL(`https://kick.com/${slug}`)
    .setDescription(`**${channel.stream_title || 'No title set'}**\n\n${DIVIDER}\n\n🎮 **Category:** ${channel.category?.name || 'N/A'}\n👀 **Viewers:** ${stream?.viewer_count ?? 'N/A'}`)
    .setColor(THEME.kick)
    .setImage(stream?.thumbnail || null)
    .setThumbnail(channel.banner_picture || null)
    .setTimestamp()
    .setFooter(brandFooter('Kick Live Announcement'));
}

/** Polls every configured guild's tracked Kick channel and announces new live sessions. */
async function pollKickStreams() {
  for (const [guildId, config] of Object.entries(kickAnnouncements)) {
    if (!config?.kickUsername || !config?.channelId) continue;
    try {
      const channelData = await fetchKickChannel(config.kickUsername);
      const isLiveNow = !!channelData.stream?.is_live;
      const sessionKey = channelData.stream?.start_time || null;

      if (isLiveNow && (!config.isLive || config.lastSessionId !== sessionKey)) {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) continue;
        const channel = await guild.channels.fetch(config.channelId).catch(() => null);
        if (channel?.isTextBased()) {
          const template = config.messageTemplate || DEFAULT_KICK_MESSAGE;
          const content = renderKickMessage(template, { kickUsername: config.kickUsername, channelData, roleId: config.roleId });
          await channel.send({ content, embeds: [buildKickLiveEmbed(config.kickUsername, channelData)] }).catch(err => console.error('Kick announce send error:', err));
        }
        config.isLive = true;
        config.lastSessionId = sessionKey;
      } else if (!isLiveNow) {
        config.isLive = false;
      }
    } catch (error) {
      console.error(`Kick poll error for ${config.kickUsername}:`, error.message);
    }
  }
}

// ==================== HELPER FUNCTIONS ====================
function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}
function isGuildOwner(member) {
  return member.guild.ownerId === member.id;
}
function canModerate(moderator, target) {
  if (isGuildOwner(target)) return false;
  if (target.id === moderator.id) return false;
  return moderator.roles.highest.position > target.roles.highest.position;
}
function canBotModerate(guild, target) {
  const me = guild.members.me;
  if (!me) return false;
  if (isGuildOwner(target)) return false;
  return me.roles.highest.position > target.roles.highest.position;
}

function successEmbed(title, description) {
  return new EmbedBuilder().setAuthor(brandAuthor()).setTitle(`✅ ${title}`).setDescription(description).setColor(THEME.success).setTimestamp().setFooter(brandFooter('Action Completed'));
}
function errorEmbed(title, description) {
  return new EmbedBuilder().setAuthor(brandAuthor()).setTitle(`❌ ${title}`).setDescription(description).setColor(THEME.error).setTimestamp().setFooter(brandFooter('Error'));
}
function infoEmbed(title, description) {
  return new EmbedBuilder().setAuthor(brandAuthor()).setTitle(`ℹ️ ${title}`).setDescription(description).setColor(THEME.info).setTimestamp().setFooter(brandFooter('Information'));
}
function warningEmbed(title, description) {
  return new EmbedBuilder().setAuthor(brandAuthor()).setTitle(`⚠️ ${title}`).setDescription(description).setColor(THEME.warning).setTimestamp().setFooter(brandFooter('Warning'));
}

async function safeInteractionReply(interaction, response) {
  if (interaction.deferred) return interaction.editReply(response);
  if (interaction.replied) return interaction.followUp(response);
  return interaction.reply(response);
}

async function confirmAction(interaction, { title, description }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm').setLabel('Confirm').setEmoji('✅').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setEmoji('❌').setStyle(ButtonStyle.Secondary),
  );
  const embed = new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setTitle(`⚠️ ${title}`)
    .setDescription(`${description}\n\n${DIVIDER}\n\n*This action cannot be undone.*`)
    .setColor(THEME.warning)
    .setTimestamp();

  const message = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

  try {
    const btn = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (b) => b.user.id === interaction.user.id,
      time: 15_000,
    });
    await btn.deferUpdate();
    return btn.customId === 'confirm';
  } catch {
    await interaction.editReply({ components: [] }).catch(() => {});
    return null;
  }
}

function hasInvite(content) {
  const inviteRegex = /(https?:\/\/)?(www\.)?(discord\.gg|discordapp\.com\/invite|discord\.com\/invite)\/[^\s]+/gi;
  return inviteRegex.test(content);
}
function hasMentions(message) {
  return message.mentions.everyone || message.mentions.members.size > 0 || message.mentions.roles.size > 0;
}
function renderWelcomeMessage(template, member) {
  return template
    .replaceAll('{user}', `${member}`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{membercount}', `${member.guild.memberCount}`);
}

// ==================== SLASH COMMAND REGISTRATION ====================
async function registerCommands() {
  const commands = [
    { name: 'ping', description: 'Check bot latency' },
    { name: 'help', description: 'Show all available commands' },
    { name: 'dashboard', description: 'View all server configuration in one place' },
    {
      name: 'level',
      description: 'Show your (or someone else\'s) level and XP',
      options: [{ name: 'user', description: 'User to check', type: 6, required: false }],
    },
    {
      name: 'rank',
      description: 'Check your (or someone else\'s) rank card',
      options: [{ name: 'user', description: 'User to check', type: 6, required: false }],
    },
    { name: 'leaderboard', description: 'Show the top 10 members by XP in this server' },
    {
      name: 'levelsystem',
      description: 'Admin: enable or disable the XP/level system in this server',
      options: [{
        name: 'state', description: 'Enable or disable', type: 3, required: true,
        choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }],
      }],
    },
    {
      name: 'userinfo',
      description: 'Get information about a user',
      options: [{ name: 'user', description: 'The user to get info about', type: 6, required: false }],
    },
    { name: 'serverinfo', description: 'Get information about the server' },
    {
      name: 'avatar',
      description: "Get a user's avatar",
      options: [{ name: 'user', description: 'User to check', type: 6, required: false }],
    },
    {
      name: 'kick',
      description: 'Kick a member from the server',
      options: [
        { name: 'member', description: 'Member to kick', type: 6, required: true },
        { name: 'reason', description: 'Reason for kick', type: 3, required: false },
      ],
    },
    {
      name: 'ban',
      description: 'Ban a member from the server',
      options: [
        { name: 'member', description: 'Member to ban', type: 6, required: true },
        { name: 'reason', description: 'Reason for ban', type: 3, required: false },
      ],
    },
    {
      name: 'mute',
      description: 'Mute (timeout) a member',
      options: [
        { name: 'member', description: 'Member to mute', type: 6, required: true },
        { name: 'minutes', description: 'Duration in minutes (max 40320 / 28 days)', type: 4, required: false },
        { name: 'reason', description: 'Reason for mute', type: 3, required: false },
      ],
    },
    {
      name: 'unmute',
      description: 'Unmute a member',
      options: [{ name: 'member', description: 'Member to unmute', type: 6, required: true }],
    },
    {
      name: 'warn',
      description: 'Warn a user',
      options: [
        { name: 'user', description: 'User to warn', type: 6, required: true },
        { name: 'reason', description: 'Reason for warning', type: 3, required: true },
      ],
    },
    {
      name: 'warnings',
      description: 'View warnings for a user',
      options: [{ name: 'user', description: 'User to check', type: 6, required: true }],
    },
    {
      name: 'clearwarnings',
      description: 'Clear all warnings for a user',
      options: [{ name: 'user', description: 'User to clear warnings for', type: 6, required: true }],
    },
    {
      name: 'clear',
      description: 'Delete messages',
      options: [{ name: 'amount', description: 'Number of messages (1-100)', type: 4, required: true }],
    },
    {
      name: 'purge',
      description: 'Purge messages with advanced filters',
      options: [
        { name: 'amount', description: 'Number of messages (1-100)', type: 4, required: true },
        { name: 'user', description: 'Delete messages from specific user', type: 6, required: false },
        { name: 'contains', description: 'Delete messages containing this text', type: 3, required: false },
      ],
    },
    { name: 'lock', description: 'Lock a channel (disable messages)' },
    { name: 'unlock', description: 'Unlock a channel (enable messages)' },
    {
      name: 'antiping',
      description: 'Anti-ping system management',
      options: [{
        name: 'action', description: 'Enable or disable', type: 3, required: true,
        choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }],
      }],
    },
    {
      name: 'filter',
      description: 'Chat filter management',
      options: [
        {
          name: 'action', description: 'Action to perform', type: 3, required: true,
          choices: [
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' },
            { name: 'list', value: 'list' },
            { name: 'reset (load default English/Hindi/Hinglish list)', value: 'reset' },
            { name: 'clear (empty the list, disables filter)', value: 'clear' },
          ],
        },
        { name: 'word', description: 'Word(s) to add/remove — separate multiple with commas, e.g. "word1, word2, word3"', type: 3, required: false },
      ],
    },
    {
      name: 'setlog',
      description: 'Set the log channel for a specific action type (or general fallback)',
      options: [
        { name: 'channel', description: 'Channel for these logs', type: 7, required: true },
        {
          name: 'action', description: 'Which action to route to this channel (default: general)', type: 3, required: false,
          choices: LOG_ACTION_CHOICES.map(c => ({ name: c.name.replace(/^\S+\s/, ''), value: c.value })),
        },
      ],
    },
    {
      name: 'removelog',
      description: 'Remove a per-action log channel (falls back to general)',
      options: [
        {
          name: 'action', description: 'Which action to unset', type: 3, required: true,
          choices: LOG_ACTION_CHOICES.filter(c => c.value !== 'general').map(c => ({ name: c.name.replace(/^\S+\s/, ''), value: c.value })),
        },
      ],
    },
    { name: 'logs', description: 'View the current log channel configuration' },
    {
      name: 'setwelcome',
      description: 'Set the welcome channel',
      options: [{ name: 'channel', description: 'Channel to send welcome messages', type: 7, required: true }],
    },
    {
      name: 'setautorole',
      description: 'Set the auto role for new members',
      options: [{ name: 'role', description: 'Role to give new members', type: 8, required: true }],
    },
    {
      name: 'welcome',
      description: 'Enable or disable the welcome system',
      options: [{
        name: 'state', description: 'Enable or disable', type: 3, required: true,
        choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }],
      }],
    },
    {
      name: 'setwelcomemessage',
      description: 'Customize the welcome message text',
      options: [{ name: 'message', description: 'Use {user} {username} {server} {membercount} as placeholders', type: 3, required: true }],
    },
    { name: 'welcomemessage', description: 'Preview the current welcome message' },
    { name: 'snipe', description: 'View the last deleted message in this channel' },
    {
      name: 'setkickchannel',
      description: 'Announce when a Kick.com streamer goes live',
      options: [
        { name: 'kickuser', description: 'Kick.com username (from kick.com/username)', type: 3, required: true },
        { name: 'channel', description: 'Channel to post the announcement in', type: 7, required: true },
        { name: 'role', description: 'Optional role to ping when they go live', type: 8, required: false },
        { name: 'message', description: 'Custom message. Placeholders: {streamer} {url} {role}', type: 3, required: false, max_length: 500 },
      ],
    },
    {
      name: 'setkickmessage',
      description: 'Update just the custom Kick live announcement message',
      options: [{ name: 'message', description: 'Custom message. Placeholders: {streamer} {url} {role}. Leave blank to reset to default.', type: 3, required: false, max_length: 500 }],
    },
    { name: 'removekickchannel', description: 'Stop Kick live announcements in this server' },
    { name: 'kickstatus', description: 'Check the current Kick announcement configuration' },
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const GUILD_ID = process.env.GUILD_ID;

  try {
    console.log('Starting to register slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`✓ Successfully registered ${commands.length} slash commands globally`);

    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log(`✓ Also registered ${commands.length} slash commands instantly to guild ${GUILD_ID}`);
    }
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// ==================== COMMAND HANDLERS ====================

async function handlePing(interaction) {
  const latency = interaction.client.ws.ping;
  const speedStatus = latency < 100 ? '⚡ Excellent' : latency < 200 ? '✅ Good' : latency < 500 ? '⚠️ Fair' : '🐌 Slow';
  const color = latency < 100 ? THEME.success : latency < 200 ? THEME.info : latency < 500 ? THEME.warning : THEME.error;

  await interaction.reply({
    embeds: [
      new EmbedBuilder().setAuthor(brandAuthor())
        .setTitle('🏓 Pong!')
        .setDescription(`${DIVIDER}\n\n**Latency:** \`${latency}ms\`\n**Status:** ${speedStatus}\n**Uptime:** <t:${Math.floor((Date.now() - client.uptime) / 1000)}:R>`)
        .setColor(color)
        .setTimestamp()
        .setFooter(brandFooter('Performance Check')),
    ],
  });
}

const HELP_CATEGORIES = {
  overview: { label: '📖 Overview', emoji: '📖' },
  moderation: {
    label: '🛡️ Moderation',
    emoji: '🛡️',
    commands: ['`/kick <member> [reason]`', '`/ban <member> [reason]`', '`/mute <member> [minutes] [reason]`', '`/unmute <member>`', '`/warn <user> <reason>`', '`/warnings <user>`', '`/clearwarnings <user>`', '`/clear <amount>`', '`/purge <amount> [user] [contains]`', '`/snipe` — View last deleted message'],
  },
  security: {
    label: '🔐 Security',
    emoji: '🔐',
    commands: ['`/antiping on|off`', '`/filter add|remove|list|reset|clear [word]` — add/remove accept comma-separated lists; `reset` loads a basic English/Hindi/Hinglish profanity list', '`/lock` — Disable messages here', '`/unlock` — Re-enable messages', '`/setautorole <role>`', '`/welcome on|off`', '`/setwelcome <channel>`'],
  },
  logging: {
    label: '📋 Logging',
    emoji: '📋',
    commands: ['`/setlog <channel> [action]` — Route a specific action to a channel', '`/removelog <action>` — Unset a per-action log channel', '`/logs` — View the current log configuration'],
  },
  utility: {
    label: '⚙️ Utility',
    emoji: '⚙️',
    commands: ['`/ping` — Latency check', '`/help` — This menu', '`/dashboard` — Full server configuration overview', '`/userinfo [user]`', '`/serverinfo`', '`/avatar [user]`', '`/setwelcomemessage <message>`'],
  },
  community: {
    label: '🎮 Community',
    emoji: '🎮',
    commands: ['`/rank [user]` — Rank card', '`/level [user]` — XP & level card', '`/leaderboard` — Top 10 by XP', '`/levelsystem on|off` — Admin: enable/disable XP tracking', '`/welcomemessage` — Preview welcome text'],
  },
  streaming: {
    label: '📺 Streaming',
    emoji: '📺',
    commands: [
      '`/setkickchannel <kickuser> <channel> [role] [message]` — Admin: announce when a Kick streamer goes live',
      '`/setkickmessage [message]` — Admin: update just the announcement text',
      '`/removekickchannel` — Admin: stop Kick announcements',
      '`/kickstatus` — View current Kick announcement config',
      '💬 Message placeholders: `{streamer}` `{url}` `{role}`',
    ],
  },
};
const HELP_PAGE_ORDER = ['overview', 'moderation', 'security', 'logging', 'utility', 'community', 'streaming'];

function buildHelpEmbed(pageKey, guild) {
  const embed = new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setColor(THEME.primary)
    .setTimestamp()
    .setFooter(brandFooter('Pick a category below • Need more help? Ask a server admin'));

  if (pageKey === 'overview') {
    const summaryLines = HELP_PAGE_ORDER.slice(1)
      .map((k) => `${HELP_CATEGORIES[k].label} — **${HELP_CATEGORIES[k].commands.length}** Commands`)
      .join('\n\n');
    embed
      .setTitle('Full Moon — Command Directory')
      .setDescription(`Your complete moderation & community toolkit for **${guild ? guild.name : 'your server'}**.\n\n${DIVIDER}\n\nUse the dropdown below to jump straight to a category. For a live snapshot of your current settings, run \`/dashboard\`.`)
      .addFields({ name: '📊 Categories', value: summaryLines, inline: false })
      .setThumbnail(guild?.iconURL({ size: 256 }) || null);
  } else {
    const cat = HELP_CATEGORIES[pageKey];
    embed
      .setTitle(cat.label)
      .setDescription(`${DIVIDER}\n\n${cat.commands.join('\n\n')}`);
  }
  return embed;
}

function buildHelpSelectRow(currentKey, userId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`help_select_${userId}`)
    .setPlaceholder('📂 Choose a category to view...')
    .addOptions(HELP_PAGE_ORDER.map((key) => {
      const cat = HELP_CATEGORIES[key];
      return new StringSelectMenuOptionBuilder()
        .setLabel(cat.label.replace(/^\S+\s/, ''))
        .setValue(key)
        .setEmoji(cat.emoji)
        .setDefault(key === currentKey);
    }));
  return new ActionRowBuilder().addComponents(menu);
}

async function handleHelp(interaction) {
  let currentKey = 'overview';
  const message = await interaction.reply({
    embeds: [buildHelpEmbed(currentKey, interaction.guild)],
    components: [buildHelpSelectRow(currentKey, interaction.user.id)],
    fetchReply: true,
  });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    time: 120_000,
    filter: (menu) => menu.user.id === interaction.user.id,
  });

  collector.on('collect', async (menu) => {
    currentKey = menu.values[0];
    await menu.update({ embeds: [buildHelpEmbed(currentKey, interaction.guild)], components: [buildHelpSelectRow(currentKey, interaction.user.id)] });
  });

  collector.on('end', async () => {
    const disabledRow = buildHelpSelectRow(currentKey, interaction.user.id);
    disabledRow.components[0].setDisabled(true);
    await interaction.editReply({ components: [disabledRow] }).catch(() => {});
  });
}

// ==================== DASHBOARD ====================
// A single, professional overview of every configurable system — no need to run
// five separate /status-style commands to see the full picture.

const DASHBOARD_SECTIONS = {
  overview: { label: 'Overview', emoji: '🗂️' },
  security: { label: 'Security', emoji: '🛡️' },
  logging: { label: 'Logging', emoji: '📋' },
  welcome: { label: 'Welcome & Roles', emoji: '👋' },
  leveling: { label: 'Leveling', emoji: '📈' },
  kick: { label: 'Kick Live', emoji: '📺' },
  system: { label: 'System', emoji: '⚙️' },
};
const DASHBOARD_ORDER = ['overview', 'security', 'logging', 'welcome', 'leveling', 'kick', 'system'];

/** Formats a millisecond duration as a compact "1d 4h 32m" style string. */
function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

/** Classifies latency into a plain-language responsiveness tier. */
function responsivenessTier(latencyMs) {
  if (latencyMs < 100) return { label: 'Excellent', badge: '🟢' };
  if (latencyMs < 200) return { label: 'Good', badge: '🟢' };
  if (latencyMs < 500) return { label: 'Fair', badge: '🟡' };
  return { label: 'Degraded', badge: '🔴' };
}

function buildDashboardEmbed(sectionKey, guild) {
  const guildId = guild.id;
  const embed = new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setColor(THEME.primary)
    .setTimestamp()
    .setFooter(brandFooter('Server Dashboard'));

  if (sectionKey === 'overview') {
    const antiPingOn = !!antiPing[guildId];
    const filterOn = (chatFilters[guildId]?.length || 0) > 0;
    const welcomeOn = welcomeEnabled[guildId] !== false && !!welcomeChannels[guildId];
    const levelOn = levelSystemEnabled[guildId] !== false;
    const kickOn = !!kickAnnouncements[guildId];
    const logCount = Object.keys(logChannels[guildId] || {}).length;
    const latency = client.ws.ping;
    const tier = responsivenessTier(latency);

    embed
      .setTitle('🗂️  Server Dashboard')
      .setDescription(`${DIVIDER}\n\nConfiguration summary for **${guild.name}**. Use the dropdown below to inspect a specific system.`)
      .setThumbnail(guild.iconURL({ size: 256 }) || null)
      .addFields(
        { name: '🛡️ Security', value: `Anti-Ping: ${statusBadge(antiPingOn)}\n\nChat Filter: ${statusBadge(filterOn)}`, inline: true },
        { name: '📋 Logging', value: logCount > 0 ? `🟢 ${logCount} channel(s) configured` : '⚪ Not configured', inline: true },
        { name: '👋 Welcome', value: statusBadge(welcomeOn), inline: true },
        { name: '📈 Leveling', value: statusBadge(levelOn), inline: true },
        { name: '📺 Kick Live', value: statusBadge(kickOn, 'Tracking', 'Not set'), inline: true },
        { name: `${GOLD_ACCENT} Responsiveness`, value: `${tier.badge} ${latency}ms (${tier.label})`, inline: true },
      );
    return embed;
  }

  if (sectionKey === 'security') {
    const antiPingOn = !!antiPing[guildId];
    const filterWords = chatFilters[guildId]?.length || 0;
    embed
      .setTitle('🛡️  Security')
      .setDescription(DIVIDER)
      .addFields(
        { name: 'Anti-Ping / Invite Filter', value: statusBadge(antiPingOn), inline: true },
        { name: 'Chat Filter', value: filterWords > 0 ? `🟢 ${filterWords} word(s) blocked` : '⚪ No words filtered', inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: 'Manage', value: '`/antiping on|off`\n\n`/filter add|remove|list|reset|clear`', inline: false },
      );
    return embed;
  }

  if (sectionKey === 'logging') {
    const guildConfig = logChannels[guildId] || {};
    const lines = Object.entries(LOG_ACTIONS).map(([key, meta]) => {
      const channelId = guildConfig[key];
      const value = channelId ? `<#${channelId}>` : (key === 'general' ? '*Not set*' : '*Falls back to general*');
      return `**${meta.label}** — ${value}`;
    });
    embed
      .setTitle('📋  Logging')
      .setDescription(`${DIVIDER}\n\n${lines.join('\n\n')}`)
      .addFields({ name: 'Manage', value: '`/setlog <channel> [action]`\n\n`/removelog <action>`', inline: false });
    return embed;
  }

  if (sectionKey === 'welcome') {
    const channelId = welcomeChannels[guildId];
    const isEnabled = welcomeEnabled[guildId] !== false;
    const autoRoleId = autoRoles[guildId];
    const template = welcomeMessages[guildId] || DEFAULT_WELCOME_MESSAGE;
    embed
      .setTitle('👋  Welcome & Roles')
      .setDescription(DIVIDER)
      .addFields(
        { name: 'Status', value: statusBadge(isEnabled), inline: true },
        { name: 'Channel', value: channelId ? `<#${channelId}>` : '*Not set*', inline: true },
        { name: 'Auto Role', value: autoRoleId ? `<@&${autoRoleId}>` : '*Not set*', inline: true },
        { name: 'Message Template', value: `\`\`\`${template}\`\`\``, inline: false },
        { name: 'Manage', value: '`/setwelcome <channel>` · `/setautorole <role>` · `/welcome on|off` · `/setwelcomemessage <text>`', inline: false },
      );
    return embed;
  }

  if (sectionKey === 'leveling') {
    const isEnabled = levelSystemEnabled[guildId] !== false;
    const trackedUsers = Object.keys(userLevels[guildId] || {}).length;
    embed
      .setTitle('📈  Leveling')
      .setDescription(DIVIDER)
      .addFields(
        { name: 'Status', value: statusBadge(isEnabled), inline: true },
        { name: 'Members Tracked', value: `${trackedUsers}`, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: 'Manage', value: '`/levelsystem on|off`\n\n`/leaderboard` to view standings', inline: false },
      );
    return embed;
  }

  if (sectionKey === 'kick') {
    const config = kickAnnouncements[guildId];
    if (!config) {
      embed
        .setTitle('📺  Kick Live')
        .setColor(THEME.info)
        .setDescription(`${DIVIDER}\n\n⚪ Not configured yet.\n\nUse \`/setkickchannel\` to announce when a streamer goes live.`);
      return embed;
    }
    const template = config.messageTemplate || DEFAULT_KICK_MESSAGE;
    const preview = renderKickMessage(template, { kickUsername: config.kickUsername, channelData: { slug: config.kickUsername }, roleId: config.roleId });
    embed
      .setTitle('📺  Kick Live')
      .setColor(config.isLive ? THEME.streaming : THEME.info)
      .setDescription(DIVIDER)
      .addFields(
        { name: 'Streamer', value: `[${config.kickUsername}](https://kick.com/${config.kickUsername})`, inline: true },
        { name: 'Channel', value: `<#${config.channelId}>`, inline: true },
        { name: 'Currently Live', value: config.isLive ? '🟣 Yes — Streaming' : '⚪ No', inline: true },
        { name: 'Ping Role', value: config.roleId ? `<@&${config.roleId}>` : '*None*', inline: true },
        { name: 'Custom Message', value: config.messageTemplate ? '🟢 Set' : '⚪ Default', inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: `${GOLD_ACCENT} Message Preview`, value: preview, inline: false },
        { name: 'Manage', value: '`/setkickchannel`  ·  `/setkickmessage`  ·  `/removekickchannel`', inline: false },
      );
    return embed;
  }

  if (sectionKey === 'system') {
    const latency = client.ws.ping;
    const tier = responsivenessTier(latency);
    const uptime = formatUptime(client.uptime || 0);
    const totalGuilds = client.guilds.cache.size;
    const totalMembers = client.guilds.cache.reduce((sum, g) => sum + (g.memberCount || 0), 0);
    const memoryMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);

    embed
      .setTitle('⚙️  System & Responsiveness')
      .setColor(tier.badge === '🔴' ? THEME.error : tier.badge === '🟡' ? THEME.warning : THEME.success)
      .setDescription(DIVIDER)
      .addFields(
        { name: 'Response Time', value: `${tier.badge} ${latency}ms — **${tier.label}**`, inline: true },
        { name: 'Uptime', value: `🟢 ${uptime}`, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: 'Servers', value: `${totalGuilds}`, inline: true },
        { name: 'Members Reached', value: `${totalMembers.toLocaleString()}`, inline: true },
        { name: 'Memory Usage', value: `${memoryMb} MB`, inline: true },
      )
      .setFooter(brandFooter('Live system snapshot'));
    return embed;
  }

  return embed.setTitle('Unknown Section');
}

function buildDashboardSelectRow(currentKey, userId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`dashboard_select_${userId}`)
    .setPlaceholder('🗂️  Choose a system to inspect...')
    .addOptions(DASHBOARD_ORDER.map((key) => {
      const s = DASHBOARD_SECTIONS[key];
      return new StringSelectMenuOptionBuilder()
        .setLabel(s.label)
        .setValue(key)
        .setEmoji(s.emoji)
        .setDefault(key === currentKey);
    }));
  return new ActionRowBuilder().addComponents(menu);
}

async function handleDashboard(interaction) {
  let currentKey = 'overview';
  const message = await interaction.reply({
    embeds: [buildDashboardEmbed(currentKey, interaction.guild)],
    components: [buildDashboardSelectRow(currentKey, interaction.user.id)],
    fetchReply: true,
  });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    time: 180_000,
    filter: (menu) => menu.user.id === interaction.user.id,
  });

  collector.on('collect', async (menu) => {
    currentKey = menu.values[0];
    await menu.update({ embeds: [buildDashboardEmbed(currentKey, interaction.guild)], components: [buildDashboardSelectRow(currentKey, interaction.user.id)] });
  });

  collector.on('end', async () => {
    const disabledRow = buildDashboardSelectRow(currentKey, interaction.user.id);
    disabledRow.components[0].setDisabled(true);
    await interaction.editReply({ components: [disabledRow] }).catch(() => {});
  });
}

async function handleSnipe(interaction) {
  const sniped = snipedMessages[interaction.guildId]?.[interaction.channelId];
  if (!sniped) {
    return interaction.reply({ embeds: [infoEmbed('👀 Nothing to Snipe', 'No recently deleted messages found in this channel.')], ephemeral: true });
  }

  const snipeEmbed = new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setTitle('👀 Sniped Message')
    .setColor(THEME.warning)
    .addFields(
      { name: 'Author', value: sniped.authorTag, inline: true },
      { name: 'Channel', value: `${interaction.channel}`, inline: true },
    )
    .setDescription(`${DIVIDER}\n\n${sniped.content || '*No text content*'}`)
    .setThumbnail(sniped.authorAvatar)
    .setTimestamp(sniped.timestamp)
    .setFooter(brandFooter('Deleted Message'));

  await interaction.reply({ embeds: [snipeEmbed] });
}

async function handleLevel(interaction) {
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const guildId = interaction.guildId;
  const data = getUserLevelData(guildId, targetUser.id);
  const level = getLevelFromXp(data.xp);
  const currentLevelXp = getXpForLevel(level);
  const nextLevelXp = getXpForLevel(level + 1);
  const xpIntoLevel = data.xp - currentLevelXp;
  const xpNeeded = nextLevelXp - currentLevelXp;

  const sorted = Object.entries(userLevels[guildId] || {}).sort((a, b) => b[1].xp - a[1].xp);
  const rank = sorted.findIndex(([id]) => id === targetUser.id) + 1;

  const levelEmbed = new EmbedBuilder().setAuthor(brandAuthor())
    .setTitle(`🏆 ${targetUser.username}'s Rank Card`)
    .setColor(THEME.level)
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Level', value: `**${level}**`, inline: true },
      { name: 'Total XP', value: `**${data.xp}**`, inline: true },
      { name: 'Server Rank', value: rank > 0 ? `**#${rank}**` : 'Unranked', inline: true },
      { name: `Progress to Level ${level + 1}`, value: `\`${progressBar(xpIntoLevel, xpNeeded)}\`\n${xpIntoLevel} / ${xpNeeded} XP`, inline: false },
    )
    .setTimestamp()
    .setFooter(brandFooter('Level System'));

  await interaction.reply({ embeds: [levelEmbed] });
}

async function handleLevelSystemToggle(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }
  const state = interaction.options.getString('state');
  levelSystemEnabled[interaction.guildId] = state === 'on';
  await interaction.reply({
    embeds: [successEmbed('Level System', `The XP/level system is now **${state === 'on' ? 'ENABLED ✅' : 'DISABLED ❌'}** in this server.${state === 'off' ? '\n\nMembers will stop earning XP and level-up announcements will stop. Existing XP/levels are kept, not wiped.' : ''}`)],
  });
}

async function handleLeaderboard(interaction) {
  const guildId = interaction.guildId;
  const entries = Object.entries(userLevels[guildId] || {}).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);

  if (entries.length === 0) {
    await interaction.reply({ embeds: [infoEmbed('📊 Leaderboard', 'Nobody has earned any XP yet — start chatting to appear here!')] });
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = entries.map(([userId, data], i) => {
    const level = getLevelFromXp(data.xp);
    const rankIcon = medals[i] || `**#${i + 1}**`;
    return `${rankIcon} <@${userId}> — Level **${level}** (${data.xp} XP)`;
  });

  const leaderboardEmbed = new EmbedBuilder().setAuthor(brandAuthor())
    .setTitle(`📊 ${interaction.guild.name} Leaderboard`)
    .setColor(THEME.level)
    .setDescription(lines.join('\n\n'))
    .setThumbnail(interaction.guild.iconURL({ size: 256 }))
    .setTimestamp()
    .setFooter(brandFooter('Top 10 by XP'));

  await interaction.reply({ embeds: [leaderboardEmbed] });
}

async function handleUserInfo(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  const userInfoEmbed = new EmbedBuilder().setAuthor(brandAuthor())
    .setTitle(`👤 ${user.username}`)
    .setColor(THEME.primary)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'ID', value: `\`${user.id}\``, inline: true },
      { name: 'Type', value: user.bot ? '🤖 Bot' : '👥 User', inline: true },
      { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
    );

  if (member) {
    const statusEmoji = { online: '🟢', dnd: '🔴', idle: '🟡' }[member.presence?.status] || '⚫';
    const roleList = member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.toString()).join(', ') || 'No roles';
    userInfoEmbed.addFields(
      { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
      { name: 'Status', value: `${statusEmoji} ${member.presence?.status || 'offline'}`, inline: true },
      { name: `Roles (${member.roles.cache.size - 1})`, value: roleList, inline: false },
    );

    const guildId = interaction.guildId;
    if (userLevels[guildId]?.[user.id]) {
      const data = userLevels[guildId][user.id];
      userInfoEmbed.addFields({ name: 'Level', value: `Level ${getLevelFromXp(data.xp)} (${data.xp} XP)`, inline: true });
    }
  }

  userInfoEmbed.setTimestamp().setFooter(brandFooter('User Information'));
  await interaction.reply({ embeds: [userInfoEmbed] });
}

async function handleServerInfo(interaction) {
  const guild = interaction.guild;
  const botCount = guild.members.cache.filter(m => m.user.bot).size;

  const serverInfoEmbed = new EmbedBuilder().setAuthor(brandAuthor())
    .setTitle(`🏢 ${guild.name}`)
    .setColor(THEME.info)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .addFields(
      { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
      { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'ID', value: `\`${guild.id}\``, inline: true },
      { name: '👥 Members', value: `${guild.memberCount}`, inline: true },
      { name: '🤖 Bots', value: `${botCount}`, inline: true },
      { name: '💬 Boost Tier', value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount || 0} boosts)`, inline: true },
      { name: '📊 Channels', value: `**Text:** ${guild.channels.cache.filter(c => c.isTextBased()).size}\n\n**Voice:** ${guild.channels.cache.filter(c => c.isVoiceBased()).size}`, inline: true },
      { name: '🎭 Roles', value: `${guild.roles.cache.size}`, inline: true },
    )
    .setTimestamp()
    .setFooter(brandFooter('Server Statistics'));

  await interaction.reply({ embeds: [serverInfoEmbed] });
}

async function handleAvatar(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const avatarEmbed = new EmbedBuilder().setAuthor(brandAuthor())
    .setTitle(`🖼️ ${user.username}'s Avatar`)
    .setColor(THEME.primary)
    .setImage(user.displayAvatarURL({ size: 1024 }))
    .setTimestamp()
    .setFooter(brandFooter('Avatar'));
  await interaction.reply({ embeds: [avatarEmbed] });
}

async function handleKick(interaction) {
  const targetUser = interaction.options.getUser('member');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.KickMembers)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', '🔒 You need **Kick Members** permission to use this command.')], ephemeral: true });
  }
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return interaction.reply({ embeds: [errorEmbed('Member Not Found', '❓ The specified member could not be found.')], ephemeral: true });
  }
  if (!canModerate(moderator, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Kick', '⛔ You cannot kick this user due to role hierarchy or self-action.')], ephemeral: true });
  }
  if (!canBotModerate(interaction.guild, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Kick', "⛔ My role isn't high enough to kick this user. Move my role above theirs.")], ephemeral: true });
  }

  const confirmed = await confirmAction(interaction, {
    title: 'Confirm Kick',
    description: `Kick **${targetUser.tag}** from the server?\n**Reason:** \`${reason}\``,
  });
  if (confirmed === null) {
    return interaction.editReply({ embeds: [infoEmbed('Timed Out', 'No response received — kick cancelled.')], components: [] });
  }
  if (confirmed === false) {
    return interaction.editReply({ embeds: [infoEmbed('Cancelled', `Kick for **${targetUser.tag}** was cancelled.`)], components: [] });
  }

  try {
    await targetMember.kick(reason);
    await sendLog(interaction.guild, new EmbedBuilder()
      .setAuthor(brandAuthor())
      .setTitle('👢 Member Kicked').setColor(THEME.error).setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '👤 User', value: `${targetUser.tag}\n\`${targetUser.id}\``, inline: false },
        { name: '👮 Moderator', value: `${moderator.user.tag}`, inline: true },
        { name: '📝 Reason', value: `\`${reason}\``, inline: false },
      ).setTimestamp().setFooter(brandFooter('Member Action')), 'kick');

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setAuthor(brandAuthor())
        .setTitle('👢 Kick Successful')
        .setDescription(`**${targetUser.tag}** has been removed from the server.`)
        .addFields({ name: `${GOLD_ACCENT} Reason`, value: `\`${reason}\``, inline: false })
        .setColor(THEME.success).setThumbnail(targetUser.displayAvatarURL()).setTimestamp().setFooter(brandFooter('Action Completed'))],
      components: [],
    });
  } catch (error) {
    console.error('Kick error:', error);
    const description = error.code === 50013 ? "⚠️ I don't have permission to kick this member." : '⚠️ Could not kick the member. Please try again.';
    await interaction.editReply({ embeds: [errorEmbed('Kick Failed', description)], components: [] });
  }
}

async function handleBan(interaction) {
  const targetUser = interaction.options.getUser('member');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.BanMembers)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', '🔒 You need **Ban Members** permission to use this command.')], ephemeral: true });
  }
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (targetMember && !canModerate(moderator, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Ban', '⛔ You cannot ban this user due to role hierarchy or self-action.')], ephemeral: true });
  }
  if (targetMember && !canBotModerate(interaction.guild, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Ban', "⛔ My role isn't high enough to ban this user. Move my role above theirs.")], ephemeral: true });
  }

  const confirmed = await confirmAction(interaction, {
    title: 'Confirm Ban',
    description: `Permanently ban **${targetUser.tag}** from the server?\n**Reason:** \`${reason}\``,
  });
  if (confirmed === null) {
    return interaction.editReply({ embeds: [infoEmbed('Timed Out', 'No response received — ban cancelled.')], components: [] });
  }
  if (confirmed === false) {
    return interaction.editReply({ embeds: [infoEmbed('Cancelled', `Ban for **${targetUser.tag}** was cancelled.`)], components: [] });
  }

  try {
    await interaction.guild.bans.create(targetUser.id, { reason });
    await sendLog(interaction.guild, new EmbedBuilder()
      .setAuthor(brandAuthor())
      .setTitle('🔨 Member Banned').setColor(THEME.danger).setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '👤 User', value: `${targetUser.tag}\n\`${targetUser.id}\``, inline: false },
        { name: '👮 Moderator', value: `${moderator.user.tag}`, inline: true },
        { name: '📝 Reason', value: `\`${reason}\``, inline: false },
      ).setTimestamp().setFooter(brandFooter('Member Action')), 'ban');

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setAuthor(brandAuthor())
        .setTitle('🔨 Ban Successful')
        .setDescription(`**${targetUser.tag}** has been **permanently banned**.`)
        .addFields({ name: `${GOLD_ACCENT} Reason`, value: `\`${reason}\``, inline: false })
        .setColor(THEME.danger).setThumbnail(targetUser.displayAvatarURL()).setTimestamp().setFooter(brandFooter('Action Completed'))],
      components: [],
    });
  } catch (error) {
    console.error('Ban error:', error);
    const description = error.code === 50013 ? "⚠️ I don't have permission to ban this member." : '⚠️ Could not ban the member. Please try again.';
    await interaction.editReply({ embeds: [errorEmbed('Ban Failed', description)], components: [] });
  }
}

async function handleMute(interaction) {
  const targetUser = interaction.options.getUser('member');
  const minutesInput = interaction.options.getInteger('minutes') ?? 10;
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', '🔒 You need **Moderate Members** permission to use this command.')], ephemeral: true });
  }
  const MAX_MINUTES = 40320;
  if (minutesInput < 1) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Duration', 'Mute duration must be at least 1 minute.')], ephemeral: true });
  }
  const minutes = Math.min(minutesInput, MAX_MINUTES);

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return interaction.reply({ embeds: [errorEmbed('Member Not Found', '❓ The specified member could not be found.')], ephemeral: true });
  }
  if (!canModerate(moderator, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Mute', '⛔ You cannot mute this user due to role hierarchy or self-action.')], ephemeral: true });
  }
  if (!canBotModerate(interaction.guild, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Mute', "⛔ My role isn't high enough to mute this user. Move my role above theirs.")], ephemeral: true });
  }

  try {
    await targetMember.timeout(minutes * 60 * 1000, reason);
    await sendLog(interaction.guild, new EmbedBuilder().setAuthor(brandAuthor())
      .setTitle('🔇 Member Muted').setColor(THEME.mute).setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '👤 User', value: `${targetUser.tag}\n\`${targetUser.id}\``, inline: false },
        { name: '⏱️ Duration', value: `${minutes} minutes`, inline: true },
        { name: '👮 Moderator', value: `${moderator.user.tag}`, inline: true },
        { name: '📝 Reason', value: `\`${reason}\``, inline: false },
      ).setTimestamp().setFooter(brandFooter('Member Action')), 'mute');

    await interaction.reply({
      embeds: [new EmbedBuilder().setAuthor(brandAuthor())
        .setTitle('🔇 Mute Successful')
        .setDescription(`**${targetUser.tag}** has been muted.`)
        .addFields(
          { name: '⏱️ Duration', value: `\`${minutes} minutes\``, inline: true },
          { name: `${GOLD_ACCENT} Reason`, value: `\`${reason}\``, inline: false },
        )
        .setColor(THEME.mute).setThumbnail(targetUser.displayAvatarURL()).setTimestamp().setFooter(brandFooter('Action Completed'))],
    });
  } catch (error) {
    console.error('Mute error:', error);
    const description = error.code === 50013 ? "⚠️ I don't have permission to timeout this member." : '⚠️ Could not mute the member. Please try again.';
    await interaction.reply({ embeds: [errorEmbed('Mute Failed', description)], ephemeral: true });
  }
}

async function handleUnmute(interaction) {
  const targetUser = interaction.options.getUser('member');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Moderate Members** permission.')], ephemeral: true });
  }
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return interaction.reply({ embeds: [errorEmbed('Error', 'Member not found.')], ephemeral: true });
  }

  try {
    await targetMember.timeout(null);
    await sendLog(interaction.guild, new EmbedBuilder().setAuthor(brandAuthor())
      .setTitle('🔊 Member Unmuted').setColor(THEME.success)
      .addFields(
        { name: 'Member', value: `${targetUser.tag} (${targetUser.id})`, inline: false },
        { name: 'Moderator', value: `${moderator.user.tag}`, inline: true },
      ).setTimestamp(), 'mute');
    await interaction.reply({ embeds: [successEmbed('Unmute Successful', `${targetUser.tag} has been unmuted.`)] });
  } catch (error) {
    console.error('Unmute error:', error);
    await interaction.reply({ embeds: [errorEmbed('Error', 'Could not unmute member.')], ephemeral: true });
  }
}

async function handleWarn(interaction) {
  const targetUser = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const moderator = interaction.member;
  const guildId = interaction.guildId;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Moderate Members** permission.')], ephemeral: true });
  }

  if (!warnings[guildId]) warnings[guildId] = {};
  if (!warnings[guildId][targetUser.id]) warnings[guildId][targetUser.id] = [];
  warnings[guildId][targetUser.id].push({ mod: moderator.user.tag, reason, timestamp: Date.now() });
  const total = warnings[guildId][targetUser.id].length;

  await sendLog(interaction.guild, new EmbedBuilder().setAuthor(brandAuthor())
    .setTitle('⚠️ User Warned').setColor(THEME.warning)
    .addFields(
      { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: false },
      { name: 'Moderator', value: `${moderator.user.tag}`, inline: true },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Total Warnings', value: `${total}`, inline: true },
    ).setTimestamp(), 'warn');

  await interaction.reply({
    embeds: [warningEmbed('Warning Issued', `${targetUser} has been warned.`)
      .addFields(
        { name: `${GOLD_ACCENT} Reason`, value: reason, inline: false },
        { name: 'Total Warnings', value: `${total}`, inline: true },
      )],
  });
}

async function handleWarnings(interaction) {
  const targetUser = interaction.options.getUser('user');
  const guildId = interaction.guildId;
  const userWarnings = warnings[guildId]?.[targetUser.id];

  if (!userWarnings || userWarnings.length === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setAuthor(brandAuthor())
        .setTitle('📋 Clean Record')
        .setDescription(`✅ **${targetUser.tag}** has no warnings.`)
        .setColor(THEME.success).setThumbnail(targetUser.displayAvatarURL()).setTimestamp().setFooter(brandFooter('Clear Record'))],
    });
  }

  const warningList = userWarnings.map((w, i) => {
    const severity = i >= 2 ? '🔴' : i >= 1 ? '🟠' : '🟡';
    return `${severity} **#${i + 1}** — ${w.reason}\n> *by ${w.mod} • <t:${Math.floor(w.timestamp / 1000)}:R>*`;
  }).join('\n\n');

  await interaction.reply({
    embeds: [new EmbedBuilder().setAuthor(brandAuthor())
      .setTitle(`⚠️ Warnings — ${targetUser.tag}`)
      .setColor(THEME.warning).setDescription(warningList).setThumbnail(targetUser.displayAvatarURL())
      .addFields({ name: '📊 Summary', value: `**Total:** ${userWarnings.length}`, inline: false })
      .setTimestamp().setFooter(brandFooter('Warning History'))],
  });
}

async function handleClearWarnings(interaction) {
  const targetUser = interaction.options.getUser('user');
  const moderator = interaction.member;
  const guildId = interaction.guildId;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Moderate Members** permission.')], ephemeral: true });
  }
  const userWarnings = warnings[guildId]?.[targetUser.id];
  if (!userWarnings || userWarnings.length === 0) {
    return interaction.reply({ embeds: [infoEmbed('No Warnings', `${targetUser.tag} has no warnings to clear.`)], ephemeral: true });
  }

  const count = userWarnings.length;
  const confirmed = await confirmAction(interaction, {
    title: 'Confirm Clear Warnings',
    description: `Clear all **${count}** warning(s) for **${targetUser.tag}**?`,
  });
  if (confirmed === null) {
    return interaction.editReply({ embeds: [infoEmbed('Timed Out', 'No response received — nothing was cleared.')], components: [] });
  }
  if (confirmed === false) {
    return interaction.editReply({ embeds: [infoEmbed('Cancelled', `Clear warnings for **${targetUser.tag}** was cancelled.`)], components: [] });
  }

  warnings[guildId][targetUser.id] = [];

  await sendLog(interaction.guild, new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setTitle('🧹 Warnings Cleared').setColor(THEME.success)
    .addFields(
      { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: false },
      { name: 'Moderator', value: `${moderator.user.tag}`, inline: true },
      { name: 'Cleared', value: `${count}`, inline: true },
    ).setTimestamp(), 'warn');
  await interaction.editReply({ embeds: [successEmbed('Warnings Cleared', `All ${count} warnings for **${targetUser.tag}** have been cleared.`)], components: [] });
}

async function handleClear(interaction) {
  const amount = interaction.options.getInteger('amount');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Messages** permission.')], ephemeral: true });
  }
  if (amount < 1 || amount > 100) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Amount', 'Please specify between 1 and 100 messages.')], ephemeral: true });
  }

  await interaction.deferReply();
  try {
    const deleted = await interaction.channel.bulkDelete(amount, true);
    await sendLog(interaction.guild, new EmbedBuilder().setAuthor(brandAuthor())
      .setTitle('🧹 Messages Cleared').setColor(THEME.info)
      .addFields(
        { name: 'Channel', value: `${interaction.channel}`, inline: true },
        { name: 'Moderator', value: `${moderator.user.tag}`, inline: true },
        { name: 'Deleted', value: `${deleted.size}`, inline: true },
      ).setTimestamp(), 'purge');
    await interaction.editReply({ embeds: [successEmbed('Messages Deleted', `🧹 ${deleted.size} message(s) deleted${deleted.size < amount ? ' (some were older than 14 days and skipped)' : ''}.`)] });
  } catch (error) {
    console.error('Clear error:', error);
    await interaction.editReply({ embeds: [errorEmbed('Error', 'Could not delete messages.')] });
  }
}

async function handlePurge(interaction) {
  const amount = interaction.options.getInteger('amount');
  const filterUser = interaction.options.getUser('user');
  const filterText = interaction.options.getString('contains');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Messages** permission.')], ephemeral: true });
  }
  if (amount < 1 || amount > 100) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Amount', 'Please specify between 1-100 messages.')], ephemeral: true });
  }

  await interaction.deferReply();
  try {
    const messages = await interaction.channel.messages.fetch({ limit: amount });
    let toDelete = messages;
    if (filterUser) toDelete = toDelete.filter(m => m.author.id === filterUser.id);
    if (filterText) toDelete = toDelete.filter(m => m.content.toLowerCase().includes(filterText.toLowerCase()));

    if (toDelete.size === 0) {
      return interaction.editReply({ embeds: [warningEmbed('No Messages Found', 'No messages matched the specified filters.')] });
    }

    let deletedCount = 0;
    try {
      const bulkResult = await interaction.channel.bulkDelete(toDelete, true);
      deletedCount = bulkResult.size;
    } catch {
      const results = await Promise.all(toDelete.map(m => m.delete().then(() => true).catch(() => false)));
      deletedCount = results.filter(Boolean).length;
    }

    let summary = `**Scanned:** ${amount}\n\n**Deleted:** ${deletedCount}`;
    if (filterUser) summary += `\n\n**By User:** ${filterUser.tag}`;
    if (filterText) summary += `\n\n**Contains:** \`${filterText}\``;

    await sendLog(interaction.guild, new EmbedBuilder().setAuthor(brandAuthor())
      .setTitle('🧹 Messages Purged').setColor(THEME.info).setDescription(summary)
      .addFields(
        { name: '👮 Moderator', value: `${moderator.user.tag}`, inline: true },
        { name: '📍 Channel', value: `${interaction.channel}`, inline: true },
      ).setTimestamp().setFooter(brandFooter('Purge Action')), 'purge');

    await interaction.editReply({ embeds: [successEmbed('Purge Successful', summary)] });
  } catch (error) {
    console.error('Purge error:', error);
    await interaction.editReply({ embeds: [errorEmbed('Purge Failed', 'Could not purge messages. Please try again.')] });
  }
}

async function handleLock(interaction) {
  const moderator = interaction.member;
  if (!moderator.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Channels** permission.')], ephemeral: true });
  }
  try {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
    await sendLog(interaction.guild, new EmbedBuilder()
      .setAuthor(brandAuthor())
      .setTitle('🔒 Channel Locked').setColor(THEME.error)
      .addFields({ name: 'Channel', value: `${interaction.channel}`, inline: false }, { name: 'Moderator', value: `${moderator.user.tag}`, inline: true })
      .setTimestamp(), 'lock');

    const unlockRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('quick_unlock').setLabel('Unlock').setEmoji('🔓').setStyle(ButtonStyle.Success),
    );
    const message = await interaction.reply({ embeds: [successEmbed('Channel Locked', '🔒 Members can no longer send messages here.')], components: [unlockRow], fetchReply: true });

    message.awaitMessageComponent({ componentType: ComponentType.Button, filter: (b) => b.customId === 'quick_unlock', time: 60_000 })
      .then(async (btn) => {
        if (!btn.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return btn.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Channels** permission.')], ephemeral: true });
        }
        await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
        await sendLog(interaction.guild, new EmbedBuilder().setAuthor(brandAuthor())
          .setTitle('🔓 Channel Unlocked').setColor(THEME.success)
          .addFields({ name: 'Channel', value: `${interaction.channel}`, inline: false }, { name: 'Moderator', value: `${btn.user.tag}`, inline: true })
          .setTimestamp(), 'lock');
        await btn.update({ embeds: [successEmbed('Channel Unlocked', '🔓 Members can send messages again.')], components: [] });
      })
      .catch(() => interaction.editReply({ components: [] }).catch(() => {}));
  } catch (error) {
    console.error('Lock error:', error);
    await interaction.reply({ embeds: [errorEmbed('Error', 'Could not lock channel.')], ephemeral: true });
  }
}

async function handleUnlock(interaction) {
  const moderator = interaction.member;
  if (!moderator.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Channels** permission.')], ephemeral: true });
  }
  try {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
    await sendLog(interaction.guild, new EmbedBuilder()
      .setAuthor(brandAuthor())
      .setTitle('🔓 Channel Unlocked').setColor(THEME.success)
      .addFields({ name: 'Channel', value: `${interaction.channel}`, inline: false }, { name: 'Moderator', value: `${moderator.user.tag}`, inline: true })
      .setTimestamp(), 'lock');

    const lockRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('quick_lock').setLabel('Lock').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    );
    const message = await interaction.reply({ embeds: [successEmbed('Channel Unlocked', '🔓 Members can send messages again.')], components: [lockRow], fetchReply: true });

    message.awaitMessageComponent({ componentType: ComponentType.Button, filter: (b) => b.customId === 'quick_lock', time: 60_000 })
      .then(async (btn) => {
        if (!btn.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return btn.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Channels** permission.')], ephemeral: true });
        }
        await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
        await sendLog(interaction.guild, new EmbedBuilder().setAuthor(brandAuthor())
          .setTitle('🔒 Channel Locked').setColor(THEME.error)
          .addFields({ name: 'Channel', value: `${interaction.channel}`, inline: false }, { name: 'Moderator', value: `${btn.user.tag}`, inline: true })
          .setTimestamp(), 'lock');
        await btn.update({ embeds: [successEmbed('Channel Locked', '🔒 Members can no longer send messages here.')], components: [] });
      })
      .catch(() => interaction.editReply({ components: [] }).catch(() => {}));
  } catch (error) {
    console.error('Unlock error:', error);
    await interaction.reply({ embeds: [errorEmbed('Error', 'Could not unlock channel.')], ephemeral: true });
  }
}

async function handleAntiPing(interaction) {
  const action = interaction.options.getString('action');
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }
  antiPing[interaction.guildId] = action === 'on';
  await interaction.reply({ embeds: [successEmbed(`Anti-Ping ${action === 'on' ? 'Enabled' : 'Disabled'}`, action === 'on' ? '🛡️ Mass pings and mentions will now be automatically removed.' : 'Anti-ping protection is now off.')] });
}

function parseWordList(input) {
  return Array.from(new Set(
    input.split(',').map(w => w.toLowerCase().trim()).filter(Boolean),
  ));
}

function formatWordChunks(words) {
  const chunks = [];
  let current = [];
  let currentLen = 0;
  for (const w of words) {
    const piece = `\`${w}\``;
    if (currentLen + piece.length + 2 > 950 && current.length) {
      chunks.push(current.join(', '));
      current = [];
      currentLen = 0;
    }
    current.push(piece);
    currentLen += piece.length + 2;
  }
  if (current.length) chunks.push(current.join(', '));
  return chunks;
}

async function handleFilter(interaction) {
  const action = interaction.options.getString('action');
  const word = interaction.options.getString('word');
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }

  const guildId = interaction.guildId;
  if (!chatFilters[guildId]) chatFilters[guildId] = [];

  if (action === 'add') {
    if (!word?.trim()) return interaction.reply({ embeds: [errorEmbed('No Word Provided', 'Usage: `/filter add [word or phrase]` — separate multiple with commas, e.g. `word1, word2, word3`')], ephemeral: true });
    const requested = parseWordList(word);
    const added = [];
    const alreadyBlocked = [];
    for (const w of requested) {
      if (chatFilters[guildId].includes(w)) {
        alreadyBlocked.push(w);
      } else {
        chatFilters[guildId].push(w);
        added.push(w);
      }
    }

    if (added.length === 0) {
      return interaction.reply({ embeds: [warningEmbed('Already Blocked', requested.length === 1 ? `"${requested[0]}" is already filtered.` : `All ${requested.length} word(s) were already filtered.`)], ephemeral: true });
    }

    const embed = successEmbed('Added to Filter', `🚫 Blocked **${added.length}** new word(s).\n\n**Total blocked:** ${chatFilters[guildId].length}`);
    formatWordChunks(added).forEach((chunk, i) => embed.addFields({ name: i === 0 ? 'Added' : '\u200b', value: chunk, inline: false }));
    if (alreadyBlocked.length > 0) {
      embed.addFields({ name: `Skipped (already blocked) — ${alreadyBlocked.length}`, value: formatWordChunks(alreadyBlocked)[0] || 'None', inline: false });
    }
    return interaction.reply({ embeds: [embed] });
  }

  if (action === 'remove') {
    if (!word?.trim()) return interaction.reply({ embeds: [errorEmbed('No Word Provided', 'Usage: `/filter remove [word or phrase]` — separate multiple with commas, e.g. `word1, word2, word3`')], ephemeral: true });
    const requested = parseWordList(word);
    const removed = [];
    const notFound = [];
    for (const w of requested) {
      const index = chatFilters[guildId].indexOf(w);
      if (index === -1) {
        notFound.push(w);
      } else {
        chatFilters[guildId].splice(index, 1);
        removed.push(w);
      }
    }

    if (removed.length === 0) {
      return interaction.reply({ embeds: [errorEmbed('Not Found', requested.length === 1 ? `"${requested[0]}" isn't in the filter.` : `None of those ${requested.length} word(s) were in the filter.`)], ephemeral: true });
    }

    const embed = successEmbed('Removed from Filter', `**${removed.length}** word(s) removed.\n\n**Total blocked:** ${chatFilters[guildId].length}`);
    formatWordChunks(removed).forEach((chunk, i) => embed.addFields({ name: i === 0 ? 'Removed' : '\u200b', value: chunk, inline: false }));
    if (notFound.length > 0) {
      embed.addFields({ name: `Skipped (not found) — ${notFound.length}`, value: formatWordChunks(notFound)[0] || 'None', inline: false });
    }
    return interaction.reply({ embeds: [embed] });
  }

  if (action === 'list') {
    if (chatFilters[guildId].length === 0) {
      return interaction.reply({ embeds: [infoEmbed('Filter List', 'No words are currently filtered. Try `/filter reset` to load a basic starter list.')] });
    }
    const listEmbed = new EmbedBuilder().setAuthor(brandAuthor())
      .setTitle('🚫 Blocked Words').setColor(THEME.error)
      .setFooter(brandFooter(`${chatFilters[guildId].length} word(s) blocked`)).setTimestamp();

    const CHUNK_SIZE = 20;
    const words = chatFilters[guildId];
    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
      const chunk = words.slice(i, i + CHUNK_SIZE);
      listEmbed.addFields({ name: `Words ${i + 1}–${i + chunk.length}`, value: chunk.map(w => `\`${w}\``).join(', '), inline: false });
    }
    return interaction.reply({ embeds: [listEmbed] });
  }

  if (action === 'reset') {
    const merged = Array.from(new Set([...chatFilters[guildId], ...DEFAULT_FILTER_WORDS]));
    chatFilters[guildId] = merged;
    return interaction.reply({
      embeds: [successEmbed('Default Filter Loaded', `🚫 Loaded a basic starter wordlist (English, Hindi, and Hinglish profanity).\n\n**Total blocked:** ${merged.length}\n\nUse \`/filter list\` to review it, or \`/filter add\`/\`/filter remove\` to fine-tune it.`)],
    });
  }

  if (action === 'clear') {
    const count = chatFilters[guildId].length;
    chatFilters[guildId] = [];
    return interaction.reply({ embeds: [successEmbed('Filter Cleared', `🗑️ Removed all ${count} blocked word(s). The chat filter is now off until you add words again.`)] });
  }
}

async function handleSetLog(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }
  const channel = interaction.options.getChannel('channel');
  const action = interaction.options.getString('action') || 'general';
  if (!channel.isTextBased()) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Channel', 'Please select a text channel.')], ephemeral: true });
  }
  if (!logChannels[interaction.guildId]) logChannels[interaction.guildId] = {};
  logChannels[interaction.guildId][action] = channel.id;

  const meta = LOG_ACTIONS[action] || LOG_ACTIONS.general;
  await interaction.reply({ embeds: [successEmbed('Log Channel Set', `📋 **${meta.emoji} ${meta.label}** logs will now be sent to ${channel}.`)] });
}

async function handleRemoveLog(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }
  const action = interaction.options.getString('action');
  const guildConfig = logChannels[interaction.guildId];
  if (!guildConfig || !guildConfig[action]) {
    return interaction.reply({ embeds: [infoEmbed('Nothing to Remove', `No specific log channel is set for **${LOG_ACTIONS[action]?.label || action}**. It's already falling back to general.`)], ephemeral: true });
  }
  delete guildConfig[action];
  const meta = LOG_ACTIONS[action] || LOG_ACTIONS.general;
  await interaction.reply({ embeds: [successEmbed('Log Channel Removed', `**${meta.emoji} ${meta.label}** logs will now fall back to the general log channel (if set).`)] });
}

async function handleLogs(interaction) {
  const guildConfig = logChannels[interaction.guildId] || {};
  const lines = Object.entries(LOG_ACTIONS).map(([key, meta]) => {
    const channelId = guildConfig[key];
    const value = channelId ? `<#${channelId}>` : (key === 'general' ? '*Not set*' : '*Falls back to general*');
    return `${meta.emoji} **${meta.label}** — ${value}`;
  });

  await interaction.reply({
    embeds: [infoEmbed('📋 Log Channel Configuration', lines.join('\n\n'))],
  });
}

async function handleSetAutoRole(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }
  const role = interaction.options.getRole('role');
  if (role.id === interaction.guild.id) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Role', 'You cannot use @everyone as the auto role.')], ephemeral: true });
  }
  if (role.managed) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Role', 'That role is managed by an integration and cannot be assigned manually.')], ephemeral: true });
  }
  const me = interaction.guild.members.me;
  if (me && role.position >= me.roles.highest.position) {
    return interaction.reply({ embeds: [errorEmbed('Role Too High', "That role sits above my highest role, so I can't assign it. Move my role above it first.")], ephemeral: true });
  }
  autoRoles[interaction.guildId] = role.id;
  await interaction.reply({ embeds: [successEmbed('Auto Role Set', `🎭 New members will automatically receive ${role}.`)] });
}

async function handleSetWelcome(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }
  const channel = interaction.options.getChannel('channel');
  if (!channel.isTextBased()) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Channel', 'Please select a text channel.')], ephemeral: true });
  }
  welcomeChannels[interaction.guildId] = channel.id;
  await interaction.reply({ embeds: [successEmbed('Welcome Channel Set', `👋 New members will be greeted in ${channel}.`)] });
}

async function handleWelcomeToggle(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }
  const state = interaction.options.getString('state');
  welcomeEnabled[interaction.guildId] = state === 'on';
  await interaction.reply({ embeds: [successEmbed('Welcome System', `Welcome messages are now **${state === 'on' ? 'ENABLED ✅' : 'DISABLED ❌'}**.`)] });
}

async function handleSetWelcomeMessage(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }
  const message = interaction.options.getString('message');
  if (message.length > 1000) {
    return interaction.reply({ embeds: [errorEmbed('Message Too Long', 'Welcome messages must be 1000 characters or fewer.')], ephemeral: true });
  }
  welcomeMessages[interaction.guildId] = message;
  const preview = renderWelcomeMessage(message, interaction.member);
  await interaction.reply({
    embeds: [successEmbed('Welcome Message Updated', 'New members will now see:').addFields({ name: `${GOLD_ACCENT} Preview`, value: preview })],
  });
}

async function handleWelcomeMessagePreview(interaction) {
  const template = welcomeMessages[interaction.guildId] || DEFAULT_WELCOME_MESSAGE;
  const preview = renderWelcomeMessage(template, interaction.member);
  const channelId = welcomeChannels[interaction.guildId];
  const isEnabled = welcomeEnabled[interaction.guildId] !== false;

  await interaction.reply({
    embeds: [infoEmbed('👋 Current Welcome Message', preview).addFields(
      { name: 'Status', value: isEnabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
      { name: 'Channel', value: channelId ? `<#${channelId}>` : 'Not set', inline: true },
    )],
  });
}

// ==================== KICK ANNOUNCEMENT COMMAND HANDLERS ====================

async function handleSetKickChannel(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }
  const kickUsername = interaction.options.getString('kickuser').trim().toLowerCase();
  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');
  const messageTemplate = interaction.options.getString('message')?.trim() || null;
  if (!channel.isTextBased()) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Channel', 'Please select a text channel.')], ephemeral: true });
  }

  await interaction.deferReply();
  try {
    await fetchKickChannel(kickUsername); // validate the username actually exists before saving
  } catch (error) {
    console.error('Kick validation error:', error.message);
    return interaction.editReply({ embeds: [errorEmbed('Kick User Not Found', `Could not find a Kick channel for \`${kickUsername}\`. Double-check the username from their URL (kick.com/**username**), and make sure \`KICK_CLIENT_ID\`/\`KICK_CLIENT_SECRET\` are set correctly.`)] });
  }

  kickAnnouncements[interaction.guildId] = {
    kickUsername,
    channelId: channel.id,
    roleId: role?.id || null,
    messageTemplate,
    isLive: false,
    lastSessionId: null,
  };

  const previewSource = messageTemplate || DEFAULT_KICK_MESSAGE;
  const preview = renderKickMessage(previewSource, { kickUsername, channelData: { slug: kickUsername }, roleId: role?.id || null });

  const confirmationEmbed = new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setTitle('✅ Kick Announcements Set')
    .setColor(THEME.kick)
    .setDescription(`${DIVIDER}\n\nI'll post here whenever **${kickUsername}** goes live on Kick.`)
    .addFields(
      { name: '📺 Streamer', value: `[kick.com/${kickUsername}](https://kick.com/${kickUsername})`, inline: true },
      { name: '📍 Channel', value: `${channel}`, inline: true },
      { name: '🔔 Ping Role', value: role ? `${role}` : 'None', inline: true },
      { name: '💬 Message Preview', value: preview, inline: false },
    )
    .setTimestamp()
    .setFooter(brandFooter('Checked roughly every 3 minutes'));

  await interaction.editReply({ embeds: [confirmationEmbed] });
}

async function handleSetKickMessage(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }
  const config = kickAnnouncements[interaction.guildId];
  if (!config) {
    return interaction.reply({ embeds: [errorEmbed('Not Configured', 'No Kick announcement is set up yet. Use `/setkickchannel` first.')], ephemeral: true });
  }
  const messageTemplate = interaction.options.getString('message')?.trim() || null;
  config.messageTemplate = messageTemplate;

  const previewSource = messageTemplate || DEFAULT_KICK_MESSAGE;
  const preview = renderKickMessage(previewSource, { kickUsername: config.kickUsername, channelData: { slug: config.kickUsername }, roleId: config.roleId });

  await interaction.reply({
    embeds: [successEmbed('Kick Message Updated', `${messageTemplate ? 'Custom message saved.' : 'Reset to the default message.'}`).addFields({ name: '💬 New Preview', value: preview, inline: false })],
  });
}

async function handleRemoveKickChannel(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.')], ephemeral: true });
  }
  if (!kickAnnouncements[interaction.guildId]) {
    return interaction.reply({ embeds: [infoEmbed('Nothing to Remove', 'No Kick announcement is configured for this server.')], ephemeral: true });
  }
  delete kickAnnouncements[interaction.guildId];
  await interaction.reply({ embeds: [successEmbed('Kick Announcements Removed', 'Live announcements have been turned off.')] });
}

async function handleKickStatus(interaction) {
  const config = kickAnnouncements[interaction.guildId];
  if (!config) {
    return interaction.reply({ embeds: [infoEmbed('📺 Kick Announcements', 'Not configured yet.\n\nUse `/setkickchannel` to set one up.')] });
  }
  const template = config.messageTemplate || DEFAULT_KICK_MESSAGE;
  const preview = renderKickMessage(template, { kickUsername: config.kickUsername, channelData: { slug: config.kickUsername }, roleId: config.roleId });

  const statusEmbed = new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setTitle('📺 Kick Announcement Config')
    .setColor(config.isLive ? THEME.streaming : THEME.info)
    .setDescription(DIVIDER)
    .addFields(
      { name: 'Streamer', value: `[${config.kickUsername}](https://kick.com/${config.kickUsername})`, inline: true },
      { name: 'Channel', value: `<#${config.channelId}>`, inline: true },
      { name: 'Ping Role', value: config.roleId ? `<@&${config.roleId}>` : 'None', inline: true },
      { name: 'Currently Live', value: config.isLive ? '🟣 Yes — Streaming' : '⚪ No', inline: true },
      { name: 'Custom Message', value: config.messageTemplate ? '🟢 Set' : '⚪ Using default', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: `${GOLD_ACCENT} Message Preview`, value: preview, inline: false },
    )
    .setTimestamp()
    .setFooter(brandFooter('Kick Live Announcement'));

  await interaction.reply({ embeds: [statusEmbed] });
}

// ==================== EVENT HANDLERS ====================

client.once('ready', () => {
  console.log(`\n${'='.repeat(50)}\n🛡️ ${BRAND_NAME} Ready! ${client.user.tag}\nGuilds: ${client.guilds.cache.size}\n${'='.repeat(50)}\n`);
  client.user.setPresence({ activities: [{ name: '🛡️ your server | /help', type: ActivityType.Watching }], status: 'online' });

  // Kick Live Announcements — poll immediately, then on an interval.
  if (KICK_CLIENT_ID && KICK_CLIENT_SECRET) {
    pollKickStreams().catch(err => console.error('Initial Kick poll error:', err));
    setInterval(() => {
      pollKickStreams().catch(err => console.error('Kick poll error:', err));
    }, KICK_POLL_INTERVAL_MS);
    console.log('📺 Kick live announcements: polling enabled.');
  } else {
    console.log('📺 Kick live announcements: KICK_CLIENT_ID/KICK_CLIENT_SECRET not set — feature disabled.');
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = interaction.commandName;

  if (!interaction.inGuild() && !['ping', 'help'].includes(command)) {
    return interaction.reply({ embeds: [errorEmbed('Server Only', 'This command can only be used inside a server.')], ephemeral: true });
  }

  try {
    console.log('Command received:', command);
    switch (command) {
      case 'ping': await handlePing(interaction); break;
      case 'help': await handleHelp(interaction); break;
      case 'dashboard': await handleDashboard(interaction); break;
      case 'level': await handleLevel(interaction); break;
      case 'rank': await handleLevel(interaction); break;
      case 'leaderboard': await handleLeaderboard(interaction); break;
      case 'levelsystem': await handleLevelSystemToggle(interaction); break;
      case 'userinfo': await handleUserInfo(interaction); break;
      case 'serverinfo': await handleServerInfo(interaction); break;
      case 'avatar': await handleAvatar(interaction); break;
      case 'kick': await handleKick(interaction); break;
      case 'ban': await handleBan(interaction); break;
      case 'mute': await handleMute(interaction); break;
      case 'unmute': await handleUnmute(interaction); break;
      case 'warn': await handleWarn(interaction); break;
      case 'warnings': await handleWarnings(interaction); break;
      case 'clearwarnings': await handleClearWarnings(interaction); break;
      case 'clear': await handleClear(interaction); break;
      case 'purge': await handlePurge(interaction); break;
      case 'lock': await handleLock(interaction); break;
      case 'unlock': await handleUnlock(interaction); break;
      case 'antiping': await handleAntiPing(interaction); break;
      case 'filter': await handleFilter(interaction); break;
      case 'setlog': await handleSetLog(interaction); break;
      case 'removelog': await handleRemoveLog(interaction); break;
      case 'logs': await handleLogs(interaction); break;
      case 'setwelcome': await handleSetWelcome(interaction); break;
      case 'setautorole': await handleSetAutoRole(interaction); break;
      case 'welcome': await handleWelcomeToggle(interaction); break;
      case 'setwelcomemessage': await handleSetWelcomeMessage(interaction); break;
      case 'welcomemessage': await handleWelcomeMessagePreview(interaction); break;
      case 'snipe': await handleSnipe(interaction); break;
      case 'setkickchannel': await handleSetKickChannel(interaction); break;
      case 'setkickmessage': await handleSetKickMessage(interaction); break;
      case 'removekickchannel': await handleRemoveKickChannel(interaction); break;
      case 'kickstatus': await handleKickStatus(interaction); break;
      default:
        await interaction.reply({ embeds: [errorEmbed('Unknown Command', "That command doesn't exist.")], ephemeral: true });
    }
  } catch (error) {
    console.error('Interaction error:', error);
    try {
      await safeInteractionReply(interaction, { embeds: [errorEmbed('Error', 'Something went wrong while processing this command.')], ephemeral: true });
    } catch (replyError) {
      console.error('Error sending error reply:', replyError);
    }
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    const guildId = member.guild.id;

    const autoRoleId = autoRoles[guildId];
    if (autoRoleId) {
      const role = await member.guild.roles.fetch(autoRoleId).catch(() => null);
      if (role) await member.roles.add(role).catch(err => console.error('Auto-role assignment error:', err));
    }

    const isWelcomeEnabled = welcomeEnabled[guildId] !== false;
    const welcomeChannelId = welcomeChannels[guildId];
    if (isWelcomeEnabled && welcomeChannelId) {
      const channel = await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        const template = welcomeMessages[guildId] || DEFAULT_WELCOME_MESSAGE;
        const welcomeEmbed = new EmbedBuilder().setAuthor(brandAuthor())
          .setTitle('👋 A Wild Member Appears!')
          .setDescription(renderWelcomeMessage(template, member))
          .setColor(THEME.success)
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .setImage(WELCOME_BANNER_URL)
          .addFields(
            { name: '📅 Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: '👥 Member Count', value: `${member.guild.memberCount}`, inline: true },
          )
          .setTimestamp()
          .setFooter(brandFooter('Welcome System'));
        await channel.send({ embeds: [welcomeEmbed] }).catch(err => console.error('Welcome message error:', err));
      }
    }

    await sendLog(member.guild, new EmbedBuilder().setAuthor(brandAuthor())
      .setTitle('📥 Member Joined').setColor(THEME.success).setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Member', value: `${member.user.tag} (${member.user.id})`, inline: false },
        { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      ).setTimestamp(), 'member');
  } catch (error) {
    console.error('Guild member add error:', error);
  }
});

client.on('guildMemberRemove', async (member) => {
  try {
    await sendLog(member.guild, new EmbedBuilder().setAuthor(brandAuthor())
      .setTitle('👋 Member Left').setColor(THEME.error).setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Member', value: `${member.user.tag} (${member.user.id})`, inline: false },
        { name: 'Joined Server', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
      ).setTimestamp(), 'member');
  } catch (error) {
    console.error('Guild member remove error:', error);
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.partial) return;

    const guildId = message.guildId;
    const member = message.member;

    if (member && isAdmin(member)) return;

    // ---- XP / Level System ----
    if (member && levelSystemEnabled[guildId] !== false) {
      const levelData = getUserLevelData(guildId, message.author.id);
      const now = Date.now();
      if (now - levelData.lastMessage >= 60000) {
        const oldLevel = getLevelFromXp(levelData.xp);
        levelData.xp += Math.floor(Math.random() * 11) + 15;
        levelData.lastMessage = now;
        const newLevel = getLevelFromXp(levelData.xp);
        if (newLevel > oldLevel) {
          message.channel.send({
            embeds: [new EmbedBuilder().setAuthor(brandAuthor())
              .setTitle('🎉 Level Up!')
              .setDescription(`${message.author} just reached **Level ${newLevel}**!`)
              .setColor(THEME.level)
              .setThumbnail(message.author.displayAvatarURL({ size: 256 }))
              .setFooter(brandFooter('Level System'))],
          }).catch(() => {});
        }
      }
    }

    // ---- Anti-Ping ----
    if (antiPing[guildId] && hasMentions(message)) {
      try {
        await message.delete();
        const warnMsg = await message.channel.send({ content: `${message.author}`, embeds: [warningEmbed('Mention Not Allowed', "You can't use @everyone, @here, or mention members/roles here.")] });
        await sendLog(message.guild, new EmbedBuilder().setAuthor(brandAuthor())
          .setTitle('🛡️ Anti-Ping Triggered').setColor(THEME.warning)
          .addFields(
            { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: false },
            { name: 'Channel', value: `${message.channel}`, inline: true },
          ).setTimestamp(), 'antiping');
        setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
      } catch (error) {
        console.error('Anti-ping error:', error);
      }
      return;
    }

    // ---- Chat Filter ----
    if (chatFilters[guildId]?.length > 0) {
      const messageLower = message.content.toLowerCase();
      const blocked = chatFilters[guildId].find(w => messageLower.includes(w));
      if (blocked) {
        try {
          await message.delete();
          const warnMsg = await message.channel.send({ content: `${message.author}`, embeds: [warningEmbed('Message Removed', 'Your message contained a blocked word or phrase.')] });
          setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        } catch (error) {
          console.error('Chat filter error:', error);
        }
        return;
      }
    }

    // ---- Invite Filter ----
    if (hasInvite(message.content)) {
      try {
        await message.delete();
        const warnMsg = await message.channel.send({ content: `${message.author}`, embeds: [warningEmbed('Invite Deleted', 'Discord invites are not allowed in this server.')] });
        await sendLog(message.guild, new EmbedBuilder().setAuthor(brandAuthor())
          .setTitle('🔗 Invite Link Detected').setColor(THEME.warning)
          .addFields(
            { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: false },
            { name: 'Channel', value: `${message.channel}`, inline: true },
            { name: 'Content', value: message.content.substring(0, 100), inline: false },
          ).setTimestamp(), 'antiping');
        setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
      } catch (error) {
        console.error('Invite filter error:', error);
      }
    }
  } catch (error) {
    console.error('Message create error:', error);
  }
});

client.on('messageDelete', async (message) => {
  try {
    if (message.partial || !message.author || message.author.bot) return;

    if (!snipedMessages[message.guildId]) snipedMessages[message.guildId] = {};
    snipedMessages[message.guildId][message.channelId] = {
      content: message.content,
      authorTag: message.author.tag,
      authorAvatar: message.author.displayAvatarURL(),
      timestamp: Date.now(),
    };

    await sendLog(message.guild, new EmbedBuilder().setAuthor(brandAuthor())
      .setTitle('🗑️ Message Deleted').setColor(THEME.warning)
      .addFields(
        { name: 'Author', value: `${message.author.tag} (${message.author.id})`, inline: false },
        { name: 'Channel', value: `${message.channel}`, inline: true },
        { name: 'Content', value: (message.content || '').substring(0, 100) || 'No content', inline: false },
      ).setTimestamp(), 'message');
  } catch (error) {
    console.error('Message delete error:', error);
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    if (oldMessage.partial || newMessage.partial) return;
    if (!oldMessage.author || oldMessage.author.bot) return;
    if (oldMessage.content === newMessage.content) return;
    await sendLog(oldMessage.guild, new EmbedBuilder().setAuthor(brandAuthor())
      .setTitle('✏️ Message Edited').setColor(THEME.info)
      .addFields(
        { name: 'Author', value: `${oldMessage.author.tag} (${oldMessage.author.id})`, inline: false },
        { name: 'Channel', value: `${oldMessage.channel}`, inline: true },
        { name: 'Before', value: (oldMessage.content || '').substring(0, 100) || 'No content', inline: false },
        { name: 'After', value: (newMessage.content || '').substring(0, 100) || 'No content', inline: false },
      ).setTimestamp(), 'message');
  } catch (error) {
    console.error('Message update error:', error);
  }
});

// Clean up all in-memory data for a guild once the bot is removed from it.
client.on('guildDelete', (guild) => {
  delete warnings[guild.id];
  delete antiPing[guild.id];
  delete chatFilters[guild.id];
  delete logChannels[guild.id];
  delete welcomeChannels[guild.id];
  delete autoRoles[guild.id];
  delete welcomeEnabled[guild.id];
  delete welcomeMessages[guild.id];
  delete userLevels[guild.id];
  delete snipedMessages[guild.id];
  delete levelSystemEnabled[guild.id];
  delete kickAnnouncements[guild.id];
  console.log(`Cleaned up in-memory data for guild ${guild.id} (${guild.name || 'unknown'})`);
});

client.on('error', (error) => console.error('Discord.js error:', error));
client.on('warn', (info) => console.warn('Discord.js warning:', info));
process.on('unhandledRejection', (reason, promise) => console.error('Unhandled Rejection at:', promise, 'reason:', reason));
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// ==================== BOT LOGIN ====================
async function start() {
  try {
    if (!TOKEN) { console.error('❌ DISCORD_TOKEN not found in .env'); process.exit(1); }
    if (!CLIENT_ID) { console.error('❌ CLIENT_ID not found in .env'); process.exit(1); }
    if (!KICK_CLIENT_ID || !KICK_CLIENT_SECRET) {
      console.warn('⚠️ KICK_CLIENT_ID / KICK_CLIENT_SECRET not set — Kick live announcements will be disabled.');
    }

    const PORT = process.env.PORT || 3000;
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'online', bot: BRAND_NAME, timestamp: new Date().toISOString() }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    server.listen(PORT, () => console.log(`🌐 HTTP Server running on port ${PORT}`));

    console.log('🚀 Starting bot...');
    await client.login(TOKEN);
    await registerCommands();
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

start();
