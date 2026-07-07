require('dotenv').config();
const { Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require('discord.js');

// ==================== CONFIGURATION ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ==================== DATA STORAGE ====================
// In-memory storage for various bot features
const guildData = {
  // guildId: { logChannel: 'channelId', antiping: boolean, chatFilter: ['word1', 'word2'], warnings: { userId: [{ mod: 'modId', reason: 'reason', timestamp: Date }] } }
};

const warnings = {};
// userId -> Array of warning objects: { mod, reason, timestamp }

const antiPing = {};
// guildId -> boolean

const chatFilters = {};
// guildId -> Array of blocked words

const logChannels = {};
// guildId -> channelId

// ==================== HELPER FUNCTIONS ====================

/**
 * Get or create guild data
 */
function getGuildData(guildId) {
  if (!guildData[guildId]) {
    guildData[guildId] = {
      logChannel: null,
      antiping: false,
      chatFilter: [],
      warnings: {},
    };
  }
  return guildData[guildId];
}

/**
 * Check if user has admin role
 */
function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Check if user is bot owner
 */
function isGuildOwner(member) {
  return member.guild.ownerId === member.id;
}

/**
 * Check role hierarchy
 */
function canModerate(moderator, target) {
  if (isGuildOwner(target)) return false;
  if (target.id === moderator.id) return false;
  return moderator.roles.highest.position > target.roles.highest.position;
}

/**
 * Send log to log channel
 */
async function sendLog(guild, embed) {
  const logChannelId = logChannels[guild.id];
  if (!logChannelId) return;
  
  try {
    const channel = await guild.channels.fetch(logChannelId);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Error sending log:', error);
  }
}

/**
 * Create success embed
 */
function successEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setColor(0x2ecc71)
    .setTimestamp()
    .setFooter({ text: 'ModBot • Community Protection', iconURL: 'https://cdn.discordapp.com/emojis/879640511815659570.gif' });
}

/**
 * Create error embed
 */
function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(0xe74c3c)
    .setTimestamp()
    .setFooter({ text: 'ModBot • Error Occurred' });
}

/**
 * Create info embed
 */
function infoEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description)
    .setColor(0x3498db)
    .setTimestamp()
    .setFooter({ text: 'ModBot • Information' });
}

/**
 * Create warning embed
 */
function warningEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`⚠️ ${title}`)
    .setDescription(description)
    .setColor(0xf39c12)
    .setTimestamp()
    .setFooter({ text: 'ModBot • Warning' });
}

/**
 * Create premium moderation embed
 */
function moderationEmbed(action, user, moderator, reason, duration = null) {
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`${action}`)
    .addFields(
      { name: '👤 User', value: user, inline: false },
      { name: '👮 Moderator', value: moderator, inline: true },
      { name: '📝 Reason', value: reason || 'No reason provided', inline: false }
    );

  if (duration) {
    embed.addFields({ name: '⏱️ Duration', value: duration, inline: true });
  }

  return embed.setTimestamp().setFooter({ text: 'ModBot • Moderation Action', iconURL: 'https://cdn.discordapp.com/emojis/879640511815659570.gif' });
}

/**
 * Create stats embed
 */
function statsEmbed(title, fields) {
  const embed = new EmbedBuilder()
    .setTitle(`📊 ${title}`)
    .setColor(0x1abc9c);

  fields.forEach(f => {
    embed.addFields({ name: f.name, value: f.value, inline: f.inline !== false });
  });

  return embed.setTimestamp().setFooter({ text: 'ModBot • Statistics' });
}

/**
 * Check for invites in message
 */
function hasInvite(content) {
  const inviteRegex = /(https?:\/\/)?(www\.)?(discord\.gg|discordapp\.com\/invite|discord\.com\/invite)\/[^\s]+/gi;
  return inviteRegex.test(content);
}

/**
 * Check if message contains mention
 */
function hasMentions(message) {
  return message.mentions.has('@everyone') || 
         message.mentions.has('@here') || 
         message.mentions.members.size > 0 || 
         message.mentions.roles.size > 0;
}

/**
 * Register slash commands
 */
