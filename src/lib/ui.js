const { EmbedBuilder } = require("discord.js");

const colors = {
  success: 0x2ecc71,
  info: 0x3498db,
  warning: 0xf1c40f,
  danger: 0xe74c3c,
  neutral: 0x95a5a6
};

function embed({ title, description, color = "info", fields = [] }) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(colors[color] || colors.info)
    .addFields(fields)
    .setTimestamp();
}

function success(title, description, fields) {
  return { embeds: [embed({ title, description, color: "success", fields })] };
}

function info(title, description, fields) {
  return { embeds: [embed({ title, description, color: "info", fields })] };
}

function warning(title, description, fields) {
  return { embeds: [embed({ title, description, color: "warning", fields })] };
}

function danger(title, description, fields) {
  return { embeds: [embed({ title, description, color: "danger", fields })] };
}

module.exports = {
  embed,
  success,
  info,
  warning,
  danger
};
