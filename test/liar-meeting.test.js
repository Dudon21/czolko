const { Registry } = require("../game.js");
let failed = 0;
const check = (name, cond) => { console.log(cond ? "OK  " : "FAIL", name); if (!cond) failed++; };
const attempt = (fn) => { try { fn(); return true; } catch (e) { return e.message; } };

function setup(n = 4, laps) {
  const reg = new Registry();
  const room = reg.createRoom();
  const ps = ["Ania", "Bartek", "Celina", "Darek", "Ewa"].slice(0, n).map((nick) => { const p = room.addPlayer(nick); p.connected = true; return p; });
  room.setMode(ps[0], "klamca");
  room.setLiarSettings(ps[0], { source: "players" });
  for (const p of ps) room.setLiarWords(p, Array.from({ length: 5 }, (_, i) => ({ word: p.nick + "Haslo" + i, hint: "h" + i })));
  if (laps) room.setSetting(ps[0], "liarLaps", laps);
  room.start(ps[0]);
  const imp = room.getPlayer(room.liar.impostorId);
  const crew = room.players.filter((p) => p !== imp);
  return { room, ps, imp, crew };
}
const lap = (room) => { const n = room.liar.order.length; for (let i = 0; i < n; i++) room.liarClue(room.getPlayer(room.liarSpeakerId()), "slowo" + room.liar.turn); };

{
  const { room, ps, imp, crew } = setup(4, 3);
  check("defaults: 300 s vote, 60 s guess", room.settings.liarVoteSeconds === 300 && room.settings.liarGuessSeconds === 60);
  lap(room);
  check("vote after 1 lap", room.liar.stage === "vote" && room.liar.totalMs === 300000);
  check("view: canVote", room.viewFor(crew[0]).liar.canVote === true);
  for (const p of room.players) room.liarVote(p, "skip");
  check("all skip -> lap 2 clues", room.liar.stage === "clues" && room.liar.lap === 2 && room.liar.votes.size === 0);
  lap(room);
  check("vote again after lap 2", room.liar.stage === "vote");
  room.liarVote(crew[0], crew[1].id);
  room.liarVote(crew[1], crew[0].id);
  room.liarVote(crew[2], "skip");
  room.liarVote(imp, "skip");
  check("skip majority (2 skip vs 1/1) -> lap 3", room.liar.stage === "clues" && room.liar.lap === 3);
  lap(room);
  room.liarVote(crew[0], crew[1].id);
  room.liarVote(crew[1], crew[0].id);
  room.liarVote(crew[2], "skip");
  room.liarVote(imp, crew[2].id);
  check("tie on last lap -> impostor survives", room.liar.stage === "reveal" && imp.score === room.settings.liarSurvive && !room.liar.wrongEject);
  check("history laps 3", room.liarHistory[0].laps === 3);
}

{
  const { room, imp, crew } = setup(5);
  lap(room);
  for (const p of room.players) if (p !== crew[0]) room.liarVote(p, p === imp ? crew[1].id : crew[0] === p ? crew[1].id : crew[0].id === p.id ? crew[1].id : crew[0].id);
  room.liarVote(crew[0], crew[1].id);
  check("innocent ejected -> reveal", room.liar.stage === "reveal" && room.liar.wrongEject);
  check("impostor gets crew count (4)", imp.score === 4);
  check("crew 0", crew.every((p) => p.score === 0));
  check("view wrongEject", room.viewFor(crew[0]).liar.wrongEject === true);
}

{
  const { room, ps, imp, crew } = setup(4);
  lap(room);
  check("cannot vote self", attempt(() => room.liarVote(crew[0], crew[0].id)) !== true);
  for (const p of crew) room.liarVote(p, imp.id);
  room.liarVote(imp, crew[0].id);
  check("impostor caught -> guess 60 s", room.liar.stage === "guess" && room.liar.totalMs === 60000);
  check("crew cannot guess", attempt(() => room.liarGuess(crew[0], "x")) !== true);
  room.liarGuess(imp, "");
  check("aloud guess -> judge", room.liar.stage === "judge" && room.liar.guess.includes("na głos"));
  check("impostor cannot judge", attempt(() => room.liarJudge(imp, true)) !== true);
  check("crew sees guess", room.viewFor(crew[0]).liar.judgeGuess.includes("na głos") && room.viewFor(crew[0]).liar.canJudge);
  room.liarJudge(crew[0], true);
  check("1/3 yes not yet", room.liar.stage === "judge");
  room.liarJudge(crew[1], true);
  check("2/3 yes -> saved", room.liar.stage === "reveal" && room.liar.guessCorrect && imp.score === room.settings.liarSaved);
}

{
  const { room, imp, crew } = setup(4);
  lap(room);
  for (const p of crew) room.liarVote(p, imp.id);
  room.liarVote(imp, crew[0].id);
  room.liarGuess(imp, room.liar.word);
  room.liarJudge(crew[0], false);
  room.liarJudge(crew[1], false);
  check("2/3 no -> caught, crew +1 each", room.liar.stage === "reveal" && !room.liar.guessCorrect && crew.every((p) => p.score === 1) && imp.score === 0);
}

{
  const { room, ps, imp, crew } = setup(4);
  lap(room);
  for (const p of crew) room.liarVote(p, imp.id);
  room.liarVote(imp, crew[0].id);
  room.liarGuess(imp, room.liar.word);
  room.liarEndVote(ps[0]);
  check("judge timeout without votes -> auto match", room.liar.guessCorrect === true);
}

{
  const reg = new Registry();
  const room = reg.createRoom();
  const ps = ["Ania", "Bartek", "Celina", "Darek"].map((nick) => { const p = room.addPlayer(nick); p.connected = true; return p; });
  room.setMode(ps[0], "klamca");
  room.setLiarSettings(ps[0], { source: "host" });
  room.start(ps[0]);
  room.liarSetup(ps[0], "pizza", "jedzenie");
  const imp = room.getPlayer(room.liar.impostorId);
  const crew = room.players.filter((p) => p !== imp && p !== ps[0]);
  lap(room);
  check("master cannot vote", attempt(() => room.liarVote(ps[0], imp.id)) !== true);
  check("master view canVote false", room.viewFor(ps[0]).liar.canVote === false);
  for (const p of crew) room.liarVote(p, imp.id);
  room.liarVote(imp, crew[0].id);
  room.liarGuess(imp, "pizza");
  check("master can judge", room.liarJudgeIds().includes(ps[0].id) && room.liarJudgeIds().length === 3);
  room.liarJudge(ps[0], true);
  room.liarJudge(crew[0], true);
  check("master+crew approve -> saved", room.liar.guessCorrect === true);
  room.adminEndGame(ps[0]);
  const summary = room.viewFor(ps[0]).summary;
  check("summary ok", summary.mode === "klamca" && summary.liarRounds.length === 1);
}

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
