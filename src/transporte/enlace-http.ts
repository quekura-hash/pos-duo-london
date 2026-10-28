import type { Anclas, Enlace, ResultadoReserva } from '../nodos.ts';
import type { BusquedaVentas, VentaLocalizada } from '../consultas.ts';
import type { Venta } from '../tipos.ts';
import type { SyncHttp } from './http-sync.ts';

/** Enlace de una caja con su hub REAL por HTTP en la red local. Si el hub no responde, devuelve null/false. */
export class EnlaceHttp implements Enlace {
  readonly url: string;
  readonly caja: number;
  readonly http: SyncHttp;
  /** Interruptor de partición simulada (además de la caída real del hub). */
  desconectado = false;

  constructor(url: string, caja: number, http: SyncHttp) {
    this.url = url;
    this.caja = caja;
    this.http = http;
  }
  private rpc<T>(metodo: string, args: unknown[]): { alcanzado: boolean; valor: T | null } {
    if (this.desconectado) return { alcanzado: false, valor: null };
    const r = this.http.post(`${this.url}/rpc`, { metodo, args }, 3000);
    if (!r || r.status !== 200 || !r.json?.ok) return { alcanzado: false, valor: null };
    return { alcanzado: true, valor: r.json.valor as T };
  }
  hubAlcanzable(): boolean {
    if (this.desconectado) return false;
    const r = this.http.post(`${this.url}/ping`, {}, 800);
    return !!r && r.status === 200;
  }
  arrendarFolios(ultimo: number, k: number): number | null {
    return this.rpc<number>('arrendar', [this.caja, ultimo, k]).valor;
  }
  anclasFolios(): Anclas | null {
    return this.rpc<Anclas>('anclas', [this.caja]).valor;
  }
  bloqueItemNo(): { desde: number; hasta: number } | null {
    return null; // sin central en estas pruebas
  }
  consultarVenta(saleId: string): Venta | null {
    return this.rpc<Venta>('consultarVenta', [saleId]).valor;
  }
  devueltoAutoritativo(saleId: string) {
    const r = this.rpc<[string, { qty: number; importe: number }][]>('devuelto', [saleId]);
    return r.alcanzado ? new Map(r.valor ?? []) : null;
  }
  consultarRecompensa(codigo: string) {
    return this.rpc<import('../recompensas.ts').EstadoRecompensa>('consultarRecompensa', [codigo]).valor;
  }
  reservar(ref: string, caja: number, lineas: { item_id: string; qty: number }[], tarjetas: { codigo: string; monto: number }[] = []): ResultadoReserva | null {
    return this.rpc<ResultadoReserva>('reservar', [ref, caja, lineas, tarjetas]).valor;
  }
  fijarTipoCambio(): null {
    return null; // sin central en estas pruebas
  }
  buscarVentas(q: BusquedaVentas): VentaLocalizada[] | null {
    return this.rpc<VentaLocalizada[]>('buscarVentas', [q]).valor;
  }
  totalesVentas(desde: string, hasta: string): Record<string, number> | null {
    return this.rpc<Record<string, number>>('totalesVentas', [desde, hasta]).valor;
  }
  liberar(ref: string): void {
    this.rpc('liberar', [ref]);
  }
}
