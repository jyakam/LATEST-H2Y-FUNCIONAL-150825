import {
    obtenerSiguienteConsecutivo,
    escribirCabeceraPedido,
    escribirDetallesPedido
} from './helpers/pedidosSheetHelper.mjs';

/**
 * Orquesta la creación de un pedido completo a partir del estado de la conversación.
 * @param {object} state - El estado actual de la conversación del bot (contiene el carrito).
 * @param {object} ctx - El contexto de la conversación (contiene el número de teléfono del cliente).
 */
export const crearPedidoDesdeState = async (state, ctx) => {
    console.log('Iniciando proceso de creación de pedido...');
    const carrito = state.get('carrito');

    if (!carrito || carrito.length === 0) {
        console.log('El carrito está vacío. No se creará ningún pedido.');
        return;
    }

    try {
        const numeroConsecutivo = await obtenerSiguienteConsecutivo();
        if (numeroConsecutivo === -1) {
            throw new Error('No se pudo obtener el número consecutivo.');
        }

        // Generamos los IDs y calculamos totales
        const idUnico = `PED-${Date.now()}`;
        const numeroPedidoVisible = `PED-${numeroConsecutivo.toString().padStart(3, '0')}`;
        const subtotal = carrito.reduce((acc, item) => acc + (item.cantidad * item.precio), 0);
        const valorTotal = subtotal; // TODO: Sumar envío, impuestos, etc. más adelante

        // Preparamos la información COMPLETA de la cabecera del pedido
        const datosCabecera = {
            ID_PEDIDO: idUnico,
            FECHA_PEDIDO: new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }),
            HORA_PEDIDO: new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' }),
            TELEFONO_REGISTRADO: ctx.from,
            // TODO: Extraer estos datos del historial o del state
            NOMBRE_COMPLETO_CLIENTE: state.get('nombre_cliente') || ctx.pushName,
            DIRECCION: state.get('direccion_cliente') || '',
            DIRECCION_2: '',
            CIUDAD: state.get('ciudad_cliente') || '',
            DEPARTAMENTO_REGION_ESTADO: state.get('depto_cliente') || '',
            CODIGO_POSTAL: '',
            PAIS: 'Colombia',
            EMAIL: state.get('email_cliente') || '',
            TELEFONO: ctx.from,
            SUBTOTAL: subtotal,
            VALOR_ENVIO: 0,
            IMPUESTOS: 0,
            DESCUENTOS: 0,
            VALOR__TOTAL: valorTotal,
            FORMA_PAGO: state.get('forma_pago') || 'Por definir',
            ESTADO_PAGO: 'Pendiente de Pago',
            SALDO_PENDIENTE: valorTotal,
            TRANSPORTADORA: '',
            GUIA_TRANSPORTE: '',
            ESTADO_PEDIDO: 'Nuevo',
            NOTAS_PEDIDO: '',
            NUMERO_CONSECUTIVO: numeroConsecutivo,
            NUMERO_PEDIDO_VISIBLE: numeroPedidoVisible,
        };

        const datosDetalles = carrito.map((item, index) => ({
            ID_DETALLE: `${idUnico}-DET-${index + 1}`,
            ID_PEDIDO: idUnico,
            SKU: item.sku || 'N/A',
            NOMBRE_PRODUCTO: item.nombre,
            TIPO_PRODUCTO: item.tipo_producto || 'PRODUCTO',
            OPCION_1_COLOR: item.opciones?.color || '',
            OPCION_2_TALLA: item.opciones?.talla || '',
            OPCION_3_TAMANO: item.opciones?.tamano || '',
            OPCION_4_SABOR: item.opciones?.sabor || '',
            CANTIDAD: item.cantidad,
            PRECIO_UNITARIO: item.precio,
            TOTAL_PRODUCTOS: item.cantidad * item.precio,
            CATEGORIA: item.categoria || 'General',
            NOTA_PRODUCTO: '',
        }));
        
        // --- INICIO DE LOS NUEVOS LOGS DE DEPURACIÓN ---
        console.log('📦 [DEBUG PEDIDO] Paquete de CABECERA a enviar:', JSON.stringify(datosCabecera, null, 2));
        console.log('📄 [DEBUG PEDIDO] Paquete de DETALLES a enviar:', JSON.stringify(datosDetalles, null, 2));
        // --- FIN DE LOS NUEVOS LOGS DE DEPURACIÓN ---

        // Escribimos en Google Sheets
        await escribirCabeceraPedido(datosCabecera);
        await escribirDetallesPedido(datosDetalles);

        console.log(`Pedido ${numeroPedidoVisible} creado con éxito.`);

    } catch (error) {
        console.error('Error mayor en el proceso de creación del pedido:', error);
    }
};
