const crypto = require("crypto");
const { EventEmitter } = require("events");

const WORDS_PER_PLAYER = 10;
const MAX_WORD_LENGTH = 40;
const MAX_NICK_LENGTH = 16;
const MAX_PLAYERS = 12;
const VOTE_TIME_MS = 30000;
const TURN_TIME_MS = 45000;
const DEFAULT_POINT_LIMIT = 5;
const MIN_POINT_LIMIT = 1;
const MAX_POINT_LIMIT = 100;
const MAX_AVATAR_LENGTH = 200000;
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
const LOBBY_TIMEOUT_MS = 15 * 60 * 1000;
const LOBBY_WARNING_MS = 2 * 60 * 1000;
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CAMERA_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CAMERA_CODE_LENGTH = 6;
const COLORS = [
  "#ff4d6d", "#ffb703", "#06d6a0", "#4cc9f0", "#b388ff", "#ff8fab",
  "#f77f00", "#80ed99", "#ffd166", "#00bbf9", "#f15bb5", "#9ef01a"
];

class GameError extends Error {}

function fail(message) {
  throw new GameError(message);
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function textKey(text) {
  return text.toLocaleLowerCase("pl");
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

class Room {
  constructor(code, hub) {
    this.code = code;
    this.hub = hub;
    this.players = [];
    this.hostId = null;
    this.phase = "lobby";
    this.pointLimit = DEFAULT_POINT_LIMIT;
    this.pool = [];
    this.activeId = null;
    this.vote = null;
    this.turnTimer = null;
    this.turnEndsAt = 0;
    this.endReason = null;
    this.wordSeq = 0;
    this.cleanupTimer = null;
    this.expiresAt = Date.now() + LOBBY_TIMEOUT_MS;
    this.expiryTimer = null;
    this.warningTimer = null;
  }

  emit(name, ...args) {
    this.hub.emit(name, this, ...args);
  }

  changed() {
    this.emit("change");
  }

  announce(text) {
    this.emit("event", text);
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  canManage(player) {
    return player.id === this.hostId;
  }

  requireManager(player) {
    if (!this.canManage(player)) fail("Tylko host może to zrobić");
  }

  requireAdmin(player) {
    this.requireManager(player);
  }

  requirePhase(...phases) {
    if (!phases.includes(this.phase)) fail("To teraz niedostępne");
  }

  requireTarget(playerId) {
    const target = this.getPlayer(playerId);
    if (!target) fail("Nie ma takiego gracza");
    return target;
  }

  addPlayer(rawNick) {
    if (this.phase !== "lobby") fail("Gra już trwa. Dołączyć można tylko w lobby");
    const nick = cleanText(rawNick, MAX_NICK_LENGTH);
    if (!nick) fail("Podaj nick");
    if (this.players.length >= MAX_PLAYERS) fail("Pokój jest pełny");
    if (this.players.some((p) => textKey(p.nick) === textKey(nick))) fail("Ten nick jest już zajęty w tym pokoju");

    const usedColors = new Set(this.players.map((p) => p.color));
    const player = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString("hex"),
      cameraCode: this.hub.newCameraCode(),
      phoneCount: 0,
      nick,
      color: COLORS.find((c) => !usedColors.has(c)) || COLORS[this.players.length % COLORS.length],
      avatar: null,
      words: [],
      wordsReady: false,
      connected: false,
      socketId: null,
      score: 0,
      word: null
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;
    return player;
  }

  removePlayer(player, reason) {
    if (!this.players.includes(player)) return;
    if (this.phase === "game") {
      if (this.vote && this.vote.guesserId === player.id) this.cancelVote(`Głosowanie anulowane, ${player.nick} opuszcza grę`);
      if (this.activeId === player.id) this.advanceTurn();
      if (player.word) this.pool.push(player.word);
      player.word = null;
    }
    this.players = this.players.filter((p) => p !== player);
    this.emit("removed", player, reason);
    this.announce(`${player.nick} opuszcza pokój`);
    if (this.hostId === player.id) {
      const candidates = this.players.filter((p) => p.connected);
      const pool = candidates.length ? candidates : this.players;
      const newHost = pool.length ? pool[crypto.randomInt(pool.length)] : null;
      this.hostId = newHost ? newHost.id : null;
      if (newHost) this.announce(`${newHost.nick} zostaje nowym hostem`);
    }

    if (this.phase === "game") {
      if (this.players.length < 2) this.finish("players");
      else this.evaluateVote();
    }
    this.hub.updatePresence(this);
    this.changed();
  }

  setConnected(player, connected) {
    player.connected = connected;
    if (!connected) player.socketId = null;
    this.evaluateVote();
    this.hub.updatePresence(this);
    this.changed();
  }

  changePhoneCount(player, delta) {
    player.phoneCount = Math.max(0, player.phoneCount + delta);
    this.changed();
  }

  setAvatar(player, data) {
    if (data === null) {
      player.avatar = null;
    } else {
      if (typeof data !== "string" || !data.startsWith("data:image/png;base64,")) fail("Nieprawidłowy obrazek");
      if (data.length > MAX_AVATAR_LENGTH) fail("Avatar jest za duży");
      player.avatar = data;
    }
    this.emit("avatar", player);
  }

  setWords(player, list) {
    this.requirePhase("lobby");
    if (!Array.isArray(list) || list.length !== WORDS_PER_PLAYER) fail(`Potrzeba dokładnie ${WORDS_PER_PLAYER} haseł`);
    const words = list.map((w) => cleanText(w, MAX_WORD_LENGTH));
    if (words.some((w) => !w)) fail(`Uzupełnij wszystkie ${WORDS_PER_PLAYER} haseł`);
    const seen = new Set();
    for (const word of words) {
      const key = textKey(word);
      if (seen.has(key)) fail(`Hasło „${word}” się powtarza`);
      seen.add(key);
    }
    player.words = words;
    player.wordsReady = true;
    this.changed();
  }

  setPointLimit(player, value) {
    this.requireManager(player);
    const limit = Math.floor(Number(value));
    if (!Number.isFinite(limit) || limit < MIN_POINT_LIMIT || limit > MAX_POINT_LIMIT) {
      fail(`Limit musi być liczbą od ${MIN_POINT_LIMIT} do ${MAX_POINT_LIMIT}`);
    }
    this.pointLimit = limit;
    this.announce(`Limit punktów: ${limit}`);
    if (this.phase === "game" && this.players.some((p) => p.score >= limit)) this.finish("limit");
    this.changed();
  }

  claimHost(player) {
    if (this.hostId === player.id) fail("Już jesteś hostem");
    this.hostId = player.id;
    this.announce(`${player.nick} przejmuje hosta (hasło admina)`);
    this.changed();
  }

  start(player) {
    this.requireManager(player);
    this.requirePhase("lobby");
    if (this.players.length < 2) fail("Potrzeba co najmniej 2 graczy");
    const missing = this.players.filter((p) => !p.wordsReady).map((p) => p.nick);
    if (missing.length) fail(`Brakuje haseł od: ${missing.join(", ")}`);
    this.beginGame();
    this.changed();
  }

  beginGame() {
    this.clearVote();
    this.pool = [];
    for (const p of this.players) {
      for (const text of p.words) this.pool.push({ id: ++this.wordSeq, text, authorId: p.id });
      p.score = 0;
      p.word = null;
    }
    shuffle(this.pool);
    this.phase = "game";
    this.endReason = null;
    const starters = this.players.filter((p) => p.connected);
    const starter = (starters.length ? starters : this.players)[crypto.randomInt(starters.length || this.players.length)];
    this.activeId = starter.id;
    for (const p of this.players) {
      if (!this.drawWord(p)) return this.finish("pool");
    }
    this.restartTurnTimer();
    this.hub.scheduleExpiry(this);
    this.announce(`Gra rozpoczęta! Zaczyna ${starter.nick}`);
  }

  stopTurnTimer() {
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnEndsAt = 0;
  }

  restartTurnTimer() {
    this.stopTurnTimer();
    if (this.phase !== "game" || this.vote || !this.activeId) return;
    const activeId = this.activeId;
    this.turnEndsAt = Date.now() + TURN_TIME_MS;
    this.turnTimer = setTimeout(() => {
      if (this.phase !== "game" || this.vote || this.activeId !== activeId) return;
      const player = this.getPlayer(activeId);
      this.announce(`Czas minął! ${player ? player.nick : "Gracz"} traci turę`);
      this.advanceTurn();
      this.changed();
    }, TURN_TIME_MS);
  }

  drawWord(player) {
    const candidates = [];
    this.pool.forEach((word, index) => {
      if (word.authorId !== player.id) candidates.push(index);
    });
    if (!candidates.length) {
      player.word = null;
      return false;
    }
    const index = candidates[crypto.randomInt(candidates.length)];
    player.word = this.pool.splice(index, 1)[0];
    return true;
  }

  advanceTurn() {
    const count = this.players.length;
    if (!count) {
      this.activeId = null;
      return;
    }
    const start = Math.max(0, this.players.findIndex((p) => p.id === this.activeId));
    let next = null;
    for (let i = 1; i <= count; i++) {
      const candidate = this.players[(start + i) % count];
      if (candidate.connected && candidate.id !== this.activeId) {
        next = candidate;
        break;
      }
    }
    if (!next) next = this.players[(start + 1) % count];
    this.activeId = next.id;
    this.restartTurnTimer();
  }

  requireTurn(player) {
    this.requirePhase("game");
    if (this.activeId !== player.id) fail("To nie twoja tura");
    if (this.vote) fail("Trwa głosowanie");
  }

  next(player) {
    this.requireTurn(player);
    this.advanceTurn();
    this.changed();
  }

  pass(player) {
    this.requireTurn(player);
    const word = player.word;
    player.score -= 1;
    player.word = null;
    this.announce(`${player.nick} pasuje (−1). Hasło: ${word ? word.text : "?"}`);
    this.emit("wordChanged", player, "passed", word ? word.text : "");
    if (!this.drawWord(player)) this.finish("pool");
    else this.restartTurnTimer();
    this.changed();
  }

  guess(player) {
    this.requireTurn(player);
    const vote = {
      guesserId: player.id,
      yes: new Set(),
      no: new Set(),
      endsAt: Date.now() + VOTE_TIME_MS,
      timer: null
    };
    vote.timer = setTimeout(() => {
      if (this.vote !== vote) return;
      this.cancelVote("Czas na głosowanie minął");
      this.changed();
    }, VOTE_TIME_MS);
    this.vote = vote;
    this.stopTurnTimer();
    this.announce(`${player.nick} mówi, że zgadł(a)! Głosujcie`);
    this.changed();
  }

  voters() {
    if (!this.vote) return [];
    return this.players.filter((p) => p.connected && p.id !== this.vote.guesserId);
  }

  requiredYes(voterCount) {
    return Math.max(1, Math.ceil(voterCount / 2));
  }

  castVote(player, approve) {
    this.requirePhase("game");
    if (!this.vote) fail("Nie ma teraz głosowania");
    if (player.id === this.vote.guesserId) fail("Nie możesz głosować na siebie");
    if (approve) {
      this.vote.yes.add(player.id);
      this.vote.no.delete(player.id);
    } else {
      this.vote.no.add(player.id);
      this.vote.yes.delete(player.id);
    }
    this.evaluateVote();
    this.changed();
  }

  evaluateVote() {
    if (!this.vote || this.phase !== "game") return;
    const voterIds = new Set(this.voters().map((p) => p.id));
    const yes = [...this.vote.yes].filter((id) => voterIds.has(id)).length;
    const no = [...this.vote.no].filter((id) => voterIds.has(id)).length;
    if (yes >= this.requiredYes(voterIds.size)) {
      this.succeedGuess();
    } else if (no > voterIds.size / 2 || (voterIds.size > 0 && yes + no >= voterIds.size)) {
      this.cancelVote("Głosowanie odrzucone");
    }
  }

  clearVote() {
    if (this.vote) clearTimeout(this.vote.timer);
    this.vote = null;
  }

  cancelVote(message) {
    if (!this.vote) return;
    this.clearVote();
    this.restartTurnTimer();
    this.announce(message);
  }

  succeedGuess() {
    const guesser = this.vote && this.getPlayer(this.vote.guesserId);
    this.clearVote();
    if (!guesser) return;
    const word = guesser.word;
    guesser.score += 1;
    guesser.word = null;
    this.announce(`${guesser.nick} zgaduje! (+1) Hasło: ${word ? word.text : "?"}`);
    this.emit("wordChanged", guesser, "guessed", word ? word.text : "");
    if (guesser.score >= this.pointLimit) return this.finish("limit");
    if (!this.drawWord(guesser)) return this.finish("pool");
    this.advanceTurn();
  }

  finish(reason) {
    this.clearVote();
    this.stopTurnTimer();
    this.phase = "end";
    this.endReason = reason;
    this.activeId = null;
  }

  backToLobby(player) {
    if (this.phase === "game") this.requireAdmin(player);
    this.requirePhase("game", "end");
    this.clearVote();
    this.stopTurnTimer();
    this.phase = "lobby";
    this.pool = [];
    this.activeId = null;
    this.endReason = null;
    for (const p of this.players) {
      p.score = 0;
      p.word = null;
    }
    this.expiresAt = Date.now() + LOBBY_TIMEOUT_MS;
    this.hub.scheduleExpiry(this);
    this.announce("Powrót do lobby");
    this.changed();
  }

  adminForceNext(admin) {
    this.requireAdmin(admin);
    this.requirePhase("game");
    this.cancelVote("Głosowanie przerwane przez admina");
    this.advanceTurn();
    this.announce("Admin przekazuje turę dalej");
    this.changed();
  }

  adminResolveVote(admin, approve) {
    this.requireAdmin(admin);
    this.requirePhase("game");
    if (!this.vote) fail("Nie ma teraz głosowania");
    if (approve) this.succeedGuess();
    else this.cancelVote("Admin odrzuca głosowanie");
    this.changed();
  }

  adminAdjustScore(admin, playerId, delta) {
    this.requireAdmin(admin);
    this.requirePhase("game");
    const amount = Math.trunc(Number(delta));
    if (!amount || Math.abs(amount) > 10) fail("Nieprawidłowa zmiana punktów");
    const target = this.requireTarget(playerId);
    target.score += amount;
    this.announce(`Admin: ${target.nick} ${amount > 0 ? "+" : ""}${amount} pkt`);
    if (target.score >= this.pointLimit) this.finish("limit");
    this.changed();
  }

  kick(admin, playerId) {
    this.requireManager(admin);
    const target = this.requireTarget(playerId);
    if (target === admin) fail("Nie możesz wyrzucić siebie");
    this.removePlayer(target, "Zostałeś wyrzucony z pokoju");
  }

  adminRerollWord(admin, playerId) {
    this.requireAdmin(admin);
    this.requirePhase("game");
    const target = this.requireTarget(playerId);
    if (!this.pool.some((word) => word.authorId !== target.id)) fail("W puli nie ma już haseł dla tego gracza");
    if (this.vote && this.vote.guesserId === target.id) this.cancelVote("Głosowanie anulowane, nowe hasło");
    this.drawWord(target);
    this.announce(`Host losuje nowe hasło dla gracza ${target.nick}`);
    this.emit("wordChanged", target, "rerolled", "");
    this.changed();
  }

  extendLifetime(player) {
    this.requireManager(player);
    this.requirePhase("lobby");
    this.expiresAt = Date.now() + LOBBY_TIMEOUT_MS;
    this.hub.scheduleExpiry(this);
    this.announce("Host przedłuża lobby o kolejne 15 minut");
    this.changed();
  }

  adminEndGame(admin) {
    this.requireAdmin(admin);
    this.requirePhase("game");
    this.finish("admin");
    this.announce("Admin kończy grę");
    this.changed();
  }

  adminRestart(admin) {
    this.requireAdmin(admin);
    this.requirePhase("game", "end");
    if (this.players.length < 2) fail("Potrzeba co najmniej 2 graczy");
    this.beginGame();
    this.changed();
  }

  voteView(viewer) {
    if (!this.vote) return null;
    const voters = this.voters();
    const voterIds = new Set(voters.map((p) => p.id));
    return {
      guesserId: this.vote.guesserId,
      yes: [...this.vote.yes].filter((id) => voterIds.has(id)).length,
      no: [...this.vote.no].filter((id) => voterIds.has(id)).length,
      voters: voters.length,
      required: this.requiredYes(voters.length),
      myVote: this.vote.yes.has(viewer.id) ? "yes" : this.vote.no.has(viewer.id) ? "no" : null,
      remainingMs: Math.max(0, this.vote.endsAt - Date.now())
    };
  }

  viewFor(viewer) {
    return {
      code: this.code,
      phase: this.phase,
      pointLimit: this.pointLimit,
      activeId: this.activeId,
      turnRemainingMs: this.turnEndsAt ? Math.max(0, this.turnEndsAt - Date.now()) : null,
      endReason: this.endReason,
      roomRemainingMs: this.phase === "lobby" ? Math.max(0, this.expiresAt - Date.now()) : null,
      poolSize: this.pool.length,
      me: {
        id: viewer.id,
        nick: viewer.nick,
        canManage: this.canManage(viewer),
        words: viewer.words,
        wordsReady: viewer.wordsReady,
        cameraCode: viewer.cameraCode
      },
      players: this.players.map((p) => ({
        id: p.id,
        nick: p.nick,
        color: p.color,
        connected: p.connected,
        score: p.score,
        wordsReady: p.wordsReady,
        canManage: this.canManage(p),
        hasPhone: p.phoneCount > 0,
        word: p.id !== viewer.id && p.word ? p.word.text : null
      })),
      vote: this.voteView(viewer),
      results: this.phase === "end"
        ? [...this.players]
            .sort((a, b) => b.score - a.score)
            .map((p) => ({ id: p.id, nick: p.nick, color: p.color, score: p.score, word: p.word ? p.word.text : null }))
        : null
    };
  }
}

class Registry extends EventEmitter {
  constructor() {
    super();
    this.rooms = new Map();
  }

  createRoom() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)]).join("");
    } while (this.rooms.has(code));
    const room = new Room(code, this);
    this.rooms.set(code, room);
    this.scheduleExpiry(room);
    return room;
  }

  getRoom(code) {
    if (typeof code !== "string") return null;
    return this.rooms.get(code.trim().toUpperCase()) || null;
  }

  findByToken(token) {
    if (typeof token !== "string" || !token) return null;
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.token === token);
      if (player) return { room, player };
    }
    return null;
  }

  findByCameraCode(code) {
    if (typeof code !== "string") return null;
    const wanted = code.trim().toUpperCase();
    if (wanted.length !== CAMERA_CODE_LENGTH) return null;
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.cameraCode === wanted);
      if (player) return { room, player };
    }
    return null;
  }

  newCameraCode() {
    let code;
    do {
      code = Array.from({ length: CAMERA_CODE_LENGTH }, () => CAMERA_CODE_CHARS[crypto.randomInt(CAMERA_CODE_CHARS.length)]).join("");
    } while (this.findByCameraCode(code));
    return code;
  }

  scheduleExpiry(room) {
    clearTimeout(room.expiryTimer);
    clearTimeout(room.warningTimer);
    room.expiryTimer = null;
    room.warningTimer = null;
    if (room.phase !== "lobby") return;
    const remaining = room.expiresAt - Date.now();
    room.expiryTimer = setTimeout(() => this.expireRoom(room), Math.max(0, remaining));
    if (remaining > LOBBY_WARNING_MS) {
      room.warningTimer = setTimeout(() => {
        room.announce("Lobby zamknie się za 2 minuty, jeśli gra nie wystartuje. Host może przedłużyć");
        room.changed();
      }, remaining - LOBBY_WARNING_MS);
    }
  }

  expireRoom(room) {
    if (this.rooms.get(room.code) !== room) return;
    for (const player of room.players) this.emit("removed", room, player, "Pokój zamknięty: gra nie wystartowała przez 15 minut");
    room.players = [];
    this.deleteRoom(room);
  }

  updatePresence(room) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
    if (!room.players.length) return this.deleteRoom(room);
    if (!room.players.some((p) => p.connected)) {
      room.cleanupTimer = setTimeout(() => this.deleteRoom(room), EMPTY_ROOM_TTL_MS);
    }
  }

  deleteRoom(room) {
    clearTimeout(room.cleanupTimer);
    clearTimeout(room.expiryTimer);
    clearTimeout(room.warningTimer);
    room.clearVote();
    room.stopTurnTimer();
    this.rooms.delete(room.code);
  }
}

module.exports = { Registry, GameError, fail };
