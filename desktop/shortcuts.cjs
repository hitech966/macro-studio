const DEFAULT_BINDINGS = { record: "F6", play: "F7", pause: "F8", stop: "F9" };
const EMERGENCY = "CommandOrControl+Shift+Escape";
const ACTIONS = Object.keys(DEFAULT_BINDINGS);
function normalizeBindings(raw, platform = process.platform) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid keybind settings");
  const result = {},
    used = new Set();
  function canonical(value) {
    if (typeof value !== "string" || value.length > 100)
      throw new Error("Invalid keybind");
    const parts = value.split("+");
    const key = parts.pop();
    const aliases = {
      Ctrl: "Control",
      Cmd: "Command",
      Meta: platform === "darwin" ? "Command" : "Super",
      Super: "Super",
      Alt: "Alt",
      Control: "Control",
      Shift: "Shift",
      Command: platform === "darwin" ? "Command" : "Super",
      CommandOrControl: platform === "darwin" ? "Command" : "Control",
    };
    const mods = parts.map((p) => aliases[p]);
    if (mods.some((m) => !m) || new Set(mods).size !== mods.length)
      throw new Error("Invalid or repeated keybind modifier");
    if (
      !/^(F([1-9]|1[0-9]|2[0-4])|[A-Z0-9]|Enter|Space|Escape|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/.test(
        key || "",
      )
    )
      throw new Error("Use a letter, digit, function key or navigation key");
    if (mods.length === 0 && !/^F\d+$/.test(key))
      throw new Error(
        "Single-key shortcuts must use a function key; add a modifier for other keys",
      );
    return [
      ...["Control", "Command", "Super", "Alt", "Shift"].filter((m) =>
        mods.includes(m),
      ),
      key,
    ].join("+");
  }
  const emergency = canonical(EMERGENCY);
  for (const action of ACTIONS) {
    const key = canonical(raw[action]);
    if (key === emergency)
      throw new Error("The emergency stop shortcut is reserved");
    if (used.has(key)) throw new Error("Each action needs a different keybind");
    used.add(key);
    result[action] = key;
  }
  return result;
}
class ShortcutManager {
  constructor(api, dispatch) {
    this.api = api;
    this.dispatch = dispatch;
    this.active = {};
    this.owned = new Set();
  }
  register(key) {
    const success = this.api.register(key, () => {
      const action =
        key === EMERGENCY
          ? "stop"
          : Object.entries(this.active).find(
              ([, binding]) => binding === key,
            )?.[0];
      if (action) this.dispatch(action);
    });
    if (success) this.owned.add(key);
    return success;
  }
  status() {
    return [
      ...Object.entries(this.active).map(([action, key]) => ({
        action,
        key,
        available: this.owned.has(key),
      })),
      {
        action: "emergency",
        key: EMERGENCY,
        available: this.owned.has(EMERGENCY),
      },
    ];
  }
  initialize(raw) {
    this.active = normalizeBindings(raw);
    for (const key of [...Object.values(this.active), EMERGENCY])
      this.register(key);
    return this.status();
  }
  suspend() {
    for (const key of Object.values(this.active)) {
      if (this.owned.has(key)) {
        this.api.unregister(key);
        this.owned.delete(key);
      }
    }
    return this.status();
  }
  resume() {
    for (const key of Object.values(this.active))
      if (!this.owned.has(key)) this.register(key);
    return this.status();
  }
  apply(raw) {
    const next = normalizeBindings(raw),
      added = [];
    try {
      for (const key of Object.values(next)) {
        if (this.owned.has(key)) continue;
        if (!this.register(key))
          throw new Error(
            `Keybind ${key} is unavailable or used by another app`,
          );
        added.push(key);
      }
    } catch (error) {
      for (const key of added) {
        this.api.unregister(key);
        this.owned.delete(key);
      }
      throw error;
    }
    const wanted = new Set([...Object.values(next), EMERGENCY]);
    for (const key of [...this.owned])
      if (!wanted.has(key)) {
        this.api.unregister(key);
        this.owned.delete(key);
      }
    this.active = next;
    return this.status();
  }
}
module.exports = {
  DEFAULT_BINDINGS,
  EMERGENCY,
  normalizeBindings,
  ShortcutManager,
};
