const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(__dirname, "..", "..", "data");
const storePath = path.join(dataDir, "guilds.json");

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({ guilds: {} }, null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(storePath, "utf8"));
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function defaultGuild() {
  return {
    logChannelId: null,
    welcomeChannelId: null,
    welcomeMessage: "Welcome {user} to {server}.",
    responses: {},
    warnings: {}
  };
}

function getGuild(guildId) {
  const store = readStore();
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = defaultGuild();
    writeStore(store);
  }

  return store.guilds[guildId];
}

function updateGuild(guildId, updater) {
  const store = readStore();
  const current = store.guilds[guildId] || defaultGuild();
  store.guilds[guildId] = updater(current) || current;
  writeStore(store);
  return store.guilds[guildId];
}

module.exports = {
  getGuild,
  updateGuild
};
