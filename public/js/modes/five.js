const fiveUi = { pending: null, stageKey: "", trading: false, picked: [] };

function fiveCardInfo(type) {
  return (store.fiveCards || {})[type] || { icon: "🃏", name: type, text: "", target: null };
}

function fiveHearts(lives) {
  return lives <= 5 ? "❤️".repeat(lives) : "❤️×" + lives;
}

function fiveTileLabel(s, p) {
  const cards = p.cardCount ? "🃏" + (p.cardCount > 1 ? "×" + p.cardCount : "") : "";
  const curses = p.curses.map((type) => fiveCardInfo(type).icon).join("");
  const secrets = p.secrets ? "🂠" + (p.secrets > 1 ? "×" + p.secrets : "") : "";
  const gag = p.gag ? "🔇" + p.gag : "";
  const extra = [cards, secrets, gag, curses ? "⚠️" + curses : ""].filter(Boolean).join(" ");
  const top = p.out ? "👻 duch" : fiveHearts(p.lives);
  return extra ? top + "\n" + extra : top;
}

const fiveCurseText = {
  torpedo: "💣 Torpeda: nie zaliczy = −2 ❤️",
  english: "🫖 odpowiada po angielsku",
  four: "4️⃣ musi podać 4 odpowiedzi",
  sprint: "⚡ Sprint: połowa czasu",
  vabanque: "✌️ Va banque: zaliczy = +1 ❤️, nie zaliczy = −2 ❤️"
};

function fiveCurseLine(five, type) {
  return type === "letter" ? "🔤 odpowiedzi tylko na literę " + (five.letter || "?") : fiveCurseText[type];
}

function fiveNeedsTarget(info, me) {
  return Boolean(info.target || (info.hidden && me.out));
}

function fiveTargets(s, type, me) {
  const info = fiveCardInfo(type);
  const self = s.players.find((p) => p.id === me);
  return s.players.filter((p) => {
    if (info.hidden) return Boolean(self && self.out) && !p.out;
    if (info.target === "dead") return p.out;
    if (info.target === "anyone") return p.id !== me && (!info.needsCards || p.cardCount > 0);
    if (p.out) return false;
    if (info.target === "other") return p.id !== me;
    return true;
  });
}

function fiveCardUsable(s, five, me, card) {
  const info = fiveCardInfo(card.type);
  const stage = five.stage;
  const mine = five.answererId === me.id;
  if (me.gag) return false;
  if (info.when === "mine") {
    if (!mine || (stage !== "ready" && stage !== "answer")) return false;
  } else if (stage === "answer") {
    return false;
  }
  if (info.when === "before" && stage !== "pick" && stage !== "vote") return false;
  if (info.when === "vote" && (stage !== "vote" || five.angelUsed)) return false;
  if (info.when === "asked" && (stage !== "ready" || !mine || five.reversed)) return false;
  if (me.out && info.living) return false;
  if (card.type === "ally" && me.lives < 2) return false;
  if (fiveNeedsTarget(info, me) && !fiveTargets(s, card.type, me.id).length) return false;
  return true;
}

function fiveWhenText(info) {
  if (info.when === "before") return "Grasz przed wybraniem osoby albo podczas głosowania";
  if (info.when === "vote") return "Grasz podczas głosowania";
  if (info.when === "asked") return "Grasz, kiedy ktoś cię pyta (przed startem)";
  if (info.when === "mine") return "Grasz, kiedy cię pytają, też w trakcie odpowiadania";
  return "Grasz w dowolnym momencie poza czasem na odpowiedź";
}

const sideUi = { tab: "notes" };