async function registerCommands() {
  const commands = [
    {
      name: 'ping',
      description: 'Check bot latency',
    },
    {
      name: 'help',
      description: 'Show all available commands',
    },
    {
      name: 'say',
      description: 'Bot repeats your message',
      options: [
        {
          name: 'message',
          description: 'Message to repeat',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'userinfo',
      description: 'Get information about a user',
      options: [
        {
          name: 'user',
          description: 'The user to get info about',
          type: 6,
          required: false,
        },
      ],
    },
    {
      name: 'serverinfo',
      description: 'Get information about the server',
    },
    {
      name: 'avatar',
      description: 'Get a user\'s avatar',
      options: [
        {
          name: 'user',
          description: 'The user to get avatar of',
          type: 6,
          required: false,
        },
      ],
    },
    {
      name: 'kick',
      description: 'Kick a member from the server',
      options: [
        {
          name: 'member',
          description: 'Member to kick',
          type: 6,
          required: true,
        },
        {
          name: 'reason',
          description: 'Reason for kick',
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: 'ban',
      description: 'Ban a member from the server',
      options: [
        {
          name: 'member',
          description: 'Member to ban',
          type: 6,
          required: true,
        },
        {
          name: 'reason',
          description: 'Reason for ban',
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: 'mute',
      description: 'Mute a member',
      options: [
        {
          name: 'member',
          description: 'Member to mute',
          type: 6,
          required: true,
        },
        {
          name: 'minutes',
          description: 'Duration in minutes',
          type: 4,
          required: false,
        },
        {
          name: 'reason',
          description: 'Reason for mute',
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: 'unmute',
      description: 'Unmute a member',
      options: [
        {
          name: 'member',
          description: 'Member to unmute',
          type: 6,
          required: true,
        },
      ],
    },
    {
      name: 'warn',
      description: 'Warn a user',
      options: [
        {
          name: 'user',
          description: 'User to warn',
          type: 6,
          required: true,
        },
        {
          name: 'reason',
          description: 'Reason for warning',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'warnings',
      description: 'View warnings for a user',
      options: [
        {
          name: 'user',
          description: 'User to check',
          type: 6,
          required: true,
        },
      ],
    },
    {
      name: 'clearwarnings',
      description: 'Clear all warnings for a user',
      options: [
        {
          name: 'user',
          description: 'User to clear warnings for',
          type: 6,
          required: true,
        },
      ],
    },
    {
      name: 'clear',
      description: 'Delete messages',
      options: [
        {
          name: 'amount',
          description: 'Number of messages (1-100)',
          type: 4,
          required: true,
        },
      ],
    },
    {
      name: 'purge',
      description: 'Purge messages with advanced filters',
      options: [
        {
          name: 'amount',
          description: 'Number of messages (1-100)',
          type: 4,
          required: true,
        },
        {
          name: 'user',
          description: 'Delete messages from specific user',
          type: 6,
          required: false,
        },
        {
          name: 'contains',
          description: 'Delete messages containing this text',
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: 'lock',
      description: 'Lock a channel (disable messages)',
    },
    {
      name: 'unlock',
      description: 'Unlock a channel (enable messages)',
    },
    {
      name: 'antiping',
      description: 'Anti-ping system management',
      options: [
        {
          name: 'action',
          description: 'Enable or disable',
          type: 3,
          required: true,
          choices: [
            { name: 'on', value: 'on' },
            { name: 'off', value: 'off' },
          ],
        },
      ],
    },
    {
      name: 'filter',
      description: 'Chat filter management',
      options: [
        {
          name: 'action',
          description: 'Action to perform',
          type: 3,
          required: true,
          choices: [
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' },
            { name: 'list', value: 'list' },
          ],
        },
        {
          name: 'word',
          description: 'Word to add/remove',
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: 'setlog',
      description: 'Set the log channel',
      options: [
        {
          name: 'channel',
          description: 'Channel for logs',
          type: 7,
          required: true,
        },
      ],
    },
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('Starting to register slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`✓ Successfully registered ${commands.length} slash commands globally`);
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// ==================== COMMAND HANDLERS ====================

/**
 * Handle /ping command
 */
async function handlePing(interaction) {
  const latency = interaction.client.ws.ping;
  const speedStatus = latency < 100 ? '⚡ Excellent' : latency < 200 ? '✅ Good' : latency < 500 ? '⚠️ Fair' : '🐌 Slow';
  
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setDescription(`**Latency:** ${latency}ms\n**Status:** ${speedStatus}`)
      .setColor(latency < 100 ? 0x2ecc71 : latency < 200 ? 0x3498db : latency < 500 ? 0xf39c12 : 0xe74c3c)
      .setTimestamp()
      .setFooter({ text: 'ModBot • Performance Check', iconURL: interaction.client.user.displayAvatarURL() })
    ],
    ephemeral: false,
  });
}

/**
 * Handle /help command
 */
async function handleHelp(interaction) {
  const helpEmbed = new EmbedBuilder()
    .setTitle('📚 ModBot Command Help')
    .setColor(0x3498db)
    .setDescription('**Your complete moderation toolkit. Use `/` to access any command!**\n\n')
    .addFields(
      { name: '📍 General Commands', value: '`/ping` - Check bot latency\n`/help` - Show this message\n`/say <message>` - Make bot repeat a message\n`/userinfo [user]` - Get user information\n`/serverinfo` - Get server information\n`/avatar [user]` - Get user avatar', inline: false },
      { name: '⚠️ Moderation Commands', value: '`/kick <member> [reason]` - Kick a member\n`/ban <member> [reason]` - Ban a member\n`/mute <member> [minutes] [reason]` - Mute a member\n`/unmute <member>` - Unmute a member\n`/warn <user> <reason>` - Warn a user\n`/warnings <user>` - View user warnings\n`/clearwarnings <user>` - Clear user warnings\n`/clear <amount>` - Delete messages\n`/purge <amount> [user] [contains]` - Advanced purge with filters', inline: false },
      { name: '🔐 Channel Commands', value: '`/lock` - Lock channel (disable messages)\n`/unlock` - Unlock channel (enable messages)\n`/setlog <channel>` - Set log channel', inline: false },
      { name: '🛡️ Anti-Ping System', value: '`/antiping on` - Enable anti-ping\n`/antiping off` - Disable anti-ping', inline: false },
      { name: '🚫 Chat Filter', value: '`/filter add <word>` - Add blocked word\n`/filter remove <word>` - Remove blocked word\n`/filter list` - Show blocked words', inline: false },
    )
    .setThumbnail(interaction.client.user.displayAvatarURL())
    .setTimestamp()
    .setFooter({ text: 'ModBot • Need help? Check documentation', iconURL: interaction.client.user.displayAvatarURL() });

  await interaction.reply({ embeds: [helpEmbed], ephemeral: false });
}

/**
 * Handle /say command
 */
async function handleSay(interaction) {
  const message = interaction.options.getString('message');
  await interaction.reply({ content: message, ephemeral: false });
}

/**
 * Handle /userinfo command
 */
async function handleUserInfo(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  const userInfoEmbed = new EmbedBuilder()
    .setTitle(`👤 ${user.username}`)
    .setColor(0x9b59b6)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'ID', value: `\`${user.id}\``, inline: true },
      { name: 'Status', value: user.bot ? '🤖 Bot' : '👥 User', inline: true },
      { name: 'Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
    );

  if (member) {
    const statusEmoji = member.presence?.status === 'online' ? '🟢' : member.presence?.status === 'dnd' ? '🔴' : member.presence?.status === 'idle' ? '🟡' : '⚫';
    userInfoEmbed.addFields(
      { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
      { name: 'Status', value: `${statusEmoji} ${member.presence?.status || 'offline'}`, inline: true },
      { name: 'Roles', value: member.roles.cache.size > 1 ? member.roles.cache.map(r => r.toString()).join(', ') : 'No roles', inline: false },
    );
  }

  userInfoEmbed
    .setTimestamp()
    .setFooter({ text: 'ModBot • User Information', iconURL: interaction.client.user.displayAvatarURL() });
  
  await interaction.reply({ embeds: [userInfoEmbed], ephemeral: false });
}

/**
 * Handle /serverinfo command
 */
async function handleServerInfo(interaction) {
  const guild = interaction.guild;
  const memberCount = await guild.members.fetch().then(m => m.size).catch(() => 'Unknown');
  const botCount = await guild.members.fetch().then(m => m.filter(member => member.user.bot).size).catch(() => 'Unknown');

  const serverInfoEmbed = new EmbedBuilder()
    .setTitle(`🏢 ${guild.name}`)
    .setColor(0x1abc9c)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .addFields(
      { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
      { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'ID', value: `\`${guild.id}\``, inline: true },
      { name: '👥 Members', value: `${memberCount}`, inline: true },
      { name: '🤖 Bots', value: `${botCount}`, inline: true },
      { name: '📊 Stats', value: `**Text Channels:** ${guild.channels.cache.filter(c => c.isTextBased()).size}\n**Voice Channels:** ${guild.channels.cache.filter(c => c.isVoiceBased()).size}\n**Roles:** ${guild.roles.cache.size}`, inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'ModBot • Server Statistics', iconURL: interaction.client.user.displayAvatarURL() });

  await interaction.reply({ embeds: [serverInfoEmbed], ephemeral: false });
}

/**
 * Handle /avatar command
 */
async function handleAvatar(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const avatarUrl = user.displayAvatarURL({ size: 1024 });

  const avatarEmbed = new EmbedBuilder()
    .setTitle(`👤 ${user.tag}'s Avatar`)
    .setColor(0x0099ff)
    .setImage(avatarUrl)
    .setTimestamp();

  await interaction.reply({ embeds: [avatarEmbed], ephemeral: false });
}

/**
 * Handle /kick command
 */
async function handleKick(interaction) {
  const targetUser = interaction.options.getUser('member');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.KickMembers)) {
    await interaction.reply({ embeds: [errorEmbed('Permission Denied', '🔒 You need **Kick Members** permission to use this command')], ephemeral: true });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!targetMember) {
    await interaction.reply({ embeds: [errorEmbed('Member Not Found', '❓ The specified member could not be found')], ephemeral: true });
    return;
  }

  if (!canModerate(moderator, targetMember)) {
    await interaction.reply({ embeds: [errorEmbed('Cannot Kick', '⛔ You cannot kick this user due to role hierarchy or self-action')], ephemeral: true });
    return;
  }

  try {
    await targetMember.kick(reason);
    
    const logEmbed = new EmbedBuilder()
      .setTitle('👢 Member Kicked')
      .setColor(0xe74c3c)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '👤 User', value: `${targetUser.tag}\n\`${targetUser.id}\``, inline: false },
        { name: '👮 Moderator', value: `${moderator.user.tag}`, inline: true },
        { name: '⏰ Action', value: 'Kick', inline: true },
        { name: '📝 Reason', value: `\`${reason}\``, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'ModBot • Member Action' });

    await sendLog(interaction.guild, logEmbed);
    
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle('✅ Kick Successful')
      .setDescription(`**${targetUser.tag}** has been kicked from the server`)
      .addFields(
        { name: 'Reason', value: `\`${reason}\``, inline: false }
      )
      .setColor(0x2ecc71)
      .setThumbnail(targetUser.displayAvatarURL())
      .setTimestamp()
      .setFooter({ text: 'ModBot • Action Completed' })
    ], ephemeral: false });
  } catch (error) {
    console.error('Kick error:', error);
    await interaction.reply({ embeds: [errorEmbed('Kick Failed', '⚠️ Could not kick the member. Please try again.')], ephemeral: true });
  }
}

/**
 * Handle /ban command
 */
async function handleBan(interaction) {
  const targetUser = interaction.options.getUser('member');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.BanMembers)) {
    await interaction.reply({ embeds: [errorEmbed('Permission Denied', '🔒 You need **Ban Members** permission to use this command')], ephemeral: true });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (targetMember && !canModerate(moderator, targetMember)) {
    await interaction.reply({ embeds: [errorEmbed('Cannot Ban', '⛔ You cannot ban this user due to role hierarchy or self-action')], ephemeral: true });
    return;
  }

  try {
    await interaction.guild.bans.create(targetUser.id, { reason });
    
    const logEmbed = new EmbedBuilder()
      .setTitle('🔨 Member Banned')
      .setColor(0xc0392b)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '👤 User', value: `${targetUser.tag}\n\`${targetUser.id}\``, inline: false },
        { name: '👮 Moderator', value: `${moderator.user.tag}`, inline: true },
        { name: '⏰ Action', value: 'Ban', inline: true },
        { name: '📝 Reason', value: `\`${reason}\``, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'ModBot • Member Action' });

    await sendLog(interaction.guild, logEmbed);
    
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle('🔨 Ban Successful')
      .setDescription(`**${targetUser.tag}** has been **permanently banned** from the server`)
      .addFields(
        { name: 'Reason', value: `\`${reason}\``, inline: false }
      )
      .setColor(0xc0392b)
      .setThumbnail(targetUser.displayAvatarURL())
      .setTimestamp()
      .setFooter({ text: 'ModBot • Action Completed' })
    ], ephemeral: false });
  } catch (error) {
    console.error('Ban error:', error);
    await interaction.reply({ embeds: [errorEmbed('Ban Failed', '⚠️ Could not ban the member. Please try again.')], ephemeral: true });
  }
}

/**
 * Handle /mute command
 */
async function handleMute(interaction) {
  const targetUser = interaction.options.getUser('member');
  const minutes = interaction.options.getInteger('minutes') || 10;
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    await interaction.reply({ embeds: [errorEmbed('Permission Denied', '🔒 You need **Moderate Members** permission to use this command')], ephemeral: true });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!targetMember) {
    await interaction.reply({ embeds: [errorEmbed('Member Not Found', '❓ The specified member could not be found')], ephemeral: true });
    return;
  }

  if (!canModerate(moderator, targetMember)) {
    await interaction.reply({ embeds: [errorEmbed('Cannot Mute', '⛔ You cannot mute this user due to role hierarchy or self-action')], ephemeral: true });
    return;
  }

  try {
    const muteDuration = minutes * 60 * 1000;
    await targetMember.timeout(muteDuration, reason);

    const logEmbed = new EmbedBuilder()
      .setTitle('🔇 Member Muted')
      .setColor(0xf39c12)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '👤 User', value: `${targetUser.tag}\n\`${targetUser.id}\``, inline: false },
        { name: '⏱️ Duration', value: `${minutes} minutes`, inline: true },
        { name: '👮 Moderator', value: `${moderator.user.tag}`, inline: true },
        { name: '📝 Reason', value: `\`${reason}\``, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'ModBot • Member Action' });

    await sendLog(interaction.guild, logEmbed);
    
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle('🔇 Mute Successful')
      .setDescription(`**${targetUser.tag}** has been **muted** from the server`)
      .addFields(
        { name: '⏱️ Duration', value: `\`${minutes} minutes\``, inline: true },
        { name: '📝 Reason', value: `\`${reason}\``, inline: false }
      )
      .setColor(0xf39c12)
      .setThumbnail(targetUser.displayAvatarURL())
      .setTimestamp()
      .setFooter({ text: 'ModBot • Action Completed' })
    ], ephemeral: false });
  } catch (error) {
    console.error('Mute error:', error);
    await interaction.reply({ embeds: [errorEmbed('Mute Failed', '⚠️ Could not mute the member. Please try again.')], ephemeral: true });
  }
}

