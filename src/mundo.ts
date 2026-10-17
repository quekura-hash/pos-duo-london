import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { localizarVentas } from './consultas.ts';
import { Caja, Central, Hub, type Anclas, type Ctx, type Enlace } from './nodos.ts';
import type { Politicas } from './politicas.ts';
import { devueltoPorLinea, ventas } from './proyecciones.ts';
import { MemoriaRepo, SqliteRepo, type Repo } from './repo.ts';
import type { Articulo, CajaCfg, Op } from './tipos.ts';
import { Indice } from './indice.ts';
import { opsSemilla } from './semilla.ts';
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
  { tienda: 'DUO', caja: 1, metodos: ['efectivo', 'tarjeta', 'tarjeta_regalo'] },
  { tienda: 'DUO', caja: 2, metodos: ['efectivo'] },
  { tienda: 'LON', caja: 1, metodos: ['efectivo', 'tarjeta', 'tarjeta_regalo'] },
  { tienda: 'LON', caja: 2, metodos: ['efectivo'] },
];

export interface InformeRehidratacion {
  fuentes: string[];
  recuperado: { catalogo: number; movimientos: number; operaciones_propias: number };
  no_replicado: {
    alcance: 'operaciones_propias_de_la_caja' | 'operaciones_originadas_solo_en_el_hub' | 'operaciones_del_hub_y_de_cajas_perdidas';
    contenido: 'desconocido';
    evidencia: 'techo_de_folios' | 'ninguna';
    folios_sin_evidencia: { desde: number; hasta: number } | null;
  };
  /** Registro de INVENTARIO: se cierra por artículo con conteo físico. */
  existencias: { estado: 'no_verificadas' | 'verificables_si_las_cajas_reenvian'; alcance: 'todos_los_articulos_de_la_tienda' | 'ninguno'; verificacion_op: string | null };
  /** Registro DOCUMENTAL (ventas, pagos, folios): independiente; un conteo físico NO lo cierra. */
  documentos: { estado: 'perdida_posible_abierta'; alcance: string; perdida_id: string } | null;
  /** Operaciones que las cajas vuelven a enviar al hub reconstruido (conservan sus propias operaciones). */
  reenviadas_por_cajas?: number;
  /** Compatibilidad: total de operaciones copiadas. */
  copiadas: number;
}

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
  private idxCentral?: Indice;

  constructor(o: OpcionesMundo) {
    const cajasCfg = o.cajasCfg ?? CAJAS_ESTANDAR;
    this.fabrica = o.fabrica;
    this.ctx = {
      reloj: this.reloj, ttlReservaMs: 120_000, politicas: o.politicas, cajasCfg,
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
      reservar: (ref, caja, lineas, tarjetas) => (w.hubArriba(t, n) ? w.hub(t).reservar(ref, caja, lineas, tarjetas) : null),
      liberar: (ref) => { if (w.hubArriba(t, n)) w.hub(t).liberar(ref); },
      consultarVenta(saleId) {
        if (w.hubArriba(t, n)) {
          const v = ventas(w.hub(t).repo.ops()).get(saleId);
          if (v) return v;
        }
        if (w.centralArriba(t, n)) return ventas(w.central.repo.ops()).get(saleId) ?? null;
        return null;
      },
      buscarVentas: (q) => {
        if (!w.hubArriba(t, n)) return null;
        const a = localizarVentas(w.hub(t).repo.ops(), t, q);
        return a;
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
   * Reconstruye una caja desde los nodos alcanzables (hub y, si llega, central).
   * Separa DOS clases de información:
   *  - recuperable: lo que existe en esas fuentes (catálogo, todos los movimientos de la tienda, operaciones propias recibidas);
   *  - no replicado: lo que la caja nunca envió y se perdió con su disco. Su contenido es DESCONOCIDO y se marca; no se estima.
   */
  rehidratarCaja(t: string, n: number): InformeRehidratacion {
    const fuentes: { nombre: string; ops: Op[] }[] = [];
    if (this.hubArriba(t, n)) fuentes.push({ nombre: 'hub', ops: this.hub(t).repo.ops() });
    if (this.centralArriba(t, n)) fuentes.push({ nombre: 'central', ops: this.central.repo.ops() });
    if (!fuentes.length) throw new Error('sin acceso al hub ni al central: no se puede rehidratar');
    const caja = this.caja(t, n);
    const rec = { catalogo: 0, movimientos: 0, operaciones_propias: 0 };
    for (const f of fuentes) {
      for (const op of f.ops) {
        const esCatalogo = op.tipo.startsWith('item.');
        const esInv = (op.tipo.startsWith('inv.') || op.tipo.startsWith('doc.')) && op.payload?.tienda === t;
        const esPropia = op.tienda === t && op.caja === n && !op.tipo.startsWith('folio.lease') && !op.tipo.startsWith('inv.') && !op.tipo.startsWith('doc.');
        if (!(esCatalogo || esInv || esPropia)) continue;
        if (caja.repo.appendOp(op)) {
          if (esCatalogo) rec.catalogo++;
          else if (esInv) rec.movimientos++;
          else rec.operaciones_propias++;
        }
      }
    }
    const an = caja.enlace.anclasFolios();
    const sinEvidencia = an && an.ceiling != null && an.ceiling > an.hwm ? { desde: an.hwm + 1, hasta: an.ceiling } : null;
    const no_replicado = {
      alcance: 'operaciones_propias_de_la_caja' as const,
      contenido: 'desconocido' as const,
      evidencia: an?.ceiling != null ? ('techo_de_folios' as const) : ('ninguna' as const),
      folios_sin_evidencia: sinEvidencia,
    };
    const marca = caja.registrarRehidratacion({ fuentes: fuentes.map((f) => f.nombre), recuperado: rec, no_replicado });
    return {
      fuentes: fuentes.map((f) => f.nombre), recuperado: rec, no_replicado,
      existencias: { estado: 'no_verificadas', alcance: 'todos_los_articulos_de_la_tienda', verificacion_op: marca.inventario.op_id },
      documentos: { estado: 'perdida_posible_abierta', alcance: 'ventas_pagos_y_folios_de_la_caja', perdida_id: marca.documental.op_id },
      copiadas: rec.catalogo + rec.movimientos + rec.operaciones_propias,
    };
  }

  /** Reconstruye un hub desde el central. Lo que solo estuvo en el hub (nunca llegó al central) se pierde y se marca. */
  rehidratarHub(t: string): InformeRehidratacion {
    if (this.internet.get(t) === false || this.centralCaido) throw new Error('sin acceso al central');
    const hub = this.hub(t);
    const rec = { catalogo: 0, movimientos: 0, operaciones_propias: 0 };
    const techos = new Map<number, number>();
    for (const op of this.central.repo.ops()) {
      const esCatalogo = op.tipo.startsWith('item.');
      const esInv = (op.tipo.startsWith('inv.') || op.tipo.startsWith('doc.')) && op.payload?.tienda === t;
      const esTienda = op.tienda === t && !op.tipo.startsWith('inv.') && !op.tipo.startsWith('doc.');
      if (op.tipo === 'folio.lease_granted' && op.tienda === t) techos.set(op.caja!, Math.max(techos.get(op.caja!) ?? 0, op.payload.techo));
      if (!(esCatalogo || esInv || esTienda)) continue;
      if (hub.repo.appendOp(op)) {
        if (esCatalogo) rec.catalogo++;
        else if (esInv) rec.movimientos++;
        else rec.operaciones_propias++;
      }
    }
    for (const [caja, techo] of techos) hub.repo.kvSet(`techo:${caja}`, techo);
    // La cola de relevo del hub se perdió: se reenvía a las cajas todo el catálogo e inventario (las cajas deduplican).
    for (const op of hub.repo.ops()) {
      if (op.tipo.startsWith('item.') || ((op.tipo.startsWith('inv.') || op.tipo.startsWith('doc.')) && op.payload?.tienda === t)) {
        for (const c of this.ctx.cajasCfg.filter((x) => x.tienda === t)) hub.repo.encolar(op.op_id, `caja:${t}/${c.caja}`);
      }
    }
    // Las cajas conservan sus propias operaciones: se les pide reenviar todo lo que el hub reconstruido no tenga.
    let reenviadas = 0;
    let cajaPerdida = false;
    for (const c of this.ctx.cajasCfg.filter((x) => x.tienda === t)) {
      const caja = this.caja(t, c.caja);
      if (caja.estadoFolios().estado !== 'activa') cajaPerdida = true;
      for (const op of caja.repo.ops()) {
        const propia = op.caja === c.caja && op.tienda === t && !op.tipo.startsWith('folio.lease');
        const compartida = op.tipo.startsWith('item.') || ((op.tipo.startsWith('inv.') || op.tipo.startsWith('doc.')) && op.payload?.tienda === t); // lo que la caja aprendió de su par
        if ((propia || compartida) && !hub.repo.tieneOp(op.op_id)) {
          caja.repo.reencolar(op.op_id, `hub:${t}`);
          reenviadas++;
        }
      }
    }
    // Si alguna caja también perdió su historia, lo que solo vivía en el hub y en esa caja es irrecuperable.
    const no_replicado = {
      alcance: cajaPerdida ? ('operaciones_del_hub_y_de_cajas_perdidas' as const) : ('operaciones_originadas_solo_en_el_hub' as const),
      contenido: 'desconocido' as const, evidencia: 'ninguna' as const, folios_sin_evidencia: null,
    };
    const marca = cajaPerdida ? hub.registrarRehidratacion({ fuentes: ['central'], recuperado: rec, no_replicado }) : null;
    return {
      fuentes: ['central'], recuperado: rec, no_replicado, reenviadas_por_cajas: reenviadas,
      existencias: cajaPerdida
        ? { estado: 'no_verificadas', alcance: 'todos_los_articulos_de_la_tienda', verificacion_op: marca!.inventario.op_id }
        : { estado: 'verificables_si_las_cajas_reenvian', alcance: 'ninguno', verificacion_op: null },
      documentos: marca ? { estado: 'perdida_posible_abierta', alcance: 'ventas_pagos_y_folios_de_las_cajas_y_del_hub', perdida_id: marca.documental.op_id } : null,
      copiadas: rec.catalogo + rec.movimientos + rec.operaciones_propias,
    };
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
    const { articulos, ops } = opsSemilla(items, existencias, this.reloj.now());
    const repos = [this.central.repo, ...[...this.hubs.values()].map((h) => h.repo), ...[...this.cajas.values()].map((c) => c.repo)];
    for (const r of repos) r.tx(() => { for (const op of ops) r.appendOp(op); });
    return articulos;
  }

  /** Inventario tal como lo conoce el central (lo que Administración consulta y exporta). */
  inventarioCentral() {
    if (!this.idxCentral || this.idxCentralRepo !== this.central.repo) { this.idxCentral = new Indice(this.central.repo); this.idxCentralRepo = this.central.repo; }
    const idx = this.idxCentral;
    return {
      tiendas: this.ctx.tiendas,
      articulos: () => { idx.actualizar(); return [...idx.cat.values()]; },
      saldo: (t: string, i: string) => idx.saldo(t, i),
      verificada: (t: string, i: string) => idx.verificada(t, i).verificada,
    };
  }
  private idxCentralRepo?: Repo;

  /** Carga masiva de operaciones de migración (catálogo y existencia inicial) en TODOS los nodos, en una transacción por nodo. */
  sembrarOps(ops: Op[]) {
    const repos = [this.central.repo, ...[...this.hubs.values()].map((h) => h.repo), ...[...this.cajas.values()].map((c) => c.repo)];
    for (const r of repos) r.tx(() => { for (const op of ops) r.appendOp(op); });
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
