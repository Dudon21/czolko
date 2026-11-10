const PROFILE = new URLSearchParams(location.search).get("p") || "";
const TOKEN_KEY = `czolko-token${PROFILE}`;
const NICK_KEY = `czolko-nick${PROFILE}`;
const NOTES_KEY = `czolko-notes${PROFILE}`;
const CAMERA_KEY = `czolko-camera${PROFILE}`;
const WORDS_PER_PLAYER = 10;
const BRUSH_COLORS = ["#111111", "#e63946", "#f77f00", "#ffd60a", "#2a9d8f", "#4cc9f0", "#3a0ca3", "#f15bb5", "#8d5524", "#f1c27d"];
const BRUSH_SIZES = [3, 7, 14];
const SHAPE_TOOLS = ["rect", "square", "triangle", "circle"];
const UNDO_LIMIT = 30;
const ROLL_TIME_MS = 5000;
const ROOM_WARNING_SECONDS = 120;
const ROLL_REVEAL_FROM = 0.6;
const SCRAMBLE_CHARS = "#$%&@*?!+=<>{}[]/\~^";
const SECRET_DECOYS = ["???", "?!?", "¿??", "?¿?", "??¿", "!??", "??!", "???"];

const $ = (id) => document.getElementById(id);

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
  }
};

const THEME_KEY = "czolko-theme";

function applyTheme(theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  $("theme-toggle").textContent = theme === "dark" ? "☀️" : "🌙";
}

applyTheme(storage.get(THEME_KEY) === "dark" ? "dark" : "light");
$("theme-toggle").onclick = () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  storage.set(THEME_KEY, next);
  applyTheme(next);
};

const store = {
  state: null,
  avatars: new Map(),
  voteDeadline: 0,
  helpDeadline: 0,
  gameDeadline: 0,
  turnDeadline: 0,
  roomDeadline: 0,
  selfInGrid: storage.get(`czolko-layout${PROFILE}`) !== "corner",
  replaced: false
};

const socket = io();

function call(event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, response) => {
      resolve(err ? { ok: false, error: "Brak połączenia z serwerem" } : response);
    });
  });
}

async function act(event, payload) {
  const response = await call(event, payload);
  if (!response.ok) toast(response.error, true);
  return response;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function show(node, visible) {
  node.classList.toggle("hidden", !visible);
}

function showScreen(name) {
  for (const screen of document.querySelectorAll(".screen")) show(screen, screen.id === `screen-${name}`);
}

function toast(text, isError = false) {
  const node = el("div", `toast${isError ? " toast-error" : ""}`, text);
  $("toasts").appendChild(node);
  setTimeout(() => node.remove(), 4500);
}

function ask(text, onYes) {
  $("modal-text").textContent = text;
  show($("modal"), true);
  $("modal-yes").onclick = () => {
    show($("modal"), false);
    onYes();
  };
  $("modal-no").onclick = () => show($("modal"), false);
}

function fmtScore(value) {
  return String(Math.round(value * 10) / 10).replace(".", ",").replace("-", "−");
}

const VOLUME_KEY = "czolko-volume";
const VOLUME_LEVELS = [0.7, 0.35, 0];
const VOLUME_ICONS = ["🔊", "🔉", "🔇"];
const TURN_TOTAL_MS = 45000;
const REACTIONS = ["😂", "🔥", "👏", "😱", "🤦", "🤔", "💀", "❤️"];

const sfx = {
  ctx: null,
  master: null,
  noiseBuffer: null,
  level: (() => {
    const saved = storage.get(VOLUME_KEY);
    const value = saved === null ? VOLUME_LEVELS[0] : Number(saved);
    return Number.isFinite(value) ? value : VOLUME_LEVELS[0];
  })(),
  lastPlayed: new Map(),

  ensure() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.level;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = music.enabled ? 1 : 0;
      this.musicBus.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  },

  setLevel(value) {
    this.level = value;
    storage.set(VOLUME_KEY, String(value));
    if (this.master) this.master.gain.value = value;
  },

  tone(freq, start, duration, options = {}) {
    const { type = "sine", vol = 0.2, slide = 0, attack = 0.01, vibrato = 0, at = 0, out = this.master } = options;
    const ctx = this.ctx;
    const t = (at || ctx.currentTime) + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + duration);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = vibrato;
      depth.gain.value = freq * 0.035;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + duration + 0.05);
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  },

  noise(start, duration, options = {}) {
    const { vol = 0.15, freq = 2000, q = 0.8, filter = "bandpass", at = 0, out = this.master } = options;
    const ctx = this.ctx;
    if (!this.noiseBuffer) {
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = (at || ctx.currentTime) + start;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const band = ctx.createBiquadFilter();
    band.type = filter;
    band.frequency.value = freq;
    band.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(band);
    band.connect(gain);
    gain.connect(out);
    source.start(t, Math.random() * 0.5);
    source.stop(t + duration + 0.05);
  },

  drumroll(length, start = 0) {
    for (let t = 0; t < length; t += 0.045) {
      this.noise(start + t, 0.06, { vol: 0.04 + 0.16 * (t / length), freq: 2400 });
    }
  },

  chord(notes, start, duration, type, vol) {
    for (const note of notes) this.tone(note, start, duration, { type, vol });
  },

  sounds: {
    tick() { this.tone(1500, 0, 0.04, { type: "square", vol: 0.04 }); },
    tickHard() {
      this.tone(1900, 0, 0.06, { type: "square", vol: 0.09 });
      this.noise(0, 0.03, { vol: 0.05, freq: 5000 });
    },
    myTurn() {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.08, 0.28, { type: "triangle", vol: 0.22 }));
      this.tone(1568, 0.34, 0.4, { type: "sine", vol: 0.08 });
    },
    turn() {
      this.tone(660, 0, 0.12, { vol: 0.12 });
      this.tone(880, 0.1, 0.2, { vol: 0.12 });
    },
    countBeep() { this.tone(440, 0, 0.18, { type: "square", vol: 0.1 }); },
    go() {
      this.tone(880, 0, 0.55, { type: "square", vol: 0.12 });
      this.tone(1320, 0, 0.55, { type: "triangle", vol: 0.1 });
      this.noise(0, 0.5, { vol: 0.08, freq: 7000, filter: "highpass" });
    },
    voteStart() { this.drumroll(1.0); },
    guessed() {
      [392, 523, 659, 784].forEach((f, i) => this.tone(f, i * 0.1, 0.18, { type: "square", vol: 0.09 }));
      this.chord([523, 659, 784, 1047], 0.42, 1.0, "triangle", 0.11);
      this.noise(0.42, 0.7, { vol: 0.1, freq: 6000, filter: "highpass" });
      this.tone(2093, 0.5, 0.25, { vol: 0.05 });
      this.tone(2637, 0.6, 0.3, { vol: 0.05 });
    },
    voteFail() {
      this.tone(150, 0, 0.65, { type: "sawtooth", vol: 0.11, slide: 85 });
      this.tone(156, 0, 0.65, { type: "sawtooth", vol: 0.08, slide: 90 });
    },
    timeout() {
      this.tone(880, 0, 0.12, { type: "square", vol: 0.1 });
      this.tone(880, 0.18, 0.12, { type: "square", vol: 0.1 });
      this.tone(220, 0.38, 0.6, { type: "sawtooth", vol: 0.1, slide: 110 });
    },
    pass() {
      [[392, 0, 0.3], [370, 0.32, 0.3], [349, 0.64, 0.3]].forEach(([f, s, d]) => this.tone(f, s, d, { type: "sawtooth", vol: 0.07 }));
      this.tone(330, 0.96, 1.0, { type: "sawtooth", vol: 0.08, vibrato: 6, slide: 300 });
    },
    help() {
      for (const ring of [0, 0.55]) {
        for (let k = 0; k < 8; k++) {
          this.tone(440, ring + k * 0.05, 0.045, { vol: 0.09 });
          this.tone(480, ring + k * 0.05, 0.045, { vol: 0.09 });
        }
      }
    },
    helpEnd() { this.tone(700, 0, 0.2, { vol: 0.1, slide: 380 }); },
    author() {
      this.tone(220, 0, 1.1, { type: "triangle", vol: 0.07, vibrato: 5 });
      [440, 523, 659, 831].forEach((f, i) => this.tone(f, i * 0.15, 0.5, { vol: 0.09 }));
    },
    roll() {
      let t = 0;
      let step = 0.06;
      while (t < 4.7) {
        this.tone(900 + Math.random() * 700, t, 0.03, { type: "square", vol: 0.03 });
        t += step;
        step *= 1.07;
      }
      this.tone(1320, 5.0, 0.45, { type: "triangle", vol: 0.16 });
      this.tone(1760, 5.05, 0.45, { type: "sine", vol: 0.08 });
    },
    refill() {
      for (let i = 0; i < 6; i++) this.noise(i * 0.07 + Math.random() * 0.03, 0.05, { vol: 0.14, freq: 1800 + Math.random() * 1500, q: 3 });
      this.tone(1047, 0.5, 0.3, { type: "triangle", vol: 0.1 });
    },
    join() {
      this.tone(500, 0, 0.09, { vol: 0.12, slide: 900 });
      this.tone(700, 0.1, 0.1, { vol: 0.12, slide: 1300 });
    },
    chat() {
      this.tone(784, 0, 0.09, { type: "triangle", vol: 0.1 });
      this.tone(1047, 0.07, 0.14, { type: "triangle", vol: 0.1 });
    },
    chatPrivate() {
      this.tone(659, 0, 0.1, { vol: 0.12 });
      this.tone(988, 0.08, 0.1, { vol: 0.12 });
      this.tone(1319, 0.16, 0.18, { vol: 0.1 });
    },
    ready() {
      this.tone(880, 0, 0.15, { type: "triangle", vol: 0.13 });
      this.tone(1175, 0.08, 0.3, { type: "triangle", vol: 0.13 });
    },
    reaction() { this.tone(500 + Math.random() * 400, 0, 0.08, { vol: 0.07, slide: 1500 }); },
    end() {
      this.drumroll(1.5);
      this.chord([523, 659, 784], 1.55, 0.25, "square", 0.07);
      this.chord([587, 740, 880], 1.85, 0.25, "square", 0.07);
      this.chord([659, 831, 988, 1319], 2.15, 1.6, "triangle", 0.1);
      this.noise(2.15, 1.2, { vol: 0.12, freq: 6000, filter: "highpass" });
    },
    preview() { this.tone(988, 0, 0.18, { type: "triangle", vol: 0.15 }); },
    click() {
      this.tone(1250, 0, 0.03, { type: "triangle", vol: 0.07 });
      this.tone(820, 0.025, 0.04, { type: "triangle", vol: 0.05 });
    }
  },

  play(name, cooldownMs = 120) {
    if (!this.level) return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) || 0) < cooldownMs) return;
    this.lastPlayed.set(name, now);
    if (!this.ensure()) return;
    const sound = this.sounds[name];
    if (!sound) return;
    try {
      sound.call(this);
    } catch {}
  }
};

const MUSIC_KEY = "czolko-music";
const MUSIC_VOLUME = 0.32;
const MUSIC_CHORDS = [[48, 0], [43, 0], [45, 1], [41, 0], [48, 0], [43, 0], [41, 0], [43, 0]];
const MUSIC_LEAD = [
  [76, 0, 79, 0, 81, 0, 79, 0, 76, 0, 74, 0, 72, 0, 0, 0],
  [74, 0, 0, 71, 74, 0, 79, 0, 77, 0, 76, 0, 74, 0, 0, 0],
  [72, 0, 76, 0, 81, 0, 79, 0, 76, 0, 72, 0, 76, 0, 0, 0],
  [77, 0, 76, 0, 74, 0, 72, 0, 69, 0, 72, 0, 74, 0, 0, 0],
  [76, 0, 76, 79, 0, 79, 81, 0, 84, 0, 81, 0, 79, 0, 76, 0],
  [79, 0, 77, 0, 76, 0, 74, 0, 71, 0, 74, 0, 79, 0, 0, 0],
  [77, 0, 81, 0, 84, 0, 81, 0, 77, 0, 76, 0, 74, 0, 72, 0],
  [74, 0, 0, 0, 71, 0, 74, 0, 79, 0, 0, 0, 0, 0, 0, 0]
];

const music = {
  enabled: storage.get(MUSIC_KEY) !== "off",
  gain: null,
  timer: null,
  step: 0,
  loop: 0,
  nextTime: 0,

  freq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  },

  tempo() {
    return document.body.classList.contains("hurry") ? 150 : 118;
  },

  applyBus() {
    const bus = sfx.musicBus;
    if (!bus) return;
    const value = this.enabled ? 1 : 0;
    bus.gain.cancelScheduledValues(0);
    bus.gain.value = value;
    bus.gain.setValueAtTime(value, sfx.ctx.currentTime);
  },

  start() {
    if (!this.enabled || this.timer || document.hidden) return;
    const ctx = sfx.ensure();
    if (!ctx) return;
    this.applyBus();
    this.gain = ctx.createGain();
    this.gain.connect(sfx.musicBus);
    this.gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.gain.gain.exponentialRampToValueAtTime(MUSIC_VOLUME, ctx.currentTime + 1.5);
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  },

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.gain) {
      try {
        this.gain.disconnect();
      } catch {}
      this.gain = null;
    }
  },

  toggle() {
    this.enabled = !this.enabled;
    storage.set(MUSIC_KEY, this.enabled ? "on" : "off");
    sfx.ensure();
    this.applyBus();
    if (this.enabled) this.start();
    else this.stop();
    this.render();
  },

  render() {
    const button = $("music-toggle");
    button.classList.toggle("off", !this.enabled);
    button.title = this.enabled ? "Wyłącz muzykę w tle" : "Włącz muzykę w tle";
  },

  schedule() {
    const ctx = sfx.ctx;
    if (!ctx || !this.enabled || !this.gain) return this.stop();
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.25) {
      this.playStep(this.nextTime);
      this.nextTime += 60 / this.tempo() / 4;
      this.step = (this.step + 1) % (16 * MUSIC_CHORDS.length);
      if (this.step === 0) this.loop += 1;
    }
  },

  playStep(at) {
    const out = this.gain;
    const bar = Math.floor(this.step / 16);
    const beat = this.step % 16;
    const [rootNote, minor] = MUSIC_CHORDS[bar];
    const chord = [0, minor ? 3 : 4, 7, 12];
    const sixteenth = 60 / this.tempo() / 4;
    if (beat % 2 === 0) {
      const note = rootNote + (beat % 4 === 0 ? 0 : 12);
      sfx.tone(this.freq(note), 0, sixteenth * 1.8, { type: "triangle", vol: 0.16, at, out });
    }
    const arpNote = rootNote + 24 + chord[beat % 4];
    sfx.tone(this.freq(arpNote), 0, sixteenth * 0.9, { type: "square", vol: 0.018, at, out });
    const lead = MUSIC_LEAD[bar][beat];
    if (lead && this.loop % 2 === 1) sfx.tone(this.freq(lead), 0, sixteenth * 1.7, { type: "square", vol: 0.035, at, out });
    if (beat === 0 || beat === 8 || beat === 11) sfx.tone(150, 0, 0.12, { vol: 0.22, slide: 45, at, out });
    if (beat === 4 || beat === 12) sfx.noise(0, 0.09, { vol: 0.07, freq: 1800, q: 0.7, at, out });
    if (beat % 2 === 1) sfx.noise(0, 0.025, { vol: 0.025, freq: 8000, filter: "highpass", at, out });
  }
};

for (const eventName of ["pointerdown", "keydown"]) {
  document.addEventListener(eventName, () => {
    sfx.ensure();
    setTimeout(() => music.start(), 0);
  }, { once: true, capture: true });
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    music.stop();
  } else if (music.enabled && sfx.ctx) {
    music.stop();
    music.start();
  }
});

