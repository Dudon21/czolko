const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const { AccessToken, RoomServiceClient } = require("livekit-server-sdk");
const { Registry, GameError, fail } = require("./game");
const { randomWords } = require("./data/words");
const { SETTINGS } = require("./lib/settings");
const { FIVE_CARDS } = require("./modes/five");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const MAX_ADMIN_ATTEMPTS = 5;
const MAX_CAMERA_ATTEMPTS = 10;
const REACTIONS = ["😂", "🔥", "👏", "😱", "🤦", "🤔", "💀", "❤️"];
const REACTION_COOLDOWN_MS = 300;
const CHAT_COOLDOWN_MS = 350;
const CHAT_IMAGE_COOLDOWN_MS = 2500;
const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const VIDEO_ENABLED = Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
const livekitRooms = VIDEO_ENABLED
  ? new RoomServiceClient(LIVEKIT_URL.replace(/^ws/, "http"), LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  : null;

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/vendor/livekit-client.js", (req, res) => {
  res.sendFile(path.join(__dirname, "node_modules", "livekit-client", "dist", "livekit-client.umd.js"));
});
app.get("/config.json", (req, res) => res.json({ video: VIDEO_ENABLED, settings: SETTINGS, fiveCards: FIVE_CARDS }));
app.get("/qr.svg", (req, res) => {
  const text = String(req.query.text || "");
  if (!text || text.length > 300) return res.status(400).end();
  QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
    .then((svg) => res.type("image/svg+xml").set("Cache-Control", "public, max-age=86400").send(svg))
    .catch(() => res.status(500).end());
});

function videoRoomName(room) {
  return `czolko-${room.code}`;
}

function phoneIdentity(player) {
  return `${player.id}:phone`;
}

async function createVideoToken(room, identity, name, canSubscribe) {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name, ttl: "8h" });
  token.addGrant({ roomJoin: true, room: videoRoomName(room), canPublish: true, canSubscribe, canPublishData: false });
  return token.toJwt();
}

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 512 * 1024 });
const registry = new Registry();
const dirtyRooms = new Set();

function flushRoom(room) {
  if (!dirtyRooms.delete(room)) return;
  const summary = room.phase === "end" ? room.summary() : null;
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit("state", room.viewFor(player, summary));
  }
}

function flushAll() {
  for (const room of [...dirtyRooms]) flushRoom(room);
}

function sendToPlayer(room, player, event, payload) {
  flushRoom(room);
  if (player.socketId) io.to(player.socketId).emit(event, payload);
}

function sendToRoom(room, event, payload) {
  flushRoom(room);
  for (const player of room.players) if (player.socketId) io.to(player.socketId).emit(event, payload);
}

registry.on("change", (room) => {
  if (!dirtyRooms.size) setImmediate(flushAll);
  dirtyRooms.add(room);
});

registry.on("event", (room, text) => sendToRoom(room, "event", { text }));

registry.on("fx", (room, payload) => sendToRoom(room, "fx", payload));

registry.on("waveLive", (room, psychicId, payload) => {
  const psychic = room.getPlayer(psychicId);
  if (psychic) sendToPlayer(room, psychic, "wave:live", payload);
});

registry.on("chat", (room, message) => {
  flushRoom(room);
  for (const player of room.players) {
    if (room.chatVisibleTo(player, message)) sendToPlayer(room, player, "chat:message", room.chatViewFor(player, message));
  }
});

registry.on("avatar", (room, player) => sendToRoom(room, "avatar", { id: player.id, data: player.avatar }));

registry.on("wordChanged", (room, player, reason, text) => sendToPlayer(room, player, "wordChanged", { reason, text }));

registry.on("removed", (room, player, reason) => {
  flushRoom(room);
  if (livekitRooms) {
    for (const identity of [player.id, phoneIdentity(player)]) {
      livekitRooms.removeParticipant(videoRoomName(room), identity).catch(() => {});
    }
  }
  const socket = player.socketId && io.sockets.sockets.get(player.socketId);
  if (!socket) return;
  socket.data.session = null;
  if (reason) socket.emit("kicked", { reason });
});

function passwordMatches(input) {
  const given = crypto.createHash("sha256").update(String(input || "")).digest();
  const expected = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(given, expected);
}

function currentSession(socket) {
  const session = socket.data.session;
  const room = session && registry.getRoom(session.code);
  const player = room && room.getPlayer(session.playerId);
  if (!player || player.socketId !== socket.id) fail("Nie jesteś w pokoju");
  return { room, player };
}

function detach(socket) {
  const session = socket.data.session;
  const room = session && registry.getRoom(session.code);
  const player = room && room.getPlayer(session.playerId);
  socket.data.session = null;
  if (player && player.socketId === socket.id) room.setConnected(player, false);
}

