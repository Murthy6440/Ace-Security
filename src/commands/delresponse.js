const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { canManageGuild, logAction } = require("../lib/moderation");
const { updateGuild } = require("../lib/storage");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("delresponse")
    .setDescription("Remove a custom auto-response.")
    .addStringOption((option) =>
      option.setName("trigger").setDescription("Trigger to remove").setRequired(true).setMaxLength(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!canManageGuild(interaction)) {
      await interaction.reply({ ...ui.danger("No permission", "You need Manage Server permission to change responses."), ephemeral: true });
      return;
    }

    const trigger = interaction.options.getString("trigger", true).toLowerCase().trim();
    let existed = false;

    updateGuild(interaction.guild.id, (guild) => {
      existed = Boolean(guild.responses[trigger]);
      delete guild.responses[trigger];
      return guild;
    });

    if (!existed) {
      await interaction.reply({ ...ui.warning("Not found", `No auto-response exists for \`${trigger}\`.`), ephemeral: true });
      return;
    }

    await interaction.reply(ui.success("Auto-response removed", `Removed the response for \`${trigger}\`.`));
    await logAction(interaction.guild, "Auto-response removed", `${interaction.user} removed the response for \`${trigger}\`.`);
  }
};
