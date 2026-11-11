applyTheme(storage.get(THEME_KEY) === "dark" ? "dark" : "light");

$("theme-toggle").onclick = () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  storage.set(THEME_KEY, next);
  applyTheme(next);
};

fetch("/config.json")
  .then((res) => res.json())
  .then((config) => {
    store.settingsSpec = Array.isArray(config.settings) ? config.settings : [];
    store.fiveCards = config.fiveCards || {};
    if (store.state) render();
    renderCameraButtons();
    if (!config.video) return;
    video.load().then((lib) => {
      video.available = Boolean(lib);
      renderCameraButtons();
      if (store.state) video.sync(store.state);
    });
  })
  .catch(() => {});

setInterval(() => {
  if (store.voteDeadline) updateVoteTimers();
  if (store.helpDeadline) updateHelpTimers();
  if (store.gameDeadline) updateGameClock();
  updateTurnTimers();
  updateRoomTimers();
}, 250);

nextKey.render();

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
  document.body.classList.toggle("mode-kto", s.mode === "kto");
  notes.placeholder = s.mode === "wskazowka"
    ? "Twoje notatki: skojarzenia, podpowiedzi innych… Zostają tylko u ciebie."
    : s.mode === "klamca"
      ? "Notuj podejrzane skojarzenia… Zostają tylko u ciebie."
      : s.mode === "kto"
      ? "Notuj, kto na kogo głosuje… Zostaje tylko u ciebie."
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
  ktoQuestionsForm.reset();
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

let renderQueued = false;

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  const run = () => {
    renderQueued = false;
    render();
  };
  if (document.hidden) setTimeout(run, 0);
  else requestAnimationFrame(run);
}

socket.on("state", (state) => {
  store.state = state;
  scheduleRender();
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

socket.on("build", (build) => {
  if (!store.build) store.build = build;
  else if (store.build !== build) show($("update-banner"), true);
});

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

renderSoundToggle();

socket.on("kicked", ({ reason }) => goHome(reason));

socket.on("replaced", () => {
  store.replaced = true;
  socket.disconnect();
  show($("replaced"), true);
});

music.render();
socket.connect();
