const crypto = require("crypto");
const { fail } = require("../lib/errors");
const { cleanText, textKey } = require("../lib/text");
const { randomScale } = require("../data/scales");

const WAVE_MAX_SCALE_SIDE = 30;
const WAVE_REVEAL_MS = 15000;
const WAVE_MAX_CLUE = 60;

module.exports = {
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
  },

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
  },

  suggestScale() {
    return randomScale(this.usedScales);
  },

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
  },

  applyScale(author, scale) {
    this.waveScale = { left: scale.left, right: scale.right, authorId: author.id, authorNick: author.nick };
    const count = this.players.length;
    const start = Math.max(0, this.players.findIndex((p) => p.id === author.id));
    this.waveQueue = [];
    for (let i = 0; i < count; i++) this.waveQueue.push(this.players[(start + i) % count].id);
    this.fx("waveScale", { playerId: author.id });
    this.nextWaveRound();
  },

  randomTarget() {
    return crypto.randomInt(101);
  },

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
  },

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
  },

  clearWave() {
    if (this.wave) clearTimeout(this.wave.timer);
    this.wave = null;
  },

  requireWaveStage(stage) {
    this.requirePhase("game");
    this.requireMode("wskazowka");
    if (!this.wave || this.wave.stage !== stage) fail("To teraz niedostępne");
  },

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
  },

  cleanDial(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) fail("Nieprawidłowa pozycja");
    return Math.round(Math.max(0, Math.min(100, number)) * 10) / 10;
  },

  waveMove(player, value) {
    this.requireWaveStage("guess");
    const wave = this.wave;
    if (wave.psychicId === player.id) fail("Podpowiadający nie zgaduje");
    if (wave.locked.has(player.id)) return;
    const first = !wave.guesses.has(player.id);
    wave.guesses.set(player.id, this.cleanDial(value));
    this.emit("waveLive", wave.psychicId, { playerId: player.id, value: wave.guesses.get(player.id), locked: false });
    if (first) this.changed();
  },

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
  },

  waveGuessers() {
    if (!this.wave) return [];
    return this.players.filter((p) => p.connected && p.id !== this.wave.psychicId);
  },

  evaluateWave() {
    const wave = this.wave;
    if (!wave || this.phase !== "game" || this.mode !== "wskazowka" || wave.stage !== "guess") return;
    const guessers = this.waveGuessers();
    if (guessers.length && guessers.every((p) => wave.locked.has(p.id))) this.waveReveal();
  },

  wavePoints(value, target) {
    if (value === null || value === undefined) return 0;
    if (Math.round(value) === target) return this.settings.wavePerfect;
    const distance = Math.abs(value - target);
    const bands = [[4, this.settings.waveBull], [11, this.settings.waveNear], [18, this.settings.waveFar]];
    for (const [limit, points] of bands) if (distance <= limit) return points;
    return 0;
  },

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
  },

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
  },

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
  },

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
  },

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
};
