(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WordMatch = api;
})(typeof self !== "undefined" ? self : this, function () {
  function normalizeGuess(text) {
    return String(text || "")
      .toLocaleLowerCase("pl")
      .replace(/ł/g, "l")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
  }

  function editDistance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[b.length];
  }

  function guessMatches(guess, answer) {
    const a = normalizeGuess(guess);
    const b = normalizeGuess(answer);
    if (!a || !b) return false;
    if (a === b) return true;
    const tolerance = b.length >= 8 ? 2 : b.length >= 4 ? 1 : 0;
    return editDistance(a, b) <= tolerance;
  }

  function similarWords(a, b) {
    const x = normalizeGuess(a);
    const y = normalizeGuess(b);
    if (!x || !y) return String(a).toLocaleLowerCase("pl") === String(b).toLocaleLowerCase("pl");
    if (x === y) return true;
    if (x[0] !== y[0]) return false;
    if (x.replace(/\D/g, "") !== y.replace(/\D/g, "")) return false;
    const length = Math.min(x.length, y.length);
    const tolerance = length >= 9 ? 2 : length >= 6 ? 1 : 0;
    return Math.abs(x.length - y.length) <= tolerance && editDistance(x, y) <= tolerance;
  }

  return { normalizeGuess, editDistance, guessMatches, similarWords };
});
