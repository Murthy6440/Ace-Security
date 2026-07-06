const { SlashCommandBuilder } = require("discord.js");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Show information about a user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to inspect")
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("user") || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    await interaction.reply(ui.info("User info", `${user}`, [
      { name: "Username", value: user.tag, inline: true },
      { name: "User ID", value: user.id, inline: true },
      { name: "Joined server", value: member?.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : "Unknown", inline: true },
      { name: "Account created", value: `<t:${Math.floor(user.createdAt.getTime() / 1000)}:R>`, inline: true }
    ]));
  }
};
