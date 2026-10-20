// Genera archivos ESC/POS de prueba (ticket con acentos, código de barras, cupón con QR nativo, corte y cajón) para mandarlos DIRECTO a una impresora
// térmica con «copy /b archivo \\localhost\NOMBRE» y así comprobar el equipo sin la app. Uso: node scripts/generar-prueba-impresora.ts [carpeta]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { construirTicket, NEGOCIOS, renderTicketEscPos } from '../src/ticket.ts';
import { LOGOS_TICKET } from '../src/logos-ticket.ts';
import type { Venta } from '../src/tipos.ts';

const dir = process.argv[2] ?? join(import.meta.dirname, '..', 'dist', 'prueba-impresora');
mkdirSync(dir, { recursive: true });
const linea = (n: number, desc: string, marca: string, estilo: string, precio: number, qty = 1) => ({
  linea_id: `l${n}`, item_id: `i${n}`, item_no: String(1000 + n), codigo: `000202609${String(n).padStart(4, '0')}`, descripcion: desc, marca, estilo, lote: '20261014',
  departamento: 'PRUEBA', qty, precio_unit: precio, descuento: 0, importe: precio * qty,
});
const v: Venta = {
  sale_id: 'prueba', tienda: 'DUO', caja: 1, folio: 12345, cajero: 'Prueba', ocurrio_en: new Date().toISOString(), estado: 'confirmada',
  lineas: [linea(1, 'VESTIDO NEW FEELING', 'NEW FEELING', 'ñandú-789', 78900), linea(2, 'CAMISA ÁNGEL', 'DUO', 'Á-12', 45000, 2)], total: 168900,
  pagos: [{ metodo: 'efectivo', monto: 168900, recibido: 170000, cambio: 1100 }],
  recompensas: [{ codigo: 'RC-DUO1-012345-1', regla_id: 'r', nombre: 'Gana $50 en tu próxima compra', monto: 5000, minimo: 50000, valido_desde: '2026-10-20', valido_hasta: '2026-11-19', tienda: 'DUO' }],
};
const t = construirTicket(v, NEGOCIOS.DUO!, 0, NEGOCIOS);
writeFileSync(join(dir, 'ticket-prueba.bin'), renderTicketEscPos(t, { abrirCajon: true, logo: LOGOS_TICKET.DUO }));
writeFileSync(join(dir, 'ticket-sin-logo.bin'), renderTicketEscPos(t, { abrirCajon: false }));
writeFileSync(join(dir, 'solo-cajon.bin'), Uint8Array.from([0x1b, 0x40, 0x1b, 0x70, 0x00, 25, 250]));
writeFileSync(join(dir, 'enviar-a-impresora.bat'), [
  '@echo off', 'chcp 65001 >nul', 'echo Impresora compartida en Windows (el NOMBRE COMPARTIDO, por ejemplo SRP350 o EPSON):', 'set /p IMP=Nombre: ', 'echo.',
  'echo 1 = ticket completo con logo, cupon con QR, corte y cajon', 'echo 2 = ticket sin logo', 'echo 3 = solo abrir el cajon', 'set /p OP=Opcion (1/2/3): ',
  'if "%OP%"=="1" copy /b "%~dp0ticket-prueba.bin" "\\\\localhost\\%IMP%"', 'if "%OP%"=="2" copy /b "%~dp0ticket-sin-logo.bin" "\\\\localhost\\%IMP%"', 'if "%OP%"=="3" copy /b "%~dp0solo-cajon.bin" "\\\\localhost\\%IMP%"', 'pause', '',
].join('\r\n'));
console.log('listo en', dir);
