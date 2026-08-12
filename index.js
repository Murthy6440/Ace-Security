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
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// ==================== UI THEME ====================
const THEME = {
  success: 0x2ecc71,
  error: 0xe74c3c,
  warning: 0xf1c40f,
  info: 0x3498db,
  primary: 0x7289da,
  danger: 0xe74c3c,
  mute: 0xf1c40f,
  level: 0x7289da,
  kick: 0x53fc18,
  youtube: 0xff0000,
};
const BRAND_NAME = 'Z++ Security';
const FOOTER_ICON = 'https://cdn.discordapp.com/emojis/879640511815659570.gif';
const brandFooter = (text) => (text ? { text: `${BRAND_NAME} • ${text}`, iconURL: FOOTER_ICON } : { text: BRAND_NAME });
const brandAuthor = () => ({ name: `${BRAND_NAME} 🛡️`, iconURL: client.user?.displayAvatarURL() || FOOTER_ICON });
const DIVIDER = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

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
const kickAnnouncements = {}; // guildId -> { kickUsername, channelId, roleId, isLive, lastSessionId }
const youtubeAnnouncements = {}; // guildId -> Array<{ handle, channelId, uploadsPlaylistId, discordChannelId, roleId, isLive, lastLiveVideoId, lastSeenVideoId }>

const DEFAULT_WELCOME_MESSAGE = "Welcome to **{server}**, {user}!\nWe're glad to have you here.";

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
          const content = config.roleId ? `<@&${config.roleId}>` : undefined;
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

// ==================== YOUTUBE LIVE ANNOUNCEMENT HELPERS ====================
const YOUTUBE_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — quota-friendly at scale (see below)
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_SHORT_MAX_SECONDS = 60; // duration threshold used to distinguish Shorts from regular videos

/** Parses an ISO 8601 duration (e.g. "PT1M30S", "PT45S") into total seconds. */
function parseIso8601DurationToSeconds(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (parseInt(h || 0, 10) * 3600) + (parseInt(m || 0, 10) * 60) + parseInt(s || 0, 10);
}

/** Accepts a handle (@name), a full channel URL, or a raw UC... channel ID and resolves
 * it to { channelId, title, uploadsPlaylistId, thumbnail }. Costs 1 quota unit. */
