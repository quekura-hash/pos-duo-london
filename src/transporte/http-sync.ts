import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';

export interface RespuestaHttp {
  ok: boolean;
  status?: number;
  json?: any;
  error?: string;
}

/**
 * Llamada HTTP BLOQUEANTE (el motor de la caja es síncrono). Un hilo auxiliar hace el fetch real por la red local
 * y el hilo principal espera con Atomics.wait. Si no hay respuesta a tiempo, devuelve null: "no alcanzable".
 */
export class SyncHttp {
  private flag = new Int32Array(new SharedArrayBuffer(4));
  private port: MessagePort;
  private worker: Worker;
  private id = 0;

  constructor() {
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.worker = new Worker(new URL('./http-sync-worker.ts', import.meta.url), {
      workerData: { sab: this.flag.buffer, port: port2 },
      transferList: [port2],
    });
    this.worker.unref();
  }

  post(url: string, cuerpo: unknown, timeoutMs = 3000): RespuestaHttp | null {
    const id = ++this.id;
    Atomics.store(this.flag, 0, 0);
    this.port.postMessage({ id, url, cuerpo, timeoutMs });
    const fin = Date.now() + timeoutMs + 1000;
    while (Date.now() < fin) {
      Atomics.wait(this.flag, 0, 0, Math.max(1, fin - Date.now()));
      let m = receiveMessageOnPort(this.port);
      while (m) {
        const r = m.message as RespuestaHttp & { id: number };
        if (r.id === id) return r.ok ? r : null; // respuestas tardías de llamadas anteriores se descartan
        m = receiveMessageOnPort(this.port);
      }
      Atomics.store(this.flag, 0, 0);
    }
    return null;
  }

  cerrar() {
    void this.worker.terminate();
  }
}
