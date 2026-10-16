import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Caja, Central, Hub, type Anclas, type Ctx, type Enlace } from './nodos.ts';
import type { Politicas } from './politicas.ts';
import { devueltoPorLinea, ventas } from './proyecciones.ts';
import { MemoriaRepo, SqliteRepo, type Repo } from './repo.ts';
import type { Articulo, CajaCfg, Op } from './tipos.ts';
import { Reloj } from './util.ts';

export interface FabricaRepo {
  tipo: 'memoria' | 'sqlite';
  abrir(nombre: string, cajas: CajaCfg[]): Repo;
  destruir(nombre: string): void;
  /** Copia consistente del almacenamiento (solo SQLite). */
  respaldar?(repo: Repo, nombre: string): string;
  restaurar?(nombre: string, respaldo: string): void;
}

export function fabricaMemoria(): FabricaRepo {
  const cache = new Map<string, Repo>();
  return {
    tipo: 'memoria',
    abrir(n, cajas) {
      if (!cache.has(n)) cache.set(n, new MemoriaRepo(cajas));
      return cache.get(n)!;
    },
    destruir(n) {
      cache.delete(n);
    },
  };
}

export function fabricaSqlite(dir: string): FabricaRepo {
  mkdirSync(dir, { recursive: true });
  const ruta = (n: string) => join(dir, `${n}.db`);
  const borrar = (n: string) => {
    for (const ext of ['', '-wal', '-shm']) rmSync(ruta(n) + ext, { force: true });
  };
  return {
    tipo: 'sqlite',
    abrir: (n, cajas) => new SqliteRepo(ruta(n), cajas),
    destruir: borrar,
    respaldar(repo, n) {
      const dest = join(dir, `${n}.respaldo`);
      rmSync(dest, { force: true });
      (repo as SqliteRepo).vacuumInto(dest);
      return dest;
    },
    restaurar(n, respaldo) {
      borrar(n);
      copyFileSync(respaldo, ruta(n));
    },
  };
}

export const CAJAS_ESTANDAR: CajaCfg[] = [
  { tienda: 'DUO', caja: 1, metodos: ['efectivo', 'tarjeta'] },
  { tienda: 'DUO', caja: 2, metodos: ['efectivo'] },
  { tienda: 'LON', caja: 1, metodos: ['efectivo', 'tarjeta'] },
  { tienda: 'LON', caja: 2, metodos: ['efectivo'] },
];

export interface OpcionesMundo {
  fabrica: FabricaRepo;
  politicas: Politicas;
  cajasCfg?: CajaCfg[];
  catalogoCompartido?: boolean;
}

/** Red simulada en proceso (no sockets reales): enlaces con interruptor, entrega con ack y reintento. */
export class Mundo {
  readonly reloj = new Reloj();
  readonly ctx: Ctx;
  readonly fabrica: FabricaRepo;
  readonly hubs = new Map<string, Hub>();
  readonly cajas = new Map<string, Caja>();
  central!: Central;
  readonly lan = new Map<string, boolean>(); // `${tienda}/${caja}` -> cable/switch ok
  readonly internet = new Map<string, boolean>(); // tienda -> hub↔central ok
  readonly hubCaido = new Set<string>();
  centralCaido = false;
  dropAck?: (op: Op, destino: string) => boolean;
  entregas = 0;
  acksPerdidos = 0;
  private repos = new Map<string, Repo>();

  constructor(o: OpcionesMundo) {
    const cajasCfg = o.cajasCfg ?? CAJAS_ESTANDAR;
    this.fabrica = o.fabrica;
    this.ctx = {
      reloj: this.reloj, politicas: o.politicas, cajasCfg,
      tiendas: [...new Set(cajasCfg.map((c) => c.tienda))], catalogoCompartido: o.catalogoCompartido ?? true,
    };
    this.central = new Central(this.abrir('central'), this.ctx);
    for (const t of this.ctx.tiendas) {
      this.hubs.set(t, new Hub(t, this.abrir(`hub-${t}`), this.ctx));
      this.internet.set(t, true);
    }
    for (const c of cajasCfg) {
      this.lan.set(`${c.tienda}/${c.caja}`, true);
      this.cajas.set(`${c.tienda}/${c.caja}`, this.nuevaCaja(c.tienda, c.caja));
    }
  }
  private abrir(nombre: string): Repo {
    const r = this.fabrica.abrir(nombre, this.ctx.cajasCfg);
    this.repos.set(nombre, r);
    return r;
  }
  private nuevaCaja(t: string, n: number, opts: { restaurado?: 'disco_nuevo' | 'respaldo' } = {}): Caja {
    return new Caja(t, n, this.abrir(`caja-${t}-${n}`), this.ctx, this.enlaceDe(t, n), opts);
  }

