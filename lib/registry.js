const { EventEmitter } = require("events");
const crypto = require("crypto");
const { Room } = require("./room");

const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
const LOBBY_WARNING_MS = 2 * 60 * 1000;
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CAMERA_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CAMERA_CODE_LENGTH = 6;

class Registry extends EventEmitter {
  constructor() {
    super();
    this.rooms = new Map();
  }

  createRoom() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)]).join("");
    } while (this.rooms.has(code));
    const room = new Room(code, this);
    this.rooms.set(code, room);
    this.scheduleExpiry(room);
    return room;
  }

  getRoom(code) {
    if (typeof code !== "string") return null;
    return this.rooms.get(code.trim().toUpperCase()) || null;
  }

  findByToken(token) {
    if (typeof token !== "string" || !token) return null;
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.token === token);
      if (player) return { room, player };
    }
    return null;
  }

  findByCameraCode(code) {
    if (typeof code !== "string") return null;
    const wanted = code.trim().toUpperCase();
    if (wanted.length !== CAMERA_CODE_LENGTH) return null;
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.cameraCode === wanted);
      if (player) return { room, player };
    }
    return null;
  }

  newCameraCode() {
    let code;
    do {
      code = Array.from({ length: CAMERA_CODE_LENGTH }, () => CAMERA_CODE_CHARS[crypto.randomInt(CAMERA_CODE_CHARS.length)]).join("");
    } while (this.findByCameraCode(code));
    return code;
  }

  scheduleExpiry(room) {
    clearTimeout(room.expiryTimer);
    clearTimeout(room.warningTimer);
    room.expiryTimer = null;
    room.warningTimer = null;
    if (room.phase !== "lobby") return;
    const remaining = room.expiresAt - Date.now();
    room.expiryTimer = setTimeout(() => this.expireRoom(room), Math.max(0, remaining));
    if (remaining > LOBBY_WARNING_MS) {
      room.warningTimer = setTimeout(() => {
        room.announce("Lobby zamknie się za 2 minuty, jeśli gra nie wystartuje. Host może przedłużyć");
        room.changed();
      }, remaining - LOBBY_WARNING_MS);
    }
  }

  expireRoom(room) {
    if (this.rooms.get(room.code) !== room) return;
    for (const player of room.players) this.emit("removed", room, player, "Pokój zamknięty: gra nie wystartowała przez 15 minut");
    room.players = [];
    this.deleteRoom(room);
  }

  updatePresence(room) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
    if (!room.players.length) return this.deleteRoom(room);
    if (!room.players.some((p) => p.connected)) {
      room.cleanupTimer = setTimeout(() => this.deleteRoom(room), EMPTY_ROOM_TTL_MS);
    }
  }

  deleteRoom(room) {
    clearTimeout(room.cleanupTimer);
    clearTimeout(room.expiryTimer);
    clearTimeout(room.warningTimer);
    room.clearRounds();
    room.stopTurnTimer();
    room.stopGameTimer();
    this.rooms.delete(room.code);
  }
}

module.exports = { Registry };
