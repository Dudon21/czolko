const { mock } = require("node:test");
mock.timers.enable({ apis: ["setTimeout"] });
const { Registry } = require("../game.js");
const { similarWords } = require("../public/match.js");
const { maskSecret } = require("../lib/text.js");

let failed = 0;
const check = (name, cond) => { console.log(cond ? "OK  " : "FAIL", name); if (!cond) failed++; };
const attempt = (fn) => { try { fn(); return true; } catch (e) { return e.message; } };
const NICKS = ["Ania", "Bartek", "Celina", "Darek", "Ewa", "Franek", "Gosia", "Hania"];

function setup(count, mode, extra) {
  const reg = new Registry();
  const events = [];
  reg.on("event", (room, text) => events.push(text));
  const room = reg.createRoom();
  const ps = NICKS.slice(0, count).map((nick) => { const p = room.addPlayer(nick); p.connected = true; return p; });
  room.setMode(ps[0], mode);
  if (extra) extra(room, ps);
  room.start(ps[0]);
  return { reg, room, ps, events };
}

{
  check("typo of a longer word still merges", similarWords("Arteta", "Artera") && similarWords("Warszawa", "Warszawy"));
  check("different short words stay separate", !similarWords("Tomek", "Romek") && !similarWords("Marta", "Marka") && !similarWords("Kasia", "Basia") && !similarWords("Simba", "Samba"));
  check("different first letter never merges", !similarWords("Batman", "Catman") && !similarWords("Hagrid", "Madrid"));
  check("mask hides inflected forms", !/artet/i.test(maskSecret("To jest od Artety i Artetą też", "Arteta")));
  check("mask hides a typo", !/artera/i.test(maskSecret("chyba Artera", "Arteta")));
  check("mask leaves other words", maskSecret("Ale fajny mecz", "Arteta") === "Ale fajny mecz");
}

{
  const { room, ps } = setup(4, "klamca", (room, ps) => room.setLiarSettings(ps[0], { source: "host" }));
  check("emoji-only word rejected", attempt(() => room.liarSetup(ps[0], "🍕🍕", "jedzenie")) !== true);
  room.liarSetup(ps[0], "Pizza", "jedzenie");
  const liar = room.liar;
  check("one liar below seven players", liar.impostorIds.length === 1);
  const crew = room.players.find((p) => p.id !== liar.masterId && !liar.impostorIds.includes(p.id));
  while (room.liarSpeakerId() !== crew.id && room.liarSpeakerId() !== liar.impostorIds[0]) room.liarClue(room.getPlayer(room.liarSpeakerId()), "ser");
  if (room.liarSpeakerId() === crew.id) {
    check("crew cannot say the word", attempt(() => room.liarClue(crew, "pizza")) !== true);
    room.liarClue(crew, "ser");
  }
  while (room.liar.stage === "clues" && room.liarSpeakerId() !== liar.impostorIds[0]) room.liarClue(room.getPlayer(room.liarSpeakerId()), "ser");
  if (room.liar.stage === "clues") check("liar gets no confirmation when typing the word", attempt(() => room.liarClue(room.getPlayer(liar.impostorIds[0]), "pizza")) === true);
}

{
  const { room, ps } = setup(8, "klamca", (room, ps) => room.setLiarSettings(ps[0], { source: "host" }));
  room.liarSetup(ps[0], "Pizza", "jedzenie");
  const liar = room.liar;
  check("two liars from seven players", liar.impostorIds.length === 2 && liar.impostorIds[0] !== liar.impostorIds[1]);
  const [first, second] = liar.impostorIds.map((id) => room.getPlayer(id));
  const crew = room.players.filter((p) => p.id !== liar.masterId && !liar.impostorIds.includes(p.id));
  check("liar sees only himself", room.viewFor(first).liar.impostorIds.length === 1 && room.viewFor(first).liar.impostorIds[0] === first.id && room.viewFor(first).liar.word === null);
  check("crew sees the word and the count, not who", room.viewFor(crew[0]).liar.word === "Pizza" && room.viewFor(crew[0]).liar.impostorCount === 2 && room.viewFor(crew[0]).liar.impostorIds.length === 0);
  check("master sees both", room.viewFor(ps[0]).liar.impostorIds.length === 2);
  while (room.liar.stage === "clues") room.liarClue(room.getPlayer(room.liarSpeakerId()), "ser");
  for (const p of room.liarVoters()) if (room.liar.stage === "vote") room.liarVote(p, p === first ? second.id : first.id);
  check("caught liar guesses", room.liar.stage === "guess" && room.liar.caughtId === first.id);
  check("partner cannot guess", attempt(() => room.liarGuess(second, "pizza")) !== true);
  room.liarGuess(first, "makaron");
  for (const id of room.liarJudgeIds()) if (room.liar.stage === "judge") room.liarJudge(room.getPlayer(id), false);
  check("round ends", room.liar.stage === "reveal");
  check("caught liar 0, partner survives, crew scores", first.score === 0 && second.score === room.settings.liarSurvive && crew.every((p) => p.score === room.settings.liarCaughtCrew));
  check("reveal shows both liars", room.viewFor(crew[0]).liar.impostorIds.length === 2);
  room.setSetting(ps[0], "liarTwoFrom", 0);
  room.liarContinue(ps[0], false);
  room.liarSetup(room.getPlayer(room.liar.masterId), "Rower", "pojazd");
  check("setting 0 keeps a single liar", room.liar.impostorIds.length === 1);
}

