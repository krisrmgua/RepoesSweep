import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("sweep", {
  getState: () => ipcRenderer.invoke("sweep:getState"),
  refresh: () => ipcRenderer.invoke("sweep:refresh"),
  pull: (paths: string[]) => ipcRenderer.invoke("sweep:pull", paths),
  pullFix: (paths: string[]) => ipcRenderer.invoke("sweep:pullFix", paths),
  clean: (paths: string[]) => ipcRenderer.invoke("sweep:clean", paths),
  deleteRemote: (request: unknown) => ipcRenderer.invoke("sweep:deleteRemote", request),
  setPrefs: (partial: unknown) => ipcRenderer.invoke("sweep:setPrefs", partial),
  hide: () => ipcRenderer.invoke("sweep:hide"),
  quit: () => ipcRenderer.invoke("sweep:quit"),
  fitHeight: (height: number) => ipcRenderer.invoke("sweep:fitHeight", height),
  onChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("sweep:changed", handler);
    return () => ipcRenderer.removeListener("sweep:changed", handler);
  },
  onClosed: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("sweep:closed", handler);
    return () => ipcRenderer.removeListener("sweep:closed", handler);
  },
});
