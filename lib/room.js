const crypto = require("crypto");
const { fail } = require("./errors");
const { LIAR_MIN_PLAYERS, UNLIMITED } = require("./constants");
const { formatPoints, cleanText, textKey } = require("./text");
const { SETTINGS_BY_KEY, defaultSettings } = require("./settings");

const MODES = ["czolko", "wskazowka", "klamca", "piec"];
const MODE_DEFAULT_LIMIT = { czolko: 5, wskazowka: 20, klamca: 10, piec: 5 };
const MODE_NAMES = { czolko: "🙈 Czółko", wskazowka: "🔮 Wskazówka", klamca: "🕵️ Kłamca", piec: "⏱️ 5 sekund" };
const MAX_NICK_LENGTH = 16;
const MAX_PLAYERS = 12;
const DEFAULT_POINT_LIMIT = 5;
const DEFAULT_HELP_LIMIT = 1;
const MAX_TIME_LIMIT_MIN = 240;
const MIN_POINT_LIMIT = 1;
const MAX_POINT_LIMIT = 100;
const MAX_AVATAR_LENGTH = 200000;
const LOBBY_TIMEOUT_MS = 15 * 60 * 1000;
const COLORS = [
  "#ff4d6d", "#ffb703", "#06d6a0", "#4cc9f0", "#b388ff", "#ff8fab",
  "#f77f00", "#80ed99", "#ffd166", "#00bbf9", "#f15bb5", "#9ef01a"
];

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
    this.help = null;
    this.helpLimit = DEFAULT_HELP_LIMIT;
    this.timeLimitMin = 0;
    this.history = [];
    this.gameStartedAt = 0;
    this.gameTimer = null;
    this.turnTimer = null;
    this.turnEndsAt = 0;
    this.endReason = null;
    this.wordSeq = 0;
    this.chat = [];
    this.chatSeq = 0;
    this.five = null;
    this.fiveUsed = new Set();
    this.fiveForced = [];
    this.fiveHistory = [];
    this.fiveRound = 0;
    this.fiveOutSeq = 0;
    this.fiveCardSeq = 0;
    this.mode = "czolko";
    this.wave = null;
    this.waveRound = 0;
    this.waveHistory = [];
    this.usedScales = new Set();
    this.waveScale = null;
    this.waveQueue = [];
    this.waveSet = 0;
    this.settings = defaultSettings();
    this.liar = null;
    this.liarSource = "players";
    this.liarHintChance = 50;
    this.liarRound = 0;
    this.liarPool = [];
    this.liarHistory = [];
    this.lastImpostorId = null;
    this.liarMasterMode = "fixed";
    this.liarMasterPick = null;
    this.lastMasterId = null;
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

  fx(type, data = {}) {
    this.emit("fx", { type, ...data });
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

  requireMode(mode) {
    if (this.mode !== mode) fail("To nie działa w tym trybie gry");
  }

  requiredYes(voterCount) {
    return Math.max(1, Math.ceil(voterCount / 2));
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
      starred: [],
      wordsReady: false,
      liarWords: [],
      liarReady: false,
      fiveTasks: [],
      lives: 0,
      cards: [],
      fiveCurses: [],
      fiveOut: 0,
      connected: false,
      socketId: null,
      score: 0,
      helpsUsed: 0,
      word: null
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;
    this.fx("join", { playerId: player.id });
    return player;
  }

  removePlayer(player, reason) {
    if (!this.players.includes(player)) return;
    if (this.phase === "game") {
      if (this.vote && this.vote.guesserId === player.id) this.cancelVote(`Głosowanie anulowane, ${player.nick} opuszcza grę`);
      if (this.help && (this.help.askerId === player.id || this.help.helperId === player.id)) {
        this.endHelpNow(`Pomoc przerwana, ${player.nick} opuszcza grę`);
      }
      if (this.mode === "piec") this.fiveForced = this.fiveForced.filter((id) => id !== player.id);
      if (this.mode === "wskazowka") this.waveRemovePlayer(player);
      else if (this.mode === "czolko" && this.activeId === player.id) this.advanceTurn();
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
      else if (this.mode === "klamca") this.liarAfterRemoval(player);
      else if (this.mode === "piec") this.fiveAfterRemoval(player);
      else {
        this.evaluateVote();
        this.evaluateWave();
      }
    }
    this.hub.updatePresence(this);
    this.changed();
  }

  setConnected(player, connected) {
    player.connected = connected;
    if (!connected) player.socketId = null;
    this.evaluateVote();
    this.evaluateWave();
    this.evaluateFiveVote();
    this.evaluateLiarVote();
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
      if (typeof data !== "string" || !/^data:image\/(png|jpeg);base64,/.test(data)) fail("Nieprawidłowy obrazek");
      if (data.length > MAX_AVATAR_LENGTH) fail("Avatar jest za duży");
      player.avatar = data;
    }
    this.emit("avatar", player);
  }

  setPointLimit(player, value) {
    this.requireManager(player);
    const limit = Math.floor(Number(value));
    if (!Number.isFinite(limit) || limit < MIN_POINT_LIMIT || limit > MAX_POINT_LIMIT) {
      fail(`Limit musi być liczbą od ${MIN_POINT_LIMIT} do ${MAX_POINT_LIMIT}`);
    }
    this.pointLimit = limit;
    this.announce(`Limit punktów: ${limit}`);
    if (this.phase === "game" && this.players.some((p) => this.reachedLimit(p))) this.finish("limit");
    this.changed();
  }

  reachedLimit(player) {
    if (this.mode === "piec") return false;
    return !this.timeLimitMin && player.score >= this.pointLimit;
  }

  setTimeLimit(player, value) {
    this.requireManager(player);
    this.requirePhase("lobby", "game");
    const minutes = Math.floor(Number(value));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_TIME_LIMIT_MIN) {
      fail(`Czas gry musi być od 0 do ${MAX_TIME_LIMIT_MIN} minut`);
    }
    this.timeLimitMin = minutes;
    this.announce(minutes ? `Gramy na czas: ${minutes} min. Wygrywa najwięcej punktów` : `Gramy do ${this.pointLimit} pkt`);
    if (this.phase === "game") {
      this.scheduleGameEnd();
      if (this.players.some((p) => this.reachedLimit(p))) this.finish("limit");
    }
    this.changed();
  }

  gameEndsAt() {
    return this.timeLimitMin && this.gameStartedAt ? this.gameStartedAt + this.timeLimitMin * 60000 : 0;
  }

  stopGameTimer() {
    clearTimeout(this.gameTimer);
    this.gameTimer = null;
  }

  scheduleGameEnd() {
    this.stopGameTimer();
    const endsAt = this.gameEndsAt();
    if (this.phase !== "game" || !endsAt) return;
    const remaining = endsAt - Date.now();
    if (remaining <= 0) return this.finish("time");
    this.gameTimer = setTimeout(() => {
      if (this.phase !== "game") return;
      this.finish("time");
      this.announce("⏰ Koniec czasu gry!");
      this.changed();
    }, remaining);
  }

  stat(player, key) {
    if (!player.stats) player.stats = { guessed: 0, passes: 0, reveals: 0 };
    player.stats[key] += 1;
  }

  used(player, key) {
    return (player.stats && player.stats[key]) || 0;
  }

  usesLeft(player, key, limit) {
    if (limit >= UNLIMITED) return null;
    return Math.max(0, limit - this.used(player, key));
  }

  nextCost(used, free, cost) {
    return used < free ? 0 : cost;
  }

  costText(cost) {
    return cost ? `−${formatPoints(cost)}` : "za darmo";
  }

  claimHost(player) {
    if (this.hostId === player.id) fail("Już jesteś hostem");
    this.hostId = player.id;
    this.announce(`${player.nick} przejmuje hosta (hasło admina)`);
    this.changed();
  }

  setMode(player, mode) {
    this.requireManager(player);
    this.requirePhase("lobby");
    if (!MODES.includes(mode)) fail("Nieznany tryb gry");
    if (mode === this.mode) return;
    const previous = this.mode;
    this.mode = mode;
    if (this.pointLimit === MODE_DEFAULT_LIMIT[previous]) this.pointLimit = MODE_DEFAULT_LIMIT[mode];
    this.announce(`Tryb gry: ${MODE_NAMES[mode]}`);
    this.changed();
  }

  start(player) {
    this.requireManager(player);
    this.requirePhase("lobby");
    if (this.players.length < 2) fail("Potrzeba co najmniej 2 graczy");
    if (this.mode === "wskazowka" || this.mode === "piec") {
      this.beginGame();
      this.changed();
      return;
    }
    if (this.mode === "klamca") {
      if (this.liarSource === "host") {
        if (this.players.length < LIAR_MIN_PLAYERS + 1) fail("Z hostem jako prowadzącym potrzeba co najmniej 4 osób");
      } else {
        if (this.players.length < LIAR_MIN_PLAYERS) fail("Potrzeba co najmniej 3 graczy");
        const notReady = this.players.filter((p) => !p.liarReady).map((p) => p.nick);
        if (notReady.length) fail(`Brakuje haseł od: ${notReady.join(", ")}`);
      }
      this.beginGame();
      this.changed();
      return;
    }
    const missing = this.players.filter((p) => !p.wordsReady).map((p) => p.nick);
    if (missing.length) fail(`Brakuje haseł od: ${missing.join(", ")}`);
    this.beginGame();
    this.changed();
  }

  clearRounds() {
    this.clearVote();
    this.clearHelp();
    this.clearWave();
    this.clearLiar();
    this.clearFive();
  }

  beginGame() {
    this.clearRounds();
    if (this.mode === "wskazowka") return this.beginWave();
    if (this.mode === "klamca") return this.beginLiar();
    if (this.mode === "piec") return this.beginFive();
    this.beginCzolko();
  }

  finish(reason) {
    this.stopGameTimer();
    this.clearRounds();
    this.stopTurnTimer();
    if (this.phase === "game" && this.mode === "czolko") for (const p of this.players) this.record(p, "unfinished");
    const wasPlaying = this.phase === "game";
    this.phase = "end";
    this.endReason = reason;
    this.activeId = null;
    if (wasPlaying) this.fx("end", { reason });
  }

  backToLobby(player) {
    if (this.phase === "game") this.requireAdmin(player);
    this.requirePhase("game", "end");
    this.clearRounds();
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
    if (this.mode === "wskazowka") {
      this.announce("Host przechodzi do następnej rundy");
      this.waveContinue(null, true);
      this.changed();
      return;
    }
    if (this.mode === "klamca") {
      this.liarForceNext();
      this.changed();
      return;
    }
    if (this.mode === "piec") {
      this.fiveForceNext();
      this.changed();
      return;
    }
    this.cancelVote("Głosowanie przerwane przez admina");
    this.advanceTurn();
    this.announce("Admin przekazuje turę dalej");
    this.changed();
  }

  adminAdjustScore(admin, playerId, delta) {
    this.requireAdmin(admin);
    this.requirePhase("game");
    const amount = Math.trunc(Number(delta));
    if (!amount || Math.abs(amount) > 10) fail("Nieprawidłowa zmiana punktów");
    const target = this.requireTarget(playerId);
    if (this.mode === "piec") {
      target.lives = Math.max(0, target.lives + amount);
      target.fiveOut = target.lives > 0 ? 0 : target.fiveOut || ++this.fiveOutSeq;
      this.fiveSyncScore(target);
      this.announce(`Admin: ${target.nick} ${amount > 0 ? "+" : ""}${amount} ❤️`);
      if (this.fiveAlive().length <= 1) this.finish("lastAlive");
      this.changed();
      return;
    }
    target.score += amount;
    this.announce(`Admin: ${target.nick} ${amount > 0 ? "+" : ""}${amount} pkt`);
    if (this.reachedLimit(target)) this.finish("limit");
    this.changed();
  }

  kick(admin, playerId) {
    this.requireManager(admin);
    const target = this.requireTarget(playerId);
    if (target === admin) fail("Nie możesz wyrzucić siebie");
    this.removePlayer(target, "Zostałeś wyrzucony z pokoju");
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

  setSetting(player, key, rawValue) {
    this.requireManager(player);
    this.requirePhase("lobby", "game");
    const spec = SETTINGS_BY_KEY.get(key);
    if (!spec) fail("Nieznane ustawienie");
    const number = Number(rawValue);
    if (!Number.isFinite(number)) fail("Podaj liczbę");
    if (number < spec.min || number > spec.max) fail(`${spec.label}: od ${spec.min} do ${spec.max}`);
    const value = Math.round(Math.round(number / spec.step) * spec.step * 100) / 100;
    this.settings[key] = value;
    this.announce(`⚙️ ${spec.label}: ${formatPoints(value)}${this.phase === "game" && spec.startOnly ? " (od następnej gry)" : ""}`);
    this.changed();
  }

  resetSettings(player, mode) {
    this.requireManager(player);
    this.requirePhase("lobby", "game");
    const defaults = defaultSettings();
    for (const [key, spec] of SETTINGS_BY_KEY) if (!mode || spec.mode === mode) this.settings[key] = defaults[key];
    this.announce("⚙️ Przywrócono domyślne ustawienia");
    this.changed();
  }

  summary() {
    if (this.mode === "wskazowka") return this.waveSummary();
    if (this.mode === "klamca") return this.liarSummary();
    if (this.mode === "piec") return this.fiveSummary();
    return this.czolkoSummary();
  }

  turnClock() {
    const fallback = this.settings.turnSeconds * 1000;
    const playing = this.phase === "game";
    const left = (endsAt) => Math.max(0, endsAt - Date.now());
    if (this.mode === "piec") {
      const five = this.five;
      return { remaining: five && playing && five.endsAt ? left(five.endsAt) : null, total: five ? five.totalMs || 1000 : fallback };
    }
    if (this.mode === "wskazowka") {
      const wave = this.wave;
      return { remaining: wave && playing ? left(wave.endsAt) : null, total: wave ? wave.totalMs : fallback };
    }
    if (this.mode === "klamca") {
      const liar = this.liar;
      return { remaining: liar && playing && liar.endsAt ? left(liar.endsAt) : null, total: liar ? liar.totalMs || fallback : fallback };
    }
    return { remaining: this.turnEndsAt ? left(this.turnEndsAt) : null, total: fallback };
  }

  viewFor(viewer, summary) {
    const clock = this.turnClock();
    return {
      code: this.code,
      phase: this.phase,
      mode: this.mode,
      settings: this.settings,
      wave: this.waveView(viewer),
      liar: this.liarView(viewer),
      five: this.fiveView(viewer),
      liarSource: this.liarSource,
      liarMasterMode: this.liarMasterMode,
      liarMasterId: this.fixedMasterId(),
      liarHintChance: this.liarHintChance,
      pointLimit: this.pointLimit,
      helpLimit: this.helpLimit,
      timeLimitMin: this.timeLimitMin,
      gameRemainingMs: this.phase === "game" && this.gameEndsAt() ? Math.max(0, this.gameEndsAt() - Date.now()) : null,
      help: this.help
        ? { askerId: this.help.askerId, helperId: this.help.helperId, remainingMs: Math.max(0, this.help.endsAt - Date.now()) }
        : null,
      activeId: this.activeId,
      turnRemainingMs: clock.remaining,
      turnTotalMs: clock.total,
      endReason: this.endReason,
      roomRemainingMs: this.phase === "lobby" ? Math.max(0, this.expiresAt - Date.now()) : null,
      poolSize: this.pool.length,
      me: {
        id: viewer.id,
        nick: viewer.nick,
        canManage: this.canManage(viewer),
        words: viewer.words,
        starred: viewer.starred || [],
        wordsReady: viewer.wordsReady,
        nextHelpCost: this.nextCost(viewer.helpsUsed || 0, this.settings.helpFree, this.settings.helpCost),
        nextAuthorCost: this.nextCost(this.used(viewer, "reveals"), this.settings.authorFree, this.settings.authorCost),
        nextPassCost: this.nextCost(this.used(viewer, "passes"), this.settings.passFree, this.settings.passPenalty),
        authorLeft: this.usesLeft(viewer, "reveals", this.settings.authorLimit),
        liarWords: viewer.liarWords,
        fiveTasks: viewer.fiveTasks,
        liarReady: viewer.liarReady,
        cameraCode: viewer.cameraCode
      },
      players: this.players.map((p) => ({
        id: p.id,
        nick: p.nick,
        color: p.color,
        connected: p.connected,
        score: p.score,
        wordsReady: p.wordsReady,
        liarReady: p.liarReady,
        canManage: this.canManage(p),
        hasPhone: p.phoneCount > 0,
        helpsLeft: this.helpLimit >= UNLIMITED ? null : Math.max(0, this.helpLimit - p.helpsUsed),
        word: p.id !== viewer.id && p.word ? p.word.text : null,
        authorId: p.word && p.word.authorRevealed ? p.word.authorId : null,
        authorNick: p.word && p.word.authorRevealed ? this.authorName(p.word) : null,
        fiveTasks: (p.fiveTasks || []).length,
        ...this.fivePlayerView(p, viewer)
      })),
      vote: this.voteView(viewer),
      results: this.phase === "end"
        ? [...this.players]
            .sort((a, b) => b.score - a.score || (b.fiveOut || 0) - (a.fiveOut || 0))
            .map((p) => ({ id: p.id, nick: p.nick, color: p.color, score: p.score, word: p.word ? p.word.text : null }))
        : null,
      summary: this.phase === "end" ? summary || this.summary() : null
    };
  }
}

Object.assign(
  Room.prototype,
  require("../modes/czolko"),
  require("../modes/wave"),
  require("../modes/liar"),
  require("../modes/five").methods,
  require("./chat")
);

module.exports = { Room };
