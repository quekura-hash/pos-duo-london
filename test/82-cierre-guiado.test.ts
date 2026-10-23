import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { centralLocal } from './ayudas/central-pglite.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

const JEANS = '0002026090782', MASCADA = '7501234567890';
const pesos = (n: number) => Math.round(n * 100);
/** Denominaciones (centavos → cantidad) que suman exactamente `n` pesos con monedas y billetes del fondo. */
const den = (n: number) => {
  const out: Record<string, number> = {};
  let resto = pesos(n);
  for (const d of [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100]) { const k = Math.floor(resto / d); if (k) { out[String(d)] = k; resto -= k * d; } }
  assert.equal(resto, 0);
  return out;
};

porAlmacen('Cierre de caja guiado: fondo fijo, conteo de ventas, diferencias registradas y permisos', (alm) => {
  const preparar = async (t: { after(f: () => void): void }) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    const caja = await appCajero(ctx, 'DUO', 1, 'Ana'); t.after(() => caja.cerrar());
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Lupe', clave: '4321' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Lupe', clave: '4321' });
    return { ctx, adm, caja };
  };
  const vender = async (caja: any, codigo: string, precio: number) => {
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    const l = (await api(caja.url, '/api/venta/escanear', { cart, codigo })).json.linea;
    const e = await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, precio_unit: pesos(precio), clave: '2468' });
    assert.equal(e.status, 200, JSON.stringify(e.json));
    return (await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: pesos(precio) })).json.venta;
  };
  const cierre = async (caja: any) => (await api(caja.url, '/api/corte')).json;
  const fondo = (caja: any, d: Record<string, number>, nota?: string) => api(caja.url, '/api/cierre/fondo', { denominaciones: d, nota });
  const conteo = (caja: any, n: number) => api(caja.url, '/api/efectivo/conteo', { moneda: 'MXN', denominaciones: den(n), alcance: 'ventas' });

  it('CG1 el fondo autorizado es de Administración ($5,000 por defecto); la cajera solo cuenta; fondo completo exige el importe exacto y no es movimiento de efectivo', async (t) => {
    const { ctx, adm, caja } = await preparar(t);
    assert.equal((await cierre(caja)).vivo.fondo_autorizado, pesos(5000), 'sin asignación: $5,000');
    // la cajera no puede asignar el fondo (rutas de Administración) ni registrarlo como movimiento
    assert.equal((await api(caja.url, '/api/admin/cajas/fondo', { tienda: 'DUO', caja: 1, monto: pesos(9000), motivo: 'x' })).status >= 400, true);
    const mov = await api(caja.url, '/api/efectivo/movimiento', { tipo: 'fondo_inicial', monto: pesos(5000) });
    assert.equal(mov.json.error.codigo, 'PROHIBIDO');
    // conteo de ventas antes de confirmar el fondo: no
    assert.equal((await conteo(caja, 100)).json.error.codigo, 'FONDO_PENDIENTE');
    // fondo con faltante: pide nota; la moneda de 50 centavos no se admite
    const corto = await fondo(caja, den(4900));
    assert.equal(corto.json.error.codigo, 'FONDO_NO_COINCIDE');
    assert.equal((await fondo(caja, { '50': 2, ...den(4999) }, 'x nota')).json.error.codigo, 'CONTEO_INVALIDO');
    // exacto: completo
    const ok = await fondo(caja, den(5000));
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const v = (await cierre(caja)).vivo;
    assert.deepEqual([v.fondo_confirmado, v.fondo_estado, v.fondo_diferencia], [pesos(5000), 'completo', 0]);
    assert.equal(v.efectivo_esperado, 0, 'separar el fondo no es ingreso: no entra al efectivo esperado');
    assert.equal(v.fondo_inicial, 0);
    // Administración asigna otro fondo; llega a la caja y la diferencia se registra con nota
    const r = await api(adm.url, '/api/admin/cajas/fondo', { tienda: 'DUO', caja: 1, monto: pesos(6000), motivo: 'más cambio en temporada' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    assert.equal((await cierre(caja)).vivo.fondo_autorizado, pesos(6000));
    const f = await fondo(caja, den(5000), 'faltante por pago de barrendero');
    assert.equal(f.status, 200, JSON.stringify(f.json));
    const v2 = (await cierre(caja)).vivo;
    assert.deepEqual([v2.fondo_estado, v2.fondo_diferencia, v2.fondo_nota], ['faltante', -pesos(1000), 'faltante por pago de barrendero']);
    // historial de Administración (la confirmación del fondo sube al central)
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const h = (await api(adm.url, '/api/admin/cajas/fondo')).json.cajas.find((c: any) => c.caja === 1);
    assert.deepEqual([h.fondo, h.historial.length, h.ultimo_fondo.estado], [pesos(6000), 1, 'faltante']);
  });

  it('CG2 flujo completo con tus cifras: fondo $5,000 + ventas netas $7,399 → cierre con clave, sin diferencias; el fondo no se duplica', async (t) => {
    const { caja } = await preparar(t);
    // $8,000 en ventas, cambio de $500 por $899 (+$399), devolución de $1,000 en efectivo
    const v6500 = await vender(caja, JEANS, 6500), v500 = await vender(caja, MASCADA, 500), v1000 = await vender(caja, MASCADA, 1000);
    const cart = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/cambio/iniciar', { cart, sale_id: v500.sale_id, renglones: [{ linea_id: v500.lineas[0].linea_id, qty: 1 }], clienta: { nombre: 'Ana López', telefono: '6531234567' }, motivo: 'no le quedó' });
    const l = (await api(caja.url, '/api/venta/escanear', { cart, codigo: JEANS })).json.linea;
    await api(caja.url, '/api/venta/editar-linea', { cart, linea_id: l.linea_id, precio_unit: pesos(899), clave: '2468' });
    assert.equal((await api(caja.url, '/api/venta/cobrar-efectivo', { cart, recibido: pesos(399) })).status, 200);
    assert.equal((await api(caja.url, '/api/venta/devolver', { sale_id: v1000.sale_id, renglones: [{ linea_id: v1000.lineas[0].linea_id, qty: 1 }], motivo: 'defecto', autoriza: { nombre: 'Edgardo', clave: '2468' } })).status, 200);
    void v6500;
    // sin fondo ni conteo no se puede cerrar
    const temprano = await api(caja.url, '/api/corte/cerrar', { clave: '4321' });
    assert.equal(temprano.json.error.codigo, 'CIERRE_INCOMPLETO');
    assert.deepEqual((await cierre(caja)).estado.faltan, ['fondo', 'conteo_ventas']);
    // paso 1 y paso 2
    assert.equal((await fondo(caja, den(5000))).status, 200);
    assert.equal((await conteo(caja, 7399)).status, 200);
    const j = await cierre(caja);
    assert.equal(j.estado.puede_cerrar, true);
    assert.deepEqual([j.vivo.efectivo_esperado, j.vivo.efectivo_ventas_esperado, j.vivo.diferencia_mxn, j.vivo.conteo_alcance], [pesos(7399), pesos(7399), 0, 'ventas']);
    // cierre: pide la clave de la propia cajera
    assert.equal((await api(caja.url, '/api/corte/cerrar', { clave: '0000' })).json.error.codigo, 'CLAVE_INVALIDA');
    const antesCierre = readdirSync(caja.s.impresora.dir).filter((f) => f.endsWith('.txt')).length;
    const c = await api(caja.url, '/api/corte/cerrar', { clave: '4321', observaciones: 'Corte sin incidencias.' });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.equal(readdirSync(caja.s.impresora.dir).filter((f) => f.endsWith('.txt')).length, antesCierre + 1, 'al cerrar sale el ticket de cierre');
    assert.match(c.json.ticket_texto, /CIERRE DE CAJA[\s\S]*VENTA TOTAL DEL DÍA/);
    assert.deepEqual([c.json.corte.cerrado_por, c.json.corte.observaciones, c.json.corte.fondo_confirmado, c.json.corte.fondo_autorizado, c.json.corte.diferencia_mxn], ['Lupe', 'Corte sin incidencias.', pesos(5000), pesos(5000), 0]);
    // cerrado: no se modifica el fondo ni se cierra dos veces; el cierre guardado no cambia
    assert.equal((await fondo(caja, den(5000))).json.error.codigo, 'CORTE_CERRADO');
    const otra = await api(caja.url, '/api/corte/cerrar', { clave: '4321', observaciones: 'otra' });
    assert.equal(otra.json.corte.observaciones, 'Corte sin incidencias.');
    const j2 = await cierre(caja);
    assert.equal(j2.desactualizado, false);
  });

  it('CG3 los faltantes y sobrantes se registran, no se corrigen; un conteo viejo obliga a recontar; hace falta contar dólares si los hubo', async (t) => {
    const { ctx, caja } = await preparar(t);
    await vender(caja, MASCADA, 500);
    await fondo(caja, den(5000));
    await conteo(caja, 400); // faltan $100
    let v = (await cierre(caja)).vivo;
    assert.deepEqual([v.efectivo_ventas_esperado, v.mxn.contado, v.diferencia_mxn], [pesos(500), pesos(400), -pesos(100)]);
    // una venta después del conteo lo deja desactualizado: hay que recontar
    ctx.m.reloj.avanzar(60_000);
    await vender(caja, MASCADA, 120);
    const est = (await cierre(caja)).estado;
    assert.deepEqual(est.faltan, ['recontar_ventas']);
    assert.equal((await api(caja.url, '/api/corte/cerrar', { clave: '4321' })).json.error.codigo, 'CIERRE_INCOMPLETO');
    ctx.m.reloj.avanzar(60_000);
    await conteo(caja, 650); // sobran $30
    v = (await cierre(caja)).vivo;
    assert.equal(v.diferencia_mxn, pesos(30));
    const c = await api(caja.url, '/api/corte/cerrar', { clave: '4321', observaciones: 'sobrante por propina' });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.equal(c.json.corte.diferencia_mxn, pesos(30), 'el sobrante queda registrado tal cual');
    assert.equal(c.json.corte.conteo_mxn.contado, pesos(650));
  });

  it('CG4 entradas extraordinarias: solo con clave de supervisor, motivo y referencia única (sin duplicar); los retiros tienen su módulo', async (t) => {
    const { caja } = await preparar(t);
    const entrada = (o: object) => api(caja.url, '/api/efectivo/entrada', { monto: pesos(300), moneda: 'MXN', ...o });
    assert.equal((await entrada({ ref: 'e1', motivo: 'cambio de la tienda de junto' })).json.error.codigo, 'AUTORIZACION_REQUERIDA');
    assert.equal((await entrada({ ref: 'e1', motivo: 'x', clave: '2468' })).json.error.codigo, 'DATOS_REQUERIDOS');
    assert.equal((await entrada({ motivo: 'cambio de la tienda de junto', clave: '2468' })).json.error.codigo, 'DATOS_REQUERIDOS', 'sin referencia');
    const ok = await entrada({ ref: 'e1', motivo: 'cambio de la tienda de junto', clave: '2468' });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    await entrada({ ref: 'e1', motivo: 'cambio de la tienda de junto', clave: '2468' }); // doble clic / reintento
    assert.equal((await cierre(caja)).vivo.entradas, pesos(300), 'no se duplicó');
    const ex = (await api(caja.url, '/api/efectivo/extraordinarias')).json.operaciones;
    assert.deepEqual(ex.map((x: any) => [x.tipo, x.monto, x.autorizado_por]), [['entrada', pesos(300), 'Edgardo']]);
    assert.equal((await api(caja.url, '/api/efectivo/movimiento', { tipo: 'retiro', monto: pesos(100) })).json.error.codigo, 'PROHIBIDO');
  });

  it('CG5 Administración registra una entrega o ajuste de efectivo en una caja: llega a su libro y cuenta en el esperado con motivo y auditoría', async (t) => {
    const { ctx, adm, caja } = await preparar(t);
    const r = await api(adm.url, '/api/admin/cajas/ajuste', { tienda: 'DUO', caja: 1, tipo: 'entrada', monto: pesos(1000), motivo: 'entrega de cambio', ref: 'aj-1' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    await api(adm.url, '/api/admin/cajas/ajuste', { tienda: 'DUO', caja: 1, tipo: 'entrada', monto: pesos(1000), motivo: 'entrega de cambio', ref: 'aj-1' }); // reintento
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    const v = (await cierre(caja)).vivo;
    assert.deepEqual([v.ajustes_admin, v.efectivo_esperado], [pesos(1000), pesos(1000)]);
    const ex = (await api(caja.url, '/api/efectivo/extraordinarias')).json.operaciones;
    assert.deepEqual(ex.map((x: any) => [x.tipo, x.monto]), [['ajuste_entrada', pesos(1000)]]);
    assert.equal((await api(adm.url, '/api/admin/cajas/ajuste', { tienda: 'DUO', caja: 1, tipo: 'entrada', monto: pesos(10), motivo: '', ref: 'aj-2' })).status >= 400, true, 'sin motivo no se registra');
    assert.equal((await api(caja.url, '/api/admin/cajas/ajuste', { tienda: 'DUO', caja: 1, tipo: 'entrada', monto: pesos(10), motivo: 'x y z', ref: 'aj-3' })).status >= 400, true, 'una caja no puede');
  });

  it('CG6 dólares: si hubo, su conteo es obligatorio y se concilia aparte; un conteo anterior (cajón completo) se sigue comparando con el esperado completo', async (t) => {
    const { ctx, caja } = await preparar(t);
    // movimiento en dólares por la vía del dominio (entrada autorizada): US$100 en el cajón
    const e = await api(caja.url, '/api/efectivo/entrada', { monto: 10000, moneda: 'USD', motivo: 'dólares del cambio', clave: '2468', ref: 'u1' });
    assert.equal(e.status, 200, JSON.stringify(e.json));
    await fondo(caja, den(5000));
    await conteo(caja, 0);
    assert.deepEqual((await cierre(caja)).estado.faltan, ['conteo_usd'], 'con dólares en el cajón hay que contarlos');
    assert.equal((await api(caja.url, '/api/corte/cerrar', { clave: '4321' })).json.error.codigo, 'CIERRE_INCOMPLETO');
    ctx.m.reloj.avanzar(1000);
    await api(caja.url, '/api/efectivo/conteo', { moneda: 'USD', denominaciones: { '100': 1 } });
    const v = (await cierre(caja)).vivo;
    assert.deepEqual([v.efectivo_usd_esperado, v.usd.contado, v.diferencia_usd], [10000, 10000, 0]);
    // un conteo de pesos del formato anterior (sin alcance) se compara con el esperado completo
    await api(caja.url, '/api/efectivo/conteo', { moneda: 'MXN', denominaciones: den(10) });
    const v2 = (await cierre(caja)).vivo;
    assert.deepEqual([v2.conteo_alcance, v2.diferencia_mxn], ['cajon', pesos(10)]);
  });

  it('CG8 el ticket de cierre se imprime solo al cerrar (una vez), una falla de impresión no deshace el cierre y «Reimprimir cierre» lo imprime como reimpresión', async (t) => {
    const { caja } = await preparar(t);
    const impresos = () => readdirSync(caja.s.impresora.dir).filter((f) => f.endsWith('.txt')).sort().map((f) => readFileSync(join(caja.s.impresora.dir, f), 'utf8'));
    await vender(caja, MASCADA, 500);
    await fondo(caja, den(5000));
    await conteo(caja, 500);
    assert.equal((await api(caja.url, '/api/corte/reimprimir', {})).json.error.codigo, 'CORTE_ABIERTO', 'sin cierre no hay nada que reimprimir');
    const antes = impresos().length;
    caja.s.impresora.falla = 'sin papel';
    const c = await api(caja.url, '/api/corte/cerrar', { clave: '4321', observaciones: 'prueba' });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.deepEqual([c.json.impresion.ok, /sin papel/.test(c.json.impresion.error)], [false, true]);
    assert.equal((await cierre(caja)).cerrado !== null, true, 'el corte quedó cerrado aunque la impresora falló');
    assert.equal(impresos().length, antes, 'no salió nada');
    caja.s.impresora.falla = null;
    // reimprimir: sale el mismo cierre guardado, marcado como reimpresión 1; la siguiente, 2
    const r1 = await api(caja.url, '/api/corte/reimprimir', {});
    assert.deepEqual([r1.status, r1.json.impresion.ok, r1.json.reimpresion], [200, true, 1]);
    assert.match(r1.json.ticket_texto, /\*\*\* CIERRE DE CAJA \*\*\*\n +REIMPRESIÓN 1[\s\S]*VENTA TOTAL DEL DÍA[\s\S]*Observaciones: prueba/);
    assert.equal((await api(caja.url, '/api/corte/reimprimir', {})).json.reimpresion, 2);
    assert.equal(impresos().length, antes + 2);
    // cerrar otra vez no vuelve a imprimir
    const otra = await api(caja.url, '/api/corte/cerrar', { clave: '4321' });
    assert.deepEqual([otra.json.impresion, otra.json.ticket_texto], [null, null]);
    assert.equal(impresos().length, antes + 2);
  });
});

it('CG7 migración 0010 (central real): el fondo y los ajustes son solo de Administración y se reparten a las cajas; la confirmación del fondo la sube la caja', async () => {
  const db = await centralLocal();
  const r = (await db.query(`select pos.tipo_para_cajas('caja.fondo_autorizado') as a, pos.tipo_solo_admin('caja.fondo_autorizado') as b, pos.tipo_para_cajas('cash.ajuste_admin') as c, pos.tipo_solo_admin('cash.ajuste_admin') as d, pos.tipo_solo_admin('cash.fondo') as e, pos.tipo_solo_admin('cash.conteo') as f`)).rows;
  assert.deepEqual(r, [{ a: true, b: true, c: true, d: true, e: false, f: false }]);
});
