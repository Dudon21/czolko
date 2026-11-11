const crypto = require("crypto");
const { fail } = require("../lib/errors");
const { later } = require("../lib/timers");
const { UNLIMITED } = require("../lib/constants");
const { findTwin, twinMessage, joinNames, formatPoints, cleanText } = require("../lib/text");
const { isAuthorOf, shuffle } = require("../lib/pool");
const { similarWords } = require("../public/match");
const { isListedWord, randomWords } = require("../data/words");

const REFILL_SIZE = 10;
const GAME_AUTHOR = "Losowanie gry";
const WORDS_PER_PLAYER = 10;
const MAX_STARRED = 2;
const MAX_WORD_LENGTH = 40;
const MAX_HELP_LIMIT = 99;

module.exports = {
  setWords(player, list, starredList) {
    this.requirePhase("lobby");
    if (!Array.isArray(list) || list.length !== WORDS_PER_PLAYER) fail(`Potrzeba dokładnie ${WORDS_PER_PLAYER} haseł`);
    const words = list.map((w) => cleanText(w, MAX_WORD_LENGTH));
    if (words.some((w) => !w)) fail(`Uzupełnij wszystkie ${WORDS_PER_PLAYER} haseł`);
    const twin = findTwin(words);
    if (twin) fail(twinMessage(twin));
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
  },

  beginCzolko() {
    this.pool = [];
    this.history = [];
    this.usedTexts = new Set();
    let merged = 0;
    for (const p of this.players) {
      p.helpsUsed = 0;
      p.stats = { guessed: 0, passes: 0, reveals: 0 };
      p.words.forEach((text, index) => {
        const starred = (p.starred || []).includes(index);
        this.usedTexts.add(text.toLocaleLowerCase("pl"));
        const twin = this.pool.find((word) => similarWords(word.text, text));
        if (twin) {
          if (!isAuthorOf(twin, p)) twin.coAuthors.push(p.id);
          twin.starred = twin.starred || starred;
          merged += 1;
          return;
        }
        this.pool.push({ id: ++this.wordSeq, text, authorId: p.id, coAuthors: [], custom: !isListedWord(text), starred });
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
    if (merged) this.announce(`🧹 Powtórzone hasła scalone w jedno: ${merged}`);
    this.announce(`Gra rozpoczęta! Zaczyna ${starter.nick}`);
  },

  stopTurnTimer() {
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnEndsAt = 0;
  },

  restartTurnTimer() {
    this.stopTurnTimer();
    if (this.mode !== "czolko" || this.phase !== "game" || this.vote || this.help || !this.activeId) return;
    const activeId = this.activeId;
    const turnMs = this.settings.turnSeconds * 1000;
    this.turnEndsAt = Date.now() + turnMs;
    this.turnTimer = later(() => {
      if (this.phase !== "game" || this.vote || this.help || this.activeId !== activeId) return;
      const player = this.getPlayer(activeId);
      this.announce(`Czas minął! ${player ? player.nick : "Gracz"} traci turę`);
      this.fx("timeout", { playerId: activeId });
      this.advanceTurn();
      this.changed();
    }, turnMs);
  },

  authorName(word) {
    if (!word.authorId) return GAME_AUTHOR;
    return joinNames([word.authorId, ...(word.coAuthors || [])].map((id) => {
      const author = this.getPlayer(id);
      return author ? author.nick : "gracz, który wyszedł";
    }));
  },

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
  },

  hasWordFor(player) {
    return this.pool.some((word) => !isAuthorOf(word, player));
  },

  drawWord(player) {
    if (!this.hasWordFor(player)) this.refillPool();
    const candidates = [];
    this.pool.forEach((word, index) => {
      if (!isAuthorOf(word, player)) candidates.push(index);
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
  },

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
  },

  requireTurn(player) {
    this.requirePhase("game");
    this.requireMode("czolko");
    if (this.activeId !== player.id) fail("To nie twoja tura");
    if (this.vote) fail("Trwa głosowanie");
  },

  next(player) {
    this.requireTurn(player);
    this.clearHelp();
    this.fx("next", { playerId: player.id });
    this.advanceTurn();
    this.changed();
  },

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
  },

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
    vote.timer = later(() => {
      if (this.vote !== vote) return;
      this.cancelVote("Czas na głosowanie minął");
      this.changed();
    }, this.settings.voteSeconds * 1000);
    this.vote = vote;
    this.stopTurnTimer();
    this.fx("voteStart", { playerId: player.id });
    this.announce(`${player.nick} mówi, że zgadł(a)! Głosujcie`);
    this.changed();
  },

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
  },

  setHelpLimit(player, value) {
    this.requireManager(player);
    const limit = Math.floor(Number(value));
    if (!Number.isFinite(limit) || limit < 0 || limit > MAX_HELP_LIMIT) fail(`Liczba pomocy musi być od 0 do ${MAX_HELP_LIMIT}`);
    this.helpLimit = limit;
    this.announce(`Pomoce na gracza: ${limit >= UNLIMITED ? "bez limitu" : limit}`);
    this.changed();
  },

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
    help.timer = later(() => {
      if (this.help !== help) return;
      this.endHelpNow("Koniec czasu na pomoc");
      this.changed();
    }, helpMs);
    this.help = help;
    this.fx("help", { playerId: player.id, helperId: helper.id });
    const cost = helpCost ? ` (−${formatPoints(helpCost)})` : "";
    this.announce(`🆘 ${player.nick} prosi o pomoc${cost}: ${helper.nick}. ${this.settings.helpSeconds} sekund rozmowy!`);
    this.changed();
  },

  endHelp(player) {
    this.requirePhase("game");
    if (!this.help) fail("Nie ma teraz pomocy");
    const involved = player.id === this.help.askerId || player.id === this.help.helperId;
    if (!involved && !this.canManage(player)) fail("Tylko uczestnicy rozmowy albo host mogą ją zakończyć");
    this.endHelpNow(`${player.nick} kończy pomoc`);
    this.changed();
  },

  endHelpNow(message) {
    if (!this.help) return;
    this.fx("helpEnd");
    this.clearHelp();
    this.restartTurnTimer();
    this.announce(message);
  },

  clearHelp() {
    if (this.help) clearTimeout(this.help.timer);
    this.help = null;
  },

  voters() {
    if (!this.vote) return [];
    return this.players.filter((p) => p.connected && p.id !== this.vote.guesserId);
  },

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
  },

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
  },

  clearVote() {
    if (this.vote) clearTimeout(this.vote.timer);
    this.vote = null;
  },

  cancelVote(message) {
    if (!this.vote) return;
    this.fx("voteFail", { playerId: this.vote.guesserId });
    this.clearVote();
    this.restartTurnTimer();
    this.announce(message);
  },

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
  },

  adminResolveVote(admin, approve) {
    this.requireAdmin(admin);
    this.requirePhase("game");
    this.requireMode("czolko");
    if (!this.vote) fail("Nie ma teraz głosowania");
    if (approve) this.succeedGuess();
    else this.cancelVote("Admin odrzuca głosowanie");
    this.changed();
  },

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
  },

  record(player, outcome) {
    const word = player.word;
    if (!word) return;
    this.history.push({
      text: word.text,
      holderId: player.id,
      holderNick: player.nick,
      authorId: word.authorId,
      coAuthorIds: word.coAuthors || [],
      authorNick: this.authorName(word),
      outcome,
      ms: Date.now() - (word.drawnAt || Date.now()),
      revealed: Boolean(word.authorRevealed),
      helps: word.helps || 0
    });
  },

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
  },

  czolkoSummary() {
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
      for (const id of [h.authorId, ...(h.coAuthorIds || [])]) {
        const author = this.getPlayer(id);
        const entry = authors.get(id) || { nick: author ? author.nick : h.authorNick, passes: 0, ms: 0, count: 0 };
        if (h.outcome === "passed") entry.passes += 1;
        entry.ms += h.ms;
        entry.count += 1;
        authors.set(id, entry);
      }
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
};
