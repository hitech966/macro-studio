const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("studio", {
  load: () => ipcRenderer.invoke("studio:load"),
  save: (library) => ipcRenderer.invoke("studio:save", library),
  saveKeybinds: (bindings) => ipcRenderer.invoke("studio:keybinds", bindings),
  editKeybinds: (enabled) =>
    ipcRenderer.invoke("studio:keybind-editing", enabled),
  command: (command, payload) =>
    ipcRenderer.invoke("studio:command", command, payload),
  importMacro: () => ipcRenderer.invoke("studio:import"),
  exportMacro: (macro) => ipcRenderer.invoke("studio:export", macro),
  closeReady: (success) => ipcRenderer.invoke("studio:close-ready", success),
  onEvent: (callback) => {
    const handler = (_, event) => callback(event);
    ipcRenderer.on("studio:event", handler);
    return () => ipcRenderer.removeListener("studio:event", handler);
  },
});
