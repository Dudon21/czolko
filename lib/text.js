const { similarWords, normalizeGuess, editDistance } = require("../public/match");

const MAX_CHAT_TEXT = 500;
const MASK_MIN_TOKEN = 4;

function cleanMessage(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CHAT_TEXT);
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskSecret(text, secret) {
  if (!text || !secret) return text;
  const parts = [secret, ...secret.split(/[\s-]+/).filter((part) => part.length >= MASK_MIN_TOKEN)];
  const unique = [...new Set(parts.map((part) => part.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(unique.map(escapeRegex).join("|"), "giu");
  const hide = (match) => "█".repeat(Math.min(match.length, 12));
  const tokens = secret.split(/[\s-]+/).map(normalizeGuess).filter((token) => token.length >= MASK_MIN_TOKEN);
  const exact = text.replace(pattern, hide);
  if (!tokens.length) return exact;
  return exact.replace(/[\p{L}\p{N}]+/gu, (word) => (tokens.some((token) => resembles(normalizeGuess(word), token)) ? hide(word) : word));
}

function resembles(word, token) {
  if (word.length < MASK_MIN_TOKEN) return false;
  if (word === token) return true;
  const stem = token.slice(0, Math.max(MASK_MIN_TOKEN, token.length - 2));
  if (word.startsWith(stem) && word.length <= token.length + 3) return true;
  return token.length >= 5 && Math.abs(word.length - token.length) <= 1 && editDistance(word, token) <= 1;
}

function findTwin(list) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (similarWords(list[i], list[j])) return [list[i], list[j]];
    }
  }
  return null;
}

function twinMessage([a, b]) {
  return textKey(a) === textKey(b) ? `Hasło „${a}” się powtarza` : `„${a}” i „${b}” to prawie to samo hasło`;
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || "";
  return names.slice(0, -1).join(", ") + " i " + names[names.length - 1];
}

function formatPoints(value) {
  return String(Math.round(value * 10) / 10).replace(".", ",");
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function textKey(text) {
  return text.toLocaleLowerCase("pl");
}

module.exports = { cleanMessage, escapeRegex, maskSecret, findTwin, twinMessage, joinNames, formatPoints, cleanText, textKey };
