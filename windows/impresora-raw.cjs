'use strict';
// Envío de bytes ESC/POS DIRECTO a una impresora de Windows por la cola de impresión (datatype RAW), sin diálogo ni controlador gráfico.
// Usa PowerShell con la API winspool (sin módulos nativos que compilar). Todo lo del sistema se inyecta para poder probarlo sin Windows.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_ENVIAR = String.raw`
param([Parameter(Mandatory=$true)][string]$Impresora, [Parameter(Mandatory=$true)][string]$Archivo)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class LonDuoRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo { [MarshalAs(UnmanagedType.LPWStr)] public string Nombre; [MarshalAs(UnmanagedType.LPWStr)] public string Salida; [MarshalAs(UnmanagedType.LPWStr)] public string Tipo; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool StartDocPrinter(IntPtr h, int nivel, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, IntPtr b, int n, out int escritos);
  public static void Enviar(string impresora, byte[] datos) {
    IntPtr h;
    if (!OpenPrinter(impresora, out h, IntPtr.Zero)) throw new Exception("No se pudo abrir la impresora '" + impresora + "' (error de Windows " + Marshal.GetLastWin32Error() + "). Revise el nombre y que esté instalada.");
    try {
      var di = new DocInfo { Nombre = "LonDuo POS", Salida = null, Tipo = "RAW" };
      if (!StartDocPrinter(h, 1, di)) throw new Exception("La impresora no aceptó el trabajo (error " + Marshal.GetLastWin32Error() + ").");
      try {
        if (!StartPagePrinter(h)) throw new Exception("La impresora no aceptó la página (error " + Marshal.GetLastWin32Error() + ").");
        IntPtr p = Marshal.AllocCoTaskMem(datos.Length);
        try {
          Marshal.Copy(datos, 0, p, datos.Length);
          int w;
          if (!WritePrinter(h, p, datos.Length, out w) || w != datos.Length) throw new Exception("No se pudo escribir en la impresora (error " + Marshal.GetLastWin32Error() + ", " + w + " de " + datos.Length + " bytes).");
        } finally { Marshal.FreeCoTaskMem(p); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[LonDuoRaw]::Enviar($Impresora, [System.IO.File]::ReadAllBytes($Archivo))
`;

const SCRIPT_LISTAR = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$l = @(Get-CimInstance Win32_Printer | Select-Object Name, Default, PortName, DriverName, WorkOffline)
ConvertTo-Json -InputObject $l -Compress
`;

function ejecutarReal(cmd, args, opciones = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: opciones.timeout ?? 30000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      // Si PowerShell ni siquiera arrancó (ENOENT, bloqueado) o se colgó (timeout), stderr viene vacío: el motivo está en `error`.
      const motivo = error ? (error.killed ? 'PowerShell no respondió a tiempo (30 s).' : `no se pudo iniciar PowerShell (${error.code ?? error.message}).`) : '';
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr || motivo) });
    });
  });
}

/** Texto limpio de un error de PowerShell (sin el ruido de «En línea:1 Carácter:1…»). */
function mensajeDeError(stderr) {
  const t = String(stderr).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const util = t.find((l) => !/^(En l[ií]nea|At line|\+|CategoryInfo|FullyQualifiedErrorId)/i.test(l));
  return (util ?? t[0] ?? 'error desconocido').replace(/^Exception calling .*?: "?/i, '').replace(/"$/, '');
}

/**
 * @param {{ ejecutar?: Function, dirTmp?: string, fs?: typeof fs, plataforma?: string, powershell?: string }} [o]
 */
function crearImpresoraRaw(o = {}) {
  const ejecutar = o.ejecutar ?? ejecutarReal;
  const sistema = o.fs ?? fs;
  const dirTmp = o.dirTmp ?? path.join(os.tmpdir(), 'londuo-pos');
  const plataforma = o.plataforma ?? process.platform;
  // Ruta completa: no depende de que el PATH de esta computadora incluya PowerShell.
  const ps = o.powershell ?? (process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe');
  let cola = Promise.resolve();
  let contador = 0;

  const escribirScript = (nombre, texto) => {
    sistema.mkdirSync(dirTmp, { recursive: true });
    const ruta = path.join(dirTmp, nombre);
    // BOM UTF-8: PowerShell 5 lee bien los acentos de los mensajes.
    sistema.writeFileSync(ruta, '﻿' + texto, 'utf8');
    return ruta;
  };
  const soloWindows = () => { if (plataforma !== 'win32') throw new Error('La impresión directa solo existe en Windows.'); };

  return {
    /** Impresoras instaladas en Windows (por PowerShell; si falla, por la lista de Electron). */
    async listar() {
      soloWindows();
      const script = escribirScript('listar.ps1', SCRIPT_LISTAR);
      const r = await ejecutar(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]);
      if (r.code !== 0) {
        // Plan B: la lista que ya conoce Electron (no usa PowerShell).
        if (o.listarAlterno) { try { const alt = await o.listarAlterno(); if (alt.length) return alt; } catch { /* se informa el error original */ } }
        throw new Error(`No se pudo leer la lista de impresoras: ${mensajeDeError(r.stderr)}`);
      }
      let datos;
      try { datos = JSON.parse(r.stdout.trim() || '[]'); } catch { throw new Error('Windows devolvió la lista de impresoras en un formato que no se entiende.'); }
      return (Array.isArray(datos) ? datos : [datos]).filter((x) => x && x.Name).map((x) => ({ nombre: String(x.Name), predeterminada: !!x.Default, puerto: String(x.PortName ?? ''), controlador: String(x.DriverName ?? ''), sinConexion: !!x.WorkOffline }));
    },
    /** Manda los bytes a la impresora (de uno en uno, en orden). Rechaza con un mensaje en español si falla. */
    imprimir(impresora, bytes) {
      const trabajo = cola.then(async () => {
        soloWindows();
        if (!impresora) throw new Error('No hay impresora configurada. Abra Hardware → Configurar impresora y cajón.');
        if (!bytes || !bytes.length) throw new Error('No hay nada que imprimir.');
        const script = escribirScript('enviar.ps1', SCRIPT_ENVIAR);
        const archivo = path.join(dirTmp, `trabajo-${process.pid}-${++contador}.bin`);
        sistema.writeFileSync(archivo, Buffer.from(bytes));
        try {
          const r = await ejecutar(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Impresora', impresora, '-Archivo', archivo], { timeout: 30000 });
          if (r.code !== 0) throw new Error(mensajeDeError(r.stderr));
        } finally {
          try { sistema.rmSync(archivo, { force: true }); } catch { /* ya no existe */ }
        }
      });
      cola = trabajo.catch(() => undefined); // un fallo no frena los siguientes
      return trabajo;
    },
  };
}

module.exports = { crearImpresoraRaw, mensajeDeError, SCRIPT_ENVIAR, SCRIPT_LISTAR };
