function later(callback, ms) {
  const timer = setTimeout(() => {
    try {
      callback();
    } catch (error) {
      console.error("Błąd w liczniku:", error);
    }
  }, ms);
  timer.unref();
  return timer;
}

module.exports = { later };
