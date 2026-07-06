const { SlashCommandBuilder } = require("discord.js");
const { getGuild } = require("../lib/storage");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("responses")
    .setDescription("Show this server's custom auto-responses."),

  async execute(interaction) {
    const settings = getGuild(interaction.guild.id);
    const entries = Object.entries(settings.responses);

    if (!entries.length) {
      await interaction.reply({ ...ui.info("No responses", "No custom auto-responses are set yet."), ephemeral: true });
      return;
    }

    const list = entries
      .slice(0, 20)
      .map(([trigger, reply]) => `\`${trigger}\` -> ${reply}`)
      .join("\n");

    await interaction.reply({ ...ui.info("Auto-responses", list), ephemeral: true });
  }
};