async function resolveYoutubeChannel(input) {
  if (!YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY not configured');
  let cleaned = input.trim();
  // Pull a handle or channel ID out of a full URL if one was pasted in.
  const urlMatch = cleaned.match(/youtube\.com\/(@[\w.-]+|channel\/(UC[\w-]{22}))/i);
  if (urlMatch) cleaned = urlMatch[2] || urlMatch[1];

  let url;
  if (/^UC[\w-]{22}$/.test(cleaned)) {
    url = `${YOUTUBE_API_BASE}/channels?part=snippet,contentDetails&id=${encodeURIComponent(cleaned)}&key=${YOUTUBE_API_KEY}`;
  } else {
    const handle = cleaned.startsWith('@') ? cleaned : `@${cleaned}`;
    url = `${YOUTUBE_API_BASE}/channels?part=snippet,contentDetails&forHandle=${encodeURIComponent(handle)}&key=${YOUTUBE_API_KEY}`;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API returned ${res.status}`);
  const body = await res.json();
  const channel = body.items?.[0];
  if (!channel) throw new Error('Channel not found');

  return {
    channelId: channel.id,
    title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails?.default?.url,
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
  };
}

/** Latest video ID in a channel's uploads playlist. Costs 1 quota unit. */
async function getLatestUploadVideoId(uploadsPlaylistId) {
  const url = `${YOUTUBE_API_BASE}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=1&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API returned ${res.status}`);
  const body = await res.json();
  return body.items?.[0]?.contentDetails?.videoId || null;
}

/** Batch-checks up to 50 video IDs for live status + duration in a single call. Costs 1
 * quota unit total regardless of how many IDs are passed — this is what keeps polling cheap. */
async function fetchVideosInfo(videoIds) {
  if (videoIds.length === 0) return {};
  const url = `${YOUTUBE_API_BASE}/videos?part=snippet,liveStreamingDetails,contentDetails&id=${videoIds.map(encodeURIComponent).join(',')}&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API returned ${res.status}`);
  const body = await res.json();
  const map = {};
  for (const item of body.items || []) {
    const durationSeconds = parseIso8601DurationToSeconds(item.contentDetails?.duration);
    map[item.id] = {
      isLive: item.snippet.liveBroadcastContent === 'live',
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
      viewers: item.liveStreamingDetails?.concurrentViewers,
      durationSeconds,
      isShort: durationSeconds > 0 && durationSeconds <= YOUTUBE_SHORT_MAX_SECONDS,
    };
  }
  return map;
}

function buildYoutubeUploadEmbed(config, videoId, info) {
  const kind = info.isShort ? 'Short' : 'video';
  const emoji = info.isShort ? '📱' : '🎬';
  return new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setTitle(`${emoji} ${config.handle} just posted a new ${kind}!`)
    .setURL(info.isShort ? `https://youtube.com/shorts/${videoId}` : `https://youtube.com/watch?v=${videoId}`)
    .setDescription(`**${info.title}**`)
    .setColor(THEME.youtube)
    .setImage(info.thumbnail || null)
    .setTimestamp()
    .setFooter(brandFooter(`YouTube ${info.isShort ? 'Short' : 'Video'} Announcement`));
}

function buildYoutubeLiveEmbed(config, videoId, info) {
  return new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setTitle(`🔴 ${config.handle} is now LIVE on YouTube!`)
    .setURL(`https://youtube.com/watch?v=${videoId}`)
    .setDescription(`**${info.title}**\n\n${DIVIDER}\n\n👀 **Viewers:** ${info.viewers ?? 'N/A'}`)
    .setColor(THEME.youtube)
    .setImage(info.thumbnail || null)
    .setTimestamp()
    .setFooter(brandFooter('YouTube Live Announcement'));
}

/** Polls every tracked YouTube channel across all guilds, batching the expensive
 * live-status/duration check into as few calls as possible to conserve API quota.
 * Detects two independent events: going live, and a new video/Short being published. */
async function pollYoutubeChannels() {
  if (!YOUTUBE_API_KEY) return;

  // Step 1: cheaply fetch each tracked channel's latest upload (1 unit per channel).
  const lookups = []; // { guildId, config, videoId }
  for (const [guildId, list] of Object.entries(youtubeAnnouncements)) {
    for (const config of list || []) {
      try {
        const videoId = await getLatestUploadVideoId(config.uploadsPlaylistId);
        if (videoId) lookups.push({ guildId, config, videoId });
      } catch (error) {
        console.error(`YouTube playlist check error for ${config.handle}:`, error.message);
      }
    }
  }
  if (lookups.length === 0) return;

  // Step 2: batch-check all collected video IDs in chunks of 50 (1 unit per chunk).
  const uniqueIds = Array.from(new Set(lookups.map(l => l.videoId)));
  const infoMap = {};
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    try {
      Object.assign(infoMap, await fetchVideosInfo(chunk));
    } catch (error) {
      console.error('YouTube batch info check error:', error.message);
    }
  }

  // Step 3: announce whichever event actually happened — live takes priority since a
  // livestream also shows up as the latest "upload" and shouldn't double-announce.
  for (const { guildId, config, videoId } of lookups) {
    const info = infoMap[videoId];
    if (!info) continue;

    if (info.isLive) {
      if (config.lastLiveVideoId !== videoId) {
        try {
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          if (guild) {
            const channel = await guild.channels.fetch(config.discordChannelId).catch(() => null);
            if (channel?.isTextBased()) {
              const content = config.roleId ? `<@&${config.roleId}>` : undefined;
              await channel.send({ content, embeds: [buildYoutubeLiveEmbed(config, videoId, info)] }).catch(err => console.error('YouTube live announce send error:', err));
            }
          }
        } catch (error) {
          console.error(`YouTube live announce error for ${config.handle}:`, error.message);
        }
        config.lastLiveVideoId = videoId;
        config.lastSeenVideoId = videoId; // don't also fire an "upload" announcement for this one
      }
      config.isLive = true;
    } else {
      config.isLive = false;
      if (config.lastSeenVideoId !== videoId) {
        try {
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          if (guild) {
            const channel = await guild.channels.fetch(config.discordChannelId).catch(() => null);
            if (channel?.isTextBased()) {
              const content = config.roleId ? `<@&${config.roleId}>` : undefined;
              await channel.send({ content, embeds: [buildYoutubeUploadEmbed(config, videoId, info)] }).catch(err => console.error('YouTube upload announce send error:', err));
            }
          }
        } catch (error) {
          console.error(`YouTube upload announce error for ${config.handle}:`, error.message);
        }
        config.lastSeenVideoId = videoId;
      }
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

// ==================== UNIFIED RESPONSE FORMAT ====================
// Every embed in the bot now follows the same layout:
//   [ Server Banner ]
//   Title (centered)
//
//   Body / content
//   Reason: ... (only present when the command actually has a reason)
const DEFAULT_BANNER_IMAGE = 'https://cdn.discordapp.com/emojis/879640511815659570.gif';

/** Fakes centered-looking titles since Discord embeds don't support real text alignment. */
function centerTitle(text) {
  return `『 ${text} 』`;
}

/** Resolves the best available "server banner" for a guild: real banner > server icon > brand fallback. */
function resolveBanner(guild) {
  if (guild) {
    const banner = guild.bannerURL?.({ size: 256 });
    if (banner) return banner;
    const icon = guild.iconURL?.({ size: 256 });
    if (icon) return icon;
  }
  return DEFAULT_BANNER_IMAGE;
}

/**
 * Builds a standardized embed: banner image up top, centered title, a blank line, the
 * body content, and — only if a reason string is actually passed in — a trailing Reason line.
 */
function buildEmbed({ title, description, color, guild, reason, thumbnail }) {
  const embed = new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setTitle(centerTitle(title))
    .setDescription(`\n${description || ''}${reason ? `\n\n📝 **Reason:** ${reason}` : ''}`)
    .setColor(color)
    // Full-width banner (server pfp, or real banner if the server has one set) across the top.
    .setImage(resolveBanner(guild))
    .setTimestamp()
    .setFooter(brandFooter());
  // A specific thumbnail (e.g. a target user's avatar) still shows separately, small, in the corner.
  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

function successEmbed(title, description, opts = {}) {
  return buildEmbed({ title: `✅ ${title}`, description, color: THEME.success, ...opts });
}
function errorEmbed(title, description, opts = {}) {
  return buildEmbed({ title: `❌ ${title}`, description, color: THEME.error, ...opts });
}
function infoEmbed(title, description, opts = {}) {
  return buildEmbed({ title: `ℹ️ ${title}`, description, color: THEME.info, ...opts });
}
function warningEmbed(title, description, opts = {}) {
  return buildEmbed({ title: `⚠️ ${title}`, description, color: THEME.warning, ...opts });
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
  const embed = buildEmbed({
    title: `⚠️ ${title}`,
    description: `${description}\n\n${DIVIDER}\n\n*This action cannot be undone.*`,
    color: THEME.warning,
    guild: interaction.guild,
  });

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
        { name: 'bots', description: 'Only delete messages sent by bots', type: 5, required: false },
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
      ],
    },
    { name: 'removekickchannel', description: 'Stop Kick live announcements in this server' },
    { name: 'kickstatus', description: 'Check the current Kick announcement configuration' },
    {
      name: 'addyoutubechannel',
      description: 'Track a YouTube channel and announce when they go live',
      options: [
        { name: 'ytchannel', description: 'YouTube handle (@name), channel URL, or channel ID', type: 3, required: true },
        { name: 'channel', description: 'Discord channel to post the announcement in', type: 7, required: true },
        { name: 'role', description: 'Optional role to ping when they go live', type: 8, required: false },
      ],
    },
    {
      name: 'removeyoutubechannel',
      description: 'Stop tracking a YouTube channel',
      options: [{ name: 'ytchannel', description: 'The handle you used when adding it (e.g. @name)', type: 3, required: true }],
    },
    { name: 'youtubelist', description: 'View all tracked YouTube channels and their live status' },
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
  const speedStatus = latency < 100 ? '⚡ Excellent' : latency < 200 ? '✅ Good' : latency < 500 ? '⚠️ Fair' : '🔴 Slow';
  const color = latency < 100 ? THEME.success : latency < 200 ? THEME.info : latency < 500 ? THEME.warning : THEME.error;

  await interaction.reply({
    embeds: [buildEmbed({
      title: '🏓 Pong!',
      description: `**Latency:** \`${latency}ms\`\n**Status:** ${speedStatus}`,
      color,
      guild: interaction.guild,
    })],
  });
}

const HELP_CATEGORIES = {
  overview: { label: '🧭 Overview', emoji: '🧭' },
  moderation: {
    label: '🛡️ Moderation',
    emoji: '🛡️',
    commands: ['`/kick <member> [reason]`', '`/ban <member> [reason]`', '`/mute <member> [minutes] [reason]`', '`/unmute <member>`', '`/warn <user> <reason>`', '`/warnings <user>`', '`/clearwarnings <user>`', '`/clear <amount>`', '`/purge <amount> [user] [contains] [bots]`', '`/snipe` — View last deleted message'],
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
    commands: ['`/ping` — Latency check', '`/help` — This menu', '`/userinfo [user]`', '`/serverinfo`', '`/avatar [user]`', '`/setwelcomemessage <message>`'],
  },
  community: {
    label: '💬 Community',
    emoji: '💬',
    commands: ['`/rank [user]` — Rank card', '`/level [user]` — XP & level card', '`/leaderboard` — Top 10 by XP', '`/levelsystem on|off` — Admin: enable/disable XP tracking', '`/welcomemessage` — Preview welcome text'],
  },
  streaming: {
    label: '📺 Streaming',
    emoji: '📺',
    commands: ['`/setkickchannel <kickuser> <channel> [role]` — Admin: announce when a Kick streamer goes live', '`/removekickchannel` — Admin: stop Kick announcements', '`/kickstatus` — View current Kick announcement config', '`/addyoutubechannel <ytchannel> <channel> [role]` — Admin: track a YouTube channel', '`/removeyoutubechannel <ytchannel>` — Admin: stop tracking one', '`/youtubelist` — View all tracked YouTube channels'],
  },
};
const HELP_PAGE_ORDER = ['overview', 'moderation', 'security', 'logging', 'utility', 'community', 'streaming'];

function buildHelpEmbed(pageKey, guild) {
  if (pageKey === 'overview') {
    return buildEmbed({
      title: '🛡️ Command Directory',
      description: `Use the dropdown below to choose a category and view its commands.`,
      color: THEME.primary,
      guild,
    });
  }
  const cat = HELP_CATEGORIES[pageKey];
  return buildEmbed({
    title: cat.label.replace(/^\S+\s/, ''),
    description: cat.commands.map((c) => `▸ ${c}`).join('\n\n'),
    color: THEME.primary,
    guild,
  });
}

function buildHelpSelectRow(currentKey, userId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`help_select_${userId}`)
    .setPlaceholder('🧭 Choose a category to view...')
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

async function handleSnipe(interaction) {
  const sniped = snipedMessages[interaction.guildId]?.[interaction.channelId];
  if (!sniped) {
    return interaction.reply({ embeds: [infoEmbed('👀 Nothing to Snipe', 'No recently deleted messages found in this channel.', { guild: interaction.guild })], ephemeral: true });
  }

  const snipeEmbed = buildEmbed({
    title: '👀 Sniped Message',
    description: `**Author:** ${sniped.authorTag}\n**Channel:** ${interaction.channel}\n\n${DIVIDER}\n\n${sniped.content || '*No text content*'}`,
    color: THEME.warning,
    guild: interaction.guild,
    thumbnail: sniped.authorAvatar,
  });

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

  const levelEmbed = buildEmbed({
    title: `🏆 ${targetUser.username}'s Rank Card`,
    description: `**Level:** ${level}\n**Total XP:** ${data.xp}\n**Server Rank:** ${rank > 0 ? `#${rank}` : 'Unranked'}\n\n**Progress to Level ${level + 1}**\n\`${progressBar(xpIntoLevel, xpNeeded)}\`\n${xpIntoLevel} / ${xpNeeded} XP`,
    color: THEME.level,
    guild: interaction.guild,
    thumbnail: targetUser.displayAvatarURL({ size: 256 }),
  });

  await interaction.reply({ embeds: [levelEmbed] });
}

async function handleLevelSystemToggle(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const state = interaction.options.getString('state');
  levelSystemEnabled[interaction.guildId] = state === 'on';
  await interaction.reply({
    embeds: [successEmbed('Level System', `The XP/level system is now **${state === 'on' ? 'ENABLED ✅' : 'DISABLED ❌'}** in this server.${state === 'off' ? '\n\nMembers will stop earning XP and level-up announcements will stop. Existing XP/levels are kept, not wiped.' : ''}`, { guild: interaction.guild })],
  });
}

async function handleLeaderboard(interaction) {
  const guildId = interaction.guildId;
  const entries = Object.entries(userLevels[guildId] || {}).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);

  if (entries.length === 0) {
    await interaction.reply({ embeds: [infoEmbed('📊 Leaderboard', 'Nobody has earned any XP yet — start chatting to appear here!', { guild: interaction.guild })] });
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = entries.map(([userId, data], i) => {
    const level = getLevelFromXp(data.xp);
    const rankIcon = medals[i] || `**#${i + 1}**`;
    return `${rankIcon} <@${userId}> — Level **${level}** (${data.xp} XP)`;
  });

  const leaderboardEmbed = buildEmbed({
    title: `📊 ${interaction.guild.name} Leaderboard`,
    description: lines.join('\n\n'),
    color: THEME.level,
    guild: interaction.guild,
    thumbnail: interaction.guild.iconURL({ size: 256 }),
  });

  await interaction.reply({ embeds: [leaderboardEmbed] });
}

async function handleUserInfo(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  let body = `**ID:** \`${user.id}\`\n**Type:** ${user.bot ? '🤖 Bot' : '👥 User'}\n**Account Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>`;

  if (member) {
    const statusEmoji = { online: '🟢', dnd: '🔴', idle: '🟡' }[member.presence?.status] || '⚫';
    const roleList = member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.toString()).join(', ') || 'No roles';
    body += `\n**Joined Server:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>\n**Status:** ${statusEmoji} ${member.presence?.status || 'offline'}\n**Roles (${member.roles.cache.size - 1}):** ${roleList}`;

    const guildId = interaction.guildId;
    if (userLevels[guildId]?.[user.id]) {
      const data = userLevels[guildId][user.id];
      body += `\n**Level:** ${getLevelFromXp(data.xp)} (${data.xp} XP)`;
    }
  }

  const userInfoEmbed = buildEmbed({
    title: `👤 ${user.username}`,
    description: body,
    color: THEME.primary,
    guild: interaction.guild,
    thumbnail: user.displayAvatarURL({ size: 256 }),
  });
  await interaction.reply({ embeds: [userInfoEmbed] });
}

async function handleServerInfo(interaction) {
  const guild = interaction.guild;
  const botCount = guild.members.cache.filter(m => m.user.bot).size;

  const body = [
    `👑 **Owner:** <@${guild.ownerId}>`,
    `📅 **Created:** <t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
    `**ID:** \`${guild.id}\``,
    `👥 **Members:** ${guild.memberCount}`,
    `🤖 **Bots:** ${botCount}`,
    `💬 **Boost Tier:** Level ${guild.premiumTier} (${guild.premiumSubscriptionCount || 0} boosts)`,
    `📊 **Channels:** Text: ${guild.channels.cache.filter(c => c.isTextBased()).size} • Voice: ${guild.channels.cache.filter(c => c.isVoiceBased()).size}`,
    `🎭 **Roles:** ${guild.roles.cache.size}`,
  ].join('\n');

  const serverInfoEmbed = buildEmbed({
    title: `🏢 ${guild.name}`,
    description: body,
    color: THEME.info,
    guild,
    thumbnail: guild.iconURL({ size: 256 }),
  });

  await interaction.reply({ embeds: [serverInfoEmbed] });
}

async function handleAvatar(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const avatarEmbed = new EmbedBuilder()
    .setAuthor(brandAuthor())
    .setTitle(centerTitle(`🖼️ ${user.username}'s Avatar`))
    .setDescription('\n')
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
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', '🔒 You need **Kick Members** permission to use this command.', { guild: interaction.guild })], ephemeral: true });
  }
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return interaction.reply({ embeds: [errorEmbed('Member Not Found', '❓ The specified member could not be found.', { guild: interaction.guild })], ephemeral: true });
  }
  if (!canModerate(moderator, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Kick', '⛔ You cannot kick this user due to role hierarchy or self-action.', { guild: interaction.guild })], ephemeral: true });
  }
  if (!canBotModerate(interaction.guild, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Kick', "⛔ My role isn't high enough to kick this user. Move my role above theirs.", { guild: interaction.guild })], ephemeral: true });
  }

  const confirmed = await confirmAction(interaction, {
    title: 'Confirm Kick',
    description: `Kick **${targetUser.tag}** from the server?`,
  });
  if (confirmed === null) {
    return interaction.editReply({ embeds: [infoEmbed('Timed Out', 'No response received — kick cancelled.', { guild: interaction.guild })], components: [] });
  }
  if (confirmed === false) {
    return interaction.editReply({ embeds: [infoEmbed('Cancelled', `Kick for **${targetUser.tag}** was cancelled.`, { guild: interaction.guild })], components: [] });
  }

  try {
    await targetMember.kick(reason);
    await sendLog(interaction.guild, buildEmbed({
      title: '👢 Member Kicked',
      description: `**User:** ${targetUser.tag} (\`${targetUser.id}\`)\n**Moderator:** ${moderator.user.tag}`,
      color: THEME.error,
      guild: interaction.guild,
      reason,
      thumbnail: targetUser.displayAvatarURL(),
    }), 'kick');

    await interaction.editReply({
      embeds: [buildEmbed({
        title: '👢 Kick Successful',
        description: `**${targetUser.tag}** has been removed from the server.`,
        color: THEME.success,
        guild: interaction.guild,
        reason,
        thumbnail: targetUser.displayAvatarURL(),
      })],
      components: [],
    });
  } catch (error) {
    console.error('Kick error:', error);
    const description = error.code === 50013 ? "⚠️ I don't have permission to kick this member." : '⚠️ Could not kick the member. Please try again.';
    await interaction.editReply({ embeds: [errorEmbed('Kick Failed', description, { guild: interaction.guild })], components: [] });
  }
}

async function handleBan(interaction) {
  const targetUser = interaction.options.getUser('member');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.BanMembers)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', '🔒 You need **Ban Members** permission to use this command.', { guild: interaction.guild })], ephemeral: true });
  }
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (targetMember && !canModerate(moderator, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Ban', '⛔ You cannot ban this user due to role hierarchy or self-action.', { guild: interaction.guild })], ephemeral: true });
  }
  if (targetMember && !canBotModerate(interaction.guild, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Ban', "⛔ My role isn't high enough to ban this user. Move my role above theirs.", { guild: interaction.guild })], ephemeral: true });
  }

  const confirmed = await confirmAction(interaction, {
    title: 'Confirm Ban',
    description: `Permanently ban **${targetUser.tag}** from the server?`,
  });
  if (confirmed === null) {
    return interaction.editReply({ embeds: [infoEmbed('Timed Out', 'No response received — ban cancelled.', { guild: interaction.guild })], components: [] });
  }
  if (confirmed === false) {
    return interaction.editReply({ embeds: [infoEmbed('Cancelled', `Ban for **${targetUser.tag}** was cancelled.`, { guild: interaction.guild })], components: [] });
  }

  try {
    await interaction.guild.bans.create(targetUser.id, { reason });
    await sendLog(interaction.guild, buildEmbed({
      title: '🔨 Member Banned',
      description: `**User:** ${targetUser.tag} (\`${targetUser.id}\`)\n**Moderator:** ${moderator.user.tag}`,
      color: THEME.danger,
      guild: interaction.guild,
      reason,
      thumbnail: targetUser.displayAvatarURL(),
    }), 'ban');

    await interaction.editReply({
      embeds: [buildEmbed({
        title: '🔨 Ban Successful',
        description: `**${targetUser.tag}** has been **permanently banned**.`,
        color: THEME.danger,
        guild: interaction.guild,
        reason,
        thumbnail: targetUser.displayAvatarURL(),
      })],
      components: [],
    });
  } catch (error) {
    console.error('Ban error:', error);
    const description = error.code === 50013 ? "⚠️ I don't have permission to ban this member." : '⚠️ Could not ban the member. Please try again.';
    await interaction.editReply({ embeds: [errorEmbed('Ban Failed', description, { guild: interaction.guild })], components: [] });
  }
}

async function handleMute(interaction) {
  const targetUser = interaction.options.getUser('member');
  const minutesInput = interaction.options.getInteger('minutes') ?? 10;
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', '🔒 You need **Moderate Members** permission to use this command.', { guild: interaction.guild })], ephemeral: true });
  }
  const MAX_MINUTES = 40320;
  if (minutesInput < 1) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Duration', 'Mute duration must be at least 1 minute.', { guild: interaction.guild })], ephemeral: true });
  }
  const minutes = Math.min(minutesInput, MAX_MINUTES);

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return interaction.reply({ embeds: [errorEmbed('Member Not Found', '❓ The specified member could not be found.', { guild: interaction.guild })], ephemeral: true });
  }
  if (!canModerate(moderator, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Mute', '⛔ You cannot mute this user due to role hierarchy or self-action.', { guild: interaction.guild })], ephemeral: true });
  }
  if (!canBotModerate(interaction.guild, targetMember)) {
    return interaction.reply({ embeds: [errorEmbed('Cannot Mute', "⛔ My role isn't high enough to mute this user. Move my role above theirs.", { guild: interaction.guild })], ephemeral: true });
  }

  try {
    await targetMember.timeout(minutes * 60 * 1000, reason);
    await sendLog(interaction.guild, buildEmbed({
      title: '🔇 Member Muted',
      description: `**User:** ${targetUser.tag} (\`${targetUser.id}\`)\n**Duration:** ${minutes} minutes\n**Moderator:** ${moderator.user.tag}`,
      color: THEME.mute,
      guild: interaction.guild,
      reason,
      thumbnail: targetUser.displayAvatarURL(),
    }), 'mute');

    await interaction.reply({
      embeds: [buildEmbed({
        title: '🔇 Mute Successful',
        description: `**${targetUser.tag}** has been muted.\n**Duration:** \`${minutes} minutes\``,
        color: THEME.mute,
        guild: interaction.guild,
        reason,
        thumbnail: targetUser.displayAvatarURL(),
      })],
    });
  } catch (error) {
    console.error('Mute error:', error);
    const description = error.code === 50013 ? "⚠️ I don't have permission to timeout this member." : '⚠️ Could not mute the member. Please try again.';
    await interaction.reply({ embeds: [errorEmbed('Mute Failed', description, { guild: interaction.guild })], ephemeral: true });
  }
}

