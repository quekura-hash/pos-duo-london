import type { Page } from 'playwright-core';

/**
 * Recorre el cierre de caja guiado hasta el paso 3 y abre el detalle completo del corte (`#tabla-corte`).
 * Confirma un fondo exacto de $5,000 y guarda el conteo de ventas con lo capturado en `conteo` (por defecto, vacío).
 */
export async function abrirDetalleCorte(page: Page, conteo: Record<string, number> = {}): Promise<void> {
  await page.click('#nav button[data-vista="corte"]');
  await page.waitForSelector('#cierre-pasos');
  if (await page.locator('#paso-fondo').count()) {
    await page.fill('[data-fondo="b100000"]', '5');
    await page.click('#btn-fondo');
    await page.waitForSelector('#paso-ventas');
  }
  if (await page.locator('#paso-ventas').count()) {
    for (const [fila, n] of Object.entries(conteo)) await page.fill(`[data-venta="${fila}"], [data-usd="${fila}"]`, String(n));
    await page.click('#btn-conteo');
    await page.waitForSelector('#paso-cierre');
  }
  await page.click('#detalle-corte summary');
  await page.waitForSelector('#tabla-corte');
}
