import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { ServicioAdmin, ServicioCaja } from '../src/app/servicio.ts';
import { ImpresoraArchivo } from '../src/impresion.ts';
import { detectar } from '../src/incidencias.ts';
import { hojaInventario, leerInventario, PERFIL_CONFIRMADO, PERFIL_PRENDA_EN_NOMBRE } from '../src/inventario.ts';
import { catalogo } from '../src/proyecciones.ts';
import { escribirXlsxNode, leerXlsxNode } from '../src/xlsx-node.ts';
import { ENCABEZADOS_REALES, FILAS_REALISTAS, filasDeXlsx, operacionesRealistas, xlsxDeFilas } from './ayudas/inventario.ts';
import { ALMACENES, politica } from './ayudas/comun.ts';
import { fabricaMemoria, Mundo } from '../src/mundo.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mem = ALMACENES.find((a) => a.nombre === 'memoria')!;
void mem;

async function banco(perfil = PERFIL_CONFIRMADO, existenciaPrueba: Record<string, number> = { DUO: 10 }, p2: Record<string, unknown> = {}) {
  const { lectura, ops } = await operacionesRealistas(perfil, existenciaPrueba);
  const m = new Mundo({ fabrica: fabricaMemoria(), politicas: politica({ P02_existencia_insuficiente: 'bloquear', ...p2 }) });
  m.sembrarOps(ops);
  const dir = mkdtempSync(join(tmpdir(), 'pos-inv-'));
  const svc = new ServicioCaja({ caja: m.caja('DUO', 1), actor: { rol: 'cajero', usuario: 'Ana', tienda: 'DUO', caja: 1 }, impresora: new ImpresoraArchivo(dir), conexion: { hubAlcanzable: () => true, internet: () => null, pendientes: () => 0, ultimaSync: () => null }, reloj: m.reloj });
  const admin = new ServicioAdmin({ actor: { rol: 'admin', usuario: 'galo' }, fuente: () => m.central.repo.ops(), cajas: m.ctx.cajasCfg, inventario: m.inventarioCentral() });
  return { m, svc, admin, lectura, ops, limpiar: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('[memoria — inventario en Excel] Lectura, reporte, carga al sistema y exportación', () => {
  it('IX1b el formato corregido (Item Number, Descripcion, Marca, Estilo, Lote, Precio, UPC, departamento, cantidad, etiq precio, etiq costura) se lee con el mapeo confirmado y trae existencias', async () => {
    const encabezados = ['Item Number', 'Descripcion', 'Marca', 'Estilo', 'Lote', 'Precio', 'UPC', 'departamento', 'cantidad', 'etiq precio', 'etiq costura'];
    const filas = [
      [1, 'BLUSA', '', null, null, 169, '0021001403065', "Women's", 1, 'Yes', null],
      [2, 'PANTALON AMBIANCE', 'AMBIANCE', '726-', '20260913', 249, null, "Men's", -2, 'Yes', null],
      [3, 'CUPON', '', null, null, -50, '0121020030001', 'System', 0, 'Yes', null],
    ];
    const r = leerInventario(await filasDeXlsx(await xlsxDeFilas(filas as never, encabezados)), PERFIL_CONFIRMADO);
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.columnas.ignoradas, []);
    assert.deepEqual(r.columnas.faltantes.sort(), ['codigo_2', 'codigo_alterno', 'pedimento', 'precio_alterno']);
    assert.deepEqual([r.columnas.usadas.marca, r.columnas.usadas.descripcion, r.columnas.usadas.existencia, r.columnas.usadas.etiqueta_precio, r.columnas.usadas.etiqueta_costura], ['Marca', 'Descripcion', 'cantidad', 'etiq precio', 'etiq costura']);
    assert.deepEqual(r.articulos.map((a) => [a.item_no, a.codigo, a.descripcion, a.marca, a.precio, a.existencia]), [['1', '0021001403065', 'BLUSA', '', 16900, 1], ['2', '', 'PANTALON AMBIANCE', 'AMBIANCE', 24900, -2]]);
    assert.deepEqual(r.articulos.map((a) => [a.etiqueta_precio, a.etiqueta_costura]), [[true, null], [true, null]]);
    assert.equal(r.porTipo.find((x) => x.tipo === 'cupon_obsoleto')!.cantidad, 1, 'el cupón del sistema anterior se omite y se informa');
    assert.equal(r.estadisticas.cupones_omitidos, 1);
  });

  it('IX1 reconoce las columnas del archivo real y no ignora ninguna', async () => {
    const r = leerInventario(await filasDeXlsx(await xlsxDeFilas(FILAS_REALISTAS)));
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.columnas.ignoradas, []);
    assert.deepEqual(r.columnas.faltantes, ['existencia'], 'el archivo no trae cantidades: no se inventan');
    assert.equal(r.columnas.usadas.marca, 'Item Name');
    assert.equal(r.columnas.usadas.descripcion, 'Item Description');
    assert.equal(r.articulos.length, FILAS_REALISTAS.length - 1, 'el cupón obsoleto (precio negativo) no se importa');
  });

  it('IX2 códigos como texto con sus ceros; un código guardado como número se advierte y NO se reconstruye', async () => {
    const r = leerInventario(await filasDeXlsx(await xlsxDeFilas(FILAS_REALISTAS)));
    const por = (no: string) => r.articulos.find((a) => a.item_no === no)!;
    assert.equal(por('1').codigo, '0021001403065');
    assert.equal(por('702').codigo, '123456789012345678', 'un código de 18 caracteres no se trunca a notación científica');
    assert.equal(por('703').codigo, '7501234567', 'sin ceros inventados');
    assert.ok(r.anomalias.some((a) => a.tipo === 'codigo_numerico_posible_truncamiento' && a.item_no === '703'));
    assert.equal(por('16').lote, '20260913');
    assert.equal(por('701').lote, '27082005', 'un lote es texto, nunca fecha');
    assert.equal(por('700').estilo, '=SUM(1,2)', 'un texto que parece fórmula se conserva como texto');
  });

  it('IX3 Item # repetido: se importan las dos filas, se señalan y no se fusionan ni se renumeran', async () => {
    const { lectura, m } = await banco();
    const dups = lectura.anomalias.filter((a) => a.tipo === 'item_no_duplicado');
    assert.deepEqual(dups.map((a) => [a.fila, a.item_no]), [[5, '149'], [6, '149']]);
    const cat = catalogo(m.central.repo.ops());
    assert.deepEqual([...cat.values()].filter((a) => a.item_no === '149').map((a) => a.codigo).sort(), ['0021001404697', '0090001405485']);
    assert.ok(detectar(m.central.repo.ops()).some((i) => i.tipo === 'item_no_duplicado' && i.item_no === '149'));
  });

  it('IX4 sin UPC: se importa, no se escanea y se encuentra por Item #, código alterno o texto', async (t) => {
    const b = await banco();
    t.after(b.limpiar);
    const cart = b.svc.nuevaVenta();
    assert.equal(b.svc.escanear(cart, '').resultado, 'no_encontrado');
    assert.equal(b.svc.buscar('2').find((x) => x.item_no === '2')!.descripcion, '', 'con el mapeo confirmado la descripción de esta fila viene vacía');
    assert.deepEqual(b.svc.buscar('1010M3').map((x) => x.item_no), ['16']);
    const e = b.svc.escanear(cart, '1010M3'); // el código alterno también se puede escanear
    assert.equal(e.resultado, 'agregado');
    const r = b.svc.buscar('rhapsody')[0]!;
    assert.equal(r.codigo, '');
    const ag = b.svc.agregarArticulo(cart, r.item_id); // un artículo sin código se agrega eligiéndolo de la búsqueda
    assert.equal(ag.resultado, 'agregado');
    assert.equal(ag.carrito.lineas.length, 2);
  });

  it('IX5 precio 0 o ilegible: se importan y se señalan, pero NO se pueden vender; el cupón obsoleto (precio negativo) no se importa', async (t) => {
    const b = await banco();
    t.after(b.limpiar);
    const tipos = Object.fromEntries(b.lectura.porTipo.map((x) => [x.tipo, x.cantidad]));
    assert.deepEqual([tipos.precio_negativo, tipos.cupon_obsoleto, tipos.precio_cero, tipos.precio_con_centavos], [undefined, 1, 1, 1]);
    const cart = b.svc.nuevaVenta();
    assert.throws(() => b.svc.escanear(cart, '0000000000322'), { codigo: 'PRECIO_INVALIDO' });
    assert.equal(b.svc.escanear(cart, '0121020030001').resultado, 'no_encontrado', 'el cupón viejo ya no existe en el catálogo');
    assert.equal(b.svc.vista(cart).total, 0, 'un cupón nunca resta importe en silencio');
    assert.equal(b.svc.escanear(cart, '0000000003300').resultado, 'agregado');
    assert.equal(b.svc.vista(cart).total, 56350, 'precio con centavos exacto');
  });

  it('IX6 los dos perfiles de mapeo leen lo mismo salvo Marca y Descripción; el confirmado es el predeterminado', async () => {
    const { lectura: c } = await operacionesRealistas(PERFIL_CONFIRMADO);
    const { lectura: p } = await operacionesRealistas(PERFIL_PRENDA_EN_NOMBRE);
    const a = c.articulos[0]!, d = p.articulos[0]!;
    assert.deepEqual([a.marca, a.descripcion], ['BLUSA', 'blusa seksy']);
    assert.deepEqual([d.marca, d.descripcion], ['blusa seksy', 'BLUSA']);
    for (let i = 0; i < c.articulos.length; i++) {
      const { marca: _m1, descripcion: _d1, ...x } = c.articulos[i]!;
      const { marca: _m2, descripcion: _d2, ...y } = p.articulos[i]!;
      assert.deepEqual(x, y);
    }
  });

  it('IX7 el archivo no trae cantidades: sin existencia de prueba, nada se puede vender y el mensaje habla claro', async (t) => {
    const b = await banco(PERFIL_CONFIRMADO, {});
    t.after(b.limpiar);
    const cart = b.svc.nuevaVenta();
    b.svc.escanear(cart, '0031001403033');
    await assert.rejects(b.svc.cobrarEfectivo(cart, 100000), (e: any) => e.codigo === 'SIN_EXISTENCIA' && /CAMISA \(Item # 3\)/.test(e.message) && !/imp1-f/.test(e.message));
    assert.equal(b.m.caja('DUO', 1).repo.opsDeTipos(['inv.movement']).length, 0, 'ningún movimiento inventado');
  });

  it('IX8 la existencia de prueba es un movimiento marcado como prueba, solo para artículos vendibles', async (t) => {
    const b = await banco(PERFIL_CONFIRMADO, { DUO: 10, LON: 2 });
    t.after(b.limpiar);
    const movs = b.m.central.repo.opsDeTipos(['inv.movement']);
    assert.ok(movs.every((o) => o.payload.tipo === 'existencia_prueba' && /^prueba_sintetica:/.test(o.payload.doc)));
    const n = b.lectura.articulos.filter((a) => a.precio > 0).length;
    assert.equal(movs.length, n * 2);
    assert.equal(b.m.caja('LON', 2).stockLocal(b.m.central.repo.opsDeTipos(['item.created']).find((o) => o.payload.item_no === '3')!.payload.item_id), 2);
  });

  it('IX9 la carga es idempotente: cargar dos veces el mismo archivo no duplica artículos ni existencias', async () => {
    const { ops } = await operacionesRealistas();
    const m = new Mundo({ fabrica: fabricaMemoria(), politicas: politica() });
    m.sembrarOps(ops);
    const antes = m.central.repo.seqMax();
    m.sembrarOps(ops);
    assert.equal(m.central.repo.seqMax(), antes);
  });

  it('IX10 vender un artículo importado: la venta guarda Item #, Código, Descripción, Marca, Estilo y Lote del archivo', async (t) => {
    const b = await banco(PERFIL_CONFIRMADO);
    t.after(b.limpiar);
    const cart = b.svc.nuevaVenta();
    b.svc.escanear(cart, '7501234567890'); // ¡código repetido en el archivo! dos zapatos con el mismo UPC
    assert.equal(b.svc.escanear(cart, '7501234567890').resultado, 'ambiguo');
    const cart2 = b.svc.nuevaVenta();
    b.svc.escanear(cart2, '0021001403065');
    const r = await b.svc.cobrarEfectivo(cart2, 20000);
    const l = r.venta.lineas[0]!;
    assert.deepEqual([l.item_no, l.codigo, l.marca, l.descripcion, l.estilo, l.lote], ['1', '0021001403065', 'BLUSA', 'blusa seksy', '', '']);
    assert.match(r.ticket_texto, /Item #: 1 +Código: 0021001403065/);
    assert.equal(l.importe, 16900);
  });

  it('IX11 Administración exporta el inventario a Excel: texto como texto, precios numéricos, existencia por tienda y verificación', async (t) => {
    const b = await banco(PERFIL_CONFIRMADO, { DUO: 10, LON: 3 });
    t.after(b.limpiar);
    const cart = b.svc.nuevaVenta();
    b.svc.escanear(cart, '0031001403033');
    b.svc.cambiarCantidad(cart, b.svc.vista(cart).lineas[0]!.linea_id, 4);
    await b.svc.cobrarEfectivo(cart, 200000);
    b.m.pump();
    const { resumen, hoja } = b.admin.inventario(true);
    assert.equal((resumen as any).articulos, FILAS_REALISTAS.length - 1);
    assert.equal((resumen as any).por_tienda.DUO.piezas, 10 * b.lectura.articulos.filter((a) => a.precio > 0).length - 4, 'las ventas se descuentan; los artículos no vendibles no reciben existencia de prueba');
    const bytes = await escribirXlsxNode([hoja]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as never);
    const ws = wb.getWorksheet('Inventario')!;
    assert.deepEqual((ws.getRow(1).values as string[]).slice(1, 13), ['Item #', 'Código', 'Marca', 'Descripción', 'Estilo', 'Lote', 'Departamento', 'Precio de venta', 'Precio alterno', 'Código alterno', 'Etiqueta costura', 'Etiqueta precio']);
    const fila = (no: number) => { for (let r = 2; r <= ws.rowCount; r++) if (ws.getCell(r, 1).value === no) return r; throw new Error('sin fila'); };
    const r3 = fila(3);
    assert.equal(ws.getCell(r3, 2).value, '0031001403033', 'el código conserva los ceros');
    assert.equal(typeof ws.getCell(r3, 2).value, 'string');
    assert.equal(ws.getCell(r3, 8).value, 449, 'precio numérico');
    assert.equal(ws.getCell(r3, 9).value, 404.1);
    assert.equal(ws.getCell(r3, 13).value, 6, 'existencia DÚO: 10 − 4');
    assert.equal(ws.getCell(r3, 14).value, 3, 'existencia London');
    assert.equal(ws.getCell(r3, 15).value, 'Sí', 'verificada');
    const r700 = fila(700);
    const celdaEstilo = ws.getCell(r700, 5);
    assert.equal(celdaEstilo.value, '=SUM(1,2)', 'no se evalúa como fórmula');
    assert.equal(celdaEstilo.type, ExcelJS.ValueType.String);
    assert.equal(ws.getCell(r700, 6).value, '20261014', 'el lote sale como texto');
    assert.equal(ws.getCell(fila(16), 10).value, '1010M3');
  });

  it('IX12 ida y vuelta: lo exportado se vuelve a importar igual con cualquiera de los dos perfiles', async (t) => {
    const b = await banco();
    t.after(b.limpiar);
    const { hoja } = b.admin.inventario(true);
    const filas = await filasDeXlsx(await escribirXlsxNode([hoja]));
    const original = b.lectura.articulos;
    for (const perfil of [PERFIL_CONFIRMADO, PERFIL_PRENDA_EN_NOMBRE]) {
      const r = leerInventario(filas, perfil);
      assert.deepEqual(r.errores, []);
      assert.equal(r.articulos.length, original.length);
      const clave = (a: { item_no: string | null; codigo: string; marca: string; descripcion: string; estilo: string; lote: string; precio: number }) => [a.item_no, a.codigo, a.marca, a.descripcion, a.estilo, a.lote, a.precio].join('|');
      assert.deepEqual(r.articulos.map(clave).sort(), original.map(clave).sort(), perfil.id);
    }
  });

  it('IX13 exportar a un archivo y leerlo conserva ceros y lotes aunque la celda parezca número', async () => {
    const hoja = hojaInventario([
      { item_id: 'a', codigo: '0002026090782', item_no: '9', marca: 'M', descripcion: 'D', estilo: '00123', lote: '20260913', departamento: 'X', precio: 12345, origen: 't' },
    ], { tiendas: ['DUO'], saldo: () => 7, verificada: () => true });
    const filas = await filasDeXlsx(await escribirXlsxNode([hoja]));
    assert.equal(filas[1]![1], '0002026090782');
    assert.equal(filas[1]![4], '00123');
    assert.equal(filas[1]![5], '20260913');
    assert.equal(filas[1]![7], 123.45);
  });

  it('IX14 un archivo sin columnas indispensables se rechaza con un mensaje claro', async () => {
    const r = leerInventario(await filasDeXlsx(await xlsxDeFilas([[1, 'X']], ['Item Number', 'Item Name'])));
    assert.ok(r.errores.some((e) => /UPC/.test(e)) && r.errores.some((e) => /precio/i.test(e)));
    assert.equal(r.articulos.length, 0);
  });

  it('IX15 volumen real: 21,220 filas se leen, se cargan y se escanean con rapidez', async () => {
    const filas: (string | number | null)[][] = [ENCABEZADOS_REALES];
    for (let i = 1; i <= 21220; i++) {
      filas.push([i, i % 3 ? `VESTIDO M${i % 97}` : 'BLUSA', i % 5 ? '' : 'MARCA', null, i % 4 ? `E${i}` : null, i % 9 ? null : '20260913', 199 + (i % 20) * 50, 0, i % 33 ? String(i).padStart(13, '0') : null, 'System', null, 'Yes', null, null]);
    }
    let t = Date.now();
    const lectura = leerInventario(filas);
    const msLeer = Date.now() - t;
    const { aOperacionesInventario } = await import('../src/inventario.ts');
    const { ops } = aOperacionesInventario(lectura.articulos, { ahora: '2026-10-01T15:00:00Z', idImportacion: 'big', existenciaPrueba: { DUO: 5 } });
    const m = new Mundo({ fabrica: fabricaMemoria(), politicas: politica({ P02_existencia_insuficiente: 'bloquear' }) });
    t = Date.now();
    m.sembrarOps(ops);
    const msCargar = Date.now() - t;
    const caja = m.caja('DUO', 1);
    const cart = caja.abrirCarrito();
    caja.escanear(cart, String(7).padStart(13, '0'));
    t = Date.now();
    for (let i = 8; i < 308; i++) if (i % 33) caja.escanear(cart, String(i).padStart(13, '0'));
    const msEscanear = Date.now() - t;
    t = Date.now();
    const venta = caja.cobrarEfectivo(cart, 100_000_000);
    const msCobrar = Date.now() - t;
    assert.equal(venta.folio, 1);
    assert.ok(msLeer < 3000, `leer ${msLeer} ms`);
    assert.ok(msCargar < 3000, `cargar ${msCargar} ms`);
    assert.ok(msEscanear < 1000, `300 escaneos ${msEscanear} ms`);
    assert.ok(msCobrar < 1500, `cobrar ${msCobrar} ms`);
  });
});

const REAL = process.env.POS_INVENTARIO_REAL;
describe('[archivo real] Inventario real de DÚO (solo si POS_INVENTARIO_REAL apunta al .xlsx; no se guarda en el repositorio)', { skip: REAL && existsSync(REAL) ? false : 'defina POS_INVENTARIO_REAL con la ruta del inventario' }, () => {
  it('IR1 los números del archivo real (inventario_POS.xlsx: columnas Item Number, Descripcion, Marca, Estilo, Lote, Precio, UPC, departamento, cantidad, etiq precio, etiq costura)', async () => {
    const hojas = await leerXlsxNode(readFileSync(REAL!));
    assert.equal(hojas.length, 1);
    const c = leerInventario(hojas[0]!.filas, PERFIL_CONFIRMADO);
    assert.deepEqual(c.errores, []);
    assert.deepEqual(c.columnas.ignoradas, [], 'ninguna columna se ignora');
    assert.deepEqual(Object.values(c.columnas.usadas).sort(), ['Descripcion', 'Estilo', 'Item Number', 'Lote', 'Marca', 'Precio', 'UPC', 'cantidad', 'departamento', 'etiq costura', 'etiq precio']);
    const e = c.estadisticas;
    assert.deepEqual(
      [e.filas, e.con_codigo, e.sin_codigo, e.item_no_duplicados, e.codigos_duplicados, e.precio_no_vendible, e.descripcion_vacia],
      [21220, 20565, 655, 3, 0, 187, 0],
      'con las columnas ya corregidas el mapeo confirmado (Marca / Descripcion) funciona sin perfil alterno',
    );
    assert.equal(c.porTipo.find((x) => x.tipo === 'cupon_obsoleto')!.cantidad, 133);
    assert.equal(c.porTipo.find((x) => x.tipo === 'precio_cero')!.cantidad, 54);
    const q = c.articulos.map((a) => a.existencia as number);
    assert.deepEqual([q.length, q.filter((x) => x < 0).length, q.filter((x) => x === 0).length], [21220, 2101, 3165], 'la columna cantidad trae existencias, con negativas');
  });
});
