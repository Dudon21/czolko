const { fail } = require("./errors");
const { cleanMessage, maskSecret } = require("./text");

const CHAT_HISTORY = 150;
const CHAT_IMAGE_HISTORY = 25;
const MAX_CHAT_IMAGE = 460000;
const CHAT_IMAGE_PATTERN = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

module.exports = {
  addChat(player, payload) {
    const text = cleanMessage(payload.text);
    let image = null;
    if (payload.image !== undefined && payload.image !== null) {
      if (typeof payload.image !== "string" || !CHAT_IMAGE_PATTERN.test(payload.image)) fail("Nieprawidłowy obrazek");
      if (payload.image.length > MAX_CHAT_IMAGE) fail("Zdjęcie jest za duże");
      image = payload.image;
    }
    if (!text && !image) fail("Pusta wiadomość");
    let target = null;
    if (payload.toId) {
      target = this.requireTarget(payload.toId);
      if (target === player) fail("Nie możesz pisać sam do siebie");
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
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    const withImages = this.chat.filter((m) => m.image);
    for (const old of withImages.slice(0, Math.max(0, withImages.length - CHAT_IMAGE_HISTORY))) {
      old.image = null;
      old.imageExpired = true;
    }
    this.emit("chat", message);
    return message;
  },

  chatVisibleTo(viewer, message) {
    return !message.toId || message.fromId === viewer.id || message.toId === viewer.id;
  },

  chatSecretFor(viewer) {
    if (this.phase !== "game") return null;
    if (this.mode === "klamca") {
      const liar = this.liar;
      return liar && liar.word && liar.impostorId === viewer.id && liar.stage !== "reveal" ? liar.word : null;
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