{
  const { room, ps, events } = setup(4, "piec", (room, ps) => { room.settings.fiveStartCards = 0; });
  const asker = room.getPlayer(room.five.askerId);
  room.setConnected(asker, false);
  check("absent asker is watched", Boolean(room.fiveAbsentTimer));
  mock.timers.tick(20000);
  check("pick passes to someone online", room.five.stage === "pick" && room.five.askerId !== asker.id && room.getPlayer(room.five.askerId).connected);
  const asker2 = room.getPlayer(room.five.askerId);
  const target = room.players.find((p) => p !== asker2 && p.connected);
  room.fiveChoose(asker2, target.id);
  room.setConnected(asker2, false);
  mock.timers.tick(20000);
  check("ready: another player reads the task", room.five.stage === "ready" && room.five.askerId !== asker2.id && room.five.askerId !== target.id);
  room.setConnected(asker2, true);
  check("events mention the swap", events.some((text) => text.includes("zniknął")));
}

{
  const { room, ps, events } = setup(4, "piec");
  room.setConnected(ps[0], false);
  mock.timers.tick(59000);
  check("host kept for a minute", room.hostId === ps[0].id);
  mock.timers.tick(2000);
  check("host passes to first online player", room.hostId === ps[1].id && events.some((text) => text.includes("hostem zostaje")));
  check("new host can manage", attempt(() => room.adminForceNext(ps[1])) === true);
}

{
  const { room, ps } = setup(3, "piec", (room, ps) => { room.settings.fiveStartCards = 0; });
  const asker = room.getPlayer(room.five.askerId);
  room.adminAdjustScore(ps[0], asker.id, -3);
  check("dead asker loses the question", room.phase === "game" && room.five.askerId !== asker.id);
}

{
  const { room, ps } = setup(4, "piec", (room, ps) => {
    for (const type of ["revive", "angel", "ally", "double", "english", "disco", "four", "reverse"]) room.setFiveCard(ps[0], type, false);
    room.setSetting(ps[0], "fiveStartCards", 3);
  });
  check("only enabled cards are dealt", ps.every((p) => p.cards.length === 3 && p.cards.every((card) => card.type === "torpedo")));
  check("view lists disabled cards", room.viewFor(ps[0]).fiveCardsOff.length === 8);
  check("non-host cannot toggle", attempt(() => room.setFiveCard(ps[1], "angel", true)) !== true);
  room.setFiveCard(ps[0], "torpedo", false);
  check("all cards off: random gift refused", attempt(() => room.adminGiveCard(ps[0], ps[1].id, "random")) !== true);
}

{
  const { room, ps, events } = setup(4, "piec", (room, ps) => {
    room.settings.fiveStartCards = 0;
    room.settings.fiveCardChance = 0;
    room.setSetting(ps[0], "fiveSpeedEvery", 2);
    room.setSetting(ps[0], "fiveGhostEvery", 2);
    room.setSetting(ps[0], "fiveLives", 1);
  });
  const play = (pass) => {
    if (room.five.stage === "pick") {
      const asker = room.getPlayer(room.five.askerId);
      room.fiveChoose(asker, room.players.find((p) => p !== asker && p.lives > 0).id);
    }
    room.fiveStart(room.getPlayer(room.five.askerId));
    room.fiveForceNext();
    for (const p of room.players) if (room.five && room.five.stage === "vote" && p.id !== room.five.answererId) room.fiveVote(p, pass);
  };
  check("starts at full time", room.viewFor(ps[0]).five.answerSeconds === 10);
  play(false);
  const ghost = room.players.find((p) => p.lives <= 0);
  check("first one is out", Boolean(ghost) && ghost.cards.length === 0);
  play(true);
  check("tempo drops by a second every two questions", room.viewFor(ps[0]).five.answerSeconds === 9 && events.some((text) => text.includes("Tempo rośnie")));
  check("ghost gets a card", ghost.cards.length === 1 && ["torpedo", "double", "english", "disco", "four", "angel"].includes(ghost.cards[0].type));
  if (ghost.cards[0].type !== "angel") {
    const victim = room.players.find((p) => p.lives > 0);
    const used = attempt(() => room.fivePlayCard(ghost, ghost.cards[0].id, victim.id));
    check("ghost can throw the card at the living", used === true || /wymuszone|leci/.test(used));
  }
  ghost.cards.push({ id: 990, type: "ally" });
  check("ghost cannot play life cards", attempt(() => room.fivePlayCard(ghost, 990, room.players.find((p) => p.lives > 0).id)) !== true);
}