/**
 * Handle /unmute command
 */
async function handleUnmute(interaction) {
  const targetUser = interaction.options.getUser('member');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    await interaction.reply({ embeds: [errorEmbed('❌ Permission Denied', 'You need ModerateMembers permission')], ephemeral: true });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!targetMember) {
    await interaction.reply({ embeds: [errorEmbed('❌ Error', 'Member not found')], ephemeral: true });
    return;
  }

  try {
    await targetMember.timeout(null);

    const logEmbed = new EmbedBuilder()
      .setTitle('🔊 Member Unmuted')
      .setColor(0x00ff00)
      .addFields(
        { name: 'Member', value: `${targetUser.tag} (${targetUser.id})`, inline: false },
        { name: 'Moderator', value: `${moderator.user.tag}`, inline: true },
      )
      .setTimestamp();

    await sendLog(interaction.guild, logEmbed);
    await interaction.reply({ embeds: [successEmbed('✅ Unmute Successful', `${targetUser.tag} has been unmuted`)], ephemeral: false });
  } catch (error) {
    console.error('Unmute error:', error);
    await interaction.reply({ embeds: [errorEmbed('❌ Error', 'Could not unmute member')], ephemeral: true });
  }
}

/**
 * Handle /warn command
 */
async function handleWarn(interaction) {
  const targetUser = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    await interaction.reply({ embeds: [errorEmbed('❌ Permission Denied', 'You need ModerateMembers permission')], ephemeral: true });
    return;
  }

  if (!warnings[targetUser.id]) {
    warnings[targetUser.id] = [];
  }

  warnings[targetUser.id].push({
    mod: moderator.user.tag,
    reason,
    timestamp: Date.now(),
  });

  const logEmbed = new EmbedBuilder()
    .setTitle('⚠️ User Warned')
    .setColor(0xffa500)
    .addFields(
      { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: false },
      { name: 'Moderator', value: `${moderator.user.tag}`, inline: true },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Total Warnings', value: warnings[targetUser.id].length.toString(), inline: true },
    )
    .setTimestamp();

  await sendLog(interaction.guild, logEmbed);
  await interaction.reply({ embeds: [warningEmbed('⚠️ Warning Issued', `${targetUser.tag} has been warned\nReason: ${reason}\nTotal warnings: ${warnings[targetUser.id].length}`)], ephemeral: false });
}

