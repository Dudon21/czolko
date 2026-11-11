const PROFILE = new URLSearchParams(location.search).get("p") || "";
const TOKEN_KEY = `czolko-token${PROFILE}`;
const NICK_KEY = `czolko-nick${PROFILE}`;
const NOTES_KEY = `czolko-notes${PROFILE}`;
const CAMERA_KEY = `czolko-camera${PROFILE}`;

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

const socket = io({ autoConnect: false });

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

function patchList(box, signature, build) {
  if (box.dataset.signature === signature) return false;
  box.dataset.signature = signature;
  box.replaceChildren();
  build(box);
  return true;
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

function cfg(key, fallback) {
  const settings = store.state && store.state.settings;
  return settings && typeof settings[key] === "number" ? settings[key] : fallback;
}

function findPlayer(id) {
  return store.state ? store.state.players.find((p) => p.id === id) : null;
}

function leaderIds(players) {
  const best = Math.max(...players.map((p) => p.score));
  if (best <= 0) return new Set();
  return new Set(players.filter((p) => p.score === best).map((p) => p.id));
}

function secondsLeft(deadline) {
  return Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function formatSeconds(total) {
  return total >= 60 ? Math.floor(total / 60) + " min " + (total % 60) + " s" : total + " s";
}

function nickOf(id) {
  return (findPlayer(id) || { nick: "?" }).nick;
}

function scoreUnit(s, score) {
  return s.mode === "piec" ? score + " ❤️" : fmtScore(score) + " pkt";
}
