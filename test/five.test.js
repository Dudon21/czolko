const { Registry } = require("../game.js");
let failed = 0;
const check = (name, cond) => { console.log(cond ? "OK  " : "FAIL", name); if (!cond) failed++; };
const attempt = (fn) => { try { fn(); return true; } catch (e) { return e.message; } };

function setup(n = 4, extra) {
  const reg = new Registry();
  const room = reg.createRoom();
  const ps = ["Ania", "Bartek", "Celina", "Darek", "Ewa"].slice(0, n).map((nick) => { const p = room.addPlayer(nick); p.connected = true; return p; });
  room.setMode(ps[0], "piec");
  if (extra) extra(room, ps);
  room.start(ps[0]);
  return { room, ps };
}
const get = (room, id) => room.getPlayer(id);
const ask = (room, target) => {
  if (room.five.stage === "pick") room.fiveChoose(get(room, room.five.askerId), target.id);
};
const answer = (room, pass) => {
  room.fiveStart(get(room, room.five.askerId));
  room.fiveForceNext();
  for (const p of room.players) if (room.five && room.five.stage === "vote" && p.id !== room.five.answererId && p.connected) room.fiveVote(p, pass);
};

{
  const { room, ps } = setup(4, (room, ps) => {
    room.setFiveTasks(ps[1], ["Wymień trzy moje własne zadania", "Wymień trzy moje własne zadania", ""]);
    room.setSetting(ps[0], "fiveStartCards", 2);
  });
  check("own tasks deduped", ps[1].fiveTasks.length === 1);
  check("pool has WK + own", room.allFiveTasks().length >= 140 && room.allFiveTasks().some((t) => t.authorId === ps[1].id));
  check("lives 3, 2 cards", ps.every((p) => p.lives === 3 && p.cards.length === 2 && p.score === 3));
  check("pick stage", room.five.stage === "pick");
  const asker = get(room, room.five.askerId);
  const target = room.players.find((p) => p !== asker);
  const other = room.players.find((p) => p !== asker && p !== target);
  check("non-asker cannot choose", attempt(() => room.fiveChoose(other, target.id)) !== true);
  check("cannot ask self", attempt(() => room.fiveChoose(asker, asker.id)) !== true);
  room.fiveChoose(asker, target.id);
  check("ready: asker sees task, others not", room.viewFor(asker).five.task && room.viewFor(target).five.task === null && room.viewFor(other).five.task === null);
  const t1 = room.five.task.text;
  room.fiveReroll(asker);
  check("reroll changes task", room.five.task.text !== t1);
  check("only asker starts", attempt(() => room.fiveStart(other)) !== true);
  room.fiveStart(asker);
  check("answer 10 s default, task visible to all", room.five.stage === "answer" && room.five.totalMs === 10000 && room.viewFor(other).five.task);
  check("cannot play card during answer", attempt(() => room.fivePlayCard(other, other.cards[0].id, target.id)) !== true);
  room.fiveForceNext();
  check("vote stage", room.five.stage === "vote");
  check("answerer cannot vote", attempt(() => room.fiveVote(target, true)) !== true);
  room.setSetting = room.setSetting;
  room.settings.fiveCardChance = 100;
  room.fiveVote(asker, true);
  room.fiveVote(other, true);
  check("2/3 yes -> passed, target becomes asker", room.five.stage === "pick" && room.five.askerId === target.id);
  check("card granted (100%)", target.cards.length === 3);
  const next = room.players.find((p) => p !== target);
  room.fiveChoose(target, next.id);
  room.fiveStart(target);
  room.fiveForceNext();
  for (const p of room.players) if (p !== next && room.five.stage === "vote") room.fiveVote(p, false);
  check("fail -> -1 life, asker stays", next.lives === 2 && next.score === 2 && room.five.askerId === target.id);
}

