const crypto = require("crypto");
const { EventEmitter } = require("events");
const { isListedWord, randomWords } = require("./words");
const { randomScale } = require("./scales");
const { SETTINGS_BY_KEY, defaultSettings } = require("./settings");

const MODES = ["czolko", "wskazowka", "klamca", "piec"];
const MODE_DEFAULT_LIMIT = { czolko: 5, wskazowka: 20, klamca: 10, piec: 5 };
const MODE_NAMES = { czolko: "🙈 Czółko", wskazowka: "🔮 Wskazówka", klamca: "🕵️ Kłamca", piec: "⏱️ 5 sekund" };
const LIAR_SOURCES = ["players", "host"];
const LIAR_MASTER_MODES = ["fixed", "rotate"];
const LIAR_WORDS_PER_PLAYER = 5;
const LIAR_MAX_WORD = 40;
const LIAR_MAX_HINT = 40;
const LIAR_MAX_CLUE = 30;
const LIAR_REVEAL_MS = 20000;
const LIAR_HINT_CHANCES = [0, 25, 50, 75, 100];
const LIAR_MIN_PLAYERS = 3;
const WAVE_MAX_SCALE_SIDE = 30;
const WAVE_REVEAL_MS = 15000;
const WAVE_MAX_CLUE = 60;

const REFILL_SIZE = 10;
const GAME_AUTHOR = "Losowanie gry";


const WORDS_PER_PLAYER = 10;
const MAX_STARRED = 2;
const MAX_WORD_LENGTH = 40;
const MAX_NICK_LENGTH = 16;
const MAX_PLAYERS = 12;
const DEFAULT_POINT_LIMIT = 5;
const DEFAULT_HELP_LIMIT = 1;
const MAX_HELP_LIMIT = 99;
const UNLIMITED = 99;
const MAX_TIME_LIMIT_MIN = 240;
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

const CHAT_HISTORY = 150;
const CHAT_IMAGE_HISTORY = 25;
const MAX_CHAT_TEXT = 500;
const MAX_CHAT_IMAGE = 460000;
const CHAT_IMAGE_PATTERN = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const MASK_MIN_TOKEN = 4;

