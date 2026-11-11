const CHAT_MAX_IMAGE = 440000;
const CHAT_IMAGE_SIDE = 1280;
const CHAT_GIF_LIMIT = 330000;
const CHAT_DOM_LIMIT = 200;
const URL_PATTERN = /(https?:\/\/[^\s<]+)/g;

const chat = {
  messages: [],
  open: false,
  unread: 0,
  attachment: null,
  sending: false,
  peekTimer: null,

  available() {
    return Boolean(store.state) && !phone.mode;
  },

  renderAvailability() {
    const visible = this.available();
    show($("chat-toggle"), visible && !this.open);
    if (!visible) {
      show($("chat-panel"), false);
      show($("chat-peek"), false);
    }
    this.renderRecipients();
  },

  setOpen(open) {
    this.open = open;
    show($("chat-panel"), open && this.available());
    show($("chat-toggle"), !open && this.available());
    if (open) {
      this.unread = 0;
      this.renderBadge();
      show($("chat-peek"), false);
      this.scrollToBottom(true);
      setTimeout(() => $("chat-input").focus(), 30);
    }
  },

  renderBadge() {
    $("chat-badge").textContent = this.unread > 9 ? "9+" : String(this.unread);
    show($("chat-badge"), this.unread > 0);
  },

  renderRecipients() {
    const select = $("chat-to");
    const s = store.state;
    if (!s) return;
    const current = select.value;
    const options = [["", "🌍 Wszyscy"]];
    for (const p of s.players) if (p.id !== s.me.id) options.push([p.id, "🔒 " + p.nick]);
    const signature = options.map((o) => o.join(":")).join("|");
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      select.replaceChildren(...options.map(([value, label]) => {
        const option = el("option", "", label);
        option.value = value;
        return option;
      }));
      select.value = options.some(([value]) => value === current) ? current : "";
    }
    this.renderMode();
  },

  renderMode() {
    const select = $("chat-to");
    const target = select.value ? findPlayer(select.value) : null;
    $("chat-panel").classList.toggle("private-mode", Boolean(target));
    $("chat-input").placeholder = target ? "Prywatnie do " + target.nick + "…" : "Napisz do wszystkich…";
  },

  setRecipient(id) {
    $("chat-to").value = id || "";
    this.renderMode();
    $("chat-input").focus();
  },

  formatTime(at) {
    const date = new Date(at);
    return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  },

  appendText(node, text) {
    let last = 0;
    for (const match of text.matchAll(URL_PATTERN)) {
      if (match.index > last) node.append(text.slice(last, match.index));
      const link = el("a", "chat-link", match[0]);
      link.href = match[0];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      node.appendChild(link);
      last = match.index + match[0].length;
    }
    if (last < text.length) node.append(text.slice(last));
  },

  buildMessage(m) {
    const me = store.state ? store.state.me.id : null;
    const mine = m.fromId === me;
    const item = el("div", "chat-msg" + (mine ? " mine" : "") + (m.toId ? " private" : ""));
    item.style.setProperty("--pc", m.color);
    const meta = el("div", "chat-meta");
    const author = el("button", "chat-author", mine ? "Ty" : m.fromNick);
    author.type = "button";
    if (!mine) {
      author.title = "Napisz prywatnie do " + m.fromNick;
      author.onclick = () => this.setRecipient(m.fromId);
    }
    meta.appendChild(author);
    if (m.toId) meta.appendChild(el("span", "chat-private-tag", mine ? "🔒 do " + m.toNick : "🔒 tylko do ciebie"));
    meta.appendChild(el("span", "chat-time", this.formatTime(m.at)));
    item.appendChild(meta);
    if (m.text) {
      const body = el("div", "chat-text");
      this.appendText(body, m.text);
      item.appendChild(body);
    }
    if (m.image) {
      const img = el("img", "chat-img");
      img.src = m.image;
      img.alt = "zdjęcie od " + m.fromNick;
      img.loading = "lazy";
      img.onload = () => this.scrollToBottom(false);
      img.onclick = () => this.showLightbox(m.image);
      item.appendChild(img);
    } else if (m.imageExpired) {
      item.appendChild(el("div", "chat-expired", "🖼️ starsze zdjęcie wygasło"));
    }
    return item;
  },

  nearBottom() {
    const list = $("chat-list");
    return list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  },

  scrollToBottom(force) {
    const list = $("chat-list");
    if (force || this.nearBottom()) list.scrollTop = list.scrollHeight;
  },

  renderAll() {
    const list = $("chat-list");
    list.replaceChildren();
    if (!this.messages.length) list.appendChild(el("p", "chat-empty", "Jeszcze cisza. Napisz coś! Kliknij nick, żeby napisać prywatnie."));
    for (const m of this.messages.slice(-CHAT_DOM_LIMIT)) list.appendChild(this.buildMessage(m));
    this.scrollToBottom(true);
  },

  setHistory(messages) {
    this.messages = messages;
    this.renderAll();
  },

  receive(m) {
    const list = $("chat-list");
    const stick = this.nearBottom();
    if (!this.messages.length) list.replaceChildren();
    this.messages.push(m);
    if (this.messages.length > CHAT_DOM_LIMIT) this.messages.shift();
    list.appendChild(this.buildMessage(m));
    while (list.children.length > CHAT_DOM_LIMIT) list.firstElementChild.remove();
    if (stick) this.scrollToBottom(true);
    const mine = store.state && m.fromId === store.state.me.id;
    if (mine) return;
    sfx.play(m.toId ? "chatPrivate" : "chat", 150);
    if (!this.open) {
      this.unread += 1;
      this.renderBadge();
      this.peek(m);
    }
  },

  peek(m) {
    const node = $("chat-peek");
    node.replaceChildren(
      el("b", "", (m.toId ? "🔒 " : "") + m.fromNick + ": "),
      document.createTextNode(m.text ? m.text.slice(0, 80) : "📷 zdjęcie")
    );
    node.style.setProperty("--pc", m.color);
    show(node, true);
    motion.restart(node, "chat-peek-in");
    clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => show(node, false), 3500);
  },

  showLightbox(src) {
    $("lightbox-img").src = src;
    show($("lightbox"), true);
  },

  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("read"));
      reader.readAsDataURL(file);
    });
  },

  loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image"));
      };
      image.src = url;
    });
  },

  async compress(file) {
    if (file.type === "image/gif" && file.size <= CHAT_GIF_LIMIT) return this.readFile(file);
    const image = await this.loadImage(file);
    let side = CHAT_IMAGE_SIDE;
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.7, 0.55]) {
        const data = canvas.toDataURL("image/jpeg", quality);
        if (data.length <= CHAT_MAX_IMAGE) return data;
      }
      side = Math.round(side * 0.7);
    }
    throw new Error("too-big");
  },

  async attach(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("To nie jest obrazek", true);
    try {
      this.attachment = await this.compress(file);
    } catch {
      this.attachment = null;
      return toast("Nie udało się przygotować zdjęcia", true);
    }
    $("chat-attachment-img").src = this.attachment;
    show($("chat-attachment"), true);
    if (!this.open) this.setOpen(true);
    $("chat-input").focus();
  },

  clearAttachment() {
    this.attachment = null;
    $("chat-attachment-img").removeAttribute("src");
    show($("chat-attachment"), false);
  },

  autosize() {
    const input = $("chat-input");
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  },

  async send() {
    if (this.sending) return;
    const input = $("chat-input");
    const text = input.value.trim();
    if (!text && !this.attachment) return;
    this.sending = true;
    $("chat-send").disabled = true;
    const response = await call("chat:send", { text, image: this.attachment, toId: $("chat-to").value || null });
    this.sending = false;
    $("chat-send").disabled = false;
    if (!response.ok) return toast(response.error, true);
    input.value = "";
    this.autosize();
    this.clearAttachment();
    input.focus();
  }
};

