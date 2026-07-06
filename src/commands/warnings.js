const { SlashCommandBuilder } = require("discord.js");
const { getGuild } = require("../lib/storage");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Show warnings for a member.")
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to check").setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("user", true);
    const settings = getGuild(interaction.guild.id);
    const warnings = settings.warnings[user.id] || [];

    if (!warnings.length) {
      await interaction.reply(ui.success("No warnings", `${user} has no saved warnings.`));
      return;
    }

    const list = warnings
      .slice(-10)
      .map((warning, index) => {
        const date = Math.floor(new Date(warning.createdAt).getTime() / 1000);
        return `${index + 1}. <t:${date}:d> - ${warning.reason}`;
      })
      .join("\n");

    await interaction.reply(ui.warning("Warnings", `${user} has ${warnings.length} warning(s).`, [
      { name: "Recent warnings", value: list }
    ]));
  }
};
