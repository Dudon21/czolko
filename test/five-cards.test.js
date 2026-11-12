const { Registry } = require("../game.js");

let failed = 0;
const check = (name, cond) => { console.log(cond ? "OK  " : "FAIL", name); if (!cond) failed++; };
const attempt = (fn) => { try { fn(); return true; } catch (e) { return e.message; } };
let seq = 5000;

function setup(count = 4, extra) {
  const reg = new Registry();
  const events = [];
  const peeks = [];
  const effects = [];
  reg.on("event", (room, text) => events.push(text));
  reg.on("fivePeek", (room, player, payload) => peeks.push({ player, payload }));
  reg.on("fx", (room, payload) => effects.push(payload));
  const room = reg.createRoom();
  const ps = ["Ania", "Bartek", "Celina", "Darek", "Ewa"].slice(0, count).map((nick) => { const p = room.addPlayer(nick); p.connected = true; return p; });
  room.setMode(ps[0], "piec");
  room.settings.fiveStartCards = 0;
  room.settings.fiveCardChance = 0;
  room.settings.fiveGhostEvery = 0;
  if (extra) extra(room, ps);
  room.start(ps[0]);
  return { room, ps, events, peeks, effects };
}
const give = (player, type) => { const card = { id: ++seq, type }; player.cards.push(card); return card.id; };
const roles = (room) => {
  const asker = room.getPlayer(room.five.askerId);
  const others = room.players.filter((p) => p !== asker);
  return { asker, others };
};
const finish = (room, pass) => {
  if (room.five.stage === "ready") room.fiveStart(room.getPlayer(room.five.askerId));
  if (room.five.stage === "answer") room.fiveForceNext();
  for (const p of room.players) if (room.five && room.five.stage === "vote" && p.id !== room.five.answererId) room.fiveVote(p, pass);
};

{
  const { room } = setup();
  check("disco polo is gone", !Object.keys(require("../modes/five").FIVE_CARDS).includes("disco"));
  const { asker, others } = roles(room);
  const [a, b, c] = others;
  const english = give(c, "english");
  const torpedo = give(c, "torpedo");
  const shield = give(c, "shield");
  room.fiveChoose(asker, a.id);
  check("curse blocked after a player is chosen", attempt(() => room.fivePlayCard(c, english, a.id)) !== true && c.cards.length === 3);
  check("torpedo blocked after a player is chosen", attempt(() => room.fivePlayCard(c, torpedo, b.id)) !== true);
  check("life and secret cards still allowed", attempt(() => room.fivePlayCard(c, shield)) === true);
  room.fiveStart(asker);
  check("nothing during the answer", attempt(() => room.fivePlayCard(c, english, a.id)) !== true);
  room.fiveForceNext();
  check("curse allowed during voting, lands on the next question", attempt(() => room.fivePlayCard(c, english, b.id)) === true && b.fiveCurses.includes("english") && !room.five.curses.includes("english"));
}

{
  const { room, events } = setup();
  const { asker, others } = roles(room);
  const [a, b] = others;
  room.fivePlayCard(b, give(b, "letter"), a.id);
  room.fivePlayCard(b, give(b, "sprint"), a.id);
  room.fivePlayCard(b, give(b, "vabanque"), a.id);
  room.fiveChoose(asker, a.id);
  const view = room.viewFor(b).five;
  check("letter drawn and shown", /^[A-Z]$/.test(view.letter) && view.curses.includes("letter"));
  check("va banque raises the stake", view.stake === 2);
  room.fiveStart(asker);
  check("sprint halves the time", room.five.answerSeconds === 5);
  const lives = a.lives;
  finish(room, true);
  check("va banque pass gives a life", a.lives === lives + 1 && events.some((text) => text.includes("Va banque")));
}

{
  const { room } = setup();
  const { asker, others } = roles(room);
  const [a, b] = others;
  room.fivePlayCard(b, give(b, "vabanque"), a.id);
  room.fiveChoose(asker, a.id);
  const lives = a.lives;
  finish(room, false);
  check("va banque fail costs two lives", a.lives === lives - 2);
}

{
  const { room, events, effects } = setup();
  const { asker, others } = roles(room);
  const [a, b] = others;
  room.fivePlayCard(a, give(a, "bonus"));
  room.fivePlayCard(a, give(a, "shield"));
  check("secret cards announced without a name", events.filter((text) => text.includes("tajną kartę")).length === 2 && !events.some((text) => /Tarcz|Dogrywk/.test(text)));
  check("fx hides the card type", effects.filter((e) => e.type === "fiveCard").every((e) => e.card === "hidden"));
  check("others see only a count", room.viewFor(b).players.find((p) => p.id === a.id).secrets === 2 && room.viewFor(b).players.find((p) => p.id === a.id).effects.length === 0);
  check("owner sees which ones", room.viewFor(a).players.find((p) => p.id === a.id).effects.length === 2);
  check("same secret card twice refused", attempt(() => room.fivePlayCard(a, give(a, "shield"))) !== true);
  room.fiveChoose(asker, a.id);
  check("extra time only before a player is chosen", attempt(() => room.fivePlayCard(b, give(b, "bonus"))) !== true);
  room.fiveStart(asker);
  check("extra time adds three seconds and shows up", room.five.answerSeconds === 13 && events.some((text) => text.includes("Dogrywka")));
  const lives = a.lives;
  finish(room, false);
  check("shield saves the life and shows up", a.lives === lives && events.some((text) => text.includes("Tarcza")) && !a.fiveEffects.shield);
  check("shield is single use", room.viewFor(b).players.find((p) => p.id === a.id).secrets === 0);
}

