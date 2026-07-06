const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { canManageGuild } = require("../lib/moderation");
const { getGuild } = require("../lib/storage");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Show the current bot settings for this server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!canManageGuild(interaction)) {
      await interaction.reply({ ...ui.danger("No permission", "You need Manage Server permission to view settings."), ephemeral: true });
      return;
    }

    const settings = getGuild(interaction.guild.id);
    const logChannel = settings.logChannelId ? `<#${settings.logChannelId}>` : "Not set";
    const welcomeChannel = settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : "Not set";
    const responseCount = Object.keys(settings.responses).length;

    await interaction.reply({
      ...ui.info("Bot settings", "Current setup for this server.", [
        { name: "Log channel", value: logChannel, inline: true },
        { name: "Welcome channel", value: welcomeChannel, inline: true },
        { name: "Auto-responses", value: String(responseCount), inline: true },
        { name: "Welcome message", value: settings.welcomeMessage || "Not set" }
      ]),
      ephemeral: true
    });
  }
};
