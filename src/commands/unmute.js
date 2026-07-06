const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { formatUser, isModerator, logAction } = require("../lib/moderation");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove a member timeout.")
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to unmute").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the unmute").setMaxLength(500)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    if (!isModerator(interaction)) {
      await interaction.reply({ ...ui.danger("No permission", "You need moderation permissions to use this."), ephemeral: true });
      return;
    }

    const member = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason provided";

    if (!member?.moderatable) {
      await interaction.reply({ ...ui.danger("Cannot unmute", "My role is not high enough to manage that member."), ephemeral: true });
      return;
    }

    await member.timeout(null, reason);
    await interaction.reply(ui.success("Member unmuted", `${member.user} can chat again.`, [
      { name: "Reason", value: reason }
    ]));

    await logAction(interaction.guild, "Member unmuted", `${member.user} was unmuted.`, [
      { name: "Moderator", value: formatUser(interaction.user), inline: true },
      { name: "User", value: formatUser(member.user), inline: true },
      { name: "Reason", value: reason }
    ]);
  }
};
