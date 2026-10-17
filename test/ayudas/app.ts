import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { ServicioAdmin } from '../../src/app/servicio.ts';
import { crearServidorApp } from '../../src/app/servidor-app.ts';
import { servicioDe, type Ctx, type Servicio } from './comun.ts';

export interface AppEnMarcha {
  url: string;
  servidor: Server;
  cerrar(): Promise<void>;
}
export function escuchar(servidor: Server): Promise<AppEnMarcha> {
  return new Promise((res) => {
    servidor.listen(0, '127.0.0.1', () => {
      const p = (servidor.address() as AddressInfo).port;
      res({ url: `http://127.0.0.1:${p}`, servidor, cerrar: () => new Promise<void>((r) => { servidor.closeAllConnections?.(); servidor.close(() => r()); }) });
    });
  });
}
export async function appCajero(ctx: Ctx, tienda: string, n: number, usuario = 'Ana'): Promise<AppEnMarcha & { s: Servicio }> {
  const s = servicioDe(ctx, tienda, n, usuario);
  const a = await escuchar(crearServidorApp({ cajero: s.svc }));
  return { ...a, s };
}
export async function appAdmin(ctx: Ctx): Promise<AppEnMarcha> {
  const admin = new ServicioAdmin({ actor: { rol: 'admin', usuario: 'galo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: ctx.m.inventarioCentral() });
  return escuchar(crearServidorApp({ admin }));
}
export async function api(base: string, ruta: string, cuerpo?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(base + ruta, cuerpo === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  return { status: r.status, json: await r.json() };
}
void mkdirSync; void mkdtempSync; void rmSync; void tmpdir; void join;