const fx = {
  busyUntil: 0,
  reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,

  overlay(content, className, ms) {
    const node = el("div", "fx-overlay " + className);
    if (typeof content === "string") node.textContent = content;
    else node.append(...content);
    document.body.appendChild(node);
    setTimeout(() => node.remove(), ms);
    return node;
  },

  inGame() {
    return !$("screen-game").classList.contains("hidden");
  },

  anchor(playerId) {
    const tile = tiles.get(playerId);
    if (tile && tile.root.isConnected) return tile.frame;
    if (store.state && playerId === store.state.me.id && this.inGame()) return $("my-tile");
    return null;
  },

  nick(playerId) {
    const p = findPlayer(playerId);
    return p ? p.nick : "?";
  },

  countdown() {
    const steps = ["3", "2", "1", "START!"];
    steps.forEach((text, i) => {
      setTimeout(() => {
        sfx.play(i === steps.length - 1 ? "go" : "countBeep", 0);
        this.overlay(text, i === steps.length - 1 ? "fx-count fx-go" : "fx-count", 700);
      }, i * 650);
    });
    this.busyUntil = performance.now() + steps.length * 650;
  },

  yourTurn() {
    sfx.play("myTurn");
    this.overlay("TWOJA TURA!", "fx-yourturn", 1600);
  },

  stamp(playerId, text, className) {
    const anchor = this.anchor(playerId);
    if (!anchor) return;
    const node = el("div", "fx-stamp " + className, text);
    anchor.appendChild(node);
    setTimeout(() => node.remove(), 1700);
    const shaker = anchor.closest(".ptile") || anchor;
    motion.restart(shaker, "fx-shake");
  },

  rain(count = 70) {
    if (this.reduced) return;
    const colors = ["#ffd23f", "#ff4d6d", "#06d6a0", "#4cc9f0", "#b388ff", "#ffffff", "#ff8fab"];
    const box = el("div", "fx-rain");
    for (let i = 0; i < count; i++) {
      const piece = el("span");
      piece.style.left = Math.random() * 100 + "vw";
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty("--fall", (1.6 + Math.random() * 1.6).toFixed(2) + "s");
      piece.style.setProperty("--delay", (Math.random() * 0.6).toFixed(2) + "s");
      piece.style.setProperty("--spin", Math.round(Math.random() * 1080 - 540) + "deg");
      piece.style.setProperty("--drift", Math.round(Math.random() * 160 - 80) + "px");
      box.appendChild(piece);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3800);
  },

  guessed(playerId) {
    const isMe = store.state && playerId === store.state.me.id;
    sfx.play("guessed");
    this.overlay([el("div", "fx-big", isMe ? "ZGADŁEŚ!" : "ZGADUJE!"), el("div", "fx-sub", isMe ? "+1 punkt" : this.nick(playerId) + " +1")], "fx-win", 1900);
    this.rain();
    this.busyUntil = performance.now() + 1700;
  },

  reveal(text, reason) {
    const card = el("div", "fx-reveal-card");
    card.append(
      el("div", "fx-reveal-label", reason === "guessed" ? "Zgadnięte! Twoje hasło:" : "Spasowane. Twoje hasło:"),
      el("div", "fx-reveal-word", text || "?")
    );
    this.overlay([card], "fx-reveal" + (reason === "guessed" ? " fx-reveal-ok" : " fx-reveal-pass"), 2800);
  },

  reaction(playerId, emoji) {
    sfx.play("reaction", 60);
    const anchor = this.anchor(playerId);
    const rect = anchor ? anchor.getBoundingClientRect() : { left: window.innerWidth / 2 - 20, width: 40, top: window.innerHeight - 80 };
    const node = el("div", "fx-reaction", emoji);
    node.style.left = rect.left + rect.width / 2 + (Math.random() * 60 - 30) + "px";
    node.style.top = rect.top + 20 + "px";
    node.style.setProperty("--drift", Math.round(Math.random() * 80 - 40) + "px");
    node.style.setProperty("--tilt", Math.round(Math.random() * 40 - 20) + "deg");
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2000);
  },

  afterBusy(callback) {
    const wait = Math.max(0, this.busyUntil - performance.now());
    setTimeout(callback, wait);
  },

  handle(event) {
    const s = store.state;
    const me = s ? s.me.id : null;
    const id = event.playerId;
    switch (event.type) {
      case "join":
        if (id !== me) sfx.play("join");
        break;
      case "ready":
        sfx.play("ready");
        break;
      case "start":
        this.countdown();
        this.afterBusy(() => {
          if (store.state && store.state.activeId === store.state.me.id) this.yourTurn();
        });
        break;
      case "next":
        sfx.play("click", 0);
        break;
      case "turn":
        this.afterBusy(() => {
          if (!store.state || store.state.activeId !== id) return;
          if (id === store.state.me.id) this.yourTurn();
          else sfx.play("turn");
        });
        break;
      case "timeout":
        sfx.play("timeout");
        this.stamp(id, "CZAS!", "stamp-time");
        this.busyUntil = performance.now() + 900;
        break;
      case "pass":
        sfx.play("pass");
        this.stamp(id, "PASS", "stamp-pass");
        break;
      case "voteStart":
        sfx.play("voteStart");
        this.stamp(id, "?!", "stamp-vote");
        break;
      case "voteFail":
        sfx.play("voteFail");
        this.stamp(id, "✖", "stamp-fail");
        break;
      case "guessed":
        this.guessed(id);
        break;
      case "help":
        sfx.play("help");
        break;
      case "helpEnd":
        sfx.play("helpEnd");
        break;
      case "author":
        sfx.play("author");
        this.stamp(id, "🕵️", "stamp-author");
        break;
      case "reroll":
        sfx.play("roll", 1000);
        break;
      case "refill":
        sfx.play("refill");
        break;
      case "fiveGo":
        sfx.play("voteStart", 0);
        this.stamp(id, cfg("fiveAnswerSeconds", 5) + " SEKUND!", "stamp-vote");
        break;
      case "fiveResult":
        if (event.passed) {
          sfx.play("guessed", 0);
          this.stamp(id, "✅ ZALICZONE", "stamp-ok");
        } else {
          sfx.play("voteFail", 0);
          this.stamp(id, event.reversed ? "🔄 ✖" : "−" + event.lost + " ❤️", "stamp-fail");
        }
        if (event.out) {
          this.busyUntil = performance.now() + 1800;
          setTimeout(() => this.overlay([el("div", "fx-big", "💀 " + liarNick(id) + " ODPADA!")], "fx-win", 1800), 500);
        } else if (event.card) {
          setTimeout(() => {
            const mine = id === me ? findPlayer(me) : null;
            const newest = mine && mine.cards.length ? fiveCardInfo(mine.cards[mine.cards.length - 1].type) : null;
            if (newest) this.overlay([el("div", "fx-sub", "Dostajesz tajną kartę"), el("div", "fx-big", newest.icon + " " + newest.name), el("div", "fx-sub", newest.text)], "fx-win", 2600);
            else this.overlay([el("div", "fx-sub", liarNick(id) + " dostaje tajną kartę"), el("div", "fx-big", "🃏")], "fx-win", 1500);
          }, 600);
        }
        break;
      case "fiveCard": {
        const info = (store.fiveCards || {})[event.card];
        sfx.play("author", 0);
        if (info) {
          this.stamp(event.targetId || id, info.icon, "stamp-author");
          this.overlay([el("div", "fx-sub", liarNick(id) + " zagrywa"), el("div", "fx-big", info.icon + " " + info.name)], "fx-win", 1600);
        }
        break;
      }
      case "liarSkip":
        sfx.play("ready");
        break;
      case "liarVote":
        sfx.play("help");
        break;
      case "liarCaught":
        sfx.play("voteStart");
        this.stamp(event.playerId, "KŁAMCA!", "stamp-fail");
        break;
      case "liarReveal":
        sfx.play("voteStart");
        setTimeout(() => {
          if (event.escaped) return;
          if (!event.caught) {
            sfx.play("pass", 0);
            this.overlay([el("div", "fx-big liar-fx-impostor", "😈 KŁAMCA WYGRYWA")], "fx-win liar-fx", 2000);
          } else if (event.guessed) {
            sfx.play("author", 0);
            this.overlay([el("div", "fx-big", "😏 URATOWANY!")], "fx-win", 2000);
          } else {
            sfx.play("guessed", 0);
            this.overlay([el("div", "fx-big", "🎉 ZŁAPANY!")], "fx-win", 2000);
            this.rain(60);
          }
        }, 1100);
        break;
      case "waveScale":
        sfx.play("ready");
        break;
      case "waveClue":
        sfx.play("ready");
        setTimeout(() => {
          const wave = store.state && store.state.wave;
          if (wave && wave.clue) this.overlay("„" + wave.clue + "”", "fx-yourturn fx-clue", 1700);
        }, 80);
        break;
      case "waveReveal":
        sfx.play("voteStart");
        this.busyUntil = performance.now() + 2600;
        setTimeout(() => {
          sfx.play(event.bullseye ? "guessed" : "ready", 0);
          if (event.perfect) {
            this.overlay([el("div", "fx-big", "💯 PERFEKCYJNIE!"), el("div", "fx-sub", "idealnie co do wartości")], "fx-win", 2300);
            this.rain(110);
          } else if (event.bullseye) {
            this.overlay([el("div", "fx-big", "🎯 W SAM ŚRODEK!")], "fx-win", 1900);
            this.rain(50);
          }
        }, 1150);
        break;
      case "end":
        sfx.play("end");
        setTimeout(() => this.rain(90), 2100);
        break;
      case "reaction":
        this.reaction(id, event.emoji);
        break;
    }
  }
};

function cfg(key, fallback) {
  const settings = store.state && store.state.settings;
  return settings && typeof settings[key] === "number" ? settings[key] : fallback;
}

function waveBands() {
  return [[18, cfg("waveFar", 2)], [11, cfg("waveNear", 3)], [4, cfg("waveBull", 4)]];
}

function findPlayer(id) {
  return store.state ? store.state.players.find((p) => p.id === id) : null;
}

function leaderIds(players) {
  const best = Math.max(...players.map((p) => p.score));
  if (best <= 0) return new Set();
  return new Set(players.filter((p) => p.score === best).map((p) => p.id));
}

const media = {
  update(slot, player) {
    slot.style.setProperty("--pc", player.color);
    const data = store.avatars.get(player.id);
    let img = slot.querySelector(".avatar-img");
    let fallback = slot.querySelector(".avatar-fallback");
    if (data) {
      if (fallback) fallback.remove();
      if (!img) {
        img = el("img", "avatar-img");
        img.alt = "";
        img.draggable = false;
        slot.appendChild(img);
      }
      if (img.currentData !== data) {
        img.src = data;
        img.currentData = data;
      }
    } else {
      if (img) img.remove();
      if (!fallback) {
        fallback = el("div", "avatar-fallback");
        slot.appendChild(fallback);
      }
      fallback.textContent = player.nick.charAt(0).toUpperCase();
    }
    media.updateVideo(slot, player);
  },

  updateVideo(slot, player) {
    const track = slot.dataset.video ? video.trackFor(player.id) : null;
    let videoEl = slot.querySelector("video");
    if (!track) {
      if (videoEl) {
        if (videoEl.currentTrack) videoEl.currentTrack.detach(videoEl);
        videoEl.remove();
      }
      slot.classList.remove("has-video");
      return;
    }
    if (!videoEl) {
      videoEl = el("video");
      videoEl.muted = true;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      const markLive = () => videoEl.classList.toggle("live", videoEl.videoWidth > 0 && !videoEl.paused);
      for (const event of ["playing", "resize", "loadeddata"]) videoEl.addEventListener(event, markLive);
      for (const event of ["pause", "emptied", "ended"]) {
        videoEl.addEventListener(event, () => videoEl.classList.remove("live"));
      }
      slot.appendChild(videoEl);
    }
    if (videoEl.currentTrack !== track) {
      if (videoEl.currentTrack) videoEl.currentTrack.detach(videoEl);
      videoEl.classList.remove("live");
      track.attach(videoEl);
      videoEl.currentTrack = track;
    }
    videoEl.classList.toggle("mirror", track === video.localTrack());
    slot.classList.add("has-video");
  },

  refreshAll() {
    for (const slot of document.querySelectorAll(".media-slot[data-player-id]")) {
      const player = findPlayer(slot.dataset.playerId);
      if (player) media.update(slot, player);
    }
  }
};

const video = {
  lib: window.LivekitClient || null,
  available: false,
  room: null,
  connecting: null,
  cameraOn: false,
  autoStartTried: false,

  wantsCamera() {
    return storage.get(CAMERA_KEY) === "1";
  },

  ensureConnected() {
    if (!this.available) return Promise.resolve(null);
    if (this.room) return Promise.resolve(this.room);
    if (!this.connecting) this.connecting = this.open().finally(() => { this.connecting = null; });
    return this.connecting;
  },

  async open() {
    const response = await call("videoToken");
    if (!response.ok) {
      toast(response.error, true);
      return null;
    }
    const { Room, RoomEvent } = this.lib;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    const refresh = () => media.refreshAll();
    for (const event of [
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantDisconnected
    ]) room.on(event, refresh);
    room.on(RoomEvent.Disconnected, () => {
      if (this.room !== room) return;
      this.room = null;
      this.cameraOn = false;
      renderCameraButtons();
      refresh();
    });
    try {
      await room.connect(response.url, response.token);
    } catch {
      toast("Nie udało się połączyć z serwerem wideo", true);
      return null;
    }
    this.room = room;
    refresh();
    return room;
  },

  cameraTrackOf(participant) {
    const publication = participant && participant.getTrackPublication(this.lib.Track.Source.Camera);
    return publication && publication.track && !publication.isMuted ? publication.track : null;
  },

  localTrack() {
    return this.room ? this.cameraTrackOf(this.room.localParticipant) : null;
  },

  trackFor(playerId) {
    if (!this.room) return null;
    const local = this.room.localParticipant;
    return (
      this.cameraTrackOf(this.room.remoteParticipants.get(`${playerId}:phone`)) ||
      (local.identity === playerId ? this.cameraTrackOf(local) : this.cameraTrackOf(this.room.remoteParticipants.get(playerId)))
    );
  },

  async setCamera(on) {
    const room = await this.ensureConnected();
    if (!room) return;
    try {
      await room.localParticipant.setCameraEnabled(on, { resolution: this.lib.VideoPresets.h360.resolution });
      this.cameraOn = on;
      storage.set(CAMERA_KEY, on ? "1" : "0");
    } catch {
      this.cameraOn = false;
      toast("Brak dostępu do kamerki. Sprawdź uprawnienia przeglądarki", true);
    }
    renderCameraButtons();
    media.refreshAll();
  },

  sync(s) {
    if (!this.available) return;
    const me = s.players.find((p) => p.id === s.me.id);
    if (s.phase === "game" || (me && me.hasPhone)) this.ensureConnected();
    if (this.wantsCamera() && !this.cameraOn && !this.autoStartTried) {
      this.autoStartTried = true;
      this.setCamera(true);
    }
  },

  disconnect() {
    const room = this.room;
    this.room = null;
    this.cameraOn = false;
    this.autoStartTried = false;
    if (room) room.disconnect();
    renderCameraButtons();
  }
};

function renderCameraButtons() {
  const me = store.state && findPlayer(store.state.me.id);
  show($("camera-box"), video.available);
  show($("btn-camera-game"), video.available);
  show($("btn-phone-mode"), video.available);
  show($("camera-preview"), video.cameraOn || Boolean(me && me.hasPhone));
  for (const id of ["btn-camera", "btn-camera-panel"]) {
    $(id).textContent = video.cameraOn ? "📷 Wyłącz kamerkę" : "📷 Włącz kamerkę";
    $(id).classList.toggle("selected", video.cameraOn);
  }
  $("btn-camera-game").classList.toggle("selected", video.cameraOn || Boolean(me && me.hasPhone));
  if (!video.available) show($("camera-panel"), false);
  if (store.state) {
    for (const node of document.querySelectorAll(".phone-site")) node.textContent = location.host;
    for (const node of document.querySelectorAll(".my-camera-code")) node.textContent = store.state.me.cameraCode;
    const link = `${location.origin}/?kamera=${store.state.me.cameraCode}`;
    const qr = `/qr.svg?text=${encodeURIComponent(link)}`;
    for (const node of document.querySelectorAll(".phone-qr")) {
      if (node.getAttribute("src") !== qr) node.setAttribute("src", qr);
      show(node, !(me && me.hasPhone));
    }
    for (const node of document.querySelectorAll(".phone-status")) {
      node.textContent = me && me.hasPhone ? "📱 telefon połączony" : "telefon niepodłączony";
      node.classList.toggle("tag-ok", Boolean(me && me.hasPhone));
    }
  }
}

for (const id of ["btn-camera", "btn-camera-panel"]) {
  $(id).onclick = () => video.setCamera(!video.cameraOn);
}
$("btn-camera-game").onclick = () => $("camera-panel").classList.toggle("hidden");

fetch("/config.json")
  .then((res) => res.json())
  .then((config) => {
    video.available = Boolean(config.video && video.lib);
    store.settingsSpec = Array.isArray(config.settings) ? config.settings : [];
    store.fiveCards = config.fiveCards || {};
    if (store.state) render();
    renderCameraButtons();
    if (store.state) video.sync(store.state);
  })
  .catch(() => {});

function bindSlot(slot, player) {
  slot.dataset.playerId = player.id;
  media.update(slot, player);
}

