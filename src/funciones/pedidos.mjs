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

    // 1. Verificar si hay algo en el carrito
    if (!carrito || carrito.length === 0) {
        console.log('El carrito está vacío. No se creará ningún pedido.');
        return;
    }

    try {
        // 2. Obtener el número consecutivo para el nuevo pedido
        const numeroConsecutivo = await obtenerSiguienteConsecutivo();
        if (numeroConsecutivo === -1) {
            throw new Error('No se pudo obtener el número consecutivo.');
        }

        const idPedido = `PED-${numeroConsecutivo.toString().padStart(5, '0')}`; // ej. PED-00123
        const numeroPedidoVisible = `PED-${numeroConsecutivo.toString().padStart(3, '0')}`; // ej. PED-123

        // 3. Preparar la información de la cabecera del pedido
        // TODO: En un futuro, obtener los datos del cliente de la tabla CONTACTOS.
        // Por ahora, usamos datos básicos.
        const datosCabecera = {
            ID_PEDIDO: idPedido,
            FECHA_PEDIDO: new Date().toLocaleDateString('es-CO'), // Formato dd/mm/yyyy
            HORA_PEDIDO: new Date().toLocaleTimeString('es-CO'), // Formato hh:mm:ss
            TELEFONO_REGISTRADO: ctx.from,
            NOMBRE_COMPLETO_CLIENTE: state.get('nombre_cliente') || ctx.pushName, // Usar nombre guardado o de WhatsApp
            // ... Aquí irían los demás campos como DIRECCION, CIUDAD, etc., que se recolectarían en la conversación.
            // Por ahora los dejamos vacíos.
            ESTADO_PEDIDO: 'Nuevo',
            ESTADO_PAGO: 'Pendiente de Pago',
            NUMERO_CONSECUTIVO: numeroConsecutivo,
            NUMERO_PEDIDO_VISIBLE: numeroPedidoVisible,
        };

        // 4. Preparar los detalles del pedido (los productos del carrito)
        const datosDetalles = carrito.map(item => ({
            ID_DETALLE: `DET-${Date.now()}-${Math.random()}`, // Un ID único simple para el detalle
            ID_PEDIDO: idPedido, // El enlace a la cabecera del pedido
            SKU: item.sku,
            NOMBRE_PRODUCTO: item.nombre,
            CANTIDAD: item.cantidad,
            PRECIO_UNITARIO: item.precio,
            TOTAL_PRODUCTOS: item.cantidad * item.precio,
            // ... Aquí irían las opciones como color, talla, etc.
        }));

        // 5. Escribir todo en Google Sheets
        await escribirCabeceraPedido(datosCabecera);
        await escribirDetallesPedido(datosDetalles);

        console.log(`Pedido ${numeroPedidoVisible} creado con éxito.`);

    } catch (error) {
        console.error('Error mayor en el proceso de creación del pedido:', error);
        // Aquí se podría enviar una notificación al administrador.
    }
};
