class GameError extends Error {}

function fail(message) {
  throw new GameError(message);
}

module.exports = { GameError, fail };
