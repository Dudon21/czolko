const { io } = require("socket.io-client");
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } else console.log("ok:", m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function client() { const s = io("http://localhost:3482", { forceNew: true }); const c = { s, state: null, raw: [], wc: [] }; s.onAny((e, d) => c.raw.push(JSON.stringify(d || ""))); s.on("state", (d) => (c.state = d)); s.on("wordChanged", (d) => c.wc.push(d)); c.call = (e, p = {}) => new Promise((r) => s.emit(e, p, r)); return c; }
const words = (p) => Array.from({ length: 10 }, (_, i) => `${p}${i}`);
(async () => {
  const a = client(), b = client(); await wait(300);
  await a.call("createRoom", { nick: "Ania" }); await b.call("joinRoom", { nick: "Bartek", code: a.state.code });
  await a.call("setWords", { words: words("aaa") }); await b.call("setWords", { words: words("bbb") });
  await a.call("startGame"); await wait(50);
  const bId = b.state.me.id;
  const before = a.state.players.find((p) => p.id === bId).word, pool = a.state.poolSize;
  assert((await b.call("admin:reroll", { playerId: bId })).ok === false, "non-host cannot reroll");
  b.raw = [];
  assert((await a.call("admin:reroll", { playerId: bId })).ok, "host rerolls");
  await wait(50);
  const after = a.state.players.find((p) => p.id === bId).word;
  assert(after && after !== before && after.startsWith("aaa"), `new word ${before} -> ${after}`);
  assert(a.state.poolSize === pool - 1, "old word discarded, not returned");
  assert(!b.raw.some((r) => r.includes(after)), "target never receives new word");
  assert(b.wc.length === 1 && b.wc[0].reason === "rerolled", "target notified");
  console.log("ALL OK"); process.exit(0);
})();
