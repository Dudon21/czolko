const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const { AccessToken, RoomServiceClient } = require("livekit-server-sdk");
const { Registry, GameError, fail } = require("./game");
const { randomWords } = require("./words");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const MAX_ADMIN_ATTEMPTS = 5;
const MAX_CAMERA_ATTEMPTS = 10;
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
app.get("/config.json", (req, res) => res.json({ video: VIDEO_ENABLED }));

function videoRoomName(room) {
  return `czolko-${room.code}`;
}

function phoneIdentity(player) {
  return `${player.id}:phone`;
}

async function createVideoToken(room, identity, name, canSubscribe) {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name, ttl: "8h" });
  token.addGrant({
    roomJoin: true,
    room: videoRoomName(room),
    canPublish: true,
    canSubscribe,
    canPublishData: false
  });
  return token.toJwt();
}

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 512 * 1024 });
const registry = new Registry();

function sendToPlayer(player, event, payload) {
  if (player.socketId) io.to(player.socketId).emit(event, payload);
}

function sendToRoom(room, event, payload) {
  for (const player of room.players) sendToPlayer(player, event, payload);
}

registry.on("change", (room) => {
  for (const player of room.players) sendToPlayer(player, "state", room.viewFor(player));
});

registry.on("event", (room, text) => sendToRoom(room, "event", { text }));

registry.on("avatar", (room, player) => sendToRoom(room, "avatar", { id: player.id, data: player.avatar }));

registry.on("wordChanged", (room, player, reason, text) => sendToPlayer(player, "wordChanged", { reason, text }));

registry.on("removed", (room, player, reason) => {
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
  player.socketId = socket.id;
  socket.data.session = { code: room.code, playerId: player.id };
  const avatars = {};
  for (const p of room.players) if (p.avatar) avatars[p.id] = p.avatar;
  socket.emit("avatars", avatars);
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
      .then((result) => reply({ ok: true, ...(result || {}) }))
      .catch((error) => {
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

io.on("connection", (socket) => {
  socket.data.adminAttempts = 0;
  socket.data.cameraAttempts = 0;

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

  handle(socket, "setAvatar", ({ data }) => {
    const { room, player } = currentSession(socket);
    room.setAvatar(player, data);
  });

  handle(socket, "setWords", ({ words }) => {
    const { room, player } = currentSession(socket);
    room.setWords(player, words);
  });

  handle(socket, "setLimit", ({ limit }) => {
    const { room, player } = currentSession(socket);
    room.setPointLimit(player, limit);
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

  handle(socket, "startGame", () => {
    const { room, player } = currentSession(socket);
    room.start(player);
  });

  handle(socket, "next", () => {
    const { room, player } = currentSession(socket);
    room.next(player);
  });

  handle(socket, "guess", () => {
    const { room, player } = currentSession(socket);
    room.guess(player);
  });

  handle(socket, "pass", () => {
    const { room, player } = currentSession(socket);
    room.pass(player);
  });

  handle(socket, "vote", ({ approve }) => {
    const { room, player } = currentSession(socket);
    room.castVote(player, approve === true);
  });

  handle(socket, "backToLobby", () => {
    const { room, player } = currentSession(socket);
    room.backToLobby(player);
  });

  handle(socket, "kick", ({ playerId }) => {
    const { room, player } = currentSession(socket);
    room.kick(player, playerId);
  });

  handle(socket, "admin:forceNext", () => {
    const { room, player } = currentSession(socket);
    room.adminForceNext(player);
  });

  handle(socket, "admin:resolveVote", ({ approve }) => {
    const { room, player } = currentSession(socket);
    room.adminResolveVote(player, approve === true);
  });

  handle(socket, "admin:score", ({ playerId, delta }) => {
    const { room, player } = currentSession(socket);
    room.adminAdjustScore(player, playerId, delta);
  });

  handle(socket, "admin:reroll", ({ playerId }) => {
    const { room, player } = currentSession(socket);
    room.adminRerollWord(player, playerId);
  });

  handle(socket, "admin:endGame", () => {
    const { room, player } = currentSession(socket);
    room.adminEndGame(player);
  });

  handle(socket, "admin:restart", () => {
    const { room, player } = currentSession(socket);
    room.adminRestart(player);
  });

  socket.on("disconnect", () => {
    detach(socket);
    leavePhone(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Czółko działa na http://localhost:${PORT}`);
  if (!ADMIN_PASSWORD) console.log("Uwaga: brak ADMIN_PASSWORD, logowanie admina jest wyłączone");
  if (!VIDEO_ENABLED) console.log("Uwaga: brak ustawień LIVEKIT_*, kamerki są wyłączone");
});