function cleanMessage(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CHAT_TEXT);
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskSecret(text, secret) {
  if (!text || !secret) return text;
  const parts = [secret, ...secret.split(/[\s-]+/).filter((part) => part.length >= MASK_MIN_TOKEN)];
  const unique = [...new Set(parts.map((part) => part.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(unique.map(escapeRegex).join("|"), "giu");
  return text.replace(pattern, (match) => "█".repeat(Math.min(match.length, 12)));
}

function normalizeGuess(text) {
  return String(text || "")
    .toLocaleLowerCase("pl")
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function guessMatches(guess, answer) {
  const a = normalizeGuess(guess);
  const b = normalizeGuess(answer);
  if (!a || !b) return false;
  if (a === b) return true;
  const tolerance = b.length >= 8 ? 2 : b.length >= 4 ? 1 : 0;
  return editDistance(a, b) <= tolerance;
}

function formatPoints(value) {
  return String(Math.round(value * 10) / 10).replace(".", ",");
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

  setWords(player, list, starredList) {
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
    const starred = [...new Set(
      (Array.isArray(starredList) ? starredList : [])
        .map(Number)
        .filter((index) => Number.isInteger(index) && index >= 0 && index < WORDS_PER_PLAYER)
    )].sort((a, b) => a - b);
    if (starred.length > MAX_STARRED) fail(`Gwiazdkę możesz dać maksymalnie ${MAX_STARRED} hasłom`);
    player.words = words;
    player.starred = starred;
    if (!player.wordsReady) this.fx("ready", { playerId: player.id });
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

  record(player, outcome) {
    const word = player.word;
    if (!word) return;
    this.history.push({
      text: word.text,
      holderId: player.id,
      holderNick: player.nick,
      authorId: word.authorId,
      authorNick: this.authorName(word),
      outcome,
      ms: Date.now() - (word.drawnAt || Date.now()),
      revealed: Boolean(word.authorRevealed),
      helps: word.helps || 0
    });
  }

  stat(player, key) {
    if (!player.stats) player.stats = { guessed: 0, passes: 0, reveals: 0 };
    player.stats[key] += 1;
  }

  summary() {
    if (this.mode === "wskazowka") return this.waveSummary();
    if (this.mode === "klamca") return this.liarSummary();
    if (this.mode === "piec") return this.fiveSummary();
    const awards = [];
    const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
    const time = (ms) => {
      const total = seconds(ms);
      return total >= 60 ? `${Math.floor(total / 60)} min ${total % 60} s` : `${total} s`;
    };
    const guessed = this.history.filter((h) => h.outcome === "guessed");
    if (guessed.length) {
      const fastest = guessed.reduce((a, b) => (b.ms < a.ms ? b : a));
      awards.push({ icon: "⚡", title: "Błyskawica", text: `${fastest.holderNick} zgadł(a) „${fastest.text}” w ${time(fastest.ms)}` });
      const slowest = guessed.reduce((a, b) => (b.ms > a.ms ? b : a));
      if (slowest !== fastest) {
        awards.push({ icon: "🐢", title: "Najtrudniejsze hasło", text: `„${slowest.text}” męczył(a) ${slowest.holderNick} przez ${time(slowest.ms)}` });
      }
    }
    const top = (key, minimum) => {
      const best = this.players.filter((p) => p.stats && p.stats[key] >= minimum).sort((a, b) => b.stats[key] - a.stats[key])[0];
      return best || null;
    };
    const passer = top("passes", 1);
    if (passer) awards.push({ icon: "🙈", title: "Król Passów", text: `${passer.nick}: ${passer.stats.passes}× pass` });
    const helper = this.players.filter((p) => p.helpsUsed > 0).sort((a, b) => b.helpsUsed - a.helpsUsed)[0];
    if (helper) awards.push({ icon: "🆘", title: "Telefon do przyjaciela", text: `${helper.nick}: ${helper.helpsUsed}× pomoc` });
    const detective = top("reveals", 1);
    if (detective) awards.push({ icon: "🕵️", title: "Detektyw", text: `${detective.nick}: ${detective.stats.reveals}× odkrył(a) autora` });
    const authors = new Map();
    for (const h of this.history) {
      if (h.outcome === "rerolled" || h.outcome === "unfinished" || !h.authorId) continue;
      const entry = authors.get(h.authorId) || { nick: h.authorNick, passes: 0, ms: 0, count: 0 };
      if (h.outcome === "passed") entry.passes += 1;
      entry.ms += h.ms;
      entry.count += 1;
      authors.set(h.authorId, entry);
    }
    const evil = [...authors.values()].sort((a, b) => b.passes - a.passes || b.ms / b.count - a.ms / a.count)[0];
    if (evil && authors.size > 1) {
      awards.push({ icon: "😈", title: "Złośliwy autor", text: `Hasła od ${evil.nick} szły najgorzej (${evil.passes}× pass, średnio ${time(evil.ms / evil.count)})` });
    }
    const history = this.history.map((h) => ({
      text: h.text,
      holderId: h.holderId,
      holderNick: h.holderNick,
      authorNick: h.authorNick,
      outcome: h.outcome,
      seconds: seconds(h.ms),
      helps: h.helps,
      revealed: h.revealed
    }));
    return { awards, history, totalGuessed: guessed.length };
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

  revealAuthor(player) {
    this.requireTurn(player);
    if (!player.word) fail("Nie masz teraz hasła");
    if (player.word.authorRevealed) fail("Autor jest już odkryty");
    const limit = this.settings.authorLimit;
    if (limit === 0) fail("Odkrywanie autora jest wyłączone");
    if (this.usesLeft(player, "reveals", limit) === 0) fail("Wykorzystałeś już limit odkryć autora");
    const cost = this.nextCost(this.used(player, "reveals"), this.settings.authorFree, this.settings.authorCost);
    const authorNick = this.authorName(player.word);
    player.word.authorRevealed = true;
    player.score -= cost;
    this.stat(player, "reveals");
    this.fx("author", { playerId: player.id });
    this.announce(`🕵️ ${player.nick} odkrywa autora hasła (${this.costText(cost)}): ${authorNick}`);
    this.changed();
  }

  setHelpLimit(player, value) {
    this.requireManager(player);
    const limit = Math.floor(Number(value));
    if (!Number.isFinite(limit) || limit < 0 || limit > MAX_HELP_LIMIT) fail(`Liczba pomocy musi być od 0 do ${MAX_HELP_LIMIT}`);
    this.helpLimit = limit;
    this.announce(`Pomoce na gracza: ${limit >= UNLIMITED ? "bez limitu" : limit}`);
    this.changed();
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

  requireMode(mode) {
    if (this.mode !== mode) fail("To nie działa w tym trybie gry");
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

  beginGame() {
    this.clearVote();
    this.clearHelp();
    this.clearWave();
    this.clearLiar();
    this.clearFive();
    if (this.mode === "wskazowka") return this.beginWave();
    if (this.mode === "klamca") return this.beginLiar();
    if (this.mode === "piec") return this.beginFive();
    this.pool = [];
    this.history = [];
    this.usedTexts = new Set();
    for (const p of this.players) {
      p.helpsUsed = 0;
      p.stats = { guessed: 0, passes: 0, reveals: 0 };
      p.words.forEach((text, index) => {
        this.pool.push({ id: ++this.wordSeq, text, authorId: p.id, custom: !isListedWord(text), starred: (p.starred || []).includes(index) });
        this.usedTexts.add(text.toLocaleLowerCase("pl"));
      });
      p.score = 0;
      p.word = null;
    }
    shuffle(this.pool);
    this.phase = "game";
    this.endReason = null;
    this.gameStartedAt = Date.now();
    this.scheduleGameEnd();
    const starters = this.players.filter((p) => p.connected);
    const starter = (starters.length ? starters : this.players)[crypto.randomInt(starters.length || this.players.length)];
    this.activeId = starter.id;
    for (const p of this.players) {
      if (!this.drawWord(p)) return this.finish("pool");
    }
    this.restartTurnTimer();
    this.hub.scheduleExpiry(this);
    this.fx("start", { playerId: starter.id });
    this.announce(`Gra rozpoczęta! Zaczyna ${starter.nick}`);
  }

  stopTurnTimer() {
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnEndsAt = 0;
  }

  restartTurnTimer() {
    this.stopTurnTimer();
    if (this.mode !== "czolko" || this.phase !== "game" || this.vote || this.help || !this.activeId) return;
    const activeId = this.activeId;
    const turnMs = this.settings.turnSeconds * 1000;
    this.turnEndsAt = Date.now() + turnMs;
    this.turnTimer = setTimeout(() => {
      if (this.phase !== "game" || this.vote || this.help || this.activeId !== activeId) return;
      const player = this.getPlayer(activeId);
      this.announce(`Czas minął! ${player ? player.nick : "Gracz"} traci turę`);
      this.fx("timeout", { playerId: activeId });
      this.advanceTurn();
      this.changed();
    }, turnMs);
  }

  authorName(word) {
    if (!word.authorId) return GAME_AUTHOR;
    const author = this.getPlayer(word.authorId);
    return author ? author.nick : "gracz, który wyszedł";
  }

  refillPool() {
    if (!this.usedTexts) this.usedTexts = new Set();
    const fresh = randomWords(REFILL_SIZE, [...this.usedTexts]);
    for (const text of fresh) {
      this.pool.push({ id: ++this.wordSeq, text, authorId: null, custom: false });
      this.usedTexts.add(text.toLocaleLowerCase("pl"));
    }
    if (fresh.length) this.fx("refill");
    if (fresh.length) this.announce(`🎲 Pula się skończyła, dorzucam ${fresh.length} haseł z losowania`);
    return fresh.length > 0;
  }

  hasWordFor(player) {
    return this.pool.some((word) => word.authorId !== player.id);
  }

  drawWord(player) {
    if (!this.hasWordFor(player)) this.refillPool();
    const candidates = [];
    this.pool.forEach((word, index) => {
      if (word.authorId !== player.id) candidates.push(index);
    });
    if (!candidates.length) {
      player.word = null;
      return false;
    }
    const starred = candidates.filter((index) => this.pool[index].starred);
    const custom = candidates.filter((index) => this.pool[index].custom);
    const listed = candidates.filter((index) => !this.pool[index].custom);
    let group = candidates;
    if (starred.length) group = starred;
    else if (custom.length && listed.length) group = crypto.randomInt(100) < this.settings.customChance ? custom : listed;
    const index = group[crypto.randomInt(group.length)];
    player.word = this.pool.splice(index, 1)[0];
    player.word.drawnAt = Date.now();
    player.word.authorRevealed = false;
    player.word.helps = 0;
    return true;
  }

  advanceTurn() {
    if (this.mode === "wskazowka") return this.nextWaveRound();
    this.clearHelp();
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
    this.fx("turn", { playerId: next.id });
  }

  requireTurn(player) {
    this.requirePhase("game");
    this.requireMode("czolko");
    if (this.activeId !== player.id) fail("To nie twoja tura");
    if (this.vote) fail("Trwa głosowanie");
  }

  next(player) {
    this.requireTurn(player);
    this.clearHelp();
    this.fx("next", { playerId: player.id });
    this.advanceTurn();
    this.changed();
  }

  pass(player) {
    this.requireTurn(player);
    this.clearHelp();
    const word = player.word;
    const penalty = this.nextCost(this.used(player, "passes"), this.settings.passFree, this.settings.passPenalty);
    this.record(player, "passed");
    this.stat(player, "passes");
    player.score -= penalty;
    player.word = null;
    this.announce(`${player.nick} pasuje (${this.costText(penalty)}). Hasło: ${word ? word.text : "?"}`);
    this.fx("pass", { playerId: player.id });
    this.emit("wordChanged", player, "passed", word ? word.text : "");
    if (!this.drawWord(player)) this.finish("pool");
    else this.restartTurnTimer();
    this.changed();
  }

  guess(player) {
    this.requireTurn(player);
    this.clearHelp();
    const vote = {
      guesserId: player.id,
      yes: new Set(),
      no: new Set(),
      endsAt: Date.now() + this.settings.voteSeconds * 1000,
      timer: null
    };
    vote.timer = setTimeout(() => {
      if (this.vote !== vote) return;
      this.cancelVote("Czas na głosowanie minął");
      this.changed();
    }, this.settings.voteSeconds * 1000);
    this.vote = vote;
    this.stopTurnTimer();
    this.fx("voteStart", { playerId: player.id });
    this.announce(`${player.nick} mówi, że zgadł(a)! Głosujcie`);
    this.changed();
  }

  requestHelp(player, helperId) {
    this.requireTurn(player);
    if (this.help) fail("Pomoc już trwa");
    if (this.helpLimit === 0) fail("Pomoce są wyłączone");
    if (this.helpLimit < UNLIMITED && player.helpsUsed >= this.helpLimit) fail("Wykorzystałeś już wszystkie pomoce");
    const helper = this.requireTarget(helperId);
    if (helper === player) fail("Wybierz innego gracza");
    if (!helper.connected) fail("Ten gracz jest offline");
    const helpCost = this.nextCost(player.helpsUsed, this.settings.helpFree, this.settings.helpCost);
    player.helpsUsed += 1;
    player.score -= helpCost;
    if (player.word) player.word.helps = (player.word.helps || 0) + 1;
    this.stopTurnTimer();
    const helpMs = this.settings.helpSeconds * 1000;
    const help = { askerId: player.id, helperId: helper.id, endsAt: Date.now() + helpMs, timer: null };
    help.timer = setTimeout(() => {
      if (this.help !== help) return;
      this.endHelpNow("Koniec czasu na pomoc");
      this.changed();
    }, helpMs);
    this.help = help;
    this.fx("help", { playerId: player.id, helperId: helper.id });
    const cost = helpCost ? ` (−${formatPoints(helpCost)})` : "";
    this.announce(`🆘 ${player.nick} prosi o pomoc${cost}: ${helper.nick}. ${this.settings.helpSeconds} sekund rozmowy!`);
    this.changed();
  }

  endHelp(player) {
    this.requirePhase("game");
    if (!this.help) fail("Nie ma teraz pomocy");
    const involved = player.id === this.help.askerId || player.id === this.help.helperId;
    if (!involved && !this.canManage(player)) fail("Tylko uczestnicy rozmowy albo host mogą ją zakończyć");
    this.endHelpNow(`${player.nick} kończy pomoc`);
    this.changed();
  }

  endHelpNow(message) {
    if (!this.help) return;
    this.fx("helpEnd");
    this.clearHelp();
    this.restartTurnTimer();
    this.announce(message);
  }

  clearHelp() {
    if (this.help) clearTimeout(this.help.timer);
    this.help = null;
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
    this.fx("voteFail", { playerId: this.vote.guesserId });
    this.clearVote();
    this.restartTurnTimer();
    this.announce(message);
  }

  succeedGuess() {
    const guesser = this.vote && this.getPlayer(this.vote.guesserId);
    this.clearVote();
    if (!guesser) return;
    const word = guesser.word;
    this.record(guesser, "guessed");
    this.stat(guesser, "guessed");
    guesser.score += this.settings.guessPoints;
    guesser.word = null;
    this.announce(`${guesser.nick} zgaduje! (+${formatPoints(this.settings.guessPoints)}) Hasło: ${word ? word.text : "?"}`);
    this.fx("guessed", { playerId: guesser.id });
    this.emit("wordChanged", guesser, "guessed", word ? word.text : "");
    if (this.reachedLimit(guesser)) return this.finish("limit");
    if (!this.drawWord(guesser)) return this.finish("pool");
    this.advanceTurn();
  }

  finish(reason) {
    this.stopGameTimer();
    this.clearVote();
    this.clearHelp();
    this.clearWave();
    this.clearLiar();
    this.clearFive();
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
    this.clearVote();
    this.clearHelp();
    this.clearWave();
    this.clearLiar();
    this.clearFive();
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

  adminResolveVote(admin, approve) {
    this.requireAdmin(admin);
    this.requirePhase("game");
    this.requireMode("czolko");
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

  adminRerollWord(admin, playerId) {
    this.requireAdmin(admin);
    this.requirePhase("game");
    this.requireMode("czolko");
    const target = this.requireTarget(playerId);
    if (!this.hasWordFor(target) && !this.refillPool()) fail("Nie ma już żadnych haseł do wylosowania");
    if (this.vote && this.vote.guesserId === target.id) this.cancelVote("Głosowanie anulowane, nowe hasło");
    this.record(target, "rerolled");
    this.drawWord(target);
    this.announce(`Host losuje nowe hasło dla gracza ${target.nick}`);
    this.fx("reroll", { playerId: target.id });
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

  beginWave() {
    this.pool = [];
    this.history = [];
    this.waveHistory = [];
    this.waveRound = 0;
    this.waveSet = 0;
    this.waveScale = null;
    this.waveQueue = [];
    this.usedScales = new Set();
    for (const p of this.players) {
      p.score = 0;
      p.word = null;
      p.helpsUsed = 0;
      p.stats = { guessed: 0, passes: 0, reveals: 0 };
    }
    this.phase = "game";
    this.endReason = null;
    this.gameStartedAt = Date.now();
    this.scheduleGameEnd();
    this.hub.scheduleExpiry(this);
    const starters = this.players.filter((p) => p.connected);
    const list = starters.length ? starters : this.players;
    const starter = list[crypto.randomInt(list.length)];
    this.fx("start", { playerId: starter.id });
    this.announce(`🔮 Wskazówka! Pierwszą skalę wymyśla ${starter.nick}`);
    this.startScaleStage(starter);
  }

  startScaleStage(author) {
    this.clearWave();
    this.waveSet += 1;
    this.waveScale = null;
    this.waveQueue = [];
    this.activeId = author.id;
    const wave = {
      round: this.waveRound,
      set: this.waveSet,
      stage: "scale",
      scaleAuthorId: author.id,
      psychicId: null,
      scale: null,
      target: null,
      clue: null,
      guesses: new Map(),
      locked: new Set(),
      results: null,
      psychicPoints: 0,
      endsAt: Date.now() + this.settings.waveScaleSeconds * 1000,
      totalMs: this.settings.waveScaleSeconds * 1000,
      timer: null
    };
    wave.timer = setTimeout(() => {
      if (this.wave !== wave || wave.stage !== "scale") return;
      const scale = randomScale(this.usedScales);
      this.announce(`Czas minął! Losuję skalę: ${scale.left} ↔ ${scale.right}`);
      this.applyScale(author, scale);
      this.changed();
    }, this.settings.waveScaleSeconds * 1000);
    this.wave = wave;
    this.fx("turn", { playerId: author.id });
  }

  suggestScale() {
    return randomScale(this.usedScales);
  }

  waveSetScale(player, rawLeft, rawRight) {
    this.requireWaveStage("scale");
    if (this.wave.scaleAuthorId !== player.id) fail("Teraz skalę wymyśla ktoś inny");
    const left = cleanText(rawLeft, WAVE_MAX_SCALE_SIDE);
    const right = cleanText(rawRight, WAVE_MAX_SCALE_SIDE);
    if (!left || !right) fail("Wpisz oba końce skali");
    if (textKey(left) === textKey(right)) fail("Końce skali muszą się różnić");
    this.announce(`✍️ ${player.nick} wymyśla skalę: ${left} ↔ ${right}`);
    this.applyScale(player, { left, right });
    this.changed();
  }

  applyScale(author, scale) {
    this.waveScale = { left: scale.left, right: scale.right, authorId: author.id, authorNick: author.nick };
    const count = this.players.length;
    const start = Math.max(0, this.players.findIndex((p) => p.id === author.id));
    this.waveQueue = [];
    for (let i = 0; i < count; i++) this.waveQueue.push(this.players[(start + i) % count].id);
    this.fx("waveScale", { playerId: author.id });
    this.nextWaveRound();
  }

  randomTarget() {
    return crypto.randomInt(101);
  }

  startWaveRound(psychic) {
    this.clearWave();
    this.waveRound += 1;
    this.activeId = psychic.id;
    const wave = {
      round: this.waveRound,
      set: this.waveSet,
      scaleAuthorId: this.waveScale.authorId,
      psychicId: psychic.id,
      scale: { left: this.waveScale.left, right: this.waveScale.right },
      target: this.randomTarget(),
      clue: null,
      stage: "clue",
      guesses: new Map(),
      locked: new Set(),
      results: null,
      psychicPoints: 0,
      endsAt: Date.now() + this.settings.waveClueSeconds * 1000,
      totalMs: this.settings.waveClueSeconds * 1000,
      timer: null
    };
    wave.timer = setTimeout(() => {
      if (this.wave !== wave || wave.stage !== "clue") return;
      this.announce(`Czas minął! ${psychic.nick} nie podał(a) podpowiedzi`);
      this.fx("timeout", { playerId: psychic.id });
      this.nextWaveRound();
      this.changed();
    }, this.settings.waveClueSeconds * 1000);
    this.wave = wave;
    this.fx("turn", { playerId: psychic.id });
  }

  nextWaveRound() {
    const count = this.players.length;
    if (!count || this.phase !== "game") return;
    while (this.waveScale && this.waveQueue.length) {
      const candidate = this.getPlayer(this.waveQueue.shift());
      if (candidate && candidate.connected) return this.startWaveRound(candidate);
    }
    const lastAuthor = this.waveScale ? this.waveScale.authorId : this.activeId;
    const start = Math.max(0, this.players.findIndex((p) => p.id === lastAuthor));
    let next = null;
    for (let i = 1; i <= count; i++) {
      const candidate = this.players[(start + i) % count];
      if (candidate.connected) {
        next = candidate;
        break;
      }
    }
    if (!next) next = this.players[(start + 1) % count];
    this.startScaleStage(next);
  }

  clearWave() {
    if (this.wave) clearTimeout(this.wave.timer);
    this.wave = null;
  }

  requireWaveStage(stage) {
    this.requirePhase("game");
    this.requireMode("wskazowka");
    if (!this.wave || this.wave.stage !== stage) fail("To teraz niedostępne");
  }

  waveSetClue(player, rawClue) {
    this.requireWaveStage("clue");
    const wave = this.wave;
    if (wave.psychicId !== player.id) fail("Teraz podpowiada ktoś inny");
    const clue = cleanText(rawClue, WAVE_MAX_CLUE);
    if (!clue) fail("Wpisz podpowiedź");
    clearTimeout(wave.timer);
    wave.clue = clue;
    wave.stage = "guess";
    wave.endsAt = Date.now() + this.settings.waveGuessSeconds * 1000;
    wave.totalMs = this.settings.waveGuessSeconds * 1000;
    wave.timer = setTimeout(() => {
      if (this.wave !== wave || wave.stage !== "guess") return;
      this.waveReveal();
      this.changed();
    }, this.settings.waveGuessSeconds * 1000);
    this.fx("waveClue", { playerId: player.id });
    this.announce(`🔮 ${player.nick}: „${clue}”. Ustawiajcie wskazówki!`);
    this.changed();
  }

  cleanDial(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) fail("Nieprawidłowa pozycja");
    return Math.round(Math.max(0, Math.min(100, number)) * 10) / 10;
  }

  waveMove(player, value) {
    this.requireWaveStage("guess");
    const wave = this.wave;
    if (wave.psychicId === player.id) fail("Podpowiadający nie zgaduje");
    if (wave.locked.has(player.id)) return;
    const first = !wave.guesses.has(player.id);
    wave.guesses.set(player.id, this.cleanDial(value));
    this.emit("waveLive", wave.psychicId, { playerId: player.id, value: wave.guesses.get(player.id), locked: false });
    if (first) this.changed();
  }

  waveLock(player, value, locked) {
    this.requireWaveStage("guess");
    const wave = this.wave;
    if (wave.psychicId === player.id) fail("Podpowiadający nie zgaduje");
    if (locked) {
      if (value !== undefined && value !== null) wave.guesses.set(player.id, this.cleanDial(value));
      if (!wave.guesses.has(player.id)) fail("Najpierw ustaw wskazówkę");
      wave.locked.add(player.id);
      this.emit("waveLive", wave.psychicId, { playerId: player.id, value: wave.guesses.get(player.id), locked: true });
    } else {
      wave.locked.delete(player.id);
    }
    this.evaluateWave();
    this.changed();
  }

  waveGuessers() {
    if (!this.wave) return [];
    return this.players.filter((p) => p.connected && p.id !== this.wave.psychicId);
  }

  evaluateWave() {
    const wave = this.wave;
    if (!wave || this.phase !== "game" || this.mode !== "wskazowka" || wave.stage !== "guess") return;
    const guessers = this.waveGuessers();
    if (guessers.length && guessers.every((p) => wave.locked.has(p.id))) this.waveReveal();
  }

  wavePoints(value, target) {
    if (value === null || value === undefined) return 0;
    if (Math.round(value) === target) return this.settings.wavePerfect;
    const distance = Math.abs(value - target);
    const bands = [[4, this.settings.waveBull], [11, this.settings.waveNear], [18, this.settings.waveFar]];
    for (const [limit, points] of bands) if (distance <= limit) return points;
    return 0;
  }

  waveReveal() {
    const wave = this.wave;
    if (!wave || wave.stage !== "guess") return;
    clearTimeout(wave.timer);
    const results = [];
    for (const p of this.players) {
      if (p.id === wave.psychicId) continue;
      const value = wave.guesses.has(p.id) ? wave.guesses.get(p.id) : null;
      const points = this.wavePoints(value, wave.target);
      p.score += points;
      const distance = value === null ? null : Math.abs(value - wave.target);
      results.push({ id: p.id, nick: p.nick, color: p.color, value, points, distance, perfect: value !== null && Math.round(value) === wave.target, bull: distance !== null && distance <= 4, near: distance !== null && distance <= 11 });
    }
    const psychic = this.getPlayer(wave.psychicId);
    const psychicPoints = Math.min(this.settings.wavePsychicMax, results.filter((r) => r.near).length);
    if (psychic) psychic.score += psychicPoints;
    wave.results = results.sort((a, b) => b.points - a.points || (a.distance ?? 999) - (b.distance ?? 999));
    wave.psychicPoints = psychicPoints;
    wave.stage = "reveal";
    wave.endsAt = Date.now() + WAVE_REVEAL_MS;
    wave.totalMs = WAVE_REVEAL_MS;
    this.waveHistory.push({
      round: wave.round,
      set: wave.set,
      scaleAuthorNick: this.waveScale ? this.waveScale.authorNick : "?",
      psychicId: wave.psychicId,
      psychicNick: psychic ? psychic.nick : "?",
      left: wave.scale.left,
      right: wave.scale.right,
      clue: wave.clue,
      target: wave.target,
      psychicPoints,
      results: wave.results.map((r) => ({ ...r }))
    });
    wave.timer = setTimeout(() => {
      if (this.wave !== wave) return;
      this.waveContinue(null, true);
      this.changed();
    }, WAVE_REVEAL_MS);
    const best = wave.results[0];
    this.fx("waveReveal", { playerId: wave.psychicId, bullseye: Boolean(best && best.bull), perfect: wave.results.some((r) => r.perfect) });
    this.announce(`🎯 Odsłona! Cel: ${Math.round(wave.target)}. ${psychic ? psychic.nick : "Podpowiadający"} +${psychicPoints}`);
  }

  waveContinue(player, force) {
    this.requirePhase("game");
    this.requireMode("wskazowka");
    const wave = this.wave;
    if (!force) {
      if (!wave || wave.stage !== "reveal") fail("To teraz niedostępne");
      if (player.id !== wave.psychicId && !this.canManage(player)) fail("Dalej może kliknąć podpowiadający albo host");
    }
    if (this.players.some((p) => this.reachedLimit(p))) {
      this.finish("limit");
      return;
    }
    this.nextWaveRound();
  }

  waveRemovePlayer(player) {
    const wave = this.wave;
    this.waveQueue = this.waveQueue.filter((id) => id !== player.id);
    if (!wave) return;
    wave.guesses.delete(player.id);
    wave.locked.delete(player.id);
    if (wave.stage === "scale" && wave.scaleAuthorId === player.id) {
      this.announce(`${player.nick} wychodzi, skalę wymyśli ktoś inny`);
      this.nextWaveRound();
    } else if (wave.psychicId === player.id && wave.stage !== "reveal") {
      this.announce(`${player.nick} wychodzi w trakcie podpowiadania`);
      this.nextWaveRound();
    }
  }

  waveView(viewer) {
    const wave = this.wave;
    if (this.mode !== "wskazowka" || !wave) return null;
    const isPsychic = viewer.id === wave.psychicId;
    const revealed = wave.stage === "reveal";
    const queueTotal = this.players.length;
    const turnsLeft = this.waveQueue.filter((id) => this.getPlayer(id)).length;
    return {
      round: wave.round,
      set: wave.set,
      scaleAuthorId: wave.scaleAuthorId,
      turnOnScale: wave.stage === "scale" ? 0 : Math.max(1, queueTotal - turnsLeft),
      turnsOnScale: queueTotal,
      psychicId: wave.psychicId,
      left: wave.scale ? wave.scale.left : null,
      right: wave.scale ? wave.scale.right : null,
      clue: wave.clue,
      stage: wave.stage,
      target: isPsychic || revealed ? wave.target : null,
      myGuess: wave.guesses.has(viewer.id) ? wave.guesses.get(viewer.id) : null,
      myLocked: wave.locked.has(viewer.id),
      live: isPsychic && wave.stage === "guess" ? [...wave.guesses.entries()].map(([id, value]) => ({ id, value })) : null,
      locked: [...wave.locked],
      touched: [...wave.guesses.keys()],
      guessers: this.waveGuessers().length,
      results: revealed ? wave.results : null,
      psychicPoints: revealed ? wave.psychicPoints : 0,
      remainingMs: Math.max(0, wave.endsAt - Date.now()),
      totalMs: wave.totalMs
    };
  }

  waveSummary() {
    const awards = [];
    const hits = this.waveHistory.flatMap((round) => round.results.filter((r) => r.value !== null).map((r) => ({ ...r, round })));
    if (hits.length) {
      const sniper = hits.reduce((a, b) => (b.distance < a.distance ? b : a));
      awards.push({ icon: "🎯", title: "Snajper", text: `${sniper.nick} trafił(a) najbliżej celu przy „${sniper.round.clue}”` });
      const wild = hits.reduce((a, b) => (b.distance > a.distance ? b : a));
      if (wild !== sniper && wild.distance > 25) {
        awards.push({ icon: "🚀", title: "Strzał w kosmos", text: `${wild.nick} pomylił(a) się najbardziej przy „${wild.round.clue}”` });
      }
    }
    const psychics = new Map();
    for (const round of this.waveHistory) {
      const entry = psychics.get(round.psychicId) || { nick: round.psychicNick, points: 0, rounds: 0 };
      entry.points += round.psychicPoints;
      entry.rounds += 1;
      psychics.set(round.psychicId, entry);
    }
    const telepath = [...psychics.values()].sort((a, b) => b.points - a.points)[0];
    if (telepath && telepath.points > 0) {
      awards.push({ icon: "🔮", title: "Telepata", text: `${telepath.nick}: ${telepath.points} pkt za podpowiedzi` });
    }
    const bullseyes = new Map();
    for (const hit of hits) if (hit.bull) bullseyes.set(hit.nick, (bullseyes.get(hit.nick) || 0) + 1);
    const bestEye = [...bullseyes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (bestEye) awards.push({ icon: "👁️", title: "Sokole oko", text: `${bestEye[0]}: ${bestEye[1]}× w sam środek` });
    const perfect = hits.find((hit) => hit.perfect);
    if (perfect) awards.push({ icon: "💯", title: "Perfekcja", text: `${perfect.nick} trafił(a) idealnie przy „${perfect.round.clue}”` });
    return {
      mode: "wskazowka",
      awards,
      history: [],
      rounds: this.waveHistory.map((round) => ({
        set: round.set,
        scaleAuthorNick: round.scaleAuthorNick,
        psychicNick: round.psychicNick,
        left: round.left,
        right: round.right,
        clue: round.clue,
        target: round.target,
        psychicPoints: round.psychicPoints,
        results: round.results.map((r) => ({ nick: r.nick, color: r.color, value: r.value, points: r.points }))
      })),
      totalGuessed: 0
    };
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

  setLiarSettings(player, settings) {
    this.requireManager(player);
    const { source, hintChance, masterMode } = settings || {};
    if (masterMode !== undefined) {
      if (!LIAR_MASTER_MODES.includes(masterMode)) fail("Nieznany tryb prowadzącego");
      this.liarMasterMode = masterMode;
      this.announce(masterMode === "rotate" ? "Kłamca: prowadzący zmienia się co rundę" : "Kłamca: stały prowadzący");
    }
    if (source !== undefined) {
      this.requirePhase("lobby");
      if (!LIAR_SOURCES.includes(source)) fail("Nieznane źródło haseł");
      this.liarSource = source;
      this.announce(source === "host" ? "Kłamca: hasła wpisuje host" : "Kłamca: każdy wpisuje 5 haseł");
    }
    if (hintChance !== undefined) {
      const chance = Number(hintChance);
      if (!LIAR_HINT_CHANCES.includes(chance)) fail("Nieprawidłowa szansa na podpowiedź");
      this.liarHintChance = chance;
      this.announce(`Szansa na podpowiedź dla kłamcy: ${chance}%`);
    }
    this.changed();
  }

  fixedMasterId() {
    const picked = this.liarMasterPick && this.getPlayer(this.liarMasterPick);
    return picked ? picked.id : this.hostId;
  }

  nextRotatingMasterId() {
    const count = this.players.length;
    if (!count) return null;
    const start = this.players.findIndex((p) => p.id === this.lastMasterId);
    for (let i = 1; i <= count; i++) {
      const candidate = this.players[(Math.max(-1, start) + i + count) % count];
      if (candidate.connected) return candidate.id;
    }
    return this.players[0].id;
  }

  liarChooseMaster(player, targetId) {
    this.requireMode("klamca");
    if (this.liarSource !== "host") fail("Prowadzący jest tylko w wariancie „Wpisuje host”");
    if (this.liarMasterMode !== "fixed") fail("Przy zmianie co rundę prowadzący wybiera się sam");
    const isRoundMaster = Boolean(this.liar && this.liar.masterId === player.id);
    if (!this.canManage(player) && !isRoundMaster) fail("Prowadzącego wybiera host albo obecny prowadzący");
    const target = this.requireTarget(targetId);
    this.liarMasterPick = target.id;
    const liar = this.liar;
    if (this.phase === "game" && liar && liar.stage === "setup") {
      liar.masterId = target.id;
      this.activeId = target.id;
      this.lastMasterId = target.id;
      this.fx("turn", { playerId: target.id });
      this.announce(`🎬 Teraz prowadzi ${target.nick}`);
    } else {
      this.announce(this.phase === "game" ? `🎬 Od następnej rundy prowadzi ${target.nick}` : `🎬 Prowadzi ${target.nick}`);
    }
    this.changed();
  }

  setLiarWords(player, entries) {
    this.requirePhase("lobby");
    if (!Array.isArray(entries) || entries.length !== LIAR_WORDS_PER_PLAYER) fail(`Potrzeba dokładnie ${LIAR_WORDS_PER_PLAYER} haseł`);
    const cleaned = entries.map((entry) => ({
      word: cleanText(entry && entry.word, LIAR_MAX_WORD),
      hint: cleanText(entry && entry.hint, LIAR_MAX_HINT)
    }));
    if (cleaned.some((entry) => !entry.word || !entry.hint)) fail("Uzupełnij wszystkie hasła i podpowiedzi");
    const seen = new Set();
    for (const entry of cleaned) {
      const key = textKey(entry.word);
      if (seen.has(key)) fail(`Hasło „${entry.word}” się powtarza`);
      seen.add(key);
      if (guessMatches(entry.hint, entry.word)) fail(`Podpowiedź do „${entry.word}” nie może być samym hasłem`);
    }
    if (!player.liarReady) this.fx("ready", { playerId: player.id });
    player.liarWords = cleaned;
    player.liarReady = true;
    this.changed();
  }

  liarMasterId() {
    return this.liarSource === "host" ? this.hostId : null;
  }

  liarParticipants() {
    const masterId = this.liar ? this.liar.masterId : this.liarMasterId();
    return this.players.filter((p) => p.id !== masterId);
  }

  clearLiar() {
    if (this.liar) clearTimeout(this.liar.timer);
    this.liar = null;
  }

  liarSchedule(ms, callback) {
    const liar = this.liar;
    clearTimeout(liar.timer);
    liar.endsAt = ms ? Date.now() + ms : 0;
    liar.totalMs = ms || 0;
    liar.timer = ms
      ? setTimeout(() => {
          if (this.liar !== liar) return;
          callback();
          this.changed();
        }, ms)
      : null;
  }

  beginLiar() {
    this.history = [];
    this.liarHistory = [];
    this.liarRound = 0;
    this.lastImpostorId = null;
    this.lastMasterId = null;
    this.liarPool = [];
    for (const p of this.players) {
      p.score = 0;
      p.word = null;
      p.helpsUsed = 0;
      p.stats = { guessed: 0, passes: 0, reveals: 0 };
      if (this.liarSource === "players") {
        for (const entry of p.liarWords) this.liarPool.push({ word: entry.word, hint: entry.hint, authorId: p.id });
      }
    }
    shuffle(this.liarPool);
    this.phase = "game";
    this.endReason = null;
    this.gameStartedAt = Date.now();
    this.scheduleGameEnd();
    this.hub.scheduleExpiry(this);
    this.fx("start", { playerId: this.hostId });
    this.announce(this.liarSource === "host" ? "🕵️ Kłamca! Host prowadzi grę" : "🕵️ Kłamca! Hasła losowane z waszych");
    this.startLiarRound();
  }

  pickImpostor(candidates) {
    const pool = candidates.length > 1 ? candidates.filter((p) => p.id !== this.lastImpostorId) : candidates;
    return pool[crypto.randomInt(pool.length)];
  }

  startLiarRound() {
    this.clearLiar();
    if (this.phase !== "game") return;
    this.liarRound += 1;
    if (this.liarSource === "host") {
      const masterId = this.liarMasterMode === "rotate" && this.lastMasterId ? this.nextRotatingMasterId() : this.liarMasterMode === "rotate" ? this.hostId : this.fixedMasterId();
      const master = this.getPlayer(masterId);
      this.lastMasterId = master ? master.id : null;
      if (master && this.liarMasterMode === "rotate") this.announce(`🎬 W tej rundzie prowadzi ${master.nick}`);
      this.liar = this.newLiarState({ masterId: master ? master.id : null, stage: "setup" });
      this.activeId = master ? master.id : null;
      if (master) this.fx("turn", { playerId: master.id });
      return;
    }
    const connected = this.players.filter((p) => p.connected);
    if (connected.length < LIAR_MIN_PLAYERS) return this.finish("players");
    const order = shuffle([...connected]).sort((a, b) => (a.id === this.lastImpostorId) - (b.id === this.lastImpostorId));
    for (const candidate of order) {
      const options = this.liarPool.map((entry, index) => ({ entry, index })).filter((o) => o.entry.authorId !== candidate.id);
      if (!options.length) continue;
      const choice = options[crypto.randomInt(options.length)];
      this.liarPool.splice(choice.index, 1);
      this.liar = this.newLiarState({ masterId: null, stage: "clues" });
      return this.beginClues(choice.entry.word, choice.entry.hint, candidate, choice.entry.authorId);
    }
    this.finish("pool");
  }

  newLiarState({ masterId, stage }) {
    return {
      round: this.liarRound,
      stage,
      masterId,
      word: null,
      hint: null,
      hintGiven: false,
      impostorId: null,
      authorId: null,
      order: [],
      turn: 0,
      lap: 1,
      clues: [],
      votes: new Map(),
      meetings: [],
      ejectedId: null,
      wrongEject: false,
      judges: new Map(),
      caught: false,
      guess: null,
      guessCorrect: false,
      escaped: false,
      results: null,
      endsAt: 0,
      totalMs: 0,
      timer: null
    };
  }

  liarSetup(player, rawWord, rawHint) {
    this.requirePhase("game");
    this.requireMode("klamca");
    const liar = this.liar;
    if (!liar || liar.stage !== "setup") fail("To teraz niedostępne");
    if (liar.masterId !== player.id) fail("Hasło wpisuje prowadzący");
    const word = cleanText(rawWord, LIAR_MAX_WORD);
    const hint = cleanText(rawHint, LIAR_MAX_HINT);
    if (!word) fail("Wpisz hasło");
    if (hint && guessMatches(hint, word)) fail("Podpowiedź nie może być samym hasłem");
    const candidates = this.liarParticipants().filter((p) => p.connected);
    if (candidates.length < LIAR_MIN_PLAYERS) fail("Za mało połączonych graczy");
    this.beginClues(word, hint, this.pickImpostor(candidates), player.id);
    this.changed();
  }

  beginClues(word, hint, impostor, authorId) {
    const liar = this.liar;
    liar.word = word;
    liar.hint = hint || null;
    liar.hintGiven = Boolean(hint) && crypto.randomInt(100) < this.liarHintChance;
    liar.impostorId = impostor.id;
    liar.authorId = authorId;
    this.lastImpostorId = impostor.id;
    const order = shuffle(this.liarParticipants().filter((p) => p.connected).map((p) => p.id));
    if (order[0] === impostor.id && order.length > 1) {
      const swap = 1 + crypto.randomInt(order.length - 1);
      [order[0], order[swap]] = [order[swap], order[0]];
    }
    liar.order = order;
    liar.turn = 0;
    liar.stage = "clues";
    this.fx("liarRound", { round: liar.round });
    this.announce(`🕵️ Runda ${liar.round}! Jeden z was nie zna hasła…`);
    this.startClueTurn();
  }

  liarSpeakerId() {
    const liar = this.liar;
    if (!liar || liar.stage !== "clues" || !liar.order.length) return null;
    return liar.order[liar.turn % liar.order.length];
  }

  startClueTurn() {
    const liar = this.liar;
    const total = liar.order.length * liar.lap;
    while (liar.turn < total) {
      const speaker = this.getPlayer(this.liarSpeakerId());
      if (speaker && speaker.connected) break;
      if (speaker) liar.clues.push({ playerId: speaker.id, text: "—", lap: liar.lap, skipped: true });
      liar.turn += 1;
    }
    if (liar.turn >= total) return this.startLiarVote();
    const speakerId = this.liarSpeakerId();
    this.activeId = speakerId;
    this.liarSchedule(this.settings.liarClueSeconds * 1000, () => {
      const speaker = this.getPlayer(speakerId);
      liar.clues.push({ playerId: speakerId, text: "—", lap: liar.lap, skipped: true });
      if (speaker) this.announce(`${speaker.nick} nie zdążył(a) ze słowem`);
      liar.turn += 1;
      this.startClueTurn();
    });
    this.fx("turn", { playerId: speakerId });
  }

  liarClue(player, rawText) {
    this.requirePhase("game");
    this.requireMode("klamca");
    const liar = this.liar;
    if (!liar || liar.stage !== "clues") fail("To teraz niedostępne");
    if (this.liarSpeakerId() !== player.id) fail("Teraz mówi ktoś inny");
    const text = cleanText(rawText, LIAR_MAX_CLUE);
    if (!text) fail("Wpisz słowo");
    if (guessMatches(text, liar.word) || normalizeGuess(text).includes(normalizeGuess(liar.word))) fail("Nie możesz podać samego hasła 😉");
    liar.clues.push({ playerId: player.id, text, lap: liar.lap, skipped: false });
    liar.turn += 1;
    this.startClueTurn();
    this.changed();
  }

  liarEndVote(player) {
    this.requirePhase("game");
    this.requireMode("klamca");
    const liar = this.liar;
    if (!liar || !["vote", "judge"].includes(liar.stage)) fail("To teraz niedostępne");
    if (!this.canManage(player) && liar.masterId !== player.id) fail("Głosowanie może zakończyć host");
    if (liar.stage === "vote") this.resolveLiarVote();
    else this.resolveLiarJudge();
    this.changed();
  }

  startLiarVote() {
    const liar = this.liar;
    liar.stage = "vote";
    liar.votes = new Map();
    this.activeId = null;
    this.fx("liarVote");
    this.announce(`🗳️ Koniec kółka ${liar.lap}! Gadajcie i głosujcie: kto kłamie? Albo pomińcie`);
    this.liarSchedule(this.settings.liarVoteSeconds * 1000, () => this.resolveLiarVote());
  }

  liarVoters() {
    return this.liarParticipants().filter((p) => p.connected);
  }

  liarVote(player, targetId) {
    this.requirePhase("game");
    this.requireMode("klamca");
    const liar = this.liar;
    if (!liar || liar.stage !== "vote") fail("Teraz nie ma głosowania");
    if (player.id === liar.masterId) fail("Prowadzący nie głosuje");
    if (!this.liarVoters().includes(player)) fail("Nie głosujesz w tej rundzie");
    if (targetId === "skip") {
      liar.votes.set(player.id, "skip");
      this.evaluateLiarVote();
      this.changed();
      return;
    }
    const target = this.requireTarget(targetId);
    if (target === player) fail("Nie możesz głosować na siebie");
    if (target.id === liar.masterId) fail("Prowadzący nie jest podejrzanym");
    liar.votes.set(player.id, target.id);
    this.evaluateLiarVote();
    this.changed();
  }

  evaluateLiarVote() {
    const liar = this.liar;
    if (!liar || this.phase !== "game" || this.mode !== "klamca" || liar.stage !== "vote") return;
    const voters = this.liarVoters();
    if (voters.length && voters.every((p) => liar.votes.has(p.id))) this.resolveLiarVote();
  }

  tallyLiarVotes(votes = this.liar.votes) {
    const counts = new Map();
    for (const [voterId, targetId] of votes) {
      if (!this.getPlayer(voterId)) continue;
      if (targetId !== "skip" && !this.getPlayer(targetId)) continue;
      counts.set(targetId, (counts.get(targetId) || 0) + 1);
    }
    return counts;
  }

  resolveLiarVote() {
    const liar = this.liar;
    if (!liar || liar.stage !== "vote") return;
    const counts = this.tallyLiarVotes();
    const best = Math.max(0, ...counts.values());
    const leaders = [...counts.entries()].filter(([, count]) => count === best).map(([id]) => id);
    const ejectedId = best > 0 && leaders.length === 1 && leaders[0] !== "skip" ? leaders[0] : null;
    liar.meetings.push({ lap: liar.lap, votes: [...liar.votes.entries()], counts: [...counts.entries()], ejectedId });
    if (!ejectedId) {
      const skips = counts.get("skip") || 0;
      const reason = best === 0 ? "nikt nie zagłosował" : leaders.length > 1 ? "remis" : `${skips}× pominięcie`;
      if (liar.lap >= this.settings.liarLaps) {
        this.announce(`⏭️ Nikt nie wylatuje (${reason}). To było ostatnie kółko!`);
        return this.finishLiarRound();
      }
      liar.lap += 1;
      liar.votes = new Map();
      liar.stage = "clues";
      this.fx("liarSkip");
      this.announce(`⏭️ Nikt nie wylatuje (${reason}). Kółko ${liar.lap}/${this.settings.liarLaps}, kolejne słowa!`);
      return this.startClueTurn();
    }
    liar.ejectedId = ejectedId;
    const ejected = this.getPlayer(ejectedId);
    if (ejectedId !== liar.impostorId) {
      liar.wrongEject = true;
      this.announce(`😱 Wyrzuciliście ${ejected ? ejected.nick : "?"}, a to nie był kłamca!`);
      return this.finishLiarRound();
    }
    liar.caught = true;
    const impostor = this.getPlayer(liar.impostorId);
    if (impostor && impostor.connected) {
      liar.stage = "guess";
      this.activeId = impostor.id;
      this.fx("liarCaught", { playerId: impostor.id });
      this.announce(`🎯 Złapany! ${impostor.nick} był(a) kłamcą. Ma ${this.settings.liarGuessSeconds} s, żeby zgadnąć hasło!`);
      this.liarSchedule(this.settings.liarGuessSeconds * 1000, () => {
        this.announce(`⌛ ${impostor.nick} nie zdążył(a) zgadnąć`);
        this.finishLiarRound();
      });
      return;
    }
    this.finishLiarRound();
  }

  liarGuess(player, rawText) {
    this.requirePhase("game");
    this.requireMode("klamca");
    const liar = this.liar;
    if (!liar || liar.stage !== "guess") fail("To teraz niedostępne");
    if (liar.impostorId !== player.id) fail("Zgaduje tylko kłamca");
    const text = cleanText(rawText, LIAR_MAX_WORD);
    liar.guess = text || "🗣️ na głos";
    liar.guessTyped = Boolean(text);
    liar.stage = "judge";
    liar.judges = new Map();
    this.activeId = null;
    this.fx("voteStart", { playerId: player.id });
    this.announce(text ? `🤔 ${player.nick} strzela: „${text}”. Zaliczacie?` : `🤔 ${player.nick} zgadł(a) na głos. Zaliczacie?`);
    this.liarSchedule(this.settings.liarJudgeSeconds * 1000, () => this.resolveLiarJudge());
    this.changed();
  }

  liarJudgeIds() {
    const liar = this.liar;
    const ids = this.liarParticipants().filter((p) => p.connected && p.id !== liar.impostorId).map((p) => p.id);
    const master = liar.masterId && this.getPlayer(liar.masterId);
    if (master && master.connected) ids.push(master.id);
    return ids;
  }

  liarJudge(player, approve) {
    this.requirePhase("game");
    this.requireMode("klamca");
    const liar = this.liar;
    if (!liar || liar.stage !== "judge") fail("Teraz nie ma oceny");
    if (!this.liarJudgeIds().includes(player.id)) fail("Nie oceniasz tego strzału");
    liar.judges.set(player.id, Boolean(approve));
    const judges = this.liarJudgeIds();
    const yes = judges.filter((id) => liar.judges.get(id) === true).length;
    const no = judges.filter((id) => liar.judges.get(id) === false).length;
    const required = this.requiredYes(judges.length);
    if (yes >= required || no > judges.length - required || judges.every((id) => liar.judges.has(id))) this.resolveLiarJudge();
    this.changed();
  }

  resolveLiarJudge() {
    const liar = this.liar;
    if (!liar || liar.stage !== "judge") return;
    const judges = this.liarJudgeIds();
    const cast = judges.filter((id) => liar.judges.has(id));
    const yes = cast.filter((id) => liar.judges.get(id)).length;
    liar.guessCorrect = cast.length ? yes >= this.requiredYes(judges.length) : liar.guessTyped && guessMatches(liar.guess, liar.word);
    this.finishLiarRound();
  }

  finishLiarRound() {
    const liar = this.liar;
    if (!liar || liar.stage === "reveal") return;
    const points = new Map();
    const add = (id, value) => points.set(id, (points.get(id) || 0) + value);
    const participants = this.liarParticipants();
    if (!liar.escaped) {
      const cfg = this.settings;
      const crewCount = participants.filter((p) => p.id !== liar.impostorId).length;
      if (liar.wrongEject) add(liar.impostorId, crewCount);
      else if (!liar.caught) add(liar.impostorId, cfg.liarSurvive);
      else if (liar.guessCorrect) add(liar.impostorId, cfg.liarSaved);
      else for (const p of participants) if (p.id !== liar.impostorId) add(p.id, cfg.liarCaughtCrew);
      if (cfg.liarVoteBonus) for (const [voterId, targetId] of liar.votes) if (targetId === liar.impostorId && voterId !== liar.impostorId) add(voterId, cfg.liarVoteBonus);
    }
    for (const [id, value] of points) {
      const player = this.getPlayer(id);
      if (player) player.score += value;
    }
    const impostor = this.getPlayer(liar.impostorId);
    liar.results = participants.map((p) => ({
      id: p.id,
      nick: p.nick,
      color: p.color,
      points: points.get(p.id) || 0,
      votedFor: liar.votes.get(p.id) || null,
      impostor: p.id === liar.impostorId
    })).sort((a, b) => b.points - a.points);
    liar.stage = "reveal";
    this.activeId = null;
    const allVotes = liar.meetings.flatMap((meeting) => meeting.votes).filter(([, targetId]) => targetId !== "skip");
    const counts = this.tallyLiarVotes(allVotes);
    const ejected = liar.ejectedId ? this.getPlayer(liar.ejectedId) : null;
    this.liarHistory.push({
      round: liar.round,
      word: liar.word,
      hint: liar.hint,
      hintGiven: liar.hintGiven,
      impostorId: liar.impostorId,
      impostorNick: impostor ? impostor.nick : "?",
      caught: liar.caught,
      escaped: liar.escaped,
      wrongEject: liar.wrongEject,
      ejectedNick: ejected ? ejected.nick : null,
      laps: liar.lap,
      guess: liar.guess,
      guessCorrect: liar.guessCorrect,
      votes: allVotes,
      counts: [...counts.entries()],
      clues: liar.clues.map((clue) => ({ ...clue, nick: (this.getPlayer(clue.playerId) || { nick: "?" }).nick }))
    });
    this.fx("liarReveal", { caught: liar.caught, guessed: liar.guessCorrect, escaped: liar.escaped });
    let text;
    if (liar.escaped) text = "Kłamca uciekł z gry!";
    else if (liar.wrongEject) text = `😈 ${impostor ? impostor.nick : "?"} był(a) kłamcą i zgarnia punkty! Hasło: ${liar.word}`;
    else if (!liar.caught) text = `😈 Kłamca ${impostor ? impostor.nick : "?"} wygrywa! Hasło: ${liar.word}`;
    else if (liar.guessCorrect) text = `😏 ${impostor ? impostor.nick : "?"} zgadł(a) hasło „${liar.word}” i ratuje się!`;
    else text = `🎉 Kłamca złapany! Hasło: ${liar.word}`;
    this.announce(text);
    this.liarSchedule(LIAR_REVEAL_MS, () => this.liarContinue(null, true));
  }

  liarContinue(player, force) {
    this.requirePhase("game");
    this.requireMode("klamca");
    const liar = this.liar;
    if (!force) {
      if (!liar || liar.stage !== "reveal") fail("To teraz niedostępne");
      if (!this.canManage(player) && liar.masterId !== player.id) fail("Dalej może kliknąć host");
    }
    if (this.players.some((p) => this.reachedLimit(p))) return this.finish("limit");
    this.startLiarRound();
  }

  liarForceNext() {
    const liar = this.liar;
    if (!liar) return this.startLiarRound();
    clearTimeout(liar.timer);
    if (liar.stage === "setup") fail("Prowadzący musi najpierw wpisać hasło");
    if (liar.stage === "clues") {
      liar.clues.push({ playerId: this.liarSpeakerId(), text: "—", lap: liar.lap, skipped: true });
      liar.turn += 1;
      this.announce("Host pomija gracza");
      return this.startClueTurn();
    }
    if (liar.stage === "vote") return this.resolveLiarVote();
    if (liar.stage === "guess") return this.finishLiarRound();
    if (liar.stage === "judge") return this.resolveLiarJudge();
    return this.liarContinue(null, true);
  }

  liarAfterRemoval(player) {
    const liar = this.liar;
    if (!liar) return;
    liar.votes.delete(player.id);
    for (const [voterId, targetId] of [...liar.votes]) if (targetId === player.id) liar.votes.delete(voterId);
    if (this.liarParticipants().filter((p) => p.connected).length < LIAR_MIN_PLAYERS && liar.stage !== "reveal") {
      return this.finish("players");
    }
    if (liar.stage === "setup" && liar.masterId === player.id) return this.startLiarRound();
    if (liar.impostorId === player.id && liar.stage !== "reveal") {
      liar.escaped = true;
      return this.finishLiarRound();
    }
    if (liar.stage === "clues" && this.liarSpeakerId() === player.id) {
      liar.turn += 1;
      return this.startClueTurn();
    }
    if (liar.stage === "vote") this.evaluateLiarVote();
    if (liar.stage === "judge" && liar.judges.size && this.liarJudgeIds().every((id) => liar.judges.has(id))) this.resolveLiarJudge();
  }

  liarView(viewer) {
    const liar = this.liar;
    if (this.mode !== "klamca" || !liar) return null;
    const isMaster = viewer.id === liar.masterId;
    const isImpostor = viewer.id === liar.impostorId;
    const revealed = liar.stage === "reveal";
    const started = liar.stage !== "setup";
    return {
      round: liar.round,
      stage: liar.stage,
      masterId: liar.masterId,
      speakerId: this.liarSpeakerId(),
      role: isMaster ? "master" : !started ? null : isImpostor ? "impostor" : "crew",
      word: started && (!isImpostor || revealed) ? liar.word : null,
      hint: isMaster || revealed || (isImpostor && liar.hintGiven) ? liar.hint : null,
      hintGiven: isMaster || revealed || isImpostor ? liar.hintGiven : null,
      impostorId: isMaster || revealed || isImpostor || liar.stage === "guess" || liar.stage === "judge" ? liar.impostorId : null,
      authorId: revealed ? liar.authorId : null,
      order: liar.order,
      lap: liar.lap,
      laps: this.settings.liarLaps,
      clues: liar.clues,
      voted: [...liar.votes.keys()],
      voters: this.liarVoters().length,
      canVote: this.liarVoters().includes(viewer),
      myVote: liar.votes.get(viewer.id) || null,
      votes: revealed ? [...liar.votes.entries()] : null,
      meetings: liar.meetings.map((meeting) => ({ lap: meeting.lap, counts: meeting.counts, ejectedId: meeting.ejectedId })),
      ejectedId: liar.ejectedId,
      wrongEject: revealed ? liar.wrongEject : null,
      judgeGuess: liar.stage === "judge" ? liar.guess : null,
      judged: liar.stage === "judge" ? [...liar.judges.keys()] : [],
      judgeCount: liar.stage === "judge" ? this.liarJudgeIds().length : 0,
      canJudge: liar.stage === "judge" && this.liarJudgeIds().includes(viewer.id),
      myJudge: liar.judges.has(viewer.id) ? liar.judges.get(viewer.id) : null,
      caught: revealed || liar.stage === "guess" ? liar.caught : null,
      guess: revealed ? liar.guess : null,
      guessCorrect: revealed ? liar.guessCorrect : null,
      escaped: revealed ? liar.escaped : null,
      results: revealed ? liar.results : null,
      remainingMs: liar.endsAt ? Math.max(0, liar.endsAt - Date.now()) : null,
      totalMs: liar.totalMs
    };
  }

  liarSummary() {
    const awards = [];
    const survived = new Map();
    const detectives = new Map();
    const suspects = new Map();
    const nickOf = (id) => (this.getPlayer(id) || { nick: "?" }).nick;
    for (const round of this.liarHistory) {
      if (round.escaped) continue;
      if (round.wrongEject || !round.caught || round.guessCorrect) survived.set(round.impostorNick, (survived.get(round.impostorNick) || 0) + 1);
      for (const [voterId, targetId] of round.votes) {
        if (targetId === round.impostorId) detectives.set(nickOf(voterId), (detectives.get(nickOf(voterId)) || 0) + 1);
      }
      for (const [targetId, count] of round.counts) {
        if (targetId !== round.impostorId) suspects.set(nickOf(targetId), (suspects.get(nickOf(targetId)) || 0) + count);
      }
    }
    const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0];
    const liarKing = top(survived);
    if (liarKing) awards.push({ icon: "😈", title: "Mistrz kłamstwa", text: `${liarKing[0]}: ${liarKing[1]}× wywinął(a) się jako kłamca` });
    const detective = top(detectives);
    if (detective) awards.push({ icon: "🔍", title: "Detektyw", text: `${detective[0]}: ${detective[1]}× wskazał(a) kłamcę` });
    const suspect = top(suspects);
    if (suspect) awards.push({ icon: "😬", title: "Podejrzany z urzędu", text: `${suspect[0]}: ${suspect[1]} głosów, choć był(a) niewinny(a)` });
    return {
      mode: "klamca",
      awards,
      history: [],
      liarRounds: this.liarHistory.map((round) => ({
        round: round.round,
        word: round.word,
        hint: round.hint,
        hintGiven: round.hintGiven,
        impostorNick: round.impostorNick,
        caught: round.caught,
        escaped: round.escaped,
        wrongEject: round.wrongEject,
        ejectedNick: round.ejectedNick,
        laps: round.laps,
        guess: round.guess,
        guessCorrect: round.guessCorrect,
        clues: round.clues.filter((clue) => !clue.skipped).map((clue) => ({ nick: clue.nick, text: clue.text }))
      })),
      totalGuessed: 0
    };
  }

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
  }

  chatVisibleTo(viewer, message) {
    return !message.toId || message.fromId === viewer.id || message.toId === viewer.id;
  }

  chatSecretFor(viewer) {
    if (this.phase !== "game") return null;
    if (this.mode === "klamca") {
      const liar = this.liar;
      return liar && liar.word && liar.impostorId === viewer.id && liar.stage !== "reveal" ? liar.word : null;
    }
    return viewer.word ? viewer.word.text : null;
  }

  chatViewFor(viewer, message) {
    const secret = this.chatSecretFor(viewer);
    return { ...message, text: message.fromId === viewer.id ? message.text : maskSecret(message.text, secret) };
  }

  chatHistoryFor(viewer) {
    return this.chat.filter((m) => this.chatVisibleTo(viewer, m)).map((m) => this.chatViewFor(viewer, m));
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
      turnRemainingMs: this.mode === "piec"
        ? (this.five && this.phase === "game" && this.five.endsAt ? Math.max(0, this.five.endsAt - Date.now()) : null)
        : this.mode === "wskazowka"
        ? (this.wave && this.phase === "game" ? Math.max(0, this.wave.endsAt - Date.now()) : null)
        : this.mode === "klamca"
          ? (this.liar && this.phase === "game" && this.liar.endsAt ? Math.max(0, this.liar.endsAt - Date.now()) : null)
          : this.turnEndsAt ? Math.max(0, this.turnEndsAt - Date.now()) : null,
      turnTotalMs: this.mode === "piec" && this.five
        ? this.five.totalMs || 1000
        : this.mode === "wskazowka" && this.wave
        ? this.wave.totalMs
        : this.mode === "klamca" && this.liar ? this.liar.totalMs || this.settings.turnSeconds * 1000 : this.settings.turnSeconds * 1000,
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
      summary: this.phase === "end" ? this.summary() : null
    };
  }
}

Object.assign(Room.prototype, require("./five")({ fail, cleanText, textKey }));

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
    room.clearHelp();
    room.clearWave();
    room.clearLiar();
    room.stopTurnTimer();
    room.stopGameTimer();
    this.rooms.delete(room.code);
  }
}

module.exports = { Registry, GameError, fail };
