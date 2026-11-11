function waveBands() {
  return [[18, cfg("waveFar", 2)], [11, cfg("waveNear", 3)], [4, cfg("waveBull", 4)]];
}

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
    const psychic = findPlayer(wave.psychicId);
    const resultsSignature = JSON.stringify([wave.set, wave.round, wave.results, wave.target, wave.psychicPoints, nick(wave.psychicId), psychic ? psychic.color : ""]);
    patchList($("wave-results"), resultsSignature, (list) => {
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
      psychicRow.style.setProperty("--pc", psychic ? psychic.color : "#888");
      psychicRow.append(el("span", "wave-result-nick", "🔮 " + nick(wave.psychicId)), el("span", "wave-result-value", "za podpowiedź"), el("span", "wave-result-points", "+" + wave.psychicPoints));
      list.appendChild(psychicRow);
    });
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