async function handleUnmute(interaction) {
  const targetUser = interaction.options.getUser('member');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Moderate Members** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return interaction.reply({ embeds: [errorEmbed('Error', 'Member not found.', { guild: interaction.guild })], ephemeral: true });
  }

  try {
    await targetMember.timeout(null);
    await sendLog(interaction.guild, buildEmbed({
      title: '🔊 Member Unmuted',
      description: `**Member:** ${targetUser.tag} (${targetUser.id})\n**Moderator:** ${moderator.user.tag}`,
      color: THEME.success,
      guild: interaction.guild,
    }), 'mute');
    await interaction.reply({ embeds: [successEmbed('Unmute Successful', `${targetUser.tag} has been unmuted.`, { guild: interaction.guild })] });
  } catch (error) {
    console.error('Unmute error:', error);
    await interaction.reply({ embeds: [errorEmbed('Error', 'Could not unmute member.', { guild: interaction.guild })], ephemeral: true });
  }
}

async function handleWarn(interaction) {
  const targetUser = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const moderator = interaction.member;
  const guildId = interaction.guildId;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Moderate Members** permission.', { guild: interaction.guild })], ephemeral: true });
  }

  if (!warnings[guildId]) warnings[guildId] = {};
  if (!warnings[guildId][targetUser.id]) warnings[guildId][targetUser.id] = [];
  warnings[guildId][targetUser.id].push({ mod: moderator.user.tag, reason, timestamp: Date.now() });
  const total = warnings[guildId][targetUser.id].length;

  await sendLog(interaction.guild, buildEmbed({
    title: '⚠️ User Warned',
    description: `**User:** ${targetUser.tag} (${targetUser.id})\n**Moderator:** ${moderator.user.tag}\n**Total Warnings:** ${total}`,
    color: THEME.warning,
    guild: interaction.guild,
    reason,
  }), 'warn');

  await interaction.reply({
    embeds: [warningEmbed('Warning Issued', `${targetUser} has been warned.\n**Total Warnings:** ${total}`, { guild: interaction.guild, reason })],
  });
}

