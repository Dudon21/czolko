const WORDS_PER_PLAYER = 10;
const BRUSH_COLORS = ["#111111", "#e63946", "#f77f00", "#ffd60a", "#2a9d8f", "#4cc9f0", "#3a0ca3", "#f15bb5", "#8d5524", "#f1c27d"];
const BRUSH_SIZES = [3, 7, 14];
const SHAPE_TOOLS = ["rect", "square", "triangle", "circle"];
const UNDO_LIMIT = 30;

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
    let hasDuplicate = false;
    inputs.forEach((input, i) => {
      const duplicate = list[i] && list.some((other, j) => j !== i && other && WordMatch.similarWords(list[i], other));
      if (duplicate) hasDuplicate = true;
      input.classList.toggle("invalid", Boolean(duplicate));
    });
    renderStars();
    const filled = list.filter(Boolean).length;
    const ready = store.state && store.state.me.wordsReady;
    let status = `${filled}/${WORDS_PER_PLAYER} haseł · ⭐ ${stars.size}/${MAX_STARRED}`;
    if (hasDuplicate) status = "Hasła nie mogą się powtarzać (nawet z literówką)";
    else if (dirty) status += " · niezapisane zmiany";
    else if (ready) status = "✓ Hasła zapisane";
    $("words-status").textContent = status;
    $("words-status").classList.toggle("status-ok", !dirty && Boolean(ready));
    $("btn-save-words").disabled = hasDuplicate || filled < WORDS_PER_PLAYER;
    const stash = stashed();
    show($("btn-load-words"), Boolean(stash) && stash.words.join("|") !== list.join("|"));
    return { list, hasDuplicate };
  }

  function stashed() {
    const data = saved.get("words");
    return data && Array.isArray(data.words) && data.words.length === WORDS_PER_PLAYER ? data : null;
  }

  $("btn-load-words").onclick = () => {
    const stash = stashed();
    if (!stash) return;
    stash.words.forEach((word, i) => {
      inputs[i].value = String(word).slice(0, 40);
    });
    stars = new Set((stash.stars || []).filter((index) => Number.isInteger(index) && index >= 0 && index < WORDS_PER_PLAYER).slice(0, MAX_STARRED));
    dirty = true;
    refresh();
  };

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
      saved.set("words", { words: list, stars: [...stars] });
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

  const canKick = s.me.canManage;
  const lobbySignature = JSON.stringify([s.me.id, canKick, s.mode, s.liarSource, s.players.map((p) => [p.id, p.nick, p.color, p.connected, p.canManage, p.wordsReady, p.liarReady, p.fiveTasks, p.ktoQuestions, p.hasPhone])]);
  patchList($("lobby-players"), lobbySignature, (list) => {
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
      if (s.mode === "kto" && p.ktoQuestions) tags.appendChild(el("span", "tag tag-ok", "📝 " + p.ktoQuestions + " pytań"));
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
  });

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
  const missing = s.mode === "wskazowka" || s.mode === "piec" || s.mode === "kto" || (s.mode === "klamca" && !liarPlayersMode)
    ? []
    : s.players.filter((p) => !(liarPlayersMode ? p.liarReady : p.wordsReady)).map((p) => p.nick);
  const host = s.players.find((p) => p.canManage);
  renderModePicker(s);
  liarWordsForm.sync(s);
  fiveTasksForm.sync(s);
  ktoQuestionsForm.sync(s);
  renderFiveCardToggles(s);
  renderNight($("night-lobby"), s);
  const minPlayers = s.mode === "klamca" ? (s.liarSource === "host" ? 4 : 3) : s.mode === "kto" ? 3 : 2;
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

const advancedUi = { signature: "" };

function renderAdvancedSettings(s) {
  renderSettingsInto($("advanced-fields"), advancedUi, s);
}

