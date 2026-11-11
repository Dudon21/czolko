const crypto = require("crypto");

function isAuthorOf(word, player) {
  return word.authorId === player.id || (word.coAuthors || []).includes(player.id);
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

module.exports = { isAuthorOf, shuffle };
