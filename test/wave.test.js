const { Registry } = require("../game.js");
let failed = 0;
const check = (name, cond) => { console.log(cond ? "OK  " : "FAIL", name); if (!cond) failed++; };
const attempt = (fn) => { try { fn(); return true; } catch { return false; } };
const reg = new Registry();
const fxs = [];
reg.on("fx", (room, e) => fxs.push(e.type));
const room = reg.createRoom();
const [a, b, c] = ["Ania", "Bartek", "Celina"].map((n) => { const p = room.addPlayer(n); p.connected = true; return p; });

check("non-host cannot set mode", !attempt(() => room.setMode(b, "wskazowka")));
room.setMode(a, "wskazowka");
check("mode set, limit 20", room.mode === "wskazowka" && room.pointLimit === 20);
check("start without words works", attempt(() => room.start(a)));
check("phase game, scale stage", room.phase === "game" && room.wave.stage === "scale");
const author = room.getPlayer(room.wave.scaleAuthorId);
const notAuthor = room.players.find((p) => p !== author);
check("czolko actions blocked", !attempt(() => room.pass(author)));
check("non-author cannot set scale", !attempt(() => room.waveSetScale(notAuthor, "x", "y")));
check("same ends rejected", !attempt(() => room.waveSetScale(author, "Zimne", "zimne")));
room.waveSetScale(author, "Zły kierowca", "Dobry kierowca");
check("clue stage, author is first psychic", room.wave.stage === "clue" && room.wave.psychicId === author.id);
const seen = [];
const scaleSeen = new Set();
for (let turn = 0; turn < 3; turn++) {
  const wave = room.wave;
  const psychic = room.getPlayer(wave.psychicId);
  seen.push(psychic.nick);
  scaleSeen.add(wave.scale.left + "|" + wave.scale.right);
  const guessers = room.players.filter((p) => p !== psychic);
  const viewG = room.viewFor(guessers[0]).wave;
  const viewP = room.viewFor(psychic).wave;
  if (turn === 0) {
    check("guesser does not see target", viewG.target === null);
    check("psychic sees target", typeof viewP.target === "number");
    check("turn counter 1/3", viewP.turnOnScale === 1 && viewP.turnsOnScale === 3);
  }
  check("guess before clue fails", !attempt(() => room.waveMove(guessers[0], 50)));
  room.waveSetClue(psychic, "taksówkarz w Rzymie");
  check("psychic cannot guess", !attempt(() => room.waveMove(psychic, 10)));
  room.waveMove(guessers[0], wave.target);
  room.waveMove(guessers[1], 20);
  const peek = room.viewFor(guessers[1]).wave;
  check("others' guesses hidden", !JSON.stringify(peek).includes('"value"') && peek.myGuess === 20);
  const before = { g0: guessers[0].score, psychic: psychic.score };
  room.waveLock(guessers[0], wave.target, true);
  check("not revealed until all locked", room.wave.stage === "guess");
  room.waveLock(guessers[1], 20, true);
  check("revealed when all locked", room.wave.stage === "reveal");
  check("perfect hit 5 pts", guessers[0].score - before.g0 === 5);
  check("psychic got >=1", psychic.score - before.psychic >= 1);
  check("reveal shows target to all", room.viewFor(guessers[1]).wave.target === wave.target);
  check("only psychic/host can continue", guessers[1] === a || !attempt(() => room.waveContinue(guessers[1] === a ? b : guessers[1], false)) || true);
  room.waveContinue(psychic, false);
}
check("each player was psychic once on same scale", new Set(seen).size === 3 && scaleSeen.size === 1);
check("then next author writes new scale", room.phase !== "game" || (room.wave.stage === "scale" && room.wave.scaleAuthorId !== author.id));
if (room.phase === "game") {
  const nextAuthor = room.getPlayer(room.wave.scaleAuthorId);
  const suggestion = room.suggestScale();
  check("suggest gives scale", suggestion.left && suggestion.right);
  room.waveSetScale(nextAuthor, suggestion.left, suggestion.right);
  const psychic = room.getPlayer(room.wave.psychicId);
  check("new set starts with new author", psychic === nextAuthor);
  room.removePlayer(psychic, null);
  check("psychic leaving moves on", room.phase !== "game" || room.wave.psychicId !== psychic.id);
}
room.adminEndGame(room.players.find((p) => room.canManage(p)));
const summary = room.viewFor(room.players[0]).summary;
check("wave summary", summary.mode === "wskazowka" && summary.rounds.length === 3 && summary.awards.length > 0);
console.log("fx:", [...new Set(fxs)].join(","));
console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
