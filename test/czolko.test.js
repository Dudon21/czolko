const { Registry } = require("../game.js");
let failed = 0;
function check(name, cond) {
  console.log(cond ? "OK  " : "FAIL", name);
  if (!cond) failed++;
}
function attempt(fn) {
  try { fn(); return true; } catch { return false; }
}
const reg = new Registry();
const room = reg.createRoom();
const a = room.addPlayer("Ania"), b = room.addPlayer("Bartek"), c = room.addPlayer("Celina"), d = room.addPlayer("Darek");
for (const p of [a, b, c, d]) {
  p.connected = true;
  room.setWords(p, Array.from({ length: 10 }, (_, i) => `${p.nick}-${i}`));
}
check("time limit by non-host fails", !attempt(() => room.setTimeLimit(b, 30)));
room.setTimeLimit(a, 30);
room.start(a);
const view = room.viewFor(a);
check("game remaining ~30 min", view.gameRemainingMs > 29 * 60000 && view.gameRemainingMs <= 30 * 60000);
const active = room.getPlayer(room.activeId);
const other = room.players.find((p) => p !== active);
check("non-active cannot reveal", !attempt(() => room.revealAuthor(other)));
room.revealAuthor(active);
check("score -0.5", active.score === -0.5);
check("cannot reveal twice", !attempt(() => room.revealAuthor(active)));
const selfView = room.viewFor(active).players.find((p) => p.id === active.id);
check("own view has author but not word", selfView.authorNick && selfView.word === null);
check("author is not self", selfView.authorId !== active.id);
room.pointLimit = 1;
room.guess(active);
for (const p of room.voters()) if (room.vote) room.castVote(p, true);
check("time mode ignores point limit", room.phase === "game" && active.score === 0.5);
const next = room.getPlayer(room.activeId);
check("new word has no revealed author", room.viewFor(a).players.every((p) => !p.authorNick));
room.pass(next);
room.pointLimit = 0.5;
room.setTimeLimit(a, 0);
check("switching to points mode ends on limit", room.phase === "end" && room.endReason === "limit");
const s = room.viewFor(a).summary;
check("summary present", s && Array.isArray(s.awards) && s.history.length >= 2);
check("award Błyskawica", s.awards.some((x) => x.title === "Błyskawica"));
check("award Król Passów", s.awards.some((x) => x.title === "Król Passów"));
check("award Detektyw", s.awards.some((x) => x.title === "Detektyw"));
console.log(JSON.stringify(s.awards, null, 1));
room.backToLobby(a);
room.setTimeLimit(a, 1);
room.start(a);
room.gameStartedAt -= 61000;
room.scheduleGameEnd();
check("time runs out -> end(time)", room.phase === "end" && room.endReason === "time");
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
