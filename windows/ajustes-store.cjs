'use strict';
const fs = require('node:fs');
const path = require('node:path');

const URL_ACTUALIZACIONES = 'https://zchgpakvhrdpabvsxpnn.supabase.co/storage/v1/object/public/actualizaciones';
const OMISION = { impresora: '', canal: 'pruebas', urlActualizaciones: URL_ACTUALIZACIONES, pantallaCompleta: false, revisarCadaMin: 30 };

/** Ajustes de ESTE equipo (impresora, canal de actualizaciones…), en la carpeta de datos del usuario. */
function crearAjustes(dir, sistema = fs) {
  const archivo = path.join(dir, 'ajustes.json');
  const leer = () => {
    try { return { ...OMISION, ...JSON.parse(sistema.readFileSync(archivo, 'utf8')) }; } catch { return { ...OMISION }; }
  };
  return {
    leer,
    guardar(cambios) {
      const a = { ...leer() };
      if (typeof cambios.impresora === 'string') a.impresora = cambios.impresora.trim();
      if (cambios.canal === 'pruebas' || cambios.canal === 'estable') a.canal = cambios.canal;
      if (typeof cambios.urlActualizaciones === 'string' && /^https:\/\/\S+$/.test(cambios.urlActualizaciones.trim())) a.urlActualizaciones = cambios.urlActualizaciones.trim().replace(/\/+$/, '');
      if (typeof cambios.pantallaCompleta === 'boolean') a.pantallaCompleta = cambios.pantallaCompleta;
      if (Number.isInteger(cambios.revisarCadaMin) && cambios.revisarCadaMin >= 5 && cambios.revisarCadaMin <= 1440) a.revisarCadaMin = cambios.revisarCadaMin;
      sistema.mkdirSync(dir, { recursive: true });
      sistema.writeFileSync(archivo, JSON.stringify(a, null, 2));
      return a;
    },
  };
}
module.exports = { crearAjustes, OMISION, URL_ACTUALIZACIONES };
