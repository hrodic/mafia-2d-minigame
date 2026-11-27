// Optional runtime counters for performance work. Disabled by default so the
// production simulation pays only a boolean check. The long-sim harness turns
// them on to report A* calls, LOS hits, explored nodes and collision volume.

const counters = Object.create(null);

export const perf = {
  enabled: false,

  reset() {
    for (const key in counters) delete counters[key];
  },

  inc(name) {
    if (!this.enabled) return;
    counters[name] = (counters[name] || 0) + 1;
  },

  add(name, amount) {
    if (!this.enabled) return;
    counters[name] = (counters[name] || 0) + amount;
  },

  snapshot() {
    return { ...counters };
  },
};
