import { aplicarOpDepto, copiarBase, type Departamento } from './departamentos.ts';
import { CAMPOS_TIENDA, type DatosTienda } from './proyecciones.ts';
import { aplicarPermiso, aplicarTarjeta, type PerdidaDocumental, type TarjetaRegalo, type TipoCambio } from './proyecciones.ts';
import type { Repo } from './repo.ts';
import type { Promocion } from './promociones.ts';
import type { Supervisor } from './supervisores.ts';
import { claveDeEscaneo, clavesDeCatalogo } from './codigos.ts';
import { LIMBO, type Articulo } from './tipos.ts';

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Proyecciones INCREMENTALES de un nodo (catálogo, existencias, marcas de verificación, pérdidas documentales).
 * Con un catálogo de ~21,000 artículos no se puede recalcular todo desde la bitácora en cada escaneo: este índice
 * aplica solo las operaciones nuevas. Si hubo un rollback (otra generación) o la bitácora retrocedió, se reconstruye.
 * Mientras haya una transacción abierta no avanza: lee el último estado confirmado.
 */
export class Indice {
  private repo: Repo;
  private seq = 0;
  private gen = -1;
  cat = new Map<string, Articulo>();
  porCodigo = new Map<string, Articulo[]>();
  porAlterno = new Map<string, Articulo[]>();
  /** Código sin ceros a la izquierda y base de un UPC (sin dígito verificador): encuentra el código corto de la etiqueta. */
  porClave = new Map<string, Articulo[]>();
  porItemNo = new Map<string, Articulo[]>();
  private texto = new Map<string, string>();
  private mover(tienda: string, itemId: string, delta: number) {
    let t = this.stock.get(tienda);
    if (!t) this.stock.set(tienda, (t = new Map()));
    t.set(itemId, (t.get(itemId) ?? 0) + delta);
  }
  private stock = new Map<string, Map<string, number>>();
  private enLimbo = new Set<string>();
  private faltantesTienda = new Map<string, { tienda: string; item_id: string; qty: number }>();
  private marcas = new Map<string, string[]>(); // tienda -> ids de inv.verificacion_pendiente
  private cubiertas = new Map<string, Set<string>>(); // `${tienda}|${item}` -> ids cubiertos por un conteo
  private perdidas = new Map<string, PerdidaDocumental>();
  private tarjetas = new Map<string, TarjetaRegalo>();
  private tipos = new Map<number, TipoCambio>();
  private permisos = new Map<string, Set<string>>();
  private deptos: Departamento[] = copiarBase();
  private promos = new Map<string, Promocion>();
  private supervisoresMap = new Map<string, Supervisor>();
  private datosTienda = new Map<string, DatosTienda>();

  constructor(repo: Repo) {
    this.repo = repo;
  }

  private reiniciar() {
    this.seq = 0;
    this.cat = new Map(); this.porCodigo = new Map(); this.porAlterno = new Map(); this.porClave = new Map(); this.porItemNo = new Map(); this.texto = new Map();
    this.stock = new Map(); this.enLimbo = new Set(); this.faltantesTienda = new Map(); this.marcas = new Map(); this.cubiertas = new Map(); this.perdidas = new Map(); this.tarjetas = new Map(); this.tipos = new Map(); this.permisos = new Map(); this.deptos = copiarBase(); this.promos = new Map(); this.supervisoresMap = new Map(); this.datosTienda = new Map();
  }

  actualizar() {
    if (this.repo.enTx()) return;
    if (this.repo.generacion() !== this.gen || this.repo.seqMax() < this.seq) {
      this.reiniciar();
      this.gen = this.repo.generacion();
    }
    const { ops, hasta } = this.repo.opsDesde(this.seq);
    for (const o of ops) this.aplicar(o);
    this.seq = hasta;
  }

