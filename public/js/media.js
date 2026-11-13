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
  lib: null,
  loading: null,
  available: false,

  load() {
    if (this.lib) return Promise.resolve(this.lib);
    if (!this.loading) {
      this.loading = new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "/vendor/livekit-client.js";
        script.onload = () => {
          this.lib = window.LivekitClient || null;
          resolve(this.lib);
        };
        script.onerror = () => {
          this.loading = null;
          resolve(null);
        };
        document.head.appendChild(script);
      });
    }
    return this.loading;
  },
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
    } catch (error) {
      const limit = /limit/i.test(String(error && error.message));
      toast(limit ? "Kamerki niedostępne: wyczerpany miesięczny limit minut serwera wideo (LiveKit)" : "Nie udało się połączyć z serwerem wideo", true);
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
  for (const id of ["btn-camera", "btn-camera-panel"]) {
    $(id).textContent = video.cameraOn ? "📷 Wyłącz kamerkę" : "📷 Włącz kamerkę";
    $(id).classList.toggle("selected", video.cameraOn);
  }
  $("btn-camera-game").classList.toggle("selected", video.cameraOn || Boolean(me && me.hasPhone));
  if (!video.available) show($("camera-panel"), false);
  if (store.state) {
    for (const node of document.querySelectorAll(".phone-site")) node.textContent = location.host;
    for (const node of document.querySelectorAll(".my-camera-code")) node.textContent = store.state.me.cameraCode;
    const link = `${location.origin}/?kamera=${store.state.me.cameraCode}`;
    const qr = `/qr.svg?text=${encodeURIComponent(link)}`;
    for (const node of document.querySelectorAll(".phone-qr")) {
      if (node.getAttribute("src") !== qr) node.setAttribute("src", qr);
      show(node, !(me && me.hasPhone));
    }
    for (const node of document.querySelectorAll(".phone-status")) {
      node.textContent = me && me.hasPhone ? "📱 telefon połączony" : "telefon niepodłączony";
      node.classList.toggle("tag-ok", Boolean(me && me.hasPhone));
    }
  }
}

for (const id of ["btn-camera", "btn-camera-panel"]) {
  $(id).onclick = () => video.setCamera(!video.cameraOn);
}

$("btn-camera-game").onclick = () => $("camera-panel").classList.toggle("hidden");

function bindSlot(slot, player) {
  slot.dataset.playerId = player.id;
  media.update(slot, player);
}

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
    if (!(await video.load())) return ($("phone-error").textContent = "Nie udało się wczytać biblioteki wideo");
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