{
  const { room, ps } = setup(3, (room) => { room.settings.fiveLives = 1; room.settings.fiveStartCards = 0; });
  const asker = get(room, room.five.askerId);
  const [a, b] = room.players.filter((p) => p !== asker);
  room.fiveChoose(asker, a.id);
  answer(room, false);
  check("eliminated at 0 lives", a.lives === 0 && room.viewFor(asker).players.find((p) => p.id === a.id).out);
  check("cannot ask eliminated", room.phase === "game" && attempt(() => room.fiveChoose(asker, a.id)) !== true);
  check("final 1v1 picks the rival automatically", room.five.stage === "ready" && room.five.askerId === asker.id && room.five.answererId === b.id && room.viewFor(asker).five.final);
  answer(room, false);
  check("last alive -> end", room.phase === "end" && room.endReason === "lastAlive");
  const results = room.viewFor(asker).results;
  check("winner first, last out second", results[0].id === asker.id && results[1].id === b.id && results[2].id === a.id);
  check("summary rounds", room.viewFor(asker).summary.fiveRounds.length === 2);
}

{
  const { room, ps } = setup(4, (room) => { room.settings.fiveStartCards = 0; });
  const asker = get(room, room.five.askerId);
  const [a, b, c] = room.players.filter((p) => p !== asker);
  a.cards.push({ id: 900, type: "torpedo" });
  room.fivePlayCard(a, 900, b.id);
  check("torpedo: forced to b with stake 2", room.five.stage === "ready" && room.five.answererId === b.id && room.five.stake === 2);
  answer(room, false);
  check("torpedo fail -2", b.lives === 1);
  const asker2 = get(room, room.five.askerId);
  c.cards.push({ id: 901, type: "double" });
  const victim = room.players.find((p) => p !== asker2 && p !== c && p.lives > 0);
  room.fivePlayCard(c, 901, victim.id);
  check("double: forced first", room.five.answererId === victim.id);
  answer(room, true);
  check("double: same asker, victim again", room.five.askerId === asker2.id && room.five.answererId === victim.id && room.five.stage === "ready");
  answer(room, true);
  check("after double passes ball to victim", room.five.askerId === victim.id && room.five.stage === "pick");
}

{
  const { room } = setup(4, (room) => { room.settings.fiveStartCards = 0; });
  const asker = get(room, room.five.askerId);
  const [a, b] = room.players.filter((p) => p !== asker);
  a.cards.push({ id: 1, type: "english" }, { id: 2, type: "reverse" }, { id: 3, type: "angel" }, { id: 4, type: "ally" }, { id: 5, type: "revive" });
  room.fivePlayCard(a, 1, b.id);
  check("curse stored", b.fiveCurses.includes("english"));
  room.fiveChoose(asker, b.id);
  check("curse moves to question", room.five.curses.includes("english") && b.fiveCurses.length === 0);
  room.fiveStart(asker);
  room.fiveForceNext();
  room.fivePlayCard(a, 3);
  check("angel: back to answer", room.five.stage === "answer" && room.five.angelUsed);
  room.fiveForceNext();
  for (const p of room.players) if (p !== b && room.five.stage === "vote") room.fiveVote(p, true);
  const askerNow = get(room, room.five.askerId);
  check("b asker after pass", askerNow === b);
  room.fiveChoose(b, a.id);
  check("reverse only by answerer", attempt(() => room.fivePlayCard(b, 2)) !== true);
  room.fivePlayCard(a, 2);
  check("reverse swaps", room.five.reversed && room.five.answererId === b.id && room.five.askerId === a.id);
  const aLives = a.lives;
  answer(room, false);
  check("reverse fail: owner +1, b keeps lives, b asks next", a.lives === aLives + 1 && b.lives === 3 && room.five.askerId === b.id);
  check("ally needs 2 lives", attempt(() => room.fivePlayCard(a, 4, b.id)) === true && a.lives === aLives && b.lives === 5);
  b.lives = 0;
  room.fivePlayCard(a, 5, b.id);
  check("revive", b.lives === 1);
}

{
  const { room } = setup(3);
  const asker = get(room, room.five.askerId);
  const target = room.players.find((p) => p !== asker);
  room.fiveChoose(asker, target.id);
  room.removePlayer(asker, null);
  check("asker leaves -> two left duel right away", room.phase === "game" && room.five.stage === "ready" && room.five.askerId !== asker.id);
  room.adminEndGame(room.players.find((p) => room.canManage(p)));
  check("admin end ok", room.phase === "end");
}

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
