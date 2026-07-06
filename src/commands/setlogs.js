const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { canManageGuild, logAction } = require("../lib/moderation");
const { updateGuild } = require("../lib/storage");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setlogs")
    .setDescription("Choose the channel for moderation logs.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Log channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!canManageGuild(interaction)) {
      await interaction.reply({ ...ui.danger("No permission", "You need Manage Server permission to change logs."), ephemeral: true });
      return;
    }

    const channel = interaction.options.getChannel("channel", true);
    updateGuild(interaction.guild.id, (guild) => {
      guild.logChannelId = channel.id;
      return guild;
    });

    await interaction.reply(ui.success("Logs enabled", `Moderation logs will be sent to ${channel}.`));
    await logAction(interaction.guild, "Log channel set", `${interaction.user} set logs to ${channel}.`);
  }
};
