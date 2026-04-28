const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getStorePath: () => ipcRenderer.invoke('get-store-path'),
    loadData: () => ipcRenderer.invoke('load-data'),
    saveData: (data) => ipcRenderer.invoke('save-data', data)
});