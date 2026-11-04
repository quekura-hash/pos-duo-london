import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ServicioAdmin } from '../src/app/servicio.ts';
import { appAdmin, api } from './ayudas/app.ts';
import { nuevoMundo, politica, porAlmacen } from './ayudas/comun.ts';

porAlmacen('Clave corta: la sesión web se reconoce aunque la ficha lleve adornos en el nombre', (alm) => {
  it('CC1 sesión «Edgardo» con ficha «Edgardo 😎» y un registro viejo desactivado con el mismo nombre: encuentra su clave y puede eliminar a una empleada ficticia', async (t) => {
    const ctx = nuevoMundo(alm, politica());
    t.after(ctx.limpiar);
    const adm = await appAdmin(ctx); t.after(() => adm.cerrar());
    // Ficha del dueño con emoji (con su clave de supervisor) y, aparte, un registro viejo «Edgardo» ya desactivado.
    await api(adm.url, '/api/admin/administradores', { nombre: 'Edgardo 😎', clave: 'clave-segura', clave_caja: '2468' });
    const viejo = (await api(adm.url, '/api/admin/supervisores', { nombre: 'Edgardo', clave: '1357' })).json;
    const idViejo = viejo.supervisor?.id ?? viejo.id ?? (await api(adm.url, '/api/admin/supervisores')).json.supervisores.find((x: any) => x.nombre === 'Edgardo')?.id;
    assert.ok(idViejo, 'se creó el registro viejo');
    await api(adm.url, '/api/admin/supervisores', { id: idViejo, activo: false });
    await api(adm.url, '/api/admin/cajeros', { nombre: 'Spice Girls', clave: '5555' });
    ctx.m.pump(); ctx.m.pump(); ctx.m.pump();
    // La sesión web trae solo el alias.
    const web = new ServicioAdmin({ central: ctx.m.central, actor: { rol: 'admin', usuario: 'Edgardo' }, fuente: () => ctx.m.central.repo.ops(), cajas: ctx.m.ctx.cajasCfg.map((c) => ({ tienda: c.tienda, caja: c.caja })), inventario: ctx.m.inventarioCentral() });
    assert.equal(web.estadoClaveFicha().tiene, true, 'reconoce su clave corta (no el registro viejo desactivado)');
    const ana = web.cajeros().cajeros.find((c: any) => c.nombre === 'Spice Girls');
    assert.ok(ana);
    await assert.doesNotReject(async () => { web.eliminarCajero({ id: ana.id, clave: '2468' }); });
    ctx.m.pump(); ctx.m.pump();
    assert.equal(web.cajeros().cajeros.some((c: any) => c.nombre === 'Spice Girls'), false);
  });
});