async function handleWarnings(interaction) {
  const targetUser = interaction.options.getUser('user');
  const guildId = interaction.guildId;
  const userWarnings = warnings[guildId]?.[targetUser.id];

  if (!userWarnings || userWarnings.length === 0) {
    return interaction.reply({
      embeds: [buildEmbed({
        title: '📋 Clean Record',
        description: `✅ **${targetUser.tag}** has no warnings.`,
        color: THEME.success,
        guild: interaction.guild,
        thumbnail: targetUser.displayAvatarURL(),
      })],
    });
  }

  const warningList = userWarnings.map((w, i) => {
    const severity = i >= 2 ? '🔴' : i >= 1 ? '🟠' : '🟡';
    return `${severity} **#${i + 1}** — ${w.reason}\n> *by ${w.mod} • <t:${Math.floor(w.timestamp / 1000)}:R>*`;
  }).join('\n\n');

  await interaction.reply({
    embeds: [buildEmbed({
      title: `⚠️ Warnings — ${targetUser.tag}`,
      description: `${warningList}\n\n📊 **Summary — Total:** ${userWarnings.length}`,
      color: THEME.warning,
      guild: interaction.guild,
      thumbnail: targetUser.displayAvatarURL(),
    })],
  });
}

async function handleClearWarnings(interaction) {
  const targetUser = interaction.options.getUser('user');
  const moderator = interaction.member;
  const guildId = interaction.guildId;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Moderate Members** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const userWarnings = warnings[guildId]?.[targetUser.id];
  if (!userWarnings || userWarnings.length === 0) {
    return interaction.reply({ embeds: [infoEmbed('No Warnings', `${targetUser.tag} has no warnings to clear.`, { guild: interaction.guild })], ephemeral: true });
  }

  const count = userWarnings.length;
  const confirmed = await confirmAction(interaction, {
    title: 'Confirm Clear Warnings',
    description: `Clear all **${count}** warning(s) for **${targetUser.tag}**?`,
  });
  if (confirmed === null) {
    return interaction.editReply({ embeds: [infoEmbed('Timed Out', 'No response received — nothing was cleared.', { guild: interaction.guild })], components: [] });
  }
  if (confirmed === false) {
    return interaction.editReply({ embeds: [infoEmbed('Cancelled', `Clear warnings for **${targetUser.tag}** was cancelled.`, { guild: interaction.guild })], components: [] });
  }

  warnings[guildId][targetUser.id] = [];

  await sendLog(interaction.guild, buildEmbed({
    title: '🧹 Warnings Cleared',
    description: `**User:** ${targetUser.tag} (${targetUser.id})\n**Moderator:** ${moderator.user.tag}\n**Cleared:** ${count}`,
    color: THEME.success,
    guild: interaction.guild,
  }), 'warn');
  await interaction.editReply({ embeds: [successEmbed('Warnings Cleared', `All ${count} warnings for **${targetUser.tag}** have been cleared.`, { guild: interaction.guild })], components: [] });
}

