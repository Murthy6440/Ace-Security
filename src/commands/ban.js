const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { formatUser, isModerator, logAction } = require("../lib/moderation");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member from the server.")
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to ban").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the ban").setMaxLength(500)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    if (!isModerator(interaction)) {
      await interaction.reply({ ...ui.danger("No permission", "You need moderation permissions to use this."), ephemeral: true });
      return;
    }

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") || "No reason provided";
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (member && !member.bannable) {
      await interaction.reply({ ...ui.danger("Cannot ban", "My role is not high enough to ban that member."), ephemeral: true });
      return;
    }

    await interaction.guild.members.ban(user.id, { reason });
    await interaction.reply(ui.success("Member banned", `${user} was banned.`, [
      { name: "Reason", value: reason }
    ]));

    await logAction(interaction.guild, "Member banned", `${user} was banned.`, [
      { name: "Moderator", value: formatUser(interaction.user), inline: true },
      { name: "User", value: formatUser(user), inline: true },
      { name: "Reason", value: reason }
    ]);
  }
};
