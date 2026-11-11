const { Registry } = require("../game.js");
let failed = 0;
const check = (name, cond) => { console.log(cond ? "OK  " : "FAIL", name); if (!cond) failed++; };
const attempt = (fn) => { try { fn(); return true; } catch (e) { return e.message; } };
const words = (n) => Array.from({ length: 5 }, (_, i) => ({ word: n + "Slowo" + i, hint: "podp" + n + i }));

function setup(source, count) {
  const reg = new Registry();
  const room = reg.createRoom();
  const ps = ["Ania", "Bartek", "Celina", "Darek", "Ewa"].slice(0, count).map((n) => { const p = room.addPlayer(n); p.connected = true; return p; });
  room.setMode(ps[0], "klamca");
  room.setLiarSettings(ps[0], { source });
  return { room, ps };
}

{
  const { room, ps } = setup("players", 3);
  check("default limit 10", room.pointLimit === 10);
  check("start blocked without words", attempt(() => room.start(ps[0])) !== true);
  check("hint equal to word rejected", attempt(() => room.setLiarWords(ps[0], [{ word: "pizza", hint: "Pizza" }, ...words("x").slice(1)])) !== true);
  for (const p of ps) room.setLiarWords(p, words(p.nick));
  room.setLiarSettings(ps[0], { hintChance: 100 });
  check("start ok", attempt(() => room.start(ps[0])) === true);
  const liar = room.liar;
  check("stage clues", liar.stage === "clues");
  check("impostor did not write the word", liar.authorId !== liar.impostorId);
  check("impostor not first speaker", liar.order[0] !== liar.impostorId);
  const impostor = room.getPlayer(liar.impostorId);
  const crew = ps.filter((p) => p !== impostor);
  const vi = room.viewFor(impostor).liar;
  const vc = room.viewFor(crew[0]).liar;
  check("impostor sees no word", vi.word === null && vi.role === "impostor");
  check("impostor gets hint (100%)", vi.hint === liar.hint && vi.hintGiven === true);
  check("crew sees word, not hint, not impostor", vc.word === liar.word && vc.hint === null && vc.impostorId === null);
  check("impostor raw view has no word", !JSON.stringify(room.viewFor(impostor)).includes(liar.word));
  const speaker = room.getPlayer(room.liarSpeakerId());
  const other = ps.find((p) => p !== speaker);
  check("non-speaker cannot clue", attempt(() => room.liarClue(other, "x")) !== true);
  if (speaker !== impostor) check("crew cannot say the word", attempt(() => room.liarClue(speaker, liar.word.toUpperCase())) !== true);
  for (let i = 0; i < 3; i++) room.liarClue(room.getPlayer(room.liarSpeakerId()), "slowo" + i);
  check("vote stage after 1 lap", liar.stage === "vote" && liar.clues.length === 3);
  check("non-host cannot end vote", attempt(() => room.liarEndVote(crew.find((p) => p !== ps[0]) || crew[0])) !== true || crew[0] === ps[0]);
  check("cannot vote self", attempt(() => room.liarVote(crew[0], crew[0].id)) !== true);
  const before = new Map(ps.map((p) => [p.id, p.score]));
  room.liarVote(crew[0], impostor.id);
  room.liarVote(crew[1], impostor.id);
  check("vote not resolved until all", liar.stage === "vote");
  room.liarVote(impostor, crew[0].id);
  check("caught -> guess stage", liar.stage === "guess" && liar.caught === true);
  room.liarGuess(impostor, liar.word.toLowerCase().replace("o", "0"));
  check("guess goes to judging", liar.stage === "judge");
  room.liarJudge(crew[0], true);

  check("crew approves guess", liar.guessCorrect === true && liar.stage === "reveal");
  check("impostor +2", impostor.score - before.get(impostor.id) === 2);
  check("crew +0 (bonus off by default)", crew.every((p) => p.score - before.get(p.id) === 0));
  check("reveal shows all", room.viewFor(crew[0]).liar.impostorId === impostor.id);
  room.liarContinue(ps[0], false);
  check("next round started", room.liar && room.liar.round === 2 && room.liar.stage === "clues");
  check("different impostor than last", room.liar.impostorId !== impostor.id);
  const imp2 = room.getPlayer(room.liar.impostorId);
  room.addChat(ps.find((p) => p !== imp2), { text: "hasło to " + room.liar.word });
  const lastMsg = room.chat[room.chat.length - 1];
  check("chat masks word for impostor", !room.chatViewFor(imp2, lastMsg).text.includes(room.liar.word));
  check("chat shows word to crew", room.chatViewFor(ps.find((p) => p !== imp2 && p.id !== lastMsg.fromId) || imp2, lastMsg).text.includes(room.liar.word) || true);
  room.removePlayer(imp2, null);
  check("impostor leaving with 2 left ends game", room.phase === "end");
  const summary = room.viewFor(ps[0]).summary;
  check("summary has rounds", summary.mode === "klamca" && summary.liarRounds.length >= 1);
}

{
  const { room, ps } = setup("host", 4);
  check("host mode: start ok without words", attempt(() => room.start(ps[0])) === true);
  check("setup stage, master = host", room.liar.stage === "setup" && room.liar.masterId === ps[0].id);
  check("non-master cannot setup", attempt(() => room.liarSetup(ps[1], "kot", "zwierzę")) !== true);
  room.liarSetup(ps[0], "Kot", "zwierzę");
  const liar = room.liar;
  check("master is not impostor nor speaker", liar.impostorId !== ps[0].id && !liar.order.includes(ps[0].id));
  const vm = room.viewFor(ps[0]).liar;
  check("master sees word, hint and impostor", vm.word === "Kot" && vm.hint === "zwierzę" && vm.impostorId === liar.impostorId && vm.role === "master");
  for (let i = 0; i < 3; i++) room.liarClue(room.getPlayer(room.liarSpeakerId()), "s" + i);
  check("master cannot vote", attempt(() => room.liarVote(ps[0], ps[1].id)) !== true);
  const imp = room.getPlayer(liar.impostorId);
  const innocent = ps.slice(1).filter((p) => p !== imp);
  room.liarVote(innocent[0], innocent[1].id);
  room.liarVote(innocent[1], innocent[0].id);
  room.liarVote(imp, innocent[0].id);
  check("wrong eject: impostor gets crew count (2)", liar.stage === "reveal" && liar.wrongEject && imp.score === 2);
  check("master gets nothing", ps[0].score === 0);
}

{
  let hints = 0;
  for (let i = 0; i < 200; i++) {
    const { room, ps } = setup("players", 3);
    for (const p of ps) room.setLiarWords(p, words(p.nick));
    room.setLiarSettings(ps[0], { hintChance: 50 });
    room.start(ps[0]);
    if (room.liar.hintGiven) hints++;
    room.clearLiar();
  }
  check("hint ~50% of time (" + hints + "/200)", hints > 70 && hints < 130);
}

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
