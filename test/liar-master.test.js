const { Registry } = require("../game.js");
let failed = 0;
const check = (name, cond) => { console.log(cond ? "OK  " : "FAIL", name); if (!cond) failed++; };
const attempt = (fn) => { try { fn(); return true; } catch (e) { return e.message; } };
function setup(masterMode) {
  const reg = new Registry();
  const room = reg.createRoom();
  const ps = ["Ania", "Bartek", "Celina", "Darek"].map((n) => { const p = room.addPlayer(n); p.connected = true; return p; });
  room.setMode(ps[0], "klamca");
  room.setLiarSettings(ps[0], { source: "host", masterMode });
  return { room, ps };
}
function playRound(room) {
  const master = room.getPlayer(room.liar.masterId);
  room.liarSetup(master, "Kot", "zwierzę");
  while (room.liar.stage !== "reveal") room.liarForceNext();
  return master.nick;
}
{
  const { room, ps } = setup("rotate");
  room.setSetting(ps[0], "liarLaps", 1);
  room.start(ps[0]);
  const masters = [];
  for (let i = 0; i < 5; i++) {
    masters.push(playRound(room));
    room.liarContinue(ps[0], false);
    if (room.phase !== "game") break;
  }
  console.log("rotation:", masters.join(" → "));
  check("rotation visits everyone in order", masters.join(",") === "Ania,Bartek,Celina,Darek,Ania");
  check("cannot pick master in rotate mode", attempt(() => room.liarChooseMaster(ps[0], ps[2].id)) !== true);
}
{
  const { room, ps } = setup("fixed");
  room.liarChooseMaster(ps[0], ps[2].id);
  check("lobby pick shown", room.viewFor(ps[1]).liarMasterId === ps[2].id);
  check("non-host cannot pick in lobby", attempt(() => room.liarChooseMaster(ps[1], ps[3].id)) !== true);
  room.start(ps[0]);
  check("picked master leads round 1", room.liar.masterId === ps[2].id);
  playRound(room);
  room.liarChooseMaster(ps[2], ps[3].id);
  check("current master can hand over at reveal", room.liarMasterPick === ps[3].id && room.liar.masterId === ps[2].id);
  room.liarContinue(ps[0], false);
  check("new master next round", room.liar.masterId === ps[3].id);
  playRound(room);
  room.liarContinue(ps[0], false);
  check("stays the same until changed", room.liar.masterId === ps[3].id);
  room.liarChooseMaster(ps[0], ps[1].id);
  check("host change during setup applies now", room.liar.masterId === ps[1].id && room.activeId === ps[1].id);
  room.removePlayer(ps[1], null);
  check("picked master left -> falls back", room.phase !== "game" || room.liar.masterId !== ps[1].id);
}
console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
