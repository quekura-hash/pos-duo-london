import { aCentavos } from './util.ts';
import type { Articulo } from './tipos.ts';

export interface FilaOrigen {
  'Item #'?: string | number | null;
  UPC?: string | number | null;
  'Dept Name'?: string;
  'Item Name'?: string;
  'Item Description'?: string;
  Attribute?: string;
  Size?: string | number;
  'Regular Price'?: string | number;
  'On-Hand Qty'?: number;
}

export interface ResultadoImportacion {
  altas: Omit<Articulo, 'item_id' | 'origen'>[];
  actualizaciones: { codigo: string; cambios: string[] }[];
  conflictos: { tipo: 'codigo_con_otro_item_no' | 'item_no_con_otro_codigo' | 'codigo_repetido_en_archivo'; codigo: string; item_no: string | null; con?: string }[];
  advertencias: { fila: number; tipo: string; valor: unknown }[];
  errores: { fila: number; motivo: string }[];
}

/**
 * Mapeo confirmado: Item Name→Marca, Item Description→Descripción, Attribute→Estilo,
 * Size→LOTE (nunca talla), UPC→Código (texto), Item #→Item # original.
 * Regla de identidad: el código manda; mismo nombre/estilo con código distinto = artículos distintos;
 * conflictos se REPORTAN, no se fusionan ni se renumeran.
 */
export function importarCatalogo(filas: FilaOrigen[], existentes: Articulo[]): ResultadoImportacion {
  const r: ResultadoImportacion = { altas: [], actualizaciones: [], conflictos: [], advertencias: [], errores: [] };
  const vistosEnArchivo = new Map<string, number>();
  filas.forEach((f, i) => {
    const n = i + 1;
    if (f.UPC == null || String(f.UPC).trim() === '') return void r.errores.push({ fila: n, motivo: 'sin código' });
    // Si Excel entregó un número, ya pudo haber perdido ceros: se advierte, NO se reconstruye.
    if (typeof f.UPC === 'number') r.advertencias.push({ fila: n, tipo: 'codigo_numerico_posible_truncamiento', valor: f.UPC });
    const codigo = String(f.UPC);
    const item_no = f['Item #'] == null || f['Item #'] === '' ? null : String(f['Item #']);
    if (vistosEnArchivo.has(codigo)) {
      r.conflictos.push({ tipo: 'codigo_repetido_en_archivo', codigo, item_no });
      return;
    }
    vistosEnArchivo.set(codigo, n);

    const porCodigo = existentes.find((a) => a.codigo === codigo);
    const porNo = item_no == null ? undefined : existentes.find((a) => a.item_no === item_no);
    if (porCodigo && item_no != null && porCodigo.item_no != null && porCodigo.item_no !== item_no) {
      return void r.conflictos.push({ tipo: 'codigo_con_otro_item_no', codigo, item_no, con: porCodigo.item_no });
    }
    if (porNo && porNo.codigo !== codigo) {
      return void r.conflictos.push({ tipo: 'item_no_con_otro_codigo', codigo, item_no, con: porNo.codigo });
    }
    let precio = 0;
    try {
      precio = f['Regular Price'] == null ? 0 : aCentavos(f['Regular Price']);
    } catch {
      return void r.errores.push({ fila: n, motivo: `precio inválido: ${f['Regular Price']}` });
    }
    const nuevo = {
      codigo, item_no,
      marca: f['Item Name'] ?? '', descripcion: f['Item Description'] ?? '', estilo: String(f.Attribute ?? ''),
      lote: String(f.Size ?? ''), departamento: f['Dept Name'] ?? '', precio,
    };
    if (porCodigo) {
      const cambios = (['marca', 'descripcion', 'estilo', 'lote', 'departamento', 'precio'] as const).filter((k) => porCodigo[k] !== nuevo[k]);
      if (cambios.length) r.actualizaciones.push({ codigo, cambios });
    } else {
      r.altas.push(nuevo);
    }
  });
  return r;
}