/**
 * Handle /warnings command
 */
async function handleWarnings(interaction) {
  const targetUser = interaction.options.getUser('user');

  if (!warnings[targetUser.id] || warnings[targetUser.id].length === 0) {
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle('📋 No Warnings')
      .setDescription(`✅ **${targetUser.tag}** has a clean record`)
      .setColor(0x2ecc71)
      .setThumbnail(targetUser.displayAvatarURL())
      .setTimestamp()
      .setFooter({ text: 'ModBot • Clear Record' })
    ], ephemeral: false });
    return;
  }

  const warningList = warnings[targetUser.id]
    .map((w, i) => {
      const severityColor = i >= 2 ? '🔴' : i >= 1 ? '🟠' : '🟡';
      return `${severityColor} **#${i + 1}** - ${w.reason}\n> *by ${w.mod} • <t:${Math.floor(w.timestamp / 1000)}:R>*`;
    })
    .join('\n\n');

  const warningsEmbed = new EmbedBuilder()
    .setTitle(`⚠️ Warnings for ${targetUser.tag}`)
    .setColor(0xf39c12)
    .setDescription(warningList)
    .setThumbnail(targetUser.displayAvatarURL())
    .addFields(
      { name: '📊 Summary', value: `**Total Warnings:** ${warnings[targetUser.id].length}`, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: 'ModBot • Warning History' });

  await interaction.reply({ embeds: [warningsEmbed], ephemeral: false });
}

