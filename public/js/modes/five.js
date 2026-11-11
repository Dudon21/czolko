const fiveUi = { pending: null, stageKey: "" };

function fiveCardInfo(type) {
  return (store.fiveCards || {})[type] || { icon: "🃏", name: type, text: "", target: null };
}

function fiveHearts(lives) {
  return lives <= 5 ? "❤️".repeat(lives) : "❤️×" + lives;
}

function fiveTileLabel(s, p) {
  const cards = p.cardCount ? "🃏" + (p.cardCount > 1 ? "×" + p.cardCount : "") : "";
  const curses = p.curses.map((type) => fiveCardInfo(type).icon).join("");
  const extra = [cards, curses ? "⚠️" + curses : ""].filter(Boolean).join(" ");
  const top = p.out ? "💀 odpadł(a)" : fiveHearts(p.lives);
  return extra ? top + "\n" + extra : top;
}

const fiveCurseText = {
  torpedo: "💣 Torpeda: nie zaliczy = −2 ❤️",
  english: "🫖 odpowiada po angielsku",
  disco: "🎤 śpiewa w stylu disco polo",
  four: "4️⃣ musi podać 4 odpowiedzi"
};

function fiveTargets(s, type, me) {
  const info = fiveCardInfo(type);
  return s.players.filter((p) => {
    if (info.target === "dead") return p.out;
    if (p.out) return false;
    if (info.target === "other") return p.id !== me;
    return true;
  });
}

function renderFiveHand(s, five) {
  const me = findPlayer(s.me.id);
  const cards = me ? me.cards : [];
  show($("five-hand-box"), cards.length > 0);
  const usableCards = cards.map((card) => {
    const info = fiveCardInfo(card.type);
    let usable = five.stage !== "answer";
    if (card.type === "angel") usable = five.stage === "vote" && !five.angelUsed;
    if (card.type === "reverse") usable = five.stage === "ready" && five.answererId === s.me.id && !five.reversed;
    if (card.type !== "revive" && me.out) usable = false;
    if (card.type === "ally" && me.lives < 2) usable = false;
    if (info.target && !fiveTargets(s, card.type, s.me.id).length) usable = false;
    return { card, info, usable };
  });
  const handSignature = JSON.stringify([Boolean(store.fiveCards), usableCards.map(({ card, usable }) => [card.id, card.type, usable])]);
  patchList($("five-hand"), handSignature, (hand) => {
    for (const { card, info, usable } of usableCards) {
      const button = el("button", "btn five-card-btn");
      button.title = info.text;
      button.append(el("span", "five-card-icon", info.icon), el("span", "five-card-name", info.name), el("span", "five-card-text", info.text));
      button.disabled = !usable;
      button.onclick = () => {
        if (!info.target) {
          ask("Zagrać kartę " + info.icon + " " + info.name + "?", () => act("five:card", { cardId: card.id }));
          return;
        }
        fiveUi.pending = card;
        renderFive(store.state);
      };
      hand.appendChild(button);
    }
  });
  const pending = fiveUi.pending && cards.find((c) => c.id === fiveUi.pending.id) && five.stage !== "answer" ? fiveUi.pending : null;
  fiveUi.pending = pending;
  show($("five-target"), Boolean(pending));
  if (!pending) return;
  const info = fiveCardInfo(pending.type);
  $("five-target-title").textContent = info.icon + " " + info.name + ": na kogo?";
  const targets = fiveTargets(s, pending.type, s.me.id);
  const targetSignature = JSON.stringify([pending.id, s.me.id, targets.map((p) => [p.id, p.nick, p.color])]);
  patchList($("five-target-buttons"), targetSignature, (box) => {
    for (const p of targets) {
      const button = el("button", "btn help-choice liar-vote-btn");
      button.style.setProperty("--pc", p.color);
      const slot = el("div", "media-slot");
      bindSlot(slot, p);
      button.append(slot, el("span", "", p.nick + (p.id === s.me.id ? " (ty)" : "")));
      button.onclick = async () => {
        fiveUi.pending = null;
        await act("five:card", { cardId: pending.id, playerId: p.id });
        renderFive(store.state);
      };
      box.appendChild(button);
    }
  });
}