function attach(socket, room, player) {
  if (socket.data.session && socket.data.session.playerId !== player.id) detach(socket);
  if (player.socketId && player.socketId !== socket.id) {
    const previous = io.sockets.sockets.get(player.socketId);
    if (previous) {
      previous.data.session = null;
      previous.emit("replaced");
    }
  }
  flushRoom(room);
  player.socketId = socket.id;
  socket.data.session = { code: room.code, playerId: player.id };
  const avatars = {};
  for (const p of room.players) if (p.avatar) avatars[p.id] = p.avatar;
  socket.emit("avatars", avatars);
  socket.emit("chat:history", room.chatHistoryFor(player));
  room.setConnected(player, true);
}

function handle(socket, event, handler) {
  socket.on(event, (payload, ack) => {
    if (typeof payload === "function") {
      ack = payload;
      payload = {};
    }
    const reply = typeof ack === "function" ? ack : () => {};
    Promise.resolve()
      .then(() => handler(payload && typeof payload === "object" ? payload : {}))
      .then((result) => {
        flushAll();
        reply({ ok: true, ...(result || {}) });
      })
      .catch((error) => {
        flushAll();
        if (error instanceof GameError) {
          reply({ ok: false, error: error.message });
        } else {
          console.error(`Błąd w "${event}":`, error);
          reply({ ok: false, error: "Błąd serwera" });
        }
      });
  });
}

function leavePhone(socket) {
  const phone = socket.data.phone;
  socket.data.phone = null;
  const room = phone && registry.getRoom(phone.code);
  const player = room && room.getPlayer(phone.playerId);
  if (player) room.changePhoneCount(player, -1);
}

const ROOM_ACTIONS = {
  "setAvatar": (room, player, { data }) => room.setAvatar(player, data),
  "setWords": (room, player, { words, starred }) => room.setWords(player, words, starred),
  "setLimit": (room, player, { limit }) => room.setPointLimit(player, limit),
  "setTimeLimit": (room, player, { minutes }) => room.setTimeLimit(player, minutes),
  "setHelpLimit": (room, player, { limit }) => room.setHelpLimit(player, limit),
  "setMode": (room, player, { mode }) => room.setMode(player, mode),
  "setSetting": (room, player, { key, value }) => room.setSetting(player, key, value),
  "resetSettings": (room, player, { mode }) => room.resetSettings(player, mode),
  "extendRoom": (room, player) => room.extendLifetime(player),
  "startGame": (room, player) => room.start(player),
  "backToLobby": (room, player) => room.backToLobby(player),
  "kick": (room, player, { playerId }) => room.kick(player, playerId),

  "next": (room, player) => room.next(player),
  "guess": (room, player) => room.guess(player),
  "pass": (room, player) => room.pass(player),
  "vote": (room, player, { approve }) => room.castVote(player, approve === true),
  "revealAuthor": (room, player) => room.revealAuthor(player),
  "help:request": (room, player, { playerId }) => room.requestHelp(player, playerId),
  "help:end": (room, player) => room.endHelp(player),

  "wave:scale": (room, player, { left, right }) => room.waveSetScale(player, left, right),
  "wave:clue": (room, player, { clue }) => room.waveSetClue(player, clue),
  "wave:move": (room, player, { value }) => room.waveMove(player, value),
  "wave:lock": (room, player, { value, locked }) => room.waveLock(player, value, locked !== false),
  "wave:continue": (room, player) => {
    room.waveContinue(player, false);
    room.changed();
  },

  "setLiarSettings": (room, player, { source, hintChance, masterMode }) => room.setLiarSettings(player, { source, hintChance, masterMode }),
  "setLiarWords": (room, player, { entries }) => room.setLiarWords(player, entries),
  "liar:master": (room, player, { playerId }) => room.liarChooseMaster(player, playerId),
  "liar:setup": (room, player, { word, hint }) => room.liarSetup(player, word, hint),
  "liar:clue": (room, player, { text }) => room.liarClue(player, text),
  "liar:skip": (room, player) => room.liarEndVote(player),
  "liar:vote": (room, player, { playerId }) => room.liarVote(player, playerId),
  "liar:guess": (room, player, { text }) => room.liarGuess(player, text),
  "liar:judge": (room, player, { approve }) => room.liarJudge(player, approve === true),
  "liar:continue": (room, player) => {
    room.liarContinue(player, false);
    room.changed();
  },

  "setFiveTasks": (room, player, { tasks }) => room.setFiveTasks(player, tasks),
  "five:choose": (room, player, { playerId }) => room.fiveChoose(player, playerId),
  "five:reroll": (room, player) => room.fiveReroll(player),
  "five:start": (room, player) => room.fiveStart(player),
  "five:vote": (room, player, { approve }) => room.fiveVote(player, approve === true),
  "five:card": (room, player, { cardId, playerId }) => room.fivePlayCard(player, cardId, playerId),

  "admin:forceNext": (room, player) => room.adminForceNext(player),
  "admin:resolveVote": (room, player, { approve }) => room.adminResolveVote(player, approve === true),
  "admin:score": (room, player, { playerId, delta }) => room.adminAdjustScore(player, playerId, delta),
  "admin:reroll": (room, player, { playerId }) => room.adminRerollWord(player, playerId),
  "admin:giveCard": (room, player, { playerId, type }) => room.adminGiveCard(player, playerId, type),
  "admin:takeCards": (room, player, { playerId }) => room.adminTakeCards(player, playerId),
  "admin:endGame": (room, player) => room.adminEndGame(player),
  "admin:restart": (room, player) => room.adminRestart(player)
};

