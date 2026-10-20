// Punto de entrada del navegador para la caja conectada al central (global `PosCaja`).
import { ClienteSupabase } from '../transporte/cliente-supabase.ts';
import { iniciarCajaNube } from './caja-nube.ts';

export { iniciarCajaNube, ClienteSupabase };
