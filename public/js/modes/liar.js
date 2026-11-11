const liarUi = { roundKey: "", stageKey: "", introRound: 0 };

function liarTileLabel(s, p) {
  const liar = s.liar;
  if (!liar) return "—";
  if (p.id === liar.masterId) return "🎬 prowadzi";
  if (liar.stage === "reveal") {
    const result = (liar.results || []).find((r) => r.id === p.id);
    const pts = result ? "+" + result.points : "";
    return p.id === liar.impostorId ? "🕵️ kłamca " + pts : pts || "—";
  }
  if (liar.stage === "vote") return liar.voted.includes(p.id) ? "✅ zagłosował(a)" : "🤔 myśli…";
  if (liar.stage === "judge") return p.id === liar.impostorId ? "🕵️ czeka na werdykt" : liar.judged.includes(p.id) ? "✅ ocenił(a)" : "🤔 ocenia…";
  const clues = liar.clues.filter((clue) => clue.playerId === p.id).map((clue) => clue.text);
  if (liar.stage === "clues" && liar.speakerId === p.id) return clues.length ? clues.join(" · ") + " · 🗣️" : "🗣️ mówi…";
  return clues.length ? clues.join(" · ") : liar.stage === "setup" ? "⏳" : "…";
}

function renderLiarRole(s) {
  const liar = s.liar;
  const role = $("liar-role");
  const roleSignature = JSON.stringify([liar.role, liar.stage, liar.word, liar.hint, liar.hintGiven, nickOf(liar.impostorId), nickOf(liar.masterId)]);
  if (role.dataset.signature === roleSignature) return;
  role.dataset.signature = roleSignature;
  role.className = "liar-role";
  role.replaceChildren();
  if (liar.role === "master") {
    role.classList.add("master");
    if (liar.stage === "setup") role.append(el("div", "liar-role-label", "🎬 Prowadzisz rundę"), el("div", "liar-role-word", "Wymyśl hasło"));
    else {
      role.append(el("div", "liar-role-label", "🎬 Prowadzisz · kłamcą jest " + nickOf(liar.impostorId)), el("div", "liar-role-word", liar.word));
      role.appendChild(el("div", "liar-role-hint", liar.hintGiven ? "Kłamca dostał podpowiedź: " + liar.hint : "Kłamca gra bez podpowiedzi"));
    }
    return;
  }
  if (liar.stage === "setup") {
    role.append(el("div", "liar-role-label", "🎬 " + nickOf(liar.masterId) + " wymyśla hasło…"));
    return;
  }
  if (liar.role === "impostor" && liar.stage !== "reveal") {
    role.classList.add("impostor");
    role.append(el("div", "liar-role-label", "Nie znasz hasła"), el("div", "liar-role-word", "🕵️ JESTEŚ KŁAMCĄ"));
    role.appendChild(el("div", "liar-role-hint", liar.hintGiven ? "Podpowiedź: " + liar.hint : "Bez podpowiedzi 😈 Udawaj!"));
    return;
  }
  role.classList.add("crew");
  role.append(el("div", "liar-role-label", liar.stage === "reveal" ? "Hasło było" : "Twoje hasło"), el("div", "liar-role-word", liar.word || "?"));
  if (liar.stage === "reveal" && liar.hint) {
    role.appendChild(el("div", "liar-role-hint", (liar.hintGiven ? "Kłamca dostał podpowiedź: " : "Kłamca NIE dostał podpowiedzi: ") + liar.hint));
  }
}

