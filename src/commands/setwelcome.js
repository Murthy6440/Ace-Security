const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { canManageGuild, logAction } = require("../lib/moderation");
const { updateGuild } = require("../lib/storage");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setwelcome")
    .setDescription("Choose a welcome channel and message.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Welcome channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Use {user} and {server} in your welcome message")
        .setMaxLength(1000)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!canManageGuild(interaction)) {
      await interaction.reply({ ...ui.danger("No permission", "You need Manage Server permission to change welcome settings."), ephemeral: true });
      return;
    }

    const channel = interaction.options.getChannel("channel", true);
    const message = interaction.options.getString("message") || "Welcome {user} to {server}.";

    updateGuild(interaction.guild.id, (guild) => {
      guild.welcomeChannelId = channel.id;
      guild.welcomeMessage = message;
      return guild;
    });

    await interaction.reply(ui.success("Welcome enabled", `New members will be welcomed in ${channel}.`, [
      { name: "Message", value: message }
    ]));

    await logAction(interaction.guild, "Welcome updated", `${interaction.user} set welcome messages to ${channel}.`);
  }
};