const avatarEditor = (() => {
  const canvas = $("avatar-canvas");
  const ctx = canvas.getContext("2d");
  let color = BRUSH_COLORS[0];
  let size = BRUSH_SIZES[1];
  let tool = "brush";
  let drawing = false;
  let shapeStart = null;
  let snapshot = null;
  const history = [];

  function saveHistory() {
    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (history.length > UNDO_LIMIT) history.shift();
    $("btn-undo").disabled = false;
  }

  function undo() {
    const previous = history.pop();
    $("btn-undo").disabled = history.length === 0;
    if (!previous) return;
    drawing = false;
    touched = true;
    ctx.putImageData(previous, 0, 0);
    upload();
  }
  let last = null;
  let touched = false;
  let uploadTimer = null;

  function fillWhite() {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function pointFrom(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height
    };
  }

  function stroke(from, to) {
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function floodFill(point) {
    const width = canvas.width;
    const height = canvas.height;
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    const [r, g, b] = hexToRgb(color);
    const start = (y * width + x) * 4;
    const [sr, sg, sb] = [data[start], data[start + 1], data[start + 2]];
    if (Math.abs(sr - r) + Math.abs(sg - g) + Math.abs(sb - b) < 6) return;
    saveHistory();
    const distance = (i) => Math.abs(data[i] - sr) + Math.abs(data[i + 1] - sg) + Math.abs(data[i + 2] - sb);
    const visited = new Uint8Array(width * height);
    const edges = [];
    const stack = [y * width + x];
    while (stack.length) {
      const pixel = stack.pop();
      if (visited[pixel]) continue;
      visited[pixel] = 1;
      const i = pixel * 4;
      const diff = distance(i);
      if (diff > 96) {
        if (diff < 400) edges.push(i);
        continue;
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
      const px = pixel % width;
      if (px > 0) stack.push(pixel - 1);
      if (px < width - 1) stack.push(pixel + 1);
      if (pixel >= width) stack.push(pixel - width);
      if (pixel < width * (height - 1)) stack.push(pixel + width);
    }
    for (const i of edges) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function upload() {
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(() => {
      let data = canvas.toDataURL("image/png");
      if (data.length > 190000) data = canvas.toDataURL("image/jpeg", 0.85);
      act("setAvatar", { data });
    }, 350);
  }

  function loadPhoto(file) {
    if (!file || !file.type.startsWith("image/")) return toast("To nie jest obrazek", true);
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const sx = (image.naturalWidth - side) / 2;
      const sy = (image.naturalHeight - side) / 2;
      touched = true;
      saveHistory();
      fillWhite();
      ctx.drawImage(image, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
      upload();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      toast("Nie udało się wczytać zdjęcia", true);
    };
    image.src = url;
  }

  $("btn-avatar-photo").onclick = () => $("avatar-file").click();
  $("avatar-file").onchange = (event) => {
    loadPhoto(event.target.files[0]);
    event.target.value = "";
  };

  function refreshTools() {
    for (const button of $("avatar-colors").children) {
      button.classList.toggle("selected", tool !== "eraser" && button.dataset.color === color);
    }
    for (const button of $("avatar-sizes").children) {
      button.classList.toggle("selected", tool !== "fill" && Number(button.dataset.size) === size);
    }
    for (const button of $("avatar-tool-buttons").children) {
      button.classList.toggle("selected", button.dataset.tool === tool);
    }
    canvas.classList.toggle("fill-mode", tool === "fill");
  }

  function isShape() {
    return SHAPE_TOOLS.includes(tool);
  }

  function drawShape(from, to) {
    let width = to.x - from.x;
    let height = to.y - from.y;
    if (tool === "square") {
      const side = Math.max(Math.abs(width), Math.abs(height));
      width = Math.sign(width || 1) * side;
      height = Math.sign(height || 1) * side;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (tool === "rect" || tool === "square") {
      ctx.rect(from.x, from.y, width, height);
    } else if (tool === "triangle") {
      ctx.moveTo(from.x + width / 2, from.y);
      ctx.lineTo(from.x + width, from.y + height);
      ctx.lineTo(from.x, from.y + height);
      ctx.closePath();
    } else if (tool === "circle") {
      ctx.ellipse(from.x + width / 2, from.y + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  }

  function setTool(next) {
    tool = next;
    refreshTools();
  }

  for (const c of BRUSH_COLORS) {
    const button = el("button", "swatch");
    button.style.background = c;
    button.dataset.color = c;
    button.onclick = () => {
      color = c;
      setTool(tool === "eraser" ? "brush" : tool);
    };
    $("avatar-colors").appendChild(button);
  }

  for (const s of BRUSH_SIZES) {
    const button = el("button", "size-btn");
    button.dataset.size = s;
    const dot = el("span", "size-dot");
    dot.style.width = dot.style.height = `${s + 4}px`;
    button.appendChild(dot);
    button.onclick = () => {
      size = s;
      setTool(tool === "fill" ? "brush" : tool);
    };
    $("avatar-sizes").appendChild(button);
  }

  for (const button of $("avatar-tool-buttons").children) {
    button.onclick = () => setTool(button.dataset.tool);
  }

  $("btn-undo").onclick = undo;

  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    if ($("screen-lobby").classList.contains("hidden")) return;
    if (event.target.closest("input, textarea")) return;
    event.preventDefault();
    undo();
  });

  $("btn-clear-avatar").onclick = () => {
    touched = true;
    saveHistory();
    fillWhite();
    clearTimeout(uploadTimer);
    act("setAvatar", { data: null });
  };

  canvas.addEventListener("pointerdown", (event) => {
    touched = true;
    if (tool === "fill") {
      floodFill(pointFrom(event));
      upload();
      return;
    }
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    last = pointFrom(event);
    saveHistory();
    if (isShape()) {
      shapeStart = last;
      snapshot = history[history.length - 1];
      return;
    }
    stroke(last, last);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const point = pointFrom(event);
    if (isShape()) {
      ctx.putImageData(snapshot, 0, 0);
      drawShape(shapeStart, point);
      return;
    }
    stroke(last, point);
    last = point;
  });

  const finish = () => {
    if (!drawing) return;
    drawing = false;
    upload();
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);

  fillWhite();
  refreshTools();

  return {
    loadFrom(data) {
      if (touched || !data) return;
      touched = true;
      const img = new Image();
      img.onload = () => {
        fillWhite();
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = data;
    },
    reset() {
      touched = false;
      history.length = 0;
      $("btn-undo").disabled = true;
      fillWhite();
    }
  };
})();

const MAX_STARRED = 2;

const wordsForm = (() => {
  const inputs = [];
  const starButtons = [];
  let stars = new Set();
  let dirty = false;

  for (let i = 0; i < WORDS_PER_PLAYER; i++) {
    const input = el("input", "word-input");
    input.maxLength = 40;
    input.placeholder = `Hasło ${i + 1}`;
    input.autocomplete = "off";
    input.addEventListener("input", () => {
      dirty = true;
      refresh();
    });
    inputs.push(input);
    const reroll = el("button", "btn btn-small word-reroll", "🔄");
    reroll.title = "Wylosuj inne hasło w tym polu";
    reroll.onclick = () => rerollOne(i);
    const star = el("button", "btn btn-small word-star", "☆");
    star.title = "Gwiazdka: to hasło na pewno trafi do gry (max " + MAX_STARRED + ")";
    star.onclick = () => toggleStar(i);
    starButtons.push(star);
    const row = el("div", "word-row");
    row.append(star, input, reroll);
    $("word-inputs").appendChild(row);
  }

  function toggleStar(index) {
    if (stars.has(index)) {
      stars.delete(index);
    } else {
      if (stars.size >= MAX_STARRED) return toast("Gwiazdkę możesz dać maksymalnie " + MAX_STARRED + " hasłom", true);
      stars.add(index);
      motion.restart(starButtons[index], "star-pop");
    }
    dirty = true;
    refresh();
  }

  function renderStars() {
    starButtons.forEach((button, i) => {
      const on = stars.has(i);
      button.textContent = on ? "⭐" : "☆";
      button.classList.toggle("selected", on);
      inputs[i].classList.toggle("starred", on);
    });
  }

  async function rerollOne(index) {
    const response = await act("randomWords", { count: 1, exclude: values().filter(Boolean) });
    if (!response.ok) return;
    if (!response.words.length) return toast("Brak kolejnych haseł do wylosowania");
    inputs[index].value = response.words[0];
    dirty = true;
    refresh();
  }

  function values() {
    return inputs.map((input) => input.value.replace(/\s+/g, " ").trim());
  }

  function refresh() {
    const list = values();
    const counts = new Map();
    for (const word of list) {
      if (!word) continue;
      const key = word.toLocaleLowerCase("pl");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let hasDuplicate = false;
    inputs.forEach((input, i) => {
      const duplicate = list[i] && counts.get(list[i].toLocaleLowerCase("pl")) > 1;
      if (duplicate) hasDuplicate = true;
      input.classList.toggle("invalid", Boolean(duplicate));
    });
    renderStars();
    const filled = list.filter(Boolean).length;
    const ready = store.state && store.state.me.wordsReady;
    let status = `${filled}/${WORDS_PER_PLAYER} haseł · ⭐ ${stars.size}/${MAX_STARRED}`;
    if (hasDuplicate) status = "Hasła nie mogą się powtarzać";
    else if (dirty) status += " · niezapisane zmiany";
    else if (ready) status = "✓ Hasła zapisane";
    $("words-status").textContent = status;
    $("words-status").classList.toggle("status-ok", !dirty && Boolean(ready));
    $("btn-save-words").disabled = hasDuplicate || filled < WORDS_PER_PLAYER;
    return { list, hasDuplicate };
  }

  $("btn-random").onclick = async () => {
    const list = values();
    const empty = list.map((word, i) => (word ? -1 : i)).filter((i) => i >= 0);
    if (!empty.length) return toast("Wszystkie pola są już wypełnione");
    const response = await act("randomWords", { count: empty.length, exclude: list.filter(Boolean) });
    if (!response.ok) return;
    empty.forEach((index, k) => {
      if (response.words[k]) inputs[index].value = response.words[k];
    });
    dirty = true;
    refresh();
  };

  $("btn-save-words").onclick = async () => {
    const { list, hasDuplicate } = refresh();
    if (hasDuplicate) return;
    const response = await act("setWords", { words: list, starred: [...stars] });
    if (response.ok) {
      dirty = false;
      toast("Hasła zapisane");
      sync();
    }
  };

  function sync() {
    if (!dirty && store.state && store.state.me.words.length) {
      store.state.me.words.forEach((word, i) => {
        if (inputs[i]) inputs[i].value = word;
      });
      stars = new Set(store.state.me.starred || []);
    }
    refresh();
  }

  function reset() {
    dirty = false;
    stars = new Set();
    for (const input of inputs) input.value = "";
    refresh();
  }

  return { sync, reset };
})();

function renderLobby(s) {
  $("lobby-code").textContent = s.code;
  avatarEditor.loadFrom(store.avatars.get(s.me.id));
  wordsForm.sync();
  const me = findPlayer(s.me.id);
  if (me) bindSlot($("camera-preview"), me);
  renderCameraButtons();

  const list = $("lobby-players");
  list.replaceChildren();
  const canKick = s.me.canManage;
  for (const p of s.players) {
    const row = el("div", `lobby-player${p.connected ? "" : " offline"}`);
    row.style.setProperty("--pc", p.color);
    const slot = el("div", "media-slot");
    bindSlot(slot, p);
    const info = el("div", "lp-info");
    info.appendChild(el("div", "lp-nick", p.nick + (p.id === s.me.id ? " (ty)" : "")));
    const tags = el("div", "tags");
    if (p.canManage) tags.appendChild(el("span", "tag tag-host", "Host"));
    const readyFlag = s.mode === "klamca" ? p.liarReady : p.wordsReady;
    const showWordsTag = s.mode === "czolko" || (s.mode === "klamca" && s.liarSource === "players");
    if (s.mode === "piec" && p.fiveTasks) tags.appendChild(el("span", "tag tag-ok", "📝 " + p.fiveTasks + " zadań"));
    if (showWordsTag) tags.appendChild(el("span", `tag ${readyFlag ? "tag-ok" : ""}`, readyFlag ? "✓ hasła" : "pisze hasła…"));
    if (p.hasPhone) tags.appendChild(el("span", "tag tag-ok", "📱 kamerka"));
    if (!p.connected) tags.appendChild(el("span", "tag tag-off", "offline"));
    info.appendChild(tags);
    row.append(slot, info);
    if (canKick && p.id !== s.me.id) {
      const kick = el("button", "btn btn-small btn-red", "Wyrzuć");
      kick.onclick = () => ask(`Wyrzucić gracza ${p.nick}?`, () => act("kick", { playerId: p.id }));
      row.appendChild(kick);
    }
    list.appendChild(row);
  }

  const limitInput = $("limit-input");
  if (document.activeElement !== limitInput) limitInput.value = s.pointLimit;
  limitInput.disabled = !s.me.canManage;
  show($("btn-set-limit"), s.me.canManage);
  const helpInput = $("help-limit-input");
  if (document.activeElement !== helpInput) helpInput.value = s.helpLimit;
  helpInput.disabled = !s.me.canManage;
  show($("btn-set-help-limit"), s.me.canManage);
  const timeInput = $("time-limit-input");
  if (document.activeElement !== timeInput) timeInput.value = s.timeLimitMin;
  timeInput.disabled = !s.me.canManage;
  show($("btn-set-time-limit"), s.me.canManage);

  const liarPlayersMode = s.mode === "klamca" && s.liarSource === "players";
  const missing = s.mode === "wskazowka" || s.mode === "piec" || (s.mode === "klamca" && !liarPlayersMode)
    ? []
    : s.players.filter((p) => !(liarPlayersMode ? p.liarReady : p.wordsReady)).map((p) => p.nick);
  const host = s.players.find((p) => p.canManage);
  renderModePicker(s);
  liarWordsForm.sync(s);
  fiveTasksForm.sync(s);
  const minPlayers = s.mode === "klamca" ? (s.liarSource === "host" ? 4 : 3) : 2;
  const allReady = s.players.length >= minPlayers && missing.length === 0;
  let hint = "";
  if (s.players.length < minPlayers) hint = `Czekamy na co najmniej ${minPlayers} graczy`;
  else if (missing.length) hint = `Brakuje haseł od: ${missing.join(", ")}`;
  else hint = "Wszyscy gotowi!";
  $("start-hint").textContent = hint;
  show($("btn-start"), s.me.canManage && allReady);
  show($("start-waiting"), !s.me.canManage && allReady);
  $("start-waiting").textContent = `Wszyscy gotowi! Czekamy, aż ${host ? host.nick : "host"} wystartuje grę`;
}

$("btn-set-limit").onclick = () => act("setLimit", { limit: Number($("limit-input").value) });
$("btn-set-time-limit").onclick = () => act("setTimeLimit", { minutes: Number($("time-limit-input").value) });
$("btn-set-help-limit").onclick = () => act("setHelpLimit", { limit: Number($("help-limit-input").value) });
$("btn-start").onclick = () => act("startGame");
function leaveRoom() {
  const inGame = store.state && store.state.phase === "game";
  const question = inGame
    ? "Na pewno wyjść z gry? Stracisz swoje miejsce i punkty, nie da się wrócić do tej rozgrywki."
    : "Na pewno wyjść z pokoju?";
  ask(question, async () => {
    await call("leaveRoom");
    goHome();
  });
}

$("btn-leave").onclick = leaveRoom;
for (const button of document.querySelectorAll(".btn-leave-game")) button.onclick = leaveRoom;

const tiles = new Map();

function createTile() {
  const root = el("div", "ptile");
  const top = el("div", "ptile-top");
  const crown = el("span", "crown", "👑");
  const badge = el("span", "turn-badge", "Czółko");
  top.append(crown, badge);
  const frame = el("div", "ptile-frame");
  const slot = el("div", "media-slot");
  slot.dataset.video = "1";
  const score = el("div", "score-badge");
  const nick = el("div", "nick-bar");
  const word = el("div", "word-label");
  const author = el("div", "author-tag hidden");
  frame.append(slot, nick, score, author, word);
  root.append(top, frame);
  return { root, frame, crown, badge, slot, score, nick, word, author };
}

function helpRole(s, id) {
  if (!s.help) return null;
  if (s.help.askerId === id) return "asker";
  if (s.help.helperId === id) return "helper";
  return null;
}

function updateTile(tile, p, s, leaders) {
  const role = helpRole(s, p.id);
  tile.root.style.setProperty("--pc", p.color);
  tile.root.classList.toggle("active", s.activeId === p.id);
  tile.root.classList.toggle("offline", !p.connected);
  tile.root.classList.toggle("help-main", Boolean(role));
  tile.root.classList.toggle("voting", Boolean(s.vote && s.vote.guesserId === p.id));
  tile.root.classList.toggle("helper", role === "helper");
  show(tile.crown, leaders.has(p.id));
  show(tile.badge, s.activeId === p.id || role === "helper");
  tile.badge.textContent = role === "helper" ? "Pomaga" : "Czółko";
  tile.score.textContent = fmtScore(p.score);
  show(tile.author, Boolean(p.authorNick));
  if (p.authorNick && tile.author.dataset.nick !== p.authorNick) {
    tile.author.dataset.nick = p.authorNick;
    tile.author.textContent = "✍️ od " + p.authorNick;
    motion.restart(tile.author, "author-in");
  }
  if (!p.authorNick) tile.author.dataset.nick = "";
  tile.nick.textContent = p.connected ? p.nick : `${p.nick} (offline)`;
  tile.root.classList.toggle("me", p.id === s.me.id);
  if (s.mode === "klamca") {
    tile.word.dataset.word = "";
    const label = liarTileLabel(s, p);
    if (tile.word.textContent !== label) {
      tile.word.textContent = label;
      if (label.startsWith("+") || label.startsWith("🕵️")) motion.restart(tile.word, "word-new");
    }
    const liar = s.liar;
    const isMaster = liar && liar.masterId === p.id;
    show(tile.badge, s.activeId === p.id || isMaster);
    tile.badge.textContent = isMaster ? "Prowadzi" : liar && liar.stage === "guess" ? "Zgaduje" : "Mówi";
    tile.root.classList.toggle("liar-suspect", Boolean(liar && liar.stage === "reveal" && liar.impostorId === p.id));
    bindSlot(tile.slot, p);
    return;
  }
  tile.root.classList.remove("liar-suspect");
  tile.root.classList.toggle("five-out", Boolean(s.mode === "piec" && p.out));
  tile.root.classList.toggle("five-duel", Boolean(s.mode === "piec" && s.five && (s.five.askerId === p.id || s.five.answererId === p.id)));
  if (s.mode === "piec") {
    tile.word.dataset.word = "";
    const label = fiveTileLabel(s, p);
    if (tile.word.textContent !== label) tile.word.textContent = label;
    const five = s.five;
    const isAsker = five && five.askerId === p.id;
    const isAnswerer = five && five.answererId === p.id;
    show(tile.badge, Boolean(isAsker || isAnswerer));
    tile.badge.textContent = isAnswerer ? "Odpowiada" : "Pyta";
    bindSlot(tile.slot, p);
    return;
  }
  if (s.mode === "wskazowka") {
    tile.word.dataset.word = "";
    const label = waveTileLabel(s, p);
    if (tile.word.textContent !== label) {
      tile.word.textContent = label;
      if (label.startsWith("+")) motion.restart(tile.word, "word-new");
    }
    show(tile.badge, s.activeId === p.id);
    tile.badge.textContent = s.wave && s.wave.stage === "scale" ? "Skala" : "Podpowiada";
    bindSlot(tile.slot, p);
    return;
  }
  const previousWord = tile.word.dataset.word;
  const nextWord = p.id === s.me.id ? "???" : p.word || "—";
  tile.word.dataset.word = nextWord;
  if (previousWord && previousWord !== "—" && nextWord !== "—" && previousWord !== nextWord) {
    motion.rollWord(tile.word, false);
  } else if (!tile.word.rolling) {
    tile.word.textContent = nextWord;
  }
  bindSlot(tile.slot, p);
}

const motion = {
  reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  lastScores: new Map(),
  lastActiveId: null,
  lastHelpKey: "",
  lastRollSound: 0,

  restart(node, className) {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  },

  floatText(anchor, text, kind) {
    const node = el("div", `float-score float-${kind}`, text);
    anchor.appendChild(node);
    setTimeout(() => node.remove(), 1300);
  },

  confetti(anchor) {
    if (this.reduced) return;
    const colors = ["#ffd23f", "#ff4d6d", "#06d6a0", "#4cc9f0", "#b388ff", "#ffffff"];
    const box = el("div", "confetti");
    for (let i = 0; i < 22; i++) {
      const piece = el("span");
      piece.style.setProperty("--x", `${Math.round(Math.random() * 240 - 120)}px`);
      piece.style.setProperty("--y", `${Math.round(-60 - Math.random() * 120)}px`);
      piece.style.setProperty("--r", `${Math.round(Math.random() * 720 - 360)}deg`);
      piece.style.setProperty("--d", `${Math.round(Math.random() * 120)}ms`);
      piece.style.background = colors[i % colors.length];
      box.appendChild(piece);
    }
    anchor.appendChild(box);
    setTimeout(() => box.remove(), 1500);
  },

  scoreChanges(s) {
    const previous = this.lastScores;
    const current = new Map(s.players.map((p) => [p.id, p.score]));
    this.lastScores = current;
    const wasReset = s.players.every((p) => p.score === 0) && [...previous.values()].some((v) => v !== 0);
    if (!previous.size || wasReset) return;
    for (const p of s.players) {
      if (!previous.has(p.id)) continue;
      const delta = p.score - previous.get(p.id);
      if (!delta) continue;
      const tile = tiles.get(p.id);
      const inCorner = p.id === s.me.id && !tile;
      const anchor = inCorner ? $("my-tile") : tile && tile.frame;
      const badge = inCorner ? $("my-tile").querySelector(".my-score") : tile && tile.score;
      if (!anchor) continue;
      this.floatText(anchor, delta > 0 ? "+" + fmtScore(delta) : fmtScore(delta), delta > 0 ? "plus" : "minus");
      if (badge) this.restart(badge, delta > 0 ? "score-pop" : "score-drop");
      if (delta > 0) this.confetti(anchor);
    }
  },

  capture() {
    if (this.reduced) return null;
    const rects = new Map();
    for (const tile of tiles.values()) rects.set(tile.root, tile.root.getBoundingClientRect());
    return rects;
  },

  flip(rects) {
    if (!rects) return;
    for (const [node, first] of rects) {
      if (!node.isConnected) continue;
      const last = node.getBoundingClientRect();
      if (!last.width || !last.height) continue;
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      const sx = first.width / last.width;
      const sy = first.height / last.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) continue;
      node.style.transition = "none";
      node.style.transformOrigin = "top left";
      node.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        node.style.transition = "transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)";
        node.style.transform = "";
      }));
      node.addEventListener("transitionend", () => {
        node.style.transition = "";
        node.style.transformOrigin = "";
      }, { once: true });
    }
  },

  rollWord(label, secret) {
    const finalText = () => label.dataset.word || label.textContent;
    clearTimeout(label.rolling);
    if (this.reduced) {
      label.rolling = null;
      label.textContent = finalText();
      return;
    }
    const startedAt = performance.now();
    if (fx.inGame()) sfx.play("roll", 1500);
    label.classList.add("rolling");
    const step = () => {
      const progress = (performance.now() - startedAt) / ROLL_TIME_MS;
      const target = finalText();
      if (progress >= 1) {
        label.rolling = null;
        label.classList.remove("rolling");
        label.textContent = target;
        this.restart(label, "word-new");
        return;
      }
      if (secret) {
        label.textContent = SECRET_DECOYS[Math.floor(Math.random() * SECRET_DECOYS.length)];
      } else {
        const revealed = progress < ROLL_REVEAL_FROM ? 0 : Math.floor(((progress - ROLL_REVEAL_FROM) / (1 - ROLL_REVEAL_FROM)) * target.length);
        label.textContent = [...target]
          .map((char, i) => (char === " " ? " " : i < revealed ? char : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]))
          .join("");
      }
      label.rolling = setTimeout(step, 70);
    };
    step();
  },

  helpFlash(text) {
    if (this.reduced) return;
    const node = el("div", "help-flash", text);
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 1600);
  },

  reset() {
    this.lastScores = new Map();
    this.lastActiveId = null;
    this.lastHelpKey = "";
  }
};