async function handleClear(interaction) {
  const amount = interaction.options.getInteger('amount');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Messages** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  if (amount < 1 || amount > 100) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Amount', 'Please specify between 1 and 100 messages.', { guild: interaction.guild })], ephemeral: true });
  }

  await interaction.deferReply();
  try {
    const deleted = await interaction.channel.bulkDelete(amount, true);
    await sendLog(interaction.guild, buildEmbed({
      title: '🧹 Messages Cleared',
      description: `**Channel:** ${interaction.channel}\n**Moderator:** ${moderator.user.tag}\n**Deleted:** ${deleted.size}`,
      color: THEME.info,
      guild: interaction.guild,
    }), 'purge');
    await interaction.editReply({ embeds: [successEmbed('Messages Deleted', `🧹 ${deleted.size} message(s) deleted${deleted.size < amount ? ' (some were older than 14 days and skipped)' : ''}.`, { guild: interaction.guild })] });
  } catch (error) {
    console.error('Clear error:', error);
    await interaction.editReply({ embeds: [errorEmbed('Error', 'Could not delete messages.', { guild: interaction.guild })] });
  }
}

async function handlePurge(interaction) {
  const amount = interaction.options.getInteger('amount');
  const filterUser = interaction.options.getUser('user');
  const filterText = interaction.options.getString('contains');
  const botsOnly = interaction.options.getBoolean('bots');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Messages** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  if (amount < 1 || amount > 100) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Amount', 'Please specify between 1-100 messages.', { guild: interaction.guild })], ephemeral: true });
  }

  await interaction.deferReply();
  try {
    const messages = await interaction.channel.messages.fetch({ limit: amount });
    let toDelete = messages;
    if (filterUser) toDelete = toDelete.filter(m => m.author.id === filterUser.id);
    if (filterText) toDelete = toDelete.filter(m => m.content.toLowerCase().includes(filterText.toLowerCase()));
    if (botsOnly) toDelete = toDelete.filter(m => m.author.bot);

    if (toDelete.size === 0) {
      return interaction.editReply({ embeds: [warningEmbed('No Messages Found', 'No messages matched the specified filters.', { guild: interaction.guild })] });
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
    if (botsOnly) summary += `\n\n**Filter:** 🤖 Bots only`;

    await sendLog(interaction.guild, buildEmbed({
      title: '🧹 Messages Purged',
      description: `${summary}\n\n👮 **Moderator:** ${moderator.user.tag}\n📍 **Channel:** ${interaction.channel}`,
      color: THEME.info,
      guild: interaction.guild,
    }), 'purge');

    await interaction.editReply({ embeds: [successEmbed('Purge Successful', summary, { guild: interaction.guild })] });
  } catch (error) {
    console.error('Purge error:', error);
    await interaction.editReply({ embeds: [errorEmbed('Purge Failed', 'Could not purge messages. Please try again.', { guild: interaction.guild })] });
  }
}

async function handleLock(interaction) {
  const moderator = interaction.member;
  if (!moderator.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Channels** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  try {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
    await sendLog(interaction.guild, buildEmbed({
      title: '🔒 Channel Locked',
      description: `**Channel:** ${interaction.channel}\n**Moderator:** ${moderator.user.tag}`,
      color: THEME.error,
      guild: interaction.guild,
    }), 'lock');

    const unlockRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('quick_unlock').setLabel('Unlock').setEmoji('🔓').setStyle(ButtonStyle.Success),
    );
    const message = await interaction.reply({ embeds: [successEmbed('Channel Locked', '🔒 Members can no longer send messages here.', { guild: interaction.guild })], components: [unlockRow], fetchReply: true });

    message.awaitMessageComponent({ componentType: ComponentType.Button, filter: (b) => b.customId === 'quick_unlock', time: 60_000 })
      .then(async (btn) => {
        if (!btn.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return btn.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Channels** permission.', { guild: interaction.guild })], ephemeral: true });
        }
        await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
        await sendLog(interaction.guild, buildEmbed({
          title: '🔓 Channel Unlocked',
          description: `**Channel:** ${interaction.channel}\n**Moderator:** ${btn.user.tag}`,
          color: THEME.success,
          guild: interaction.guild,
        }), 'lock');
        await btn.update({ embeds: [successEmbed('Channel Unlocked', '🔓 Members can send messages again.', { guild: interaction.guild })], components: [] });
      })
      .catch(() => interaction.editReply({ components: [] }).catch(() => {}));
  } catch (error) {
    console.error('Lock error:', error);
    await interaction.reply({ embeds: [errorEmbed('Error', 'Could not lock channel.', { guild: interaction.guild })], ephemeral: true });
  }
}

