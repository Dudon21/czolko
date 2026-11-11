const crypto = require("crypto");
const { fail } = require("./errors");
const { cleanMessage, maskSecret } = require("./text");

const CHAT_HISTORY = 150;
const CHAT_IMAGE_HISTORY = 25;
const MAX_CHAT_IMAGE = 460000;
const CHAT_IMAGE_PATTERN = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+=*)$/;

module.exports = {
  addChat(player, payload) {
    const text = cleanMessage(payload.text);
    let image = null;
    let picture = null;
    if (payload.image !== undefined && payload.image !== null) {
      if (typeof payload.image !== "string" || payload.image.length > MAX_CHAT_IMAGE) fail("Zdjęcie jest za duże");
      const match = CHAT_IMAGE_PATTERN.exec(payload.image);
      if (!match) fail("Nieprawidłowy obrazek");
      picture = { mime: `image/${match[1]}`, buffer: Buffer.from(match[2], "base64") };
    }
    if (!text && !picture) fail("Pusta wiadomość");
    let target = null;
    if (payload.toId) {
      target = this.requireTarget(payload.toId);
      if (target === player) fail("Nie możesz pisać sam do siebie");
    }
    if (picture) {
      const key = crypto.randomBytes(16).toString("hex");
      this.chatImages.set(key, picture);
      image = `/chat-image/${this.code}/${key}`;
    }
    const message = {
      id: ++this.chatSeq,
      fromId: player.id,
      fromNick: player.nick,
      color: player.color,
      toId: target ? target.id : null,
      toNick: target ? target.nick : null,
      text,
      image,
      imageExpired: false,
      at: Date.now()
    };
    this.chat.push(message);
    if (this.chat.length > CHAT_HISTORY) this.dropChatImage(this.chat.shift());
    const withImages = this.chat.filter((m) => m.image);
    for (const old of withImages.slice(0, Math.max(0, withImages.length - CHAT_IMAGE_HISTORY))) this.dropChatImage(old);
    this.emit("chat", message);
    return message;
  },

  dropChatImage(message) {
    if (!message.image) return;
    this.chatImages.delete(message.image.split("/").pop());
    message.image = null;
    message.imageExpired = true;
  },

  chatImage(key) {
    return this.chatImages.get(key) || null;
  },

  chatVisibleTo(viewer, message) {
    return !message.toId || message.fromId === viewer.id || message.toId === viewer.id;
  },

  chatSecretFor(viewer) {
    if (this.phase !== "game") return null;
    if (this.mode === "klamca") {
      const liar = this.liar;
      return liar && liar.word && liar.impostorIds.includes(viewer.id) && liar.stage !== "reveal" ? liar.word : null;
    }
    return viewer.word ? viewer.word.text : null;
  },

  chatViewFor(viewer, message) {
    const secret = this.chatSecretFor(viewer);
    return { ...message, text: message.fromId === viewer.id ? message.text : maskSecret(message.text, secret) };
  },

  chatHistoryFor(viewer) {
    return this.chat.filter((m) => this.chatVisibleTo(viewer, m)).map((m) => this.chatViewFor(viewer, m));
  }
};
