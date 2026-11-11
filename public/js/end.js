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
  const summarySignature = JSON.stringify([summary, results.map((r) => [r.id, r.nick, r.color])]);
  const history = $("history");
  if (history.dataset.signature === summarySignature) return;
  history.dataset.signature = summarySignature;
  const awards = $("awards");
  awards.replaceChildren();
  summary.awards.forEach((a, i) => {
    const card = el("div", "award");
    card.style.setProperty("--delay", (1.6 + i * 0.15) + "s");
    card.append(el("div", "award-icon", a.icon), el("div", "award-title", a.title), el("div", "award-text", a.text));
    awards.appendChild(card);
  });
  show($("awards-box"), summary.awards.length > 0);
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

function findResult(s, id) {
  return findPlayer(id) || (s.results || []).find((r) => r.id === id) || { id, nick: "?", color: "#888888" };
}

$("btn-to-lobby").onclick = () => act("backToLobby");

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