/**
 * Handle /clearwarnings command
 */
async function handleClearWarnings(interaction) {
  const targetUser = interaction.options.getUser('user');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    await interaction.reply({ embeds: [errorEmbed('❌ Permission Denied', 'You need ModerateMembers permission')], ephemeral: true });
    return;
  }

  if (!warnings[targetUser.id] || warnings[targetUser.id].length === 0) {
    await interaction.reply({ embeds: [infoEmbed('ℹ️ No Warnings', `${targetUser.tag} has no warnings to clear`)], ephemeral: true });
    return;
  }

  const warnCount = warnings[targetUser.id].length;
  warnings[targetUser.id] = [];

  const logEmbed = new EmbedBuilder()
    .setTitle('🧹 Warnings Cleared')
    .setColor(0x00ff00)
    .addFields(
      { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: false },
      { name: 'Moderator', value: `${moderator.user.tag}`, inline: true },
      { name: 'Warnings Cleared', value: warnCount.toString(), inline: true },
    )
    .setTimestamp();

  await sendLog(interaction.guild, logEmbed);
  await interaction.reply({ embeds: [successEmbed('✅ Warnings Cleared', `All ${warnCount} warnings for ${targetUser.tag} have been cleared`)], ephemeral: false });
}

/**
 * Handle /clear command
 */
async function handleClear(interaction) {
  const amount = interaction.options.getInteger('amount');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ embeds: [errorEmbed('❌ Permission Denied', 'You need ManageMessages permission')], ephemeral: true });
    return;
  }

  if (amount < 1 || amount > 100) {
    await interaction.reply({ embeds: [errorEmbed('❌ Invalid Amount', 'Please specify between 1 and 100 messages')], ephemeral: true });
    return;
  }

  try {
    await interaction.channel.bulkDelete(amount);
    await interaction.reply({ embeds: [successEmbed('✅ Messages Deleted', `${amount} messages have been deleted`)], ephemeral: false });
  } catch (error) {
    console.error('Clear error:', error);
    await interaction.reply({ embeds: [errorEmbed('❌ Error', 'Could not delete messages')], ephemeral: true });
  }
}

/**
 * Handle /purge command - Advanced message deletion with filters
 */
