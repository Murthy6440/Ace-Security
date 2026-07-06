const { PermissionsBitField } = require("discord.js");
const { getGuild } = require("./storage");
const ui = require("./ui");

function isModerator(interaction) {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.ModerateMembers);
}

function canManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
}

async function logAction(guild, title, description, fields = []) {
  const settings = getGuild(guild.id);
  if (!settings.logChannelId) return;

  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel.send({
    embeds: [
      ui.embed({
        title,
        description,
        color: "neutral",
        fields
      })
    ]
  });
}

function formatUser(user) {
  return `${user.tag} (${user.id})`;
}

module.exports = {
  isModerator,
  canManageGuild,
  logAction,
  formatUser
};
