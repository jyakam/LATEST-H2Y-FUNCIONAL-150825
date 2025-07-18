import {
    obtenerSiguienteConsecutivo,
    escribirCabeceraPedido,
    escribirDetallesPedido
} from './helpers/pedidosSheetHelper.mjs';
import { getContactoByTelefono } from './helpers/cacheContactos.mjs';

/**
 * Orquesta la creación de un pedido completo a partir del estado de la conversación,
 * replicando la lógica de "blindaje" y "limpieza" de contactos.mjs.
 */
// En el archivo: src/funciones/pedidos.mjs
export const crearPedidoDesdeState = async (state, ctx) => {
    console.log('Iniciando proceso de creación de pedido...');
    const carrito = state.get('carrito');

    if (!carrito || carrito.length === 0) {
        console.log('El carrito está vacío. No se creará ningún pedido.');
        return;
    }

    try {
        const phone = ctx.from.split('@')[0];
        const contacto = getContactoByTelefono(phone) || {};

        const numeroConsecutivo = await obtenerSiguienteConsecutivo();
        if (numeroConsecutivo === -1) {
            throw new Error('No se pudo obtener el número consecutivo.');
        }

        const idUnico = `PED-${Date.now()}`;
        const numeroPedidoVisible = `PED-${numeroConsecutivo.toString().padStart(3, '0')}`;
        const subtotal = carrito.reduce((acc, item) => acc + (item.cantidad * item.precio), 0);
        const valorTotal = subtotal;

        const ahora = new Date();
        const fecha = `${ahora.getDate().toString().padStart(2, '0')}/${(ahora.getMonth() + 1).toString().padStart(2, '0')}/${ahora.getFullYear()}`;
        const hora = `${ahora.getHours().toString().padStart(2, '0')}:${ahora.getMinutes().toString().padStart(2, '0')}:${ahora.getSeconds().toString().padStart(2, '0')}`;

        const datosCabecera = {
            ID_PEDIDO: idUnico,
            FECHA_PEDIDO: fecha,
            HORA_PEDIDO: hora,
            TELEFONO_REGISTRADO: ctx.from,
            NOMBRE_COMPLETO_CLIENTE: contacto.NOMBRE || ctx.pushName,
            DIRECCION: contacto.DIRECCION || '',
            DIRECCION_2: contacto.DIRECCION_2 || '',
            CIUDAD: contacto.CIUDAD || '',
            DEPARTAMENTO_REGION_ESTADO: contacto.ESTADO_DEPARTAMENTO || '',
            CODIGO_POSTAL: contacto.CODIGO_POSTAL || '',
            PAIS: contacto.PAIS || 'Colombia',
            EMAIL: contacto.EMAIL || '',
            TELEFONO: contacto.TELEFONO || ctx.from,
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
            TIPO_PRODUCTO: 'PRODUCTO',
            OPCION_1_COLOR: '',
            OPCION_2_TALLA: '',
            OPCION_3_TAMANO: '',
            OPCION_4_SABOR: '',
            CANTIDAD: item.cantidad,
            PRECIO_UNITARIO: item.precio,
            TOTAL_PRODUCTOS: item.cantidad * item.precio,
            CATEGORIA: item.categoria || 'General',
            NOTA_PRODUCTO: '',
        }));

        const cabeceraLimpia = Object.fromEntries(
            Object.entries(datosCabecera).filter(([, value]) => value !== null && value !== undefined && value !== '')
        );
        
        console.log('✨ [DEBUG PEDIDO] Paquete de CABECERA (Limpio) a enviar:', JSON.stringify(cabeceraLimpia, null, 2));
        console.log('📄 [DEBUG PEDIDO] Paquete de DETALLES a enviar:', JSON.stringify(datosDetalles, null, 2));

        await escribirCabeceraPedido(cabeceraLimpia);
        await escribirDetallesPedido(datosDetalles);

        console.log(`✅ Pedido ${numeroPedidoVisible} creado con éxito.`);

    } catch (error) {
        console.error('❌ Error mayor en el proceso de creación del pedido:', error);
    }
};