async function handlePurge(interaction) {
  const amount = interaction.options.getInteger('amount');
  const filterUser = interaction.options.getUser('user');
  const filterText = interaction.options.getString('contains');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ embeds: [errorEmbed('Permission Denied', '🔒 You need **Manage Messages** permission to use this command')], ephemeral: true });
    return;
  }

  if (amount < 1 || amount > 100) {
    await interaction.reply({ embeds: [errorEmbed('Invalid Amount', 'Please specify between **1-100** messages')], ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    // Fetch messages from channel
    const messages = await interaction.channel.messages.fetch({ limit: amount });
    let toDelete = messages;

    // Filter by user if specified
    if (filterUser) {
      toDelete = toDelete.filter(msg => msg.author.id === filterUser.id);
    }

    // Filter by text content if specified
    if (filterText) {
      toDelete = toDelete.filter(msg => msg.content.toLowerCase().includes(filterText.toLowerCase()));
    }

    const deletedCount = toDelete.size;

    if (deletedCount === 0) {
      await interaction.editReply({ embeds: [warningEmbed('No Messages Found', 'No messages matched the specified filters')] });
      return;
    }

    // Delete the messages
    await Promise.all(toDelete.map(msg => msg.delete().catch(() => {})));

    // Build filter summary
    let filterSummary = `**Scanned:** ${amount} messages\n**Deleted:** ${deletedCount} messages`;
    if (filterUser) {
      filterSummary += `\n**By User:** ${filterUser.tag}`;
    }
    if (filterText) {
      filterSummary += `\n**Contains:** \`${filterText}\``;
    }

    const logEmbed = new EmbedBuilder()
      .setTitle('🧹 Messages Purged')
      .setColor(0x3498db)
      .setDescription(filterSummary)
      .addFields(
        { name: '👮 Moderator', value: `${moderator.user.tag}`, inline: true },
        { name: '📍 Channel', value: `${interaction.channel.toString()}`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'ModBot • Purge Action' });

    await sendLog(interaction.guild, logEmbed);

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle('🧹 Purge Successful')
      .setDescription(filterSummary)
      .setColor(0x2ecc71)
      .setTimestamp()
      .setFooter({ text: 'ModBot • Action Completed' })
    ] });
  } catch (error) {
    console.error('Purge error:', error);
    await interaction.editReply({ embeds: [errorEmbed('Purge Failed', '⚠️ Could not purge messages. Please try again.')] });
  }
}

/**
 * Handle /lock command
 */
async function handleLock(interaction) {
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ embeds: [errorEmbed('❌ Permission Denied', 'You need ManageChannels permission')], ephemeral: true });
    return;
  }

  try {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
    const logEmbed = new EmbedBuilder()
      .setTitle('🔒 Channel Locked')
      .setColor(0xff0000)
      .addFields(
        { name: 'Channel', value: `${interaction.channel.toString()}`, inline: false },
        { name: 'Moderator', value: `${moderator.user.tag}`, inline: true },
      )
      .setTimestamp();

    await sendLog(interaction.guild, logEmbed);
    await interaction.reply({ embeds: [successEmbed('🔒 Channel Locked', 'This channel is now locked')], ephemeral: false });
  } catch (error) {
    console.error('Lock error:', error);
    await interaction.reply({ embeds: [errorEmbed('❌ Error', 'Could not lock channel')], ephemeral: true });
  }
}

/**
 * Handle /unlock command
 */
async function handleUnlock(interaction) {
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ embeds: [errorEmbed('❌ Permission Denied', 'You need ManageChannels permission')], ephemeral: true });
    return;
  }

  try {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
    const logEmbed = new EmbedBuilder()
      .setTitle('🔓 Channel Unlocked')
      .setColor(0x00ff00)
      .addFields(
        { name: 'Channel', value: `${interaction.channel.toString()}`, inline: false },
        { name: 'Moderator', value: `${moderator.user.tag}`, inline: true },
      )
      .setTimestamp();

    await sendLog(interaction.guild, logEmbed);
    await interaction.reply({ embeds: [successEmbed('🔓 Channel Unlocked', 'This channel is now unlocked')], ephemeral: false });
  } catch (error) {
    console.error('Unlock error:', error);
    await interaction.reply({ embeds: [errorEmbed('❌ Error', 'Could not unlock channel')], ephemeral: true });
  }
}

/**
 * Handle /antiping command
 */
async function handleAntiPing(interaction) {
  const action = interaction.options.getString('action');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ embeds: [errorEmbed('❌ Permission Denied', 'You need Administrator permission')], ephemeral: true });
    return;
  }

  if (action === 'on') {
    antiPing[interaction.guildId] = true;
    await interaction.reply({ embeds: [successEmbed('✅ Anti-Ping Enabled', 'Anti-ping system is now active')], ephemeral: false });
  } else if (action === 'off') {
    antiPing[interaction.guildId] = false;
    await interaction.reply({ embeds: [successEmbed('✅ Anti-Ping Disabled', 'Anti-ping system is now inactive')], ephemeral: false });
  }
}

/**
 * Handle /filter command
 */
