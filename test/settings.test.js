const { Registry } = require("../game.js");
let failed = 0;
const check = (name, cond) => { console.log(cond ? "OK  " : "FAIL", name); if (!cond) failed++; };
const attempt = (fn) => { try { fn(); return true; } catch (e) { return e.message; } };

function room3(mode) {
  const reg = new Registry();
  const room = reg.createRoom();
  const ps = ["Ania", "Bartek", "Celina"].map((n) => { const p = room.addPlayer(n); p.connected = true; return p; });
  if (mode) room.setMode(ps[0], mode);
  return { room, ps };
}

{
  const { room, ps } = room3();
  check("non-host cannot change", attempt(() => room.setSetting(ps[1], "passPenalty", 2)) !== true);
  check("unknown key rejected", attempt(() => room.setSetting(ps[0], "hack", 2)) !== true);
  check("out of range rejected", attempt(() => room.setSetting(ps[0], "turnSeconds", 5)) !== true);
  check("NaN rejected", attempt(() => room.setSetting(ps[0], "turnSeconds", "abc")) !== true);
  room.setSetting(ps[0], "passPenalty", 2);
  room.setSetting(ps[0], "guessPoints", 3);
  room.setSetting(ps[0], "authorCost", 1.5);
  room.setSetting(ps[0], "helpCost", 0.5);
  room.setSetting(ps[0], "turnSeconds", 90);
  room.setSetting(ps[0], "voteSeconds", 1.37 * 10);
  check("step rounding (13.7 -> 15)", room.settings.voteSeconds === 15);
  for (const p of ps) room.setWords(p, Array.from({ length: 10 }, (_, i) => p.nick + "w" + i));
  room.start(ps[0]);
  check("turn uses 90 s", room.viewFor(ps[0]).turnRemainingMs > 85000 && room.viewFor(ps[0]).turnTotalMs === 90000);
  check("settings visible in state", room.viewFor(ps[1]).settings.passPenalty === 2);
  check("host can change settings during game", attempt(() => room.setSetting(ps[0], "passPenalty", 2)) === true && attempt(() => room.setSetting(ps[1], "passPenalty", 1)) !== true);
  const a = room.getPlayer(room.activeId);
  room.revealAuthor(a);
  check("author cost 1.5", a.score === -1.5);
  room.requestHelp(a, room.players.find((p) => p !== a).id);
  check("help cost 0.5", a.score === -2);
  room.endHelp(a);
  room.pass(a);
  check("pass penalty 2", a.score === -4);
  room.guess(a);
  for (const p of room.voters()) if (room.vote) room.castVote(p, true);
  check("guess points 3", a.score === -1);
}

{
  const { room, ps } = room3("wskazowka");
  room.setSetting(ps[0], "waveBull", 7);
  room.setSetting(ps[0], "waveNear", 5);
  room.setSetting(ps[0], "wavePsychicMax", 1);
  room.setSetting(ps[0], "waveGuessSeconds", 20);
  room.start(ps[0]);
  const author = room.getPlayer(room.wave.scaleAuthorId);
  room.waveSetScale(author, "Zimne", "Gorące");
  const psychic = room.getPlayer(room.wave.psychicId);
  room.waveSetClue(psychic, "herbata");
  check("guess time 20 s", room.wave.totalMs === 20000);
  const [g1, g2] = room.players.filter((p) => p !== psychic);
  const t = room.wave.target;
  room.waveLock(g1, t, true);
  room.waveLock(g2, Math.min(100, t + 8) === t + 8 ? t + 8 : t - 8, true);
  check("perfect (default 5)", g1.score === 5);
  check("near = 5 pts", g2.score === 5);
  check("psychic capped at 1", psychic.score === 1);
}

{
  const { room, ps } = room3("klamca");
  room.setLiarSettings(ps[0], { source: "players" });
  for (const p of ps) room.setLiarWords(p, Array.from({ length: 5 }, (_, i) => ({ word: p.nick + "Haslo" + i, hint: "h" + i })));
  room.setSetting(ps[0], "liarLaps", 1);
  room.setSetting(ps[0], "liarSurvive", 5);
  room.setSetting(ps[0], "liarClueSeconds", 15);
  room.start(ps[0]);
  check("clue time 15 s", room.liar.totalMs === 15000);
  check("laps = 1 in view", room.viewFor(ps[0]).liar.laps === 1);
  for (let i = 0; i < 3; i++) room.liarClue(room.getPlayer(room.liarSpeakerId()), "x" + i);
  check("1 lap -> vote after 3 clues", room.liar.stage === "vote");
  const imp = room.getPlayer(room.liar.impostorId);
  const crew = room.players.filter((p) => p !== imp);
  room.liarVote(crew[0], "skip");
  room.liarVote(crew[1], "skip");
  room.liarVote(imp, crew[0].id);
  check("skip on last lap: impostor survives = 5 pts", imp.score === 5);
}

{
  const { room, ps } = room3();
  room.setSetting(ps[0], "passPenalty", 3);
  room.setSetting(ps[0], "waveBull", 9);
  room.resetSettings(ps[0], "czolko");
  check("reset only czolko keys", room.settings.passPenalty === 1 && room.settings.waveBull === 9);
}

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
