'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Lo que la pantalla del POS puede pedirle al equipo. Nada más: no hay acceso a Node desde la página.
contextBridge.exposeInMainWorld('posHardware', {
  imprimirRaw: (bytes) => ipcRenderer.invoke('hw:imprimir', bytes),
  instalarActualizacion: () => ipcRenderer.invoke('upd:instalar'),
  version: () => ipcRenderer.invoke('app:version'),
  credencialesCaja: () => ipcRenderer.invoke('caja:credenciales'),
  guardarCredencialesCaja: (c) => ipcRenderer.invoke('caja:guardar-credenciales', c),
  olvidarCredencialesCaja: () => ipcRenderer.invoke('caja:olvidar-credenciales'),
});
contextBridge.exposeInMainWorld('posAjustes', {
  leer: () => ipcRenderer.invoke('ajustes:leer'),
  guardar: (cambios) => ipcRenderer.invoke('ajustes:guardar', cambios),
  impresoras: () => ipcRenderer.invoke('ajustes:impresoras'),
  probar: (tipo) => ipcRenderer.invoke('ajustes:probar', tipo),
  buscarActualizacion: () => ipcRenderer.invoke('upd:revisar'),
  estadoActualizacion: () => ipcRenderer.invoke('upd:estado'),
  carpetaDeDatos: () => ipcRenderer.invoke('app:carpeta-datos'),
});
