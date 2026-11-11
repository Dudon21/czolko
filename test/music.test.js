const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "..", "public", "js", "audio.js"), "utf8");
const start = src.indexOf("const VOLUME_KEY");
const end = src.indexOf("function renderSoundToggle");
const code = src.slice(start, end);

function param(v) {
  return { value: v, setValueAtTime(x) { this.value = x; }, exponentialRampToValueAtTime(x) { this.value = x; }, cancelScheduledValues() {} };
}
let connections = 0;
class Node {
  constructor() { this.gain = param(1); this.frequency = param(0); this.Q = param(0); this.targets = []; }
  connect(t) { this.targets.push(t); connections++; }
  disconnect() { this.targets = []; }
  start() {} stop() {}
}
class Ctx {
  constructor() { this.state = "suspended"; this.currentTime = 0; this.sampleRate = 8000; this.destination = { name: "dest" }; }
  resume() { this.state = "running"; return Promise.resolve(); }
  createGain() { return new Node(); }
  createOscillator() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createBufferSource() { return new Node(); }
  createBuffer() { return { getChannelData: () => new Float32Array(10) }; }
}
const listeners = {};
const store = {};
const elements = { "music-toggle": { classList: { toggle() {} }, title: "" } };
const sandbox = {
  window: { AudioContext: Ctx, matchMedia: () => ({ matches: false }) },
  document: {
    hidden: false,
    body: { classList: { contains: () => false } },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
  },
  storage: { get: (k) => (k in store ? store[k] : null), set: (k, v) => (store[k] = v) },
  $: (id) => elements[id],
  setInterval, clearInterval, setTimeout, performance
};
const run = new Function(...Object.keys(sandbox), code + "; return { sfx, music };");
const { sfx, music } = run(...Object.values(sandbox));

function audible() {
  return Boolean(music.timer) && sfx.musicBus && sfx.musicBus.gain.value > 0;
}
const fire = (name) => (listeners[name] || []).forEach((fn) => fn({ target: {} }));

(async () => {
  let ok = true;
  const check = (name, cond) => { console.log(cond ? "OK  " : "FAIL", name); ok = ok && cond; };
  fire("pointerdown");
  music.toggle();
  await new Promise((r) => setTimeout(r, 20));
  check("first click on music button mutes and music stays off", !audible() && music.enabled === false);
  music.toggle();
  await new Promise((r) => setTimeout(r, 20));
  check("second click turns music on", audible());
  sfx.setLevel(0);
  check("muting effects does not touch music", audible());
  music.toggle();
  check("third click mutes immediately", !audible() && sfx.musicBus.gain.value === 0);
  console.log(ok ? "ALL PASSED" : "FAILED");
  process.exit(ok ? 0 : 1);
})();