{
  const { room, events } = setup();
  const { asker, others } = roles(room);
  const [a, b] = others;
  room.fivePlayCard(a, give(a, "mirror"));
  room.fivePlayCard(b, give(b, "english"), a.id);
  check("mirror sends the curse back", b.fiveCurses.includes("english") && !a.fiveCurses.includes("english") && events.some((text) => text.includes("Lustro")));
  room.fivePlayCard(b, give(b, "english"), a.id);
  check("mirror works once", a.fiveCurses.includes("english"));
  room.fivePlayCard(a, give(a, "mirror"));
  const aLives = a.lives;
  const bLives = b.lives;
  room.fivePlayCard(b, give(b, "vampire"), a.id);
  check("mirrored vampire bites the thrower", b.lives === bLives - 1 && a.lives === aLives + 1);
}

{
  const { room, peeks, events } = setup();
  const { asker, others } = roles(room);
  const [a, b] = others;
  give(a, "revive");
  give(a, "angel");
  room.fivePlayCard(b, give(b, "peek"), a.id);
  check("peek goes only to the player who looked", peeks.length === 1 && peeks[0].player === b && peeks[0].payload.cards.length === 2 && !events.some((text) => /Wskrzeszenie|Anioł/.test(text)));
  room.fivePlayCard(b, give(b, "thief"), a.id);
  check("thief moves one card", a.cards.length === 1 && b.cards.length === 1);
  check("thief needs a target with cards", attempt(() => room.fivePlayCard(b, give(b, "thief"), asker.id)) !== true);
  b.cards = [];
  room.fivePlayCard(b, give(b, "draw"));
  check("draw two gives two cards", b.cards.length === 2);
  room.fivePlayCard(a, give(a, "gag"), b.id);
  check("gagged player cannot play", attempt(() => room.fivePlayCard(b, b.cards[0].id, a.id)) !== true && room.viewFor(a).players.find((p) => p.id === b.id).gag === 2);
  const target = others.find((p) => p !== b);
  room.fiveChoose(asker, target.id);
  finish(room, true);
  check("gag counts down per question", b.fiveGag === 1);
}

{
  const { room } = setup();
  const { asker, others } = roles(room);
  const [a, b, c] = others;
  room.fiveChoose(asker, a.id);
  check("only the asked player can pass the question", attempt(() => room.fivePlayCard(b, give(b, "potato"), c.id)) !== true);
  const potato = give(a, "potato");
  room.fiveStart(asker);
  const before = room.five.endsAt;
  room.fivePlayCard(a, potato, b.id);
  check("hot potato during the answer restarts the clock for the new player", room.five.stage === "answer" && room.five.answererId === b.id && room.five.endsAt >= before);
  const lives = b.lives;
  finish(room, false);
  check("the new player takes the hit", b.lives === lives - 1 && a.lives === 3);
}

{
  const { room } = setup();
  const { asker, others } = roles(room);
  const [a] = others;
  room.fiveChoose(asker, a.id);
  room.fivePlayCard(a, give(a, "potato"), asker.id);
  check("hot potato at the asker swaps the roles", room.five.stage === "ready" && room.five.answererId === asker.id && room.five.askerId === a.id);
}

{
  const { room, events } = setup(4, (room) => { room.settings.fiveLives = 1; });
  const { asker, others } = roles(room);
  const [a, b] = others;
  room.fivePlayCard(a, give(a, "vampire"), b.id);
  check("vampire kills at one life", b.lives === 0 && a.lives === 2 && room.viewFor(a).players.find((p) => p.id === b.id).out);
  const total = room.players.reduce((sum, p) => sum + p.lives, 0);
  room.fivePlayCard(a, give(a, "roulette"));
  check("roulette takes exactly one life", room.players.reduce((sum, p) => sum + p.lives, 0) === total - 1 && events.some((text) => text.includes("Ruletka")));
  check("game goes on or ends cleanly", room.phase === "game" || room.endReason === "lastAlive");
}

{
  const { room } = setup();
  const { others } = roles(room);
  const [a] = others;
  const first = give(a, "english");
  const second = give(a, "four");
  check("trade needs two cards", attempt(() => room.fiveTrade(a, [first])) !== true && attempt(() => room.fiveTrade(a, [first, first])) !== true);
  check("cannot trade cards you do not hold", attempt(() => room.fiveTrade(a, [first, 999999])) !== true);
  room.fiveTrade(a, [first, second]);
  check("two cards become one different card", a.cards.length === 1 && !["english", "four"].includes(a.cards[0].type));
  for (const type of Object.keys(require("../modes/five").FIVE_CARDS)) room.setFiveCard(room.players.find((p) => room.canManage(p)), type, false);
  const x = give(a, "english");
  check("trade refused when every card is off", attempt(() => room.fiveTrade(a, [a.cards[0].id, x])) !== true && a.cards.length === 2);
}

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
