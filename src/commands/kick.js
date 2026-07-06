const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { formatUser, isModerator, logAction } = require("../lib/moderation");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from the server.")
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to kick").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the kick").setMaxLength(500)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    if (!isModerator(interaction)) {
      await interaction.reply({ ...ui.danger("No permission", "You need moderation permissions to use this."), ephemeral: true });
      return;
    }

    const member = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason provided";

    if (!member?.kickable) {
      await interaction.reply({ ...ui.danger("Cannot kick", "My role is not high enough to kick that member."), ephemeral: true });
      return;
    }

    await member.kick(reason);
    await interaction.reply(ui.success("Member kicked", `${member.user} was kicked.`, [
      { name: "Reason", value: reason }
    ]));

    await logAction(interaction.guild, "Member kicked", `${member.user} was kicked.`, [
      { name: "Moderator", value: formatUser(interaction.user), inline: true },
      { name: "User", value: formatUser(member.user), inline: true },
      { name: "Reason", value: reason }
    ]);
  }
};
