import { useState } from "react";
import { Bindings, defaultBindings } from "./model";
export default function KeybindDialog({
  bindings,
  onSave,
  onClose,
}: {
  bindings: Bindings;
  onSave: (bindings: Bindings) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(bindings),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  function capture(
    e: React.KeyboardEvent<HTMLInputElement>,
    action: keyof Bindings,
  ) {
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) return;
    e.preventDefault();
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const key = e.code.startsWith("Key")
      ? e.code.slice(3)
      : e.code.startsWith("Digit")
        ? e.code.slice(5)
        : e.key === " "
          ? "Space"
          : e.key.replace("Arrow", "");
    const modifiers = [
      e.ctrlKey ? "Control" : "",
      e.metaKey
        ? navigator.platform.includes("Mac")
          ? "Command"
          : "Super"
        : "",
      e.altKey ? "Alt" : "",
      e.shiftKey ? "Shift" : "",
    ].filter(Boolean);
    setDraft((old) => ({ ...old, [action]: [...modifiers, key].join("+") }));
    setError("");
  }
  return (
    <div className="modal-backdrop">
      <div
        className="modal keybind-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keybind-title"
      >
        <h2 id="keybind-title">Application keybinds</h2>
        <p>
          Click a field, then press your new shortcut. Use function keys or a
          key with Ctrl, Alt, Shift or Command. Playback shortcuts are
          temporarily paused while editing; emergency stop remains active.
        </p>
        {(Object.keys(draft) as (keyof Bindings)[]).map((action, i) => (
          <label key={action}>
            {
              {
                record: "Record / finish recording",
                play: "Run macro",
                pause: "Pause / resume",
                stop: "Stop",
              }[action]
            }
            <input
              autoFocus={i === 0}
              aria-label={`${action} keybind`}
              readOnly
              disabled={saving}
              value={draft[action]}
              onKeyDown={(e) => capture(e, action)}
            />
          </label>
        ))}
        <p className="keybind-emergency">
          Emergency stop: Ctrl/⌘ + Shift + Escape. This shortcut is always
          reserved.
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-buttons">
          <button disabled={saving} onClick={() => setDraft(defaultBindings)}>
            Reset defaults
          </button>
          <button disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            className="play-button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(draft);
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save keybinds"}
          </button>
        </div>
      </div>
    </div>
  );
}
