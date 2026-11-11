function ktoTileLabel(s, p) {
  const kto = s.kto;
  if (!kto) return "—";
  if (kto.stage === "reveal") {
    const result = (kto.results || []).find((r) => r.id === p.id);
    if (!result) return "—";
    const parts = [];
    if (result.votes) parts.push("🫵 " + result.votes);
    if (result.points) parts.push("+" + result.points);
    return parts.join(" · ") || "—";
  }
  return kto.voted.includes(p.id) ? "✅ zagłosował(a)" : "🤔 myśli…";
}

function renderKto(s) {
  const active = s.mode === "kto" && Boolean(s.kto) && s.phase === "game";
  show($("kto-stage"), active);
  if (!active) return;
  const kto = s.kto;
  const me = s.me.id;
  store.quietTimer = kto.stage === "reveal";
  store.turnTotal = s.turnTotalMs || TURN_TOTAL_MS;
  show($("action-bar"), false);
  show($("help-bar"), false);
  $("kto-label").textContent = "🫵 Pytanie " + kto.round + " · " + (s.timeLimitMin ? "gra na czas" : "gramy do " + s.pointLimit + " pkt");
  $("kto-question").textContent = kto.question;
  $("kto-author").textContent = kto.authorNick ? "📝 pytanie od " + kto.authorNick : "";
  show($("kto-vote"), kto.stage === "vote");
  show($("kto-reveal"), kto.stage === "reveal");
  if (kto.stage === "vote") {
    const mine = kto.myVote ? nickOf(kto.myVote) : null;
    $("kto-vote-status").textContent = (mine ? "Twój głos: " + mine + " (możesz zmienić)" : "Kliknij osobę. Punkt dostajesz, gdy trafisz w większość") + " · zagłosowali " + kto.voted.length + "/" + kto.voters;
    const voteSignature = JSON.stringify([kto.round, kto.myVote, me, s.players.map((p) => [p.id, p.nick, p.color])]);
    patchList($("kto-vote-buttons"), voteSignature, (box) => {
      for (const p of s.players) {
        const button = el("button", "btn help-choice liar-vote-btn" + (kto.myVote === p.id ? " selected" : ""));
        button.style.setProperty("--pc", p.color);
        const slot = el("div", "media-slot");
        bindSlot(slot, p);
        button.append(slot, el("span", "", p.nick + (p.id === me ? " (ty)" : "")));
        button.onclick = () => act("kto:vote", { playerId: p.id });
        box.appendChild(button);
      }
    });
  }
  if (kto.stage === "reveal") {
    const winners = kto.winnerIds.map((id) => nickOf(id));
    $("kto-reveal-title").textContent = winners.length
      ? "🫵 " + winners.join(" i ") + (winners.length > 1 ? " (remis)" : "")
      : "🤷 Nikt nie zagłosował";
    const resultsSignature = JSON.stringify([kto.round, kto.results, s.players.map((p) => [p.id, p.nick])]);
    patchList($("kto-results"), resultsSignature, (list) => {
      for (const r of kto.results || []) {
        const row = el("div", "wave-result" + (r.winner ? " kto-winner" : ""));
        row.style.setProperty("--pc", r.color);
        row.append(
          el("span", "wave-result-nick", (r.winner ? "🫵 " : "") + r.nick),
          el("span", "wave-result-value", r.votedFor ? "głos na " + nickOf(r.votedFor) : "bez głosu"),
          el("span", "wave-result-points kto-result-votes", r.votes + " gł." + (r.points ? " · +" + r.points : ""))
        );
        list.appendChild(row);
      }
    });
    show($("kto-continue"), s.me.canManage);
  }
  const banner = kto.stage === "vote" ? (kto.myVote ? "🗳️ Czekamy na resztę" : "🫵 Głosuj!") : "🎉 Wynik!";
  $("turn-banner").replaceChildren(banner + " ", el("span", "turn-timer"));
  $("turn-banner").classList.toggle("mine", kto.stage === "vote" && !kto.myVote);
  updateTurnTimers();
}

$("kto-continue").onclick = () => act("kto:continue");
