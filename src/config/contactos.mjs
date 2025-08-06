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

        let datosBase = {};
        if (contactoPrevio) {
            datosBase = { ...contactoPrevio };
        } else {
            console.log(`🆕 [CONTACTOS] Creando contacto base para ${phone}`);
            datosBase = {
                TELEFONO: phone,
                FECHA_PRIMER_CONTACTO: new Date().toLocaleDateString('es-CO'),
                ETIQUETA: 'Cliente',
                RESP_BOT: 'Sí'
            };
        }

        const contactoFusionado = {
            ...datosBase,
            ...datosNuevos,
            FECHA_ULTIMO_CONTACTO: new Date().toLocaleDateString('es-CO')
        };

        // 4. LIMPIEZA FINAL (CON TU VALIDACIÓN REINCORPORADA)
        const contactoLimpio = {};
        for (const columna of COLUMNAS_VALIDAS) {
            const valor = contactoFusionado[columna];
            // Solo incluimos el campo si es válido Y, en caso de ser un string, no está vacío.
            if (valor !== undefined && valor !== null) {
                if (typeof valor === 'string' && valor.trim() === '') {
                    // Si es un string vacío, no lo incluimos. Tu lógica original era mejor.
                    continue;
                }
                contactoLimpio[columna] = valor;
            }
        }
        
        // Garantía Anti-Corrupción
        contactoLimpio.TELEFONO = phone;

        // 5. ENVIAR A APPSHEET Y ACTUALIZAR CACHÉ
        const resp = await postTableWithRetry(APPSHEETCONFIG, process.env.PAG_CONTACTOS, [contactoLimpio], propiedades);
        
        if (!resp) {
          console.error(`❌ [CONTACTOS] postTable devolvió null/undefined para ${phone}`);
          actualizarContactoEnCache(contactoPrevio || datosBase);
          return;
        }

        actualizarContactoEnCache(contactoLimpio);
        
        console.log(`✅ [CONTACTOS] Contacto ${phone} procesado y actualizado en caché.`);

    } catch (error) {
        console.error(`❌ [CONTACTOS] Error fatal en ActualizarContacto para ${phone}:`, error.message, error.stack);
    }
}

//=============== FIN DEL BLOQUE ===============