async function handleUnlock(interaction) {
  const moderator = interaction.member;
  if (!moderator.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Channels** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  try {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
    await sendLog(interaction.guild, buildEmbed({
      title: '🔓 Channel Unlocked',
      description: `**Channel:** ${interaction.channel}\n**Moderator:** ${moderator.user.tag}`,
      color: THEME.success,
      guild: interaction.guild,
    }), 'lock');

    const lockRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('quick_lock').setLabel('Lock').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    );
    const message = await interaction.reply({ embeds: [successEmbed('Channel Unlocked', '🔓 Members can send messages again.', { guild: interaction.guild })], components: [lockRow], fetchReply: true });

    message.awaitMessageComponent({ componentType: ComponentType.Button, filter: (b) => b.customId === 'quick_lock', time: 60_000 })
      .then(async (btn) => {
        if (!btn.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return btn.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Manage Channels** permission.', { guild: interaction.guild })], ephemeral: true });
        }
        await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
        await sendLog(interaction.guild, buildEmbed({
          title: '🔒 Channel Locked',
          description: `**Channel:** ${interaction.channel}\n**Moderator:** ${btn.user.tag}`,
          color: THEME.error,
          guild: interaction.guild,
        }), 'lock');
        await btn.update({ embeds: [successEmbed('Channel Locked', '🔒 Members can no longer send messages here.', { guild: interaction.guild })], components: [] });
      })
      .catch(() => interaction.editReply({ components: [] }).catch(() => {}));
  } catch (error) {
    console.error('Unlock error:', error);
    await interaction.reply({ embeds: [errorEmbed('Error', 'Could not unlock channel.', { guild: interaction.guild })], ephemeral: true });
  }
}

async function handleAntiPing(interaction) {
  const action = interaction.options.getString('action');
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  antiPing[interaction.guildId] = action === 'on';
  await interaction.reply({ embeds: [successEmbed(`Anti-Ping ${action === 'on' ? 'Enabled' : 'Disabled'}`, action === 'on' ? '🛡️ Mass pings and mentions will now be automatically removed.' : 'Anti-ping protection is now off.', { guild: interaction.guild })] });
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
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }

  const guildId = interaction.guildId;
  if (!chatFilters[guildId]) chatFilters[guildId] = [];

  if (action === 'add') {
    if (!word?.trim()) return interaction.reply({ embeds: [errorEmbed('No Word Provided', 'Usage: `/filter add [word or phrase]` — separate multiple with commas, e.g. `word1, word2, word3`', { guild: interaction.guild })], ephemeral: true });
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
      return interaction.reply({ embeds: [warningEmbed('Already Blocked', requested.length === 1 ? `"${requested[0]}" is already filtered.` : `All ${requested.length} word(s) were already filtered.`, { guild: interaction.guild })], ephemeral: true });
    }

    let body = `🚫 Blocked **${added.length}** new word(s).\n\n**Total blocked:** ${chatFilters[guildId].length}\n\n**Added:**\n${formatWordChunks(added).join('\n')}`;
    if (alreadyBlocked.length > 0) {
      body += `\n\n**Skipped (already blocked) — ${alreadyBlocked.length}:**\n${formatWordChunks(alreadyBlocked)[0] || 'None'}`;
    }
    return interaction.reply({ embeds: [successEmbed('Added to Filter', body, { guild: interaction.guild })] });
  }

  if (action === 'remove') {
    if (!word?.trim()) return interaction.reply({ embeds: [errorEmbed('No Word Provided', 'Usage: `/filter remove [word or phrase]` — separate multiple with commas, e.g. `word1, word2, word3`', { guild: interaction.guild })], ephemeral: true });
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
      return interaction.reply({ embeds: [errorEmbed('Not Found', requested.length === 1 ? `"${requested[0]}" isn't in the filter.` : `None of those ${requested.length} word(s) were in the filter.`, { guild: interaction.guild })], ephemeral: true });
    }

    let body = `**${removed.length}** word(s) removed.\n\n**Total blocked:** ${chatFilters[guildId].length}\n\n**Removed:**\n${formatWordChunks(removed).join('\n')}`;
    if (notFound.length > 0) {
      body += `\n\n**Skipped (not found) — ${notFound.length}:**\n${formatWordChunks(notFound)[0] || 'None'}`;
    }
    return interaction.reply({ embeds: [successEmbed('Removed from Filter', body, { guild: interaction.guild })] });
  }

  if (action === 'list') {
    if (chatFilters[guildId].length === 0) {
      return interaction.reply({ embeds: [infoEmbed('Filter List', 'No words are currently filtered. Try `/filter reset` to load a basic starter list.', { guild: interaction.guild })] });
    }
    const CHUNK_SIZE = 20;
    const words = chatFilters[guildId];
    const sections = [];
    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
      const chunk = words.slice(i, i + CHUNK_SIZE);
      sections.push(`**Words ${i + 1}–${i + chunk.length}:**\n${chunk.map(w => `\`${w}\``).join(', ')}`);
    }
    return interaction.reply({ embeds: [buildEmbed({
      title: '🚫 Blocked Words',
      description: sections.join('\n\n'),
      color: THEME.error,
      guild: interaction.guild,
    })] });
  }

  if (action === 'reset') {
    const merged = Array.from(new Set([...chatFilters[guildId], ...DEFAULT_FILTER_WORDS]));
    chatFilters[guildId] = merged;
    return interaction.reply({
      embeds: [successEmbed('Default Filter Loaded', `🚫 Loaded a basic starter wordlist (English, Hindi, and Hinglish profanity).\n\n**Total blocked:** ${merged.length}\n\nUse \`/filter list\` to review it, or \`/filter add\`/\`/filter remove\` to fine-tune it.`, { guild: interaction.guild })],
    });
  }

  if (action === 'clear') {
    const count = chatFilters[guildId].length;
    chatFilters[guildId] = [];
    return interaction.reply({ embeds: [successEmbed('Filter Cleared', `🗑️ Removed all ${count} blocked word(s). The chat filter is now off until you add words again.`, { guild: interaction.guild })] });
  }
}

async function handleSetLog(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const channel = interaction.options.getChannel('channel');
  const action = interaction.options.getString('action') || 'general';
  if (!channel.isTextBased()) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Channel', 'Please select a text channel.', { guild: interaction.guild })], ephemeral: true });
  }
  if (!logChannels[interaction.guildId]) logChannels[interaction.guildId] = {};
  logChannels[interaction.guildId][action] = channel.id;

  const meta = LOG_ACTIONS[action] || LOG_ACTIONS.general;
  await interaction.reply({ embeds: [successEmbed('Log Channel Set', `📋 **${meta.emoji} ${meta.label}** logs will now be sent to ${channel}.`, { guild: interaction.guild })] });
}

async function handleRemoveLog(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const action = interaction.options.getString('action');
  const guildConfig = logChannels[interaction.guildId];
  if (!guildConfig || !guildConfig[action]) {
    return interaction.reply({ embeds: [infoEmbed('Nothing to Remove', `No specific log channel is set for **${LOG_ACTIONS[action]?.label || action}**. It's already falling back to general.`, { guild: interaction.guild })], ephemeral: true });
  }
  delete guildConfig[action];
  const meta = LOG_ACTIONS[action] || LOG_ACTIONS.general;
  await interaction.reply({ embeds: [successEmbed('Log Channel Removed', `**${meta.emoji} ${meta.label}** logs will now fall back to the general log channel (if set).`, { guild: interaction.guild })] });
}

async function handleLogs(interaction) {
  const guildConfig = logChannels[interaction.guildId] || {};
  const lines = Object.entries(LOG_ACTIONS).map(([key, meta]) => {
    const channelId = guildConfig[key];
    const value = channelId ? `<#${channelId}>` : (key === 'general' ? '*Not set*' : '*Falls back to general*');
    return `${meta.emoji} **${meta.label}** — ${value}`;
  });

  await interaction.reply({
    embeds: [infoEmbed('📋 Log Channel Configuration', lines.join('\n\n'), { guild: interaction.guild })],
  });
}

