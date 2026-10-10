import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Code2,
  Copy,
  Download,
  Folder,
  Keyboard,
  Layers3,
  List,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  Action,
  Macro,
  Capabilities,
  StudioEvent,
  starter,
  blank,
  describe,
  freshAction,
  Bindings,
  Shortcut,
  defaultBindings,
} from "./model";
import KeybindDialog from "./KeybindDialog";

const bridge = window.studio;
type Log = { time: string; message: string; error?: boolean };
export default function App() {
  const [macros, setMacros] = useState<Macro[]>([]),
    [id, setId] = useState("welcome");
  const [ready, setReady] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [tab, setTab] = useState("timeline");
  const [state, setState] = useState(bridge ? "idle" : "preview"),
    [saved, setSaved] = useState("Loading library…");
  const [cap, setCap] = useState<Capabilities>({
    available: false,
    message: "Checking input permissions…",
    platform: "Desktop",
  });
  const [logs, setLogs] = useState<Log[]>([]),
    [showLogs, setShowLogs] = useState(false),
    [modal, setModal] = useState(false),
    [consent, setConsent] = useState(false);
  const [speed, setSpeed] = useState(1),
    [loops, setLoops] = useState(1),
    [countdown, setCountdown] = useState(3);
  const [playMode, setPlayMode] = useState<"once" | "loop">("once"),
    [continuous, setContinuous] = useState(false);
  const [checkedActions, setCheckedActions] = useState<number[]>([]),
    [checkedMacros, setCheckedMacros] = useState<string[]>([]);
  const [bindings, setBindings] = useState<Bindings>(defaultBindings),
    [keybindDialog, setKeybindDialog] = useState(false);
  const [selected, setSelected] = useState<number | null>(null),
    [search, setSearch] = useState(""),
    [profile, setProfile] = useState("All profiles");
  const [progress, setProgress] = useState({ index: 0, loop: 0 }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]),
    [history, setHistory] = useState<Macro[][]>([]);
  const [adding, setAdding] = useState(false),
    [pending, setPending] = useState(false);
  const [conditionText, setConditionText] = useState("");
  const [page, setPage] = useState(0);
  const macrosRef = useRef(macros),
    idRef = useRef(id),
    stateRef = useRef(state),
    dirty = useRef(false),
    activeRecord = useRef<string | null>(null),
    saveQueue = useRef(Promise.resolve());
  macrosRef.current = macros;
  idRef.current = id;
  stateRef.current = state;
  const macro = macros.find((m) => m.id === id) ?? macros[0];
  const busy = !["idle", "preview", "offline"].includes(state) || pending;
  const pageCount = Math.max(1, Math.ceil((macro?.actions.length || 0) / 100));
  const visiblePage = ["recording", "recording_paused"].includes(state)
    ? pageCount - 1
    : Math.min(page, pageCount - 1);
  const pageStart = visiblePage * 100;
  useEffect(() => {
    setPage(selected === null ? 0 : Math.floor(selected / 100));
  }, [selected, id]);
  const log = useCallback(
    (message: string, error = false) =>
      setLogs((old) =>
        [
          { time: new Date().toLocaleTimeString(), message, error },
          ...old,
        ].slice(0, 150),
      ),
    [],
  );
  const fail = useCallback(
    (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      log(message, true);
    },
    [log],
  );
  const commit = useCallback((next: Macro[]) => {
    const previous = structuredClone(macrosRef.current);
    setHistory((old) => [...old.slice(-29), previous]);
    macrosRef.current = next;
    setMacros(next);
    setCheckedMacros((old) =>
      old.filter((id) => next.some((m) => m.id === id)),
    );
    dirty.current = true;
    setSaved("Unsaved changes");
    setError("");
  }, []);
  const update = (changes: Partial<Macro>) => {
    if (changes.actions) setCheckedActions([]);
    commit(macros.map((m) => (m.id === macro.id ? { ...m, ...changes } : m)));
  };
  const save = useCallback(async () => {
    if (!dirty.current) return;
    const snapshot = structuredClone(macrosRef.current);
    const operation = saveQueue.current
      .catch(() => {})
      .then(async () => {
        if (bridge) await bridge.save({ macros: snapshot });
        else
          localStorage.setItem(
            "macro-studio-preview",
            JSON.stringify(snapshot),
          );
        if (JSON.stringify(macrosRef.current) === JSON.stringify(snapshot)) {
          dirty.current = false;
          setSaved(bridge ? "All changes saved" : "Preview saved locally");
        }
      });
    saveQueue.current = operation;
    await operation;
  }, []);
  useEffect(() => {
    (async () => {
      try {
        if (bridge) {
          const data = await bridge.load();
          setCap(data.capabilities);
          setShortcuts(data.shortcuts);
          setBindings(data.bindings);
          setState(data.state);
          const list = data.library.macros.length
            ? data.library.macros
            : [structuredClone(starter)];
          setMacros(list);
          macrosRef.current = list;
          setId(list[0].id);
          if (data.recovered)
            setNotice(
              "A recording was recovered after an interrupted session. It is saved in your library.",
            );
          if (!data.library.macros.length) dirty.current = true;
        } else {
          const list = JSON.parse(
            localStorage.getItem("macro-studio-preview") || "null",
          ) || [structuredClone(starter)];
          setMacros(list);
          macrosRef.current = list;
          setId(list[0].id);
          setCap({
            available: false,
            platform: "Browser preview",
            message:
              "Open the desktop app to use native recording, playback and global hotkeys.",
          });
        }
        setSaved("All changes saved");
        setReady(true);
      } catch (e) {
        fail(e);
        setReady(true);
      }
    })();
  }, [fail]);
  useEffect(() => {
    if (!ready || busy) return;
    const timer = setTimeout(() => save().catch(fail), 700);
    return () => clearTimeout(timer);
  }, [macros, ready, busy, save, fail]);
  const performRef = useRef<(cmd: string) => void>(() => {});
  useEffect(
    () =>
      bridge?.onEvent((e: StudioEvent) => {
        if (e.event === "request_close") {
          void (async () => {
            try {
              await bridge!.command("stop");
              for (
                let i = 0;
                i < 60 && !["idle", "offline"].includes(stateRef.current);
                i++
              )
                await new Promise((r) => setTimeout(r, 50));
              await save();
              await bridge!.closeReady(true);
            } catch (error) {
              fail(error);
              await bridge!.closeReady(false);
            }
          })();
        }
        if (e.event === "state" && e.state) {
          stateRef.current = e.state;
          setState(e.state);
          log(`Engine ${e.state.replace("_", " ")}`);
        }
        if (e.event === "error") fail(e.message);
        if (e.event === "progress")
          setProgress({ index: e.index || 0, loop: e.loop || 0 });
        if (e.event === "hotkey") performRef.current(String(e.action));
        if (
          e.event === "record_action" &&
          typeof e.action === "object" &&
          activeRecord.current
        ) {
          const action = e.action;
          setMacros((old) => {
            const next = old.map((m) =>
              m.id === activeRecord.current
                ? { ...m, actions: [...m.actions, action] }
                : m,
            );
            macrosRef.current = next;
            return next;
          });
        }
        if (e.event === "record_complete" && activeRecord.current) {
          const target = activeRecord.current;
          activeRecord.current = null;
          setMacros((old) => {
            const next = old.map((m) =>
              m.id === target ? { ...m, actions: e.actions || [] } : m,
            );
            macrosRef.current = next;
            return next;
          });
          dirty.current = false;
          setSaved("Recording saved");
          log(`Recording captured ${e.actions?.length || 0} actions`);
        }
        if (e.event === "completed")
          log(
            e.dryRun
              ? "Dry run completed. No input was sent."
              : "Playback completed",
          );
        if (e.event === "stopped") log(e.message || "Stopped");
      }),
    [log, fail, save],
  );
  useEffect(() => {
    setSelected(null);
    setCheckedActions([]);
    setError("");
  }, [id]);
  useEffect(() => {
    if (selected !== null && macro?.actions[selected]?.type === "if_cursor")
      setConditionText(
        JSON.stringify(macro.actions[selected].actions, null, 2),
      );
  }, [selected, id]);
  async function runCommand(command: string, dryRun = false) {
    if (!bridge) {
      setNotice(
        "Native automation is available in the desktop app. This browser is an editor preview.",
      );
      return;
    }
    if (
      (command === "record" || command === "play") &&
      (!macro || keybindDialog)
    )
      return;
    if (command === "play" && modal) return;
    if (command === "record") {
      if (
        stateRef.current === "recording" ||
        stateRef.current === "recording_paused" ||
        stateRef.current === "arming"
      ) {
        await bridge.command("stop").catch(fail);
        return;
      }
      if (stateRef.current !== "idle") return;
      setConsent(false);
      setModal(true);
      return;
    }
    if (command === "play") {
      if (stateRef.current !== "idle") return;
      setPending(true);
      try {
        if (
          playMode === "loop" &&
          !continuous &&
          (!Number.isInteger(loops) || loops < 1 || loops > 1000)
        )
          throw new Error(
            "Set loop repetitions between 1 and 1000, or choose Repeat until stopped.",
          );
        await save();
        setError("");
        setProgress({ index: 0, loop: 0 });
        const m = macrosRef.current.find((m) => m.id === idRef.current);
        await bridge.command("play", {
          macro: m,
          speed,
          loops: playMode === "once" ? 1 : continuous ? 0 : loops,
          countdown,
          dryRun,
        });
      } catch (e) {
        fail(e);
      } finally {
        setPending(false);
      }
    } else {
      await bridge.command(command).catch(fail);
    }
  }
  performRef.current = (cmd) => {
    void runCommand(cmd);
  };
  async function startRecord() {
    if (!bridge || !consent) return;
    setModal(false);
    setPending(true);
    try {
      await save();
      const previous = structuredClone(macrosRef.current);
      setHistory((old) => [...old.slice(-29), previous]);
      activeRecord.current = macro.id;
      const recordingMacro = { ...macro, actions: [] };
      setMacros((old) =>
        old.map((m) => (m.id === macro.id ? recordingMacro : m)),
      );
      await bridge.command("record", { macro: recordingMacro, countdown });
      setSelected(null);
      setCheckedActions([]);
      setTab("timeline");
      setError("");
    } catch (e) {
      activeRecord.current = null;
      setMacros((old) => old.map((m) => (m.id === macro.id ? macro : m)));
      fail(e);
    } finally {
      setPending(false);
    }
  }
  async function importMacro() {
    if (!bridge) {
      setNotice("Use Import in the desktop app to select a JSON file.");
      return;
    }
    try {
      const m = await bridge.importMacro();
      if (m) {
        commit([...macros, m]);
        setId(m.id);
        log("Macro imported and validated");
      }
    } catch (e) {
      fail(e);
    }
  }
  async function compile() {
    try {
      const actions = (await bridge?.command("compile", {
        source: macro.script,
      })) as Action[] | undefined;
      if (!actions) throw new Error("Compile scripts in the desktop app.");
      update({ actions });
      setTab("timeline");
      setSelected(null);
      log(`Compiled ${actions.length} actions`);
    } catch (e) {
      fail(e);
    }
  }
  const changeAction = (changes: Partial<Action>) => {
    if (selected === null) return;
    update({
      actions: macro.actions.map((a, i) =>
        i === selected ? { ...a, ...changes } : a,
      ),
    });
  };
  function deleteCheckedActions() {
    update({
      actions: macro.actions.filter((_, i) => !checkedActions.includes(i)),
    });
    setCheckedActions([]);
    setSelected(null);
  }
  function deleteCheckedMacros() {
    commit(macros.filter((m) => !checkedMacros.includes(m.id)));
    if (checkedMacros.includes(id))
      setId(macros.find((m) => !checkedMacros.includes(m.id))?.id || "");
    setCheckedMacros([]);
  }
  async function saveKeybinds(next: Bindings) {
    if (!bridge) throw new Error("Change global keybinds in the desktop app.");
    const result = await bridge.saveKeybinds(next);
    setBindings(result.bindings);
    setShortcuts(result.shortcuts);
    log("Application keybinds saved");
  }
  async function openKeybinds() {
    try {
      if (bridge) await bridge.editKeybinds(true);
      setKeybindDialog(true);
    } catch (e) {
      fail(e);
    }
  }
  async function closeKeybinds() {
    try {
      if (bridge) setShortcuts(await bridge.editKeybinds(false));
    } catch (e) {
      fail(e);
    } finally {
      setKeybindDialog(false);
    }
  }
  function undo() {
    const old = history[history.length - 1];
    if (!old) return;
    setMacros(old);
    macrosRef.current = old;
    setHistory(history.slice(0, -1));
    if (!old.some((m) => m.id === id)) setId(old[0]?.id || "");
    dirty.current = true;
    setSaved("Unsaved changes");
    setSelected(null);
    setCheckedActions([]);
    setCheckedMacros([]);
  }
  const addAction = (type: string) => {
    update({ actions: [...macro.actions, freshAction(type)] });
    setSelected(macro.actions.length);
    setAdding(false);
  };
  const moveAction = (offset: number) => {
    if (selected === null) return;
    const destination = selected + offset;
    if (destination < 0 || destination >= macro.actions.length) return;
    const a = [...macro.actions];
    [a[selected], a[destination]] = [a[destination], a[selected]];
    update({ actions: a });
    setSelected(destination);
  };
  const action = selected === null ? undefined : macro?.actions[selected];
  const elapsed = macro?.actions.reduce((sum, a) => sum + a.delay, 0) || 0;
  const profiles = [...new Set(macros.map((m) => m.profile))];
  if (!ready) return <div className="loading">Opening your workspace…</div>;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Layers3 size={23} />
          </div>
          <div>
            Macro Studio<small>YOUR WORK, ON REPEAT</small>
          </div>
        </div>
        <button
          className="new-macro"
          disabled={busy}
          onClick={() => {
            const m = blank();
            commit([...macros, m]);
            setId(m.id);
          }}
        >
          <Plus size={17} /> New macro
        </button>
        <div className="nav-label">WORKSPACE</div>
        <div className="nav-item active">
          <Folder size={17} /> Macro library <span>{macros.length}</span>
        </div>
        <div className="search">
          <Search size={16} />
          <input
            aria-label="Search macros"
            placeholder="Find a macro…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter profiles"
          className="profile-filter"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
        >
          <option>All profiles</option>
          {profiles.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <div className="macro-list">
          {macros
            .filter(
              (m) =>
                m.name.toLowerCase().includes(search.toLowerCase()) &&
                (profile === "All profiles" || profile === m.profile),
            )
            .map((m) => (
              <div className="macro-entry" key={m.id}>
                <input
                  type="checkbox"
                  aria-label={`Select macro ${m.name}`}
                  disabled={busy}
                  checked={checkedMacros.includes(m.id)}
                  onChange={(e) =>
                    setCheckedMacros((old) =>
                      e.target.checked
                        ? [...old, m.id]
                        : old.filter((id) => id !== m.id),
                    )
                  }
                />
                <button
                  disabled={busy}
                  className={`macro-card ${macro?.id === m.id ? "selected" : ""}`}
                  onClick={() => setId(m.id)}
                >
                  <span className="macro-card-icon">
                    <List size={17} />
                  </span>
                  <span>
                    <strong>{m.name}</strong>
                    <small>
                      {m.actions.length} actions · {m.profile}
                    </small>
                  </span>
                  {macro?.id === m.id && <ChevronRight size={16} />}
                </button>
              </div>
            ))}
        </div>
        {macros.length > 0 && (
          <div className="library-selection">
            <label>
              <input
                type="checkbox"
                aria-label="Select all macros"
                disabled={busy}
                checked={checkedMacros.length === macros.length}
                onChange={(e) =>
                  setCheckedMacros(
                    e.target.checked ? macros.map((m) => m.id) : [],
                  )
                }
              />{" "}
              All macros
            </label>
            <button
              disabled={busy || !checkedMacros.length}
              onClick={deleteCheckedMacros}
            >
              <Trash2 size={13} /> Delete {checkedMacros.length || ""}
            </button>
          </div>
        )}
        <div className="library-tools">
          <button disabled={busy} onClick={importMacro}>
            <Upload size={15} /> Import
          </button>
          <button
            disabled={busy || !macro}
            onClick={() =>
              bridge
                ? bridge
                    .exportMacro(macro)
                    .then((done) => done && log("Macro exported"))
                    .catch(fail)
                : setNotice("Export is available in the desktop app.")
            }
          >
            <Download size={15} /> Export
          </button>
        </div>
        {history.length > 0 && (
          <button className="library-undo" disabled={busy} onClick={undo}>
            <Undo2 size={13} /> Undo last change
          </button>
        )}
        <div className="sidebar-foot">
          <ShieldCheck size={19} />
          <div>
            Local by design<small>Your macros stay on this device.</small>
          </div>
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} /> <strong>Macro editor</strong>
          </div>
          <div className="header-tools">
            <button
              className="keybind-button"
              disabled={busy}
              onClick={openKeybinds}
            >
              <Keyboard size={15} /> Keybinds
            </button>
            <div className="mode-switch">
              <button
                className={!advanced ? "chosen" : ""}
                onClick={() => {
                  setAdvanced(false);
                  setTab("timeline");
                }}
              >
                Beginner
              </button>
              <button
                className={advanced ? "chosen" : ""}
                onClick={() => setAdvanced(true)}
              >
                <Code2 size={14} /> Advanced
              </button>
            </div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">MAKE THE REPETITIVE, EFFORTLESS</div>
              <h1>{macro?.name || "Your macro library"}</h1>
              <p>Capture a workflow. Make it yours. Run it with confidence.</p>
            </div>
            <div
              className={`status-badge ${state === "recording" ? "recording" : ""}`}
            >
              <span />
              {state === "preview" ? "Editor preview" : state.replace("_", " ")}
            </div>
          </div>
          {notice && (
            <div className="notice">
              <ShieldCheck size={17} />
              {notice}
              <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {!macro ? (
            <div className="empty">
              Your library is empty. Create a macro to begin.
            </div>
          ) : (
            <>
              <section className="transport">
                <div className="transport-main">
                  <button
                    className="record-button"
                    disabled={
                      pending ||
                      !cap.available ||
                      (busy &&
                        !["recording", "recording_paused", "arming"].includes(
                          state,
                        ))
                    }
                    onClick={() => runCommand("record")}
                  >
                    <Circle size={16} />
                    {["recording", "recording_paused", "arming"].includes(state)
                      ? "Finish recording"
                      : "Record workflow"}
                  </button>
                  <button
                    className="dry-run-button"
                    disabled={pending || busy || !bridge || !macro.actions.length}
                    title="Test timing without sending mouse or keyboard input"
                    onClick={() => runCommand("play", true)}
                  >
                    <Play size={16} /> Dry run
                  </button>
                  <button
                    className="play-button"
                    disabled={pending || busy || !bridge || !cap.available || !macro.actions.length}
                    title="Send mouse and keyboard input to the active desktop"
                    onClick={() => runCommand("play", false)}
                  >
                    <Play size={16} fill="currentColor" /> Run macro
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Pause or resume"
                    disabled={
                      ![
                        "playing",
                        "paused",
                        "recording",
                        "recording_paused",
                      ].includes(state)
                    }
                    onClick={() => runCommand("pause")}
                  >
                    {state.endsWith("paused") || state === "paused" ? (
                      <Play size={17} />
                    ) : (
                      <Pause size={17} />
                    )}
                  </button>
                  <button
                    className="stop-button"
                    disabled={!busy}
                    onClick={() => runCommand("stop")}
                  >
                    <Square size={14} fill="currentColor" /> Stop
                  </button>
                </div>
                <div className="transport-note">
                  <Keyboard size={16} />
                  <span>
                    {bindings.record} record · {bindings.play} run ·{" "}
                    {bindings.pause} pause · {bindings.stop} stop
                  </span>
                </div>
              </section>
              <div className="editor-grid">
                <section className="timeline-panel">
                  <div className="panel-top">
                    <div className="tabs">
                      <button
                        className={tab === "timeline" ? "active" : ""}
                        onClick={() => setTab("timeline")}
                      >
                        <List size={16} /> Timeline{" "}
                        <span>{macro.actions.length}</span>
                      </button>
                      {advanced && (
                        <button
                          className={tab === "script" ? "active" : ""}
                          onClick={() => setTab("script")}
                        >
                          <Code2 size={16} /> Script
                        </button>
                      )}
                    </div>
                    <button
                      className="undo"
                      disabled={busy || !history.length}
                      onClick={undo}
                    >
                      <Undo2 size={15} /> Undo
                    </button>
                  </div>
                  {tab === "script" ? (
                    <div className="script-panel">
                      <div className="script-caption">
                        <span>Automation language</span>
                        <button disabled={busy || !bridge} onClick={compile}>
                          <Check size={15} /> Compile to timeline
                        </button>
                      </div>
                      <div className="code-editor">
                        <div className="line-numbers">
                          {macro.script.split("\n").map((_, i) => (
                            <div key={i}>{i + 1}</div>
                          ))}
                        </div>
                        <textarea
                          aria-label="Automation script"
                          spellCheck={false}
                          disabled={busy}
                          value={macro.script}
                          onChange={(e) => update({ script: e.target.value })}
                        />
                      </div>
                      <p className="script-help">
                        Commands: <code>move x y</code> ·{" "}
                        <code>click left</code> · <code>type "text"</code> ·{" "}
                        <code>key enter</code> · <code>wait seconds</code> ·{" "}
                        <code>scroll dx dy</code> · <code>key_down ctrl</code> /{" "}
                        <code>key_up ctrl</code>
                        <br />
                        <code>repeat 3</code> or{" "}
                        <code>if_cursor x y tolerance</code> … <code>end</code>.
                        Compile explicitly; Run uses the timeline.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="timeline-columns">
                        <span>ACTION</span>
                        <span>DELAY BEFORE</span>
                      </div>
                      {macro.actions.length > 0 && (
                        <div className="bulk-actions">
                          <label>
                            <input
                              type="checkbox"
                              aria-label="Select all actions"
                              disabled={busy}
                              checked={
                                checkedActions.length === macro.actions.length
                              }
                              onChange={(e) =>
                                setCheckedActions(
                                  e.target.checked
                                    ? macro.actions.map((_, i) => i)
                                    : [],
                                )
                              }
                            />{" "}
                            Select all
                          </label>
                          <span>{checkedActions.length} selected</span>
                          <button
                            disabled={busy || !checkedActions.length}
                            onClick={deleteCheckedActions}
                          >
                            <Trash2 size={14} /> Delete selected
                          </button>
                          <button
                            disabled={busy || !checkedActions.length}
                            onClick={() => setCheckedActions([])}
                          >
                            Clear
                          </button>
                        </div>
                      )}
                      <div
                        className="actions"
                        role="group"
                        aria-label="Macro actions"
                      >
                        {macro.actions.length === 0 ? (
                          <div className="empty">
                            <MousePointer2 size={30} />
                            <h3>Your workflow starts here</h3>
                            <p>
                              Record your mouse and keyboard, or add your first
                              action.
                            </p>
                          </div>
                        ) : (
                          macro.actions
                            .slice(pageStart, pageStart + 100)
                            .map((a, offset) => {
                              const i = pageStart + offset;
                              return (
                                <div
                                  key={i}
                                  className={`action-row ${selected === i ? "selected" : ""} ${state === "playing" && progress.index === i + 1 ? "executing" : ""}`}
                                >
                                  <input
                                    type="checkbox"
                                    aria-label={`Select action ${i + 1}`}
                                    disabled={busy}
                                    checked={checkedActions.includes(i)}
                                    onChange={(e) =>
                                      setCheckedActions((old) =>
                                        e.target.checked
                                          ? [...old, i]
                                          : old.filter((n) => n !== i),
                                      )
                                    }
                                  />
                                  <button
                                    className="action-main"
                                    disabled={busy}
                                    onClick={() => setSelected(i)}
                                  >
                                    <span className="step-number">
                                      {String(i + 1).padStart(2, "0")}
                                    </span>
                                    <span
                                      className={`action-icon ${a.type === "text" || a.type.startsWith("key") ? "keyboard" : ""}`}
                                    >
                                      {a.type === "text" ||
                                      a.type.startsWith("key") ? (
                                        <Keyboard size={17} />
                                      ) : a.type === "wait" ? (
                                        <Pause size={17} />
                                      ) : a.type === "if_cursor" ? (
                                        <Code2 size={17} />
                                      ) : (
                                        <MousePointer2 size={17} />
                                      )}
                                    </span>
                                    <span className="action-text">
                                      <strong>{describe(a)}</strong>
                                      <small>
                                        {a.type.replaceAll("_", " ")}
                                        {a.type === "text"
                                          ? " · plain text"
                                          : ""}
                                      </small>
                                    </span>
                                    <span className="delay-chip">
                                      {(a.delay / 1000).toFixed(2)} s
                                    </span>
                                  </button>
                                </div>
                              );
                            })
                        )}
                      </div>
                      {pageCount > 1 && (
                        <div className="pagination">
                          <button
                            disabled={busy || visiblePage === 0}
                            onClick={() => setPage(visiblePage - 1)}
                          >
                            Previous
                          </button>
                          <span>
                            Actions {pageStart + 1}–
                            {Math.min(pageStart + 100, macro.actions.length)} of{" "}
                            {macro.actions.length}
                          </span>
                          <button
                            disabled={busy || visiblePage >= pageCount - 1}
                            onClick={() => setPage(visiblePage + 1)}
                          >
                            Next
                          </button>
                        </div>
                      )}
                      <div className="add-row">
                        <button
                          disabled={busy || macro.actions.length >= 20000}
                          onClick={() => setAdding(!adding)}
                        >
                          <Plus size={17} /> Add action
                        </button>
                        <span>Click an action to edit its details</span>
                        {adding && (
                          <div className="add-menu">
                            {[
                              "move",
                              "click",
                              "text",
                              "key",
                              "wait",
                              "scroll",
                              ...(advanced
                                ? [
                                    "key_down",
                                    "key_up",
                                    "button_down",
                                    "button_up",
                                    "if_cursor",
                                  ]
                                : []),
                            ].map((t) => (
                              <button key={t} onClick={() => addAction(t)}>
                                {t.replaceAll("_", " ")}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  <div className="panel-bottom">
                    <span>
                      <CheckCircle2 size={14} />
                      {saved}
                    </span>
                    <span>
                      {(elapsed / 1000).toFixed(1)} s scheduled delays ·{" "}
                      {macro.actions.length} actions
                    </span>
                  </div>
                </section>
                <aside className="inspector">
                  <section className="settings-panel">
                    <h3>
                      <Settings2 size={17} /> Playback settings
                    </h3>
                    <label>
                      Execution mode
                      <select
                        aria-label="Execution mode"
                        disabled={busy}
                        value={playMode}
                        onChange={(e) =>
                          setPlayMode(e.target.value as "once" | "loop")
                        }
                      >
                        <option value="once">Run once</option>
                        <option value="loop">Loop</option>
                      </select>
                    </label>
                    {playMode === "loop" && (
                      <label className="toggle-label loop-toggle">
                        <input
                          type="checkbox"
                          aria-label="Loop until stopped"
                          disabled={busy}
                          checked={continuous}
                          onChange={(e) => setContinuous(e.target.checked)}
                        />
                        <span>
                          Repeat until stopped
                          <small>{bindings.stop} stops the loop</small>
                        </span>
                      </label>
                    )}
                    <label>
                      Speed<span>{speed}×</span>
                    </label>
                    <input
                      aria-label="Playback speed"
                      type="range"
                      min="0.1"
                      max="3"
                      step="0.1"
                      disabled={busy}
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                    />
                    <div className="range-label">
                      <span>Careful</span>
                      <span>Fast</span>
                    </div>
                    <div className="two-fields">
                      <label>
                        Loops
                        <input
                          aria-label="Loops"
                          type="number"
                          min="1"
                          max="1000"
                          disabled={busy || playMode === "once" || continuous}
                          value={playMode === "once" ? 1 : loops}
                          onChange={(e) => setLoops(Number(e.target.value))}
                        />
                      </label>
                      <label>
                        Start delay
                        <select
                          aria-label="Start delay"
                          disabled={busy}
                          value={countdown}
                          onChange={(e) => setCountdown(Number(e.target.value))}
                        >
                          {[0, 1, 3, 5, 10].map((n) => (
                            <option key={n} value={n}>
                              {n} seconds
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {busy && (
                      <p className="run-progress">
                        {state === "arming"
                          ? "Switch to your target window…"
                          : `Loop ${progress.loop || 1} · ${progress.index} actions completed`}
                      </p>
                    )}
                  </section>
                  {action && (
                    <section className="settings-panel action-editor">
                      <h3>Action {selected! + 1}</h3>
                      <label>
                        Delay before (ms)
                        <input
                          aria-label="Action delay"
                          type="number"
                          min="0"
                          max="3600000"
                          disabled={busy}
                          value={action.delay}
                          onChange={(e) =>
                            changeAction({ delay: Number(e.target.value) })
                          }
                        />
                      </label>
                      {["move", "if_cursor"].includes(action.type) && (
                        <div className="two-fields">
                          {(["x", "y"] as const).map((k) => (
                            <label key={k}>
                              {k.toUpperCase()}
                              <input
                                aria-label={`Action ${k}`}
                                type="number"
                                disabled={busy}
                                value={action[k]}
                                onChange={(e) =>
                                  changeAction({ [k]: Number(e.target.value) })
                                }
                              />
                            </label>
                          ))}
                        </div>
                      )}
                      {action.text !== undefined && (
                        <label>
                          Text
                          <textarea
                            aria-label="Action text"
                            disabled={busy}
                            value={action.text}
                            onChange={(e) =>
                              changeAction({ text: e.target.value })
                            }
                          />
                        </label>
                      )}
                      {action.key !== undefined && (
                        <label>
                          Key
                          <input
                            aria-label="Action key"
                            disabled={busy}
                            value={action.key}
                            onChange={(e) =>
                              changeAction({ key: e.target.value })
                            }
                          />
                        </label>
                      )}
                      {action.button && (
                        <label>
                          Button
                          <select
                            aria-label="Action button"
                            disabled={busy}
                            value={action.button}
                            onChange={(e) =>
                              changeAction({ button: e.target.value })
                            }
                          >
                            <option>left</option>
                            <option>right</option>
                            <option>middle</option>
                          </select>
                        </label>
                      )}
                      {action.type === "scroll" && (
                        <div className="two-fields">
                          {(["dx", "dy"] as const).map((k) => (
                            <label key={k}>
                              {k}
                              <input
                                aria-label={`Scroll ${k}`}
                                type="number"
                                disabled={busy}
                                value={action[k]}
                                onChange={(e) =>
                                  changeAction({ [k]: Number(e.target.value) })
                                }
                              />
                            </label>
                          ))}
                        </div>
                      )}
                      {action.type === "if_cursor" && (
                        <>
                          <label>
                            Tolerance (pixels)
                            <input
                              aria-label="Cursor tolerance"
                              type="number"
                              disabled={busy}
                              value={action.tolerance}
                              onChange={(e) =>
                                changeAction({
                                  tolerance: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            Nested actions (JSON)
                            <textarea
                              aria-label="Conditional actions"
                              disabled={busy}
                              value={conditionText}
                              onChange={(e) => setConditionText(e.target.value)}
                            />
                          </label>
                          <button
                            disabled={busy}
                            onClick={() => {
                              try {
                                const actions = JSON.parse(conditionText);
                                if (!Array.isArray(actions))
                                  throw new Error("Use an array of actions");
                                changeAction({ actions });
                              } catch (e) {
                                fail(e);
                              }
                            }}
                          >
                            Apply nested actions
                          </button>
                        </>
                      )}
                      <div className="action-tools">
                        <button
                          disabled={busy || selected === 0}
                          aria-label="Move action up"
                          onClick={() => moveAction(-1)}
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          disabled={
                            busy || selected === macro.actions.length - 1
                          }
                          aria-label="Move action down"
                          onClick={() => moveAction(1)}
                        >
                          <ArrowDown size={16} />
                        </button>
                        <button
                          disabled={busy}
                          aria-label="Duplicate action"
                          onClick={() => {
                            const a = [...macro.actions];
                            a.splice(selected! + 1, 0, structuredClone(action));
                            update({ actions: a });
                            setSelected(selected! + 1);
                          }}
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          disabled={busy}
                          aria-label="Delete action"
                          onClick={() => {
                            update({
                              actions: macro.actions.filter(
                                (_, i) => i !== selected,
                              ),
                            });
                            setSelected(null);
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </section>
                  )}
                  <section className="safety-card">
                    <div>
                      <ShieldCheck size={21} />
                      <h3>You're in control</h3>
                    </div>
                    <p>
                      Move the pointer to <strong>(0, 0)</strong> or press{" "}
                      <strong>Ctrl/⌘ + Shift + Esc</strong> to stop playback.
                    </p>
                    <small>
                      Recording only happens after your explicit confirmation.
                      Held keys remain held during pause; Stop releases them.
                    </small>
                  </section>
                </aside>
              </div>
              <section className="details-row">
                <label>
                  Macro name
                  <input
                    aria-label="Macro name"
                    maxLength={120}
                    disabled={busy}
                    value={macro.name}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </label>
                <label>
                  Profile
                  <input
                    aria-label="Macro profile"
                    maxLength={80}
                    disabled={busy}
                    value={macro.profile}
                    onChange={(e) => update({ profile: e.target.value })}
                  />
                </label>
                <button
                  className="delete-macro"
                  disabled={busy}
                  onClick={() => {
                    commit(macros.filter((m) => m.id !== macro.id));
                    setId(macros.find((m) => m.id !== macro.id)?.id || "");
                  }}
                >
                  <Trash2 size={15} /> Delete macro
                </button>
              </section>
            </>
          )}
          <section className="permissions">
            <span className={cap.available ? "ready-dot" : "unready-dot"} />
            <div>
              <strong>
                {cap.platform} ·{" "}
                {cap.available ? "Native input ready" : "Input setup"}
              </strong>
              <p>{cap.message}</p>
              {shortcuts.some((s) => !s.available) && (
                <p className="shortcut-warning">
                  Unavailable shortcuts:{" "}
                  {shortcuts
                    .filter((s) => !s.available)
                    .map((s) => s.key)
                    .join(", ")}
                  . Use onscreen controls and the pointer fail-safe.
                </p>
              )}
            </div>
            <button
              disabled={!bridge || busy}
              onClick={() =>
                bridge
                  ?.command("capabilities")
                  .then((c) => setCap(c as Capabilities))
                  .catch(fail)
              }
            >
              Recheck
            </button>
          </section>
          <section className="logs">
            <button
              className="logs-heading"
              onClick={() => setShowLogs(!showLogs)}
            >
              <Terminal size={16} /> Activity log <span>{logs.length}</span>
              <ChevronRight className={showLogs ? "rotated" : ""} size={16} />
            </button>
            {showLogs && (
              <div className="log-lines">
                {logs.length ? (
                  logs.map((l, i) => (
                    <div key={i} className={l.error ? "log-error" : ""}>
                      <time>{l.time}</time>
                      {l.message}
                    </div>
                  ))
                ) : (
                  <p>
                    No activity yet. Macro text is never written to this log.
                  </p>
                )}
              </div>
            )}
          </section>
          <div className="footnote">
            Built for visible, intentional automation. Always test in a safe
            window first.
          </div>
        </main>
      </div>
      {keybindDialog && (
        <KeybindDialog
          bindings={bindings}
          onSave={saveKeybinds}
          onClose={() => void closeKeybinds()}
        />
      )}
      {modal && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="record-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setModal(false);
              if (e.key === "Tab") {
                const controls = e.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled),input",
                );
                const first = controls[0],
                  last = controls[controls.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="modal-icon">
              <Circle size={24} />
            </div>
            <h2 id="record-title">Record your workflow</h2>
            <p>
              After {countdown} seconds, capture mouse movement, clicks, wheel
              and keyboard input across your desktop. This replaces the current
              timeline; Undo can restore it.
            </p>
            <div className="record-warning">
              Typed text is stored as plain text in your macro. Avoid passwords
              and other sensitive information. Use {bindings.record} or{" "}
              {bindings.stop} to finish without recording a click on this app.
            </div>
            <label className="consent">
              <input
                autoFocus
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{" "}
              I want to record my input now.
            </label>
            <div className="modal-buttons">
              <button onClick={() => setModal(false)}>Cancel</button>
              <button
                className="record-button"
                disabled={!consent}
                onClick={startRecord}
              >
                <Circle size={15} /> Start recording
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
