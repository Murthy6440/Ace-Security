const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { canManageGuild, logAction } = require("../lib/moderation");
const { updateGuild } = require("../lib/storage");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setresponse")
    .setDescription("Create a custom auto-response.")
    .addStringOption((option) =>
      option.setName("trigger").setDescription("Text the bot should watch for").setRequired(true).setMaxLength(100)
    )
    .addStringOption((option) =>
      option.setName("reply").setDescription("What the bot should reply").setRequired(true).setMaxLength(1000)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!canManageGuild(interaction)) {
      await interaction.reply({ ...ui.danger("No permission", "You need Manage Server permission to change responses."), ephemeral: true });
      return;
    }

    const trigger = interaction.options.getString("trigger", true).toLowerCase().trim();
    const reply = interaction.options.getString("reply", true).trim();

    updateGuild(interaction.guild.id, (guild) => {
      guild.responses[trigger] = reply;
      return guild;
    });

    await interaction.reply(ui.success("Auto-response saved", `When someone says \`${trigger}\`, I will respond.`, [
      { name: "Reply", value: reply }
    ]));

    await logAction(interaction.guild, "Auto-response saved", `${interaction.user} added a response for \`${trigger}\`.`);
  }
};