async function handleSetAutoRole(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const role = interaction.options.getRole('role');
  if (role.id === interaction.guild.id) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Role', 'You cannot use @everyone as the auto role.', { guild: interaction.guild })], ephemeral: true });
  }
  if (role.managed) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Role', 'That role is managed by an integration and cannot be assigned manually.', { guild: interaction.guild })], ephemeral: true });
  }
  const me = interaction.guild.members.me;
  if (me && role.position >= me.roles.highest.position) {
    return interaction.reply({ embeds: [errorEmbed('Role Too High', "That role sits above my highest role, so I can't assign it. Move my role above it first.", { guild: interaction.guild })], ephemeral: true });
  }
  autoRoles[interaction.guildId] = role.id;
  await interaction.reply({ embeds: [successEmbed('Auto Role Set', `🎭 New members will automatically receive ${role}.`, { guild: interaction.guild })] });
}

async function handleSetWelcome(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const channel = interaction.options.getChannel('channel');
  if (!channel.isTextBased()) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Channel', 'Please select a text channel.', { guild: interaction.guild })], ephemeral: true });
  }
  welcomeChannels[interaction.guildId] = channel.id;
  await interaction.reply({ embeds: [successEmbed('Welcome Channel Set', `👋 New members will be greeted in ${channel}.`, { guild: interaction.guild })] });
}

async function handleWelcomeToggle(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const state = interaction.options.getString('state');
  welcomeEnabled[interaction.guildId] = state === 'on';
  await interaction.reply({ embeds: [successEmbed('Welcome System', `Welcome messages are now **${state === 'on' ? 'ENABLED ✅' : 'DISABLED ❌'}**.`, { guild: interaction.guild })] });
}

async function handleSetWelcomeMessage(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const message = interaction.options.getString('message');
  if (message.length > 1000) {
    return interaction.reply({ embeds: [errorEmbed('Message Too Long', 'Welcome messages must be 1000 characters or fewer.', { guild: interaction.guild })], ephemeral: true });
  }
  welcomeMessages[interaction.guildId] = message;
  const preview = renderWelcomeMessage(message, interaction.member);
  await interaction.reply({
    embeds: [successEmbed('Welcome Message Updated', `New members will now see:\n\n📝 **Preview:**\n${preview}`, { guild: interaction.guild })],
  });
}

async function handleWelcomeMessagePreview(interaction) {
  const template = welcomeMessages[interaction.guildId] || DEFAULT_WELCOME_MESSAGE;
  const preview = renderWelcomeMessage(template, interaction.member);
  const channelId = welcomeChannels[interaction.guildId];
  const isEnabled = welcomeEnabled[interaction.guildId] !== false;

  await interaction.reply({
    embeds: [infoEmbed('👋 Current Welcome Message', `${preview}\n\n**Status:** ${isEnabled ? '🟢 Enabled' : '🔴 Disabled'}\n**Channel:** ${channelId ? `<#${channelId}>` : 'Not set'}`, { guild: interaction.guild })],
  });
}

// ==================== KICK ANNOUNCEMENT COMMAND HANDLERS ====================

async function handleSetKickChannel(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const kickUsername = interaction.options.getString('kickuser').trim().toLowerCase();
  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');
  if (!channel.isTextBased()) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Channel', 'Please select a text channel.', { guild: interaction.guild })], ephemeral: true });
  }

  await interaction.deferReply();
  try {
    await fetchKickChannel(kickUsername); // validate the username actually exists before saving
  } catch (error) {
    console.error('Kick validation error:', error.message);
    return interaction.editReply({ embeds: [errorEmbed('Kick User Not Found', `Could not find a Kick channel for \`${kickUsername}\`. Double-check the username from their URL (kick.com/**username**), and make sure \`KICK_CLIENT_ID\`/\`KICK_CLIENT_SECRET\` are set correctly.`, { guild: interaction.guild })] });
    return;
  }

  kickAnnouncements[interaction.guildId] = {
    kickUsername,
    channelId: channel.id,
    roleId: role?.id || null,
    isLive: false,
    lastSessionId: null,
  };

  await interaction.editReply({
    embeds: [successEmbed('Kick Announcements Set', `🟢 I'll post in ${channel} whenever **${kickUsername}** goes live on Kick.${role ? `\n\n**Ping role:** ${role}` : ''}\n\nChecked roughly every 3 minutes.`, { guild: interaction.guild })],
  });
}

async function handleRemoveKickChannel(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  if (!kickAnnouncements[interaction.guildId]) {
    return interaction.reply({ embeds: [infoEmbed('Nothing to Remove', 'No Kick announcement is configured for this server.', { guild: interaction.guild })], ephemeral: true });
  }
  delete kickAnnouncements[interaction.guildId];
  await interaction.reply({ embeds: [successEmbed('Kick Announcements Removed', 'Live announcements have been turned off.', { guild: interaction.guild })] });
}

async function handleKickStatus(interaction) {
  const config = kickAnnouncements[interaction.guildId];
  if (!config) {
    return interaction.reply({ embeds: [infoEmbed('Kick Announcements', 'Not configured. Use `/setkickchannel` to set one up.', { guild: interaction.guild })] });
  }
  await interaction.reply({
    embeds: [infoEmbed('Kick Announcements', `**Watching:** [${config.kickUsername}](https://kick.com/${config.kickUsername})\n**Channel:** <#${config.channelId}>\n**Ping Role:** ${config.roleId ? `<@&${config.roleId}>` : 'None'}\n**Currently Live:** ${config.isLive ? '🟢 Yes' : '⚫ No'}`, { guild: interaction.guild })],
  });
}

// ==================== YOUTUBE ANNOUNCEMENT COMMAND HANDLERS ====================

async function handleAddYoutubeChannel(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const ytInput = interaction.options.getString('ytchannel').trim();
  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');
  if (!channel.isTextBased()) {
    return interaction.reply({ embeds: [errorEmbed('Invalid Channel', 'Please select a text channel.', { guild: interaction.guild })], ephemeral: true });
  }

  await interaction.deferReply();

  let resolved;
  try {
    resolved = await resolveYoutubeChannel(ytInput);
  } catch (error) {
    console.error('YouTube resolve error:', error.message);
    return interaction.editReply({ embeds: [errorEmbed('YouTube Channel Not Found', `Could not find a YouTube channel for \`${ytInput}\`. Double-check the handle (e.g. \`@somechannel\`), and make sure \`YOUTUBE_API_KEY\` is set correctly.`, { guild: interaction.guild })] });
  }

  const handleKey = ytInput.startsWith('@') ? ytInput.toLowerCase() : `@${resolved.title.replace(/\s+/g, '').toLowerCase()}`;

  if (!youtubeAnnouncements[interaction.guildId]) youtubeAnnouncements[interaction.guildId] = [];
  const existing = youtubeAnnouncements[interaction.guildId].find(c => c.channelId === resolved.channelId);
  if (existing) {
    return interaction.editReply({ embeds: [warningEmbed('Already Tracked', `**${resolved.title}** is already being tracked in <#${existing.discordChannelId}>.`, { guild: interaction.guild })] });
  }

  // Record their current latest video as a baseline so the next poll doesn't treat
  // pre-existing content as a "new" upload the moment tracking starts.
  let baselineVideoId = null;
  try {
    baselineVideoId = await getLatestUploadVideoId(resolved.uploadsPlaylistId);
  } catch (error) {
    console.error('YouTube baseline fetch error:', error.message);
  }

  youtubeAnnouncements[interaction.guildId].push({
    handle: handleKey,
    channelId: resolved.channelId,
    uploadsPlaylistId: resolved.uploadsPlaylistId,
    discordChannelId: channel.id,
    roleId: role?.id || null,
    isLive: false,
    lastLiveVideoId: null,
    lastSeenVideoId: baselineVideoId,
  });

  await interaction.editReply({
    embeds: [successEmbed('YouTube Channel Added', `🔴 I'll post in ${channel} whenever **${resolved.title}** goes live, uploads a new video, or posts a Short.${role ? `\n\n**Ping role:** ${role}` : ''}\n\nChecked roughly every 5 minutes.\n\nUse \`${handleKey}\` to reference this channel with \`/removeyoutubechannel\`.`, { guild: interaction.guild })],
  });
}

async function handleRemoveYoutubeChannel(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission.', { guild: interaction.guild })], ephemeral: true });
  }
  const ytInput = interaction.options.getString('ytchannel').trim().toLowerCase();
  const list = youtubeAnnouncements[interaction.guildId] || [];
  const index = list.findIndex(c => c.handle.toLowerCase() === ytInput || c.handle.toLowerCase() === `@${ytInput.replace(/^@/, '')}`);

  if (index === -1) {
    return interaction.reply({ embeds: [errorEmbed('Not Found', `No tracked YouTube channel matches \`${ytInput}\`. Use \`/youtubelist\` to see what's tracked.`, { guild: interaction.guild })], ephemeral: true });
  }

  const [removed] = list.splice(index, 1);
  await interaction.reply({ embeds: [successEmbed('YouTube Channel Removed', `Stopped tracking **${removed.handle}**.`, { guild: interaction.guild })] });
}

