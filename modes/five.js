const crypto = require("crypto");
const { fail } = require("../lib/errors");
const { later } = require("../lib/timers");
const { joinNames, cleanText, textKey } = require("../lib/text");
const { normalizeGuess } = require("../public/match");
const { TASKS } = require("../data/five-tasks");

const FIVE_MAX_TASKS = 30;
const FIVE_MAX_TASK = 140;
const FIVE_MAX_CARDS = 5;
const FIVE_MIN_SECONDS = 3;
const FIVE_ABSENT_MS = 20000;
const FIVE_BONUS_SECONDS = 3;
const FIVE_GAG_QUESTIONS = 2;
const FIVE_TIMED_ROUNDS = 3;
const FIVE_LETTERS = "ABCDEFGHIJKLMNOPRSTUWZ";
const FIVE_CARDS = {
  revive: { icon: "🧟", name: "Wskrzeszenie", text: "Przywraca do gry osobę, która odpadła (też ciebie), z 1 życiem", target: "dead", when: "any" },
  angel: { icon: "😇", name: "Anioł stróż", text: "Podczas głosowania: odpowiadający dostaje drugie podejście (nowy czas na odpowiedź)", target: null, when: "vote" },
  torpedo: { icon: "💣", name: "Torpeda", text: "Wskazana osoba musi odpowiadać na następne pytanie. Jak nie zaliczy, traci 2 życia", target: "other", when: "before", hostile: true },
  ally: { icon: "🤝", name: "Sojusznik", text: "Oddajesz 1 swoje życie, wskazana osoba dostaje 2", target: "other", when: "any", living: true },
  double: { icon: "🔁", name: "Dwa z rzędu", text: "Wskazana osoba odpowiada na 2 następne pytania z rzędu", target: "alive", when: "before", hostile: true },
  english: { icon: "🫖", name: "Po angielsku", text: "Wskazana osoba odpowiada na następne pytanie po angielsku", target: "alive", when: "before", hostile: true, curse: true },
  four: { icon: "4️⃣", name: "Cztery zamiast trzech", text: "Wskazana osoba w następnym pytaniu musi podać 4 odpowiedzi", target: "alive", when: "before", hostile: true, curse: true },
  letter: { icon: "🔤", name: "Na literę", text: "Wskazana osoba w następnym pytaniu podaje odpowiedzi tylko na wylosowaną literę", target: "alive", when: "before", hostile: true, curse: true },
  sprint: { icon: "⚡", name: "Sprint", text: "Wskazana osoba ma w następnym pytaniu połowę czasu", target: "alive", when: "before", hostile: true, curse: true },
  vabanque: { icon: "✌️", name: "Va banque", text: "Następne pytanie wskazanej osoby: zaliczy = +1 życie, nie zaliczy = −2 życia", target: "alive", when: "before", hostile: true, curse: true },
  bonus: { icon: "🐢", name: "Dogrywka", text: "Tajna: w swoim następnym pytaniu masz +3 s. Inni zobaczą ją dopiero, gdy zadziała", target: null, when: "before", hidden: true },
  shield: { icon: "🛡️", name: "Tarcza", text: "Tajna: twoja następna porażka nie zabiera życia. Inni zobaczą ją dopiero, gdy zadziała", target: null, when: "any", hidden: true },
  mirror: { icon: "🪞", name: "Lustro", text: "Tajna: następna wredna karta rzucona na ciebie wraca do rzucającego", target: null, when: "any", hidden: true },
  legend: { icon: "🌟", name: "Legendarna tajna karta", text: "Tajna: wygląda groźnie, ale nic nie robi. Odsłania się, gdy ktoś rzuci na ciebie wredną kartę albo gdy nie zaliczysz", target: null, when: "any", hidden: true, bluff: true },
  fenix: { icon: "🔥", name: "Feniks", text: "Tajna: działa przez 3 pytania. Jeśli w tym czasie nie zaliczysz, zamiast stracić życie dostajesz +1", target: null, when: "any", hidden: true, timed: true },
  stink: { icon: "🦨", name: "Śmierdziel", text: "Tajna: działa przez 3 pytania. Gdy ktoś cię zapyta, po kliknięciu START odpowiada pytający zamiast ciebie", target: null, when: "any", hidden: true, timed: true },
  potato: { icon: "🥔", name: "Gorący kartofel", text: "Gdy cię pytają (też w trakcie odpowiadania): przerzucasz pytanie na inną osobę, czas leci od nowa", target: "other", when: "mine", living: true },
  thief: { icon: "🥷", name: "Złodziej", text: "Kradniesz losową kartę wskazanej osobie", target: "anyone", when: "any", hostile: true, needsCards: true },
  peek: { icon: "👁️", name: "Podgląd", text: "Widzisz karty wskazanej osoby", target: "anyone", when: "any", needsCards: true },
  gag: { icon: "🔇", name: "Knebel", text: "Wskazana osoba nie może zagrać żadnej karty przez 2 pytania", target: "anyone", when: "any", hostile: true },
  draw: { icon: "🃏", name: "Dobierz dwie", text: "Dostajesz 2 losowe karty", target: null, when: "any" },
  vampire: { icon: "🧛", name: "Wampir", text: "Zabierasz wskazanej osobie 1 życie i dodajesz sobie", target: "other", when: "any", hostile: true },
  roulette: { icon: "🎲", name: "Ruletka", text: "Losowa żywa osoba (możesz to być ty) traci 1 życie", target: null, when: "any" },
  reverse: { icon: "🔄", name: "Odwrotka", text: "Gdy ktoś cię pyta: pytający sam musi odpowiedzieć. Jak nie zaliczy, dostajesz +1 życie", target: null, when: "asked", living: true }
};
const FIVE_CARD_TYPES = Object.keys(FIVE_CARDS);
const CURSE_TYPES = FIVE_CARD_TYPES.filter((type) => FIVE_CARDS[type].curse);
const GHOST_TYPES = FIVE_CARD_TYPES.filter((type) => !FIVE_CARDS[type].living);
const HAUNT_TYPES = GHOST_TYPES.filter((type) => type !== "revive");
const HIDDEN_TYPES = FIVE_CARD_TYPES.filter((type) => FIVE_CARDS[type].hidden);
const TIMED_TYPES = FIVE_CARD_TYPES.filter((type) => FIVE_CARDS[type].timed);

