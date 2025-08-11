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
  'TIPO_DE_CLIENTE',
  'RESUMEN_ULTIMA_CONVERSACION',
  'NUMERO_DE_TELEFONO_SECUNDARIO'
]

function aIso(entrada) {
  if (!entrada || typeof entrada !== 'string') return entrada
  const s = entrada.trim()
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if (m) {
    const [_, dd, mm, yyyy] = m
    const d = String(dd).padStart(2, '0')
    const M = String(mm).padStart(2, '0')
    return `${yyyy}-${M}-${d}`
  }
  return entrada
}

function sanitizarContacto(obj) {
  // 1) clonar
  const base = { ...obj }

  // 2) nunca enviar _RowNumber
  delete base._RowNumber

  // 3) mapear 'TIPO DE CLIENTE' -> 'TIPO_DE_CLIENTE'
  if (base['TIPO DE CLIENTE'] && !base.TIPO_DE_CLIENTE) {
    base.TIPO_DE_CLIENTE = base['TIPO DE CLIENTE']
    delete base['TIPO DE CLIENTE']
  }

  // 4) quitar columnas que no existen en CONTACTOS (ejemplo: FECHA_NACIMIENTO)
  delete base.FECHA_NACIMIENTO

  // 5) normalizar fechas a ISO si existen
  if (base.FECHA_PRIMER_CONTACTO) base.FECHA_PRIMER_CONTACTO = aIso(base.FECHA_PRIMER_CONTACTO)
  if (base.FECHA_ULTIMO_CONTACTO) base.FECHA_ULTIMO_CONTACTO = aIso(base.FECHA_ULTIMO_CONTACTO)
  if (base.FECHA_DE_CUMPLEANOS) base.FECHA_DE_CUMPLEANOS = aIso(base.FECHA_DE_CUMPLEANOS)

  // 6) quedarnos SOLO con columnas válidas
  const limpio = {}
  for (const k of COLUMNAS_VALIDAS) {
    if (base[k] !== undefined && base[k] !== null) {
      // Evitar mandar '' en tipos no-texto: si viene vacío, lo omitimos
      if (typeof base[k] === 'string') {
        limpio[k] = base[k]
      } else if (base[k] !== '') {
        limpio[k] = base[k]
      }
    }
  }

  return limpio
}

async function postTableWithRetry(config, table, data, props, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      // [DEBUG] Payload que REALMENTE se manda a AppSheet (pre-llamada)
      try {
        const accion = (props && (props.Action || props.action)) || 'Add';
        const primerRow = Array.isArray(data) ? data[0] : data;
        console.log(`[DEBUG AppSheet] PRE-POST Acción=${accion} Tabla=${table}`);
        if (Array.isArray(data)) {
          console.log(`[DEBUG AppSheet] PRE-POST TotalRows=${data.length}`);
        }
        console.log('[DEBUG AppSheet] PRE-POST Row[0]:', JSON.stringify(primerRow, null, 2));
      } catch (e) {
        console.log('[DEBUG AppSheet] Error log PRE-POST:', e?.message);
      }

      // 👇 Llamada original SIN cambios funcionales
      const resp = await postTable(JSON.parse(JSON.stringify(config)), table, data, props);

      // [DEBUG] Respuesta OK de AppSheet
      try {
        const printable = typeof resp === 'string' ? resp : JSON.stringify(resp, null, 2);
        console.log(`[DEBUG AppSheet] RESP OK Tabla=${table} ->`, printable);
      } catch (e) {
        console.log('[DEBUG AppSheet] Error log RESP OK:', e?.message);
      }

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
      // [DEBUG] Respuesta de error detallada (cuerpo y status si vienen)
      try {
        console.log(`[DEBUG AppSheet] RESP ERROR Tabla=${table} ->`, err?.message);
        if (err?.response) {
          console.log('[DEBUG AppSheet] ERROR STATUS:', err.response.status);
          try {
            console.log('[DEBUG AppSheet] ERROR BODY:', JSON.stringify(err.response.data, null, 2));
          } catch (_) {
            console.log('[DEBUG AppSheet] ERROR BODY (raw):', err.response.data);
          }
        } else if (err?.body) {
          console.log('[DEBUG AppSheet] ERROR BODY (body):', err.body);
        } else if (err?.stack) {
          console.log('[DEBUG AppSheet] ERROR STACK:', err.stack);
        }
      } catch (e) {
        console.log('[DEBUG AppSheet] Error log RESP ERROR:', e?.message);
      }

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
                RESP_BOT: 'true'
            };
        }

        // Siempre actualiza la fecha del último contacto y asegura el teléfono.
        contactoParaEnviar.FECHA_ULTIMO_CONTACTO = new Date().toLocaleDateString('es-CO');
        contactoParaEnviar.TELEFONO = phone;

   // 👉 Normalizamos y filtramos el objeto ANTES de enviarlo
contactoParaEnviar = sanitizarContacto(contactoParaEnviar)

// 👉 Elegimos la acción correcta para AppSheet
const props = contactoPrevio
  ? { Action: 'Edit', UserSettings: { DETECTAR: false } }
  : { Action: 'Add',  UserSettings: { DETECTAR: false } }

        // ✅ CAMBIO PRINCIPAL: Envolvemos la llamada a la base de datos en nuestro gestor de tareas.
        // Creamos la "tarea" que es la función que queremos ejecutar en la fila.
        const task = () => postTableWithRetry(APPSHEETCONFIG, process.env.PAG_CONTACTOS, [contactoParaEnviar], props)

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