  private quitar(m: Map<string, Articulo[]>, k: string | null | undefined, a: Articulo) {
    if (!k) return;
    const l = m.get(k);
    if (!l) return;
    const r = l.filter((x) => x.item_id !== a.item_id);
    if (r.length) m.set(k, r); else m.delete(k);
  }
  private poner(m: Map<string, Articulo[]>, k: string | null | undefined, a: Articulo) {
    if (!k) return; // un código vacío NO identifica nada
    const l = m.get(k);
    if (l) l.push(a); else m.set(k, [a]);
  }
  private textoDe(a: Articulo) {
    return sinAcentos(`${a.marca} ${a.descripcion} ${a.estilo} ${a.lote} ${a.departamento ?? ''}`);
  }

  private aplicar(o: { tipo: string; op_id: string; payload: any; ocurrio_en: string }) {
    const p = o.payload;
    if (o.tipo.startsWith('giftcard.')) aplicarTarjeta(this.tarjetas, o);
    if (o.tipo === 'permiso.asignado') aplicarPermiso(this.permisos, o);
    if (o.tipo === 'promo.guardada') this.promos.set(p.id, p as Promocion);
    if (o.tipo === 'config.negocio') { const x = this.datosTienda.get(p.tienda) ?? {}; for (const c of CAMPOS_TIENDA) if (typeof p[c] === 'string') x[c] = p[c]; this.datosTienda.set(p.tienda, x); }
    if (o.tipo === 'supervisor.guardado') this.supervisoresMap.set(p.id, p as Supervisor);
    if (o.tipo.startsWith('depto.')) {
      const cambio = aplicarOpDepto(this.deptos, o);
      if (cambio) for (const a of this.cat.values()) if (a.departamento === cambio.de) { a.departamento = cambio.a; this.texto.set(a.item_id, this.textoDe(a)); }
    }
    if (o.tipo === 'config.tipo_cambio') this.tipos.set(p.version, { ...p, ocurrio_en: o.ocurrio_en });
    switch (o.tipo) {
      case 'item.created': {
        const a: Articulo = { ...p };
        this.cat.set(a.item_id, a);
        this.poner(this.porCodigo, a.codigo, a);
        this.poner(this.porAlterno, a.codigo_alterno, a);
        for (const k of clavesDeCatalogo(a.codigo)) this.poner(this.porClave, k, a);
        this.poner(this.porItemNo, a.item_no, a);
        this.texto.set(a.item_id, this.textoDe(a));
        break;
      }
      case 'item.editado': {
        const a = this.cat.get(p.item_id);
        if (a) {
          for (const [campo, c] of Object.entries(p.cambios as Record<string, { despues: unknown }>)) (a as any)[campo] = c.despues;
          this.texto.set(a.item_id, this.textoDe(a));
        }
        break;
      }
      case 'item.item_no_assigned': {
        const a = this.cat.get(p.item_id);
        if (a && a.item_no == null) { a.item_no = p.item_no; this.poner(this.porItemNo, a.item_no, a); }
        break;
      }
      case 'item.codigo_corregido': {
        const a = this.cat.get(p.item_id);
        if (a) {
          this.quitar(this.porCodigo, a.codigo, a); for (const k of clavesDeCatalogo(a.codigo)) this.quitar(this.porClave, k, a);
          a.codigo = p.codigo_nuevo; this.poner(this.porCodigo, a.codigo, a); for (const k of clavesDeCatalogo(a.codigo)) this.poner(this.porClave, k, a);
        }
        break;
      }
      case 'inv.movement': {
        if (p.tienda === LIMBO) this.enLimbo.add(p.item_id);
        let t = this.stock.get(p.tienda);
        if (!t) this.stock.set(p.tienda, (t = new Map()));
        t.set(p.item_id, (t.get(p.item_id) ?? 0) + p.delta);
        break;
      }
      case 'alm.faltante': {
        // Piezas faltantes ubicadas en una tienda: entran a su existencia; una corrección reemplaza a la anterior.
        const k = `${p.entrega_id}|${p.destino}`;
        const antes = this.faltantesTienda.get(k);
        if (antes) this.mover(antes.tienda, antes.item_id, -antes.qty);
        if (p.destino !== 'almacen' && p.destino !== 'perdida' && p.qty > 0) {
          this.mover(p.destino, p.item_id, p.qty);
          this.faltantesTienda.set(k, { tienda: p.destino, item_id: p.item_id, qty: p.qty });
        } else this.faltantesTienda.delete(k);
        break;
      }
      case 'inv.verificacion_pendiente': {
        const l = this.marcas.get(p.tienda);
        if (l) l.push(o.op_id); else this.marcas.set(p.tienda, [o.op_id]);
        break;
      }
      case 'inv.conteo': {
        const k = `${p.tienda}|${p.item_id}`;
        let s = this.cubiertas.get(k);
        if (!s) this.cubiertas.set(k, (s = new Set()));
        for (const id of p.cubre) s.add(id);
        break;
      }
      case 'doc.perdida_posible':
        this.perdidas.set(o.op_id, {
          perdida_id: o.op_id, tienda: p.tienda, caja: p.caja ?? null, ocurrio_en: o.ocurrio_en, alcance: p.alcance,
          folios_sin_evidencia: p.folios_sin_evidencia ?? null, evidencia: p.evidencia, estado: 'abierta',
        });
        break;
      case 'doc.perdida_resuelta': {
        const x = this.perdidas.get(p.perdida_id);
        if (x) { x.estado = 'declarada_irrecuperable'; x.resolucion = { usuario: p.usuario, evidencia: p.evidencia, nota: p.nota, ocurrio_en: o.ocurrio_en }; }
        break;
      }
    }
  }

