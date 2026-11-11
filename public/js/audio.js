const VOLUME_KEY = "czolko-volume";
const VOLUME_LEVELS = [0.7, 0.35, 0];
const VOLUME_ICONS = ["🔊", "🔉", "🔇"];

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

$("music-toggle").onclick = () => music.toggle();
