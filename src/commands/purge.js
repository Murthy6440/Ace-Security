const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { isModerator, logAction } = require("../lib/moderation");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages from this channel.")
    .addIntegerOption((option) =>
      option.setName("amount").setDescription("Number of messages to delete, 1-100").setRequired(true).setMinValue(1).setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    if (!isModerator(interaction)) {
      await interaction.reply({ ...ui.danger("No permission", "You need moderation permissions to use this."), ephemeral: true });
      return;
    }

    const amount = interaction.options.getInteger("amount", true);
    const deleted = await interaction.channel.bulkDelete(amount, true);

    await interaction.reply({ ...ui.success("Messages deleted", `Deleted ${deleted.size} message(s).`), ephemeral: true });
    await logAction(interaction.guild, "Messages purged", `${interaction.user} deleted ${deleted.size} message(s) in ${interaction.channel}.`);
  }
};
