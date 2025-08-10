// src/config/contactos.mjs
import 'dotenv/config'
import { postTable } from 'appsheet-connect'
// import { ObtenerContactos } from '../funciones/proveedor.mjs'  // (¡Ya no es necesario si usas cache!)
import { APPSHEETCONFIG, ActualizarContactos, ActualizarFechas } from './bot.mjs'

// Importa helpers del cache de contactos
import {
  getContactoByTelefono,
  actualizarContactoEnCache
} from '../funciones/helpers/cacheContactos.mjs'
// ✅ NUEVA LÍNEA AÑADIDA
import { addTask } from '../funciones/helpers/taskQueue.mjs'

const propiedades = {
  UserSettings: { DETECTAR: false }
}

const COLUMNAS_VALIDAS = [
  'FECHA_PRIMER_CONTACTO',
  'FECHA_ULTIMO_CONTACTO',
  'TELEFONO',
  'NOMBRE',
  'RESP_BOT',
  'IDENTIFICACION',
  'EMAIL',
  'DIRECCION',
  'DIRECCION_2',
  'CIUDAD',
  'PAIS',
  'ESTADO_DEPARTAMENTO',
  'ETIQUETA',
  'TIPO DE CLIENTE',
  'RESUMEN_ULTIMA_CONVERSACION',
  'NUMERO_DE_TELEFONO_SECUNDARIO'
]

async function postTableWithRetry(config, table, data, props, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await postTable(JSON.parse(JSON.stringify(config)), table, data, props)
      if (!resp) {
        console.warn(`⚠️ Respuesta vacía de postTable para tabla ${table}`)
        return []
      }
      if (typeof resp === 'string') {
        try { return JSON.parse(resp) }
        catch (err) {
          console.warn(`⚠️ Respuesta no-JSON de postTable: ${resp}`)
          return []
        }
      }
      return resp
    } catch (err) {
      console.warn(`⚠️ Intento ${i + 1} fallido para postTable: ${err.message}, reintentando en ${delay}ms...`)
     if (i === retries - 1) {
        console.error(`❌ Error en postTable tras ${retries} intentos: ${err.message}`)
        // ✅ CAMBIO: Relanzamos el error para que la fila se entere de que la tarea falló definitivamente.
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

export function SincronizarContactos() {
  // ... igual a tu versión, sin cambios ...
}

//=============== INICIA EL BLOQUE FINAL Y MÁS SEGURO ===============

export async function ActualizarContacto(phone, datosNuevos = {}) {
    console.log(`📥 [CONTACTOS] Solicitud para ActualizarContacto para ${phone}. Se enviará a la fila.`);

    try {
        const contactoPrevio = getContactoByTelefono(phone);

        let contactoParaEnviar = {};

        if (contactoPrevio) {
            // Lógica para contactos existentes: fusiona los datos.
            contactoParaEnviar = { ...contactoPrevio, ...datosNuevos };
        } else {
            // Lógica para contactos nuevos: crea la estructura COMPLETA.
            console.log(`🆕 [CONTACTOS] Creando estructura COMPLETA para nuevo contacto: ${phone}`);
            const estructuraCompleta = {};
            for (const columna of COLUMNAS_VALIDAS) {
                estructuraCompleta[columna] = ''; // Inicializa todas las columnas para evitar el error de "Bad Request".
            }
            contactoParaEnviar = {
                ...estructuraCompleta,
                ...datosNuevos,
                TELEFONO: phone,
                FECHA_PRIMER_CONTACTO: new Date().toLocaleDateString('es-CO'),
                ETIQUETA: 'Nuevo',
                RESP_BOT: 'Sí'
            };
        }

        // Siempre actualiza la fecha del último contacto y asegura el teléfono.
        contactoParaEnviar.FECHA_ULTIMO_CONTACTO = new Date().toLocaleDateString('es-CO');
        contactoParaEnviar.TELEFONO = phone;

        // ✅ CAMBIO PRINCIPAL: Envolvemos la llamada a la base de datos en nuestro gestor de tareas.
        // Creamos la "tarea" que es la función que queremos ejecutar en la fila.
        const task = () => postTableWithRetry(APPSHEETCONFIG, process.env.PAG_CONTACTOS, [contactoParaEnviar], propiedades);

// [DEBUG] Payload que se encola para creación/actualización de contacto
try {
  console.log(`[DEBUG CONTACTOS] ENCOLAR tarea para ${phone} en tabla ${process.env.PAG_CONTACTOS || 'CONTACTOS'}`);
  // Si tu variable del row se llama distinto, usa ese nombre:
  console.log('[DEBUG CONTACTOS] Row ENCOLADO:', JSON.stringify(contactoParaEnviar, null, 2));
} catch (e) {
  console.log('[DEBUG CONTACTOS] Error logueando payload ENCOLADO:', e?.message);
}
      
        // Añadimos la tarea a la fila y esperamos a que se complete.
        await addTask(task);
        
        // Si la tarea en la fila fue exitosa (no hubo error), actualizamos la caché local.
        actualizarContactoEnCache(contactoParaEnviar);
        console.log(`✅ [CONTACTOS] Tarea para ${phone} completada. Contacto procesado y actualizado en caché.`);

    } catch (error) {
        // Este error se captura si la tarea en la fila falla después de todos sus reintentos.
        console.error(`❌ [CONTACTOS] Error fatal en la tarea de ActualizarContacto para ${phone} via queue:`, error.message);
    }
}

//=============== FIN DEL BLOQUE ===============
