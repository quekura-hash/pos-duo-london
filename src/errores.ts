export class ErrorDominio extends Error {
  readonly codigo: string;
  readonly detalle: unknown;
  constructor(codigo: string, mensaje: string, detalle?: unknown) {
    super(`${codigo}: ${mensaje}`);
    this.name = 'ErrorDominio';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}