io.on("connection", (socket) => {
  socket.data.adminAttempts = 0;
  socket.data.cameraAttempts = 0;

  for (const [event, action] of Object.entries(ROOM_ACTIONS)) {
    handle(socket, event, (payload) => {
      const { room, player } = currentSession(socket);
      action(room, player, payload);
    });
  }

  handle(socket, "createRoom", ({ nick }) => {
    const room = registry.createRoom();
    let player;
    try {
      player = room.addPlayer(nick);
    } catch (error) {
      registry.deleteRoom(room);
      throw error;
    }
    attach(socket, room, player);
    return { token: player.token };
  });

  handle(socket, "joinRoom", ({ nick, code }) => {
    const room = registry.getRoom(code);
    if (!room) fail("Nie ma pokoju o takim kodzie");
    const player = room.addPlayer(nick);
    attach(socket, room, player);
    return { token: player.token };
  });

  handle(socket, "resume", ({ token }) => {
    const found = registry.findByToken(token);
    if (!found) fail("Twój poprzedni pokój już nie istnieje");
    attach(socket, found.room, found.player);
  });

  handle(socket, "leaveRoom", () => {
    const { room, player } = currentSession(socket);
    socket.data.session = null;
    room.removePlayer(player, null);
  });

  handle(socket, "randomWords", ({ count, exclude }) => ({ words: randomWords(count, exclude) }));

  handle(socket, "wave:suggest", () => {
    const { room } = currentSession(socket);
    return { scale: room.suggestScale() };
  });

  handle(socket, "claimAdmin", ({ password }) => {
    const { room, player } = currentSession(socket);
    if (!ADMIN_PASSWORD) fail("Hasło admina nie jest ustawione na serwerze");
    if (socket.data.adminAttempts >= MAX_ADMIN_ATTEMPTS) fail("Za dużo prób. Odśwież stronę");
    if (!passwordMatches(password)) {
      socket.data.adminAttempts += 1;
      fail("Złe hasło");
    }
    room.claimHost(player);
  });

  handle(socket, "videoToken", async () => {
    const { room, player } = currentSession(socket);
    if (!VIDEO_ENABLED) fail("Kamerki nie są skonfigurowane na serwerze");
    return { url: LIVEKIT_URL, token: await createVideoToken(room, player.id, player.nick, true) };
  });

  handle(socket, "cameraJoin", async ({ code, refreshOnly }) => {
    if (!VIDEO_ENABLED) fail("Kamerki nie są skonfigurowane na serwerze");
    if (socket.data.cameraAttempts >= MAX_CAMERA_ATTEMPTS) fail("Za dużo prób. Odśwież stronę");
    const found = registry.findByCameraCode(code);
    if (!found) {
      socket.data.cameraAttempts += 1;
      fail("Nie ma gracza z takim kodem kamerki");
    }
    const { room, player } = found;
    leavePhone(socket);
    socket.data.phone = { code: room.code, playerId: player.id };
    room.changePhoneCount(player, 1);
    const result = { nick: player.nick, color: player.color };
    if (!refreshOnly) {
      result.url = LIVEKIT_URL;
      result.token = await createVideoToken(room, phoneIdentity(player), `${player.nick} (telefon)`, false);
    }
    return result;
  });

  handle(socket, "cameraLeave", () => leavePhone(socket));

  handle(socket, "chat:send", ({ text, image, toId }) => {
    const { room, player } = currentSession(socket);
    const now = Date.now();
    if (now - (socket.data.lastChat || 0) < CHAT_COOLDOWN_MS) fail("Zwolnij trochę 🙂");
    if (image && now - (socket.data.lastChatImage || 0) < CHAT_IMAGE_COOLDOWN_MS) fail("Poczekaj chwilę przed kolejnym zdjęciem");
    room.addChat(player, { text, image, toId });
    socket.data.lastChat = now;
    if (image) socket.data.lastChatImage = now;
  });

  handle(socket, "react", ({ emoji }) => {
    const { room, player } = currentSession(socket);
    if (!REACTIONS.includes(emoji)) fail("Nieznana reakcja");
    const now = Date.now();
    if (now - (socket.data.lastReaction || 0) < REACTION_COOLDOWN_MS) return;
    socket.data.lastReaction = now;
    sendToRoom(room, "fx", { type: "reaction", playerId: player.id, emoji });
  });

  socket.on("disconnect", () => {
    detach(socket);
    leavePhone(socket);
    flushAll();
  });
});

server.listen(PORT, () => {
  console.log(`Czółko działa na http://localhost:${PORT}`);
  if (!ADMIN_PASSWORD) console.log("Uwaga: brak ADMIN_PASSWORD, logowanie admina jest wyłączone");
  if (!VIDEO_ENABLED) console.log("Uwaga: brak ustawień LIVEKIT_*, kamerki są wyłączone");
});
