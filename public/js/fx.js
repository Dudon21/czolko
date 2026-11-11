const ROLL_TIME_MS = 5000;

const ROLL_REVEAL_FROM = 0.6;
const SCRAMBLE_CHARS = "#$%&@*?!+=<>{}[]/\~^";
const SECRET_DECOYS = ["???", "?!?", "¿??", "?¿?", "??¿", "!??", "??!", "???"];

const REACTIONS = ["😂", "🔥", "👏", "😱", "🤦", "🤔", "💀", "❤️"];

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
        this.stamp(id, fiveSecondsText().toUpperCase() + "!", "stamp-vote");
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
          setTimeout(() => this.overlay([el("div", "fx-big", "💀 " + nickOf(id) + " ODPADA!")], "fx-win", 1800), 500);
        } else if (event.card) {
          setTimeout(() => {
            const mine = id === me ? findPlayer(me) : null;
            const newest = mine && mine.cards.length ? fiveCardInfo(mine.cards[mine.cards.length - 1].type) : null;
            if (newest) this.overlay([el("div", "fx-sub", "Dostajesz tajną kartę"), el("div", "fx-big", newest.icon + " " + newest.name), el("div", "fx-sub", newest.text)], "fx-win", 2600);
            else this.overlay([el("div", "fx-sub", nickOf(id) + " dostaje tajną kartę"), el("div", "fx-big", "🃏")], "fx-win", 1500);
          }, 600);
        }
        break;
      case "fiveGift":
        sfx.play("refill", 0);
        this.stamp(id, "🎁", "stamp-author");
        setTimeout(() => {
          const mine = id === me ? findPlayer(me) : null;
          const newest = mine && mine.cards.length ? fiveCardInfo(mine.cards[mine.cards.length - 1].type) : null;
          if (newest) this.overlay([el("div", "fx-sub", "🎁 Host daje ci kartę"), el("div", "fx-big", newest.icon + " " + newest.name), el("div", "fx-sub", newest.text)], "fx-win", 2600);
        }, 300);
        break;
      case "fiveCard": {
        const info = (store.fiveCards || {})[event.card];
        sfx.play("author", 0);
        if (info) {
          this.stamp(event.targetId || id, info.icon, "stamp-author");
          this.overlay([el("div", "fx-sub", nickOf(id) + " zagrywa"), el("div", "fx-big", info.icon + " " + info.name)], "fx-win", 1600);
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