function renderFive(s) {
  const active = s.mode === "piec" && Boolean(s.five) && s.phase === "game";
  show($("five-stage"), active);
  if (!active) return;
  const five = s.five;
  const me = s.me.id;
  const isAsker = five.askerId === me;
  const isAnswerer = five.answererId === me;
  store.quietTimer = five.stage !== "answer";
  store.turnTotal = s.turnTotalMs || 5000;
  show($("action-bar"), false);
  show($("help-bar"), false);
  const asker = liarNick(five.askerId);
  const answerer = five.answererId ? liarNick(five.answererId) : "";
  let who;
  if (five.stage === "pick") who = isAsker ? "🎤 Pytasz! Wybierz, kogo" : "🎤 " + asker + " wybiera, kogo pyta";
  else if (five.reversed) who = "🔄 Odwrotka! " + asker + " pyta: " + answerer;
  else who = "🎤 " + asker + " → " + answerer;
  $("five-who").textContent = who;
  let task = "";
  if (five.stage === "pick") task = five.last ? (five.last.passed ? "✅ " : "❌ ") + liarNick(five.last.answererId) + (five.last.passed ? " zaliczył(a)" : " nie zaliczył(a)" + (five.last.out ? " i odpada 💀" : "")) : "⏱️ 5 sekund";
  else if (five.task) task = five.task;
  else task = isAnswerer ? "👂 Słuchaj! " + asker + " czyta ci zadanie…" : "🤫 " + asker + " czyta zadanie…";
  $("five-task").textContent = task;
  $("five-card").classList.toggle("five-live", five.stage === "answer");
  $("five-card").classList.toggle("five-mine", isAnswerer && five.stage !== "pick");
  const curseLines = five.stage === "pick" ? [] : five.curses.map((type) => fiveCurseText[type]).filter(Boolean);
  if (five.taskAuthor) curseLines.unshift("📝 zadanie od " + five.taskAuthor);
  $("five-curses").textContent = curseLines.join(" · ");
  show($("five-count"), five.stage === "answer");

  show($("five-pick"), five.stage === "pick" && isAsker);
  if (five.stage === "pick" && isAsker) {
    $("five-pick-status").textContent = "Kogo pytasz?";
    const pickSignature = JSON.stringify([me, s.players.map((p) => [p.id, p.nick, p.color, p.lives, p.out])]);
    patchList($("five-pick-buttons"), pickSignature, (box) => {
      for (const p of s.players) {
        if (p.id === me || p.out) continue;
        const button = el("button", "btn five-pick-btn");
        button.style.setProperty("--pc", p.color);
        button.append(el("span", "five-pick-nick", p.nick), el("span", "five-pick-hearts", fiveHearts(p.lives)));
        button.onclick = () => act("five:choose", { playerId: p.id });
        box.appendChild(button);
      }
    });
  }
  show($("five-ready"), five.stage === "ready" && (isAsker || s.me.canManage));
  const mine = s.players.find((p) => p.id === me);
  const rerollsLeft = mine ? mine.rerollsLeft : null;
  $("five-reroll").disabled = !isAsker || rerollsLeft === 0;
  $("five-reroll").textContent = "🎲 Inne zadanie" + (rerollsLeft === null || rerollsLeft === undefined ? "" : " (" + rerollsLeft + ")");
  $("five-reroll").title = rerollsLeft === null || rerollsLeft === undefined ? "Bez limitu" : "Zostało zmian: " + rerollsLeft;
  show($("five-vote"), five.stage === "vote");
  if (five.stage === "vote") {
    $("five-vote-title").textContent = isAnswerer ? "🤞 Reszta ocenia twoją odpowiedź…" : "Zaliczamy " + answerer + "?";
    show($("five-vote-buttons"), five.canVote);
    $("five-yes").classList.toggle("selected", five.myVote === true);
    $("five-no").classList.toggle("selected", five.myVote === false);
    $("five-vote-status").textContent = "✅ " + five.yes + " · ❌ " + five.no + " · zagłosowali " + five.voted.length + "/" + five.voters + " (potrzeba " + five.required + " na tak)";
  }
  let wait = "";
  if (five.stage === "ready" && !isAsker && !isAnswerer) wait = asker + " czyta zadanie dla: " + answerer;
  if (five.stage === "answer") wait = isAnswerer ? "🗣️ GADAJ!" : "🗣️ " + answerer + " odpowiada!";
  $("five-wait").textContent = wait;
  show($("five-wait"), Boolean(wait));
  let banner;
  if (five.stage === "pick") banner = isAsker ? "🎤 Twoje pytanie!" : "🎤 Pyta: " + asker;
  else if (five.stage === "ready") banner = isAnswerer ? "👂 Pytają cię!" : isAsker ? "📖 Przeczytaj zadanie na głos!" : "📖 " + asker + " czyta zadanie";
  else if (five.stage === "answer") banner = isAnswerer ? "⏱️ TWOJE " + fiveSecondsText().toUpperCase() + "!" : "⏱️ Odpowiada: " + answerer;
  else banner = "🗳️ Zaliczamy?";
  $("turn-banner").replaceChildren(banner + " ", el("span", "turn-timer"));
  $("turn-banner").classList.toggle("mine", isAsker || isAnswerer);
  renderFiveHand(s, five);
  updateTurnTimers();
  fitFiveGrid();
}

function fitFiveGrid() {
  const grid = $("players-grid");
  if (!grid.classList.contains("five-mode") || $("screen-game").classList.contains("hidden")) return;
  const tilesInGrid = [...grid.children];
  const count = tilesInGrid.length;
  if (!count) return;
  const duels = tilesInGrid.filter((node) => node.classList.contains("five-duel")).length;
  const gap = 16;
  const ratio = 1.3;
  const top = grid.getBoundingClientRect().top + window.scrollY;
  const availableHeight = window.innerHeight - top - 34 - 34 - 26;
  const availableWidth = grid.clientWidth - 20;
  const byWidth = (availableWidth - (count - 1) * gap) / (count - duels + duels * ratio);
  const byHeight = availableHeight / (duels ? ratio : 1);
  const size = Math.max(110, Math.min(260, byWidth, byHeight));
  grid.style.setProperty("--five-tile", Math.floor(size) + "px");
}

window.addEventListener("resize", () => fitFiveGrid());

$("five-reroll").onclick = () => act("five:reroll");
$("five-start").onclick = () => act("five:start");
$("five-yes").onclick = () => act("five:vote", { approve: true });
$("five-no").onclick = () => act("five:vote", { approve: false });

$("five-target-cancel").onclick = () => {
  fiveUi.pending = null;
  if (store.state) renderFive(store.state);
};

function fiveSecondsText() {
  const seconds = cfg("fiveAnswerSeconds", 10);
  return seconds + (seconds >= 2 && seconds <= 4 ? " sekundy" : " sekund");
}
