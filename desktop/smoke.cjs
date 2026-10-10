const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Store } = require("./storage.cjs");
const { BrowserWindow, dialog, screen } = require("electron");
const { spawn } = require("node:child_process");
const output = path.join(process.cwd(), "test-results");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(window, expression) {
  for (let i = 0; i < 30; i++) {
    if (await window.webContents.executeJavaScript(expression)) return true;
    await sleep(100);
  }
  return false;
}
async function injectActions(engineSpec, actions) {
  const child = spawn(engineSpec.command, engineSpec.args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.stdin.end();
      reject(new Error("Native injector timed out"));
    }, 3000);
    require("node:readline")
      .createInterface({ input: child.stdout })
      .on("line", (line) => {
        const data = JSON.parse(line);
        if (data.error || data.event === "error") {
          clearTimeout(timer);
          child.stdin.end();
          reject(new Error(data.error || data.message));
        }
        if (data.event === "completed") {
          clearTimeout(timer);
          child.stdin.end();
          resolve();
        }
      });
    child.stdin.write(
      JSON.stringify({
        id: 1,
        command: "play",
        payload: {
          macro: { version: 1, name: "Test injection", actions },
          countdown: 0,
          dryRun: false,
        },
      }) + "\n",
    );
  });
}
async function run(window, rpc, store, engineSpec) {
  const uiOnly = process.argv.includes("--smoke-ui");
  const results = [];
  const check = (name, value) => {
    assert.ok(value, name);
    results.push(name);
  };
  const cap = await rpc("capabilities");
  check("Native adapter initialized", cap.available);
  await sleep(500);
  check(
    "React editor rendered through isolated preload",
    await window.webContents.executeJavaScript(
      "document.querySelector('h1')?.textContent === 'My first workflow' && !!window.studio",
    ),
  );
  await window.webContents.executeJavaScript(
    "document.querySelector('.mode-switch button:last-child').click()",
  );
  check(
    "Advanced script tab available",
    await until(
      window,
      "Array.from(document.querySelectorAll('.tabs button')).some(b=>b.textContent.trim()==='Script')",
    ),
  );
  await window.webContents.executeJavaScript(
    "document.querySelector('[aria-label=\"Select action 1\"]').click();document.querySelector('[aria-label=\"Select action 3\"]').click();true",
  );
  check(
    "Multiple timeline actions selected",
    await until(
      window,
      "document.querySelector('.bulk-actions span').textContent==='2 selected'",
    ),
  );
  await window.webContents.executeJavaScript(
    "document.querySelector('.bulk-actions button').click();true",
  );
  check(
    "Batch deletion removes only checked actions",
    await until(
      window,
      "document.querySelectorAll('.action-row').length===2 && !document.querySelector('.action-row').textContent.includes('Move to')",
    ),
  );
  await window.webContents.executeJavaScript(
    "document.querySelector('.library-undo').click();true",
  );
  check(
    "Undo restores batch-deleted actions",
    await until(window, "document.querySelectorAll('.action-row').length===4"),
  );
  await window.webContents.executeJavaScript(
    "document.querySelector('.new-macro').click();true",
  );
  await until(window, "document.querySelectorAll('.macro-entry').length===2");
  await window.webContents.executeJavaScript(
    "document.querySelector('.new-macro').click();true",
  );
  await until(window, "document.querySelectorAll('.macro-entry').length===3");
  await window.webContents.executeJavaScript(
    "const checks=document.querySelectorAll('.macro-entry>input');checks[1].click();checks[2].click();true",
  );
  await until(
    window,
    "document.querySelector('.library-selection button').textContent.includes('2')",
  );
  await window.webContents.executeJavaScript(
    "document.querySelector('.library-selection button').click();true",
  );
  check(
    "Batch library deletion preserves unchecked macro",
    await until(
      window,
      "document.querySelectorAll('.macro-entry').length===1 && document.querySelector('h1').textContent==='My first workflow'",
    ),
  );
  check(
    "Batch edits autosave",
    await until(
      window,
      "document.querySelector('.panel-bottom').textContent.includes('All changes saved')",
    ),
  );
  check("Separate adjacent Dry run and Run macro buttons without checkbox", await window.webContents.executeJavaScript("(()=>{const dry=document.querySelector('.dry-run-button');const run=document.querySelector('.transport .play-button');return dry?.nextElementSibling===run&&dry.textContent.includes('Dry run')&&run.textContent.includes('Run macro')&&!Array.from(document.querySelectorAll('.toggle-label')).some(e=>e.textContent.includes('Dry run'))})()"));
  const compiled = await rpc("compile", {
    source: "repeat 2\nwait 0.02\nkey a\nend",
  });
  check("Script repeat compiled", compiled.length === 4);
  let invalid = false;
  try {
    await rpc("compile", { source: "import os" });
  } catch {
    invalid = true;
  }
  check("Invalid script rejected", invalid);
  const events = [];
  const listener = (_, e) => events.push(e);
  window.webContents.on("ipc-message", listener);
  // Observe worker events in renderer through the same production bridge.
  await window.webContents.executeJavaScript(
    "window.smokeEvents=[];window.studio.onEvent(e=>window.smokeEvents.push(e));true",
  );
  await rpc("play", {
    macro: { version: 1, name: "smoke", actions: compiled },
    dryRun: true,
    countdown: 0,
  });
  await sleep(250);
  check(
    "Dry playback completed with progress",
    await window.webContents.executeJavaScript(
      "window.smokeEvents.some(e=>e.event==='completed' && e.dryRun) && window.smokeEvents.filter(e=>e.event==='progress').length===4",
    ),
  );
  await rpc("play", {
    macro: {
      version: 1,
      name: "cancel",
      actions: [{ type: "wait", delay: 100000 }],
    },
    dryRun: true,
    countdown: 0,
  });
  await rpc("pause");
  await rpc("stop");
  await sleep(150);
  check(
    "Paused long wait stopped and returned idle",
    await window.webContents.executeJavaScript(
      "window.smokeEvents.some(e=>e.state==='paused') && window.smokeEvents.some(e=>e.event==='stopped') && window.smokeEvents.at(-1).state==='idle'",
    ),
  );
  const exportFile = path.join(output, "exported.json");
  const originalSave = dialog.showSaveDialog,
    originalOpen = dialog.showOpenDialog;
  dialog.showSaveDialog = async () => ({
    canceled: false,
    filePath: exportFile,
  });
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [exportFile],
  });
  try {
    check(
      "Macro export through trusted bridge",
      await window.webContents.executeJavaScript(
        "window.studio.exportMacro({version:1,id:'test-export',name:'Round trip',profile:'Tests',actions:[{type:'wait',delay:10}],script:''})",
      ),
    );
    check(
      "Macro import validates round trip",
      await window.webContents.executeJavaScript(
        "window.studio.importMacro().then(m=>m.name==='Round trip' && m.actions[0].delay===10)",
      ),
    );
  } finally {
    dialog.showSaveDialog = originalSave;
    dialog.showOpenDialog = originalOpen;
  }
  const recovery = {
    version: 1,
    id: "recovery-test",
    name: "Interrupted session",
    profile: "Tests",
    actions: [{ type: "key_down", key: "a", delay: 0 }],
    script: "",
  };
  store.write("recording", { macro: recovery });
  check(
    "Interrupted recording restored as a separate macro",
    await window.webContents.executeJavaScript(
      "window.studio.load().then(d=>d.recovered && d.library.macros.some(m=>m.name.endsWith('(recovered)')))",
    ),
  );
  check(
    "Recovery journal cleared after persistent recovery",
    store.read("recording", null) === null,
  );
  // Real input goes only to a purpose-built disposable target, never the editor.
  if (!uiOnly) {
    const target = new BrowserWindow({
      x: 200,
      y: 150,
      width: 600,
      height: 420,
      show: true,
      title: "Macro Studio — isolated input test",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    try {
      await target.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            '<!doctype html><title>Macro input test</title><body style="font:20px sans-serif;padding:25px"><h2>Isolated macro test</h2><p>Native input is directed to this disposable window.</p><textarea id="target" style="width:480px;height:150px"></textarea><script>window.clicks=0;window.wheels=0;document.addEventListener("click",()=>window.clicks++);document.addEventListener("wheel",()=>window.wheels++)</script>',
          ),
      );
      target.show();
      target.setAlwaysOnTop(true);
      target.focus();
      await sleep(300);
      check("Disposable native input target has focus", target.isFocused());
      const bounds = target.getContentBounds();
      const scale = screen.getPrimaryDisplay().scaleFactor;
      const point = await target.webContents.executeJavaScript(
        "(()=>{const r=document.querySelector('textarea').getBoundingClientRect();return {x:r.x+40,y:r.y+30}})()",
      );
      const x = Math.round((bounds.x + point.x) * scale),
        y = Math.round((bounds.y + point.y) * scale);
      const native = [
        { type: "move", x, y, delay: 0 },
        { type: "click", button: "left", delay: 30 },
        { type: "text", text: "macro-test", delay: 30 },
      ];
      await rpc("play", {
        macro: { version: 1, name: "Native target", actions: native },
        dryRun: false,
        countdown: 0,
      });
      const nativeReached = await until(
        target,
        "document.querySelector('textarea').value==='macro-test' && window.clicks>=1",
      );
      if (!nativeReached)
        console.error(
          "Native target diagnostics",
          {
            bounds,
            scale,
            x,
            y,
            pointer: screen.getCursorScreenPoint(),
            focused: target.isFocused(),
          },
          await target.webContents.executeJavaScript(
            "({value:document.querySelector('textarea').value,clicks:window.clicks})",
          ),
          await window.webContents.executeJavaScript(
            "window.smokeEvents.slice(-8)",
          ),
        );
      check(
        "Native movement, click and keyboard playback reached target",
        nativeReached,
      );
      await until(window, "window.smokeEvents.at(-1)?.state==='idle'");
      await window.webContents.executeJavaScript("window.smokeEvents=[];true");
      await rpc("record", { countdown: 0 });
      check(
        "Recorder enters explicit recording state",
        await until(
          window,
          "window.smokeEvents.some(e=>e.state==='recording')",
        ),
      );
      check("Native recording target remains focused", target.isFocused());
      // Movement-only test: clicks/scroll must not supply substitute coordinates.
      const pathPoints = [
        { type: "move", x: x + 20, y: y + 20, delay: 60 },
        { type: "move", x: x + 60, y: y + 40, delay: 60 },
        { type: "move", x: x + 100, y: y + 60, delay: 60 },
      ];
      await injectActions(engineSpec, pathPoints);
      check("Movement alone streams all path points without clicks", await until(window,
        `window.smokeEvents.filter(e=>e.event==='record_action').map(e=>e.action).filter(a=>a.type==='move').some(a=>a.x===${x+100}&&a.y===${y+60})`));
      await rpc("stop");
      await until(window, "window.smokeEvents.at(-1)?.state==='idle'");
      const moveOnly = await window.webContents.executeJavaScript("window.smokeEvents.find(e=>e.event==='record_complete').actions");
      check("Movement-only recording retains each spaced path point", pathPoints.every(p=>moveOnly.some(a=>a.type==='move'&&a.x===p.x&&a.y===p.y)));
      await rpc("play", {macro:{version:1,name:"Recorded movement only",actions:moveOnly},dryRun:false,countdown:0});
      await until(window, "window.smokeEvents.at(-1)?.state==='idle'");
      const pointer=screen.getCursorScreenPoint();
      check("Recorded movement-only playback reaches final position", Math.abs(pointer.x*scale-(x+100))<=2&&Math.abs(pointer.y*scale-(y+60))<=2);
      await window.webContents.executeJavaScript("window.smokeEvents=[];true");
      await rpc("record", {countdown:0});
      await until(window,"window.smokeEvents.some(e=>e.state==='recording')");
      const inject = spawn(engineSpec.command, engineSpec.args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const injectionActions = [
        { type: "move", x: x + 8, y: y + 8, delay: 50 },
        { type: "click", button: "left", delay: 50 },
        { type: "key", key: "z", delay: 50 },
        { type: "scroll", dx: 0, dy: -1, delay: 50 },
      ];
      await new Promise((resolve, reject) => {
        inject.on("error", reject);
        const timer = setTimeout(() => {
          inject.stdin.end();
          reject(new Error("Native injector timed out"));
        }, 3000);
        require("node:readline")
          .createInterface({ input: inject.stdout })
          .on("line", (line) => {
            const data = JSON.parse(line);
            if (data.error || data.event === "error") {
              clearTimeout(timer);
              inject.stdin.end();
              reject(new Error(data.error || data.message));
            }
            if (data.event === "completed") {
              clearTimeout(timer);
              inject.stdin.end();
              resolve();
            }
          });
        inject.stdin.write(
          JSON.stringify({
            id: 1,
            command: "play",
            payload: {
              macro: {
                version: 1,
                name: "Test injection",
                actions: injectionActions,
              },
              countdown: 0,
              dryRun: false,
            },
          }) + "\n",
        );
      });
      await sleep(150);
      await rpc("stop");
      check(
        "Recording completes on explicit stop",
        await until(
          window,
          "window.smokeEvents.some(e=>e.event==='record_complete')",
        ),
      );
      const recorded = await window.webContents.executeJavaScript(
        "window.smokeEvents.find(e=>e.event==='record_complete').actions",
      );
      check(
        "Native recorder captures movement, buttons, wheel and keyboard",
        [
          "move",
          "button_down",
          "button_up",
          "scroll",
          "key_down",
          "key_up",
        ].every((t) => recorded.some((a) => a.type === t)),
      );
      await rpc("validate", {
        version: 1,
        name: "Recorded test",
        actions: recorded,
      });
      check("Recorded macro passes engine validation", true);
      await until(window, "window.smokeEvents.at(-1)?.state==='idle'");
      await window.webContents.executeJavaScript("window.smokeEvents=[];true");
      await rpc("play", {
        macro: {
          version: 1,
          name: "Hotkey target",
          actions: [{ type: "wait", delay: 100000 }],
        },
        dryRun: false,
        countdown: 0,
      });
      await injectActions(engineSpec, [
        { type: "key", key: "f8", delay: 50 },
        { type: "key", key: "f9", delay: 120 },
      ]);
      check(
        "Global F8 pauses native playback",
        await until(window, "window.smokeEvents.some(e=>e.state==='paused')"),
      );
      check(
        "Global F9 stops native playback",
        await until(
          window,
          "window.smokeEvents.some(e=>e.event==='stopped') && window.smokeEvents.at(-1)?.state==='idle'",
        ),
      );
    } finally {
      await rpc("stop").catch(() => {});
      target.destroy();
    }
  }
  const temp = new Store(path.join(output, "storage-test"));
  temp.write("sample", { n: 1 });
  temp.write("sample", { n: 2 });
  check("Atomic store preserves latest", temp.read("sample", null).n === 2);
  fs.writeFileSync(temp.file("sample"), "corrupt");
  check("Corrupt store recovers backup", temp.read("sample", null).n === 1);
  await window.webContents.executeJavaScript(
    "window.smokeEvents=[];const select=document.querySelector('[aria-label=\"Execution mode\"]');select.value='loop';select.dispatchEvent(new Event('change',{bubbles:true}));true",
  );
  check(
    "Loop mode reveals continuous playback option",
    await until(
      window,
      "!!document.querySelector('[aria-label=\"Loop until stopped\"]')",
    ),
  );
  await window.webContents.executeJavaScript(
    "document.querySelector('[aria-label=\"Loop until stopped\"]').click();const delay=document.querySelector('[aria-label=\"Start delay\"]');delay.value='0';delay.dispatchEvent(new Event('change',{bubbles:true}));true",
  );
  await until(
    window,
    "document.querySelector('[aria-label=\"Loops\"]').disabled",
  );
  await window.webContents.executeJavaScript(
    "document.querySelector('.transport .dry-run-button').click();true",
  );
  check(
    "UI continuous loop repeats until stopped",
    await until(
      window,
      "window.smokeEvents.some(e=>e.event==='progress'&&e.loop>=2)",
    ),
  );
  await rpc("stop");
  await until(window, "window.smokeEvents.at(-1)?.state==='idle'");
  await window.webContents.executeJavaScript(
    "document.querySelector('.keybind-button').click();true",
  );
  check(
    "Keybind editor opens",
    await until(window, "!!document.querySelector('.keybind-dialog')"),
  );
  await window.webContents.executeJavaScript(
    "['record','play','pause','stop'].forEach((action,i)=>document.querySelector('[aria-label=\"'+action+' keybind\"]').dispatchEvent(new KeyboardEvent('keydown',{key:['F10','F11','F14','F15'][i],code:['F10','F11','F14','F15'][i],bubbles:true})));true",
  );
  await until(
    window,
    "document.querySelector('[aria-label=\"stop keybind\"]').value==='F15'",
  );
  await window.webContents.executeJavaScript(
    "document.querySelector('.keybind-dialog .play-button').click();true",
  );
  check(
    "Custom keybinds saved from UI",
    await until(
      window,
      "!document.querySelector('.keybind-dialog') && document.querySelector('.transport-note').textContent.includes('F15')",
    ),
  );
  check(
    "Keybind settings persist to disk",
    store.read("preferences", {}).bindings?.stop === "F15",
  );
  check(
    "Duplicate keybinds rejected without altering saved settings",
    await window.webContents.executeJavaScript(
      "window.studio.saveKeybinds({record:'F10',play:'F10',pause:'F14',stop:'F15'}).then(()=>false,()=>window.studio.load().then(d=>d.bindings.stop==='F15'))",
    ),
  );
  if (!uiOnly) {
    await window.webContents.executeJavaScript("window.smokeEvents=[];true");
    await rpc("play", {
      macro: {
        version: 1,
        name: "Custom stop test",
        actions: [{ type: "wait", delay: 100000 }],
      },
      dryRun: true,
      countdown: 0,
    });
    await injectActions(engineSpec, [
      { type: "key", key: "f14", delay: 40 },
      { type: "key", key: "f15", delay: 100 },
    ]);
    check(
      "Custom global pause keybind delivered",
      await until(window, "window.smokeEvents.some(e=>e.state==='paused')"),
    );
    check(
      "Custom global stop keybind delivered",
      await until(
        window,
        "window.smokeEvents.some(e=>e.event==='stopped') && window.smokeEvents.at(-1)?.state==='idle'",
      ),
    );
  }
  // This isolated test profile is reset on launch; no default-key registration
  // is needed at shutdown (a separate running app may own these keys).
  if (process.argv.includes("--smoke-screenshot")) { window.show(); await sleep(500); }
  const image = await window.webContents.capturePage();
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "desktop.png"), image.toPNG());
  if (process.argv.includes("--smoke-screenshot")) {
    window.setSize(1080, 760); await sleep(400);
    check("Compact desktop layout has no horizontal overflow", await window.webContents.executeJavaScript("document.documentElement.scrollWidth<=window.innerWidth"));
    const compact=await window.webContents.capturePage();
    fs.writeFileSync(path.join(output, "desktop-compact.png"), compact.toPNG());
  }

  fs.writeFileSync(
    path.join(output, "desktop-smoke.json"),
    JSON.stringify(
      {
        passed: results,
        capabilities: cap,
        skipped: uiOnly
          ? ["Native input delivery and global key delivery (--smoke-ui)"]
          : [],
      },
      null,
      2,
    ),
  );
}
module.exports = { run };
