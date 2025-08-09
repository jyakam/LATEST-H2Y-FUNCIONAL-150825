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
      const resp = await postTable(config, table, data, props)
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
        return []
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
    console.log(`📥 [CONTACTOS] Iniciando ActualizarContacto para ${phone}`);

    try {
        const contactoPrevio = getContactoByTelefono(phone);

        let contactoParaEnviar = {};

        if (contactoPrevio) {
            // --- LÓGICA PARA CONTACTOS EXISTENTES (SE MANTIENE IGUAL) ---
            console.log(`🔄 [CONTACTOS] Actualizando contacto existente: ${phone}`);
            contactoParaEnviar = { ...contactoPrevio, ...datosNuevos };
        } else {
            // --- LÓGICA CORREGIDA PARA CONTACTOS NUEVOS ---
            console.log(`🆕 [CONTACTOS] Creando estructura COMPLETA para nuevo contacto: ${phone}`);
            
            // 1. Creamos una estructura base con TODAS las columnas válidas, inicializadas en vacío.
            const estructuraCompleta = {};
            for (const columna of COLUMNAS_VALIDAS) {
                estructuraCompleta[columna] = ''; // Usamos '' como valor por defecto.
            }

            // 2. Llenamos la estructura completa con los datos que SÍ tenemos para un nuevo contacto.
            contactoParaEnviar = {
                ...estructuraCompleta,
                ...datosNuevos, // Aplicamos datos como NOMBRE: 'Sin Nombre' que vienen desde flowIAinfo
                TELEFONO: phone,
                FECHA_PRIMER_CONTACTO: new Date().toLocaleDateString('es-CO'),
                ETIQUETA: 'Nuevo', // Cambiado a 'Nuevo' para consistencia con los logs
                RESP_BOT: 'Sí'
            };
        }

        // 3. Siempre actualizamos la fecha del último contacto
        contactoParaEnviar.FECHA_ULTIMO_CONTACTO = new Date().toLocaleDateString('es-CO');

        // 4. Garantía Anti-Corrupción: Aseguramos que el teléfono sea el correcto
        contactoParaEnviar.TELEFONO = phone;

        // 5. ENVIAR A APPSHEET Y ACTUALIZAR CACHÉ
        console.log(`📦 [CONTACTOS] Objeto final a enviar a AppSheet para ${phone}:`, contactoParaEnviar);
        const resp = await postTableWithRetry(APPSHEETCONFIG, process.env.PAG_CONTACTOS, [contactoParaEnviar], propiedades);
        
        if (!resp || (Array.isArray(resp) && resp.length === 0)) {
            console.error(`❌ [CONTACTOS] postTable devolvió una respuesta vacía o fallida para ${phone}. No se actualizó la caché con los nuevos datos.`);
            // IMPORTANTE: Si falla, no actualizamos la caché con datos que no se guardaron.
            // Se podría actualizar con los datos previos si existían.
            if(contactoPrevio) {
                actualizarContactoEnCache(contactoPrevio);
            }
            return;
        }

        // Si el guardado fue exitoso, actualizamos la caché local con el objeto completo.
        actualizarContactoEnCache(contactoParaEnviar);
        
        console.log(`✅ [CONTACTOS] Contacto ${phone} procesado y guardado en AppSheet y caché.`);

    } catch (error) {
        console.error(`❌ [CONTACTOS] Error fatal en ActualizarContacto para ${phone}:`, error.message, error.stack);
    }
}

//=============== FIN DEL BLOQUE ===============
