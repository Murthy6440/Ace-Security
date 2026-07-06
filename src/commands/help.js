const { SlashCommandBuilder } = require("discord.js");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show the bot command list."),

  async execute(interaction) {
    await interaction.reply({
      ...ui.info("Command center", "Here are the main things I can do.", [
        { name: "Moderation", value: "`/ban` `/kick` `/mute` `/unmute` `/warn` `/warnings` `/purge`" },
        { name: "Setup", value: "`/setlogs` `/setwelcome` `/setresponse` `/setresponce` `/delresponse` `/settings`" },
        { name: "Info", value: "`/ping` `/userinfo` `/serverinfo` `/responses`" }
      ]),
      ephemeral: true
    });
  }
};
