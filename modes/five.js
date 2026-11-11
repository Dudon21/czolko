const crypto = require("crypto");
const { fail } = require("../lib/errors");
const { joinNames, cleanText, textKey } = require("../lib/text");
const { normalizeGuess } = require("../public/match");
const { TASKS } = require("../data/five-tasks");

const FIVE_MAX_TASKS = 30;
const FIVE_MAX_TASK = 140;
const FIVE_MAX_CARDS = 5;
const FIVE_CARDS = {
  revive: { icon: "🧟", name: "Wskrzeszenie", text: "Przywraca do gry osobę, która odpadła (też ciebie), z 1 życiem", target: "dead" },
  angel: { icon: "😇", name: "Anioł stróż", text: "Podczas głosowania: odpowiadający dostaje drugie podejście (nowy czas na odpowiedź)", target: null },
  torpedo: { icon: "💣", name: "Torpeda", text: "Wskazana osoba musi odpowiadać na następne pytanie. Jak nie zaliczy, traci 2 życia", target: "other" },
  ally: { icon: "🤝", name: "Sojusznik", text: "Oddajesz 1 swoje życie, wskazana osoba dostaje 2", target: "other" },
  double: { icon: "🔁", name: "Dwa z rzędu", text: "Wskazana osoba odpowiada na 2 następne pytania z rzędu", target: "alive" },
  english: { icon: "🫖", name: "Po angielsku", text: "Wskazana osoba odpowiada na następne pytanie po angielsku", target: "alive" },
  disco: { icon: "🎤", name: "Disco polo", text: "Wskazana osoba śpiewa następną odpowiedź w stylu disco polo", target: "alive" },
  four: { icon: "4️⃣", name: "Cztery zamiast trzech", text: "Wskazana osoba w następnym pytaniu musi podać 4 odpowiedzi", target: "alive" },
  reverse: { icon: "🔄", name: "Odwrotka", text: "Gdy ktoś cię pyta: pytający sam musi odpowiedzieć. Jak nie zaliczy, dostajesz +1 życie", target: null }
};
const FIVE_CARD_TYPES = Object.keys(FIVE_CARDS);
const CURSE_TYPES = ["torpedo", "english", "disco", "four"];

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
    this.five = null;
  },

  fiveAlive() {
    return this.players.filter((p) => p.lives > 0);
  },

  fiveSyncScore(player) {
    player.score = Math.max(0, player.lives);
  },

  randomCard() {
    return { id: ++this.fiveCardSeq, type: FIVE_CARD_TYPES[crypto.randomInt(FIVE_CARD_TYPES.length)] };
  },

  giveCard(player) {
    if (player.cards.length >= FIVE_MAX_CARDS) return null;
    const card = this.randomCard();
    player.cards.push(card);
    return card;
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
      ? setTimeout(() => {
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
    const forced = this.fiveForced[0] && this.getPlayer(this.fiveForced[0]);
    if (forced && forced.id !== asker.id) {
      this.fx("turn", { playerId: asker.id });
      return this.fivePrepare(forced);
    }
    this.fx("turn", { playerId: asker.id });
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
    five.stake = five.curses.includes("torpedo") ? 2 : 1;
    five.task = this.drawFiveTask();
    five.stage = "ready";
    const asker = this.getPlayer(five.askerId);
    this.announce(`🎯 ${asker ? asker.nick : "?"} pyta: ${target.nick}`);
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
    this.fiveBeginAnswer();
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
    this.changed();
  },

  fiveBeginAnswer() {
    const five = this.five;
    five.stage = "answer";
    five.votes = new Map();
    this.activeId = five.answererId;
    this.fx("fiveGo", { playerId: five.answererId });
    this.fiveSchedule(this.settings.fiveAnswerSeconds * 1000, () => this.startFiveVote());
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
      nextAskerId = this.fiveForced[0] === answerer.id ? five.askerId : answerer.id;
    } else if (answerer) {
      lost = Math.min(answerer.lives, five.stake);
      answerer.lives -= lost;
      this.fiveSyncScore(answerer);
      if (answerer.lives <= 0) answerer.fiveOut = ++this.fiveOutSeq;
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
    this.fx("fiveResult", { playerId: five.answererId, passed, lost, out, card: Boolean(card), reversed: five.reversed });
    const name = answerer ? answerer.nick : "?";
    if (five.reversed) {
      const owner = this.getPlayer(five.reverseOwnerId);
      this.announce(passed ? `🔄 ${name} obronił(a) się przed odwrotką` : `🔄 ${name} nie zaliczył(a)! ${owner ? owner.nick : "?"} dostaje +1 ❤️`);
    } else if (passed) {
      this.announce(`✅ ${name} zalicza (${yes}:${no})${card ? " i dostaje tajną kartę 🃏" : ""}`);
    } else {
      this.announce(`❌ ${name} nie zalicza (${yes}:${no}), −${lost} ❤️${out ? ". Odpada! 💀" : ""}`);
    }
    this.startFivePick(nextAskerId);
  },

  fivePlayCard(player, cardId, targetId) {
    this.requirePhase("game");
    this.requireMode("piec");
    const five = this.five;
    if (!five) fail("To teraz niedostępne");
    if (five.stage === "answer") fail("Teraz leci 5 sekund, poczekaj chwilę");
    const index = (player.cards || []).findIndex((card) => card.id === Number(cardId));
    if (index < 0) fail("Nie masz takiej karty");
    const card = player.cards[index];
    const info = FIVE_CARDS[card.type];
    if (card.type !== "revive" && player.lives <= 0) fail("Odpadłeś, możesz zagrać tylko Wskrzeszenie");
    let target = null;
    if (info.target) {
      target = this.requireTarget(targetId);
      if (info.target === "dead" && target.lives > 0) fail("Ta osoba jeszcze gra");
      if (info.target !== "dead" && target.lives <= 0) fail("Ta osoba już odpadła");
      if (info.target === "other" && target === player) fail("Wybierz kogoś innego");
    }
    let text;
    if (card.type === "revive") {
      target.lives = 1;
      target.fiveOut = 0;
      this.fiveSyncScore(target);
      text = `🧟 ${player.nick} wskrzesza: ${target.nick} wraca z 1 ❤️`;
    } else if (card.type === "angel") {
      if (five.stage !== "vote") fail("Anioła stróża grasz podczas głosowania");
      if (five.angelUsed) fail("Anioł stróż już pomógł w tym pytaniu");
      five.angelUsed = true;
      const answerer = this.getPlayer(five.answererId);
      text = `😇 ${player.nick} zagrywa Anioła stróża! ${answerer ? answerer.nick : "?"} ma drugie podejście`;
    } else if (card.type === "torpedo") {
      if (this.fiveForced.includes(target.id)) fail("Ta osoba już ma wymuszone pytanie");
      this.fiveForced.push(target.id);
      target.fiveCurses.push("torpedo");
      text = `💣 ${player.nick} wystrzeliwuje torpedę w: ${target.nick}`;
    } else if (card.type === "ally") {
      if (player.lives < 2) fail("Potrzebujesz co najmniej 2 żyć, żeby oddać jedno");
      player.lives -= 1;
      target.lives += 2;
      this.fiveSyncScore(player);
      this.fiveSyncScore(target);
      text = `🤝 ${player.nick} oddaje życie, ${target.nick} dostaje +2 ❤️`;
    } else if (card.type === "double") {
      this.fiveForced.push(target.id, target.id);
      text = `🔁 ${player.nick}: ${target.nick} odpowiada na 2 pytania z rzędu`;
    } else if (CURSE_TYPES.includes(card.type)) {
      target.fiveCurses.push(card.type);
      text = `${info.icon} ${player.nick} zagrywa „${info.name}” na: ${target.nick}`;
    } else if (card.type === "reverse") {
      if (five.stage !== "ready" || five.answererId !== player.id) fail("Odwrotkę grasz, kiedy ktoś cię pyta (przed startem)");
      if (five.reversed) fail("Odwrotka już zagrana");
      player.fiveCurses.push(...five.curses.filter((type) => type !== "torpedo"));
      five.curses = [];
      five.stake = 1;
      five.reversed = true;
      five.reverseOwnerId = player.id;
      five.answererId = five.askerId;
      five.askerId = player.id;
      const victim = this.getPlayer(five.answererId);
      text = `🔄 ${player.nick} zagrywa Odwrotkę! Odpowiada ${victim ? victim.nick : "?"}`;
    }
    player.cards.splice(index, 1);
    this.fx("fiveCard", { playerId: player.id, targetId: target ? target.id : null, card: card.type });
    this.announce(text);
    if (card.type === "angel") this.fiveBeginAnswer();
    if (five.stage === "pick" && this.fiveForced[0]) {
      const forced = this.getPlayer(this.fiveForced[0]);
      if (forced && forced.id !== five.askerId) this.fivePrepare(forced);
      else if (forced) this.startFivePick(five.askerId);
    }
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
    if (five.stage === "ready") return this.fiveBeginAnswer();
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
      curses: p.fiveCurses || []
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
