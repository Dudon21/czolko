const ROOM_WARNING_SECONDS = 120;

const TURN_TOTAL_MS = 45000;

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
    tile.root.classList.toggle("liar-suspect", Boolean(liar && liar.stage === "reveal" && (liar.impostorIds || []).includes(p.id)));
    bindSlot(tile.slot, p);
    return;
  }
  tile.root.classList.remove("liar-suspect");
  if (s.mode === "kto") {
    tile.word.dataset.word = "";
    const label = ktoTileLabel(s, p);
    if (tile.word.textContent !== label) {
      tile.word.textContent = label;
      if (label.includes("+")) motion.restart(tile.word, "word-new");
    }
    const picked = Boolean(s.kto && s.kto.winnerIds.includes(p.id));
    show(tile.badge, picked);
    tile.badge.textContent = "🫵 To on(a)!";
    tile.root.classList.toggle("liar-suspect", picked);
    tile.root.classList.remove("five-out", "five-duel");
    bindSlot(tile.slot, p);
    return;
  }
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
  grid.classList.toggle("liar-mode", s.mode === "klamca" || s.mode === "kto");
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
  renderKto(s);
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

$("btn-guess").onclick = () => act("guess");

$("btn-pass").onclick = () => {
  const penalty = store.state ? store.state.me.nextPassCost : 0;
  ask(penalty ? "Spasować? Stracisz " + fmtScore(penalty) + " pkt." : "Spasować? Ten pass jest za darmo.", () => act("pass"));
};

$("btn-vote-yes").onclick = () => act("vote", { approve: true });
$("btn-vote-no").onclick = () => act("vote", { approve: false });

const notes = $("notes");

notes.value = storage.get(NOTES_KEY) || "";

notes.addEventListener("input", () => storage.set(NOTES_KEY, notes.value));

function clearNotes() {
  notes.value = "";
  storage.remove(NOTES_KEY);
}

$("btn-clear-notes").onclick = () => ask("Wyczyścić notatki?", clearNotes);