  caja(t: string, n: number): Caja {
    return this.cajas.get(`${t}/${n}`)!;
  }
  hub(t: string): Hub {
    return this.hubs.get(t)!;
  }

  // ── enlaces ──
  private hubArriba(t: string, n: number) {
    return this.lan.get(`${t}/${n}`) !== false && !this.hubCaido.has(t);
  }
  private centralArriba(t: string, n: number) {
    return this.hubArriba(t, n) && this.internet.get(t) !== false && !this.centralCaido;
  }
  private enlaceDe(t: string, n: number): Enlace {
    const w = this;
    return {
      hubAlcanzable: () => w.hubArriba(t, n),
      arrendarFolios: (ultimo, k) => (w.hubArriba(t, n) ? w.hub(t).arrendar(n, ultimo, k) : null),
      anclasFolios(): Anclas | null {
        const fuentes: Anclas[] = [];
        if (w.hubArriba(t, n)) fuentes.push(w.hub(t).anclas(n));
        if (w.centralArriba(t, n)) fuentes.push(w.central.anclas(t, n));
        if (!fuentes.length) return null;
        const techos = fuentes.map((f) => f.ceiling).filter((x): x is number => x != null);
        return { ceiling: techos.length ? Math.max(...techos) : null, hwm: Math.max(...fuentes.map((f) => f.hwm)), fuente: fuentes.map((f) => f.fuente).join('+') };
      },
      bloqueItemNo: (k) => (w.centralArriba(t, n) ? w.central.bloqueItemNo(k) : null),
      consultarVenta(saleId) {
        if (w.hubArriba(t, n)) {
          const v = ventas(w.hub(t).repo.ops()).get(saleId);
          if (v) return v;
        }
        if (w.centralArriba(t, n)) return ventas(w.central.repo.ops()).get(saleId) ?? null;
        return null;
      },
      devueltoAutoritativo(saleId) {
        if (!w.hubArriba(t, n)) return null;
        const a = devueltoPorLinea(w.hub(t).repo.ops(), saleId);
        if (w.centralArriba(t, n)) {
          for (const [k, v] of devueltoPorLinea(w.central.repo.ops(), saleId)) {
            const p = a.get(k);
            if (!p || v.qty > p.qty) a.set(k, v);
          }
        }
        return a;
      },
    };
  }

  // ── fallos ──
  cortarInternet(t: string) { this.internet.set(t, false); }
  restablecerInternet(t: string) { this.internet.set(t, true); }
  cortarLan(t: string, n: number) { this.lan.set(`${t}/${n}`, false); }
  restablecerLan(t: string, n: number) { this.lan.set(`${t}/${n}`, true); }
  caerHub(t: string) { this.hubCaido.add(t); }
  levantarHub(t: string) { this.hubCaido.delete(t); }

  /** Reinicio de la aplicación en una caja: el almacenamiento persiste, el proceso no. */
  reiniciarCaja(t: string, n: number): Caja {
    this.repos.get(`caja-${t}-${n}`)!.cerrar();
    const c = this.nuevaCaja(t, n);
    this.cajas.set(`${t}/${n}`, c);
    return c;
  }
  /** La caja pierde su disco y entra con almacenamiento nuevo. */
  perderDiscoCaja(t: string, n: number): Caja {
    this.repos.get(`caja-${t}-${n}`)!.cerrar();
    this.fabrica.destruir(`caja-${t}-${n}`);
    const c = this.nuevaCaja(t, n, { restaurado: 'disco_nuevo' });
    this.cajas.set(`${t}/${n}`, c);
    return c;
  }
  /**
   * Reconstruye una caja con almacenamiento nuevo desde el hub: catálogo, movimientos de la tienda y las
   * operaciones propias que el hub sí recibió. Lo que nunca llegó al hub NO se recupera por esta vía.
   */
  rehidratarCaja(t: string, n: number): { copiadas: number } {
    if (!this.hubArriba(t, n)) throw new Error('sin acceso al hub: no se puede rehidratar');
    const caja = this.caja(t, n);
    let copiadas = 0;
    for (const op of this.hub(t).repo.ops()) {
      const catalogoOMov = op.tipo.startsWith('item.') || (op.tipo === 'inv.movement' && op.payload.tienda === t);
      const propia = op.tienda === t && op.caja === n && !op.tipo.startsWith('folio.lease');
      if ((catalogoOMov || propia) && caja.repo.appendOp(op)) copiadas++;
    }
    return { copiadas };
  }
  respaldarCaja(t: string, n: number): string {
    return this.fabrica.respaldar!(this.repos.get(`caja-${t}-${n}`)!, `caja-${t}-${n}`);
  }
  restaurarCajaDesdeRespaldo(t: string, n: number, respaldo: string): Caja {
    this.repos.get(`caja-${t}-${n}`)!.cerrar();
    this.fabrica.restaurar!(`caja-${t}-${n}`, respaldo);
    const c = this.nuevaCaja(t, n, { restaurado: 'respaldo' });
    this.cajas.set(`${t}/${n}`, c);
    return c;
  }
  perderDiscoHub(t: string): Hub {
    this.repos.get(`hub-${t}`)!.cerrar();
    this.fabrica.destruir(`hub-${t}`);
    const h = new Hub(t, this.abrir(`hub-${t}`), this.ctx);
    this.hubs.set(t, h);
    return h;
  }
  cerrar() {
    for (const r of this.repos.values()) {
      try { r.cerrar(); } catch { /* ya cerrado */ }
    }
  }