function renderLiarPanel(s) {
  const liar = s.liar;
  const me = s.me.id;
  const isMaster = liar.masterId === me;
  const isSpeaker = liar.speakerId === me;
  const canSkip = s.me.canManage || isMaster;
  const stage = liar.stage;
  show($("liar-setup"), stage === "setup" && isMaster);
  show($("liar-clue-form"), stage === "clues" && isSpeaker);
  show($("liar-vote"), stage === "vote");
  show($("liar-skip"), (stage === "vote" || stage === "judge") && canSkip);
  show($("liar-guess"), stage === "guess" && liar.impostorId === me);
  show($("liar-judge"), stage === "judge");
  show($("liar-reveal"), stage === "reveal");
  let wait = "";
  if (stage === "setup" && !isMaster) wait = "🎬 " + nickOf(liar.masterId) + " wpisuje hasło…";
  if (stage === "clues" && !isSpeaker) wait = "🗣️ Mówi " + nickOf(liar.speakerId) + " · kółko " + liar.lap + "/" + liar.laps;
  if (stage === "guess" && liar.impostorId !== me) wait = "😬 " + nickOf(liar.impostorId) + " był(a) kłamcą! Ostatnia szansa: zgaduje hasło…";
  $("liar-wait").textContent = wait;
  show($("liar-wait"), Boolean(wait));
  if (stage === "judge") {
    const guesser = nickOf(liar.impostorId);
    $("liar-judge-title").textContent = liar.impostorId === me ? "🤞 Reszta ocenia twój strzał…" : "🤔 " + guesser + " strzela: " + liar.judgeGuess;
    show($("liar-judge-buttons"), liar.canJudge);
    $("liar-judge-yes").classList.toggle("selected", liar.myJudge === true);
    $("liar-judge-no").classList.toggle("selected", liar.myJudge === false);
    $("liar-judge-status").textContent = (liar.canJudge ? "Hasło: „" + liar.word + "”. Zaliczacie? · " : "") + "ocenili " + liar.judged.length + "/" + liar.judgeCount;
  }
  if (stage === "vote") {
    const last = (liar.meetings || [])[liar.meetings.length - 1];
    const lastText = last && !last.ejectedId ? " · poprzednio: pominięte" : "";
    $("liar-vote-title").textContent = "🗳️ Kółko " + liar.lap + "/" + liar.laps + ": kto kłamie?" + lastText;
    show($("liar-vote-buttons"), liar.canVote);
    show($("liar-vote-skip"), liar.canVote);
    $("liar-vote-skip").classList.toggle("selected", liar.myVote === "skip");
    const myVote = liar.myVote === "skip" ? "⏭️ pomiń" : liar.myVote ? nickOf(liar.myVote) : null;
    $("liar-vote-status").textContent = !liar.canVote
      ? "Gracze gadają i głosują… " + liar.voted.length + "/" + liar.voters
      : myVote
        ? "Twój głos: " + myVote + " (możesz zmienić) · zagłosowali " + liar.voted.length + "/" + liar.voters
        : "Gadajcie! Kliknij gracza albo pomiń · zagłosowali " + liar.voted.length + "/" + liar.voters + (liar.lap >= liar.laps ? " · ostatnie kółko!" : "");
    const voteSignature = JSON.stringify([liar.round, liar.lap, liar.canVote, liar.myVote, liar.masterId, me, s.players.map((p) => [p.id, p.nick, p.color])]);
    patchList($("liar-vote-buttons"), voteSignature, (box) => {
      for (const p of liar.canVote ? s.players : []) {
        if (p.id === me || p.id === liar.masterId) continue;
        const button = el("button", "btn help-choice liar-vote-btn" + (liar.myVote === p.id ? " selected" : ""));
        button.style.setProperty("--pc", p.color);
        const slot = el("div", "media-slot");
        bindSlot(slot, p);
        button.append(slot, el("span", "", p.nick));
        button.onclick = () => act("liar:vote", { playerId: p.id });
        box.appendChild(button);
      }
    });
  }
  if (stage === "reveal") {
    const impostor = nickOf(liar.impostorId);
    let title;
    if (liar.escaped) title = "🏃 Kłamca " + impostor + " uciekł z gry!";
    else if (liar.wrongEject) title = "😱 Wyrzuciliście " + nickOf(liar.ejectedId) + "! Kłamcą był(a) " + impostor;
    else if (!liar.caught) title = "😈 " + impostor + " oszukał(a) wszystkich!";
    else if (liar.guessCorrect) title = "😏 Złapany, ale " + impostor + " zgadł(a) hasło!";
    else title = "🎉 Złapaliście kłamcę: " + impostor + "!";
    $("liar-reveal-title").textContent = title;
    const details = [];
    if (liar.guess) details.push("Strzał kłamcy: " + liar.guess + (liar.guessCorrect ? " ✅" : " ❌"));
    const votes = (liar.votes || []).map(([voter, target]) => nickOf(voter) + " → " + (target === "skip" ? "⏭️" : nickOf(target)));
    details.push("Kółek: " + liar.lap);
    if (votes.length) details.push("Ostatnie głosy: " + votes.join(", "));
    $("liar-reveal-details").textContent = details.join(" · ");
    const resultsSignature = JSON.stringify([liar.round, liar.results, s.players.map((p) => [p.id, p.nick])]);
    patchList($("liar-results"), resultsSignature, (list) => {
      for (const r of liar.results || []) {
        const row = el("div", "wave-result" + (r.impostor ? " liar-impostor-row" : ""));
        row.style.setProperty("--pc", r.color);
        row.append(
          el("span", "wave-result-nick", (r.impostor ? "🕵️ " : "") + r.nick),
          el("span", "wave-result-value", r.votedFor === "skip" ? "pominął(a)" : r.votedFor ? "głos na " + nickOf(r.votedFor) : "bez głosu"),
          el("span", "wave-result-points", "+" + r.points)
        );
        list.appendChild(row);
      }
    });
    show($("liar-continue"), canSkip);
    const canPick = s.liarSource === "host" && s.liarMasterMode === "fixed" && (s.me.canManage || isMaster);
    show($("liar-next-master-row"), canPick);
    if (canPick) fillMasterSelect($("liar-next-master"), s, false);
  }
}

