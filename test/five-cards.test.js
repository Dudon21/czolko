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
  check("same secret card stacks", attempt(() => room.fivePlayCard(a, give(a, "shield"))) === true && a.fiveEffects.shield === 2);
  room.fiveChoose(asker, a.id);
  check("extra time only before a player is chosen", attempt(() => room.fivePlayCard(b, give(b, "bonus"))) !== true);
  room.fiveStart(asker);
  check("extra time adds three seconds and shows up", room.five.answerSeconds === 13 && events.some((text) => text.includes("Dogrywka")));
  const lives = a.lives;
  finish(room, false);
  check("shield saves the life and shows up", a.lives === lives && events.some((text) => text.includes("Tarcza")) && a.fiveEffects.shield === 1);
  check("one shield used, the second still waits", room.viewFor(b).players.find((p) => p.id === a.id).secrets === 1);
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

{
  const { room, events, effects } = setup();
  const { asker, others } = roles(room);
  const [a, b] = others;
  room.fivePlayCard(a, give(a, "legend"));
  check("legendary card looks like any secret card", events.filter((text) => text.includes("tajną kartę")).length === 1 && !events.some((text) => text.includes("Legendarn")) && room.viewFor(b).players.find((p) => p.id === a.id).secrets === 1);
  const before = JSON.stringify([a.lives, a.fiveCurses, b.lives]);
  room.fivePlayCard(b, give(b, "english"), a.id);
  check("a nasty card reveals it and it changes nothing", events.some((text) => text.includes("Legendarną")) && !a.fiveEffects.legend && a.fiveCurses.includes("english") && JSON.parse(before)[0] === a.lives);
  check("reveal is sent as an activated card", effects.some((e) => e.type === "fiveCard" && e.card === "legend" && e.activated));
  room.fivePlayCard(a, give(a, "legend"));
  room.fiveChoose(asker, a.id);
  const lives = a.lives;
  finish(room, false);
  check("failing reveals it and the life is still lost", a.lives === lives - 1 && !a.fiveEffects.legend && events.filter((text) => text.includes("Legendarną")).length === 2);
}

{
  const { room, events } = setup();
  const { asker, others } = roles(room);
  const [a] = others;
  room.fivePlayCard(a, give(a, "legend"));
  room.fiveChoose(asker, a.id);
  finish(room, true);
  check("passing keeps the legendary card hidden", a.fiveEffects.legend && !events.some((text) => text.includes("Legendarną")));
}

{
  const { room, events } = setup();
  const { asker, others } = roles(room);
  const [a, b] = others;
  room.fivePlayCard(a, give(a, "mirror"));
  room.fivePlayCard(b, give(b, "mirror"));
  room.fivePlayCard(a, give(a, "english"), b.id);
  check("two mirrors: the card bounces twice and lands on the chosen player", b.fiveCurses.includes("english") && !a.fiveCurses.includes("english"));
  check("both mirrors burn", a.fiveEffects.mirror === 0 && b.fiveEffects.mirror === 0 && events.filter((text) => text.includes("ustro")).length === 2);
  room.fivePlayCard(a, give(a, "four"), b.id);
  check("no mirrors left: next card lands normally", b.fiveCurses.includes("four"));
}

{
  const { room, events, effects } = setup();
  const { asker, others } = roles(room);
  const [a, b] = others;
  room.fivePlayCard(a, give(a, "fenix"));
  check("phoenix shows three questions to its owner only", room.viewFor(a).players.find((p) => p.id === a.id).effects[0].rounds === 3 && room.viewFor(b).players.find((p) => p.id === a.id).secrets === 1);
  room.fiveChoose(asker, a.id);
  const lives = a.lives;
  finish(room, false);
  check("phoenix turns a fail into +1 life and burns out", a.lives === lives + 1 && a.fiveEffects.fenix === 0 && events.some((text) => text.includes("Feniks")));
  check("result fx marks the rebirth", effects.some((e) => e.type === "fiveResult" && e.reborn));
}

{
  const { room, events } = setup();
  const { asker, others } = roles(room);
  const [a, b, c] = others;
  room.fivePlayCard(a, give(a, "fenix"));
  for (let i = 0; i < 3; i++) {
    const current = room.getPlayer(room.five.askerId);
    if (room.five.stage === "pick") room.fiveChoose(current, [b, c, asker].find((p) => p !== current && p.lives > 0).id);
    finish(room, true);
  }
  check("phoenix expires quietly after three questions", a.fiveEffects.fenix === 0 && !events.some((text) => text.includes("Feniks")));
}

{
  const { room, events } = setup();
  const { asker, others } = roles(room);
  const [a] = others;
  room.fivePlayCard(a, give(a, "stink"));
  room.fiveChoose(asker, a.id);
  check("skunk stays hidden until START", room.five.answererId === a.id && !events.some((text) => text.includes("Śmierdziel")));
  room.fiveStart(asker);
  check("START flips the question onto the asker", room.five.stage === "answer" && room.five.answererId === asker.id && room.five.askerId === a.id && events.some((text) => text.includes("Śmierdziel")));
  const lives = asker.lives;
  finish(room, false);
  check("the asker pays for the fail", asker.lives === lives - 1 && a.lives === 3 && a.fiveEffects.stink === 0);
}

