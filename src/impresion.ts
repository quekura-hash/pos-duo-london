import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TrabajoImpresion {
  ref: string;
  texto: string;
  bytes: Uint8Array;
}

/** Puerto de impresión. La implementación real (cola RAW de Windows hacia la Epson) está pendiente de validar en equipo. */
export interface Impresora {
  imprimir(t: TrabajoImpresion): Promise<void>;
}

/**
 * IMPRESORA SIMULADA: guarda los bytes ESC/POS y el texto en archivos. No es la Epson ni prueba el controlador, los acentos
 * físicos, el código de barras legible ni la apertura del cajón.
 */
export class ImpresoraArchivo implements Impresora {
  readonly dir: string;
  /** Si se define, la siguiente impresión falla con este mensaje (falla de impresora simulada). */
  falla: string | null = null;
  trabajos = 0;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }
  async imprimir(t: TrabajoImpresion): Promise<void> {
    if (this.falla) throw new Error(this.falla);
    this.trabajos++;
    const base = join(this.dir, `${String(this.trabajos).padStart(3, '0')}-${t.ref}`);
    writeFileSync(`${base}.bin`, t.bytes);
    writeFileSync(`${base}.txt`, t.texto);
  }
}
