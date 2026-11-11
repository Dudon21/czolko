const crypto = require("crypto");
const { fail } = require("../lib/errors");
const { later } = require("../lib/timers");
const { LIAR_MIN_PLAYERS } = require("../lib/constants");
const { findTwin, twinMessage, cleanText, joinNames } = require("../lib/text");
const { isAuthorOf, shuffle } = require("../lib/pool");
const { normalizeGuess, guessMatches, similarWords } = require("../public/match");

const LIAR_SOURCES = ["players", "host"];
const LIAR_MASTER_MODES = ["fixed", "rotate"];
const LIAR_WORDS_PER_PLAYER = 5;
const LIAR_MAX_WORD = 40;
const LIAR_MAX_HINT = 40;
const LIAR_MAX_CLUE = 30;
const LIAR_REVEAL_MS = 20000;
const LIAR_HINT_CHANCES = [0, 25, 50, 75, 100];
const LIAR_TWO_MIN_PLAYERS = 5;

module.exports = {
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
  },

  fixedMasterId() {
    const picked = this.liarMasterPick && this.getPlayer(this.liarMasterPick);
    return picked ? picked.id : this.hostId;
  },

  nextRotatingMasterId() {
    const count = this.players.length;
    if (!count) return null;
    const start = this.players.findIndex((p) => p.id === this.lastMasterId);
    for (let i = 1; i <= count; i++) {
      const candidate = this.players[(Math.max(-1, start) + i + count) % count];
      if (candidate.connected) return candidate.id;
    }
    return this.players[0].id;
  },

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
  },

  setLiarWords(player, entries) {
    this.requirePhase("lobby");
    if (!Array.isArray(entries) || entries.length !== LIAR_WORDS_PER_PLAYER) fail(`Potrzeba dokładnie ${LIAR_WORDS_PER_PLAYER} haseł`);
    const cleaned = entries.map((entry) => ({
      word: cleanText(entry && entry.word, LIAR_MAX_WORD),
      hint: cleanText(entry && entry.hint, LIAR_MAX_HINT)
    }));
    if (cleaned.some((entry) => !entry.word || !entry.hint)) fail("Uzupełnij wszystkie hasła i podpowiedzi");
    const symbols = cleaned.find((entry) => !normalizeGuess(entry.word));
    if (symbols) fail(`Hasło „${symbols.word}” musi zawierać litery albo cyfry`);
    const twin = findTwin(cleaned.map((entry) => entry.word));
    if (twin) fail(twinMessage(twin));
    for (const entry of cleaned) {
      if (guessMatches(entry.hint, entry.word)) fail(`Podpowiedź do „${entry.word}” nie może być samym hasłem`);
    }
    if (!player.liarReady) this.fx("ready", { playerId: player.id });
    player.liarWords = cleaned;
    player.liarReady = true;
    this.changed();
  },

  liarMasterId() {
    return this.liarSource === "host" ? this.hostId : null;
  },

  liarParticipants() {
    const masterId = this.liar ? this.liar.masterId : this.liarMasterId();
    return this.players.filter((p) => p.id !== masterId);
  },

  clearLiar() {
    if (this.liar) clearTimeout(this.liar.timer);
    this.liar = null;
  },

  liarSchedule(ms, callback) {
    const liar = this.liar;
    clearTimeout(liar.timer);
    liar.endsAt = ms ? Date.now() + ms : 0;
    liar.totalMs = ms || 0;
    liar.timer = ms
      ? later(() => {
          if (this.liar !== liar) return;
          callback();
          this.changed();
        }, ms)
      : null;
  },

  beginLiar() {
    this.history = [];
    this.liarHistory = [];
    this.liarRound = 0;
    this.lastImpostorIds = [];
    this.lastMasterId = null;
    this.liarPool = [];
    let merged = 0;
    for (const p of this.players) {
      p.score = 0;
      p.word = null;
      p.helpsUsed = 0;
      p.stats = { guessed: 0, passes: 0, reveals: 0 };
      if (this.liarSource === "players") {
        for (const entry of p.liarWords) {
          const twin = this.liarPool.find((other) => similarWords(other.word, entry.word));
          if (twin) {
            if (!isAuthorOf(twin, p)) twin.coAuthors.push(p.id);
            merged += 1;
            continue;
          }
          this.liarPool.push({ word: entry.word, hint: entry.hint, authorId: p.id, coAuthors: [] });
        }
      }
    }
    shuffle(this.liarPool);
    this.phase = "game";
    this.endReason = null;
    this.gameStartedAt = Date.now();
    this.scheduleGameEnd();
    this.hub.scheduleExpiry(this);
    this.fx("start", { playerId: this.hostId });
    if (merged) this.announce(`🧹 Powtórzone hasła scalone w jedno: ${merged}`);
    this.announce(this.liarSource === "host" ? "🕵️ Kłamca! Host prowadzi grę" : "🕵️ Kłamca! Hasła losowane z waszych");
    this.startLiarRound();
  },

  liarImpostorCount(playerCount) {
    const from = this.settings.liarTwoFrom;
    return from > 0 && playerCount >= Math.max(LIAR_TWO_MIN_PLAYERS, from) ? 2 : 1;
  },

  liarByFreshness(candidates) {
    const recent = (p) => (this.lastImpostorIds || []).includes(p.id);
    return shuffle([...candidates]).sort((a, b) => recent(a) - recent(b));
  },

  pickImpostors(candidates, count) {
    return this.liarByFreshness(candidates).slice(0, count);
  },

  isImpostor(playerId) {
    return Boolean(this.liar && this.liar.impostorIds.includes(playerId));
  },

  liarImpostorNames() {
    return joinNames(this.liar.impostorIds.map((id) => {
      const impostor = this.getPlayer(id);
      return impostor ? impostor.nick : "?";
    })) || "?";
  },

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
    const order = this.liarByFreshness(connected);
    const wanted = this.liarImpostorCount(connected.length);
    for (let count = wanted; count >= 1; count--) {
      const options = shuffle(this.liarPool.map((entry, index) => ({ entry, index })));
      for (const { entry, index } of options) {
        const eligible = order.filter((candidate) => !isAuthorOf(entry, candidate));
        if (eligible.length < count) continue;
        this.liarPool.splice(index, 1);
        this.liar = this.newLiarState({ masterId: null, stage: "clues" });
        return this.beginClues(entry.word, entry.hint, eligible.slice(0, count), entry.authorId);
      }
    }
    this.finish("pool");
  },

  newLiarState({ masterId, stage }) {
    return {
      round: this.liarRound,
      stage,
      masterId,
      word: null,
      hint: null,
      hintGiven: false,
      impostorId: null,
      impostorIds: [],
      caughtId: null,
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
  },

  liarSetup(player, rawWord, rawHint) {
    this.requirePhase("game");
    this.requireMode("klamca");
    const liar = this.liar;
    if (!liar || liar.stage !== "setup") fail("To teraz niedostępne");
    if (liar.masterId !== player.id) fail("Hasło wpisuje prowadzący");
    const word = cleanText(rawWord, LIAR_MAX_WORD);
    const hint = cleanText(rawHint, LIAR_MAX_HINT);
    if (!word) fail("Wpisz hasło");
    if (!normalizeGuess(word)) fail("Hasło musi zawierać litery albo cyfry");
    if (hint && guessMatches(hint, word)) fail("Podpowiedź nie może być samym hasłem");
    const candidates = this.liarParticipants().filter((p) => p.connected);
    if (candidates.length < LIAR_MIN_PLAYERS) fail("Za mało połączonych graczy");
    this.beginClues(word, hint, this.pickImpostors(candidates, this.liarImpostorCount(candidates.length)), player.id);
    this.changed();
  },

  beginClues(word, hint, impostors, authorId) {
    const liar = this.liar;
    liar.word = word;
    liar.hint = hint || null;
    liar.hintGiven = Boolean(hint) && crypto.randomInt(100) < this.liarHintChance;
    liar.impostorIds = impostors.map((p) => p.id);
    liar.impostorId = liar.impostorIds[0];
    liar.authorId = authorId;
    this.lastImpostorIds = [...liar.impostorIds];
    const order = shuffle(this.liarParticipants().filter((p) => p.connected).map((p) => p.id));
    const honest = order.filter((id) => !liar.impostorIds.includes(id));
    if (liar.impostorIds.includes(order[0]) && honest.length) {
      const swap = order.indexOf(honest[crypto.randomInt(honest.length)]);
      [order[0], order[swap]] = [order[swap], order[0]];
    }
    liar.order = order;
    liar.turn = 0;
    liar.stage = "clues";
    this.fx("liarRound", { round: liar.round });
    this.announce(liar.impostorIds.length > 1 ? `🕵️🕵️ Runda ${liar.round}! Dwóch z was nie zna hasła…` : `🕵️ Runda ${liar.round}! Jeden z was nie zna hasła…`);
    this.startClueTurn();
  },

  liarSpeakerId() {
    const liar = this.liar;
    if (!liar || liar.stage !== "clues" || !liar.order.length) return null;
    return liar.order[liar.turn % liar.order.length];
  },

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
  },

  liarClue(player, rawText) {
    this.requirePhase("game");
    this.requireMode("klamca");
    const liar = this.liar;
    if (!liar || liar.stage !== "clues") fail("To teraz niedostępne");
    if (this.liarSpeakerId() !== player.id) fail("Teraz mówi ktoś inny");
    const text = cleanText(rawText, LIAR_MAX_CLUE);
    if (!text) fail("Wpisz słowo");
    const secret = normalizeGuess(liar.word);
    const givesAway = guessMatches(text, liar.word) || Boolean(secret && normalizeGuess(text).includes(secret));
    if (givesAway && !this.isImpostor(player.id)) fail("Nie możesz podać samego hasła 😉");
    liar.clues.push({ playerId: player.id, text, lap: liar.lap, skipped: false });
    liar.turn += 1;
    this.startClueTurn();
    this.changed();
  },

  liarEndVote(player) {
    this.requirePhase("game");
    this.requireMode("klamca");
    const liar = this.liar;
    if (!liar || !["vote", "judge"].includes(liar.stage)) fail("To teraz niedostępne");
    if (!this.canManage(player) && liar.masterId !== player.id) fail("Głosowanie może zakończyć host");
    if (liar.stage === "vote") this.resolveLiarVote();
    else this.resolveLiarJudge();
    this.changed();
  },

  startLiarVote() {
    const liar = this.liar;
    liar.stage = "vote";
    liar.votes = new Map();
    this.activeId = null;
    this.fx("liarVote");
    this.announce(`🗳️ Koniec kółka ${liar.lap}! Gadajcie i głosujcie: kto kłamie? Albo pomińcie`);
    this.liarSchedule(this.settings.liarVoteSeconds * 1000, () => this.resolveLiarVote());
  },

  liarVoters() {
    return this.liarParticipants().filter((p) => p.connected);
  },

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
  },

  evaluateLiarVote() {
    const liar = this.liar;
    if (!liar || this.phase !== "game" || this.mode !== "klamca" || liar.stage !== "vote") return;
    const voters = this.liarVoters();
    if (voters.length && voters.every((p) => liar.votes.has(p.id))) this.resolveLiarVote();
  },

  tallyLiarVotes(votes = this.liar.votes) {
    const counts = new Map();
    for (const [voterId, targetId] of votes) {
      if (!this.getPlayer(voterId)) continue;
      if (targetId !== "skip" && !this.getPlayer(targetId)) continue;
      counts.set(targetId, (counts.get(targetId) || 0) + 1);
    }
    return counts;
  },

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
    if (!liar.impostorIds.includes(ejectedId)) {
      liar.wrongEject = true;
      this.announce(`😱 Wyrzuciliście ${ejected ? ejected.nick : "?"}, a to nie był kłamca!`);
      return this.finishLiarRound();
    }
    liar.caught = true;
    liar.caughtId = ejectedId;
    const impostor = this.getPlayer(ejectedId);
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
  },

  liarGuess(player, rawText) {
    this.requirePhase("game");
    this.requireMode("klamca");
    const liar = this.liar;
    if (!liar || liar.stage !== "guess") fail("To teraz niedostępne");
    if (liar.caughtId !== player.id) fail("Zgaduje tylko złapany kłamca");
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
  },

  liarJudgeIds() {
    const liar = this.liar;
    const ids = this.liarParticipants().filter((p) => p.connected && !liar.impostorIds.includes(p.id)).map((p) => p.id);
    const master = liar.masterId && this.getPlayer(liar.masterId);
    if (master && master.connected) ids.push(master.id);
    return ids;
  },

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
  },

  resolveLiarJudge() {
    const liar = this.liar;
    if (!liar || liar.stage !== "judge") return;
    const judges = this.liarJudgeIds();
    const cast = judges.filter((id) => liar.judges.has(id));
    const yes = cast.filter((id) => liar.judges.get(id)).length;
    liar.guessCorrect = cast.length ? yes >= this.requiredYes(judges.length) : liar.guessTyped && guessMatches(liar.guess, liar.word);
    this.finishLiarRound();
  },

  finishLiarRound() {
    const liar = this.liar;
    if (!liar || liar.stage === "reveal") return;
    const points = new Map();
    const add = (id, value) => points.set(id, (points.get(id) || 0) + value);
    const participants = this.liarParticipants();
    const isLiar = (id) => liar.impostorIds.includes(id);
    const survived = (id) => liar.wrongEject || id !== liar.caughtId || liar.guessCorrect;
    const nickFor = (id) => (this.getPlayer(id) || { nick: "?" }).nick;
    if (!liar.escaped) {
      const cfg = this.settings;
      const crew = participants.filter((p) => !isLiar(p.id));
      for (const id of liar.impostorIds) {
        if (liar.wrongEject) add(id, crew.length);
        else if (id !== liar.caughtId) add(id, cfg.liarSurvive);
        else if (liar.guessCorrect) add(id, cfg.liarSaved);
      }
      if (liar.caught && !liar.guessCorrect) for (const p of crew) add(p.id, cfg.liarCaughtCrew);
      if (cfg.liarVoteBonus) for (const [voterId, targetId] of liar.votes) if (isLiar(targetId) && !isLiar(voterId)) add(voterId, cfg.liarVoteBonus);
    }
    for (const [id, value] of points) {
      const player = this.getPlayer(id);
      if (player) player.score += value;
    }
    const names = this.liarImpostorNames();
    const many = liar.impostorIds.length > 1;
    liar.results = participants.map((p) => ({
      id: p.id,
      nick: p.nick,
      color: p.color,
      points: points.get(p.id) || 0,
      votedFor: liar.votes.get(p.id) || null,
      impostor: isLiar(p.id)
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
      impostorIds: [...liar.impostorIds],
      impostorNick: names,
      impostors: liar.impostorIds.map((id) => ({ id, nick: nickFor(id), survived: survived(id) })),
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
    const caughtNick = nickFor(liar.caughtId);
    const partner = joinNames(liar.impostorIds.filter((id) => id !== liar.caughtId).map(nickFor));
    if (liar.escaped) text = "Kłamca uciekł z gry!";
    else if (liar.wrongEject) text = many ? `😈 Kłamcami byli ${names} i zgarniają punkty! Hasło: ${liar.word}` : `😈 ${names} był(a) kłamcą i zgarnia punkty! Hasło: ${liar.word}`;
    else if (!liar.caught) text = many ? `😈 Kłamcy ${names} wygrywają! Hasło: ${liar.word}` : `😈 Kłamca ${names} wygrywa! Hasło: ${liar.word}`;
    else if (liar.guessCorrect) text = `😏 ${caughtNick} zgadł(a) hasło „${liar.word}” i ratuje się!`;
    else text = many ? `🎉 Kłamca ${caughtNick} złapany! Drugim był(a) ${partner}. Hasło: ${liar.word}` : `🎉 Kłamca złapany! Hasło: ${liar.word}`;
    this.announce(text);
    this.liarSchedule(LIAR_REVEAL_MS, () => this.liarContinue(null, true));
  },

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
  },

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
  },

  liarAfterRemoval(player) {
    const liar = this.liar;
    if (!liar) return;
    liar.votes.delete(player.id);
    for (const [voterId, targetId] of [...liar.votes]) if (targetId === player.id) liar.votes.delete(voterId);
    if (this.liarParticipants().filter((p) => p.connected).length < LIAR_MIN_PLAYERS && liar.stage !== "reveal") {
      return this.finish("players");
    }
    if (liar.stage === "setup" && liar.masterId === player.id) return this.startLiarRound();
    if (liar.impostorIds.includes(player.id) && liar.stage !== "reveal") {
      if (liar.impostorIds.length === 1 || liar.caughtId === player.id) {
        liar.escaped = true;
        return this.finishLiarRound();
      }
      liar.impostorIds = liar.impostorIds.filter((id) => id !== player.id);
      liar.impostorId = liar.impostorIds[0];
      this.announce(`🏃 ${player.nick} był(a) jednym z kłamców i ucieka. Został jeszcze jeden!`);
    }
    if (liar.stage === "clues" && this.liarSpeakerId() === player.id) {
      liar.turn += 1;
      return this.startClueTurn();
    }
    if (liar.stage === "vote") this.evaluateLiarVote();
    if (liar.stage === "judge" && liar.judges.size && this.liarJudgeIds().every((id) => liar.judges.has(id))) this.resolveLiarJudge();
  },

  liarView(viewer) {
    const liar = this.liar;
    if (this.mode !== "klamca" || !liar) return null;
    const isMaster = viewer.id === liar.masterId;
    const isImpostor = liar.impostorIds.includes(viewer.id);
    const revealed = liar.stage === "reveal";
    const started = liar.stage !== "setup";
    const judging = liar.stage === "guess" || liar.stage === "judge";
    const shown = isMaster || revealed ? liar.impostorIds : judging ? [liar.caughtId] : isImpostor ? [viewer.id] : [];
    return {
      round: liar.round,
      stage: liar.stage,
      masterId: liar.masterId,
      speakerId: this.liarSpeakerId(),
      role: isMaster ? "master" : !started ? null : isImpostor ? "impostor" : "crew",
      word: started && (!isImpostor || revealed) ? liar.word : null,
      hint: isMaster || revealed || (isImpostor && liar.hintGiven) ? liar.hint : null,
      hintGiven: isMaster || revealed || isImpostor ? liar.hintGiven : null,
      impostorId: shown[0] || null,
      impostorIds: shown,
      impostorCount: started ? liar.impostorIds.length : 1,
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
  },

  liarSummary() {
    const awards = [];
    const survived = new Map();
    const detectives = new Map();
    const suspects = new Map();
    const nickOf = (id) => (this.getPlayer(id) || { nick: "?" }).nick;
    for (const round of this.liarHistory) {
      if (round.escaped) continue;
      for (const impostor of round.impostors) if (impostor.survived) survived.set(impostor.nick, (survived.get(impostor.nick) || 0) + 1);
      for (const [voterId, targetId] of round.votes) {
        if (round.impostorIds.includes(targetId) && !round.impostorIds.includes(voterId)) detectives.set(nickOf(voterId), (detectives.get(nickOf(voterId)) || 0) + 1);
      }
      for (const [targetId, count] of round.counts) {
        if (!round.impostorIds.includes(targetId)) suspects.set(nickOf(targetId), (suspects.get(nickOf(targetId)) || 0) + count);
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
};
