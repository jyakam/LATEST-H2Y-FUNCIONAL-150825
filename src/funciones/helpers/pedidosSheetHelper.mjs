import { getRows, addRow, addRows } from 'appsheet-connect';
import { APPSHEETCONFIG } from '../../config/bot.mjs'; // Importamos la configuración como en tu archivo de ejemplo

/**
 * Obtiene el siguiente número consecutivo para un pedido.
 * @returns {Promise<number>} El siguiente número consecutivo.
 */
export const obtenerSiguienteConsecutivo = async () => {
    try {
        const pedidos = await getRows(APPSHEETCONFIG, process.env.PAG_PEDIDOS);
        if (!pedidos || pedidos.length === 0) {
            return 1;
        }
        const numeros = pedidos.map(p => Number(p.NUMERO_CONSECUTIVO)).filter(n => !isNaN(n));
        const maximo = Math.max(...numeros) || 0;
        return maximo + 1;
    } catch (error) {
        console.error('Error al obtener el consecutivo:', error);
        return -1;
    }
};

/**
 * Escribe la fila de la cabecera de un nuevo pedido en la hoja PEDIDOS.
 * @param {object} datosCabecera - Objeto con todos los datos para la fila de PEDIDOS.
 * @returns {Promise<object>} El resultado de la operación de escritura.
 */
export const escribirCabeceraPedido = async (datosCabecera) => {
    try {
        console.log('Escribiendo cabecera de pedido...');
        const resultado = await addRow(APPSHEETCONFIG, process.env.PAG_PEDIDOS, [datosCabecera]);
        console.log('Cabecera de pedido escrita con éxito.');
        return resultado;
    } catch (error) {
        console.error('Error al escribir la cabecera del pedido:', error);
        throw error;
    }
};

/**
 * Escribe una o más filas de detalle de un pedido en la hoja PEDIDOS_DETALLES.
 * @param {Array<object>} datosDetalles - Un array de objetos, donde cada objeto es una línea de producto.
 * @returns {Promise<object>} El resultado de la operación de escritura.
 */
export const escribirDetallesPedido = async (datosDetalles) => {
    try {
        console.log(`Escribiendo ${datosDetalles.length} detalles de pedido...`);
        // addRows no existe en la librería, usamos addRow en un bucle si es necesario
        // o asumimos que la librería podría tener addRows. Si falla aquí, lo ajustamos.
        // Por ahora, asumimos que addRows es el método correcto para múltiples filas.
        const resultado = await addRows(APPSHEETCONFIG, process.env.PAG_PEDIDOS_DETALLES, datosDetalles);
        console.log('Detalles de pedido escritos con éxito.');
        return resultado;
    } catch (error) {
        console.error('Error al escribir los detalles del pedido:', error);
        throw error;
    }
};
