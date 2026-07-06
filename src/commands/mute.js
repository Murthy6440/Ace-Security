const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { formatUser, isModerator, logAction } = require("../lib/moderation");
const ui = require("../lib/ui");

const minuteChoices = [
  { name: "5 minutes", value: 5 },
  { name: "10 minutes", value: 10 },
  { name: "1 hour", value: 60 },
  { name: "1 day", value: 1440 },
  { name: "1 week", value: 10080 }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Timeout a member.")
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to mute").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("duration")
        .setDescription("Mute duration")
        .setRequired(true)
        .addChoices(...minuteChoices)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the mute").setMaxLength(500)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    if (!isModerator(interaction)) {
      await interaction.reply({ ...ui.danger("No permission", "You need moderation permissions to use this."), ephemeral: true });
      return;
    }

    const member = interaction.options.getMember("user");
    const duration = interaction.options.getInteger("duration", true);
    const reason = interaction.options.getString("reason") || "No reason provided";

    if (!member?.moderatable) {
      await interaction.reply({ ...ui.danger("Cannot mute", "My role is not high enough to timeout that member."), ephemeral: true });
      return;
    }

    await member.timeout(duration * 60 * 1000, reason);
    await interaction.reply(ui.success("Member muted", `${member.user} was muted for ${duration} minute(s).`, [
      { name: "Reason", value: reason }
    ]));

    await logAction(interaction.guild, "Member muted", `${member.user} was muted for ${duration} minute(s).`, [
      { name: "Moderator", value: formatUser(interaction.user), inline: true },
      { name: "User", value: formatUser(member.user), inline: true },
      { name: "Reason", value: reason }
    ]);
  }
};