async function handleFilter(interaction) {
  const action = interaction.options.getString('action');
  const word = interaction.options.getString('word');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ embeds: [errorEmbed('❌ Permission Denied', 'You need Administrator permission')], ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  if (!chatFilters[guildId]) {
    chatFilters[guildId] = [];
  }

  if (action === 'add') {
    if (!word || word.trim() === '') {
      await interaction.reply({ embeds: [errorEmbed('❌ No Word Provided', 'Usage: `/filter add [word or phrase]`\nExample: `/filter add fuck you`')], ephemeral: true });
      return;
    }

    const wordLower = word.toLowerCase().trim();
    if (chatFilters[guildId].includes(wordLower)) {
      await interaction.reply({ embeds: [warningEmbed('⚠️ Already Blocked', `"${word}" is already in the filter`)], ephemeral: true });
      return;
    }

    chatFilters[guildId].push(wordLower);
    await interaction.reply({ embeds: [successEmbed('✅ Added to Filter', `**"${word}"** has been added to the blocked words list\n\n**Total blocked:** ${chatFilters[guildId].length}`)], ephemeral: false });
  } else if (action === 'remove') {
    if (!word || word.trim() === '') {
      await interaction.reply({ embeds: [errorEmbed('❌ No Word Provided', 'Usage: `/filter remove [word or phrase]`')], ephemeral: true });
      return;
    }

    const wordLower = word.toLowerCase().trim();
    const index = chatFilters[guildId].indexOf(wordLower);
    if (index === -1) {
      await interaction.reply({ embeds: [errorEmbed('❌ Not Found', `"${word}" is not in the filter\n\nUse \`/filter list\` to see all blocked words`)], ephemeral: true });
      return;
    }

    chatFilters[guildId].splice(index, 1);
    await interaction.reply({ embeds: [successEmbed('✅ Removed from Filter', `**"${word}"** has been removed\n\n**Total blocked:** ${chatFilters[guildId].length}`)], ephemeral: false });
  } else if (action === 'list') {
    if (chatFilters[guildId].length === 0) {
      await interaction.reply({ embeds: [infoEmbed('📋 Filter List', 'No words are currently filtered\n\nUse `/filter add [word]` to add blocked words')], ephemeral: false });
      return;
    }

    const wordList = chatFilters[guildId].map(w => `• \`${w}\``).join('\n');
    const listEmbed = new EmbedBuilder()
      .setTitle('🚫 Blocked Words')
      .setColor(0xe74c3c)
      .setDescription(wordList)
      .setFooter({ text: `Total: ${chatFilters[guildId].length} word(s) blocked • ModBot`, iconURL: interaction.client.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.reply({ embeds: [listEmbed], ephemeral: false });
  }
}

/**
 * Handle /setlog command
 */
async function handleSetLog(interaction) {
  const channel = interaction.options.getChannel('channel');
  const moderator = interaction.member;

  if (!moderator.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ embeds: [errorEmbed('❌ Permission Denied', 'You need Administrator permission')], ephemeral: true });
    return;
  }

  if (!channel.isTextBased()) {
    await interaction.reply({ embeds: [errorEmbed('❌ Invalid Channel', 'Please select a text channel')], ephemeral: true });
    return;
  }

  logChannels[interaction.guildId] = channel.id;
  await interaction.reply({ embeds: [successEmbed('✅ Log Channel Set', `Log channel has been set to ${channel.toString()}`)], ephemeral: false });
}

// ==================== EVENT HANDLERS ====================

/**
 * Ready event
 */
