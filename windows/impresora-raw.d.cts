export interface PuertoSistema { ejecutar?: (cmd: string, args: string[], opciones?: { timeout?: number }) => Promise<{ code: number; stdout: string; stderr: string }>; dirTmp?: string; fs?: unknown; plataforma?: string; powershell?: string; listarAlterno?: () => Promise<{ nombre: string; predeterminada: boolean; puerto: string; controlador: string; sinConexion: boolean }[]> }
export function crearImpresoraRaw(o?: PuertoSistema): {
  listar(): Promise<{ nombre: string; predeterminada: boolean; puerto: string; controlador: string; sinConexion: boolean }[]>;
  imprimir(impresora: string, bytes: Uint8Array): Promise<void>;
};
export function mensajeDeError(stderr: string): string;
export const SCRIPT_ENVIAR: string;
export const SCRIPT_LISTAR: string;
