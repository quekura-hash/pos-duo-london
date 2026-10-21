// Empaqueta una Edge Function que importa código de src/ en UN solo archivo listo para desplegar (las imports de npm: quedan como están).
// Uso: node scripts/empaquetar-funcion.mjs reporte-contadora   → dist/funciones/reporte-contadora/index.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const nombre = process.argv[2];
if (!nombre) throw new Error('Indique el nombre de la función (carpeta en supabase/functions).');
const r = await build({
  entryPoints: [join(raiz, 'supabase/functions', nombre, 'index.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
  external: ['npm:*', 'jsr:*', 'node:*'], logLevel: 'warning', legalComments: 'none', minifyWhitespace: true, minifySyntax: true,
});
const salida = join(raiz, 'dist/funciones', nombre);
mkdirSync(salida, { recursive: true });
const texto = r.outputFiles[0].text;
writeFileSync(join(salida, 'index.ts'), texto);
console.log(`dist/funciones/${nombre}/index.ts (${(texto.length / 1024).toFixed(0)} KB)`);
