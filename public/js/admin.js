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
  const timeLimitInput = $("admin-time-limit");
  if (document.activeElement !== timeLimitInput) timeLimitInput.value = s.timeLimitMin;
  const helpLimitInput = $("admin-help-limit");
  if (document.activeElement !== helpLimitInput) helpLimitInput.value = s.helpLimit;
  for (const button of document.querySelectorAll("[data-admin=endHelp]")) button.disabled = !s.help;
  for (const button of document.querySelectorAll("[data-admin=approve], [data-admin=reject]")) button.disabled = !s.vote;
  if (s.mode === "piec") renderAdminFive(s);
  if (s.phase === "game") renderSettingsInto($("admin-settings-fields"), adminSettingsUi, s);
  show($("admin-settings"), s.phase === "game");
  for (const button of document.querySelectorAll("[data-admin=forceNext]")) {
    button.disabled = s.phase !== "game";
    button.textContent = s.mode === "wskazowka" ? "Następna runda" : s.mode === "klamca" || s.mode === "piec" ? "Dalej / pomiń" : "Wymuś Next";
  }

  const adminSignature = JSON.stringify([s.mode, s.phase, s.me.id, s.players.map((p) => [p.id, p.nick, p.color, p.score, p.cardCount])]);
  patchList($("admin-players"), adminSignature, (list) => {
    for (const p of s.players) {
      const row = el("div", "admin-player");
      row.style.setProperty("--pc", p.color);
      const cardsInfo = s.mode === "piec" ? " · 🃏" + (p.cardCount || 0) : "";
      row.appendChild(el("span", "admin-nick", p.nick + " · " + scoreUnit(s, p.score) + cardsInfo));
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
      if (s.mode === "piec") {
        const take = el("button", "btn btn-small", "🗑️🃏");
        take.title = "Zabierz wszystkie karty";
        take.dataset.admin = "takeCards";
        take.dataset.id = p.id;
        take.disabled = s.phase !== "game" || !p.cardCount;
        row.appendChild(take);
      }
      const reroll = el("button", "btn btn-small czolko-only", "🔄");
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
  });
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
  if (action === "timeLimit") act("setTimeLimit", { minutes: Number($("admin-time-limit").value) });
  if (action === "helpLimit") act("setHelpLimit", { limit: Number($("admin-help-limit").value) });
  if (action === "endHelp") act("help:end");
  if (action === "score") act("admin:score", { playerId: id, delta: Number(delta) });
  if (action === "giveCard") act("admin:giveCard", { playerId: $("admin-card-player").value, type: $("admin-card-type").value });
  if (action === "takeCards" && target) ask(`Zabrać wszystkie karty graczowi ${target.nick}?`, () => act("admin:takeCards", { playerId: id }));
  if (action === "restart") ask("Zrestartować grę? Punkty się wyzerują, hasła zostaną wylosowane od nowa.", () => act("admin:restart"));
  if (action === "reroll" && target) {
    const label = target.word ? `„${target.word}”` : "obecne hasło";
    ask(`Wylosować nowe hasło dla gracza ${target.nick}? ${target.id === store.state.me.id ? "Twoje" : label} przepadnie.`, () => act("admin:reroll", { playerId: id }));
  }
  if (action === "end") ask("Zakończyć grę teraz? Wszyscy zobaczą ranking.", () => act("admin:endGame"));
  if (action === "lobby") ask("Przerwać grę i wrócić do lobby?", () => act("backToLobby"));
  if (action === "kick" && target) ask(`Wyrzucić gracza ${target.nick}?`, () => act("kick", { playerId: id }));
});

const adminSettingsUi = { signature: "" };

function renderAdminFive(s) {
  const playerSelect = $("admin-card-player");
  const signature = s.players.map((p) => p.id + ":" + p.nick).join("|");
  if (playerSelect.dataset.signature !== signature) {
    const keep = playerSelect.value;
    playerSelect.dataset.signature = signature;
    playerSelect.replaceChildren(...s.players.map((p) => {
      const option = el("option", "", p.nick);
      option.value = p.id;
      return option;
    }));
    if (keep && s.players.some((p) => p.id === keep)) playerSelect.value = keep;
  }
  const typeSelect = $("admin-card-type");
  const cards = store.fiveCards || {};
  const typeSignature = Object.keys(cards).join("|");
  if (typeSelect.dataset.signature !== typeSignature) {
    typeSelect.dataset.signature = typeSignature;
    const random = el("option", "", "🎲 Losowa");
    random.value = "random";
    typeSelect.replaceChildren(random, ...Object.entries(cards).map(([type, info]) => {
      const option = el("option", "", info.icon + " " + info.name);
      option.value = type;
      option.title = info.text;
      return option;
    }));
  }
  for (const button of document.querySelectorAll("[data-admin=giveCard]")) button.disabled = s.phase !== "game";
}