$("chat-toggle").onclick = () => chat.setOpen(true);
$("chat-close").onclick = () => chat.setOpen(false);
$("chat-send").onclick = () => chat.send();
$("chat-to").onchange = () => chat.renderMode();
$("chat-attach").onclick = () => $("chat-file").click();

$("chat-file").onchange = (event) => {
  chat.attach(event.target.files[0]);
  event.target.value = "";
};

$("chat-attachment-remove").onclick = () => chat.clearAttachment();

$("chat-input").addEventListener("input", () => chat.autosize());

$("chat-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chat.send();
  }
  if (event.key === "Escape") chat.setOpen(false);
});

$("chat-input").addEventListener("paste", (event) => {
  const items = event.clipboardData ? [...event.clipboardData.items] : [];
  const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
  if (!imageItem) return;
  event.preventDefault();
  chat.attach(imageItem.getAsFile());
});

const chatPanel = $("chat-panel");

let chatDragDepth = 0;

chatPanel.addEventListener("dragenter", (event) => {
  if (![...event.dataTransfer.types].includes("Files")) return;
  event.preventDefault();
  chatDragDepth += 1;
  show($("chat-drop"), true);
});

chatPanel.addEventListener("dragover", (event) => {
  if ([...event.dataTransfer.types].includes("Files")) event.preventDefault();
});

chatPanel.addEventListener("dragleave", () => {
  chatDragDepth = Math.max(0, chatDragDepth - 1);
  if (!chatDragDepth) show($("chat-drop"), false);
});

chatPanel.addEventListener("drop", (event) => {
  event.preventDefault();
  chatDragDepth = 0;
  show($("chat-drop"), false);
  const file = [...event.dataTransfer.files].find((f) => f.type.startsWith("image/"));
  if (file) chat.attach(file);
});

$("chat-peek").onclick = () => chat.setOpen(true);
$("lightbox").onclick = () => show($("lightbox"), false);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("lightbox").classList.contains("hidden")) show($("lightbox"), false);
});

socket.on("chat:history", (messages) => chat.setHistory(Array.isArray(messages) ? messages : []));

socket.on("chat:message", (message) => chat.receive(message));