function renderSideCards(s) {
  const cardsTab = s.mode === "piec" && sideUi.tab === "cards";
  show($("side-notes"), !cardsTab);
  show($("side-cards"), cardsTab);
  $("tab-notes").classList.toggle("selected", !cardsTab);
  $("tab-cards").classList.toggle("selected", cardsTab);
  if (!cardsTab) return;
  const cards = Object.entries(store.fiveCards || {});
  const off = s.fiveCardsOff || [];
  const active = cards.filter(([type]) => !off.includes(type));
  $("side-cards-count").textContent = "W grze: " + active.length + " z " + cards.length + " kart";
  patchList($("side-cards-list"), JSON.stringify([cards.length, off]), (box) => {
    const groups = [
      ["😈 Wredne", active.filter(([, info]) => info.hostile), false],
      ["🂠 Tajne", active.filter(([, info]) => info.hidden), false],
      ["✨ Pozostałe", active.filter(([, info]) => !info.hostile && !info.hidden), false],
      ["🚫 Wyłączone w tej grze", cards.filter(([type]) => off.includes(type)), true]
    ];
    for (const [title, list, disabled] of groups) {
      if (!list.length) continue;
      box.appendChild(el("p", "side-group", title + " (" + list.length + ")"));
      for (const [, info] of list) {
        const row = el("div", "side-card" + (disabled ? " off" : ""));
        const body = el("div", "side-card-body");
        body.append(el("span", "side-card-name", info.name), el("span", "side-card-text", info.text));
        if (!disabled) body.appendChild(el("span", "side-card-when", fiveWhenText(info) + (info.living ? " · duch jej nie zagra" : "")));
        row.append(el("span", "side-card-icon", info.icon), body);
        box.appendChild(row);
      }
    }
  });
}

