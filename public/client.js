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
    const { type = "sine", vol = 0.2, slide = 0, attack = 0.01, vibrato = 0 } = options;
    const ctx = this.ctx;
    const t = ctx.currentTime + start;
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
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  },

  noise(start, duration, options = {}) {
    const { vol = 0.15, freq = 2000, q = 0.8, filter = "bandpass" } = options;
    const ctx = this.ctx;
    if (!this.noiseBuffer) {
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + start;
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
    gain.connect(this.master);
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
    preview() { this.tone(988, 0, 0.18, { type: "triangle", vol: 0.15 }); }
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

for (const eventName of ["pointerdown", "keydown"]) {
  document.addEventListener(eventName, () => sfx.ensure(), { once: true, capture: true });
}

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

const wordsForm = (() => {
  const inputs = [];
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
    const row = el("div", "word-row");
    row.append(input, reroll);
    $("word-inputs").appendChild(row);
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
    const filled = list.filter(Boolean).length;
    const ready = store.state && store.state.me.wordsReady;
    let status = `${filled}/${WORDS_PER_PLAYER} haseł`;
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
    const response = await act("setWords", { words: list });
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
    }
    refresh();
  }

  function reset() {
    dirty = false;
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
    tags.appendChild(el("span", `tag ${p.wordsReady ? "tag-ok" : ""}`, p.wordsReady ? "✓ hasła" : "pisze hasła…"));
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

  const missing = s.players.filter((p) => !p.wordsReady).map((p) => p.nick);
  const host = s.players.find((p) => p.canManage);
  const allReady = s.players.length >= 2 && missing.length === 0;
  let hint = "";
  if (s.players.length < 2) hint = "Czekamy na co najmniej 2 graczy";
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
  const spotlight = !helpMode && others.some((p) => p.id === s.activeId);
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
  root.querySelector(".my-score").textContent = fmtScore(me.score) + " pkt";
  const myAuthor = root.querySelector(".my-author");
  show(myAuthor, Boolean(me.authorNick));
  myAuthor.textContent = me.authorNick ? "✍️ hasło od " + me.authorNick : "";
  show(root.querySelector(".my-turn-badge"), s.activeId === me.id);
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
  show($("btn-help"), s.helpLimit > 0);
  $("btn-help").textContent = "🆘 Pomoc (" + helpsLeft + ")";
  $("btn-help").disabled = Boolean(s.vote) || Boolean(s.help) || helpsLeft <= 0;
  $("btn-author").disabled = Boolean(s.vote) || Boolean(me && me.authorNick);
  $("btn-author").textContent = me && me.authorNick ? "🕵️ od " + me.authorNick : "🕵️ Autor (−0,5)";
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

$("btn-author").onclick = () => ask("Odkryć, kto wpisał twoje hasło? Kosztuje 0,5 punktu.", () => act("revealAuthor"));

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
    const fraction = Math.max(0, Math.min(1, (store.turnDeadline - performance.now()) / TURN_TOTAL_MS));
    const fill = $("turn-bar").firstElementChild;
    fill.style.transform = "scaleX(" + fraction.toFixed(4) + ")";
    fill.classList.toggle("low", hurry);
  }
  if (hurry && seconds > 0 && seconds !== store.lastTick) sfx.play(seconds <= 5 ? "tickHard" : "tick", 0);
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
$("btn-pass").onclick = () => ask("Spasować? Stracisz 1 punkt.", () => act("pass"));
$("btn-vote-yes").onclick = () => act("vote", { approve: true });
$("btn-vote-no").onclick = () => act("vote", { approve: false });

function renderEnd(s) {
  const reasons = {
    limit: "Ktoś dobił do limitu punktów!",
    time: "⏰ Koniec czasu! Wygrywa ten, kto ma najwięcej.",
    pool: "Skończyły się hasła do wylosowania.",
    players: "Zostało za mało graczy.",
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
      step.append(el("div", "podium-medal", medals[index]), el("div", "podium-score", fmtScore(r.score) + " pkt"));
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
      item.append(slot, el("div", "loser-nick", (i + 4) + ". " + r.nick), el("div", "loser-score", fmtScore(r.score) + " pkt"));
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
  for (const button of document.querySelectorAll("[data-admin=forceNext]")) button.disabled = s.phase !== "game";

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
    const reroll = el("button", "btn btn-small", "🔄");
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
  store.avatars.clear();
  store.voteDeadline = 0;
  store.roomDeadline = 0;
  video.disconnect();
  avatarEditor.reset();
  wordsForm.reset();
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

function renderSoundToggle() {
  const index = Math.max(0, VOLUME_LEVELS.indexOf(sfx.level));
  $("sound-toggle").textContent = VOLUME_ICONS[index];
}

$("sound-toggle").onclick = () => {
  const index = Math.max(0, VOLUME_LEVELS.indexOf(sfx.level));
  sfx.setLevel(VOLUME_LEVELS[(index + 1) % VOLUME_LEVELS.length]);
  renderSoundToggle();
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
