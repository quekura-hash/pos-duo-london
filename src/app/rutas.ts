import { ErrorDominio } from '../errores.ts';
import type { ServicioAdmin, ServicioCaja } from './servicio.ts';

const STATUS: Record<string, number> = { PROHIBIDO: 403, ARTICULO_INEXISTENTE: 404, CARRITO_INEXISTENTE: 404, LINEA_INEXISTENTE: 404, NO_ENCONTRADO: 404, CLAVE_INVALIDA: 403, NO_AUTENTICADO: 401, CLAVE_BLOQUEADA: 429, CAJERO_SIN_CLAVE: 403, AUTORIZACION_REQUERIDA: 403, AUTORIZADOR_INVALIDO: 403 };

export interface Respuesta {
  status: number;
  json: any;
}

/**
 * Enrutador de la API de la aplicación, independiente del transporte: lo usan el servidor HTTP local y la versión que corre
 * dentro del navegador. Una sesión es de cajero (atada a su caja) o de Administración.
 */
export async function atender(o: { cajero?: ServicioCaja; admin?: ServicioAdmin }, metodo: string, url: URL, b: any): Promise<Respuesta> {
  const C = o.cajero;
  const A = o.admin;
  const q = url.searchParams;
  const ok = (cuerpo: object): Respuesta => ({ status: 200, json: { ok: true, ...cuerpo } });
  try {
    // Las lecturas automáticas de la pantalla (encabezado, tipo de cambio…) llevan `pasivo` y NO cuentan como actividad de la persona.
    const pasivo = q.get('pasivo') === '1' || b?.pasivo === true;
    const exigirCajero = () => {
      if (!C) throw new ErrorDominio('PROHIBIDO', 'esta sesión no es de caja');
      if (!C.autenticada()) throw new ErrorDominio('NO_AUTENTICADO', 'inicie sesión con su usuario y clave');
      if (!pasivo) C.tocar();
      return C;
    };
    const exigirAdmin = () => {
      if (!A) throw new ErrorDominio('PROHIBIDO', 'esta sesión no es de Administración');
      if (!A.autenticada()) throw new ErrorDominio('NO_AUTENTICADO', 'inicie sesión con su usuario y contraseña');
      if (!pasivo) A.tocar();
      return A;
    };
    // Cada rol de Administración solo llega a lo suyo (el almacenista, a Inventario y Almacén); sin sesión responde exigirAdmin (401).
    if (A && url.pathname.startsWith('/api/admin/') && A.autenticada() && !A.puede(metodo, url.pathname)) throw new ErrorDominio('PROHIBIDO', 'su rol no tiene acceso a esta parte de Administración');
    const cajasParam = (v: string | null) => (v ? v.split(',').map((x) => ({ tienda: x.split('/')[0]!, caja: Number(x.split('/')[1]) })) : undefined);

    switch (`${metodo} ${url.pathname}`) {
      case 'POST /api/login': return ok(C ? C.iniciarSesion(b.usuario, b.clave) : A ? A.iniciarSesion(b.usuario, b.clave) : (() => { throw new ErrorDominio('PROHIBIDO', 'no hay sesión'); })());
      case 'POST /api/actividad': return ok((C ? exigirCajero() : exigirAdmin()).sesionInfo()); // latido de la pantalla: la persona sigue trabajando
      case 'GET /api/admin/config-sesion': return ok({ config: exigirAdmin().configSesion() });
      case 'POST /api/admin/config-sesion': return ok({ config: exigirAdmin().guardarConfigSesion({ caja_min: Number(b.caja_min), admin_min: Number(b.admin_min) }) });
      case 'POST /api/logout': return ok(C ? C.cerrarSesion() : A ? A.cerrarSesion() : (() => { throw new ErrorDominio('PROHIBIDO', 'no hay sesión'); })());
      case 'POST /api/admin/cajeros/eliminar': return ok(exigirAdmin().eliminarCajero({ id: String(b.id ?? ''), clave: String(b.clave ?? '') }));
      case 'GET /api/admin/administradores': return ok(exigirAdmin().administradores());
      case 'POST /api/admin/administradores': return ok(exigirAdmin().guardarAdmin({ id: b.id, nombre: b.nombre, clave: b.clave === undefined ? undefined : String(b.clave), activo: b.activo === undefined ? undefined : !!b.activo, rol: b.rol, clave_caja: b.clave_caja === undefined ? undefined : String(b.clave_caja), perfil: b.perfil }));
      case 'GET /api/sesion':
        return ok(C
          ? { rol: 'cajero', ...C.sesionInfo(), usuario: C.autenticada() ? C.actor.usuario : null, tienda: C.caja.tienda, caja: C.caja.caja, nav: ['venta', 'retiro', 'ventas', 'corte', ...(C.caja.cfg.metodos.includes('tarjeta_regalo') ? ['tarjetas'] : [])] }
          : { rol: 'admin', ...A!.sesionInfo(), usuario: A!.autenticada() ? A!.actor.usuario : null, cajas: A!.cajas, nav: A!.nav() });
      // ── cajero ──
      case 'GET /api/estado': return ok({ estado: exigirCajero().estado() });
      case 'POST /api/venta/actual': { const c = exigirCajero(); const cart = c.carritoActual(); return ok({ cart, carrito: c.vista(cart) }); }
      case 'POST /api/venta/nueva': { const c = exigirCajero(); const cart = c.nuevaVenta(); return ok({ cart, carrito: c.vista(cart) }); }
      case 'POST /api/venta/escanear': return ok(exigirCajero().escanear(b.cart, String(b.codigo ?? '')));
      case 'GET /api/venta/departamentos': return ok(exigirCajero().departamentosAlta());
      case 'POST /api/venta/nuevo-articulo': return ok(exigirCajero().nuevoArticulo(b.cart, { codigo: String(b.codigo ?? ''), marca: b.marca, descripcion: String(b.descripcion ?? ''), estilo: b.estilo, lote: b.lote, departamento: String(b.departamento ?? ''), precio: Number(b.precio) }, String(b.clave ?? '')));
      case 'POST /api/venta/agregar': return ok(exigirCajero().agregarArticulo(b.cart, b.item_id));
      case 'POST /api/venta/cupon': return ok(exigirCajero().aplicarCupon(b.cart, String(b.codigo ?? '')));
      case 'POST /api/venta/cupon/quitar': return ok(exigirCajero().quitarCupon(b.cart));
      case 'POST /api/venta/descuento': return ok(exigirCajero().aplicarDescuento(b.cart, { linea_id: b.linea_id ?? null, tipo: b.tipo === 'monto' ? 'monto' : 'pct', valor: Number(b.valor) }, String(b.clave ?? '')));
      case 'POST /api/venta/descuento/quitar': return ok(exigirCajero().quitarDescuento(b.cart, b.linea_id ?? null));
      case 'POST /api/venta/cantidad': return ok({ carrito: exigirCajero().cambiarCantidad(b.cart, b.linea_id, Number(b.qty)) });
      case 'POST /api/venta/editar-linea': return ok(exigirCajero().editarLinea(b.cart, b.linea_id, { precio_unit: b.precio_unit === undefined ? undefined : Number(b.precio_unit), descripcion: b.descripcion }, b.clave === undefined ? undefined : String(b.clave)));
      case 'POST /api/venta/quitar': return ok({ carrito: exigirCajero().quitarLinea(b.cart, b.linea_id) });
      case 'POST /api/venta/cobrar-efectivo': return ok(await exigirCajero().cobrarEfectivo(b.cart, Number(b.recibido ?? 0), Number(b.usd ?? 0)));
      case 'POST /api/venta/tasa': return ok(exigirCajero().bloquearTasa(b.cart, !!b.renovar));
      case 'GET /api/tipo-cambio': return ok({ tipo_cambio: exigirCajero().tipoCambio() });
      case 'POST /api/tipo-cambio': return ok({ tipo_cambio: await exigirCajero().fijarTipoCambio(Number(b.tasa), !!b.confirmar) });
      case 'POST /api/efectivo/movimiento': return ok({ corte: exigirCajero().movimientoEfectivo(b.tipo, Number(b.monto), b.moneda ?? 'MXN') });
      case 'POST /api/efectivo/conteo-usd': return ok(exigirCajero().registrarConteoUsd(b.denominaciones ?? {}));
      case 'POST /api/efectivo/conteo': return ok(exigirCajero().registrarConteo(b.moneda === 'USD' ? 'USD' : 'MXN', b.denominaciones ?? {}));
      case 'POST /api/efectivo/billete-rechazado': return ok(exigirCajero().billeteRechazado(Number(b.denominacion), b.motivo, b.nota, b.cantidad === undefined ? 1 : Number(b.cantidad)));
      case 'GET /api/venta/espera': return ok({ espera: exigirCajero().ventasEnEspera() });
      case 'POST /api/venta/espera': return ok(exigirCajero().ponerEnEspera(b.cart, String(b.nota ?? '')));
      case 'POST /api/venta/retomar': return ok(exigirCajero().retomarVenta(b.cart, b.actual ? String(b.actual) : undefined));
      case 'POST /api/venta/espera/descartar': return ok(exigirCajero().descartarEnEspera(b.cart));
      case 'GET /api/retiro': return ok({ retiro: exigirCajero().estadoRetiro() });
      case 'POST /api/retiro': return ok(await exigirCajero().registrarRetiro({ retiro_id: String(b.retiro_id ?? ''), mxn: b.mxn ?? {}, usd: b.usd ?? {}, clave: b.clave === undefined ? undefined : String(b.clave) }));
      case 'POST /api/retiro/reimprimir': return ok(await exigirCajero().reimprimirRetiro(String(b.retiro_id ?? '')));
      case 'POST /api/venta/anular': return ok(exigirCajero().anularVenta(b.cart, String(b.motivo ?? 'anulada')));
      case 'POST /api/caja/abrir': return ok(await exigirCajero().abrirCajon(b.motivo === undefined ? undefined : String(b.motivo), b.clave === undefined ? undefined : String(b.clave)));
      case 'GET /api/folios': return ok(exigirCajero().estadoFolios());
      case 'POST /api/folios/recuperar': return ok(exigirCajero().recuperarFolios());
      case 'POST /api/folios/confirmar': return ok(exigirCajero().confirmarFolio({ siguiente: Number(b.siguiente), evidencia: { tipo: String(b.evidencia?.tipo ?? ''), referencia: String(b.evidencia?.referencia ?? '') }, sin_anclas: !!b.sin_anclas, autoriza: b.autoriza }));
      case 'GET /api/venta/vendedoras': return ok(exigirCajero().vendedoras());
      case 'POST /api/venta/vendedora': return ok(exigirCajero().asignarVendedora(b.cart, b.vendedora_id ?? null));
      case 'POST /api/venta/cambio/iniciar': return ok(exigirCajero().iniciarCambio(b.cart, String(b.sale_id ?? ''), b.renglones ?? [], { clienta: b.clienta, motivo: b.motivo }));
      case 'POST /api/venta/cambio/quitar': return ok(exigirCajero().quitarCambio(b.cart));
      case 'GET /api/venta/autorizadores-efectivo': return ok(exigirCajero().autorizadoresEfectivo());
      case 'POST /api/venta/cambio/devolver-dinero': return ok(await exigirCajero().devolverEfectivoCambio(b.cart, b.autoriza));
      case 'GET /api/venta/autorizadores': return ok(exigirCajero().autorizadores());
      case 'POST /api/venta/cancelar': return ok(await exigirCajero().revertirVenta({ sale_id: String(b.sale_id ?? ''), motivo: b.motivo, clienta: b.clienta, autoriza: b.autoriza }));
      case 'GET /api/venta/detalle': return ok(exigirCajero().detalleVenta(q.get('sale_id') ?? ''));
      case 'POST /api/venta/cobrar-tarjeta': return ok(await exigirCajero().cobrarTarjetaManual(b.cart, { importe: b.importe === undefined || b.importe === null ? undefined : Number(b.importe), autorizacion: String(b.autorizacion ?? ''), marca: b.marca, ultimos4: b.ultimos4 }));
      case 'POST /api/venta/cobrar-regalo': return ok(await exigirCajero().cobrarTarjetaRegalo(b.cart, String(b.codigo ?? ''), b.recibido === undefined || b.recibido === null ? undefined : Number(b.recibido), Number(b.usd ?? 0)));
      case 'GET /api/tarjeta': return ok({ tarjeta: exigirCajero().consultarTarjeta(q.get('codigo') ?? '') });
      case 'POST /api/tarjeta/alta': return ok(await exigirCajero().altaTarjetaRegalo(String(b.codigo ?? ''), Number(b.monto), b.recibido === undefined ? undefined : Number(b.recibido), b.ref));
      case 'GET /api/tarjetas': return ok({ tarjetas: exigirCajero().tarjetasPropias() });
      case 'GET /api/ventas/buscar': {
        const c = exigirCajero();
        return ok(c.buscarVentas({ fecha: q.get('fecha') || undefined, desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined, codigo: q.get('codigo') || undefined, folio: q.get('folio') ? Number(q.get('folio')) : undefined }));
      }
      case 'POST /api/venta/devolver': return ok(await exigirCajero().devolver(b.sale_id, b.renglones ?? [], String(b.motivo ?? 'devolución'), b.autoriza));
      case 'POST /api/tarjeta/recargar': return ok(await exigirCajero().recargarTarjetaRegalo(String(b.codigo ?? ''), Number(b.monto), b.recibido === undefined ? undefined : Number(b.recibido), b.ref));
      case 'POST /api/venta/ticket-regalo': return ok(await exigirCajero().ticketRegalo(b.sale_id));
      case 'POST /api/venta/reimprimir': return ok(await exigirCajero().reimprimir(b.sale_id));
      case 'GET /api/buscar': return ok({ ...exigirCajero().buscarConTotal(q.get('q') ?? '', Math.min(200, Math.max(1, Number(q.get('limite')) || 20))) });
      case 'GET /api/ventas': {
        const c = exigirCajero();
        // Cualquier intento de pedir otra caja se rechaza con 403; el cajero nunca recibe datos ajenos.
        const cajas = cajasParam(q.get('cajas'));
        if (cajas) c.ventasPropias({ cajas });
        return ok({ ventas: c.ventasDelDia(q.get('fecha') ?? c.estado().fecha_local) });
      }
      case 'GET /api/ticket': return ok({ ticket_texto: exigirCajero().ticketTexto(q.get('sale_id') ?? '') });
      case 'GET /api/corte': {
        const c = exigirCajero();
        const cajas = cajasParam(q.get('cajas'));
        if (cajas) c.cortesPropios({ cajas });
        return ok({ ...c.corte(q.get('fecha') ?? c.estado().fecha_local) });
      }
      case 'POST /api/corte/cerrar': { const c = exigirCajero(); return ok({ corte: c.cerrarCorte(b.fecha ?? c.estado().fecha_local) }); }
      case 'POST /api/sincronizar': return ok({ conexion: await exigirCajero().sincronizar() });
      // ── administración ──
      case 'GET /api/admin/cajas': return ok({ cajas: exigirAdmin().cajas });
      case 'POST /api/admin/reporte-vendedoras': return ok(exigirAdmin().reporteVendedoras({ cajas: b.cajas, desde: b.desde, hasta: b.hasta }));
      case 'POST /api/admin/reporte': return ok({ reporte: exigirAdmin().reporte({ cajas: b.cajas, desde: b.desde, hasta: b.hasta, historicas: b.historicas !== false }) });
      case 'GET /api/admin/tipo-cambio': return ok(exigirAdmin().tipoCambio());
      case 'POST /api/admin/tipo-cambio': return ok(exigirAdmin().fijarTipoCambio(Number(b.tasa), !!b.confirmar));
      case 'POST /api/admin/permisos': return ok(exigirAdmin().asignarPermisoTipoCambio(String(b.usuario ?? ''), !!b.editar_tipo_cambio));
      case 'GET /api/admin/tiendas': return ok({ tiendas: exigirAdmin().tiendasInfo() });
      case 'POST /api/admin/tiendas': return ok(exigirAdmin().guardarDatosTienda(String(b.tienda ?? ''), { ...b, tienda: undefined }));
      case 'GET /api/admin/articulos': return ok(exigirAdmin().buscarArticulos(q.get('q') ?? '', Math.min(200, Number(q.get('limite')) || 30), Number(q.get('desde')) || 0, q.get('todos') === '1', q.get('orden') ?? 'viejo'));
      case 'POST /api/admin/articulos': return ok(exigirAdmin().editarArticulo(String(b.item_id ?? ''), b.cambios ?? {}));
      case 'GET /api/admin/articulo/historial': return ok(exigirAdmin().historialArticulo(q.get('item_id') ?? ''));
      case 'GET /api/admin/recompensas': return ok(exigirAdmin().recompensas());
      case 'POST /api/admin/recompensas': return ok(exigirAdmin().guardarRecompensa(b as any));
      case 'GET /api/admin/promociones': return ok(exigirAdmin().promociones());
      case 'POST /api/admin/promociones': return ok(exigirAdmin().guardarPromocion(b as any));
      case 'GET /api/admin/cajeros': return ok(exigirAdmin().cajeros());
      case 'POST /api/admin/cajeros': return ok(exigirAdmin().guardarCajero({ id: b.id, nombre: b.nombre, clave: b.clave === undefined ? undefined : String(b.clave), activo: b.activo === undefined ? undefined : !!b.activo, perfil: b.perfil, tienda: b.tienda === undefined ? undefined : String(b.tienda) }));
      case 'GET /api/admin/supervisores': return ok(exigirAdmin().supervisores());
      case 'POST /api/admin/supervisores': return ok(exigirAdmin().guardarSupervisor({ id: b.id, nombre: b.nombre, clave: b.clave === undefined ? undefined : String(b.clave), activo: b.activo === undefined ? undefined : !!b.activo }));
      case 'GET /api/admin/almacen': return ok(exigirAdmin().almacen());
      case 'POST /api/admin/ventas-historicas/revisar': return ok(exigirAdmin().revisarVentasHistoricas(b.filas, { tienda: b.tienda, caja: b.caja }));
      case 'POST /api/admin/ventas-historicas/importar': return ok(exigirAdmin().importarVentasHistoricas({ filas: b.filas, tienda: b.tienda, caja: b.caja, nombre: b.nombre }));
      case 'POST /api/admin/almacen/revisar': return ok(exigirAdmin().revisarAltaLote(b.filas, { decisiones: b.decisiones, regla: b.regla }));
      case 'POST /api/admin/almacen/alta': return ok(exigirAdmin().altaLote({ lote_id: String(b.lote_id ?? ''), nombre: b.nombre, filas: b.filas, decisiones: b.decisiones, regla: b.regla, pedimento_lote: b.pedimento_lote }));
      case 'POST /api/admin/almacen/piso': return ok(exigirAdmin().fijarSacarAPiso(String(b.item_id ?? ''), b.fecha ? String(b.fecha) : null));
      case 'POST /api/admin/almacen/manual': return ok(exigirAdmin().altaManual(b));
      case 'POST /api/admin/almacen/faltante': return ok(exigirAdmin().resolverFaltante(String(b.entrega_id ?? ''), Object.fromEntries(Object.entries(b.destinos ?? {}).map(([k, v]) => [k, Number(v)]))));
      case 'GET /api/admin/almacen/entradas': return ok(exigirAdmin().entradasAlmacen(q.get('item_id') ?? ''));
      case 'POST /api/admin/almacen/corregir-entrada': return ok(exigirAdmin().corregirEntrada({ correccion_id: String(b.correccion_id ?? ''), entrada_id: String(b.entrada_id ?? ''), qty: b.qty === undefined || b.qty === null || b.qty === '' ? undefined : Number(b.qty), pedimento: b.pedimento === undefined ? undefined : b.pedimento, motivo: String(b.motivo ?? ''), confirmar_negativo: !!b.confirmar_negativo }));
      case 'POST /api/admin/almacen/entregar': return ok(exigirAdmin().entregarAlmacen({ item_id: String(b.item_id ?? ''), destinos: b.destinos ?? {}, etiqueta_precio: !!b.etiqueta_precio, etiqueta_costura: !!b.etiqueta_costura, confirmar_exceso: !!b.confirmar_exceso, ref: b.ref }));
      case 'GET /api/recepciones': return ok({ recepciones: exigirCajero().recepcionesPendientes() });
      case 'POST /api/recepciones/confirmar': return ok(exigirCajero().confirmarRecepcion(String(b.entrega_id ?? ''), b.qty === undefined || b.qty === null ? undefined : Number(b.qty)));
      case 'GET /api/admin/departamentos': return ok(exigirAdmin().departamentos());
      case 'POST /api/admin/departamentos': return ok(exigirAdmin().guardarDepartamento({
        id: b.id === undefined ? undefined : String(b.id), nombre: b.nombre === undefined ? undefined : String(b.nombre),
        activo: b.activo === undefined ? undefined : !!b.activo, alias: Array.isArray(b.alias) ? b.alias.map(String) : undefined,
      }));
      case 'GET /api/admin/limbo/buscar': return ok(exigirAdmin().buscarLimbo(q.get('codigo') ?? ''));
      case 'POST /api/admin/limbo/revisar': return ok(exigirAdmin().revisarConteoLimbo(Array.isArray(b.filas) ? b.filas : []));
      case 'GET /api/admin/expediente/clave': return ok(exigirAdmin().estadoClaveFicha());
      case 'POST /api/admin/expediente/clave': return ok(exigirAdmin().crearClaveFicha({ clave: String(b.clave ?? ''), actual: b.actual === undefined ? undefined : String(b.actual) }));
      case 'POST /api/admin/expediente/desbloquear': return ok(exigirAdmin().desbloquearExpediente(String(b.clave ?? '')));
      case 'POST /api/admin/expediente/bloquear': return ok(exigirAdmin().bloquearExpediente());
      case 'GET /api/admin/expediente': return ok(exigirAdmin().expedienteDe(q.get('cajero_id') ?? ''));
      case 'POST /api/admin/expediente': return ok(exigirAdmin().guardarExpediente({ cajero_id: String(b.cajero_id ?? ''), fecha_alta: b.fecha_alta, fecha_baja: b.fecha_baja, recontratable: b.recontratable, notas: b.notas, calificaciones: b.calificaciones }));
      case 'GET /api/admin/existencias': return ok(exigirAdmin().existenciasArticulo(q.get('item_id') ?? ''));
      case 'POST /api/admin/existencias': return ok(exigirAdmin().fijarExistencias({ ajuste_id: String(b.ajuste_id ?? ''), item_id: String(b.item_id ?? ''), cantidades: b.cantidades ?? {}, motivo: b.motivo, solo_revisar: !!b.solo_revisar }));
      case 'POST /api/admin/limbo/reubicar': return ok(exigirAdmin().reubicarLimbo({ movimiento_id: String(b.movimiento_id ?? ''), destino: String(b.destino ?? ''), cantidad: b.cantidad, items: b.items, filtro: typeof b.filtro === 'string' ? b.filtro : undefined, excluir: b.excluir, solo_revisar: !!b.solo_revisar }));
      case 'POST /api/admin/limbo/conteo': return ok(exigirAdmin().contarLimbo({ conteo_id: String(b.conteo_id ?? ''), lineas: Array.isArray(b.lineas) ? b.lineas : [] }));
      case 'GET /api/admin/limbo/conteos': return ok({ conteos: exigirAdmin().conteosLimbo() });
      case 'GET /api/admin/entregas': {
        const A4 = exigirAdmin();
        const f = { desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined, tienda: q.get('tienda') || undefined };
        return ok({ reporte: A4.entregasAlmacen(f), ...(q.get('completo') === '1' ? { hoja: A4.hojaEntregas(f) } : {}) });
      }
      case 'GET /api/admin/descuentos': {
        const A3 = exigirAdmin();
        const f = { cajas: cajasParam(q.get('cajas')), desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined };
        return ok({ reporte: A3.descuentos(f), ...(q.get('completo') === '1' ? { hoja: A3.hojaDescuentos(f) } : {}) });
      }
      case 'GET /api/admin/ventas': {
        const A7 = exigirAdmin();
        return ok(A7.historialVentas({ cajas: cajasParam(q.get('cajas')), desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined, folio: q.get('folio') ? Number(q.get('folio')) : undefined }));
      }
      case 'GET /api/admin/venta': return ok(exigirAdmin().detalleVenta(q.get('sale_id') ?? ''));
      case 'GET /api/admin/reporte-ventas': {
        const A5 = exigirAdmin();
        const f = { cajas: cajasParam(q.get('cajas')), desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined, historicas: q.get('historicas') !== '0' };
        return ok({ reporte: A5.reporte(f), ...(q.get('completo') === '1' ? { hojas: A5.hojasVentas(f) } : {}) });
      }
      case 'GET /api/admin/analisis': {
        const A6 = exigirAdmin();
        const f = { cajas: cajasParam(q.get('cajas')), desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined, historicas: q.get('historicas') !== '0', agrupar: (q.get('agrupar') || 'mes') as never };
        return ok({ analisis: A6.analisisVentas(f), ...(q.get('completo') === '1' ? { hojas: A6.hojasAnalisis(f) } : {}) });
      }
      case 'GET /api/admin/dolares': {
        const A2 = exigirAdmin();
        const f = { cajas: cajasParam(q.get('cajas')), desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined };
        return ok({ reporte: A2.dolares(f), ...(q.get('completo') === '1' ? { hoja: A2.hojaDolares(f) } : {}) });
      }
      case 'GET /api/admin/tarjetas': return ok({ tarjetas: exigirAdmin().tarjetasRegalo() });
      case 'GET /api/admin/inventario': return ok(exigirAdmin().inventario(q.get('completo') === '1'));
      case 'POST /api/admin/cortes': return ok({ cortes: exigirAdmin().cortes({ cajas: b.cajas, desde: b.desde, hasta: b.hasta }) });
      default: return { status: 404, json: { ok: false, error: { codigo: 'RUTA_INEXISTENTE', mensaje: url.pathname } } };
    }
  } catch (e) {
    if (e instanceof ErrorDominio) return { status: STATUS[e.codigo] ?? 409, json: { ok: false, error: { codigo: e.codigo, mensaje: e.message, detalle: e.detalle } } };
    return { status: 500, json: { ok: false, error: { codigo: 'ERROR', mensaje: String(e) } } };
  }
}
