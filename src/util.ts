import { randomUUID } from 'node:crypto';
import type { Op } from './tipos.ts';

export class Reloj {
  ms: number;
  constructor(inicio = '2026-10-01T15:00:00Z') {
    this.ms = Date.parse(inicio);
  }
  now() {
    return new Date(this.ms).toISOString();
  }
  avanzar(ms: number) {
    this.ms += ms;
  }
  fijar(iso: string) {
    this.ms = Date.parse(iso);
  }
}

/** America/Hermosillo = UTC-7 fijo (sin horario de verano). Devuelve YYYY-MM-DD local. */
export function fechaLocal(iso: string): string {
  return new Date(Date.parse(iso) - 7 * 3600_000).toISOString().slice(0, 10);
}

export const uuid = () => randomUUID();

export function crearOp(
  tipo: string, tienda: string | null, caja: number | null, origen: string,
  ocurrio_en: string, payload: unknown, op_id: string = `${tipo}:${uuid()}`,
): Op {
  return { op_id, tipo, tienda, caja, origen, ocurrio_en, payload };
}

/** Centavos desde texto o número sin pasar por coma flotante. "$1,234.5" -> 123450. */
export function aCentavos(v: string | number): number {
  const s = String(v).replace(/[$,\s]/g, '');
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`importe inválido: ${v}`);
  const c = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || 0);
  return m[1] ? -c : c;
}

export function aMXN(centavos: number): string {
  const neg = centavos < 0;
  const a = Math.abs(centavos);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
