const { SlashCommandBuilder } = require("discord.js");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Show information about this server."),

  async execute(interaction) {
    const guild = interaction.guild;
    await interaction.reply(ui.info("Server info", guild.name, [
      { name: "Server ID", value: guild.id, inline: true },
      { name: "Members", value: String(guild.memberCount), inline: true },
      { name: "Owner ID", value: guild.ownerId, inline: true },
      { name: "Created", value: `<t:${Math.floor(guild.createdAt.getTime() / 1000)}:R>`, inline: true }
    ]));
  }
};