client.once('ready', () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Bot Ready!`);
  console.log(`Bot Name: ${client.user.tag}`);
  console.log(`Guilds: ${client.guilds.cache.size}`);
  console.log(`Users: ${client.users.cache.size}`);
  console.log(`${'='.repeat(50)}\n`);

  // Set bot status and activity
  client.user.setPresence({
    activities: [
      {
        name: 'over your server',
        type: ActivityType.Watching
      }
    ],
    status: 'online'
  });
});

/**
 * Interaction Create event
 */
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const command = interaction.commandName;

    switch (command) {
      case 'ping':
        await handlePing(interaction);
        break;
      case 'help':
        await handleHelp(interaction);
        break;
      case 'say':
        await handleSay(interaction);
        break;
      case 'userinfo':
        await handleUserInfo(interaction);
        break;
      case 'serverinfo':
        await handleServerInfo(interaction);
        break;
      case 'avatar':
        await handleAvatar(interaction);
        break;
      case 'kick':
        await handleKick(interaction);
        break;
      case 'ban':
        await handleBan(interaction);
        break;
      case 'mute':
        await handleMute(interaction);
        break;
      case 'unmute':
        await handleUnmute(interaction);
        break;
      case 'warn':
        await handleWarn(interaction);
        break;
      case 'warnings':
        await handleWarnings(interaction);
        break;
      case 'clearwarnings':
        await handleClearWarnings(interaction);
        break;
      case 'clear':
        await handleClear(interaction);
        break;
      case 'purge':
        await handlePurge(interaction);
        break;
      case 'lock':
        await handleLock(interaction);
        break;
      case 'unlock':
        await handleUnlock(interaction);
        break;
      case 'antiping':
        await handleAntiPing(interaction);
        break;
      case 'filter':
        await handleFilter(interaction);
        break;
      case 'setlog':
        await handleSetLog(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown command', ephemeral: true });
    }
  } catch (error) {
    console.error('Interaction error:', error);
    try {
      if (!interaction.replied) {
        await interaction.reply({ embeds: [errorEmbed('❌ Error', 'An error occurred while processing this command')], ephemeral: true });
      }
    } catch (replyError) {
      console.error('Error sending error reply:', replyError);
    }
  }
});

/**
 * Message Create event - Handle auto-moderation
 */
client.on('messageCreate', async (message) => {
  try {
    // Ignore bot messages
    if (message.author.bot) return;
    // Ignore DMs
    if (!message.guild) return;

    const guildId = message.guildId;
    const author = await message.guild.members.fetch(message.author.id).catch(() => null);

    // Skip if author is admin
    if (author && isAdmin(author)) return;

    // ==================== ANTI-PING SYSTEM ====================
    if (antiPing[guildId]) {
      const hasBadMentions = message.mentions.has('@everyone') || 
                            message.mentions.has('@here') || 
                            message.mentions.members.size > 0 || 
                            message.mentions.roles.size > 0;

      if (hasBadMentions) {
        try {
          await message.delete();
          const warnMsg = await message.reply({
            embeds: [warningEmbed('⚠️ Mention Not Allowed', 'You cannot use @everyone, @here, or mention members/roles here')],
          });
          setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        } catch (error) {
          console.error('Anti-ping error:', error);
        }
        return;
      }
    }

    // ==================== CHAT FILTER ====================
    if (chatFilters[guildId] && chatFilters[guildId].length > 0) {
      const messageLower = message.content.toLowerCase();
      const blockedWord = chatFilters[guildId].find(word => messageLower.includes(word));

      if (blockedWord) {
        try {
          await message.delete();
          const warnMsg = await message.reply({
            embeds: [warningEmbed('⚠️ Word Filtered', `The word "${blockedWord}" is not allowed in this server`)],
          });
          setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        } catch (error) {
          console.error('Chat filter error:', error);
        }
        return;
      }
    }

    // ==================== INVITE FILTER ====================
    if (hasInvite(message.content)) {
      try {
        await message.delete();
        const warnMsg = await message.reply({
          embeds: [warningEmbed('⚠️ Invite Deleted', 'Discord invites are not allowed in this server')],
        });

        const logEmbed = new EmbedBuilder()
          .setTitle('🔗 Invite Link Detected')
          .setColor(0xffa500)
          .addFields(
            { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: false },
            { name: 'Channel', value: `${message.channel.toString()}`, inline: true },
            { name: 'Content', value: message.content.substring(0, 100), inline: false },
          )
          .setTimestamp();

        await sendLog(message.guild, logEmbed);
        setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
      } catch (error) {
        console.error('Invite filter error:', error);
      }
      return;
    }
  } catch (error) {
    console.error('Message create error:', error);
  }
});

/**
 * Guild Member Add event
 */
client.on('guildMemberAdd', async (member) => {
  try {
    const logEmbed = new EmbedBuilder()
      .setTitle('👋 Member Joined')
      .setColor(0x00ff00)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Member', value: `${member.user.tag} (${member.user.id})`, inline: false },
        { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      )
      .setTimestamp();

    await sendLog(member.guild, logEmbed);
  } catch (error) {
    console.error('Guild member add error:', error);
  }
});

/**
 * Guild Member Remove event
 */
client.on('guildMemberRemove', async (member) => {
  try {
    const logEmbed = new EmbedBuilder()
      .setTitle('👋 Member Left')
      .setColor(0xff0000)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Member', value: `${member.user.tag} (${member.user.id})`, inline: false },
        { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
      )
      .setTimestamp();

    await sendLog(member.guild, logEmbed);
  } catch (error) {
    console.error('Guild member remove error:', error);
  }
});

/**
 * Message Delete event
 */
client.on('messageDelete', async (message) => {
  try {
    if (message.author && !message.author.bot) {
      const logEmbed = new EmbedBuilder()
        .setTitle('🗑️ Message Deleted')
        .setColor(0xffa500)
        .addFields(
          { name: 'Author', value: `${message.author.tag} (${message.author.id})`, inline: false },
          { name: 'Channel', value: `${message.channel.toString()}`, inline: true },
          { name: 'Content', value: message.content.substring(0, 100) || 'No content', inline: false },
        )
        .setTimestamp();

      await sendLog(message.guild, logEmbed);
    }
  } catch (error) {
    console.error('Message delete error:', error);
  }
});

/**
 * Message Update event
 */
client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    if (oldMessage.author && !oldMessage.author.bot && oldMessage.content !== newMessage.content) {
      const logEmbed = new EmbedBuilder()
        .setTitle('✏️ Message Edited')
        .setColor(0x0099ff)
        .addFields(
          { name: 'Author', value: `${oldMessage.author.tag} (${oldMessage.author.id})`, inline: false },
          { name: 'Channel', value: `${oldMessage.channel.toString()}`, inline: true },
          { name: 'Before', value: oldMessage.content.substring(0, 100) || 'No content', inline: false },
          { name: 'After', value: newMessage.content.substring(0, 100) || 'No content', inline: false },
        )
        .setTimestamp();

      await sendLog(oldMessage.guild, logEmbed);
    }
  } catch (error) {
    console.error('Message update error:', error);
  }
});

/**
 * Error event
 */
client.on('error', (error) => {
  console.error('Discord.js error:', error);
});

/**
 * Warn event
 */
client.on('warn', (info) => {
  console.warn('Discord.js warning:', info);
});

/**
 * Process error handlers
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// ==================== BOT LOGIN ====================

async function start() {
  try {
    if (!TOKEN) {
      console.error('❌ Error: DISCORD_TOKEN not found in .env file');
      process.exit(1);
    }

    if (!CLIENT_ID) {
      console.error('❌ Error: CLIENT_ID not found in .env file');
      process.exit(1);
    }

    console.log('🚀 Starting bot...');
    await client.login(TOKEN);
    await registerCommands();
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

start();