  // ── catálogo sintético (migración inicial: existencia inicial como movimientos) ──
  sembrar(items: Omit<Articulo, 'item_id' | 'origen'>[], existencias: Record<string, number>[] = []): Articulo[] {
    const out: Articulo[] = items.map((x, i) => ({ ...x, item_id: `seed${i + 1}`, origen: 'migracion' }));
    const repos = [this.central.repo, ...[...this.hubs.values()].map((h) => h.repo), ...[...this.cajas.values()].map((c) => c.repo)];
    out.forEach((a, i) => {
      for (const r of repos) {
        r.appendOp({ op_id: `item:${a.item_id}`, tipo: 'item.created', tienda: null, caja: null, origen: 'migracion', ocurrio_en: this.reloj.now(), payload: a });
      }
      for (const [t, q] of Object.entries(existencias[i] ?? {})) {
        for (const r of repos) {
          r.appendOp({ op_id: `seed:mov:${a.item_id}:${t}`, tipo: 'inv.movement', tienda: t, caja: null, origen: 'migracion', ocurrio_en: this.reloj.now(), payload: { item_id: a.item_id, tienda: t, delta: q, tipo: 'existencia_inicial', doc: 'migracion' } });
        }
      }
    });
    return out;
  }

  // ── transporte: entrega con ack, reintento y pérdida de ack inyectable ──
  private nodo(id: string): { repo: Repo; recibir(op: Op, desde: string): void; destinos?(): string[] } {
    if (id === 'central') return this.central;
    if (id.startsWith('hub:')) return this.hubs.get(id.slice(4))!;
    return this.cajas.get(id.slice(5))!;
  }
  private enlaceArriba(a: string, b: string): boolean {
    const par = [a, b];
    const caja = par.find((x) => x.startsWith('caja:'));
    const hub = par.find((x) => x.startsWith('hub:'));
    if (caja && hub) {
      const [t, n] = caja.slice(5).split('/');
      return this.hubArriba(t!, Number(n)) && hub === `hub:${t}`;
    }
    if (hub && par.includes('central')) return this.internet.get(hub.slice(4)) !== false && !this.centralCaido && !this.hubCaido.has(hub.slice(4));
    return false;
  }
  private origenes(): { id: string; repo: Repo; destinos: string[] }[] {
    const l: { id: string; repo: Repo; destinos: string[] }[] = [];
    l.push({ id: 'central', repo: this.central.repo, destinos: this.central.destinos() });
    for (const h of this.hubs.values()) l.push({ id: h.id, repo: h.repo, destinos: h.destinos() });
    for (const c of this.cajas.values()) l.push({ id: c.nodoId, repo: c.repo, destinos: [`hub:${c.tienda}`] });
    return l;
  }
  /** Entrega pendientes hasta quietud. Devuelve cuántas confirmaciones (acks) se registraron. */
  pump(max = 40): number {
    let total = 0;
    for (let i = 0; i < max; i++) {
      let progreso = 0;
      for (const o of this.origenes()) {
        for (const d of o.destinos) {
          if (!this.enlaceArriba(o.id, d)) continue;
          for (const op of o.repo.pendientes(d)) {
            this.nodo(d).recibir(op, o.id);
            this.entregas++;
            if (this.dropAck?.(op, d)) { this.acksPerdidos++; continue; }
            o.repo.ack(op.op_id, d);
            progreso++;
          }
        }
      }
      total += progreso;
      if (!progreso) break;
    }
    return total;
  }
  pendientesTotales(): number {
    return this.origenes().reduce((a, o) => a + o.destinos.reduce((b, d) => b + o.repo.pendientes(d).length, 0), 0);
  }
}
