import { getTable, postTable } from 'appsheet-connect';
import { APPSHEETCONFIG } from '../../config/bot.mjs';

// Propiedades para la API, similar a tu archivo de contactos
const propiedades = {
    UserSettings: { DETECTAR: false }
};

/**
 * Función de reintento para postTable, adaptada de tu archivo contactos.mjs para mayor robustez.
 */
async function postTableWithRetry(config, table, data, props, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const resp = await postTable(config, table, data, props);
            return resp; // Devolvemos la respuesta directamente
        } catch (err) {
            console.warn(`⚠️ Intento ${i + 1} fallido para postTable en tabla ${table}: ${err.message}, reintentando en ${delay}ms...`);
            if (i === retries - 1) {
                console.error(`❌ Error en postTable para tabla ${table} tras ${retries} intentos: ${err.message}`);
                throw err; // Lanzamos el error después del último intento
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Obtiene el siguiente número consecutivo para un pedido.
 * @returns {Promise<number>} El siguiente número consecutivo.
 */
export const obtenerSiguienteConsecutivo = async () => {
    try {
        const pedidos = await getTable(APPSHEETCONFIG, process.env.PAG_PEDIDOS);
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
 * @param {object} datosCabecera - Objeto con todos los datos para la fila.
 */
export const escribirCabeceraPedido = async (datosCabecera) => {
    try {
        console.log('Escribiendo cabecera de pedido...');
        await postTableWithRetry(APPSHEETCONFIG, process.env.PAG_PEDIDOS, [datosCabecera], propiedades);
        console.log('Cabecera de pedido escrita con éxito.');
    } catch (error) {
        console.error('Error al escribir la cabecera del pedido:', error);
        throw error;
    }
};

/**
 * Escribe una o más filas de detalle de un pedido en la hoja PEDIDOS_DETALLES.
 * @param {Array<object>} datosDetalles - Un array de objetos, donde cada objeto es una línea de producto.
 */
export const escribirDetallesPedido = async (datosDetalles) => {
    try {
        console.log(`Escribiendo ${datosDetalles.length} detalles de pedido...`);
        await postTableWithRetry(APPSHEETCONFIG, process.env.PAG_PEDIDOS_DETALLES, datosDetalles, propiedades);
        console.log('Detalles de pedido escritos con éxito.');
    } catch (error) {
        console.error('Error al escribir los detalles del pedido:', error);
        throw error;
    }
};