function renderFiveHand(s, five) {
  const me = findPlayer(s.me.id);
  const cards = me ? me.cards : [];
  const effects = me ? me.effects : [];
  show($("five-hand-box"), cards.length > 0 || effects.length > 0);
  $("five-hand-title").textContent = me && me.out
    ? "👻 Jesteś duchem: rzucaj karty na żywych, tajne dajesz komu chcesz"
    : "🃏 Twoje tajne karty (inni widzą tylko, ile ich masz)";
  const effectLines = effects.map((effect) => {
    const info = fiveCardInfo(effect.type);
    return info.icon + " " + info.name + (effect.count > 1 ? " ×" + effect.count : "") + (effect.rounds ? " (jeszcze " + effect.rounds + " pyt.)" : "");
  });
  if (me && me.gag) effectLines.push("🔇 knebel jeszcze przez " + me.gag + " pyt.");
  $("five-effects").textContent = effectLines.length ? "Czeka u ciebie: " + effectLines.join(" · ") : "";
  show($("five-effects"), effectLines.length > 0);
  if (cards.length < 2) fiveUi.trading = false;
  fiveUi.picked = fiveUi.picked.filter((id) => cards.some((card) => card.id === id));
  show($("five-trade"), cards.length >= 2);
  $("five-trade").textContent = fiveUi.trading ? "✖ Anuluj wymianę" : "♻️ Wymień 2 karty na 1 losową";
  $("five-trade").classList.toggle("selected", fiveUi.trading);
  show($("five-trade-hint"), fiveUi.trading);
  const usableCards = cards.map((card) => ({ card, info: fiveCardInfo(card.type), usable: fiveCardUsable(s, five, me, card) }));
  const handSignature = JSON.stringify([Boolean(store.fiveCards), fiveUi.trading, fiveUi.picked, usableCards.map(({ card, usable }) => [card.id, card.type, usable])]);
  patchList($("five-hand"), handSignature, (hand) => {
    for (const { card, info, usable } of usableCards) {
      const button = el("button", "btn five-card-btn" + (fiveUi.picked.includes(card.id) ? " selected" : ""));
      button.title = info.text + " · " + fiveWhenText(info);
      button.append(el("span", "five-card-icon", info.icon), el("span", "five-card-name", info.name), el("span", "five-card-text", info.text));
      button.disabled = !fiveUi.trading && !usable;
      button.onclick = () => {
        if (fiveUi.trading) return fivePickForTrade(card.id);
        if (!fiveNeedsTarget(info, me)) {
          ask("Zagrać kartę " + info.icon + " " + info.name + "?", () => act("five:card", { cardId: card.id }));
          return;
        }
        fiveUi.pending = card;
        renderFive(store.state);
      };
      hand.appendChild(button);
    }
  });
  const held = fiveUi.pending && cards.find((c) => c.id === fiveUi.pending.id);
  const pending = held && !fiveUi.trading && fiveCardUsable(s, five, me, held) ? fiveUi.pending : null;
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

function fivePickForTrade(cardId) {
  const picked = fiveUi.picked;
  if (picked.includes(cardId)) fiveUi.picked = picked.filter((id) => id !== cardId);
  else if (picked.length < 2) picked.push(cardId);
  renderFive(store.state);
  if (fiveUi.picked.length < 2) return;
  const me = findPlayer(store.state.me.id);
  const names = fiveUi.picked.map((id) => {
    const card = me.cards.find((held) => held.id === id);
    return card ? fiveCardInfo(card.type).icon + " " + fiveCardInfo(card.type).name : "?";
  });
  const cardIds = [...fiveUi.picked];
  const done = () => {
    fiveUi.trading = false;
    fiveUi.picked = [];
    if (store.state) renderFive(store.state);
  };
  $("modal-no").addEventListener("click", done, { once: true });
  ask("Wymienić " + names.join(" i ") + " na 1 losową kartę?", async () => {
    $("modal-no").removeEventListener("click", done);
    await act("five:trade", { cardIds });
    done();
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
  const asker = nickOf(five.askerId);
  const answerer = five.answererId ? nickOf(five.answererId) : "";
  let who;
  if (five.stage === "pick") who = isAsker ? "🎤 Pytasz! Wybierz, kogo" : "🎤 " + asker + " wybiera, kogo pyta";
  else if (five.reversed) who = "🔄 Odwrotka! " + asker + " pyta: " + answerer;
  else who = (five.final ? "⚔️ Finał · " : "🎤 ") + asker + " → " + answerer;
  $("five-who").textContent = who;
  let task = "";
  if (five.stage === "pick") task = five.last ? (five.last.passed ? "✅ " : "❌ ") + nickOf(five.last.answererId) + (five.last.passed ? " zaliczył(a)" : " nie zaliczył(a)" + (five.last.out ? " i odpada 💀" : "")) : "⏱️ 5 sekund";
  else if (five.task) task = five.task;
  else task = isAnswerer ? "👂 Słuchaj! " + asker + " czyta ci zadanie…" : "🤫 " + asker + " czyta zadanie…";
  $("five-task").textContent = task;
  $("five-card").classList.toggle("five-live", five.stage === "answer");
  $("five-card").classList.toggle("five-mine", isAnswerer && five.stage !== "pick");
  const curseLines = five.stage === "pick" ? [] : five.curses.map((type) => fiveCurseLine(five, type)).filter(Boolean);
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
  show($("five-redo-box"), (five.stage === "answer" || five.stage === "vote") && (isAsker || s.me.canManage) && !five.redone);
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
$("five-redo").onclick = () => ask("Jeszcze raz? To pytanie przepada bez oceny, będzie nowe zadanie dla tej samej osoby, a zagrane na nie karty dalej działają.", () => act("five:redo"));
$("five-yes").onclick = () => act("five:vote", { approve: true });
$("five-no").onclick = () => act("five:vote", { approve: false });

$("five-trade").onclick = () => {
  fiveUi.trading = !fiveUi.trading;
  fiveUi.picked = [];
  fiveUi.pending = null;
  if (store.state) renderFive(store.state);
};

for (const tab of ["notes", "cards"]) {
  $("tab-" + tab).onclick = () => {
    sideUi.tab = tab;
    if (store.state) renderSideCards(store.state);
  };
}

$("five-target-cancel").onclick = () => {
  fiveUi.pending = null;
  if (store.state) renderFive(store.state);
};

function fiveSecondsText() {
  const five = store.state && store.state.five;
  const seconds = five && five.answerSeconds ? five.answerSeconds : cfg("fiveAnswerSeconds", 10);
  return seconds + (seconds >= 2 && seconds <= 4 ? " sekundy" : " sekund");
}
