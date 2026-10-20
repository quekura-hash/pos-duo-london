// Punto de entrada del navegador para la Administración conectada al central (global `PosAdmin`).
import { aplicarDepartamentos, DEPARTAMENTOS_BASE } from '../departamentos.ts';
import { aOperacionesInventario, leerInventario, perfilConCantidad, PERFILES } from '../inventario.ts';
import { escribirXlsx, leerXlsx } from '../xlsx.ts';
import { ClienteSupabase } from '../transporte/cliente-supabase.ts';
import { leerCorrecciones, leerMarcasPorArticulo, planCorrecciones, planMarcasPorArticulo } from '../correcciones-catalogo.ts';
import { iniciarAdminNube } from './admin-nube.ts';

export { aplicarDepartamentos, DEPARTAMENTOS_BASE, aOperacionesInventario, leerInventario, perfilConCantidad, PERFILES, escribirXlsx, leerXlsx, iniciarAdminNube, ClienteSupabase, leerCorrecciones, planCorrecciones, leerMarcasPorArticulo, planMarcasPorArticulo };
