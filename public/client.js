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
  turnDeadline: 0,
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
  $("btn-camera").textContent = video.cameraOn ? "Wyłącz kamerkę" : "Włącz kamerkę";
  $("btn-camera").classList.toggle("selected", video.cameraOn);
  $("btn-camera-game").classList.toggle("selected", video.cameraOn);
  $("btn-camera-game").title = video.cameraOn ? "Wyłącz kamerkę" : "Włącz kamerkę";
}

for (const id of ["btn-camera", "btn-camera-game"]) {
  $(id).onclick = () => video.setCamera(!video.cameraOn);
}

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
    uploadTimer = setTimeout(() => act("setAvatar", { data: canvas.toDataURL("image/png") }), 350);
  }

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
  $("phone-site").textContent = location.host;
  $("my-camera-code").textContent = s.me.cameraCode;
  $("phone-status").textContent = me && me.hasPhone ? "📱 telefon połączony" : "telefon niepodłączony";
  $("phone-status").classList.toggle("tag-ok", Boolean(me && me.hasPhone));
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
  frame.append(slot, nick, score, word);
  root.append(top, frame);
  return { root, frame, crown, badge, slot, score, nick, word };
}

function updateTile(tile, p, s, leaders) {
  tile.root.style.setProperty("--pc", p.color);
  tile.root.classList.toggle("active", s.activeId === p.id);
  tile.root.classList.toggle("offline", !p.connected);
  show(tile.crown, leaders.has(p.id));
  show(tile.badge, s.activeId === p.id);
  tile.score.textContent = p.score;
  tile.nick.textContent = p.connected ? p.nick : `${p.nick} (offline)`;
  tile.root.classList.toggle("me", p.id === s.me.id);
  const previousWord = tile.word.textContent;
  const nextWord = p.id === s.me.id ? "???" : p.word || "—";
  tile.word.textContent = nextWord;
  if (previousWord && previousWord !== "—" && previousWord !== nextWord) motion.restart(tile.word, "word-new");
  bindSlot(tile.slot, p);
}

const motion = {
  reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  lastScores: new Map(),
  lastActiveId: null,

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
      this.floatText(anchor, delta > 0 ? `+${delta}` : `${delta}`, delta > 0 ? "plus" : "minus");
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

  reset() {
    this.lastScores = new Map();
    this.lastActiveId = null;
  }
};

function renderGrid(s, leaders) {
  const grid = $("players-grid");
  const others = s.players.filter((p) => store.selfInGrid || p.id !== s.me.id);
  const spotlight = others.some((p) => p.id === s.activeId);
  grid.classList.toggle("spotlight", spotlight);
  const turnChanged = motion.lastActiveId !== null && motion.lastActiveId !== s.activeId;
  motion.lastActiveId = s.activeId;
  const rects = turnChanged ? motion.capture() : null;
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
  root.classList.toggle("compact", store.selfInGrid);
  $("btn-layout").classList.toggle("selected", !store.selfInGrid);
  bindSlot(root.querySelector(".media-slot"), me);
  root.querySelector(".my-nick").textContent = (leaders.has(me.id) ? "👑 " : "") + me.nick;
  root.querySelector(".my-score").textContent = `${me.score} pkt`;
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
  $("action-status").replaceChildren();
  if (myTurn && s.vote) {
    $("action-status").append(`Czekam na głosy: ✔ ${s.vote.yes}/${s.vote.required} · ✖ ${s.vote.no} · `);
    $("action-status").appendChild(el("span", "vote-timer"));
  } else if (myTurn) {
    $("action-status").append(`Gramy do ${s.pointLimit} pkt · `);
    $("action-status").appendChild(el("span", "turn-timer"));
  }
  updateTurnTimers();
}

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
  for (const node of document.querySelectorAll(".turn-timer")) {
    node.textContent = seconds === null ? "" : `⏱ ${seconds} s`;
    node.classList.toggle("low", seconds !== null && seconds <= 10);
  }
}

setInterval(() => {
  if (store.voteDeadline) updateVoteTimers();
  updateTurnTimers();
}, 250);

function renderGame(s) {
  const leaders = leaderIds(s.players);
  renderMyTile(s, leaders);
  renderGrid(s, leaders);
  renderTurn(s);
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
$("btn-guess").onclick = () => act("guess");
$("btn-pass").onclick = () => ask("Spasować? Stracisz 1 punkt.", () => act("pass"));
$("btn-vote-yes").onclick = () => act("vote", { approve: true });
$("btn-vote-no").onclick = () => act("vote", { approve: false });

function renderEnd(s) {
  const reasons = {
    limit: "Ktoś dobił do limitu punktów!",
    pool: "Skończyły się hasła do wylosowania.",
    players: "Zostało za mało graczy.",
    admin: "Admin zakończył grę."
  };
  $("end-reason").textContent = reasons[s.endReason] || "";
  const list = $("ranking");
  list.replaceChildren();
  const medals = ["🥇", "🥈", "🥉"];
  s.results.forEach((r, index) => {
    const item = el("li", "rank-item");
    item.style.setProperty("--pc", r.color);
    const slot = el("div", "media-slot");
    bindSlot(slot, r);
    const info = el("div", "rank-info");
    info.appendChild(el("div", "rank-nick", `${medals[index] || `${index + 1}.`} ${r.nick}`));
    if (r.word) info.appendChild(el("div", "rank-word", `ostatnie hasło: ${r.word}`));
    item.append(slot, info, el("div", "rank-score", `${r.score} pkt`));
    list.appendChild(item);
  });
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
  for (const button of document.querySelectorAll("[data-admin=approve], [data-admin=reject]")) button.disabled = !s.vote;
  for (const button of document.querySelectorAll("[data-admin=forceNext]")) button.disabled = s.phase !== "game";

  const list = $("admin-players");
  list.replaceChildren();
  for (const p of s.players) {
    const row = el("div", "admin-player");
    row.style.setProperty("--pc", p.color);
    row.appendChild(el("span", "admin-nick", `${p.nick} · ${p.score} pkt`));
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
if (startCameraCode) phone.open(startCameraCode);

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
  motion.restart($("my-tile").querySelector(".my-word"), "word-new");
  const myGridTile = store.state && tiles.get(store.state.me.id);
  if (myGridTile) motion.restart(myGridTile.word, "word-new");
  if (reason === "rerolled") {
    toast("Host wylosował ci nowe hasło");
    if (notes.value.trim()) ask("Masz nowe hasło. Wyczyścić notatki?", clearNotes);
    return;
  }
  if (!notes.value.trim()) return;
  const what = reason === "guessed" ? "Zgadnięte" : "Spasowane";
  ask(`${what}! Twoje hasło to było: ${text}. Wyczyścić notatki?`, clearNotes);
});

socket.on("kicked", ({ reason }) => goHome(reason));

socket.on("replaced", () => {
  store.replaced = true;
  socket.disconnect();
  show($("replaced"), true);
});
