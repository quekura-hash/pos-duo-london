import type { Repo } from '../repo.ts';
import type { Op } from '../tipos.ts';

/** Fila de `pos.ops` tal como la devuelve el central. */
export interface FilaCentral {
  seq: number;
  op_id: string;
  tipo: string;
  tienda: string | null;
  caja: number | null;
  origen: string;
  ocurrio_en: string;
  payload: unknown;
}

/** Lo que el puente necesita del central (Supabase en producción, Postgres local en las pruebas). */
export interface ClienteCentral {
  subirOps(ops: Pick<Op, 'op_id' | 'tipo' | 'tienda' | 'caja' | 'ocurrio_en' | 'payload'>[]): Promise<{ nuevas: number; ultimo_seq: number }>;
  bajarOps(desde: number, limite: number): Promise<FilaCentral[]>;
  /** Ventas por día calculadas en el central (la barra de metas de la caja). Opcional: sin él la caja calcula con lo que tiene. */
  ventasPorDia?(desde: string, hasta: string): Promise<{ tienda: string; fecha: string; total: number }[]>;
}

interface Cursores { remoto: number; local: number }
const CLAVE = 'puente_central';
export const LOTE = 500;

export interface ResultadoPuente { ok: boolean; subidas: number; bajadas: number; error?: string }

/**
 * Mantiene una réplica local al día con el central: sube las operaciones nuevas hechas aquí (idempotente por op_id)
 * y baja las que llegaron de otros. La réplica local es el MISMO motor de siempre; el central solo aloja la bitácora.
 * Reintentable: si algo falla a medias, el siguiente intento continúa desde los cursores guardados.
 */
export class PuenteCentral {
  private enCurso: Promise<ResultadoPuente> | null = null;
  /** Operaciones bajadas del central que aún no pasó el cursor local (no hay que devolvérselas). */
  private delCentral = new Set<string>();
  readonly repo: Repo;
  readonly cliente: ClienteCentral;
  /** Se llama con cada operación que llegó del central (para refrescar proyecciones o la pantalla). */
  alBajar?: (ops: Op[]) => void;

  constructor(repo: Repo, cliente: ClienteCentral) {
    this.repo = repo;
    this.cliente = cliente;
  }

  cursores(): Cursores {
    return this.repo.kvGet<Cursores>(CLAVE) ?? { remoto: 0, local: 0 };
  }

  /** Operaciones locales que el central aún no confirmó. */
  pendientes(): number {
    return this.repo.opsDesde(this.cursores().local).ops.length;
  }

  sincronizar(): Promise<ResultadoPuente> {
    this.enCurso ??= this.ciclo().finally(() => { this.enCurso = null; });
    return this.enCurso;
  }

  private async ciclo(): Promise<ResultadoPuente> {
    let subidas = 0;
    let bajadas = 0;
    try {
      // 1) Subir lo local posterior al cursor, salvo lo que acabamos de bajar del central.
      for (;;) {
        const { ops, hasta } = this.repo.opsDesde(this.cursores().local);
        if (!ops.length) break;
        const propias = ops.filter((o) => !this.delCentral.has(o.op_id));
        for (let i = 0; i < propias.length; i += LOTE) subidas += (await this.cliente.subirOps(propias.slice(i, i + LOTE))).nuevas;
        // Un fallo a medias reenvía lo ya subido: el central lo ignora por op_id.
        this.repo.kvSet(CLAVE, { ...this.cursores(), local: hasta });
        for (const o of ops) this.delCentral.delete(o.op_id);
      }
      // 2) Bajar lo nuevo del central.
      for (;;) {
        const filas = await this.cliente.bajarOps(this.cursores().remoto, LOTE);
        if (!filas.length) break;
        const nuevas: Op[] = [];
        // Si no hay nada local por subir, todo lo que entra ahora es del central: el cursor local lo cubre aunque el programa se cierre antes del siguiente ciclo.
        const sinPendientes = this.cursores().local === this.repo.seqMax();
        this.repo.tx(() => {
          for (const f of filas) {
            const op: Op = { op_id: f.op_id, tipo: f.tipo, tienda: f.tienda, caja: f.caja, origen: f.origen, ocurrio_en: f.ocurrio_en, payload: f.payload };
            if (this.repo.appendOp(op)) { nuevas.push(op); this.delCentral.add(op.op_id); }
          }
        });
        bajadas += nuevas.length;
        this.repo.kvSet(CLAVE, { remoto: filas[filas.length - 1]!.seq, local: sinPendientes ? this.repo.seqMax() : this.cursores().local });
        if (nuevas.length) this.alBajar?.(nuevas);
        if (filas.length < LOTE) break;
      }
      return { ok: true, subidas, bajadas };
    } catch (e) {
      return { ok: false, subidas, bajadas, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