{
  const { room } = setup();
  const { asker, others } = roles(room);
  const [a] = others;
  room.fivePlayCard(a, give(a, "stink"));
  room.fivePlayCard(asker, give(asker, "stink"));
  room.fiveChoose(asker, a.id);
  room.fiveStart(asker);
  check("two skunks cancel out", room.five.answererId === a.id && a.fiveEffects.stink === 0 && asker.fiveEffects.stink === 0);
}

{
  const { room, events } = setup(4, (room) => { room.settings.fiveLives = 1; });
  const { asker, others } = roles(room);
  const [a, b, c] = others;
  room.fiveChoose(asker, a.id);
  finish(room, false);
  check("a is a ghost", a.lives === 0);
  check("ghost still cannot play life-only cards", attempt(() => room.fivePlayCard(a, give(a, "ally"), b.id)) !== true);
  check("ghost must pick who gets a secret card", attempt(() => room.fivePlayCard(a, give(a, "shield"))) !== true);
  room.fivePlayCard(a, a.cards.find((card) => card.type === "shield").id, b.id);
  check("ghost gives a shield to a living friend", b.fiveEffects.shield === 1 && events.some((text) => text.includes("tajną kartę na: " + b.nick)));
  check("ghost can gag the living", attempt(() => room.fivePlayCard(a, give(a, "gag"), c.id)) === true && c.fiveGag === 2);
  room.fivePlayCard(a, give(a, "vampire"), c.id);
  check("ghost vampire kills and comes back to life", c.lives === 0 && a.lives === 1 && !room.viewFor(b).players.find((p) => p.id === a.id).out && events.some((text) => text.includes("wraca do gry")));
}

{
  const { room, peeks, events } = setup();
  const { asker, others } = roles(room);
  const [a, b] = others;
  room.fivePlayCard(a, give(a, "mirror"));
  const bLives = b.lives;
  room.fivePlayCard(b, give(b, "ally"), a.id);
  check("mirror bounces a gift too: the giver ends up +1", b.lives === bLives + 1 && a.lives === 3 && a.fiveEffects.mirror === 0);
  room.fivePlayCard(a, give(a, "mirror"));
  give(b, "angel");
  give(a, "revive");
  room.fivePlayCard(b, give(b, "peek"), a.id);
  check("mirrored peek shows the peeker's cards to the mirror owner", peeks.length === 1 && peeks[0].player === a && peeks[0].payload.nick === b.nick && peeks[0].payload.cards.includes("angel"));
  check("mirror reveals are announced", events.filter((text) => text.includes("Lustro")).length === 2);
}

{
  const { room } = setup();
  const { asker, others } = roles(room);
  const [a] = others;
  room.fivePlayCard(asker, give(asker, "mirror"));
  room.fivePlayCard(a, give(a, "stink"));
  room.fiveChoose(asker, a.id);
  room.fiveStart(asker);
  check("mirror sends the skunk back: the asked player answers anyway", room.five.answererId === a.id && a.fiveEffects.stink === 0 && asker.fiveEffects.mirror === 0);
}

{
  const { room } = setup();
  const { asker, others } = roles(room);
  const [a] = others;
  room.fivePlayCard(asker, give(asker, "mirror"));
  room.fiveChoose(asker, a.id);
  room.fivePlayCard(a, give(a, "reverse"));
  check("mirror sends the reverse back", room.five.answererId === a.id && !room.five.reversed && asker.fiveEffects.mirror === 0);
}

{
  const { room } = setup();
  const { asker, others } = roles(room);
  const [a, b] = others;
  room.fivePlayCard(b, give(b, "mirror"));
  room.fiveChoose(asker, a.id);
  room.fivePlayCard(a, give(a, "potato"), b.id);
  check("mirror sends the hot potato back", room.five.answererId === a.id && b.fiveEffects.mirror === 0);
}

{
  const { room } = setup(2);
  const [x, y] = room.players;
  x.lives = 10;
  y.fiveEffects.mirror = 6;
  for (let i = 0; i < 6; i++) room.fivePlayCard(x, give(x, "roulette"));
  check("mirror turns every roulette hit back on the thrower", y.lives === 3 && x.lives === 4);
}

{
  const { room } = setup();
  const { asker, others } = roles(room);
  const [a, b] = others;
  room.fivePlayCard(b, give(b, "torpedo"), a.id);
  room.fivePlayCard(b, give(b, "english"), a.id);
  room.fiveChoose(asker, a.id);
  room.fivePlayCard(a, give(a, "reverse"));
  check("reverse hands every curse back, torpedo included", a.fiveCurses.includes("torpedo") && a.fiveCurses.includes("english") && room.five.stake === 1);
}

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
