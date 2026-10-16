import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { opsSemilla } from '../../src/semilla.ts';
import { CAJAS_ESTANDAR } from '../../src/mundo.ts';
import { SqliteRepo } from '../../src/repo.ts';
import type { Politicas } from '../../src/politicas.ts';
import type { Articulo, Op } from '../../src/tipos.ts';
import { BASE_ENSAYO } from './comun.ts';

const RAIZ = join(import.meta.dirname, '..', '..', 'src', 'transporte');

export class ErrorRemoto extends Error {
  codigo: string;
  detalle: unknown;
  constructor(e: { codigo: string; mensaje: string; detalle?: unknown }) {
    super(e.mensaje);
    this.codigo = e.codigo;
    this.detalle = e.detalle;
  }
}

async function post(url: string, cuerpo: unknown): Promise<any> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(15000) });
  return r.json();
}

export interface Proceso {
  proc: ChildProcess;
  puerto: number;
  vivo(): boolean;
  matar(): Promise<void>;
}

function lanzar(script: string, args: object): Promise<Proceso> {
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, ['--no-warnings', join(RAIZ, script), JSON.stringify(args)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let salido = false;
    proc.on('exit', () => { salido = true; });
    const t = setTimeout(() => rej(new Error(`${script} no arrancó`)), 15000);
    proc.stdout!.on('data', (d) => {
      const m = /LISTO (\d+)/.exec(String(d));
      if (!m) return;
      clearTimeout(t);
      res({
        proc, puerto: Number(m[1]), vivo: () => !salido,
        matar: () => new Promise<void>((r) => {
          if (salido) return r();
          proc.once('exit', () => r());
          proc.kill('SIGKILL'); // caída abrupta, sin cierre ordenado
        }),
      });
    });
    proc.on('error', rej);
  });
}

export function puertoLibre(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

export class CajaRemota {
  proceso!: Proceso;
  readonly tienda: string;
  readonly n: number;
  private opciones: object;
  constructor(tienda: string, n: number, opciones: object) {
    this.tienda = tienda;
    this.n = n;
    this.opciones = opciones;
  }
  async arrancar() {
    this.proceso = await lanzar('caja-proceso.ts', this.opciones);
  }
  async cmd<T = any>(metodo: string, ...args: unknown[]): Promise<T> {
    const r = await post(`http://127.0.0.1:${this.proceso.puerto}/cmd`, { metodo, args });
    if (!r.ok) throw new ErrorRemoto(r.error);
    return r.valor as T;
  }
  sync() { return this.cmd<{ ok: boolean; enviadas: number; recibidas: number }>('__sync'); }
  desconectar(v: boolean) { return this.cmd('__desconectar', v); }
  /** Prepara un carrito con una línea y devuelve {cart, importe}. */
  async carrito(item_id: string, qty = 1) {
    const cart = await this.cmd<string>('abrirCarrito');
    const l = await this.cmd<{ importe: number }>('agregarLinea', cart, { item_id, qty });
    return { cart, importe: l.importe };
  }
  cobrarEfectivo(cart: string, importe: number) {
    return this.cmd<any>('cobrar', cart, [{ metodo: 'efectivo', monto: importe }]);
  }
  async reiniciar() {
    await this.proceso.matar();
    await this.arrancar();
  }
}

export class HubRemoto {
  proceso!: Proceso;
  readonly puerto: number;
  private opciones: object;
  constructor(puerto: number, opciones: object) {
    this.puerto = puerto;
    this.opciones = opciones;
  }
  get url() { return `http://127.0.0.1:${this.puerto}`; }
  async arrancar() { this.proceso = await lanzar('hub-proceso.ts', this.opciones); }
  async matar() { await this.proceso.matar(); }
  async reiniciar() { await this.matar(); await this.arrancar(); }
  async ops(): Promise<Op[]> { return (await post(`${this.url}/admin`, { accion: 'ops' })).ops; }
  async reservas(): Promise<any[]> { return (await post(`${this.url}/admin`, { accion: 'reservas' })).reservas; }
  fallas(valores: object) { return post(`${this.url}/admin`, { accion: 'fallas', valores }); }
  async rpc(metodo: string, ...args: unknown[]) { return (await post(`${this.url}/rpc`, { metodo, args })).valor; }
}

export interface Entorno {
  hub: HubRemoto;
  c1: CajaRemota;
  c2: CajaRemota;
  items: Articulo[];
  limpiar(): Promise<void>;
}

/**
 * Entorno de integración: UN hub real y DOS procesos de caja separados (DÚO/1 y DÚO/2), cada uno con su propio
 * archivo SQLite, hablando por HTTP en 127.0.0.1. Las políticas son de ENSAYO.
 */
export async function crearEntorno(o: { politicas?: Partial<Omit<Politicas, 'estado'>>; ttlReservaMs?: number; existencias?: Record<string, number>[]; itemsExtra?: number } = {}): Promise<Entorno> {
  const dir = mkdtempSync(join(tmpdir(), 'pos-proc-'));
  const politicas = { ...BASE_ENSAYO, ...o.politicas };
  const cajasCfg = CAJAS_ESTANDAR.filter((c) => c.tienda === 'DUO');
  const itemsBase = [
    { codigo: '7501234567890', item_no: '1001', marca: 'EFENTUS', descripcion: 'MASCADA', estilo: 'A-12', lote: '20260913', departamento: 'ACCESORIOS', precio: 12000 },
  ];
  const extra = Array.from({ length: o.itemsExtra ?? 0 }, (_, i) => ({
    codigo: `000000000${String(100 + i)}`, item_no: String(2000 + i), marca: 'UNICA', descripcion: `PIEZA ${i}`, estilo: `U${i}`, lote: '20261016', departamento: 'BOLSAS', precio: 50000,
  }));
  const existencias = o.existencias ?? [{ DUO: 500 }, ...extra.map(() => ({ DUO: 1 }))];
  const { articulos, ops } = opsSemilla([...itemsBase, ...extra], existencias, new Date().toISOString());
  const archivos = { hub: join(dir, 'hub.db'), c1: join(dir, 'caja1.db'), c2: join(dir, 'caja2.db') };
  for (const f of Object.values(archivos)) {
    const r = new SqliteRepo(f, cajasCfg);
    for (const op of ops) r.appendOp(op);
    r.cerrar();
  }
  const puerto = await puertoLibre();
  const ttlReservaMs = o.ttlReservaMs ?? 120_000;
  const hub = new HubRemoto(puerto, { tienda: 'DUO', db: archivos.hub, puerto, politicas, cajasCfg, ttlReservaMs });
  await hub.arrancar();
  const mk = (n: number, db: string) => new CajaRemota('DUO', n, { tienda: 'DUO', caja: n, db, hubUrl: hub.url, politicas, cajasCfg, ttlReservaMs });
  const c1 = mk(1, archivos.c1);
  const c2 = mk(2, archivos.c2);
  await Promise.all([c1.arrancar(), c2.arrancar()]);
  return {
    hub, c1, c2, items: articulos,
    async limpiar() {
      await Promise.all([hub.matar().catch(() => {}), c1.proceso.matar(), c2.proceso.matar()]);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
