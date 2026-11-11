const crypto = require("crypto");
const { fail } = require("../lib/errors");
const { later } = require("../lib/timers");
const { joinNames, cleanText, textKey } = require("../lib/text");
const { normalizeGuess } = require("../public/match");
const { QUESTIONS } = require("../data/kto-questions");

const KTO_MIN_PLAYERS = 3;
const KTO_MAX_QUESTIONS = 20;
const KTO_MAX_QUESTION = 140;
const KTO_REVEAL_MS = 12000;
const KTO_OWN_CHANCE = 50;

const questionKey = (text) => normalizeGuess(text) || textKey(text);

const methods = {
  setKtoQuestions(player, rawQuestions) {
    this.requirePhase("lobby");
    if (!Array.isArray(rawQuestions)) fail("Nieprawidłowa lista pytań");
    const seen = new Set();
    const questions = [];
    for (const raw of rawQuestions) {
      const text = cleanText(raw, KTO_MAX_QUESTION);
      if (!text || seen.has(questionKey(text))) continue;
      seen.add(questionKey(text));
      questions.push(text);
    }
    if (questions.length > KTO_MAX_QUESTIONS) fail(`Maksymalnie ${KTO_MAX_QUESTIONS} pytań`);
    player.ktoQuestions = questions;
    this.changed();
  },

  clearKto() {
    if (this.kto) clearTimeout(this.kto.timer);
    this.kto = null;
  },

  ktoJoin(player) {
    player.ktoStats = { hits: 0, picked: 0, received: 0 };
  },

  beginKto() {
    this.history = [];
    this.ktoHistory = [];
    this.ktoRound = 0;
    this.ktoUsed = new Set();
    for (const p of this.players) {
      p.score = 0;
      p.word = null;
      p.helpsUsed = 0;
      p.stats = { guessed: 0, passes: 0, reveals: 0 };
      this.ktoJoin(p);
    }
    this.phase = "game";
    this.endReason = null;
    this.gameStartedAt = Date.now();
    this.scheduleGameEnd();
    this.hub.scheduleExpiry(this);
    this.fx("start", { playerId: this.hostId });
    this.announce("🫵 Kto z nas? Głosujcie na osobę, punkt za trafienie w większość");
    this.startKtoRound();
  },

  drawKtoQuestion() {
    const seen = new Set();
    const all = [];
    const add = (text, authorId) => {
      const key = questionKey(text);
      if (seen.has(key)) return;
      seen.add(key);
      all.push({ text, authorId, key });
    };
    for (const p of this.players) for (const text of p.ktoQuestions || []) add(text, p.id);
    for (const text of QUESTIONS) add(text, null);
    let fresh = all.filter((question) => !this.ktoUsed.has(question.key));
    if (!fresh.length) {
      this.ktoUsed.clear();
      this.announce("♻️ Wszystkie pytania już były, losujemy od nowa");
      fresh = all;
    }
    const own = fresh.filter((question) => question.authorId);
    const listed = fresh.filter((question) => !question.authorId);
    let pool = fresh;
    if (own.length && listed.length) pool = crypto.randomInt(100) < KTO_OWN_CHANCE ? own : listed;
    const question = pool[crypto.randomInt(pool.length)];
    this.ktoUsed.add(question.key);
    return question;
  },

  ktoSchedule(ms, callback) {
    const kto = this.kto;
    clearTimeout(kto.timer);
    kto.endsAt = Date.now() + ms;
    kto.totalMs = ms;
    kto.timer = later(() => {
      if (this.kto !== kto) return;
      callback();
      this.changed();
    }, ms);
  },

  startKtoRound() {
    this.clearKto();
    if (this.phase !== "game") return;
    if (this.players.length < KTO_MIN_PLAYERS) return this.finish("players");
    this.ktoRound += 1;
    const question = this.drawKtoQuestion();
    const author = question.authorId && this.getPlayer(question.authorId);
    this.kto = {
      round: this.ktoRound,
      stage: "vote",
      question: question.text,
      authorNick: author ? author.nick : null,
      votes: new Map(),
      results: null,
      winnerIds: [],
      endsAt: 0,
      totalMs: 0,
      timer: null
    };
    this.activeId = null;
    this.fx("ktoRound", { round: this.ktoRound });
    this.ktoSchedule(this.settings.ktoVoteSeconds * 1000, () => this.resolveKto());
  },

  requireKto(stage) {
    this.requirePhase("game");
    this.requireMode("kto");
    const kto = this.kto;
    if (!kto || kto.stage !== stage) fail("To teraz niedostępne");
    return kto;
  },

  ktoVoters() {
    return this.players.filter((p) => p.connected);
  },

  ktoVote(player, targetId) {
    const kto = this.requireKto("vote");
    const target = this.requireTarget(targetId);
    kto.votes.set(player.id, target.id);
    this.evaluateKto();
    this.changed();
  },

  evaluateKto() {
    const kto = this.kto;
    if (!kto || this.phase !== "game" || this.mode !== "kto" || kto.stage !== "vote") return;
    const voters = this.ktoVoters();
    if (voters.length && voters.every((p) => kto.votes.has(p.id))) this.resolveKto();
  },

  resolveKto() {
    const kto = this.kto;
    if (!kto || kto.stage !== "vote") return;
    clearTimeout(kto.timer);
    const counts = new Map();
    const valid = [...kto.votes].filter(([voterId, targetId]) => this.getPlayer(voterId) && this.getPlayer(targetId));
    for (const [, targetId] of valid) counts.set(targetId, (counts.get(targetId) || 0) + 1);
    const best = Math.max(0, ...counts.values());
    const winnerIds = best ? [...counts.entries()].filter(([, count]) => count === best).map(([id]) => id) : [];
    const gains = new Map();
    for (const [voterId, targetId] of valid) {
      const voter = this.getPlayer(voterId);
      const target = this.getPlayer(targetId);
      target.ktoStats.received += 1;
      if (!winnerIds.includes(targetId)) continue;
      voter.score += this.settings.ktoPoints;
      voter.ktoStats.hits += 1;
      gains.set(voterId, this.settings.ktoPoints);
    }
    for (const id of winnerIds) this.getPlayer(id).ktoStats.picked += 1;
    kto.winnerIds = winnerIds;
    kto.results = this.players
      .map((p) => ({
        id: p.id,
        nick: p.nick,
        color: p.color,
        votes: counts.get(p.id) || 0,
        winner: winnerIds.includes(p.id),
        votedFor: kto.votes.has(p.id) && this.getPlayer(kto.votes.get(p.id)) ? kto.votes.get(p.id) : null,
        points: gains.get(p.id) || 0
      }))
      .sort((a, b) => b.votes - a.votes);
    kto.stage = "reveal";
    const winners = joinNames(winnerIds.map((id) => this.getPlayer(id).nick));
    this.ktoHistory.push({
      round: kto.round,
      question: kto.question,
      authorNick: kto.authorNick,
      winners,
      best,
      total: valid.length,
      counts: kto.results.filter((r) => r.votes > 0).map((r) => ({ nick: r.nick, votes: r.votes }))
    });
    this.fx("ktoReveal", { ids: winnerIds });
    this.announce(best ? `🫵 ${winners}: ${best} z ${valid.length} głosów` : "🫵 Nikt nie zagłosował");
    this.ktoSchedule(KTO_REVEAL_MS, () => this.ktoContinue(null, true));
  },

  ktoContinue(player, force) {
    this.requirePhase("game");
    this.requireMode("kto");
    const kto = this.kto;
    if (!force) {
      if (!kto || kto.stage !== "reveal") fail("To teraz niedostępne");
      if (!this.canManage(player)) fail("Dalej może kliknąć host");
    }
    if (this.players.some((p) => this.reachedLimit(p))) return this.finish("limit");
    this.startKtoRound();
  },

  ktoForceNext() {
    const kto = this.kto;
    if (!kto) return this.startKtoRound();
    if (kto.stage === "vote") return this.resolveKto();
    return this.ktoContinue(null, true);
  },

  ktoAfterRemoval(player) {
    const kto = this.kto;
    if (this.players.length < KTO_MIN_PLAYERS) return this.finish("players");
    if (!kto) return;
    kto.votes.delete(player.id);
    for (const [voterId, targetId] of [...kto.votes]) if (targetId === player.id) kto.votes.delete(voterId);
    this.evaluateKto();
  },

  ktoView(viewer) {
    const kto = this.kto;
    if (this.mode !== "kto" || !kto) return null;
    const revealed = kto.stage === "reveal";
    return {
      round: kto.round,
      stage: kto.stage,
      question: kto.question,
      authorNick: revealed ? kto.authorNick : null,
      voted: [...kto.votes.keys()],
      voters: this.ktoVoters().length,
      myVote: kto.votes.get(viewer.id) || null,
      results: revealed ? kto.results : null,
      winnerIds: revealed ? kto.winnerIds : [],
      remainingMs: kto.endsAt ? Math.max(0, kto.endsAt - Date.now()) : null,
      totalMs: kto.totalMs
    };
  },

  ktoSummary() {
    const awards = [];
    const top = (key) => [...this.players].filter((p) => p.ktoStats && p.ktoStats[key] > 0).sort((a, b) => b.ktoStats[key] - a.ktoStats[key])[0];
    const star = top("picked");
    if (star) awards.push({ icon: "🫵", title: "Gwiazda wieczoru", text: `${star.nick}: ${star.ktoStats.picked}× wskazany(a) przez większość` });
    const reader = top("hits");
    if (reader) awards.push({ icon: "🧠", title: "Czyta w myślach", text: `${reader.nick}: ${reader.ktoStats.hits}× z większością` });
    const magnet = top("received");
    if (magnet && magnet !== star) awards.push({ icon: "🧲", title: "Magnes na głosy", text: `${magnet.nick}: ${magnet.ktoStats.received} głosów łącznie` });
    const played = this.players.filter((p) => p.ktoStats);
    const loner = [...played].sort((a, b) => a.ktoStats.hits - b.ktoStats.hits)[0];
    if (loner && loner !== reader && this.ktoHistory.length >= 3) {
      awards.push({ icon: "🦄", title: "Indywidualista", text: `${loner.nick}: tylko ${loner.ktoStats.hits}× z większością` });
    }
    return {
      mode: "kto",
      awards,
      history: [],
      ktoRounds: this.ktoHistory.map((round) => ({ ...round })),
      totalGuessed: 0
    };
  }
};

module.exports = { methods, KTO_MIN_PLAYERS };
