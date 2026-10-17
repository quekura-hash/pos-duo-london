import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImpresoraArchivo } from '../impresion.ts';
import { crearPoliticasEnsayo } from '../politicas.ts';
import { CAJAS_ESTANDAR, fabricaSqlite, Mundo } from '../mundo.ts';
import { ServicioAdmin, ServicioCaja } from './servicio.ts';
import { crearServidorApp } from './servidor-app.ts';

// Demostración local con DATOS SINTÉTICOS: 4 cajas + Administración en 127.0.0.1. Las políticas son de ENSAYO (no aprobadas).
const dir = mkdtempSync(join(tmpdir(), 'pos-demo-'));
const m = new Mundo({
  fabrica: fabricaSqlite(join(dir, 'datos')),
  politicas: crearPoliticasEnsayo({
    P01_hub_no_disponible: 'vender_autonomo_con_aviso', P02_existencia_insuficiente: 'permitir_y_conciliar', P03_devolucion_venta_no_local: 'bloquear',
    P06_huecos_de_folio: 'no_aceptados', P07_item_no: 'a_central', P12_tarjeta_con_pendiente: 'permitir_con_aviso',
    P14_venta_con_inventario_no_verificado: 'permitir_con_aviso', K_folios: 30, K_item_no: 50,
  }),
});
m.sembrar([
  { codigo: '0002026090782', item_no: '1001', marca: 'LEVIS', descripcion: 'JEANS', estilo: '726-', lote: '20260913', departamento: 'CABALLERO', precio: 89900 },
  { codigo: '0002026090799', item_no: '1002', marca: 'LEVIS', descripcion: 'JEANS', estilo: '726-', lote: '20261014', departamento: 'CABALLERO', precio: 89900 },
  { codigo: '7501234567890', item_no: '1003', marca: 'EFENTUS', descripcion: 'MASCADA', estilo: 'A-12', lote: '20260913', departamento: 'ACCESORIOS', precio: 12000 },
  { codigo: '0000000000017', item_no: '1004', marca: 'ZESTINI', descripcion: 'BOLSA', estilo: 'Z9', lote: '20261014', departamento: 'BOLSAS', precio: 45000 },
], [{ DUO: 5, LON: 3 }, { DUO: 3 }, { DUO: 50, LON: 50 }, { DUO: 1 }]);
m.reloj.fijar(new Date().toISOString());
const reloj = { now: () => new Date().toISOString() };
let puerto = 3001;
for (const c of CAJAS_ESTANDAR) {
  const caja = m.caja(c.tienda, c.caja);
  let ultima: string | null = null;
  const svc = new ServicioCaja({
    caja, actor: { rol: 'cajero', usuario: `Cajero ${c.tienda}${c.caja}`, tienda: c.tienda, caja: c.caja },
    impresora: new ImpresoraArchivo(join(dir, 'tickets', `${c.tienda}${c.caja}`)),
    conexion: { hubAlcanzable: () => caja.enlace.hubAlcanzable(), internet: () => null, pendientes: () => caja.repo.pendientes(`hub:${c.tienda}`).length, ultimaSync: () => ultima, sincronizar: () => { m.pump(); ultima = reloj.now(); } },
    reloj,
  });
  setInterval(() => svc.sincronizar(), 2000);
  crearServidorApp({ cajero: svc }).listen(puerto, '127.0.0.1');
  console.log(`Caja ${c.tienda}/${c.caja}: http://127.0.0.1:${puerto}`);
  puerto++;
}
crearServidorApp({ admin: new ServicioAdmin({ actor: { rol: 'admin', usuario: 'Administración' }, fuente: () => m.central.repo.ops(), cajas: CAJAS_ESTANDAR.map((c) => ({ tienda: c.tienda, caja: c.caja })) }) }).listen(3010, '127.0.0.1');
console.log('Administración: http://127.0.0.1:3010');
console.log(`Tickets simulados (ESC/POS .bin y .txt) en ${join(dir, 'tickets')}`);
