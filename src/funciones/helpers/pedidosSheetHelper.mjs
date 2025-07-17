// El cambio está en estas primeras líneas
import AppsheetConnect from 'appsheet-connect';

// Configuración inicial del conector de AppSheet
const AppSheet = AppsheetConnect({
    appName: process.env.APPSHEET_ID,
    appKey: process.env.APPSHEET_KEY
});

/**
 * Obtiene el siguiente número consecutivo para un pedido.
 * ADVERTENCIA: Este método tiene riesgo de "condición de carrera" si dos pedidos se crean simultáneamente.
 * @returns {Promise<number>} El siguiente número consecutivo.
 */
export const obtenerSiguienteConsecutivo = async () => {
    try {
        const pedidos = await AppSheet.getRows(process.env.PAG_PEDIDOS);
        if (!pedidos || pedidos.length === 0) {
            return 1; // Si no hay pedidos, este es el primero.
        }
        // Extraemos todos los números, los convertimos a tipo Number y encontramos el máximo.
        const numeros = pedidos.map(p => Number(p.NUMERO_CONSECUTIVO)).filter(n => !isNaN(n));
        const maximo = Math.max(...numeros) || 0;
        return maximo + 1;
    } catch (error) {
        console.error('Error al obtener el consecutivo:', error);
        return -1; // Devolver un número de error
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
        const resultado = await AppSheet.addRow(process.env.PAG_PEDIDOS, [datosCabecera]);
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
        const resultado = await AppSheet.addRows(process.env.PAG_PEDIDOS_DETALLES, datosDetalles);
        console.log('Detalles de pedido escritos con éxito.');
        return resultado;
    } catch (error) {
        console.error('Error al escribir los detalles del pedido:', error);
        throw error;
    }
};
