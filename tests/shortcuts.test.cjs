const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_BINDINGS,
  EMERGENCY,
  normalizeBindings,
  ShortcutManager,
} = require("../desktop/shortcuts.cjs");
function fixture() {
  const callbacks = new Map(),
    blocked = new Set();
  const api = {
    register: (key, fn) => {
      if (blocked.has(key) || callbacks.has(key)) return false;
      callbacks.set(key, fn);
      return true;
    },
    unregister: (key) => callbacks.delete(key),
  };
  const fired = [];
  const manager = new ShortcutManager(api, (a) => fired.push(a));
  manager.initialize(DEFAULT_BINDINGS);
  return { callbacks, blocked, fired, manager };
}
test("normalizes aliases and rejects duplicate physical combinations", () => {
  assert.equal(
    normalizeBindings({ ...DEFAULT_BINDINGS, record: "Shift+Ctrl+R" }, "win32")
      .record,
    "Control+Shift+R",
  );
  assert.throws(
    () =>
      normalizeBindings(
        { ...DEFAULT_BINDINGS, record: "Ctrl+R", play: "Control+R" },
        "win32",
      ),
    /different/,
  );
});
test("reserves emergency stop and prevents bare typing-key hotkeys", () => {
  assert.throws(
    () =>
      normalizeBindings({
        ...DEFAULT_BINDINGS,
        stop: "CommandOrControl+Shift+Escape",
      }),
    /reserved/,
  );
  assert.throws(
    () => normalizeBindings({ ...DEFAULT_BINDINGS, record: "R" }),
    /modifier/,
  );
});
test("registration conflict rolls back new keys and keeps previous bindings working", () => {
  const f = fixture();
  f.blocked.add("F13");
  assert.throws(
    () =>
      f.manager.apply({
        record: "F10",
        play: "F11",
        pause: "F12",
        stop: "F13",
      }),
    /unavailable/,
  );
  assert.equal(f.callbacks.has("F10"), false);
  f.callbacks.get("F9")();
  assert.deepEqual(f.fired, ["stop"]);
  assert.deepEqual(f.manager.active, DEFAULT_BINDINGS);
});
test("supports swapping existing bindings without losing callback mapping", () => {
  const f = fixture();
  f.manager.apply({ ...DEFAULT_BINDINGS, play: "F8", pause: "F7" });
  f.callbacks.get("F7")();
  f.callbacks.get("F8")();
  assert.deepEqual(f.fired, ["pause", "play"]);
});
test("editing suspends ordinary shortcuts and retains emergency stop", () => {
  const f = fixture();
  f.manager.suspend();
  assert.equal(f.callbacks.size, 1);
  f.callbacks.get(EMERGENCY)();
  assert.deepEqual(f.fired, ["stop"]);
  f.manager.resume();
  assert.equal(f.callbacks.size, 5);
});