function renderGrid(s, leaders) {
  const grid = $("players-grid");
  const meInHelp = Boolean(helpRole(s, s.me.id));
  const others = s.players.filter((p) => store.selfInGrid || meInHelp || p.id !== s.me.id);
  const helpMode = Boolean(s.help);
  if (helpMode) {
    const rank = (p) => (p.id === s.help.askerId ? 0 : p.id === s.help.helperId ? 1 : 2);
    others.sort((a, b) => rank(a) - rank(b));
  }
  const fiveMode = s.mode === "piec" && Boolean(s.five);
  if (fiveMode) {
    const rank = (p) => (p.id === s.five.askerId ? 0 : p.id === s.five.answererId ? 1 : p.out ? 3 : 2);
    others.sort((a, b) => rank(a) - rank(b));
  }
  const spotlight = !helpMode && !fiveMode && s.mode !== "wskazowka" && others.some((p) => p.id === s.activeId);
  grid.classList.toggle("five-mode", fiveMode);
  grid.classList.toggle("liar-mode", s.mode === "klamca");
  grid.classList.toggle("wave-mode", s.mode === "wskazowka");
  grid.classList.toggle("spotlight", spotlight);
  grid.classList.toggle("help-mode", helpMode);
  const helpKey = s.help ? s.help.askerId + ":" + s.help.helperId : "";
  const turnChanged = motion.lastActiveId !== null && motion.lastActiveId !== s.activeId;
  const helpChanged = helpKey !== motion.lastHelpKey;
  if (helpChanged && helpKey) motion.helpFlash("🆘 Pomoc!");
  motion.lastActiveId = s.activeId;
  motion.lastHelpKey = helpKey;
  const rects = turnChanged || helpChanged ? motion.capture() : null;
  grid.style.setProperty("--side-rows", Math.max(1, others.length - 1));
  const seen = new Set();
  others.forEach((p, index) => {
    let tile = tiles.get(p.id);
    if (!tile) {
      tile = createTile();
      tiles.set(p.id, tile);
    }
    updateTile(tile, p, s, leaders);
    if (grid.children[index] !== tile.root) grid.insertBefore(tile.root, grid.children[index] || null);
    seen.add(p.id);
  });
  for (const [id, tile] of tiles) {
    if (!seen.has(id)) {
      tile.root.remove();
      tiles.delete(id);
    }
  }
  motion.flip(rects);
}

function renderMyTile(s, leaders) {
  const me = findPlayer(s.me.id);
  if (!me) return;
  const root = $("my-tile");
  root.style.setProperty("--pc", me.color);
  root.classList.toggle("active", s.activeId === me.id);
  root.classList.toggle("voting", Boolean(s.vote && s.vote.guesserId === me.id));
  root.classList.toggle("compact", store.selfInGrid || Boolean(helpRole(s, me.id)));
  $("btn-layout").classList.toggle("selected", !store.selfInGrid);
  bindSlot(root.querySelector(".media-slot"), me);
  root.querySelector(".my-nick").textContent = (leaders.has(me.id) ? "👑 " : "") + me.nick;
  root.querySelector(".my-score").textContent = s.mode === "piec" ? (me.out ? "💀 odpadłeś" : "❤️ " + me.lives) : fmtScore(me.score) + " pkt";
  const myAuthor = root.querySelector(".my-author");
  show(myAuthor, Boolean(me.authorNick));
  myAuthor.textContent = me.authorNick ? "✍️ hasło od " + me.authorNick : "";
  show(root.querySelector(".my-turn-badge"), s.activeId === me.id || Boolean(s.mode === "klamca" && s.liar && s.liar.masterId === me.id) || Boolean(s.mode === "piec" && s.five && (s.five.askerId === me.id || s.five.answererId === me.id)));
  root.querySelector(".my-turn-badge").textContent = s.mode === "piec"
    ? (s.five && s.five.answererId === me.id ? "Odpowiadasz" : "Pytasz")
    : s.mode === "wskazowka"
    ? (s.wave && s.wave.stage === "scale" ? "Skala" : "Podpowiadasz")
    : s.mode === "klamca"
      ? (s.liar && s.liar.masterId === me.id ? "Prowadzisz" : s.liar && s.liar.stage === "guess" ? "Zgadujesz" : "Mówisz")
      : "Czółko";
}

function renderTurn(s) {
  const myTurn = s.activeId === s.me.id;
  const active = findPlayer(s.activeId);
  $("turn-banner").replaceChildren(
    myTurn ? "Twoja tura! Zadawaj pytania tak/nie " : `Tura: ${active ? active.nick : "?"} `,
    el("span", "turn-timer")
  );
  $("turn-banner").classList.toggle("mine", myTurn);
  store.turnDeadline = s.turnRemainingMs === null ? 0 : performance.now() + s.turnRemainingMs;

  show($("action-bar"), myTurn);
  for (const id of ["btn-next", "btn-guess", "btn-pass"]) $(id).disabled = Boolean(s.vote);
  const me = findPlayer(s.me.id);
  const helpsLeft = me ? me.helpsLeft : 0;
  const unlimitedHelp = helpsLeft === null;
  const costLabel = (cost) => (cost ? "−" + fmtScore(cost) : "free");
  show($("btn-help"), s.helpLimit > 0);
  $("btn-help").textContent = "🆘 Pomoc (" + (unlimitedHelp ? "∞" : helpsLeft) + " · " + costLabel(s.me.nextHelpCost) + ")";
  $("btn-help").disabled = Boolean(s.vote) || Boolean(s.help) || (!unlimitedHelp && helpsLeft <= 0);
  const authorLeft = s.me.authorLeft;
  show($("btn-author"), cfg("authorLimit", 99) > 0);
  $("btn-author").disabled = Boolean(s.vote) || Boolean(me && me.authorNick) || authorLeft === 0;
  $("btn-author").textContent = me && me.authorNick
    ? "🕵️ od " + me.authorNick
    : "🕵️ Autor (" + (authorLeft === null ? "" : authorLeft + " · ") + costLabel(s.me.nextAuthorCost) + ")";
  if (!myTurn || s.help || s.vote) show($("help-picker"), false);
  $("action-status").replaceChildren();
  if (myTurn && s.vote) {
    $("action-status").append(`Czekam na głosy: ✔ ${s.vote.yes}/${s.vote.required} · ✖ ${s.vote.no} · `);
    $("action-status").appendChild(el("span", "vote-timer"));
  } else if (myTurn && s.help) {
    $("action-status").append("Trwa pomoc. Możesz już zgadywać, to zakończy rozmowę");
  } else if (myTurn) {
    $("action-status").append(s.timeLimitMin ? "Gra na czas · " : `Gramy do ${s.pointLimit} pkt · `);
    $("action-status").appendChild(el("span", "turn-timer"));
  }
  updateTurnTimers();
}

function renderGameClock(s) {
  const timed = s.gameRemainingMs !== null && s.gameRemainingMs !== undefined;
  show($("game-clock"), timed);
  store.gameDeadline = timed ? performance.now() + s.gameRemainingMs : 0;
  updateGameClock();
}

function updateGameClock() {
  const seconds = store.gameDeadline ? secondsLeft(store.gameDeadline) : 0;
  for (const node of document.querySelectorAll(".game-timer")) node.textContent = formatDuration(seconds);
  $("game-clock").classList.toggle("low", Boolean(store.gameDeadline) && seconds <= 60);
}

$("btn-author").onclick = () => {
  const cost = store.state ? store.state.me.nextAuthorCost : 0;
  ask("Odkryć, kto wpisał twoje hasło? " + (cost ? "Kosztuje " + fmtScore(cost) + " pkt." : "Tym razem za darmo!"), () => act("revealAuthor"));
};

function renderHelp(s) {
  const help = s.help;
  show($("help-bar"), Boolean(help));
  store.helpDeadline = help ? performance.now() + help.remainingMs : 0;
  updateHelpTimers();
  if (!help) return;
  const asker = findPlayer(help.askerId);
  const helper = findPlayer(help.helperId);
  const name = (p) => (p ? (p.id === s.me.id ? "Ty" : p.nick) : "?");
  $("help-text").textContent = "🆘 Pomoc: " + name(asker) + " + " + name(helper);
  show($("btn-help-end"), Boolean(helpRole(s, s.me.id)) || s.me.canManage);
}

function updateHelpTimers() {
  const seconds = store.helpDeadline ? secondsLeft(store.helpDeadline) : 0;
  for (const node of document.querySelectorAll(".help-timer")) {
    node.textContent = "⏱ " + seconds + " s";
    node.classList.toggle("low", seconds <= 10);
  }
}

function openHelpPicker() {
  const s = store.state;
  if (!s) return;
  const helpCost = s.me.nextHelpCost || 0;
  $("help-picker-text").textContent = "Kogo prosisz o pomoc? Macie " + cfg("helpSeconds", 60) + " sekund rozmowy." + (helpCost ? " Kosztuje " + fmtScore(helpCost) + " pkt." : "");
  const list = $("help-choices");
  list.replaceChildren();
  for (const p of s.players) {
    if (p.id === s.me.id) continue;
    const button = el("button", "btn help-choice");
    button.style.setProperty("--pc", p.color);
    const slot = el("div", "media-slot");
    bindSlot(slot, p);
    button.append(slot, el("span", "", p.connected ? p.nick : p.nick + " (offline)"));
    button.disabled = !p.connected;
    button.onclick = () => {
      show($("help-picker"), false);
      act("help:request", { playerId: p.id });
    };
    list.appendChild(button);
  }
  show($("help-picker"), true);
}

$("btn-help").onclick = openHelpPicker;
$("help-cancel").onclick = () => show($("help-picker"), false);
$("btn-help-end").onclick = () => act("help:end");

function renderVote(s) {
  const vote = s.vote;
  const visible = Boolean(vote) && vote.guesserId !== s.me.id;
  show($("vote-panel"), visible);
  store.voteDeadline = vote ? performance.now() + vote.remainingMs : 0;
  updateVoteTimers();
  if (!visible) return;
  const guesser = findPlayer(vote.guesserId);
  $("vote-nick").textContent = guesser ? guesser.nick : "?";
  $("vote-word").textContent = guesser && guesser.word ? guesser.word : "?";
  $("vote-counts").textContent = `✔ ${vote.yes}/${vote.required} potrzebnych · ✖ ${vote.no}`;
  $("btn-vote-yes").classList.toggle("selected", vote.myVote === "yes");
  $("btn-vote-no").classList.toggle("selected", vote.myVote === "no");
}

function secondsLeft(deadline) {
  return Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
}

function updateVoteTimers() {
  const seconds = secondsLeft(store.voteDeadline);
  for (const node of document.querySelectorAll(".vote-timer")) node.textContent = `${seconds} s`;
}