function renderSettingsInto(box, ui, s) {
  const spec = (store.settingsSpec || []).filter((setting) => setting.mode === s.mode);
  const inGame = s.phase === "game";
  const signature = s.mode + "|" + spec.length + "|" + s.me.canManage + "|" + inGame;
  if (ui.signature !== signature) {
    ui.signature = signature;
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
      row.append(el("span", "advanced-label", setting.label + (inGame && setting.startOnly ? " (od następnej gry)" : "")), input);
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
    ? "Jak u WK: pytający czyta zadanie na głos, klika START i odpowiadający ma " + fiveSecondsText() + ". Reszta głosuje, czy zaliczyć. Zaliczysz, to przejmujesz pytanie. Nie zaliczysz, tracisz życie. Są karty specjalne, wygrywa ostatni żywy."
    : s.mode === "kto"
    ? "Pada pytanie „Kto z nas najprawdopodobniej…”. Każdy po cichu wskazuje jedną osobę. Punkt dostają ci, którzy zagłosowali na osobę wybraną przez większość."
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
  const slider = $("five-time-slider");
  if (document.activeElement !== slider && s.settings) {
    slider.value = String(s.settings.fiveAnswerSeconds);
    $("five-time-value").textContent = s.settings.fiveAnswerSeconds + " s";
  }
  slider.disabled = !s.me.canManage;
  const hostSource = s.liarSource === "host";
  show($("liar-master-settings"), hostSource);
  for (const button of document.querySelectorAll(".liar-master-mode-btn")) {
    button.classList.toggle("selected", button.dataset.masterMode === s.liarMasterMode);
    button.disabled = !s.me.canManage;
  }
  show($("liar-master-pick-row"), hostSource && s.liarMasterMode === "fixed");
  fillMasterSelect($("liar-master-pick"), s, !s.me.canManage);
}

function renderFiveCardToggles(s) {
  const cards = store.fiveCards || {};
  const off = s.fiveCardsOff || [];
  const signature = JSON.stringify([Object.keys(cards), off, s.me.canManage]);
  patchList($("five-card-toggles"), signature, (box) => {
    for (const [type, info] of Object.entries(cards)) {
      const disabled = off.includes(type);
      const button = el("button", "btn five-card-toggle" + (disabled ? " off" : ""), info.icon + " " + info.name);
      button.title = info.text + (disabled ? " (wyłączona)" : "");
      button.disabled = !s.me.canManage;
      button.onclick = () => act("setFiveCard", { type, enabled: disabled });
      box.appendChild(button);
    }
  });
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

$("five-time-slider").addEventListener("input", (event) => {
  $("five-time-value").textContent = event.target.value + " s";
});

$("five-time-slider").addEventListener("change", (event) => {
  act("setSetting", { key: "fiveAnswerSeconds", value: Number(event.target.value) });
});

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
    const stash = stashed();
    show($("btn-load-liar-words"), Boolean(stash) && JSON.stringify(stash) !== JSON.stringify(list));
  }

  function stashed() {
    const data = saved.get("liar");
    return Array.isArray(data) && data.length === rows.length && data.every((entry) => entry && typeof entry.word === "string" && typeof entry.hint === "string") ? data : null;
  }

  $("btn-load-liar-words").onclick = () => {
    const stash = stashed();
    if (!stash) return;
    stash.forEach((entry, i) => {
      rows[i].word.value = entry.word.slice(0, 40);
      rows[i].hint.value = entry.hint.slice(0, 40);
    });
    dirty = true;
    refresh();
  };

  $("btn-save-liar-words").onclick = async () => {
    const entries = values();
    const response = await act("setLiarWords", { entries });
    if (response.ok) {
      saved.set("liar", entries);
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

for (const button of document.querySelectorAll(".mode-btn")) {
  button.onclick = () => act("setMode", { mode: button.dataset.mode });
}

function linesForm({ input, saveButton, loadButton, status, stash, limit, noun, action, field, stored }) {
  let dirty = false;
  function list() {
    return input.value.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  function stashed() {
    const data = saved.get(stash);
    return Array.isArray(data) && data.length ? data.filter((line) => typeof line === "string") : null;
  }
  function refresh() {
    const current = list();
    const count = current.length;
    const kept = store.state ? stored(store.state).length : 0;
    status.textContent = dirty ? count + " " + noun + " · niezapisane zmiany" : kept ? "✓ Zapisane: " + kept : "";
    saveButton.disabled = !dirty || count > limit;
    if (count > limit) status.textContent = "Maksymalnie " + limit + " " + noun;
    const old = stashed();
    show(loadButton, Boolean(old) && old.join("\n") !== current.join("\n"));
  }
  input.addEventListener("input", () => {
    dirty = true;
    refresh();
  });
  saveButton.onclick = async () => {
    const lines = list();
    const response = await act(action, { [field]: lines });
    if (response.ok) {
      if (lines.length) saved.set(stash, lines);
      dirty = false;
      toast("Zapisane");
      refresh();
    }
  };
  loadButton.onclick = () => {
    const old = stashed();
    if (!old) return;
    input.value = old.slice(0, limit).join("\n");
    dirty = true;
    refresh();
  };
  function sync(s) {
    if (!dirty && document.activeElement !== input) input.value = stored(s).join("\n");
    refresh();
  }
  function reset() {
    dirty = false;
    input.value = "";
  }
  return { sync, reset };
}

const fiveTasksForm = linesForm({
  input: $("five-tasks-input"),
  saveButton: $("btn-save-five-tasks"),
  loadButton: $("btn-load-five-tasks"),
  status: $("five-tasks-status"),
  stash: "five",
  limit: 30,
  noun: "zadań",
  action: "setFiveTasks",
  field: "tasks",
  stored: (s) => s.me.fiveTasks || []
});

const ktoQuestionsForm = linesForm({
  input: $("kto-questions-input"),
  saveButton: $("btn-save-kto-questions"),
  loadButton: $("btn-load-kto-questions"),
  status: $("kto-questions-status"),
  stash: "kto",
  limit: 20,
  noun: "pytań",
  action: "setKtoQuestions",
  field: "questions",
  stored: (s) => s.me.ktoQuestions || []
});
