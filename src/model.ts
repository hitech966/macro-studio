export type Action = {
  type: string;
  delay: number;
  x?: number;
  y?: number;
  button?: string;
  key?: string;
  text?: string;
  dx?: number;
  dy?: number;
  tolerance?: number;
  actions?: Action[];
};
export type Macro = {
  version: 1;
  id: string;
  name: string;
  profile: string;
  actions: Action[];
  script: string;
};
export type StudioEvent = {
  event: string;
  state?: string;
  action?: Action | string;
  actions?: Action[];
  message?: string;
  index?: number;
  loop?: number;
  dryRun?: boolean;
};
export type Capabilities = {
  available: boolean;
  message: string;
  platform: string;
};
export type Bindings = {
  record: string;
  play: string;
  pause: string;
  stop: string;
};
export type Shortcut = { action: string; key: string; available: boolean };
export const defaultBindings: Bindings = {
  record: "F6",
  play: "F7",
  pause: "F8",
  stop: "F9",
};
export interface Bridge {
  load(): Promise<{
    library: { macros: Macro[] };
    recovered: boolean;
    capabilities: Capabilities;
    shortcuts: Shortcut[];
    bindings: Bindings;
    state: string;
  }>;
  save(library: { macros: Macro[] }): Promise<boolean>;
  saveKeybinds(
    bindings: Bindings,
  ): Promise<{ bindings: Bindings; shortcuts: Shortcut[] }>;
  editKeybinds(enabled: boolean): Promise<Shortcut[]>;
  command(command: string, payload?: unknown): Promise<unknown>;
  importMacro(): Promise<Macro | null>;
  exportMacro(macro: Macro): Promise<boolean>;
  closeReady(success: boolean): Promise<void>;
  onEvent(callback: (e: StudioEvent) => void): () => void;
}
declare global {
  interface Window {
    studio?: Bridge;
  }
}
export const starter: Macro = {
  version: 1,
  id: "welcome",
  name: "My first workflow",
  profile: "Personal",
  script:
    '# Write a workflow, then compile to the timeline.\n# Times are in seconds; coordinates are screen pixels.\nwait 1\nmove 420 300\nclick left\nwait 0.4\ntype "Hello from Macro Studio"\nkey enter\n',
  actions: [
    { type: "move", x: 420, y: 300, delay: 1000 },
    { type: "click", button: "left", delay: 250 },
    { type: "text", text: "Hello from Macro Studio", delay: 400 },
    { type: "key", key: "enter", delay: 100 },
  ],
};
export const blank = (): Macro => ({
  version: 1,
  id: crypto.randomUUID(),
  name: "Untitled macro",
  profile: "Personal",
  actions: [],
  script: "# Your automation starts here\nwait 1\n",
});
export function describe(a: Action): string {
  if (a.type === "move") return `Move to (${a.x}, ${a.y})`;
  if (a.type === "text") return `Type “${a.text}”`;
  if (a.type === "click") return `${a.button} click`;
  if (a.type.startsWith("button_"))
    return `${a.button} button ${a.type.endsWith("down") ? "down" : "up"}`;
  if (a.type.startsWith("key"))
    return `${a.key} ${a.type === "key" ? "press" : a.type.endsWith("down") ? "down" : "up"}`;
  if (a.type === "scroll") return `Scroll (${a.dx}, ${a.dy})`;
  if (a.type === "if_cursor")
    return `If cursor is near (${a.x}, ${a.y}) · ${a.actions?.length} actions`;
  return "Wait";
}
export function freshAction(type: string): Action {
  const delay = 250;
  if (type === "move") return { type, delay, x: 420, y: 300 };
  if (type === "text") return { type, delay, text: "Hello" };
  if (type.includes("button") || type === "click")
    return { type, delay, button: "left" };
  if (type.startsWith("key")) return { type, delay, key: "enter" };
  if (type === "scroll") return { type, delay, dx: 0, dy: -1 };
  if (type === "if_cursor")
    return { type, delay, x: 420, y: 300, tolerance: 5, actions: [] };
  return { type: "wait", delay: 1000 };
}
