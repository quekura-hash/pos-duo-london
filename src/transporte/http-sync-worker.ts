import { workerData, type MessagePort } from 'node:worker_threads';

// Hilo auxiliar: ejecuta fetch y avisa al hilo principal (bloqueado en Atomics.wait) cuando hay respuesta.
const flag = new Int32Array(workerData.sab as SharedArrayBuffer);
const port = workerData.port as MessagePort;

port.on('message', async (m: { id: number; url: string; cuerpo: unknown; timeoutMs: number }) => {
  let res: object;
  try {
    const r = await fetch(m.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(m.cuerpo),
      signal: AbortSignal.timeout(m.timeoutMs),
    });
    res = { id: m.id, ok: true, status: r.status, json: await r.json() };
  } catch (e) {
    res = { id: m.id, ok: false, error: String(e) };
  }
  port.postMessage(res);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
