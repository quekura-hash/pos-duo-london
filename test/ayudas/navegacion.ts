import type { Page } from 'playwright-core';

/** Va a una sección de Administración: con la isla del teléfono usa el acceso rápido o abre el Menú; en escritorio usa el menú lateral. */
export async function irASeccion(page: Page, vista: string): Promise<void> {
  if (await page.locator('#isla').isVisible()) {
    const rapido = page.locator(`#isla button[data-vista="${vista}"]`);
    if (await rapido.count()) { await rapido.click(); return; }
    await page.click('#isla-menu');
    await page.click(`#menu-hoja button[data-vista="${vista}"]`);
    return;
  }
  await page.click(`#nav button[data-vista="${vista}"]`);
}
/** Espera a que la navegación (isla o menú lateral) esté lista. */
export const esperarNavegacion = (page: Page) => page.waitForFunction(() => { const v = (e: Element | null) => !!e && e.getClientRects().length > 0; return v(document.querySelector('#isla-menu')) || v(document.querySelector('#nav button')); });
