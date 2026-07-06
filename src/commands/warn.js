const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { formatUser, isModerator, logAction } = require("../lib/moderation");
const { updateGuild } = require("../lib/storage");
const ui = require("../lib/ui");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member and save the warning.")
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to warn").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the warning").setRequired(true).setMaxLength(500)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    if (!isModerator(interaction)) {
      await interaction.reply({ ...ui.danger("No permission", "You need moderation permissions to use this."), ephemeral: true });
      return;
    }

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    const warning = {
      reason,
      moderatorId: interaction.user.id,
      createdAt: new Date().toISOString()
    };

    const settings = updateGuild(interaction.guild.id, (guild) => {
      guild.warnings[user.id] = guild.warnings[user.id] || [];
      guild.warnings[user.id].push(warning);
      return guild;
    });

    const count = settings.warnings[user.id].length;
    await interaction.reply(ui.warning("Warning saved", `${user} now has ${count} warning(s).`, [
      { name: "Reason", value: reason }
    ]));

    await logAction(interaction.guild, "Member warned", `${user} received a warning.`, [
      { name: "Moderator", value: formatUser(interaction.user), inline: true },
      { name: "User", value: formatUser(user), inline: true },
      { name: "Reason", value: reason }
    ]);
  }
};