function updateTurnTimers() {
  const seconds = store.turnDeadline ? secondsLeft(store.turnDeadline) : null;
  const inGame = !$("screen-game").classList.contains("hidden");
  const hurry = inGame && seconds !== null && seconds <= 10;
  document.body.classList.toggle("hurry", hurry);
  show($("turn-bar"), inGame && seconds !== null);
  if (store.turnDeadline) {
    const fraction = Math.max(0, Math.min(1, (store.turnDeadline - performance.now()) / (store.turnTotal || TURN_TOTAL_MS)));
    const fill = $("turn-bar").firstElementChild;
    fill.style.transform = "scaleX(" + fraction.toFixed(4) + ")";
    fill.classList.toggle("low", hurry);
  }
  if (hurry && !store.quietTimer && seconds > 0 && seconds !== store.lastTick) sfx.play(seconds <= 5 ? "tickHard" : "tick", 0);
  store.lastTick = hurry ? seconds : null;
  for (const node of document.querySelectorAll(".turn-timer")) {
    node.textContent = seconds === null ? "" : `⏱ ${seconds} s`;
    node.classList.toggle("low", seconds !== null && seconds <= 10);
  }
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function updateRoomTimers() {
  const s = store.state;
  const active = Boolean(s && store.roomDeadline && !phone.mode);
  const seconds = active ? secondsLeft(store.roomDeadline) : 0;
  for (const node of document.querySelectorAll(".room-timer")) node.textContent = formatDuration(seconds);
  const isHost = active && s.me.canManage;
  show($("room-timer-lobby"), isHost);
  show($("expiry-warning"), active && seconds <= ROOM_WARNING_SECONDS);
  show($("expiry-warning").querySelector(".btn-extend"), isHost);
}

for (const button of document.querySelectorAll(".btn-extend")) button.onclick = () => act("extendRoom");

setInterval(() => {
  if (store.voteDeadline) updateVoteTimers();
  if (store.helpDeadline) updateHelpTimers();
  if (store.gameDeadline) updateGameClock();
  updateTurnTimers();
  updateRoomTimers();
}, 250);

function renderGame(s) {
  renderCameraButtons();
  const leaders = leaderIds(s.players);
  renderMyTile(s, leaders);
  renderGrid(s, leaders);
  renderTurn(s);
  renderHelp(s);
  renderGameClock(s);
  renderVote(s);
  renderWave(s);
  renderLiar(s);
  renderFive(s);
  motion.scoreChanges(s);
}

$("btn-layout").onclick = () => {
  store.selfInGrid = !store.selfInGrid;
  storage.set(`czolko-layout${PROFILE}`, store.selfInGrid ? "grid" : "corner");
  toast(store.selfInGrid ? "Twój kafelek jest w siatce z innymi" : "Twój kafelek jest w rogu");
  render();
};

$("btn-next").onclick = () => act("next");

const nextKey = {
  storageKey: "czolko-next-key",
  code: storage.get("czolko-next-key") || "Space",
  capturing: false,

  label(code) {
    if (code === "Space") return "Spacja";
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return "Num " + code.slice(6);
    const names = { Enter: "Enter", ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓", Tab: "Tab", ShiftLeft: "Shift", ShiftRight: "Shift", ControlLeft: "Ctrl", ControlRight: "Ctrl", AltLeft: "Alt", AltRight: "Alt Gr", Backquote: "`" };
    return names[code] || code;
  },

  render() {
    for (const button of document.querySelectorAll(".btn-next-key")) {
      button.textContent = this.capturing ? "Naciśnij klawisz… (Esc = anuluj)" : "⌨️ " + this.label(this.code);
      button.classList.toggle("selected", this.capturing);
    }
  },

  startCapture() {
    this.capturing = true;
    this.render();
  },

  onKey(event) {
    if (this.capturing) {
      event.preventDefault();
      event.stopPropagation();
      this.capturing = false;
      if (event.code !== "Escape") {
        this.code = event.code;
        storage.set(this.storageKey, this.code);
        toast("Next jest teraz pod klawiszem: " + this.label(this.code));
      }
      this.render();
      return;
    }
    if (event.code !== this.code || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if ($("screen-game").classList.contains("hidden")) return;
    if (event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (document.querySelector(".modal:not(.hidden)")) return;
    const button = $("btn-next");
    if ($("action-bar").classList.contains("hidden") || button.disabled) return;
    event.preventDefault();
    button.click();
    motion.restart(button, "key-press");
  }
};

for (const button of document.querySelectorAll(".btn-next-key")) {
  button.onclick = (event) => {
    event.currentTarget.blur();
    nextKey.startCapture();
  };
}
document.addEventListener("keydown", (event) => nextKey.onKey(event), true);
nextKey.render();
$("btn-guess").onclick = () => act("guess");
$("btn-pass").onclick = () => {
  const penalty = store.state ? store.state.me.nextPassCost : 0;
  ask(penalty ? "Spasować? Stracisz " + fmtScore(penalty) + " pkt." : "Spasować? Ten pass jest za darmo.", () => act("pass"));
};
$("btn-vote-yes").onclick = () => act("vote", { approve: true });
$("btn-vote-no").onclick = () => act("vote", { approve: false });

function renderEnd(s) {
  const reasons = {
    limit: "Ktoś dobił do limitu punktów!",
    time: "⏰ Koniec czasu! Wygrywa ten, kto ma najwięcej.",
    pool: "Skończyły się hasła do wylosowania.",
    players: "Zostało za mało graczy.",
    lastAlive: "💀 Został ostatni żywy!",
    admin: "Admin zakończył grę."
  };
  $("end-reason").textContent = reasons[s.endReason] || "";
  const results = s.results || [];
  const key = results.map((r) => r.id + ":" + r.score).join("|");
  const podium = $("podium");
  if (podium.dataset.key !== key) {
    podium.dataset.key = key;
    podium.replaceChildren();
    const places = [1, 0, 2];
    const medals = ["🥇", "🥈", "🥉"];
    for (const index of places) {
      const r = results[index];
      if (!r) continue;
      const spot = el("div", "podium-spot podium-" + (index + 1));
      spot.style.setProperty("--pc", r.color);
      spot.style.setProperty("--delay", (index === 0 ? 0.9 : index === 1 ? 0.45 : 0) + "s");
      const cam = el("div", "podium-cam");
      const slot = el("div", "media-slot");
      slot.dataset.video = "1";
      bindSlot(slot, r);
      cam.appendChild(slot);
      if (index === 0) cam.appendChild(el("span", "podium-crown", "👑"));
      const name = el("div", "podium-nick", r.nick);
      const step = el("div", "podium-step");
      step.append(el("div", "podium-medal", medals[index]), el("div", "podium-score", scoreUnit(s, r.score)));
      spot.append(cam, name, step);
      podium.appendChild(spot);
    }
    const losers = $("losers");
    losers.replaceChildren();
    results.slice(3).forEach((r, i) => {
      const item = el("div", "loser");
      item.style.setProperty("--pc", r.color);
      const slot = el("div", "media-slot");
      slot.dataset.video = "1";
      bindSlot(slot, r);
      item.append(slot, el("div", "loser-nick", (i + 4) + ". " + r.nick), el("div", "loser-score", scoreUnit(s, r.score)));
      losers.appendChild(item);
    });
    show($("losers-box"), results.length > 3);
    if (results[0] && !motion.reduced) setTimeout(() => motion.confetti(podium.querySelector(".podium-1") || podium), 1300);
  } else {
    for (const slot of podium.querySelectorAll(".media-slot")) media.update(slot, findResult(s, slot.dataset.playerId));
    for (const slot of $("losers").querySelectorAll(".media-slot")) media.update(slot, findResult(s, slot.dataset.playerId));
  }

  const summary = s.summary || { awards: [], history: [] };
  const awards = $("awards");
  awards.replaceChildren();
  summary.awards.forEach((a, i) => {
    const card = el("div", "award");
    card.style.setProperty("--delay", (1.6 + i * 0.15) + "s");
    card.append(el("div", "award-icon", a.icon), el("div", "award-title", a.title), el("div", "award-text", a.text));
    awards.appendChild(card);
  });
  show($("awards-box"), summary.awards.length > 0);
  const history = $("history");
  history.replaceChildren();
  $("history-title").textContent = summary.fiveRounds ? "Pytania" : summary.rounds || summary.liarRounds ? "Rundy" : "Kto miał jakie hasła";
  if (summary.fiveRounds) {
    renderFiveRounds(summary.fiveRounds);
    return;
  }
  if (summary.rounds) {
    renderWaveRounds(summary.rounds);
    return;
  }
  if (summary.liarRounds) {
    renderLiarRounds(summary.liarRounds);
    return;
  }
  const outcomes = {
    guessed: ["✅", "zgadł(a)"],
    passed: ["🙈", "pass"],
    rerolled: ["🔄", "zmienione przez hosta"],
    unfinished: ["⏳", "nie zdążył(a)"]
  };
  const groups = new Map();
  for (const r of results) groups.set(r.id, { nick: r.nick, color: r.color, items: [] });
  for (const h of summary.history) {
    if (!groups.has(h.holderId)) groups.set(h.holderId, { nick: h.holderNick + " (wyszedł)", color: "#888888", items: [] });
    groups.get(h.holderId).items.push(h);
  }
  for (const group of groups.values()) {
    if (!group.items.length) continue;
    const card = el("div", "history-player");
    card.style.setProperty("--pc", group.color);
    const guessed = group.items.filter((h) => h.outcome === "guessed");
    const total = guessed.reduce((sum, h) => sum + h.seconds, 0);
    const stats = guessed.length
      ? "zgadnięte: " + guessed.length + " · średnio " + formatSeconds(Math.round(total / guessed.length))
      : "nic nie zgadł(a) 🫠";
    const head = el("div", "history-head");
    head.append(el("span", "history-nick", group.nick), el("span", "history-stats", stats));
    const list = el("ol", "history-list");
    for (const h of group.items) {
      const [icon, text] = outcomes[h.outcome] || ["•", ""];
      const item = el("li", "history-item history-" + h.outcome);
      const extras = [];
      if (h.helps) extras.push("🆘" + (h.helps > 1 ? "×" + h.helps : ""));
      if (h.revealed) extras.push("🕵️");
      item.append(
        el("span", "history-icon", icon),
        el("span", "history-word", h.text),
        el("span", "history-author", "od " + h.authorNick),
        el("span", "history-time", formatSeconds(h.seconds) + " · " + text + (extras.length ? " " + extras.join(" ") : ""))
      );
      list.appendChild(item);
    }
    card.append(head, list);
    history.appendChild(card);
  }
  show($("history-box"), summary.history.length > 0);
}

function formatSeconds(total) {
  return total >= 60 ? Math.floor(total / 60) + " min " + (total % 60) + " s" : total + " s";
}

function findResult(s, id) {
  return findPlayer(id) || (s.results || []).find((r) => r.id === id) || { id, nick: "?", color: "#888888" };
}

$("btn-to-lobby").onclick = () => act("backToLobby");

function renderAdminPanel(s) {
  const isHost = s.me.canManage;
  const visible = s.phase !== "lobby" || !isHost;
  show($("admin-toggle"), visible);
  if (!visible) show($("admin-panel"), false);
  $("admin-toggle").textContent = isHost ? "Panel hosta" : "Admin";
  $("admin-title").textContent = isHost ? "Panel hosta" : "Admin";
  show($("admin-login-hint"), !isHost);
  show($("admin-login-game"), !isHost);
  show($("admin-tools"), isHost);
  if (!isHost) return;
  for (const button of document.querySelectorAll("[data-admin=end]")) button.disabled = s.phase !== "game";

  const limitInput = $("admin-limit");
  if (document.activeElement !== limitInput) limitInput.value = s.pointLimit;
  const timeLimitInput = $("admin-time-limit");
  if (document.activeElement !== timeLimitInput) timeLimitInput.value = s.timeLimitMin;
  const helpLimitInput = $("admin-help-limit");
  if (document.activeElement !== helpLimitInput) helpLimitInput.value = s.helpLimit;
  for (const button of document.querySelectorAll("[data-admin=endHelp]")) button.disabled = !s.help;
  for (const button of document.querySelectorAll("[data-admin=approve], [data-admin=reject]")) button.disabled = !s.vote;
  for (const button of document.querySelectorAll("[data-admin=forceNext]")) {
    button.disabled = s.phase !== "game";
    button.textContent = s.mode === "wskazowka" ? "Następna runda" : s.mode === "klamca" || s.mode === "piec" ? "Dalej / pomiń" : "Wymuś Next";
  }

  const list = $("admin-players");
  list.replaceChildren();
  for (const p of s.players) {
    const row = el("div", "admin-player");
    row.style.setProperty("--pc", p.color);
    row.appendChild(el("span", "admin-nick", p.nick + " · " + fmtScore(p.score) + " pkt"));
    const buttons = [
      ["−1", "score", -1],
      ["+1", "score", 1]
    ];
    for (const [label, action, delta] of buttons) {
      const button = el("button", "btn btn-small", label);
      button.dataset.admin = action;
      button.dataset.id = p.id;
      button.dataset.delta = delta;
      button.disabled = s.phase !== "game";
      row.appendChild(button);
    }
    const reroll = el("button", "btn btn-small czolko-only", "🔄");
    reroll.title = "Wylosuj nowe hasło";
    reroll.dataset.admin = "reroll";
    reroll.dataset.id = p.id;
    reroll.disabled = s.phase !== "game";
    row.appendChild(reroll);
    if (p.id !== s.me.id) {
      const kick = el("button", "btn btn-small btn-red", "Wyrzuć");
      kick.dataset.admin = "kick";
      kick.dataset.id = p.id;
      row.appendChild(kick);
    }
    list.appendChild(row);
  }
}

$("admin-toggle").onclick = () => $("admin-panel").classList.toggle("hidden");

$("btn-admin-game").onclick = async () => {
  const response = await act("claimAdmin", { password: $("admin-password-game").value });
  if (response.ok) $("admin-password-game").value = "";
};

$("admin-panel").addEventListener("click", (event) => {
  const button = event.target.closest("[data-admin]");
  if (!button) return;
  const { admin: action, id, delta } = button.dataset;
  const target = findPlayer(id);
  if (action === "forceNext") act("admin:forceNext");
  if (action === "approve") act("admin:resolveVote", { approve: true });
  if (action === "reject") act("admin:resolveVote", { approve: false });
  if (action === "limit") act("setLimit", { limit: Number($("admin-limit").value) });
  if (action === "timeLimit") act("setTimeLimit", { minutes: Number($("admin-time-limit").value) });
  if (action === "helpLimit") act("setHelpLimit", { limit: Number($("admin-help-limit").value) });
  if (action === "endHelp") act("help:end");
  if (action === "score") act("admin:score", { playerId: id, delta: Number(delta) });
  if (action === "restart") ask("Zrestartować grę? Punkty się wyzerują, hasła zostaną wylosowane od nowa.", () => act("admin:restart"));
  if (action === "reroll" && target) {
    const label = target.word ? `„${target.word}”` : "obecne hasło";
    ask(`Wylosować nowe hasło dla gracza ${target.nick}? ${target.id === store.state.me.id ? "Twoje" : label} przepadnie.`, () => act("admin:reroll", { playerId: id }));
  }
  if (action === "end") ask("Zakończyć grę teraz? Wszyscy zobaczą ranking.", () => act("admin:endGame"));
  if (action === "lobby") ask("Przerwać grę i wrócić do lobby?", () => act("backToLobby"));
  if (action === "kick" && target) ask(`Wyrzucić gracza ${target.nick}?`, () => act("kick", { playerId: id }));
});


const WAVE_CENTER_X = 200;
const WAVE_CENTER_Y = 210;
const WAVE_RADIUS = 190;
const WAVE_MOVE_THROTTLE_MS = 100;
const SVG_NS = "http://www.w3.org/2000/svg";

const waveUi = {
  value: null,
  live: new Map(),
  dragging: false,
  lastSent: 0,
  sendTimer: null,
  roundKey: "",
  dialKey: "",
  revealedKey: "",
  setKey: "",
  clueKey: ""
};

function wavePoint(value, radius) {
  const angle = Math.PI * (1 - value / 100);
  return [WAVE_CENTER_X + radius * Math.cos(angle), WAVE_CENTER_Y - radius * Math.sin(angle)];
}

function svgEl(tag, attrs, className) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
  if (className) node.setAttribute("class", className);
  return node;
}

function wedgePath(from, to, radius) {
  const a = Math.max(0, Math.min(100, from));
  const b = Math.max(0, Math.min(100, to));
  const [x1, y1] = wavePoint(a, radius);
  const [x2, y2] = wavePoint(b, radius);
  return "M " + WAVE_CENTER_X + " " + WAVE_CENTER_Y + " L " + x1.toFixed(2) + " " + y1.toFixed(2) + " A " + radius + " " + radius + " 0 0 1 " + x2.toFixed(2) + " " + y2.toFixed(2) + " Z";
}

function halfDiscPath(radius) {
  return "M " + (WAVE_CENTER_X - radius) + " " + WAVE_CENTER_Y + " A " + radius + " " + radius + " 0 0 1 " + (WAVE_CENTER_X + radius) + " " + WAVE_CENTER_Y + " Z";
}

function waveTileLabel(s, p) {
  const wave = s.wave;
  if (!wave) return "—";
  if (wave.stage === "scale") return p.id === wave.scaleAuthorId ? "✍️ wymyśla skalę" : "—";
  if (p.id === wave.psychicId) {
    if (wave.stage === "reveal") return "+" + wave.psychicPoints + " 🔮";
    return "🔮 podpowiada";
  }
  if (wave.stage === "clue") return "⏳";
  if (wave.stage === "guess") {
    if (wave.locked.includes(p.id)) return "✅ gotowe";
    return wave.touched.includes(p.id) ? "🤔 kręci…" : "…";
  }
  const result = (wave.results || []).find((r) => r.id === p.id);
  if (!result) return "—";
  return "+" + result.points + (result.perfect ? " 💯" : result.bull ? " 🎯" : "");
}

function drawNeedle(group, value, color, label, mine) {
  const [x, y] = wavePoint(value, WAVE_RADIUS * 0.93);
  const needle = svgEl("g", {}, "wave-needle" + (mine ? " mine" : ""));
  needle.appendChild(svgEl("line", { x1: WAVE_CENTER_X, y1: WAVE_CENTER_Y, x2: x.toFixed(2), y2: y.toFixed(2), stroke: color }, "wave-needle-line"));
  needle.appendChild(svgEl("circle", { cx: x.toFixed(2), cy: y.toFixed(2), r: mine ? 13 : 10, fill: color }, "wave-needle-knob"));
  if (label) {
    const text = svgEl("text", { x: x.toFixed(2), y: (y + 4).toFixed(2), "text-anchor": "middle" }, "wave-needle-text");
    text.textContent = label;
    needle.appendChild(text);
  }
  group.appendChild(needle);
}

function drawDial(s) {
  const wave = s.wave;
  const svg = $("wave-dial");
  const isPsychic = wave.psychicId === s.me.id;
  const showTarget = wave.target !== null && wave.stage !== "scale";
  const key = [wave.round, wave.set, wave.stage, showTarget ? wave.target : "-", isPsychic, cfg("wavePerfect", 5), cfg("waveBull", 4), cfg("waveNear", 3), cfg("waveFar", 2)].join("|");
  if (waveUi.dialKey !== key) {
    waveUi.dialKey = key;
    svg.replaceChildren();
    const defs = svgEl("defs");
    const clip = svgEl("clipPath", { id: "wave-clip" });
    clip.appendChild(svgEl("path", { d: halfDiscPath(WAVE_RADIUS + 4) }));
    defs.appendChild(clip);
    svg.appendChild(defs);
    svg.appendChild(svgEl("path", { d: halfDiscPath(WAVE_RADIUS) }, "wave-bg"));
    for (let tick = 0; tick <= 100; tick += 10) {
      const [x1, y1] = wavePoint(tick, WAVE_RADIUS - 8);
      const [x2, y2] = wavePoint(tick, WAVE_RADIUS);
      svg.appendChild(svgEl("line", { x1, y1, x2, y2 }, "wave-tick"));
    }
    const targetGroup = svgEl("g", {}, "wave-target");
    if (showTarget) {
      waveBands().forEach(([width], index) => {
        targetGroup.appendChild(svgEl("path", { d: wedgePath(wave.target - width, wave.target + width, WAVE_RADIUS - 2) }, "wave-band wave-band-" + (index + 2)));
      });
      const [px, py] = wavePoint(wave.target, WAVE_RADIUS - 2);
      targetGroup.appendChild(svgEl("line", { x1: WAVE_CENTER_X, y1: WAVE_CENTER_Y, x2: px.toFixed(2), y2: py.toFixed(2) }, "wave-perfect-line"));
      const far = cfg("waveFar", 2);
      const near = cfg("waveNear", 3);
      const bull = cfg("waveBull", 4);
      for (const [from, to, points] of [[-18, -11, far], [-11, -4, near], [-4, 4, bull], [4, 11, near], [11, 18, far]]) {
        const start = Math.max(0, wave.target + from);
        const end = Math.min(100, wave.target + to);
        if (end - start < 2.5) continue;
        const [x, y] = wavePoint((start + end) / 2, WAVE_RADIUS * 0.8);
        const label = svgEl("text", { x: x.toFixed(2), y: (y + 6).toFixed(2), "text-anchor": "middle" }, "wave-band-text");
        label.textContent = points;
        targetGroup.appendChild(label);
      }
    }
    svg.appendChild(targetGroup);
    const coverNeeded = !isPsychic && wave.stage !== "scale";
    if (coverNeeded) {
      const cover = svgEl("g", {}, "wave-cover");
      cover.appendChild(svgEl("path", { d: halfDiscPath(WAVE_RADIUS + 1) }, "wave-cover-disc"));
      const mark = svgEl("text", { x: WAVE_CENTER_X, y: WAVE_CENTER_Y - 70, "text-anchor": "middle" }, "wave-cover-mark");
      mark.textContent = "?";
      cover.appendChild(mark);
      const coverClip = svgEl("g", { "clip-path": "url(#wave-clip)" });
      coverClip.appendChild(cover);
      svg.appendChild(coverClip);
      if (wave.stage === "reveal") {
        const revealKey = wave.round + "|" + wave.set;
        if (waveUi.revealedKey === revealKey) cover.classList.add("open", "instant");
        else {
          waveUi.revealedKey = revealKey;
          setTimeout(() => cover.classList.add("open"), motion.reduced ? 0 : 1000);
        }
      }
    }
    svg.appendChild(svgEl("g", {}, "wave-live"));
    svg.appendChild(svgEl("g", {}, "wave-needles"));
    svg.appendChild(svgEl("circle", { cx: WAVE_CENTER_X, cy: WAVE_CENTER_Y, r: 16 }, "wave-hub"));
  }
  if (wave.stage === "guess" && isPsychic) renderLiveNeedles(s);
  const needles = svg.querySelector(".wave-needles");
  needles.replaceChildren();
  const me = findPlayer(s.me.id);
  if (wave.stage === "reveal") {
    for (const result of wave.results || []) {
      if (result.value === null) continue;
      drawNeedle(needles, result.value, result.color, result.nick.charAt(0).toUpperCase(), result.id === s.me.id);
    }
  } else if (wave.stage === "guess" && !isPsychic && waveUi.value !== null) {
    drawNeedle(needles, waveUi.value, me ? me.color : "#ffd23f", "", true);
  }
  svg.classList.toggle("interactive", wave.stage === "guess" && !isPsychic && !wave.myLocked);
}

function renderLiveNeedles(s) {
  const wave = s.wave;
  const group = $("wave-dial").querySelector(".wave-live");
  if (!group || !wave || wave.stage !== "guess" || wave.psychicId !== s.me.id) return;
  for (const entry of wave.live || []) {
    if (!waveUi.live.has(entry.id)) waveUi.live.set(entry.id, { value: entry.value, locked: wave.locked.includes(entry.id) });
  }
  const tipY = WAVE_CENTER_Y - WAVE_RADIUS * 0.93;
  for (const [id, entry] of waveUi.live) {
    const player = findPlayer(id);
    if (!player) continue;
    let needle = group.querySelector('[data-id="' + id + '"]');
    if (!needle) {
      needle = svgEl("g", { "data-id": id }, "wave-live-needle");
      needle.appendChild(svgEl("line", { x1: WAVE_CENTER_X, y1: WAVE_CENTER_Y, x2: WAVE_CENTER_X, y2: tipY, stroke: player.color }, "wave-needle-line"));
      needle.appendChild(svgEl("circle", { cx: WAVE_CENTER_X, cy: tipY, r: 11, fill: player.color }, "wave-needle-knob"));
      const text = svgEl("text", { x: WAVE_CENTER_X, y: tipY + 4, "text-anchor": "middle" }, "wave-needle-text");
      text.textContent = player.nick.charAt(0).toUpperCase();
      needle.appendChild(text);
      group.appendChild(needle);
    }
    const locked = entry.locked || wave.locked.includes(id);
    needle.classList.toggle("locked", locked);
    needle.style.transform = "rotate(" + ((entry.value - 50) * 1.8).toFixed(2) + "deg)";
  }
}

socket.on("wave:live", ({ playerId, value, locked }) => {
  waveUi.live.set(playerId, { value, locked: Boolean(locked) });
  const s = store.state;
  if (s && s.mode === "wskazowka" && s.wave) renderLiveNeedles(s);
});

function waveValueFromEvent(event) {
  const svg = $("wave-dial");
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(matrix.inverse());
  let angle = Math.atan2(WAVE_CENTER_Y - local.y, local.x - WAVE_CENTER_X);
  if (angle < 0) angle = local.x < WAVE_CENTER_X ? Math.PI : 0;
  return Math.max(0, Math.min(100, (1 - angle / Math.PI) * 100));
}

function waveCanMove() {
  const s = store.state;
  return Boolean(s && s.mode === "wskazowka" && s.wave && s.wave.stage === "guess" && s.wave.psychicId !== s.me.id && !s.wave.myLocked);
}

function waveSetLocal(value, final) {
  waveUi.value = Math.round(value * 10) / 10;
  drawDial(store.state);
  renderWavePanel(store.state);
  const now = performance.now();
  clearTimeout(waveUi.sendTimer);
  if (final || now - waveUi.lastSent > WAVE_MOVE_THROTTLE_MS) {
    waveUi.lastSent = now;
    call("wave:move", { value: waveUi.value });
  } else {
    waveUi.sendTimer = setTimeout(() => {
      waveUi.lastSent = performance.now();
      call("wave:move", { value: waveUi.value });
    }, WAVE_MOVE_THROTTLE_MS);
  }
}

const waveDial = $("wave-dial");
waveDial.addEventListener("pointerdown", (event) => {
  if (!waveCanMove()) return;
  const value = waveValueFromEvent(event);
  if (value === null) return;
  waveUi.dragging = true;
  waveDial.setPointerCapture(event.pointerId);
  waveSetLocal(value, false);
});
waveDial.addEventListener("pointermove", (event) => {
  if (!waveUi.dragging || !waveCanMove()) return;
  const value = waveValueFromEvent(event);
  if (value !== null) waveSetLocal(value, false);
});
for (const name of ["pointerup", "pointercancel"]) {
  waveDial.addEventListener(name, () => {
    if (!waveUi.dragging) return;
    waveUi.dragging = false;
    if (waveUi.value !== null && waveCanMove()) waveSetLocal(waveUi.value, true);
  });
}
waveDial.addEventListener("keydown", (event) => {
  if (!waveCanMove()) return;
  const step = event.shiftKey ? 5 : 1;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const base = waveUi.value === null ? 50 : waveUi.value;
    waveSetLocal(Math.max(0, Math.min(100, base + (event.key === "ArrowRight" ? step : -step))), true);
  }
});

function renderWavePanel(s) {
  const wave = s.wave;
  const isPsychic = wave.psychicId === s.me.id;
  const isAuthor = wave.scaleAuthorId === s.me.id;
  const nick = (id) => (findPlayer(id) || { nick: "?" }).nick;
  const stage = wave.stage;
  show($("wave-scale-form"), stage === "scale" && isAuthor);
  show($("wave-clue-form"), stage === "clue" && isPsychic);
  show($("wave-guess-box"), stage === "guess" && !isPsychic);
  show($("wave-reveal-box"), stage === "reveal");
  let wait = "";
  if (stage === "scale" && !isAuthor) wait = "✍️ " + nick(wave.scaleAuthorId) + " wymyśla skalę…";
  if (stage === "clue" && !isPsychic) wait = "🔮 " + nick(wave.psychicId) + " wymyśla podpowiedź…";
  if (stage === "guess" && isPsychic) wait = "Zgadują… gotowe: " + wave.locked.length + "/" + wave.guessers;
  $("wave-wait").textContent = wait;
  show($("wave-wait"), Boolean(wait));
  if (stage === "guess" && !isPsychic) {
    const lock = $("wave-lock");
    lock.textContent = wave.myLocked ? "✏️ Zmień" : "✔ Zatwierdź";
    lock.classList.toggle("btn-green", !wave.myLocked);
    lock.disabled = !wave.myLocked && waveUi.value === null;
    $("wave-guess-status").textContent = waveUi.value === null
      ? "Przeciągnij wskazówkę na tarczy (albo strzałki ← →)"
      : (wave.myLocked ? "Zatwierdzone! " : "Twoja pozycja: " + Math.round(waveUi.value) + " · ") + "gotowe: " + wave.locked.length + "/" + wave.guessers;
  }
  if (stage === "reveal") {
    const list = $("wave-results");
    list.replaceChildren();
    for (const r of wave.results || []) {
      const row = el("div", "wave-result" + (r.perfect ? " perfect" : r.bull ? " bull" : ""));
      row.style.setProperty("--pc", r.color);
      row.append(
        el("span", "wave-result-nick", r.nick),
        el("span", "wave-result-value", r.value === null ? "nie ustawił(a)" : "🎯 " + Math.round(r.value) + " / cel " + Math.round(wave.target)),
        el("span", "wave-result-points", "+" + r.points)
      );
      list.appendChild(row);
    }
    const psychicRow = el("div", "wave-result psychic");
    const psychic = findPlayer(wave.psychicId);
    psychicRow.style.setProperty("--pc", psychic ? psychic.color : "#888");
    psychicRow.append(el("span", "wave-result-nick", "🔮 " + nick(wave.psychicId)), el("span", "wave-result-value", "za podpowiedź"), el("span", "wave-result-points", "+" + wave.psychicPoints));
    list.appendChild(psychicRow);
    show($("wave-continue"), isPsychic || s.me.canManage);
  }
}

function renderWave(s) {
  const active = s.mode === "wskazowka" && Boolean(s.wave);
  show($("wave-stage"), active);
  store.quietTimer = active && s.wave.stage === "reveal";
  store.turnTotal = s.turnTotalMs || TURN_TOTAL_MS;
  if (!active) return;
  const wave = s.wave;
  show($("action-bar"), false);
  show($("help-bar"), false);
  const roundKey = wave.set + "|" + wave.round + "|" + wave.stage;
  if (waveUi.roundKey !== roundKey) {
    const newRound = !waveUi.roundKey.startsWith(wave.set + "|" + wave.round + "|");
    waveUi.roundKey = roundKey;
    if (newRound) {
      waveUi.value = wave.myGuess;
      waveUi.live = new Map();
      $("wave-clue-input").value = "";
    }
    if (wave.stage === "scale" && waveUi.setKey !== String(wave.set)) {
      waveUi.setKey = String(wave.set);
      $("wave-left-input").value = "";
      $("wave-right-input").value = "";
    }
    if (wave.stage === "scale" && wave.scaleAuthorId === s.me.id) setTimeout(() => $("wave-left-input").focus(), 50);
    if (wave.stage === "clue" && wave.psychicId === s.me.id) setTimeout(() => $("wave-clue-input").focus(), 50);
  }
  if (waveUi.value === null && wave.myGuess !== null) waveUi.value = wave.myGuess;
  const nick = (id) => (findPlayer(id) || { nick: "?" }).nick;
  const isPsychic = wave.psychicId === s.me.id;
  const isAuthor = wave.scaleAuthorId === s.me.id;
  let banner = "";
  if (wave.stage === "scale") banner = isAuthor ? "✍️ Wymyśl skalę!" : "✍️ " + nick(wave.scaleAuthorId) + " wymyśla skalę";
  else if (wave.stage === "clue") banner = isPsychic ? "🔮 Twoja podpowiedź!" : "🔮 Podpowiada: " + nick(wave.psychicId);
  else if (wave.stage === "guess") banner = isPsychic ? "🔮 Patrz, jak zgadują…" : "🎯 Ustaw wskazówkę!";
  else banner = "🎉 Odsłona!";
  $("turn-banner").replaceChildren(banner + " ", el("span", "turn-timer"));
  $("turn-banner").classList.toggle("mine", (wave.stage === "scale" && isAuthor) || (wave.stage !== "scale" && isPsychic));
  $("wave-info").textContent = wave.stage === "scale"
    ? "Nowa skala · tura " + wave.set
    : "Skala od " + nick(wave.scaleAuthorId) + " · podpowiada " + wave.turnOnScale + "/" + wave.turnsOnScale;
  $("wave-left").textContent = wave.left ? "◀ " + wave.left : "";
  $("wave-right").textContent = wave.right ? wave.right + " ▶" : "";
  const clue = $("wave-clue");
  show(clue, Boolean(wave.clue));
  if (wave.clue && waveUi.clueKey !== wave.set + "|" + wave.round) {
    waveUi.clueKey = wave.set + "|" + wave.round;
    clue.textContent = "„" + wave.clue + "”";
    motion.restart(clue, "word-new");
  }
  drawDial(s);
  renderWavePanel(s);
  updateTurnTimers();
}

$("wave-suggest").onclick = async () => {
  const response = await act("wave:suggest");
  if (!response.ok) return;
  $("wave-left-input").value = response.scale.left;
  $("wave-right-input").value = response.scale.right;
};
$("wave-scale-submit").onclick = () => act("wave:scale", { left: $("wave-left-input").value, right: $("wave-right-input").value });
$("wave-clue-submit").onclick = () => act("wave:clue", { clue: $("wave-clue-input").value });
for (const id of ["wave-left-input", "wave-right-input"]) {
  $(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("wave-scale-submit").click();
  });
}
$("wave-clue-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("wave-clue-submit").click();
});
$("wave-lock").onclick = () => {
  const wave = store.state && store.state.wave;
  if (!wave) return;
  act("wave:lock", { value: waveUi.value, locked: !wave.myLocked });
};
$("wave-continue").onclick = () => act("wave:continue");

const advancedUi = { signature: "" };

function renderAdvancedSettings(s) {
  const spec = (store.settingsSpec || []).filter((setting) => setting.mode === s.mode);
  const box = $("advanced-fields");
  const signature = s.mode + "|" + spec.length + "|" + s.me.canManage;
  if (advancedUi.signature !== signature) {
    advancedUi.signature = signature;
    box.replaceChildren();
    let group = null;
    for (const setting of spec) {
      if (setting.group !== group) {
        group = setting.group;
        box.appendChild(el("div", "advanced-group", group));
      }
      const row = el("label", "advanced-row");
      const input = el("input", "advanced-input");
      input.type = "number";
      input.min = setting.min;
      input.max = setting.max;
      input.step = setting.step;
      input.dataset.key = setting.key;
      input.disabled = !s.me.canManage;
      const commit = async () => {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value === cfg(setting.key, setting.value)) return;
        const response = await act("setSetting", { key: setting.key, value });
        if (!response.ok) input.value = cfg(setting.key, setting.value);
      };
      input.addEventListener("change", commit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") input.blur();
      });
      row.append(el("span", "advanced-label", setting.label), input);
      box.appendChild(row);
    }
    show($("btn-reset-settings"), s.me.canManage);
  }
  for (const input of box.querySelectorAll(".advanced-input")) {
    if (document.activeElement !== input) input.value = cfg(input.dataset.key, "");
    const spec2 = (store.settingsSpec || []).find((setting) => setting.key === input.dataset.key);
    input.classList.toggle("changed", Boolean(spec2 && cfg(spec2.key, spec2.value) !== spec2.value));
  }
}

$("btn-reset-settings").onclick = () => {
  const mode = store.state && store.state.mode;
  ask("Przywrócić domyślne punkty i czasy dla tego trybu?", () => act("resetSettings", { mode }));
};

function renderModePicker(s) {
  renderAdvancedSettings(s);
  for (const button of document.querySelectorAll(".mode-btn")) {
    button.classList.toggle("selected", button.dataset.mode === s.mode);
    button.disabled = !s.me.canManage;
  }
  $("mode-desc").textContent = s.mode === "piec"
    ? "Jak u WK: pytający czyta zadanie na głos, klika START i odpowiadający ma " + cfg("fiveAnswerSeconds", 5) + " s. Reszta głosuje, czy zaliczyć. Zaliczysz, to przejmujesz pytanie. Nie zaliczysz, tracisz życie. Są karty specjalne, wygrywa ostatni żywy."
    : s.mode === "wskazowka"
    ? "Ktoś wymyśla skalę (np. zły ↔ dobry kierowca), potem każdy po kolei podpowiada, a reszta ustawia wskazówkę na tarczy. Hasła nie są potrzebne."
    : s.mode === "klamca"
      ? "Wszyscy znają hasło oprócz kłamcy (czasem dostaje podpowiedź). Po kolei mówicie po jednym słowie, potem dyskusja i głosowanie, kto kłamie."
      : "Klasyczne Czółko: zgadujesz hasło, które widzą wszyscy oprócz ciebie.";
  for (const button of document.querySelectorAll(".liar-source-btn")) {
    button.classList.toggle("selected", button.dataset.source === s.liarSource);
    button.disabled = !s.me.canManage;
  }
  const chance = $("liar-hint-chance");
  if (document.activeElement !== chance) chance.value = String(s.liarHintChance);
  chance.disabled = !s.me.canManage;
  show($("liar-words-card"), s.mode === "klamca" && s.liarSource === "players");
  for (const button of document.querySelectorAll(".five-quick-btn")) {
    button.classList.toggle("selected", s.settings && s.settings[button.dataset.key] === Number(button.dataset.value));
    button.disabled = !s.me.canManage;
  }
  const hostSource = s.liarSource === "host";
  show($("liar-master-settings"), hostSource);
  for (const button of document.querySelectorAll(".liar-master-mode-btn")) {
    button.classList.toggle("selected", button.dataset.masterMode === s.liarMasterMode);
    button.disabled = !s.me.canManage;
  }
  show($("liar-master-pick-row"), hostSource && s.liarMasterMode === "fixed");
  fillMasterSelect($("liar-master-pick"), s, !s.me.canManage);
}

function fillMasterSelect(select, s, disabled) {
  const signature = s.players.map((p) => p.id + ":" + p.nick).join("|");
  if (select.dataset.signature !== signature) {
    select.dataset.signature = signature;
    select.replaceChildren(...s.players.map((p) => {
      const option = el("option", "", p.nick);
      option.value = p.id;
      return option;
    }));
  }
  if (document.activeElement !== select) select.value = s.liarMasterId || "";
  select.disabled = disabled;
}

for (const button of document.querySelectorAll(".liar-master-mode-btn")) {
  button.onclick = () => act("setLiarSettings", { masterMode: button.dataset.masterMode });
}
for (const button of document.querySelectorAll(".five-quick-btn")) {
  button.onclick = () => act("setSetting", { key: button.dataset.key, value: Number(button.dataset.value) });
}
for (const id of ["liar-master-pick", "liar-next-master"]) {
  $(id).onchange = (event) => act("liar:master", { playerId: event.target.value });
}

for (const button of document.querySelectorAll(".liar-source-btn")) {
  button.onclick = () => act("setLiarSettings", { source: button.dataset.source });
}
$("liar-hint-chance").onchange = (event) => act("setLiarSettings", { hintChance: Number(event.target.value) });

const liarWordsForm = (() => {
  const rows = [];
  let dirty = false;
  for (let i = 0; i < 5; i++) {
    const word = el("input", "liar-word-input");
    word.maxLength = 40;
    word.placeholder = "Hasło " + (i + 1);
    word.autocomplete = "off";
    const hint = el("input", "liar-hint-input");
    hint.maxLength = 40;
    hint.placeholder = "podpowiedź";
    hint.autocomplete = "off";
    for (const input of [word, hint]) input.addEventListener("input", () => {
      dirty = true;
      refresh();
    });
    const row = el("div", "liar-word-row");
    row.append(el("span", "liar-word-number", String(i + 1)), word, hint);
    $("liar-word-inputs").appendChild(row);
    rows.push({ word, hint });
  }

  function values() {
    return rows.map((row) => ({ word: row.word.value.trim(), hint: row.hint.value.trim() }));
  }

  function refresh() {
    const list = values();
    const filled = list.filter((entry) => entry.word && entry.hint).length;
    const ready = store.state && store.state.me.liarReady;
    let status = filled + "/5 gotowych";
    if (dirty) status += " · niezapisane zmiany";
    else if (ready) status = "✓ Hasła zapisane";
    $("liar-words-status").textContent = status;
    $("liar-words-status").classList.toggle("status-ok", !dirty && Boolean(ready));
    $("btn-save-liar-words").disabled = filled < 5;
  }

  $("btn-save-liar-words").onclick = async () => {
    const response = await act("setLiarWords", { entries: values() });
    if (response.ok) {
      dirty = false;
      toast("Hasła zapisane");
      refresh();
    }
  };

  function sync(s) {
    if (!dirty && s.me.liarWords && s.me.liarWords.length) {
      s.me.liarWords.forEach((entry, i) => {
        if (!rows[i]) return;
        rows[i].word.value = entry.word;
        rows[i].hint.value = entry.hint;
      });
    }
    refresh();
  }

  function reset() {
    dirty = false;
    for (const row of rows) {
      row.word.value = "";
      row.hint.value = "";
    }
    refresh();
  }

  return { sync, reset };
})();

const liarUi = { roundKey: "", stageKey: "", introRound: 0 };

function liarNick(id) {
  return (findPlayer(id) || { nick: "?" }).nick;
}

function liarTileLabel(s, p) {
  const liar = s.liar;
  if (!liar) return "—";
  if (p.id === liar.masterId) return "🎬 prowadzi";
  if (liar.stage === "reveal") {
    const result = (liar.results || []).find((r) => r.id === p.id);
    const pts = result ? "+" + result.points : "";
    return p.id === liar.impostorId ? "🕵️ kłamca " + pts : pts || "—";
  }
  if (liar.stage === "vote") return liar.voted.includes(p.id) ? "✅ zagłosował(a)" : "🤔 myśli…";
  if (liar.stage === "judge") return p.id === liar.impostorId ? "🕵️ czeka na werdykt" : liar.judged.includes(p.id) ? "✅ ocenił(a)" : "🤔 ocenia…";
  const clues = liar.clues.filter((clue) => clue.playerId === p.id).map((clue) => clue.text);
  if (liar.stage === "clues" && liar.speakerId === p.id) return clues.length ? clues.join(" · ") + " · 🗣️" : "🗣️ mówi…";
  return clues.length ? clues.join(" · ") : liar.stage === "setup" ? "⏳" : "…";
}

function renderLiarRole(s) {
  const liar = s.liar;
  const role = $("liar-role");
  role.className = "liar-role";
  role.replaceChildren();
  if (liar.role === "master") {
    role.classList.add("master");
    if (liar.stage === "setup") role.append(el("div", "liar-role-label", "🎬 Prowadzisz rundę"), el("div", "liar-role-word", "Wymyśl hasło"));
    else {
      role.append(el("div", "liar-role-label", "🎬 Prowadzisz · kłamcą jest " + liarNick(liar.impostorId)), el("div", "liar-role-word", liar.word));
      role.appendChild(el("div", "liar-role-hint", liar.hintGiven ? "Kłamca dostał podpowiedź: " + liar.hint : "Kłamca gra bez podpowiedzi"));
    }
    return;
  }
  if (liar.stage === "setup") {
    role.append(el("div", "liar-role-label", "🎬 " + liarNick(liar.masterId) + " wymyśla hasło…"));
    return;
  }
  if (liar.role === "impostor" && liar.stage !== "reveal") {
    role.classList.add("impostor");
    role.append(el("div", "liar-role-label", "Nie znasz hasła"), el("div", "liar-role-word", "🕵️ JESTEŚ KŁAMCĄ"));
    role.appendChild(el("div", "liar-role-hint", liar.hintGiven ? "Podpowiedź: " + liar.hint : "Bez podpowiedzi 😈 Udawaj!"));
    return;
  }
  role.classList.add("crew");
  role.append(el("div", "liar-role-label", liar.stage === "reveal" ? "Hasło było" : "Twoje hasło"), el("div", "liar-role-word", liar.word || "?"));
  if (liar.stage === "reveal" && liar.hint) {
    role.appendChild(el("div", "liar-role-hint", (liar.hintGiven ? "Kłamca dostał podpowiedź: " : "Kłamca NIE dostał podpowiedzi: ") + liar.hint));
  }
}

function renderLiarPanel(s) {
  const liar = s.liar;
  const me = s.me.id;
  const isMaster = liar.masterId === me;
  const isSpeaker = liar.speakerId === me;
  const canSkip = s.me.canManage || isMaster;
  const stage = liar.stage;
  show($("liar-setup"), stage === "setup" && isMaster);
  show($("liar-clue-form"), stage === "clues" && isSpeaker);
  show($("liar-vote"), stage === "vote");
  show($("liar-skip"), (stage === "vote" || stage === "judge") && canSkip);
  show($("liar-guess"), stage === "guess" && liar.impostorId === me);
  show($("liar-judge"), stage === "judge");
  show($("liar-reveal"), stage === "reveal");
  let wait = "";
  if (stage === "setup" && !isMaster) wait = "🎬 " + liarNick(liar.masterId) + " wpisuje hasło…";
  if (stage === "clues" && !isSpeaker) wait = "🗣️ Mówi " + liarNick(liar.speakerId) + " · kółko " + liar.lap + "/" + liar.laps;
  if (stage === "guess" && liar.impostorId !== me) wait = "😬 " + liarNick(liar.impostorId) + " był(a) kłamcą! Ostatnia szansa: zgaduje hasło…";
  $("liar-wait").textContent = wait;
  show($("liar-wait"), Boolean(wait));
  if (stage === "judge") {
    const guesser = liarNick(liar.impostorId);
    $("liar-judge-title").textContent = liar.impostorId === me ? "🤞 Reszta ocenia twój strzał…" : "🤔 " + guesser + " strzela: " + liar.judgeGuess;
    show($("liar-judge-buttons"), liar.canJudge);
    $("liar-judge-yes").classList.toggle("selected", liar.myJudge === true);
    $("liar-judge-no").classList.toggle("selected", liar.myJudge === false);
    $("liar-judge-status").textContent = (liar.canJudge ? "Hasło: „" + liar.word + "”. Zaliczacie? · " : "") + "ocenili " + liar.judged.length + "/" + liar.judgeCount;
  }
  if (stage === "vote") {
    const last = (liar.meetings || [])[liar.meetings.length - 1];
    const lastText = last && !last.ejectedId ? " · poprzednio: pominięte" : "";
    $("liar-vote-title").textContent = "🗳️ Kółko " + liar.lap + "/" + liar.laps + ": kto kłamie?" + lastText;
    show($("liar-vote-buttons"), liar.canVote);
    show($("liar-vote-skip"), liar.canVote);
    $("liar-vote-skip").classList.toggle("selected", liar.myVote === "skip");
    const myVote = liar.myVote === "skip" ? "⏭️ pomiń" : liar.myVote ? liarNick(liar.myVote) : null;
    $("liar-vote-status").textContent = !liar.canVote
      ? "Gracze gadają i głosują… " + liar.voted.length + "/" + liar.voters
      : myVote
        ? "Twój głos: " + myVote + " (możesz zmienić) · zagłosowali " + liar.voted.length + "/" + liar.voters
        : "Gadajcie! Kliknij gracza albo pomiń · zagłosowali " + liar.voted.length + "/" + liar.voters + (liar.lap >= liar.laps ? " · ostatnie kółko!" : "");
    const box = $("liar-vote-buttons");
    box.replaceChildren();
    for (const p of liar.canVote ? s.players : []) {
      if (p.id === me || p.id === liar.masterId) continue;
      const button = el("button", "btn help-choice liar-vote-btn" + (liar.myVote === p.id ? " selected" : ""));
      button.style.setProperty("--pc", p.color);
      const slot = el("div", "media-slot");
      bindSlot(slot, p);
      button.append(slot, el("span", "", p.nick));
      button.onclick = () => act("liar:vote", { playerId: p.id });
      box.appendChild(button);
    }
  }
  if (stage === "reveal") {
    const impostor = liarNick(liar.impostorId);
    let title;
    if (liar.escaped) title = "🏃 Kłamca " + impostor + " uciekł z gry!";
    else if (liar.wrongEject) title = "😱 Wyrzuciliście " + liarNick(liar.ejectedId) + "! Kłamcą był(a) " + impostor;
    else if (!liar.caught) title = "😈 " + impostor + " oszukał(a) wszystkich!";
    else if (liar.guessCorrect) title = "😏 Złapany, ale " + impostor + " zgadł(a) hasło!";
    else title = "🎉 Złapaliście kłamcę: " + impostor + "!";
    $("liar-reveal-title").textContent = title;
    const details = [];
    if (liar.guess) details.push("Strzał kłamcy: " + liar.guess + (liar.guessCorrect ? " ✅" : " ❌"));
    const votes = (liar.votes || []).map(([voter, target]) => liarNick(voter) + " → " + (target === "skip" ? "⏭️" : liarNick(target)));
    details.push("Kółek: " + liar.lap);
    if (votes.length) details.push("Ostatnie głosy: " + votes.join(", "));
    $("liar-reveal-details").textContent = details.join(" · ");
    const list = $("liar-results");
    list.replaceChildren();
    for (const r of liar.results || []) {
      const row = el("div", "wave-result" + (r.impostor ? " liar-impostor-row" : ""));
      row.style.setProperty("--pc", r.color);
      row.append(
        el("span", "wave-result-nick", (r.impostor ? "🕵️ " : "") + r.nick),
        el("span", "wave-result-value", r.votedFor === "skip" ? "pominął(a)" : r.votedFor ? "głos na " + liarNick(r.votedFor) : "bez głosu"),
        el("span", "wave-result-points", "+" + r.points)
      );
      list.appendChild(row);
    }
    show($("liar-continue"), canSkip);
    const canPick = s.liarSource === "host" && s.liarMasterMode === "fixed" && (s.me.canManage || isMaster);
    show($("liar-next-master-row"), canPick);
    if (canPick) fillMasterSelect($("liar-next-master"), s, false);
  }
}

function renderLiar(s) {
  const active = s.mode === "klamca" && Boolean(s.liar);
  show($("liar-stage"), active);
  if (!active) return;
  const liar = s.liar;
  store.quietTimer = liar.stage === "reveal" || liar.stage === "vote";
  store.turnTotal = s.turnTotalMs || TURN_TOTAL_MS;
  show($("action-bar"), false);
  show($("help-bar"), false);
  const stageKey = liar.round + "|" + liar.stage + "|" + liar.speakerId + "|" + liar.lap;
  if (liarUi.stageKey !== stageKey) {
    liarUi.stageKey = stageKey;
    if (liar.stage === "setup" && liar.masterId === s.me.id) {
      $("liar-setup-word").value = "";
      $("liar-setup-hint").value = "";
      setTimeout(() => $("liar-setup-word").focus(), 50);
    }
    if (liar.stage === "clues" && liar.speakerId === s.me.id) {
      $("liar-clue-input").value = "";
      setTimeout(() => $("liar-clue-input").focus(), 50);
    }
    if (liar.stage === "guess" && liar.impostorId === s.me.id) {
      $("liar-guess-input").value = "";
      setTimeout(() => $("liar-guess-input").focus(), 50);
    }
  }
  if (liar.stage !== "setup" && liarUi.introRound !== liar.round && liar.role) {
    liarUi.introRound = liar.round;
    fx.afterBusy(() => {
      if (liar.role === "impostor") fx.overlay([el("div", "fx-big liar-fx-impostor", "🕵️ JESTEŚ KŁAMCĄ!"), el("div", "fx-sub", liar.hintGiven ? "Podpowiedź: " + liar.hint : "Bez podpowiedzi. Powodzenia 😈")], "fx-win liar-fx", 2600);
      else if (liar.role === "crew") fx.overlay([el("div", "fx-sub", "Twoje hasło"), el("div", "fx-big", liar.word)], "fx-win liar-fx", 2200);
    });
  }
  let banner;
  if (liar.stage === "setup") banner = liar.masterId === s.me.id ? "🎬 Wpisz hasło na rundę" : "🎬 Prowadzący wymyśla hasło";
  else if (liar.stage === "clues") banner = liar.speakerId === s.me.id ? "🗣️ Twoje słowo!" : "🗣️ Mówi: " + liarNick(liar.speakerId);
  else if (liar.stage === "vote") banner = "🗳️ Dyskusja i głosowanie";
  else if (liar.stage === "guess") banner = "😬 Kłamca zgaduje hasło";
  else if (liar.stage === "judge") banner = "🤔 Zaliczacie strzał?";
  else banner = "🎉 Odsłona!";
  $("turn-banner").replaceChildren(banner + " ", el("span", "turn-timer"));
  $("turn-banner").classList.toggle("mine", s.activeId === s.me.id);
  renderLiarRole(s);
  renderLiarPanel(s);
  updateTurnTimers();
}

$("liar-setup-submit").onclick = () => act("liar:setup", { word: $("liar-setup-word").value, hint: $("liar-setup-hint").value });
$("liar-clue-submit").onclick = () => act("liar:clue", { text: $("liar-clue-input").value });
$("liar-skip").onclick = () => act("liar:skip");
$("liar-vote-skip").onclick = () => act("liar:vote", { playerId: "skip" });
$("liar-judge-yes").onclick = () => act("liar:judge", { approve: true });
$("liar-judge-no").onclick = () => act("liar:judge", { approve: false });
$("liar-guess-submit").onclick = () => act("liar:guess", { text: $("liar-guess-input").value });
$("liar-continue").onclick = () => act("liar:continue");
for (const [inputId, buttonId] of [["liar-setup-word", "liar-setup-submit"], ["liar-setup-hint", "liar-setup-submit"], ["liar-clue-input", "liar-clue-submit"], ["liar-guess-input", "liar-guess-submit"]]) {
  $(inputId).addEventListener("keydown", (event) => {
    if (event.key === "Enter") $(buttonId).click();
  });
}

function renderLiarRounds(rounds) {
  const history = $("history");
  for (const round of rounds) {
    const card = el("div", "history-player");
    const head = el("div", "history-head");
    let result;
    if (round.escaped) result = "🏃 uciekł";
    else if (round.wrongEject) result = "😈 wyrzucili " + round.ejectedNick;
    else if (!round.caught) result = "😈 wygrał";
    else if (round.guessCorrect) result = "😏 zgadł hasło";
    else result = "🎉 złapany";
    head.append(el("span", "history-nick", "„" + round.word + "”"), el("span", "history-stats", "kłamca: " + round.impostorNick + " · " + result));
    const list = el("ol", "history-list");
    const meta = el("li", "history-item");
    meta.append(
      el("span", "history-icon", "🕵️"),
      el("span", "history-word", round.hint ? (round.hintGiven ? "podpowiedź: " : "bez podpowiedzi (było: ") + round.hint + (round.hintGiven ? "" : ")") : "bez podpowiedzi"),
      el("span", "history-author", (round.laps ? round.laps + " kół. · " : "") + (round.guess ? "strzał: " + round.guess : "")),
      el("span", "history-time", round.clues.map((clue) => clue.nick + ": " + clue.text).join(", "))
    );
    list.appendChild(meta);
    card.append(head, list);
    history.appendChild(card);
  }
  show($("history-box"), rounds.length > 0);
}

for (const button of document.querySelectorAll(".mode-btn")) {
  button.onclick = () => act("setMode", { mode: button.dataset.mode });
}

function renderWaveRounds(rounds) {
  const history = $("history");
  const sets = new Map();
  for (const round of rounds) {
    if (!sets.has(round.set)) sets.set(round.set, { author: round.scaleAuthorNick, left: round.left, right: round.right, items: [] });
    sets.get(round.set).items.push(round);
  }
  for (const set of sets.values()) {
    const card = el("div", "history-player wave-history");
    const head = el("div", "history-head");
    head.append(el("span", "history-nick", set.left + " ↔ " + set.right), el("span", "history-stats", "skala od " + set.author));
    const list = el("ol", "history-list");
    for (const round of set.items) {
      const item = el("li", "history-item");
      const guesses = round.results.map((r) => r.nick + " " + (r.value === null ? "—" : Math.round(r.value)) + " (+" + r.points + ")").join(", ");
      item.append(
        el("span", "history-icon", "🔮"),
        el("span", "history-word", "„" + round.clue + "”"),
        el("span", "history-author", round.psychicNick + " +" + round.psychicPoints),
        el("span", "history-time", "cel " + Math.round(round.target) + " · " + guesses)
      );
      list.appendChild(item);
    }
    card.append(head, list);
    history.appendChild(card);
  }
  show($("history-box"), rounds.length > 0);
}

const notes = $("notes");
notes.value = storage.get(NOTES_KEY) || "";
notes.addEventListener("input", () => storage.set(NOTES_KEY, notes.value));

function clearNotes() {
  notes.value = "";
  storage.remove(NOTES_KEY);
}

$("btn-clear-notes").onclick = () => ask("Wyczyścić notatki?", clearNotes);

function render() {
  const s = store.state;
  if (!s || phone.mode) return;
  store.roomDeadline = s.roomRemainingMs === null ? 0 : performance.now() + s.roomRemainingMs;
  if (s.phase === "lobby") {
    showScreen("lobby");
    renderLobby(s);
  } else if (s.phase === "game") {
    showScreen("game");
    renderGame(s);
  } else {
    showScreen("end");
    renderEnd(s);
  }
  chat.renderAvailability();
  document.body.classList.toggle("mode-wave", s.mode === "wskazowka");
  document.body.classList.toggle("mode-liar", s.mode === "klamca");
  document.body.classList.toggle("mode-five", s.mode === "piec");
  notes.placeholder = s.mode === "wskazowka"
    ? "Twoje notatki: skojarzenia, podpowiedzi innych… Zostają tylko u ciebie."
    : s.mode === "klamca"
      ? "Notuj podejrzane skojarzenia… Zostają tylko u ciebie."
      : s.mode === "piec"
      ? "Notuj, kto ma jakie karty i kto komu dowalił… Zostaje tylko u ciebie."
      : "Co już wiesz o swoim haśle? Notatki zostają tylko u ciebie.";
  if (s.phase !== "game") {
    store.voteDeadline = 0;
    store.turnDeadline = 0;
    motion.reset();
  }
  renderAdminPanel(s);
  video.sync(s);
}

function goHome(message) {
  storage.remove(TOKEN_KEY);
  store.state = null;
  chat.setOpen(false);
  chat.clearAttachment();
  chat.setHistory([]);
  chat.renderAvailability();
  store.avatars.clear();
  store.voteDeadline = 0;
  store.roomDeadline = 0;
  video.disconnect();
  avatarEditor.reset();
  wordsForm.reset();
  liarWordsForm.reset();
  fiveTasksForm.reset();
  for (const tile of tiles.values()) tile.root.remove();
  tiles.clear();
  show($("admin-toggle"), false);
  show($("admin-panel"), false);
  $("home-error").textContent = message || "";
  showScreen("home");
}

async function enterRoom(event, payload) {
  const nick = $("home-nick").value.trim();
  if (!nick) {
    $("home-error").textContent = "Podaj nick";
    return;
  }
  storage.set(NICK_KEY, nick);
  const response = await call(event, { ...payload, nick });
  if (!response.ok) {
    $("home-error").textContent = response.error;
    return;
  }
  $("home-error").textContent = "";
  storage.set(TOKEN_KEY, response.token);
}

$("home-nick").value = storage.get(NICK_KEY) || "";
$("home-code").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z]/g, "");
});
$("btn-create").onclick = () => enterRoom("createRoom", {});
$("btn-join").onclick = () => enterRoom("joinRoom", { code: $("home-code").value });
$("home-code").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("btn-join").click();
});

const phone = {
  mode: false,
  room: null,
  code: "",
  facing: "user",
  wakeLock: null,

  open(code) {
    this.mode = true;
    showScreen("camera");
    show($("phone-form"), true);
    show($("phone-live"), false);
    $("phone-error").textContent = "";
    if (code) $("phone-code").value = code.toUpperCase();
  },

  close() {
    this.stop();
    this.mode = false;
    history.replaceState(null, "", location.pathname + (PROFILE ? `?p=${PROFILE}` : ""));
    resumeSession();
  },

  async connect() {
    const code = $("phone-code").value.trim().toUpperCase();
    if (!video.lib) return ($("phone-error").textContent = "Nie udało się wczytać biblioteki wideo");
    $("btn-phone-connect").disabled = true;
    const response = await call("cameraJoin", { code });
    $("btn-phone-connect").disabled = false;
    if (!response.ok) return ($("phone-error").textContent = response.error);
    const { Room, RoomEvent, VideoPresets } = video.lib;
    const room = new Room({ adaptiveStream: false, dynacast: true });
    room.on(RoomEvent.Disconnected, () => {
      if (this.room !== room) return;
      this.stop();
      $("phone-error").textContent = "Kamerka została rozłączona";
    });
    try {
      await room.connect(response.url, response.token);
      await room.localParticipant.setCameraEnabled(true, {
        facingMode: this.facing,
        resolution: VideoPresets.h360.resolution
      });
    } catch {
      room.disconnect();
      call("cameraLeave");
      $("phone-error").textContent = "Brak dostępu do kamery. Sprawdź uprawnienia przeglądarki";
      return;
    }
    this.room = room;
    this.code = code;
    $("phone-nick").textContent = response.nick;
    $("phone-nick").style.color = response.color;
    show($("phone-form"), false);
    show($("phone-live"), true);
    this.attachPreview();
    this.keepAwake();
  },

  attachPreview() {
    const track = video.cameraTrackOf(this.room && this.room.localParticipant);
    const element = $("phone-video");
    if (track) track.attach(element);
    element.classList.toggle("mirror", this.facing === "user");
  },

  async flip() {
    const track = video.cameraTrackOf(this.room && this.room.localParticipant);
    if (!track) return;
    this.facing = this.facing === "user" ? "environment" : "user";
    try {
      await track.restartTrack({ facingMode: this.facing });
    } catch {
      toast("Nie udało się przełączyć kamery", true);
    }
    this.attachPreview();
  },

  async keepAwake() {
    try {
      if ("wakeLock" in navigator && document.visibilityState === "visible") {
        this.wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch {}
  },

  stop() {
    const room = this.room;
    this.room = null;
    this.code = "";
    if (room) {
      room.disconnect();
      call("cameraLeave");
    }
    if (this.wakeLock) this.wakeLock.release().catch(() => {});
    this.wakeLock = null;
    show($("phone-form"), true);
    show($("phone-live"), false);
  }
};

$("btn-phone-mode").onclick = () => phone.open("");
$("btn-phone-back").onclick = () => phone.close();
$("btn-phone-connect").onclick = () => phone.connect();
$("btn-phone-flip").onclick = () => phone.flip();
$("btn-phone-stop").onclick = () => phone.stop();
$("phone-code").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
document.addEventListener("visibilitychange", () => {
  if (phone.room && document.visibilityState === "visible") phone.keepAwake();
});

const startCameraCode = new URLSearchParams(location.search).get("kamera");
if (startCameraCode) {
  phone.open(startCameraCode);
  if (startCameraCode.length === 6) phone.connect();
}

async function resumeSession() {
  const token = storage.get(TOKEN_KEY);
  if (!token) {
    showScreen("home");
    return;
  }
  const response = await call("resume", { token });
  if (!response.ok) goHome(response.error);
}

socket.on("connect", async () => {
  show($("connection"), false);
  if (store.replaced) return;
  if (phone.mode) {
    if (phone.room) call("cameraJoin", { code: phone.code, refreshOnly: true });
    return;
  }
  const token = storage.get(TOKEN_KEY);
  if (!token) {
    if (!store.state) showScreen("home");
    return;
  }
  const response = await call("resume", { token });
  if (!response.ok) goHome(response.error);
});

socket.on("disconnect", () => show($("connection"), !store.replaced && !phone.room));

socket.on("state", (state) => {
  store.state = state;
  render();
});

socket.on("avatars", (avatars) => {
  store.avatars = new Map(Object.entries(avatars));
  media.refreshAll();
});

socket.on("avatar", ({ id, data }) => {
  if (data) store.avatars.set(id, data);
  else store.avatars.delete(id);
  media.refreshAll();
});

socket.on("event", ({ text }) => toast(text));

socket.on("wordChanged", ({ reason, text }) => {
  motion.rollWord($("my-tile").querySelector(".my-word"), true);
  const myGridTile = store.state && tiles.get(store.state.me.id);
  if (myGridTile) motion.rollWord(myGridTile.word, true);
  if (reason === "rerolled") {
    toast("Host wylosował ci nowe hasło");
    if (notes.value.trim()) ask("Masz nowe hasło. Wyczyścić notatki?", clearNotes);
    return;
  }
  fx.reveal(text, reason);
  if (!notes.value.trim()) return;
  const what = reason === "guessed" ? "Zgadnięte" : "Spasowane";
  setTimeout(() => ask(`${what}! Twoje hasło to było: ${text}. Wyczyścić notatki?`, clearNotes), 2900);
});

socket.on("fx", (event) => fx.handle(event));

const CHAT_MAX_IMAGE = 440000;
const CHAT_IMAGE_SIDE = 1280;
const CHAT_GIF_LIMIT = 330000;
const CHAT_DOM_LIMIT = 200;
const URL_PATTERN = /(https?:\/\/[^\s<]+)/g;

const chat = {
  messages: [],
  open: false,
  unread: 0,
  attachment: null,
  sending: false,
  peekTimer: null,

  available() {
    return Boolean(store.state) && !phone.mode;
  },

  renderAvailability() {
    const visible = this.available();
    show($("chat-toggle"), visible && !this.open);
    if (!visible) {
      show($("chat-panel"), false);
      show($("chat-peek"), false);
    }
    this.renderRecipients();
  },

  setOpen(open) {
    this.open = open;
    show($("chat-panel"), open && this.available());
    show($("chat-toggle"), !open && this.available());
    if (open) {
      this.unread = 0;
      this.renderBadge();
      show($("chat-peek"), false);
      this.scrollToBottom(true);
      setTimeout(() => $("chat-input").focus(), 30);
    }
  },

  renderBadge() {
    $("chat-badge").textContent = this.unread > 9 ? "9+" : String(this.unread);
    show($("chat-badge"), this.unread > 0);
  },

  renderRecipients() {
    const select = $("chat-to");
    const s = store.state;
    if (!s) return;
    const current = select.value;
    const options = [["", "🌍 Wszyscy"]];
    for (const p of s.players) if (p.id !== s.me.id) options.push([p.id, "🔒 " + p.nick]);
    const signature = options.map((o) => o.join(":")).join("|");
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      select.replaceChildren(...options.map(([value, label]) => {
        const option = el("option", "", label);
        option.value = value;
        return option;
      }));
      select.value = options.some(([value]) => value === current) ? current : "";
    }
    this.renderMode();
  },

  renderMode() {
    const select = $("chat-to");
    const target = select.value ? findPlayer(select.value) : null;
    $("chat-panel").classList.toggle("private-mode", Boolean(target));
    $("chat-input").placeholder = target ? "Prywatnie do " + target.nick + "…" : "Napisz do wszystkich…";
  },

  setRecipient(id) {
    $("chat-to").value = id || "";
    this.renderMode();
    $("chat-input").focus();
  },

  formatTime(at) {
    const date = new Date(at);
    return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  },

  appendText(node, text) {
    let last = 0;
    for (const match of text.matchAll(URL_PATTERN)) {
      if (match.index > last) node.append(text.slice(last, match.index));
      const link = el("a", "chat-link", match[0]);
      link.href = match[0];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      node.appendChild(link);
      last = match.index + match[0].length;
    }
    if (last < text.length) node.append(text.slice(last));
  },

  buildMessage(m) {
    const me = store.state ? store.state.me.id : null;
    const mine = m.fromId === me;
    const item = el("div", "chat-msg" + (mine ? " mine" : "") + (m.toId ? " private" : ""));
    item.style.setProperty("--pc", m.color);
    const meta = el("div", "chat-meta");
    const author = el("button", "chat-author", mine ? "Ty" : m.fromNick);
    author.type = "button";
    if (!mine) {
      author.title = "Napisz prywatnie do " + m.fromNick;
      author.onclick = () => this.setRecipient(m.fromId);
    }
    meta.appendChild(author);
    if (m.toId) meta.appendChild(el("span", "chat-private-tag", mine ? "🔒 do " + m.toNick : "🔒 tylko do ciebie"));
    meta.appendChild(el("span", "chat-time", this.formatTime(m.at)));
    item.appendChild(meta);
    if (m.text) {
      const body = el("div", "chat-text");
      this.appendText(body, m.text);
      item.appendChild(body);
    }
    if (m.image) {
      const img = el("img", "chat-img");
      img.src = m.image;
      img.alt = "zdjęcie od " + m.fromNick;
      img.loading = "lazy";
      img.onload = () => this.scrollToBottom(false);
      img.onclick = () => this.showLightbox(m.image);
      item.appendChild(img);
    } else if (m.imageExpired) {
      item.appendChild(el("div", "chat-expired", "🖼️ starsze zdjęcie wygasło"));
    }
    return item;
  },

  nearBottom() {
    const list = $("chat-list");
    return list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  },

  scrollToBottom(force) {
    const list = $("chat-list");
    if (force || this.nearBottom()) list.scrollTop = list.scrollHeight;
  },

  renderAll() {
    const list = $("chat-list");
    list.replaceChildren();
    if (!this.messages.length) list.appendChild(el("p", "chat-empty", "Jeszcze cisza. Napisz coś! Kliknij nick, żeby napisać prywatnie."));
    for (const m of this.messages.slice(-CHAT_DOM_LIMIT)) list.appendChild(this.buildMessage(m));
    this.scrollToBottom(true);
  },

  setHistory(messages) {
    this.messages = messages;
    this.renderAll();
  },

  receive(m) {
    const list = $("chat-list");
    const stick = this.nearBottom();
    if (!this.messages.length) list.replaceChildren();
    this.messages.push(m);
    if (this.messages.length > CHAT_DOM_LIMIT) this.messages.shift();
    list.appendChild(this.buildMessage(m));
    while (list.children.length > CHAT_DOM_LIMIT) list.firstElementChild.remove();
    if (stick) this.scrollToBottom(true);
    const mine = store.state && m.fromId === store.state.me.id;
    if (mine) return;
    sfx.play(m.toId ? "chatPrivate" : "chat", 150);
    if (!this.open) {
      this.unread += 1;
      this.renderBadge();
      this.peek(m);
    }
  },

  peek(m) {
    const node = $("chat-peek");
    node.replaceChildren(
      el("b", "", (m.toId ? "🔒 " : "") + m.fromNick + ": "),
      document.createTextNode(m.text ? m.text.slice(0, 80) : "📷 zdjęcie")
    );
    node.style.setProperty("--pc", m.color);
    show(node, true);
    motion.restart(node, "chat-peek-in");
    clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => show(node, false), 3500);
  },

  showLightbox(src) {
    $("lightbox-img").src = src;
    show($("lightbox"), true);
  },

  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("read"));
      reader.readAsDataURL(file);
    });
  },

  loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image"));
      };
      image.src = url;
    });
  },

  async compress(file) {
    if (file.type === "image/gif" && file.size <= CHAT_GIF_LIMIT) return this.readFile(file);
    const image = await this.loadImage(file);
    let side = CHAT_IMAGE_SIDE;
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.7, 0.55]) {
        const data = canvas.toDataURL("image/jpeg", quality);
        if (data.length <= CHAT_MAX_IMAGE) return data;
      }
      side = Math.round(side * 0.7);
    }
    throw new Error("too-big");
  },

  async attach(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("To nie jest obrazek", true);
    try {
      this.attachment = await this.compress(file);
    } catch {
      this.attachment = null;
      return toast("Nie udało się przygotować zdjęcia", true);
    }
    $("chat-attachment-img").src = this.attachment;
    show($("chat-attachment"), true);
    if (!this.open) this.setOpen(true);
    $("chat-input").focus();
  },

  clearAttachment() {
    this.attachment = null;
    $("chat-attachment-img").removeAttribute("src");
    show($("chat-attachment"), false);
  },

  autosize() {
    const input = $("chat-input");
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  },

  async send() {
    if (this.sending) return;
    const input = $("chat-input");
    const text = input.value.trim();
    if (!text && !this.attachment) return;
    this.sending = true;
    $("chat-send").disabled = true;
    const response = await call("chat:send", { text, image: this.attachment, toId: $("chat-to").value || null });
    this.sending = false;
    $("chat-send").disabled = false;
    if (!response.ok) return toast(response.error, true);
    input.value = "";
    this.autosize();
    this.clearAttachment();
    input.focus();
  }
};

$("chat-toggle").onclick = () => chat.setOpen(true);
$("chat-close").onclick = () => chat.setOpen(false);
$("chat-send").onclick = () => chat.send();
$("chat-to").onchange = () => chat.renderMode();
$("chat-attach").onclick = () => $("chat-file").click();
$("chat-file").onchange = (event) => {
  chat.attach(event.target.files[0]);
  event.target.value = "";
};
$("chat-attachment-remove").onclick = () => chat.clearAttachment();
$("chat-input").addEventListener("input", () => chat.autosize());
$("chat-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chat.send();
  }
  if (event.key === "Escape") chat.setOpen(false);
});
$("chat-input").addEventListener("paste", (event) => {
  const items = event.clipboardData ? [...event.clipboardData.items] : [];
  const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
  if (!imageItem) return;
  event.preventDefault();
  chat.attach(imageItem.getAsFile());
});
const chatPanel = $("chat-panel");
let chatDragDepth = 0;
chatPanel.addEventListener("dragenter", (event) => {
  if (![...event.dataTransfer.types].includes("Files")) return;
  event.preventDefault();
  chatDragDepth += 1;
  show($("chat-drop"), true);
});
chatPanel.addEventListener("dragover", (event) => {
  if ([...event.dataTransfer.types].includes("Files")) event.preventDefault();
});
chatPanel.addEventListener("dragleave", () => {
  chatDragDepth = Math.max(0, chatDragDepth - 1);
  if (!chatDragDepth) show($("chat-drop"), false);
});
chatPanel.addEventListener("drop", (event) => {
  event.preventDefault();
  chatDragDepth = 0;
  show($("chat-drop"), false);
  const file = [...event.dataTransfer.files].find((f) => f.type.startsWith("image/"));
  if (file) chat.attach(file);
});
$("chat-peek").onclick = () => chat.setOpen(true);
$("lightbox").onclick = () => show($("lightbox"), false);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("lightbox").classList.contains("hidden")) show($("lightbox"), false);
});

socket.on("chat:history", (messages) => chat.setHistory(Array.isArray(messages) ? messages : []));
socket.on("chat:message", (message) => chat.receive(message));


function renderSoundToggle() {
  const index = Math.max(0, VOLUME_LEVELS.indexOf(sfx.level));
  $("sound-toggle").textContent = VOLUME_ICONS[index];
}

$("sound-toggle").onclick = () => {
  const index = Math.max(0, VOLUME_LEVELS.indexOf(sfx.level));
  sfx.setLevel(VOLUME_LEVELS[(index + 1) % VOLUME_LEVELS.length]);
  renderSoundToggle();
$("music-toggle").onclick = () => music.toggle();
music.render();
  sfx.play("preview", 0);
};
renderSoundToggle();

let lastReactionAt = 0;
for (const emoji of REACTIONS) {
  const button = el("button", "btn reaction-btn", emoji);
  button.onclick = () => {
    const now = performance.now();
    if (now - lastReactionAt < 300) return;
    lastReactionAt = now;
    call("react", { emoji });
  };
  $("reactions").appendChild(button);
}

socket.on("kicked", ({ reason }) => goHome(reason));

socket.on("replaced", () => {
  store.replaced = true;
  socket.disconnect();
  show($("replaced"), true);
});

function scoreUnit(s, score) {
  return s.mode === "piec" ? score + " ❤️" : fmtScore(score) + " pkt";
}

const fiveUi = { pending: null, stageKey: "" };

function fiveCardInfo(type) {
  return (store.fiveCards || {})[type] || { icon: "🃏", name: type, text: "", target: null };
}

function fiveHearts(lives) {
  return lives <= 5 ? "❤️".repeat(lives) : "❤️×" + lives;
}

function fiveTileLabel(s, p) {
  const cards = p.cardCount ? "🃏" + (p.cardCount > 1 ? "×" + p.cardCount : "") : "";
  const curses = p.curses.map((type) => fiveCardInfo(type).icon).join("");
  const extra = [cards, curses ? "⚠️" + curses : ""].filter(Boolean).join(" ");
  const top = p.out ? "💀 odpadł(a)" : fiveHearts(p.lives);
  return extra ? top + "\n" + extra : top;
}

const fiveCurseText = {
  torpedo: "💣 Torpeda: nie zaliczy = −2 ❤️",
  english: "🫖 odpowiada po angielsku",
  disco: "🎤 śpiewa w stylu disco polo",
  four: "4️⃣ musi podać 4 odpowiedzi"
};

function fiveTargets(s, type, me) {
  const info = fiveCardInfo(type);
  return s.players.filter((p) => {
    if (info.target === "dead") return p.out;
    if (p.out) return false;
    if (info.target === "other") return p.id !== me;
    return true;
  });
}

function renderFiveHand(s, five) {
  const me = findPlayer(s.me.id);
  const cards = me ? me.cards : [];
  show($("five-hand-box"), cards.length > 0);
  const hand = $("five-hand");
  hand.replaceChildren();
  for (const card of cards) {
    const info = fiveCardInfo(card.type);
    const button = el("button", "btn five-card-btn");
    button.title = info.text;
    button.append(el("span", "five-card-icon", info.icon), el("span", "five-card-name", info.name), el("span", "five-card-text", info.text));
    let usable = five.stage !== "answer";
    if (card.type === "angel") usable = five.stage === "vote" && !five.angelUsed;
    if (card.type === "reverse") usable = five.stage === "ready" && five.answererId === s.me.id && !five.reversed;
    if (card.type !== "revive" && me.out) usable = false;
    if (card.type === "ally" && me.lives < 2) usable = false;
    if (info.target && !fiveTargets(s, card.type, s.me.id).length) usable = false;
    button.disabled = !usable;
    button.onclick = () => {
      if (!info.target) {
        ask("Zagrać kartę " + info.icon + " " + info.name + "?", () => act("five:card", { cardId: card.id }));
        return;
      }
      fiveUi.pending = card;
      renderFive(store.state);
    };
    hand.appendChild(button);
  }
  const pending = fiveUi.pending && cards.find((c) => c.id === fiveUi.pending.id) && five.stage !== "answer" ? fiveUi.pending : null;
  fiveUi.pending = pending;
  show($("five-target"), Boolean(pending));
  if (!pending) return;
  const info = fiveCardInfo(pending.type);
  $("five-target-title").textContent = info.icon + " " + info.name + ": na kogo?";
  const box = $("five-target-buttons");
  box.replaceChildren();
  for (const p of fiveTargets(s, pending.type, s.me.id)) {
    const button = el("button", "btn help-choice liar-vote-btn");
    button.style.setProperty("--pc", p.color);
    const slot = el("div", "media-slot");
    bindSlot(slot, p);
    button.append(slot, el("span", "", p.nick + (p.id === s.me.id ? " (ty)" : "")));
    button.onclick = async () => {
      fiveUi.pending = null;
      await act("five:card", { cardId: pending.id, playerId: p.id });
      renderFive(store.state);
    };
    box.appendChild(button);
  }
}

function renderFive(s) {
  const active = s.mode === "piec" && Boolean(s.five) && s.phase === "game";
  show($("five-stage"), active);
  if (!active) return;
  const five = s.five;
  const me = s.me.id;
  const isAsker = five.askerId === me;
  const isAnswerer = five.answererId === me;
  store.quietTimer = five.stage !== "answer";
  store.turnTotal = s.turnTotalMs || 5000;
  show($("action-bar"), false);
  show($("help-bar"), false);
  const asker = liarNick(five.askerId);
  const answerer = five.answererId ? liarNick(five.answererId) : "";
  let who;
  if (five.stage === "pick") who = isAsker ? "🎤 Pytasz! Wybierz, kogo" : "🎤 " + asker + " wybiera, kogo pyta";
  else if (five.reversed) who = "🔄 Odwrotka! " + asker + " pyta: " + answerer;
  else who = "🎤 " + asker + " → " + answerer;
  $("five-who").textContent = who;
  let task = "";
  if (five.stage === "pick") task = five.last ? (five.last.passed ? "✅ " : "❌ ") + liarNick(five.last.answererId) + (five.last.passed ? " zaliczył(a)" : " nie zaliczył(a)" + (five.last.out ? " i odpada 💀" : "")) : "⏱️ 5 sekund";
  else if (five.task) task = five.task;
  else task = isAnswerer ? "👂 Słuchaj! " + asker + " czyta ci zadanie…" : "🤫 " + asker + " czyta zadanie…";
  $("five-task").textContent = task;
  $("five-card").classList.toggle("five-live", five.stage === "answer");
  $("five-card").classList.toggle("five-mine", isAnswerer && five.stage !== "pick");
  const curseLines = five.stage === "pick" ? [] : five.curses.map((type) => fiveCurseText[type]).filter(Boolean);
  if (five.taskAuthor) curseLines.unshift("📝 zadanie od " + five.taskAuthor);
  $("five-curses").textContent = curseLines.join(" · ");
  show($("five-count"), five.stage === "answer");

  show($("five-pick"), five.stage === "pick" && isAsker);
  if (five.stage === "pick" && isAsker) {
    $("five-pick-status").textContent = "Kogo pytasz?";
    const box = $("five-pick-buttons");
    box.replaceChildren();
    for (const p of s.players) {
      if (p.id === me || p.out) continue;
      const button = el("button", "btn help-choice liar-vote-btn");
      button.style.setProperty("--pc", p.color);
      const slot = el("div", "media-slot");
      bindSlot(slot, p);
      button.append(slot, el("span", "five-pick-nick", p.nick), el("span", "five-pick-hearts", fiveHearts(p.lives)));
      button.onclick = () => act("five:choose", { playerId: p.id });
      box.appendChild(button);
    }
  }
  show($("five-ready"), five.stage === "ready" && (isAsker || s.me.canManage));
  $("five-reroll").disabled = !isAsker;
  show($("five-vote"), five.stage === "vote");
  if (five.stage === "vote") {
    $("five-vote-title").textContent = isAnswerer ? "🤞 Reszta ocenia twoją odpowiedź…" : "Zaliczamy " + answerer + "?";
    show($("five-vote-buttons"), five.canVote);
    $("five-yes").classList.toggle("selected", five.myVote === true);
    $("five-no").classList.toggle("selected", five.myVote === false);
    $("five-vote-status").textContent = "✅ " + five.yes + " · ❌ " + five.no + " · zagłosowali " + five.voted.length + "/" + five.voters + " (potrzeba " + five.required + " na tak)";
  }
  let wait = "";
  if (five.stage === "ready" && !isAsker && !isAnswerer) wait = asker + " czyta zadanie dla: " + answerer;
  if (five.stage === "answer") wait = isAnswerer ? "🗣️ GADAJ!" : "🗣️ " + answerer + " odpowiada!";
  $("five-wait").textContent = wait;
  show($("five-wait"), Boolean(wait));
  let banner;
  if (five.stage === "pick") banner = isAsker ? "🎤 Twoje pytanie!" : "🎤 Pyta: " + asker;
  else if (five.stage === "ready") banner = isAnswerer ? "👂 Pytają cię!" : isAsker ? "📖 Przeczytaj zadanie na głos!" : "📖 " + asker + " czyta zadanie";
  else if (five.stage === "answer") banner = isAnswerer ? "⏱️ TWOJE " + cfg("fiveAnswerSeconds", 5) + " SEKUND!" : "⏱️ Odpowiada: " + answerer;
  else banner = "🗳️ Zaliczamy?";
  $("turn-banner").replaceChildren(banner + " ", el("span", "turn-timer"));
  $("turn-banner").classList.toggle("mine", isAsker || isAnswerer);
  renderFiveHand(s, five);
  updateTurnTimers();
}

$("five-reroll").onclick = () => act("five:reroll");
$("five-start").onclick = () => act("five:start");
$("five-yes").onclick = () => act("five:vote", { approve: true });
$("five-no").onclick = () => act("five:vote", { approve: false });
$("five-target-cancel").onclick = () => {
  fiveUi.pending = null;
  if (store.state) renderFive(store.state);
};

const fiveTasksForm = (() => {
  let dirty = false;
  const input = $("five-tasks-input");
  function list() {
    return input.value.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  function refresh() {
    const count = list().length;
    const saved = store.state ? (store.state.me.fiveTasks || []).length : 0;
    $("five-tasks-status").textContent = dirty ? count + " zadań · niezapisane zmiany" : saved ? "✓ Zapisane: " + saved : "";
    $("btn-save-five-tasks").disabled = !dirty || count > 30;
    if (count > 30) $("five-tasks-status").textContent = "Maksymalnie 30 zadań";
  }
  input.addEventListener("input", () => {
    dirty = true;
    refresh();
  });
  $("btn-save-five-tasks").onclick = async () => {
    const response = await act("setFiveTasks", { tasks: list() });
    if (response.ok) {
      dirty = false;
      toast("Zadania zapisane");
      refresh();
    }
  };
  function sync(s) {
    if (!dirty && document.activeElement !== input) input.value = (s.me.fiveTasks || []).join("\n");
    refresh();
  }
  function reset() {
    dirty = false;
    input.value = "";
  }
  return { sync, reset };
})();

function renderFiveRounds(rounds) {
  const history = $("history");
  const card = el("div", "history-player");
  const head = el("div", "history-head");
  const passed = rounds.filter((r) => r.passed).length;
  head.append(el("span", "history-nick", "⏱️ " + rounds.length + " pytań"), el("span", "history-stats", "✅ " + passed + " · ❌ " + (rounds.length - passed)));
  const list = el("ol", "history-list");
  for (const round of rounds) {
    const item = el("li", "history-item");
    item.append(
      el("span", "history-icon", round.passed ? "✅" : round.out ? "💀" : "❌"),
      el("span", "history-word", round.task),
      el("span", "history-author", (round.reversed ? "🔄 " : "") + round.askerNick + " → " + round.answererNick),
      el("span", "history-time", (round.authorNick ? "zadanie od " + round.authorNick + " · " : "") + (round.lost ? "−" + round.lost + " ❤️" : ""))
    );
    list.appendChild(item);
  }
  card.append(head, list);
  history.appendChild(card);
  show($("history-box"), rounds.length > 0);
}