async function handleYoutubeList(interaction) {
  const list = youtubeAnnouncements[interaction.guildId] || [];
  if (list.length === 0) {
    return interaction.reply({ embeds: [infoEmbed('YouTube Announcements', 'No channels are currently tracked. Use `/addyoutubechannel` to add one.', { guild: interaction.guild })] });
  }

  const lines = list.map(c => `${c.isLive ? '🟢' : '⚫'} **${c.handle}** — <#${c.discordChannelId}>${c.roleId ? ` — pings <@&${c.roleId}>` : ''}`);

  await interaction.reply({
    embeds: [infoEmbed(`📺 Tracked YouTube Channels (${list.length})`, lines.join('\n\n'), { guild: interaction.guild })],
  });
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

  // YouTube Live Announcements — poll immediately, then on an interval.
  if (YOUTUBE_API_KEY) {
    pollYoutubeChannels().catch(err => console.error('Initial YouTube poll error:', err));
    setInterval(() => {
      pollYoutubeChannels().catch(err => console.error('YouTube poll error:', err));
    }, YOUTUBE_POLL_INTERVAL_MS);
    console.log('📺 YouTube live announcements: polling enabled.');
  } else {
    console.log('📺 YouTube live announcements: YOUTUBE_API_KEY not set — feature disabled.');
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
      case 'removekickchannel': await handleRemoveKickChannel(interaction); break;
      case 'kickstatus': await handleKickStatus(interaction); break;
      case 'addyoutubechannel': await handleAddYoutubeChannel(interaction); break;
      case 'removeyoutubechannel': await handleRemoveYoutubeChannel(interaction); break;
      case 'youtubelist': await handleYoutubeList(interaction); break;
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
        const welcomeEmbed = buildEmbed({
          title: '👋 New Member Joined',
          description: `${renderWelcomeMessage(template, member)}\n\n📅 **Account Created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n👥 **Member Count:** ${member.guild.memberCount}`,
          color: THEME.success,
          guild: member.guild,
          thumbnail: member.user.displayAvatarURL({ size: 256 }),
        });
        await channel.send({ embeds: [welcomeEmbed] }).catch(err => console.error('Welcome message error:', err));
      }
    }

    await sendLog(member.guild, buildEmbed({
      title: '📥 Member Joined',
      description: `**Member:** ${member.user.tag} (${member.user.id})\n**Account Created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
      color: THEME.success,
      guild: member.guild,
      thumbnail: member.user.displayAvatarURL({ size: 256 }),
    }), 'member');
  } catch (error) {
    console.error('Guild member add error:', error);
  }
});

client.on('guildMemberRemove', async (member) => {
  try {
    await sendLog(member.guild, buildEmbed({
      title: '👋 Member Left',
      description: `**Member:** ${member.user.tag} (${member.user.id})\n**Joined Server:** ${member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown'}`,
      color: THEME.error,
      guild: member.guild,
      thumbnail: member.user.displayAvatarURL({ size: 256 }),
    }), 'member');
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
            embeds: [buildEmbed({
              title: '🎉 Level Up!',
              description: `${message.author} just reached **Level ${newLevel}**!`,
              color: THEME.level,
              guild: message.guild,
              thumbnail: message.author.displayAvatarURL({ size: 256 }),
            })],
          }).catch(() => {});
        }
      }
    }

    // ---- Anti-Ping ----
    if (antiPing[guildId] && hasMentions(message)) {
      try {
        await message.delete();
        const warnMsg = await message.channel.send({ content: `${message.author}`, embeds: [warningEmbed('Mention Not Allowed', "You can't use @everyone, @here, or mention members/roles here.", { guild: message.guild })] });
        await sendLog(message.guild, buildEmbed({
          title: '🛡️ Anti-Ping Triggered',
          description: `**User:** ${message.author.tag} (${message.author.id})\n**Channel:** ${message.channel}`,
          color: THEME.warning,
          guild: message.guild,
        }), 'antiping');
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
          const warnMsg = await message.channel.send({ content: `${message.author}`, embeds: [warningEmbed('Message Removed', 'Your message contained a blocked word or phrase.', { guild: message.guild })] });
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
        const warnMsg = await message.channel.send({ content: `${message.author}`, embeds: [warningEmbed('Invite Deleted', 'Discord invites are not allowed in this server.', { guild: message.guild })] });
        await sendLog(message.guild, buildEmbed({
          title: '🔗 Invite Link Detected',
          description: `**User:** ${message.author.tag} (${message.author.id})\n**Channel:** ${message.channel}\n**Content:** ${message.content.substring(0, 100)}`,
          color: THEME.warning,
          guild: message.guild,
        }), 'antiping');
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

    await sendLog(message.guild, buildEmbed({
      title: '🗑️ Message Deleted',
      description: `**Author:** ${message.author.tag} (${message.author.id})\n**Channel:** ${message.channel}\n**Content:** ${(message.content || '').substring(0, 100) || 'No content'}`,
      color: THEME.warning,
      guild: message.guild,
    }), 'message');
  } catch (error) {
    console.error('Message delete error:', error);
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    if (oldMessage.partial || newMessage.partial) return;
    if (!oldMessage.author || oldMessage.author.bot) return;
    if (oldMessage.content === newMessage.content) return;
    await sendLog(oldMessage.guild, buildEmbed({
      title: '✏️ Message Edited',
      description: `**Author:** ${oldMessage.author.tag} (${oldMessage.author.id})\n**Channel:** ${oldMessage.channel}\n\n**Before:** ${(oldMessage.content || '').substring(0, 100) || 'No content'}\n**After:** ${(newMessage.content || '').substring(0, 100) || 'No content'}`,
      color: THEME.info,
      guild: oldMessage.guild,
    }), 'message');
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
  delete youtubeAnnouncements[guild.id];
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
