const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  dialog,
  Menu,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { Store } = require("./storage.cjs");
const {
  DEFAULT_BINDINGS,
  ShortcutManager,
  normalizeBindings,
} = require("./shortcuts.cjs");
const smoke = process.argv.includes("--smoke-test");
const dev = process.argv.includes("--dev");
if (!smoke && !app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});
let window,
  worker,
  store,
  state = "idle",
  journal = null,
  shuttingDown = false,
  closeRequested = false;
let requestId = 0;
const pending = new Map();
let shortcutStatus = [];
let shortcutManager;
function event(data) {
  if (window && !window.isDestroyed())
    window.webContents.send("studio:event", data);
}
function pythonPath() {
  if (process.env.MACRO_PYTHON) return process.env.MACRO_PYTHON;
  const local = path.join(
    __dirname,
    "..",
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  return fs.existsSync(local)
    ? local
    : process.platform === "win32"
      ? "python"
      : "python3";
}
function rpc(command, payload = {}) {
  if (!worker || worker.exitCode !== null || !worker.stdin.writable)
    return Promise.reject(
      new Error(
        "Automation engine unavailable. Check Python setup and restart.",
      ),
    );
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Engine request timed out"));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    worker.stdin.write(
      JSON.stringify({ id, command, payload }) + "\n",
      (error) => {
        if (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      },
    );
  });
}
function engineFailure(message) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(message));
  }
  pending.clear();
  state = "offline";
  event({ event: "state", state });
  event({ event: "error", message });
}
function engineSpec() {
  const engine = app.isPackaged
    ? path.join(process.resourcesPath, "engine")
    : path.join(__dirname, "..", "engine");
  const bundled = path.join(
    process.resourcesPath,
    "macro-engine",
    process.platform === "win32" ? "macro-engine.exe" : "macro-engine",
  );
  return app.isPackaged && fs.existsSync(bundled) && !process.env.MACRO_PYTHON
    ? { command: bundled, args: [] }
    : { command: pythonPath(), args: ["-u", path.join(engine, "service.py")] };
}
function startEngine() {
  const spec = engineSpec();
  worker = spawn(spec.command, spec.args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  worker.on("error", (e) => engineFailure(e.message));
  worker.on("exit", (code) => {
    if (!shuttingDown)
      engineFailure(
        `Engine exited (${code}). Recording journal is preserved. Restart to recover.`,
      );
  });
  worker.stdin.on("error", () => {});
  worker.stderr.on("data", () =>
    event({
      event: "error",
      message:
        "Engine diagnostic output received. Check Python and OS input permissions.",
    }),
  );
  readline.createInterface({ input: worker.stdout }).on("line", (line) => {
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      return engineFailure("Invalid engine response");
    }
    if (data.id != null) {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      clearTimeout(p.timer);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
      return;
    }
    if (data.event === "state") state = data.state;
    if (data.event === "record_action" && journal)
      journal.macro.actions.push(data.action);
    if (data.event === "record_complete" && journal) {
      journal.macro.actions = data.actions;
      try {
        const library = store.read("library", { macros: [] });
        const index = library.macros.findIndex(
          (m) => m.id === journal.macro.id,
        );
        if (index >= 0) library.macros[index] = journal.macro;
        else library.macros.push(journal.macro);
        store.write("library", library);
        store.remove("recording");
        journal = null;
      } catch (e) {
        event({
          event: "error",
          message: "Recording save failed: " + e.message,
        });
      }
    }
    event(data);
  });
}
function trusted(e) {
  if (
    e.sender !== window.webContents ||
    e.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("Untrusted caller");
}
async function canonicalMacro(m) {
  const clean = await rpc("validate", m);
  if (typeof m.id !== "string" || m.id.length > 100)
    throw new Error("Invalid macro ID");
  return {
    ...clean,
    id: m.id,
    script: typeof m.script === "string" ? m.script.slice(0, 200000) : "",
  };
}
async function command(command, payload) {
  if (
    ![
      "record",
      "play",
      "pause",
      "stop",
      "capabilities",
      "compile",
      "validate",
    ].includes(command)
  )
    throw new Error("Unsupported command");
  if (command === "record") {
    if (state !== "idle") throw new Error("Engine is busy");
    state = "starting";
    try {
      const macro = await canonicalMacro(payload.macro);
      journal = {
        macro: { ...macro, actions: [] },
        started: new Date().toISOString(),
      };
      store.write("recording", journal);
      return await rpc("record", { countdown: payload.countdown });
    } catch (e) {
      if (state === "starting") state = "idle";
      journal = null;
      store.remove("recording");
      throw e;
    }
  }
  return rpc(command, payload);
}
app.whenReady().then(async () => {
  store = new Store(
    smoke
      ? path.join(process.cwd(), "test-results", "smoke-profile")
      : app.getPath("userData"),
  );
  if (smoke) {
    store.remove("library");
    store.remove("recording");
    store.remove("preferences");
  }
  startEngine();
  shortcutManager = new ShortcutManager(globalShortcut, (action) => {
    if (action === "stop" || action === "pause")
      rpc(action).catch((e) => event({ event: "error", message: e.message }));
    else event({ event: "hotkey", action });
  });
  let bindings;
  try {
    bindings = normalizeBindings(
      store.read("preferences", {}).bindings || DEFAULT_BINDINGS,
    );
  } catch {
    bindings = DEFAULT_BINDINGS;
  }
  shortcutStatus = shortcutManager.initialize(bindings);
  await rpc("reserved_keys", {
    keys: Object.values(shortcutManager.active)
      .filter((key) => !key.includes("+"))
      .map((key) => key.toLowerCase()),
  }).catch(() => {});
  window = new BrowserWindow({
    icon: path.join(__dirname, "icon.png"),
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 760,
    show: !smoke,
    backgroundColor: "#f5f6fa",
    title: "Macro Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  window.webContents.on("render-process-gone", () =>
    rpc("stop").catch(() => {}),
  );
  window.on("unresponsive", () => rpc("stop").catch(() => {}));
  window.on("close", (e) => {
    if (shuttingDown || smoke) return;
    e.preventDefault();
    if (!closeRequested) {
      closeRequested = true;
      event({ event: "request_close" });
    }
  });
  ipcMain.handle("studio:close-ready", (e, success) => {
    trusted(e);
    closeRequested = false;
    if (success) app.quit();
  });
  ipcMain.handle("studio:load", async (e) => {
    trusted(e);
    let library = store.read("library", { macros: [] });
    const recovery = store.read("recording", null);
    let recovered = false;
    if (
      recovery &&
      Array.isArray(recovery.macro?.actions) &&
      recovery.macro.actions.length
    ) {
      const macro = await canonicalMacro({
        ...recovery.macro,
        id: "recovered-" + Date.now(),
        name: recovery.macro.name.slice(0, 108) + " (recovered)",
      });
      library.macros.push(macro);
      store.write("library", library);
      store.remove("recording");
      recovered = true;
    }
    let capabilities;
    try {
      capabilities = await rpc("capabilities");
    } catch (error) {
      capabilities = {
        available: false,
        message: error.message,
        platform: process.platform,
      };
    }
    return {
      library,
      recovered,
      capabilities,
      shortcuts: shortcutStatus,
      bindings: shortcutManager.active,
      state,
    };
  });
  ipcMain.handle("studio:save", async (e, library) => {
    trusted(e);
    if (state !== "idle" && state !== "offline")
      throw new Error("Stop automation before saving edits");
    if (!Array.isArray(library?.macros) || library.macros.length > 200)
      throw new Error("Library limit is 200 macros");
    const macros = [];
    for (const m of library.macros) macros.push(await canonicalMacro(m));
    if (new Set(macros.map((m) => m.id)).size !== macros.length)
      throw new Error("Macro IDs must be unique");
    store.write("library", { macros });
    return true;
  });
  ipcMain.handle("studio:command", (e, cmd, payload = {}) => {
    trusted(e);
    return command(cmd, payload);
  });
  ipcMain.handle("studio:keybinds", async (e, raw) => {
    trusted(e);
    if (state !== "idle")
      throw new Error("Stop automation before changing keybinds");
    const old = { ...shortcutManager.active };
    const next = normalizeBindings(raw);
    shortcutManager.apply(next);
    try {
      await rpc("reserved_keys", {
        keys: Object.values(next)
          .filter((key) => !key.includes("+"))
          .map((key) => key.toLowerCase()),
      });
      store.write("preferences", { bindings: next });
    } catch (error) {
      shortcutManager.apply(old);
      await rpc("reserved_keys", {
        keys: Object.values(old)
          .filter((key) => !key.includes("+"))
          .map((key) => key.toLowerCase()),
      }).catch(() => {});
      throw error;
    }
    shortcutStatus = shortcutManager.status();
    return { bindings: shortcutManager.active, shortcuts: shortcutStatus };
  });
  ipcMain.handle("studio:keybind-editing", (e, enabled) => {
    trusted(e);
    if (state !== "idle")
      throw new Error("Stop automation before changing keybinds");
    shortcutStatus = enabled
      ? shortcutManager.suspend()
      : shortcutManager.resume();
    return shortcutStatus;
  });
  ipcMain.handle("studio:import", async (e) => {
    trusted(e);
    const result = await dialog.showOpenDialog(window, {
      filters: [{ name: "Macro Studio JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    const filename = result.filePaths[0];
    if (fs.statSync(filename).size > 8_000_000)
      throw new Error("File exceeds 8 MB");
    const value = JSON.parse(fs.readFileSync(filename, "utf8"));
    return canonicalMacro({ ...value, id: "import-" + Date.now() });
  });
  ipcMain.handle("studio:export", async (e, raw) => {
    trusted(e);
    const macro = await canonicalMacro(raw);
    const result = await dialog.showSaveDialog(window, {
      defaultPath: "macro.json",
      filters: [{ name: "Macro Studio JSON", extensions: ["json"] }],
    });
    if (result.canceled) return false;
    fs.writeFileSync(result.filePath, JSON.stringify(macro, null, 2), {
      mode: 0o600,
    });
    return true;
  });
  const timer = setInterval(() => {
    if (journal) {
      try {
        store.write("recording", journal);
      } catch (e) {
        event({
          event: "error",
          message: "Recovery save failed: " + e.message,
        });
        rpc("stop").catch(() => {});
      }
    }
  }, 250);
  timer.unref();
  const heartbeat = setInterval(() => rpc("heartbeat").catch(() => {}), 1000);
  heartbeat.unref();
  if (dev) await window.loadURL("http://127.0.0.1:5173");
  else await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  if (smoke) {
    try {
      const { run } = require("./smoke.cjs");
      await run(window, rpc, store, engineSpec());
      console.log("DESKTOP_SMOKE_OK");
      app.exit(0);
    } catch (e) {
      console.error(e);
      app.exit(1);
    }
  }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (e) => {
  if (shuttingDown) return;
  e.preventDefault();
  shuttingDown = true;
  globalShortcut.unregisterAll();
  if (journal) {
    try {
      store.write("recording", journal);
    } catch {}
  }
  rpc("stop")
    .catch(() => {})
    .finally(() => {
      worker?.stdin.end();
      setTimeout(() => app.exit(0), 1000);
    });
});