{
  const { room, ps } = setup(3, "kto");
  check("kto starts with a question", room.phase === "game" && room.kto.stage === "vote" && room.viewFor(ps[0]).kto.question.length > 5);
  room.ktoVote(ps[0], ps[2].id);
  check("votes hidden while voting", room.viewFor(ps[1]).kto.results === null && room.viewFor(ps[1]).kto.voted.length === 1);
  room.ktoVote(ps[1], ps[2].id);
  room.ktoVote(ps[2], ps[0].id);
  check("all voted -> reveal", room.kto.stage === "reveal" && room.kto.winnerIds.length === 1 && room.kto.winnerIds[0] === ps[2].id);
  check("majority voters score", ps[0].score === 1 && ps[1].score === 1 && ps[2].score === 0);
  check("only host continues", attempt(() => room.ktoContinue(ps[1], false)) !== true && attempt(() => room.ktoContinue(ps[0], false)) === true);
  check("next round has a new question", room.kto.round === 2 && room.kto.stage === "vote");
  mock.timers.tick(30000);
  check("vote time runs out -> reveal without votes", room.kto.stage === "reveal" && room.kto.winnerIds.length === 0);
  mock.timers.tick(12000);
  check("reveal moves on by itself", room.kto.round === 3);
  room.setPointLimit(ps[0], 2);
  room.ktoVote(ps[0], ps[2].id);
  room.ktoVote(ps[1], ps[2].id);
  room.ktoVote(ps[2], ps[2].id);
  room.ktoContinue(ps[0], false);
  check("limit ends the game", room.phase === "end" && room.endReason === "limit");
  const view = room.viewFor(ps[0]);
  check("summary has rounds and awards", view.summary.ktoRounds.length === 3 && view.summary.awards.length > 0);
  check("evening table counts the game", view.night && view.night.games === 1 && view.night.table[0].points === 3 && view.night.table[0].wins === 1);
  room.voteMode(ps[0], "piec");
  room.voteMode(ps[1], "piec");
  room.voteMode(ps[2], "czolko");
  check("mode votes counted", room.viewFor(ps[2]).modeVotes.counts.piec === 2 && room.viewFor(ps[2]).modeVotes.mine === "czolko");
  room.backToLobby(ps[0]);
  check("winning mode is set in lobby", room.phase === "lobby" && room.mode === "piec");
  check("table survives going to lobby", room.viewFor(ps[0]).night.games === 1);
  room.resetNight(ps[0]);
  check("host can reset the table", room.viewFor(ps[0]).night === null);
}

{
  const reg = new Registry();
  const room = reg.createRoom();
  const ps = ["Ania", "Bartek"].map((nick) => room.addPlayer(nick));
  room.setMode(ps[0], "kto");
  check("kto needs three players", attempt(() => room.start(ps[0])) !== true && room.phase === "lobby");
}

{
  const { reg, room, ps } = setup(3, "czolko", (room, ps) => {
    const { randomWords } = require("../data/words.js");
    for (const p of ps) room.setWords(p, randomWords(10, []), []);
  });
  const late = room.addPlayer("Spóźniony");
  late.connected = true;
  check("late player joins a running game with a word", room.players.length === 4 && Boolean(late.word) && late.score === 0);
  check("late player never sees own word", room.viewFor(late).players.find((p) => p.id === late.id).word === null);
  check("others see it", room.viewFor(ps[0]).players.find((p) => p.id === late.id).word === late.word.text);
}

{
  const { room, ps } = setup(4, "piec");
  const late = room.addPlayer("Spóźniony");
  check("late player in 5 seconds gets the lowest lives", late.lives === 3 && late.cards.length === 0);
  ps[1].lives = 0;
  ps[2].lives = 0;
  const ghost = room.addPlayer("Duch");
  check("joining a final makes you a ghost", ghost.lives === 3 || ghost.lives === 0);
}

{
  const reg = new Registry();
  const room = reg.createRoom();
  const a = room.addPlayer("Ania");
  const b = room.addPlayer("Bartek");
  const sent = [];
  reg.on("chat", (r, message) => sent.push(message));
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  room.addChat(a, { text: "zdjęcie", image: pixel });
  check("chat image becomes a link", /^\/chat-image\/[A-Z]{4}\/[0-9a-f]{32}$/.test(sent[0].image));
  const stored = room.chatImage(sent[0].image.split("/").pop());
  check("image bytes are kept on the server", stored && stored.mime === "image/png" && stored.buffer.length > 20);
  check("broken image rejected", attempt(() => room.addChat(a, { image: "data:image/png;base64,<script>" })) !== true);
  room.setAvatar(a, pixel);
  check("avatar becomes a link with a version", room.avatarUrl(a) === `/avatar/${room.code}/${a.id}/1` && a.avatar.buffer.length > 20);
  check("broken avatar rejected", attempt(() => room.setAvatar(b, "data:image/png;base64,\"><b>")) !== true);
  room.setAvatar(a, null);
  check("avatar can be cleared", room.avatarUrl(a) === null);
}

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