const taskKey = (text) => normalizeGuess(text) || textKey(text);

const methods = {
  setFiveTasks(player, rawTasks) {
    this.requirePhase("lobby");
    if (!Array.isArray(rawTasks)) fail("Nieprawidłowa lista zadań");
    const seen = new Set();
    const tasks = [];
    for (const raw of rawTasks) {
      const text = cleanText(raw, FIVE_MAX_TASK);
      if (!text || seen.has(taskKey(text))) continue;
      seen.add(taskKey(text));
      tasks.push(text);
    }
    if (tasks.length > FIVE_MAX_TASKS) fail(`Maksymalnie ${FIVE_MAX_TASKS} zadań`);
    player.fiveTasks = tasks;
    this.changed();
  },

  clearFive() {
    if (this.five) clearTimeout(this.five.timer);
    clearTimeout(this.fiveAbsentTimer);
    this.fiveAbsentTimer = null;
    this.five = null;
  },

  setFiveCard(player, type, enabled) {
    this.requireManager(player);
    this.requirePhase("lobby", "game");
    if (!FIVE_CARD_TYPES.includes(type)) fail("Nieznana karta");
    if (enabled) this.fiveCardsOff.delete(type);
    else this.fiveCardsOff.add(type);
    const info = FIVE_CARDS[type];
    this.announce(`🃏 Karta ${info.icon} ${info.name}: ${enabled ? "w grze" : "wyłączona"}`);
    this.changed();
  },

  fiveCardPool(types = FIVE_CARD_TYPES) {
    return types.filter((type) => !this.fiveCardsOff.has(type));
  },

  fiveAlive() {
    return this.players.filter((p) => p.lives > 0);
  },

  fiveSyncScore(player) {
    player.score = Math.max(0, player.lives);
  },

  randomCard(types) {
    const pool = this.fiveCardPool(types);
    if (!pool.length) return null;
    return { id: ++this.fiveCardSeq, type: pool[crypto.randomInt(pool.length)] };
  },

  giveCard(player, types) {
    if (player.cards.length >= FIVE_MAX_CARDS) return null;
    const card = this.randomCard(types);
    if (card) player.cards.push(card);
    return card;
  },

  fiveAnswerSeconds() {
    const every = this.settings.fiveSpeedEvery;
    const drop = every ? Math.floor(this.fiveHistory.length / every) : 0;
    return Math.max(FIVE_MIN_SECONDS, this.settings.fiveAnswerSeconds - drop);
  },

  fiveHaunt() {
    const ghosts = this.players.filter((p) => p.lives <= 0);
    const gifted = ghosts.filter((ghost) => this.giveCard(ghost, HAUNT_TYPES));
    if (!gifted.length) return;
    this.fx("fiveGhost", { ids: gifted.map((p) => p.id) });
    this.announce(`👻 Duchy dostają po karcie do rzucenia na żywych (${gifted.map((p) => p.nick).join(", ")})`);
  },

  fiveJoin(player) {
    const alive = this.fiveAlive().filter((p) => p !== player);
    player.lives = alive.length > 2 ? Math.max(1, Math.min(...alive.map((p) => p.lives))) : 0;
    player.fiveOut = 0;
    player.fiveCurses = [];
    player.fiveStats = { passed: 0, failed: 0, cards: 0 };
    player.fiveRerolls = 0;
    player.cards = [];
    this.fiveResetEffects(player);
    this.fiveSyncScore(player);
  },

  fiveResetEffects(player) {
    player.fiveEffects = Object.fromEntries(HIDDEN_TYPES.map((type) => [type, 0]));
    player.fiveGag = 0;
  },

  fiveReveal(player, type, text, delay = 0) {
    this.fx("fiveCard", { playerId: player.id, targetId: null, card: type, activated: true, delay });
    this.announce(text);
  },

  fiveBluff(player, delay) {
    if (!player || !(player.fiveEffects.legend > 0)) return;
    player.fiveEffects.legend -= 1;
    this.fiveReveal(player, "legend", `🌟 ${player.nick} odsłania Legendarną tajną kartę… i nic się nie dzieje 😎`, delay);
  },

  fiveLoseLife(player, amount) {
    const lost = Math.min(player.lives, amount);
    player.lives -= lost;
    this.fiveSyncScore(player);
    if (lost && player.lives <= 0) player.fiveOut = ++this.fiveOutSeq;
    return lost;
  },

  fiveEffectCount(player, type) {
    const value = (player.fiveEffects && player.fiveEffects[type]) || 0;
    return FIVE_CARDS[type].timed ? Number(value > 0) : value;
  },

  fiveStink() {
    const five = this.five;
    for (let bounce = 0; bounce < 2; bounce++) {
      const answerer = this.getPlayer(five.answererId);
      const asker = this.getPlayer(five.askerId);
      if (!answerer || !asker || asker === answerer || asker.lives <= 0 || !(answerer.fiveEffects.stink > 0)) return;
      answerer.fiveEffects.stink = 0;
      answerer.fiveCurses.push(...five.curses.filter((curse) => curse !== "torpedo"));
      five.curses = [];
      this.fiveApplyCurses();
      five.reversed = false;
      five.reverseOwnerId = null;
      five.answererId = asker.id;
      five.askerId = answerer.id;
      this.fiveReveal(answerer, "stink", `🦨 Śmierdziel! ${answerer.nick} się wywija, odpowiada ${asker.nick}`);
    }
  },

  fiveLaunch() {
    this.fiveStink();
    this.fiveBeginAnswer();
  },

  fiveApplyCurses() {
    const five = this.five;
    five.stake = five.curses.includes("torpedo") || five.curses.includes("vabanque") ? 2 : 1;
    five.letter = five.curses.includes("letter") ? FIVE_LETTERS[crypto.randomInt(FIVE_LETTERS.length)] : null;
  },

  fiveAfterLives() {
    const five = this.five;
    if (this.fiveAlive().length <= 1) return this.finish("lastAlive");
    if (!five) return;
    const asker = this.getPlayer(five.askerId);
    const answerer = this.getPlayer(five.answererId);
    if (five.stage === "pick" && asker && asker.lives <= 0) return this.startFivePick(null);
    if (five.stage === "ready" && answerer && answerer.lives <= 0) return this.startFivePick(five.askerId);
  },

  fiveWatchAsker() {
    clearTimeout(this.fiveAbsentTimer);
    this.fiveAbsentTimer = null;
    const five = this.five;
    const waiting = (state) => state && this.five === state && this.phase === "game" && this.mode === "piec" && (state.stage === "pick" || state.stage === "ready");
    if (!waiting(five)) return;
    const asker = this.getPlayer(five.askerId);
    if (!asker || asker.connected) return;
    this.fiveAbsentTimer = later(() => {
      this.fiveAbsentTimer = null;
      if (!waiting(five) || five.askerId !== asker.id || asker.connected) return;
      this.fiveReplaceAsker(asker);
      this.changed();
    }, FIVE_ABSENT_MS);
  },

  fiveReplaceAsker(asker) {
    const five = this.five;
    const online = this.players.filter((p) => p.connected && p.id !== asker.id);
    if (!online.length) return;
    if (five.stage === "pick") {
      const next = online.find((p) => p.lives > 0);
      if (!next) return;
      this.announce(`⏳ ${asker.nick} zniknął(a), pytanie przejmuje ${next.nick}`);
      return this.startFivePick(next.id);
    }
    const readers = online.filter((p) => p.id !== five.answererId);
    const reader = readers.find((p) => p.lives > 0) || readers[0];
    if (!reader) {
      this.announce(`⏳ ${asker.nick} zniknął(a), zadanie startuje samo`);
      return this.fiveLaunch();
    }
    five.askerId = reader.id;
    this.activeId = reader.id;
    this.fx("turn", { playerId: reader.id });
    this.announce(`⏳ ${asker.nick} zniknął(a), zadanie czyta ${reader.nick}`);
  },

  allFiveTasks() {
    const seen = new Map();
    const all = [];
    const add = (text, authorId) => {
      const key = taskKey(text);
      const twin = seen.get(key);
      if (twin) {
        if (authorId && !twin.authorIds.includes(authorId)) twin.authorIds.push(authorId);
        if (authorId && !twin.authorId) twin.authorId = authorId;
        return;
      }
      const task = { text, authorId, authorIds: authorId ? [authorId] : [], key };
      seen.set(key, task);
      all.push(task);
    };
    for (const p of this.players) for (const text of p.fiveTasks || []) add(text, p.id);
    for (const text of TASKS) add(text, null);
    return all;
  },

  drawFiveTask() {
    const all = this.allFiveTasks();
    let fresh = all.filter((task) => !this.fiveUsed.has(task.key));
    if (!fresh.length) {
      this.fiveUsed.clear();
      this.announce("♻️ Wszystkie zadania już były, losujemy od nowa");
      fresh = all;
    }
    let pool = fresh;
    const chance = this.settings.fiveOwnChance;
    const own = fresh.filter((task) => task.authorId);
    const listed = fresh.filter((task) => !task.authorId);
    if (chance && own.length && listed.length) pool = crypto.randomInt(100) < chance ? own : listed;
    const task = pool[crypto.randomInt(pool.length)];
    this.fiveUsed.add(task.key);
    return { text: task.text, authorId: task.authorId, authorIds: task.authorIds };
  },

  beginFive() {
    this.history = [];
    this.fiveHistory = [];
    this.fiveRound = 0;
    this.fiveForced = [];
    this.fiveOutSeq = 0;
    this.fiveCardSeq = 0;
    this.fiveFinal = false;
    for (const p of this.players) {
      p.word = null;
      p.helpsUsed = 0;
      p.stats = { guessed: 0, passes: 0, reveals: 0 };
      p.lives = this.settings.fiveLives;
      p.fiveOut = 0;
      p.fiveCurses = [];
      p.fiveStats = { passed: 0, failed: 0, cards: 0 };
      p.fiveRerolls = 0;
      p.cards = [];
      this.fiveResetEffects(p);
      for (let i = 0; i < this.settings.fiveStartCards; i++) this.giveCard(p);
      this.fiveSyncScore(p);
    }
    this.phase = "game";
    this.endReason = null;
    this.gameStartedAt = Date.now();
    this.scheduleGameEnd();
    this.hub.scheduleExpiry(this);
    this.fx("start", { playerId: this.hostId });
    this.announce("⏱️ 5 sekund! Kto zaliczy, ten przejmuje pytanie");
    const starters = this.fiveAlive().filter((p) => p.connected);
    const pool = starters.length ? starters : this.fiveAlive();
    this.startFivePick(pool[crypto.randomInt(pool.length)].id);
  },

  fiveSchedule(ms, callback) {
    const five = this.five;
    clearTimeout(five.timer);
    five.endsAt = ms ? Date.now() + ms : 0;
    five.totalMs = ms || 0;
    five.timer = ms
      ? later(() => {
          if (this.five !== five) return;
          callback();
          this.changed();
        }, ms)
      : null;
  },

  fiveCanAsk(player) {
    return Boolean(player && player.lives > 0 && player.connected);
  },

  fiveFallbackAsker(excludeId) {
    const alive = this.fiveAlive().filter((p) => p.id !== excludeId);
    const online = alive.filter((p) => p.connected);
    const pool = online.length ? online : alive;
    return pool.length ? pool[crypto.randomInt(pool.length)] : null;
  },

  startFivePick(askerId) {
    if (this.phase !== "game") return;
    if (this.fiveAlive().length <= 1) return this.finish("lastAlive");
    this.fiveForced = this.fiveForced.filter((id) => {
      const p = this.getPlayer(id);
      return p && p.lives > 0;
    });
    let asker = this.getPlayer(askerId);
    if (!this.fiveCanAsk(asker)) asker = this.fiveFallbackAsker(null);
    if (!asker) return this.finish("players");
    if (this.fiveForced[0] === asker.id) {
      const other = this.fiveFallbackAsker(asker.id);
      if (other) asker = other;
      else this.fiveForced.shift();
    }
    clearTimeout(this.five && this.five.timer);
    this.fiveRound += 1;
    this.five = {
      round: this.fiveRound,
      stage: "pick",
      askerId: asker.id,
      answererId: null,
      task: null,
      curses: [],
      stake: 1,
      letter: null,
      reversed: false,
      reverseOwnerId: null,
      angelUsed: false,
      redone: false,
      votes: new Map(),
      last: this.five ? this.five.last : null,
      endsAt: 0,
      totalMs: 0,
      timer: null
    };
    this.activeId = asker.id;
    this.fx("turn", { playerId: asker.id });
    const alive = this.fiveAlive();
    const duel = alive.length === 2 && alive.includes(asker);
    if (duel && !this.fiveFinal && this.players.length > 2) {
      this.fx("fiveFinal", { ids: alive.map((p) => p.id) });
      this.announce(`⚔️ Finał 1 na 1: ${alive[0].nick} kontra ${alive[1].nick}! Pytacie się na zmianę`);
    }
    this.fiveFinal = duel;
    const forced = this.fiveForced[0] && this.getPlayer(this.fiveForced[0]);
    if (forced && forced.id !== asker.id) return this.fivePrepare(forced);
    if (duel) return this.fivePrepare(alive.find((p) => p !== asker));
    this.fiveWatchAsker();
  },

  requireFive(stage) {
    this.requirePhase("game");
    this.requireMode("piec");
    const five = this.five;
    if (!five || (stage && five.stage !== stage)) fail("To teraz niedostępne");
    return five;
  },

  fiveChoose(player, targetId) {
    const five = this.requireFive("pick");
    if (five.askerId !== player.id) fail("Teraz pyta ktoś inny");
    if (player.lives <= 0) fail("Odpadłeś, nie możesz pytać");
    const target = this.requireTarget(targetId);
    if (target === player) fail("Nie możesz pytać siebie");
    if (target.lives <= 0) fail("Ta osoba już odpadła");
    this.fivePrepare(target);
    this.changed();
  },

  fivePrepare(target) {
    const five = this.five;
    if (this.fiveForced[0] === target.id) this.fiveForced.shift();
    five.answererId = target.id;
    five.curses = target.fiveCurses;
    target.fiveCurses = [];
    this.fiveApplyCurses();
    five.task = this.drawFiveTask();
    five.stage = "ready";
    const asker = this.getPlayer(five.askerId);
    this.announce(`🎯 ${asker ? asker.nick : "?"} pyta: ${target.nick}`);
    this.fiveWatchAsker();
  },

  fiveTaskAuthors(task) {
    if (!task || !task.authorId) return null;
    return joinNames((task.authorIds && task.authorIds.length ? task.authorIds : [task.authorId]).map((id) => {
      const author = this.getPlayer(id);
      return author ? author.nick : "?";
    }));
  },

  fiveRerollsLeft(player) {
    const limit = this.settings.fiveRerolls;
    if (limit >= 99) return null;
    return Math.max(0, limit - (player.fiveRerolls || 0));
  },

  fiveReroll(player) {
    const five = this.requireFive("ready");
    if (five.askerId !== player.id) fail("Zadanie losuje pytający");
    if (this.fiveRerollsLeft(player) === 0) fail(this.settings.fiveRerolls ? "Wykorzystałeś już wszystkie zmiany zadania" : "Zmiana zadania jest wyłączona");
    player.fiveRerolls = (player.fiveRerolls || 0) + 1;
    five.task = this.drawFiveTask();
    this.fx("reroll", { playerId: player.id });
    this.changed();
  },

  fiveStart(player) {
    const five = this.requireFive("ready");
    if (five.askerId !== player.id && !this.canManage(player)) fail("Start klika pytający");
    this.fiveLaunch();
    this.changed();
  },

  fiveRedo(player) {
    const five = this.requireFive();
    if (five.stage !== "answer" && five.stage !== "vote") fail("Jeszcze raz można dać dopiero po starcie");
    if (five.askerId !== player.id && !this.canManage(player)) fail("Jeszcze raz daje pytający");
    if (five.redone) fail("To pytanie już raz zaczynaliście od nowa");
    clearTimeout(five.timer);
    five.timer = null;
    five.endsAt = 0;
    five.totalMs = 0;
    five.redone = true;
    five.angelUsed = false;
    five.votes = new Map();
    five.stage = "ready";
    five.task = this.drawFiveTask();
    this.activeId = five.askerId;
    this.fx("reroll", { playerId: player.id });
    this.announce(`↩️ ${player.nick}: jeszcze raz! Pytanie bez oceny, karty dalej działają`);
    this.fiveWatchAsker();
    this.changed();
  },

  fiveBeginAnswer() {
    const five = this.five;
    five.stage = "answer";
    five.votes = new Map();
    this.activeId = five.answererId;
    const answerer = this.getPlayer(five.answererId);
    let seconds = this.fiveAnswerSeconds();
    if (five.curses.includes("sprint")) seconds = Math.max(2, Math.ceil(seconds / 2));
    if (answerer && answerer.fiveEffects.bonus > 0) {
      answerer.fiveEffects.bonus -= 1;
      seconds += FIVE_BONUS_SECONDS;
      this.fiveReveal(answerer, "bonus", `🐢 Dogrywka! ${answerer.nick} ma +${FIVE_BONUS_SECONDS} s`);
    }
    five.answerSeconds = seconds;
    this.fx("fiveGo", { playerId: five.answererId, seconds: five.answerSeconds });
    this.fiveSchedule(five.answerSeconds * 1000, () => this.startFiveVote());
  },

  startFiveVote() {
    const five = this.five;
    five.stage = "vote";
    this.fx("voteStart", { playerId: five.answererId });
    this.fiveSchedule(this.settings.fiveVoteSeconds * 1000, () => this.resolveFive(true));
  },

  fiveVoterIds() {
    const five = this.five;
    return this.players.filter((p) => p.connected && p.id !== five.answererId).map((p) => p.id);
  },

  fiveVote(player, approve) {
    const five = this.requireFive("vote");
    if (!this.fiveVoterIds().includes(player.id)) fail("Nie głosujesz nad własną odpowiedzią");
    five.votes.set(player.id, Boolean(approve));
    this.evaluateFiveVote();
    this.changed();
  },

  evaluateFiveVote() {
    const five = this.five;
    if (!five || this.phase !== "game" || this.mode !== "piec" || five.stage !== "vote") return;
    const voters = this.fiveVoterIds();
    const yes = voters.filter((id) => five.votes.get(id) === true).length;
    const no = voters.filter((id) => five.votes.get(id) === false).length;
    const required = this.requiredYes(voters.length);
    if (!voters.length || yes >= required || no > voters.length - required || yes + no === voters.length) this.resolveFive(false);
  },

  resolveFive(timedOut) {
    const five = this.five;
    if (!five || five.stage !== "vote") return;
    clearTimeout(five.timer);
    const voters = this.fiveVoterIds();
    const yes = voters.filter((id) => five.votes.get(id) === true).length;
    const no = voters.filter((id) => five.votes.get(id) === false).length;
    const passed = timedOut ? yes > 0 && yes >= no : yes >= this.requiredYes(voters.length);
    const answerer = this.getPlayer(five.answererId);
    const asker = this.getPlayer(five.askerId);
    let nextAskerId = five.askerId;
    let lost = 0;
    let card = null;
    let shielded = false;
    let reborn = false;
    let jackpot = false;
    if (answerer) {
      if (passed) answerer.fiveStats.passed += 1;
      else answerer.fiveStats.failed += 1;
    }
    if (five.reversed) {
      const owner = this.getPlayer(five.reverseOwnerId);
      if (!passed && owner && owner.lives > 0) {
        owner.lives += 1;
        this.fiveSyncScore(owner);
      }
      nextAskerId = five.answererId;
    } else if (passed && answerer) {
      if (answerer.lives > 0 && crypto.randomInt(100) < this.settings.fiveCardChance) {
        card = this.giveCard(answerer);
        if (card) answerer.fiveStats.cards += 1;
      }
      if (five.curses.includes("vabanque") && answerer.lives > 0) {
        answerer.lives += 1;
        this.fiveSyncScore(answerer);
        jackpot = true;
      }
      nextAskerId = this.fiveForced[0] === answerer.id ? five.askerId : answerer.id;
    } else if (answerer && answerer.fiveEffects.fenix > 0) {
      answerer.fiveEffects.fenix = 0;
      if (answerer.lives <= 0) answerer.fiveOut = 0;
      answerer.lives += 1;
      this.fiveSyncScore(answerer);
      reborn = true;
    } else if (answerer && answerer.fiveEffects.shield > 0) {
      answerer.fiveEffects.shield -= 1;
      shielded = true;
    } else if (answerer) {
      lost = this.fiveLoseLife(answerer, five.stake);
    }
    const out = Boolean(answerer && !passed && !five.reversed && answerer.lives <= 0);
    five.last = {
      answererId: five.answererId,
      askerId: five.askerId,
      passed,
      yes,
      no,
      lost,
      out,
      reversed: five.reversed,
      card: Boolean(card)
    };
    const secondsBefore = this.fiveAnswerSeconds();
    this.fiveHistory.push({
      round: five.round,
      askerNick: asker ? asker.nick : "?",
      answererNick: answerer ? answerer.nick : "?",
      task: five.task ? five.task.text : "",
      authorNick: this.fiveTaskAuthors(five.task),
      passed,
      lost,
      out,
      reversed: five.reversed,
      curses: five.curses
    });
    this.fx("fiveResult", { playerId: five.answererId, passed, lost, out, card: Boolean(card), reversed: five.reversed, shielded, reborn });
    const name = answerer ? answerer.nick : "?";
    if (five.reversed) {
      const owner = this.getPlayer(five.reverseOwnerId);
      this.announce(passed ? `🔄 ${name} obronił(a) się przed odwrotką` : `🔄 ${name} nie zaliczył(a)! ${owner ? owner.nick : "?"} dostaje +1 ❤️`);
    } else if (passed) {
      this.announce(`✅ ${name} zalicza (${yes}:${no})${jackpot ? ", Va banque daje +1 ❤️" : ""}${card ? " i dostaje tajną kartę 🃏" : ""}`);
    } else if (reborn) {
      this.announce(`🔥 Feniks! ${name} nie zalicza (${yes}:${no}), ale zamiast stracić życie dostaje +1 ❤️`);
    } else if (shielded) {
      this.announce(`🛡️ Tarcza! ${name} nie zalicza (${yes}:${no}), ale nie traci życia`);
    } else {
      this.announce(`❌ ${name} nie zalicza (${yes}:${no}), −${lost} ❤️${out ? ". Odpada! 💀" : ""}`);
    }
    if (!passed) this.fiveBluff(answerer, 1500);
    const secondsNow = this.fiveAnswerSeconds();
    if (secondsNow < secondsBefore) this.announce(`⏩ Tempo rośnie! Teraz ${secondsNow} s na odpowiedź`);
    const ghostEvery = this.settings.fiveGhostEvery;
    if (ghostEvery && this.fiveHistory.length % ghostEvery === 0) this.fiveHaunt();
    for (const p of this.players) {
      if (p.fiveGag > 0) p.fiveGag -= 1;
      for (const type of TIMED_TYPES) if (p.fiveEffects[type] > 0) p.fiveEffects[type] -= 1;
    }
    if (this.fiveAlive().length === 2 && answerer && answerer.lives > 0) nextAskerId = five.answererId;
    this.startFivePick(nextAskerId);
  },

  fiveCardWindow(player, info) {
    const five = this.five;
    const stage = five.stage;
    const mine = five.answererId === player.id;
    if (info.when === "mine") {
      if (!mine || (stage !== "ready" && stage !== "answer")) fail("Gorący kartofel grasz, kiedy to ciebie pytają");
      return;
    }
    if (stage === "answer") fail("Teraz leci czas, poczekaj chwilę");
    if (info.when === "before" && stage !== "pick" && stage !== "vote") fail("Tę kartę grasz przed wybraniem osoby albo podczas głosowania");
    if (info.when === "vote" && stage !== "vote") fail("Anioła stróża grasz podczas głosowania");
    if (info.when === "asked" && (stage !== "ready" || !mine)) fail("Odwrotkę grasz, kiedy ktoś cię pyta (przed startem)");
  },

  fiveCardTarget(player, info, targetId) {
    const kind = info.hidden ? (player.lives <= 0 ? "other" : null) : info.target;
    if (!kind) return null;
    const target = this.requireTarget(targetId);
    if (kind === "dead" && target.lives > 0) fail("Ta osoba jeszcze gra");
    if ((kind === "other" || kind === "alive") && target.lives <= 0) fail("Ta osoba już odpadła");
    if ((kind === "other" || kind === "anyone") && target === player) fail("Wybierz kogoś innego");
    if (info.needsCards && !target.cards.length) fail(`${target.nick} nie ma kart`);
    return target;
  },

  fivePlayCard(player, cardId, targetId) {
    this.requirePhase("game");
    this.requireMode("piec");
    const five = this.five;
    if (!five) fail("To teraz niedostępne");
    const index = (player.cards || []).findIndex((card) => card.id === Number(cardId));
    if (index < 0) fail("Nie masz takiej karty");
    const card = player.cards[index];
    const type = card.type;
    const info = FIVE_CARDS[type];
    this.fiveCardWindow(player, info);
    if (player.fiveGag > 0) fail(`Masz knebel jeszcze przez ${player.fiveGag} pyt.`);
    if (player.lives <= 0 && info.living) fail("Tej karty nie zagrasz jako duch");
    const target = this.fiveCardTarget(player, info, targetId);
    const mirrored = Boolean(info.hostile && target && target !== player && target.fiveEffects.mirror > 0);
    const bounced = mirrored && player.fiveEffects.mirror > 0;
    const reflected = mirrored && !bounced;
    const actor = reflected ? target : player;
    const victim = reflected ? player : target;
    if (type === "angel" && five.angelUsed) fail("Anioł stróż już pomógł w tym pytaniu");
    if (type === "torpedo" && !reflected && this.fiveForced.includes(victim.id)) fail("Ta osoba już ma wymuszone pytanie");
    if (type === "ally" && player.lives < 2) fail("Potrzebujesz co najmniej 2 żyć, żeby oddać jedno");
    if (type === "reverse" && five.reversed) fail("Odwrotka już zagrana");
    if (type === "draw" && !this.fiveCardPool().length) fail("Wszystkie karty są wyłączone");
    player.cards.splice(index, 1);
    const stageBefore = five.stage;
    let text;
    if (type === "revive") {
      target.lives = 1;
      target.fiveOut = 0;
      this.fiveSyncScore(target);
      text = `🧟 ${player.nick} wskrzesza: ${target.nick} wraca z 1 ❤️`;
    } else if (type === "angel") {
      five.angelUsed = true;
      const answerer = this.getPlayer(five.answererId);
      text = `😇 ${player.nick} zagrywa Anioła stróża! ${answerer ? answerer.nick : "?"} ma drugie podejście`;
    } else if (type === "torpedo") {
      this.fiveForced.push(victim.id);
      victim.fiveCurses.push("torpedo");
      text = `💣 ${actor.nick} wystrzeliwuje torpedę w: ${victim.nick}`;
    } else if (type === "ally") {
      player.lives -= 1;
      target.lives += 2;
      this.fiveSyncScore(player);
      this.fiveSyncScore(target);
      text = `🤝 ${player.nick} oddaje życie, ${target.nick} dostaje +2 ❤️`;
    } else if (type === "double") {
      this.fiveForced.push(victim.id, victim.id);
      text = `🔁 ${actor.nick}: ${victim.nick} odpowiada na 2 pytania z rzędu`;
    } else if (CURSE_TYPES.includes(type)) {
      victim.fiveCurses.push(type);
      text = `${info.icon} ${actor.nick} zagrywa „${info.name}” na: ${victim.nick}`;
    } else if (type === "reverse") {
      player.fiveCurses.push(...five.curses.filter((curse) => curse !== "torpedo"));
      five.curses = [];
      this.fiveApplyCurses();
      five.reversed = true;
      five.reverseOwnerId = player.id;
      five.answererId = five.askerId;
      five.askerId = player.id;
      const loser = this.getPlayer(five.answererId);
      text = `🔄 ${player.nick} zagrywa Odwrotkę! Odpowiada ${loser ? loser.nick : "?"}`;
    } else if (type === "potato") {
      player.fiveCurses.push(...five.curses.filter((curse) => curse !== "torpedo"));
      if (target.id === five.askerId) five.askerId = player.id;
      if (this.fiveForced[0] === target.id) this.fiveForced.shift();
      five.answererId = target.id;
      five.curses = target.fiveCurses;
      target.fiveCurses = [];
      this.fiveApplyCurses();
      text = `🥔 ${player.nick} przerzuca pytanie! Odpowiada ${target.nick}`;
    } else if (info.hidden) {
      const owner = target || player;
      const fresh = five.stage === "vote" && five.answererId !== owner.id;
      if (info.timed) owner.fiveEffects[type] = FIVE_TIMED_ROUNDS + Number(fresh);
      else owner.fiveEffects[type] += 1;
      text = target ? `🂠 ${player.nick} zagrywa tajną kartę na: ${target.nick}` : `🂠 ${player.nick} zagrywa tajną kartę`;
    } else if (type === "thief") {
      const stolen = victim.cards.length ? victim.cards.splice(crypto.randomInt(victim.cards.length), 1)[0] : null;
      if (stolen && actor.cards.length < FIVE_MAX_CARDS) actor.cards.push(stolen);
      this.fx("fiveSteal", { playerId: actor.id, targetId: victim.id, got: Boolean(stolen) });
      text = stolen ? `🥷 ${actor.nick} kradnie kartę graczowi ${victim.nick}` : `🥷 ${actor.nick} chciał(a) okraść ${victim.nick}, ale nie było czego`;
    } else if (type === "peek") {
      this.emit("fivePeek", player, { nick: target.nick, cards: target.cards.map((held) => held.type) });
      text = `👁️ ${player.nick} podgląda karty gracza ${target.nick}`;
    } else if (type === "gag") {
      victim.fiveGag = FIVE_GAG_QUESTIONS;
      text = `🔇 ${actor.nick} knebluje: ${victim.nick} nie zagra karty przez ${FIVE_GAG_QUESTIONS} pytania`;
    } else if (type === "draw") {
      const drawn = [this.giveCard(player), this.giveCard(player)].filter(Boolean).length;
      this.fx("fiveGift", { playerId: player.id, own: true });
      text = `🃏 ${player.nick} dobiera karty: ${drawn}`;
    } else if (type === "vampire") {
      const taken = this.fiveLoseLife(victim, 1);
      const risen = taken > 0 && actor.lives <= 0;
      actor.lives += taken;
      if (risen) actor.fiveOut = 0;
      this.fiveSyncScore(actor);
      text = `🧛 ${actor.nick} wysysa życie: ${victim.nick} −${taken} ❤️${victim.lives <= 0 ? ". Odpada! 💀" : ""}${risen ? ` ${actor.nick} wraca do gry! 🧟` : ""}`;
    } else if (type === "roulette") {
      const alive = this.fiveAlive();
      const unlucky = alive[crypto.randomInt(alive.length)];
      this.fiveLoseLife(unlucky, 1);
      text = `🎲 Ruletka od ${player.nick} trafia w: ${unlucky.nick} −1 ❤️${unlucky.lives <= 0 ? ". Odpada! 💀" : ""}`;
    }
    this.fx("fiveCard", { playerId: player.id, targetId: target ? victim.id : null, card: info.hidden ? "hidden" : type });
    if (mirrored) {
      target.fiveEffects.mirror -= 1;
      this.fiveReveal(target, "mirror", `🪞 Lustro! ${target.nick} odbija kartę „${info.name}” w stronę ${player.nick}`);
    }
    if (bounced) {
      player.fiveEffects.mirror -= 1;
      this.fiveReveal(player, "mirror", `🪞🪞 Drugie lustro! ${player.nick} odbija ją z powrotem, karta trafia w ${target.nick}`, 1900);
    }
    this.announce(text);
    if (info.hostile && target && target !== player) this.fiveBluff(target, 1700);
    if (type === "vampire" || type === "roulette") {
      this.fiveAfterLives();
      this.changed();
      return;
    }
    if (type === "angel" || (type === "potato" && stageBefore === "answer")) this.fiveBeginAnswer();
    if (type === "potato" && stageBefore === "ready") this.fiveWatchAsker();
    if (five.stage === "pick" && this.fiveForced[0]) {
      const forced = this.getPlayer(this.fiveForced[0]);
      if (forced && forced.id !== five.askerId) this.fivePrepare(forced);
      else if (forced) this.startFivePick(five.askerId);
    }
    this.changed();
  },

  fiveTrade(player, cardIds) {
    this.requirePhase("game");
    this.requireMode("piec");
    if (!this.five) fail("To teraz niedostępne");
    const ids = [...new Set((Array.isArray(cardIds) ? cardIds : []).map(Number))];
    if (ids.length !== 2) fail("Wybierz dokładnie 2 karty do wymiany");
    const traded = ids.map((id) => (player.cards || []).find((card) => card.id === id));
    if (traded.some((card) => !card)) fail("Nie masz takiej karty");
    const enabled = this.fiveCardPool(player.lives > 0 ? FIVE_CARD_TYPES : GHOST_TYPES);
    const fresh = enabled.filter((type) => !traded.some((card) => card.type === type));
    const pool = fresh.length ? fresh : enabled;
    if (!pool.length) fail("Wszystkie karty są wyłączone");
    player.cards = player.cards.filter((card) => !ids.includes(card.id));
    player.cards.push({ id: ++this.fiveCardSeq, type: pool[crypto.randomInt(pool.length)] });
    this.fx("fiveTrade", { playerId: player.id });
    this.announce(`♻️ ${player.nick} wymienia 2 karty na 1 nową`);
    this.changed();
  },

  adminGiveCard(admin, playerId, type) {
    this.requireAdmin(admin);
    this.requirePhase("game");
    this.requireMode("piec");
    const target = this.requireTarget(playerId);
    if (type !== "random" && !FIVE_CARD_TYPES.includes(type)) fail("Nieznana karta");
    if (target.cards.length >= FIVE_MAX_CARDS) fail(`${target.nick} ma już maksymalnie ${FIVE_MAX_CARDS} kart`);
    const card = type === "random" ? this.randomCard() : { id: ++this.fiveCardSeq, type };
    if (!card) fail("Wszystkie karty są wyłączone");
    target.cards.push(card);
    this.fx("fiveGift", { playerId: target.id });
    this.announce(`🎁 Host daje tajną kartę 🃏 graczowi ${target.nick}`);
    this.changed();
  },

  adminTakeCards(admin, playerId) {
    this.requireAdmin(admin);
    this.requirePhase("game");
    this.requireMode("piec");
    const target = this.requireTarget(playerId);
    if (!target.cards.length) fail(`${target.nick} nie ma kart`);
    target.cards = [];
    this.announce(`🗑️ Host zabiera karty graczowi ${target.nick}`);
    this.changed();
  },

  fiveForceNext() {
    const five = this.five;
    if (!five) return this.startFivePick(null);
    if (five.stage === "pick") {
      const options = this.fiveAlive().filter((p) => p.id !== five.askerId);
      if (!options.length) return this.finish("lastAlive");
      return this.fivePrepare(options[crypto.randomInt(options.length)]);
    }
    if (five.stage === "ready") return this.fiveLaunch();
    if (five.stage === "answer") {
      clearTimeout(five.timer);
      return this.startFiveVote();
    }
    return this.resolveFive(true);
  },

  fiveAfterRemoval(player) {
    const five = this.five;
    this.fiveForced = this.fiveForced.filter((id) => id !== player.id);
    if (!five) return;
    five.votes.delete(player.id);
    if (this.fiveAlive().length <= 1) return this.finish("lastAlive");
    if (five.answererId === player.id || five.askerId === player.id) {
      clearTimeout(five.timer);
      return this.startFivePick(five.askerId === player.id ? null : five.askerId);
    }
    this.evaluateFiveVote();
  },

  fiveView(viewer) {
    const five = this.five;
    if (this.mode !== "piec" || !five) return null;
    const showTask = five.stage !== "ready" || viewer.id === five.askerId;
    const voters = five.stage === "vote" ? this.fiveVoterIds() : [];
    const authors = this.fiveTaskAuthors(five.task);
    return {
      round: five.round,
      stage: five.stage,
      askerId: five.askerId,
      answererId: five.answererId,
      task: showTask && five.task ? five.task.text : null,
      taskAuthor: showTask ? authors : null,
      curses: five.curses,
      stake: five.stake,
      letter: five.letter || null,
      reversed: five.reversed,
      forcedId: this.fiveForced[0] || null,
      voted: [...five.votes.keys()],
      voters: voters.length,
      yes: [...five.votes.values()].filter(Boolean).length,
      no: [...five.votes.values()].filter((v) => !v).length,
      required: this.requiredYes(voters.length),
      canVote: voters.includes(viewer.id),
      myVote: five.votes.has(viewer.id) ? five.votes.get(viewer.id) : null,
      angelUsed: five.angelUsed,
      redone: five.redone,
      final: Boolean(this.fiveFinal),
      answerSeconds: five.stage === "answer" || five.stage === "vote" ? five.answerSeconds || this.fiveAnswerSeconds() : this.fiveAnswerSeconds(),
      last: five.last,
      remainingMs: five.endsAt ? Math.max(0, five.endsAt - Date.now()) : null,
      totalMs: five.totalMs
    };
  },

  fivePlayerView(p, viewer) {
    const cards = p.cards || [];
    return {
      lives: p.lives || 0,
      out: this.mode === "piec" && this.phase !== "lobby" && (p.lives || 0) <= 0,
      cardCount: cards.length,
      rerollsLeft: viewer && viewer.id === p.id ? this.fiveRerollsLeft(p) : null,
      cards: viewer && viewer.id === p.id ? cards.map((card) => ({ id: card.id, type: card.type })) : [],
      curses: p.fiveCurses || [],
      gag: p.fiveGag || 0,
      secrets: HIDDEN_TYPES.reduce((sum, type) => sum + this.fiveEffectCount(p, type), 0),
      effects: viewer && viewer.id === p.id
        ? HIDDEN_TYPES.filter((type) => this.fiveEffectCount(p, type) > 0).map((type) => ({
            type,
            count: this.fiveEffectCount(p, type),
            rounds: FIVE_CARDS[type].timed ? Math.min(FIVE_TIMED_ROUNDS, p.fiveEffects[type]) : null
          }))
        : []
    };
  },

  fiveSummary() {
    const awards = [];
    const top = (key) => [...this.players].filter((p) => p.fiveStats && p.fiveStats[key] > 0).sort((a, b) => b.fiveStats[key] - a.fiveStats[key])[0];
    const best = top("passed");
    if (best) awards.push({ icon: "⚡", title: "Mistrz 5 sekund", text: `${best.nick}: ${best.fiveStats.passed}× zaliczone` });
    const worst = top("failed");
    if (worst) awards.push({ icon: "🫠", title: "Zawieszka", text: `${worst.nick}: ${worst.fiveStats.failed}× niezaliczone` });
    const collector = top("cards");
    if (collector) awards.push({ icon: "🃏", title: "Kolekcjoner kart", text: `${collector.nick}: ${collector.fiveStats.cards} kart` });
    const asked = new Map();
    for (const round of this.fiveHistory) asked.set(round.askerNick, (asked.get(round.askerNick) || 0) + 1);
    const quizmaster = [...asked.entries()].sort((a, b) => b[1] - a[1])[0];
    if (quizmaster) awards.push({ icon: "🎤", title: "Prowadzący z urzędu", text: `${quizmaster[0]}: zadał(a) ${quizmaster[1]} pytań` });
    return {
      mode: "piec",
      awards,
      history: [],
      fiveRounds: this.fiveHistory.map((round) => ({ ...round })),
      totalGuessed: 0
    };
  }
};

module.exports = { methods, FIVE_CARDS };