  // ── consultas ──
  articulo(id: string): Articulo | undefined {
    this.actualizar();
    return this.cat.get(id);
  }
  buscarCodigo(codigo: string): Articulo[] {
    this.actualizar();
    return codigo ? (this.porCodigo.get(codigo) ?? []) : [];
  }
  /** Código escaneado que no es exacto: lo relaciona con el UPC completo (ceros a la izquierda y dígito verificador) o con su forma corta. */
  buscarCodigoAproximado(codigo: string): Articulo[] {
    this.actualizar();
    const k = claveDeEscaneo(codigo);
    return k ? (this.porClave.get(k) ?? []) : [];
  }
  buscarAlterno(codigo: string): Articulo[] {
    this.actualizar();
    return codigo ? (this.porAlterno.get(codigo) ?? []) : [];
  }
  /** Código exacto, Item # exacto, código alterno exacto, o texto contenido (sin acentos ni mayúsculas). */
  buscar(q: string, limite: number): { resultados: Articulo[]; total: number } {
    this.actualizar();
    const aprox = claveDeEscaneo(q);
    const exactos = [...new Set([...(this.porCodigo.get(q) ?? []), ...(this.porItemNo.get(q) ?? []), ...(this.porAlterno.get(q) ?? []), ...(aprox ? (this.porClave.get(aprox) ?? []) : [])])];
    const vistos = new Set(exactos.map((a) => a.item_id));
    const lista: Articulo[] = [...new Set(exactos)];
    // Texto: cada palabra debe aparecer (en cualquier orden); un número también coincide con el precio en pesos («pantimedias 189»).
    const palabras = sinAcentos(q).split(/\s+/).filter(Boolean);
    const precios = palabras.map((w) => (/^\d+(\.\d{1,2})?$/.test(w) ? Math.round(Number(w) * 100) : null));
    const hallados: Articulo[] = [];
    for (const [id, t] of this.texto) {
      if (vistos.has(id)) continue;
      const a = this.cat.get(id)!;
      if (palabras.every((w, i) => t.includes(w) || precios[i] === a.precio)) hallados.push(a);
    }
    // Primero los que EMPIEZAN con lo escrito (en la descripción), luego los que tienen una palabra que empieza así, y al final el resto;
    // a igual relevancia, el Item # más alto (el más reciente) primero.
    const rel = (a: Articulo) => {
      const d = sinAcentos(a.descripcion);
      if (d.startsWith(palabras[0] ?? '')) return 0;
      return palabras.every((w) => d.split(/[^a-z0-9]+/).some((x) => x.startsWith(w))) ? 1 : 2;
    };
    const no = (a: Articulo) => (a.item_no !== null && /^\d+$/.test(a.item_no) ? Number(a.item_no) : -1);
    hallados.sort((x, y) => rel(x) - rel(y) || no(y) - no(x));
    lista.push(...hallados.slice(0, Math.max(0, limite - lista.length)));
    return { resultados: lista.slice(0, limite), total: exactos.length + hallados.length };
  }
  /** ¿El artículo pertenece al catálogo inicial (tiene movimientos en El Limbo)? Sus ventas se descuentan de ahí. */
  esDeLimbo(itemId: string): boolean {
    this.actualizar();
    return this.enLimbo.has(itemId);
  }
  /** Existencia con la que cuenta una tienda para vender: la propia más la de El Limbo si el artículo es del catálogo inicial. */
  disponible(tienda: string, itemId: string): number {
    return this.saldo(tienda, itemId) + (this.esDeLimbo(itemId) ? this.saldo(LIMBO, itemId) : 0);
  }
  saldo(tienda: string, itemId: string): number {
    this.actualizar();
    return this.stock.get(tienda)?.get(itemId) ?? 0;
  }
  verificada(tienda: string, itemId: string): { verificada: boolean; pendientes: string[] } {
    this.actualizar();
    const m = this.marcas.get(tienda);
    if (!m?.length) return { verificada: true, pendientes: [] };
    const cub = this.cubiertas.get(`${tienda}|${itemId}`);
    const pendientes = cub ? m.filter((id) => !cub.has(id)) : m.slice();
    return { verificada: pendientes.length === 0, pendientes };
  }
  noVerificados(tienda: string): string[] {
    this.actualizar();
    if (!this.marcas.get(tienda)?.length) return [];
    return [...this.cat.keys()].filter((id) => !this.verificada(tienda, id).verificada);
  }
  perdidasAbiertas(tienda: string, caja: number): PerdidaDocumental[] {
    this.actualizar();
    return [...this.perdidas.values()].filter((p) => p.estado === 'abierta' && p.tienda === tienda && (p.caja === caja || p.caja === null));
  }
  todas(): PerdidaDocumental[] {
    this.actualizar();
    return [...this.perdidas.values()];
  }
  /** Promociones y cupones configurados en Administración (el último guardado de cada una). */
  promociones(): Promocion[] {
    this.actualizar();
    return [...this.promos.values()];
  }
  /** Datos de cada tienda editados en Administración (nombre, razón social, RFC, dirección, ciudad, teléfono, política de devolución). */
  datosDeTienda(): Map<string, DatosTienda> {
    this.actualizar();
    return new Map([...this.datosTienda].map(([t, d]) => [t, { ...d }]));
  }
  supervisores(): Supervisor[] {
    this.actualizar();
    return [...this.supervisoresMap.values()];
  }
  departamentos(): Departamento[] {
    this.actualizar();
    return this.deptos.map((d) => ({ ...d, alias: [...d.alias] }));
  }
  /** Tipo de cambio vigente (mayor versión) o null si aún no se ha fijado. */
  tipoCambio(): TipoCambio | null {
    this.actualizar();
    let v: TipoCambio | null = null;
    for (const t of this.tipos.values()) if (!v || t.version > v.version) v = t;
    return v;
  }
  historialTipoCambio(): TipoCambio[] {
    this.actualizar();
    return [...this.tipos.values()].sort((a, b) => a.version - b.version);
  }
  tienePermiso(usuario: string, permiso: string): boolean {
    this.actualizar();
    return this.permisos.get(usuario)?.has(permiso) ?? false;
  }
  permisosAsignados(): { usuario: string; permisos: string[] }[] {
    this.actualizar();
    return [...this.permisos].map(([usuario, s]) => ({ usuario, permisos: [...s] })).filter((x) => x.permisos.length);
  }
  tarjeta(codigo: string): TarjetaRegalo | undefined {
    this.actualizar();
    return this.tarjetas.get(codigo);
  }
  tarjetasTodas(): TarjetaRegalo[] {
    this.actualizar();
    return [...this.tarjetas.values()];
  }
  totalArticulos(): number {
    this.actualizar();
    return this.cat.size;
  }
}
