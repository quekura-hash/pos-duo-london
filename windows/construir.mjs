// Arma el instalador de Windows de LonDuo POS (caja de pruebas): pantalla del POS + motor de tickets + Electron.
// Uso (desde la raíz del repo): node windows/construir.mjs [--sin-instalador]
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const win = import.meta.dirname;
const raiz = join(win, '..');
const sh = (cmd, args, cwd = raiz, env = {}) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

// 1) Pantalla del POS (la misma de la página de prueba) y archivos de prueba de impresión (mismo motor de tickets que la caja).
sh(process.execPath, ['scripts/construir-prueba.mjs']);
sh(process.execPath, ['--no-warnings', 'scripts/generar-prueba-impresora.ts', join(raiz, 'dist', 'prueba-impresora')]);
const app = join(win, 'app');
rmSync(app, { recursive: true, force: true });
mkdirSync(join(app, 'hardware'), { recursive: true });
copyFileSync(join(raiz, 'dist', 'pos-venta-prueba.html'), join(app, 'index.html'));
copyFileSync(join(win, 'ui', 'ajustes.html'), join(app, 'ajustes.html'));
for (const f of ['ticket-prueba.bin', 'ticket-sin-logo.bin', 'solo-cajon.bin']) copyFileSync(join(raiz, 'dist', 'prueba-impresora', f), join(app, 'hardware', f));

// 2) La versión de la app es la del repo (la que ya se ve en pantalla).
const version = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version;
const pkg = JSON.parse(readFileSync(join(win, 'package.json'), 'utf8'));
if (pkg.version !== version) { pkg.version = version; writeFileSync(join(win, 'package.json'), JSON.stringify(pkg, null, 2) + '\n'); }
console.log(`LonDuo POS v${version}: pantalla y archivos de impresión listos en windows/app`);
if (process.argv.includes('--sin-instalador')) process.exit(0);

// 3) Instalador (NSIS, por usuario: no pide permisos de administrador y se actualiza solo).
rmSync(join(raiz, 'dist', 'windows'), { recursive: true, force: true });
sh(join(win, 'node_modules', '.bin', 'electron-builder'), ['--win', 'nsis', '--x64', '--config', 'electron-builder.yml', '--publish', 'never'], win);
const salida = join(raiz, 'dist', 'windows');
console.log('Archivos generados:', readdirSync(salida).filter((f) => /\.(exe|yml|blockmap)$/.test(f)).join(', '));
