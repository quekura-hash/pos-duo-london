import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { rasterEscPos } from '../src/ticket.ts';
import { LOGOS_TICKET } from '../src/logos-ticket.ts';
import { api, appAdmin, appCajero } from './ayudas/app.ts';
import { ALMACENES, nuevoMundo, politica } from './ayudas/comun.ts';
import { crearAjustes } from '../windows/ajustes-store.cjs';

describe('Ticket: logo centrado y ancho por equipo', () => {
  it('TL1 el logo se rellena con blanco a ambos lados hasta el ancho del papel (no depende de que la impresora centre)', () => {
    const l = LOGOS_TICKET.LON!;
    const r = rasterEscPos(l, 576);
    const bpr = r[7]! + (r[8]! << 8), alto = r[9]! + (r[10]! << 8);
    assert.equal(bpr, 72); assert.equal(alto, l.alto);
    const orig = Math.ceil(l.ancho / 8), datos = r.slice(11, 11 + bpr * alto), izq = Math.floor((72 - orig) / 2);
    const original = Array.from(atob(l.datos), (c) => c.charCodeAt(0));
    for (const y of [0, 100, alto - 1]) {
      assert.deepEqual(datos.slice(y * bpr + izq, y * bpr + izq + orig), original.slice(y * orig, (y + 1) * orig), 'el dibujo queda intacto en el centro');
      assert.ok(datos.slice(y * bpr, y * bpr + izq).every((x) => x === 0), 'blanco a la izquierda');
      assert.ok(datos.slice(y * bpr + izq + orig, (y + 1) * bpr).every((x) => x === 0), 'blanco a la derecha');
    }
    assert.ok(Math.abs(izq - (72 - orig - izq)) <= 1, 'la mitad a cada lado');
  });
  it('TL2 con un papel más angosto (42 columnas = 504 puntos) el logo se centra en ese ancho; sin ancho se manda como antes', () => {
    assert.equal(rasterEscPos(LOGOS_TICKET.DUO!, 504)[7], 63);
    assert.equal(rasterEscPos(LOGOS_TICKET.DUO!)[7], Math.ceil(LOGOS_TICKET.DUO!.ancho / 8));
  });
  it('TL3 el ancho del ticket de cada equipo se guarda en Ajustes (48 de fábrica; solo valores razonables)', () => {
    const a = crearAjustes(mkdtempSync(join(tmpdir(), 'aj-')));
    assert.equal(a.leer().columnasTicket, 48);
    assert.equal(a.guardar({ columnasTicket: 42 }).columnasTicket, 42);
    assert.equal(a.guardar({ columnasTicket: 5 }).columnasTicket, 42, 'valor absurdo: se ignora');
    assert.equal(crearAjustes(join(tmpdir(), 'inexistente-' + Date.now())).leer().columnasTicket, 48);
  });
  it('TL4 con el ancho del equipo en 42 columnas, el ticket se arma a 42 (y sin dato, a 48)', async (t) => {
    const ctx = nuevoMundo(ALMACENES.find((a) => a.nombre === 'sqlite')!, politica());
    const adm = await appAdmin(ctx);
    const caja = await appCajero(ctx, 'DUO', 2, 'Laura');
    t.after(async () => { delete (globalThis as { posHardware?: unknown }).posHardware; await adm.cerrar(); await caja.cerrar(); ctx.limpiar(); });
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo', clave: 'clave-segura', clave_caja: '2468' });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Laura', clave: '4321' });
    for (let i = 0; i < 4; i++) ctx.m.pump();
    await api(caja.url, '/api/login', { usuario: 'Laura', clave: '4321' });
    const c = (await api(caja.url, '/api/venta/nueva', {})).json.cart;
    await api(caja.url, '/api/venta/escanear', { cart: c, codigo: '0002026090782' });
    await api(caja.url, '/api/venta/cobrar-efectivo', { cart: c, recibido: 100000 });
    const gasto = async (ref: string) => { const r = await api(caja.url, '/api/gasto', { ref, monto: 1000, concepto: 'Limpieza', recibio: 'Juan', autoriza: { nombre: 'Edgardo', clave: '2468' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.ticket_texto as string; };
    const largo = (x: string) => Math.max(...x.split('\n').map((l) => l.length));
    assert.equal(largo(await gasto('g-a')), 48);
    (globalThis as { posHardware?: unknown }).posHardware = { columnasTicket: () => 42 };
    assert.equal(largo(await gasto('g-b')), 42);
  });
});