function renderLiar(s) {
  const active = s.mode === "klamca" && Boolean(s.liar);
  show($("liar-stage"), active);
  if (!active) return;
  const liar = s.liar;
  store.quietTimer = liar.stage === "reveal" || liar.stage === "vote";
  store.turnTotal = s.turnTotalMs || TURN_TOTAL_MS;
  show($("action-bar"), false);
  show($("help-bar"), false);
  const stageKey = liar.round + "|" + liar.stage + "|" + liar.speakerId + "|" + liar.lap;
  if (liarUi.stageKey !== stageKey) {
    liarUi.stageKey = stageKey;
    if (liar.stage === "setup" && liar.masterId === s.me.id) {
      $("liar-setup-word").value = "";
      $("liar-setup-hint").value = "";
      setTimeout(() => $("liar-setup-word").focus(), 50);
    }
    if (liar.stage === "clues" && liar.speakerId === s.me.id) {
      $("liar-clue-input").value = "";
      setTimeout(() => $("liar-clue-input").focus(), 50);
    }
    if (liar.stage === "guess" && liar.impostorId === s.me.id) {
      $("liar-guess-input").value = "";
      setTimeout(() => $("liar-guess-input").focus(), 50);
    }
  }
  if (liar.stage !== "setup" && liarUi.introRound !== liar.round && liar.role) {
    liarUi.introRound = liar.round;
    fx.afterBusy(() => {
      if (liar.role === "impostor") fx.overlay([el("div", "fx-big liar-fx-impostor", "🕵️ JESTEŚ KŁAMCĄ!"), el("div", "fx-sub", liar.hintGiven ? "Podpowiedź: " + liar.hint : "Bez podpowiedzi. Powodzenia 😈")], "fx-win liar-fx", 2600);
      else if (liar.role === "crew") fx.overlay([el("div", "fx-sub", "Twoje hasło"), el("div", "fx-big", liar.word)], "fx-win liar-fx", 2200);
    });
  }
  let banner;
  if (liar.stage === "setup") banner = liar.masterId === s.me.id ? "🎬 Wpisz hasło na rundę" : "🎬 Prowadzący wymyśla hasło";
  else if (liar.stage === "clues") banner = liar.speakerId === s.me.id ? "🗣️ Twoje słowo!" : "🗣️ Mówi: " + nickOf(liar.speakerId);
  else if (liar.stage === "vote") banner = "🗳️ Dyskusja i głosowanie";
  else if (liar.stage === "guess") banner = "😬 Kłamca zgaduje hasło";
  else if (liar.stage === "judge") banner = "🤔 Zaliczacie strzał?";
  else banner = "🎉 Odsłona!";
  $("turn-banner").replaceChildren(banner + " ", el("span", "turn-timer"));
  $("turn-banner").classList.toggle("mine", s.activeId === s.me.id);
  renderLiarRole(s);
  renderLiarPanel(s);
  updateTurnTimers();
}

$("liar-setup-submit").onclick = () => act("liar:setup", { word: $("liar-setup-word").value, hint: $("liar-setup-hint").value });
$("liar-clue-submit").onclick = () => act("liar:clue", { text: $("liar-clue-input").value });
$("liar-skip").onclick = () => act("liar:skip");
$("liar-vote-skip").onclick = () => act("liar:vote", { playerId: "skip" });
$("liar-judge-yes").onclick = () => act("liar:judge", { approve: true });
$("liar-judge-no").onclick = () => act("liar:judge", { approve: false });
$("liar-guess-submit").onclick = () => act("liar:guess", { text: $("liar-guess-input").value });
$("liar-continue").onclick = () => act("liar:continue");

for (const [inputId, buttonId] of [["liar-setup-word", "liar-setup-submit"], ["liar-setup-hint", "liar-setup-submit"], ["liar-clue-input", "liar-clue-submit"], ["liar-guess-input", "liar-guess-submit"]]) {
  $(inputId).addEventListener("keydown", (event) => {
    if (event.key === "Enter") $(buttonId).click();
  });
}
