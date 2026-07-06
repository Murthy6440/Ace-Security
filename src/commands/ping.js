const { SlashCommandBuilder } = require("discord.js");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency."),

  async execute(interaction) {
    const sent = await interaction.reply({
      ...ui.info("Checking latency", "Pinging Discord..."),
      fetchReply: true
    });

    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(
      ui.success("Pong", `Bot latency is ${latency}ms.`)
    );
  }
};
