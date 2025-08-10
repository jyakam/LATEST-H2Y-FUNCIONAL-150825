import { postTable, AppSheetUser } from 'appsheet-connect' // Añadimos AppSheetUser
import { ObtenerFechaActual } from '../../funciones/tiempo.mjs'
import { appsheetId, appsheetKey } from '../../config/bot.mjs' // Cambiamos la importación
import { APPSHEETCONFIG } from '../../config/bot.mjs'
// IMPORTANTE: importa la función para actualizar la cache
import { getContactoByTelefono, actualizarContactoEnCache } from './cacheContactos.mjs'
// PASO 1: IMPORTAMOS NUESTRO NUEVO GESTOR DE LA FILA
import { addTask } from './taskQueue.mjs'

const PROPIEDADES = { UserSettings: { DETECTAR: false } }
const HOJA_CONTACTOS = process.env.PAG_CONTACTOS

export async function ActualizarFechasContacto(contacto, phone) {
  const hoy = ObtenerFechaActual()
  let contactoCompleto = getContactoByTelefono(phone) || contacto || {}
  const datos = {
    ...contactoCompleto,
    TELEFONO: phone,
    FECHA_PRIMER_CONTACTO: contactoCompleto?.FECHA_PRIMER_CONTACTO || hoy,
    FECHA_ULTIMO_CONTACTO: hoy
  }

  console.log(`🕓 [FECHAS] Contacto ${phone} →`, datos)

   try {
    // [DEBUG] Encolando actualización de FECHAS (qué tabla y qué row mandamos)
    try {
      console.log(`[DEBUG FECHAS] ENCOLAR Tabla=${HOJA_CONTACTOS}`);
      console.log('[DEBUG FECHAS] Row ENCOLADO:', JSON.stringify(datos, null, 2));
    } catch (e) {
      console.log('[DEBUG FECHAS] Error log ENCOLADO:', e?.message);
    }

   try {
  // [DEBUG] Encolando actualización de FECHAS (qué tabla y qué row mandamos)
  try {
    console.log(`[DEBUG FECHAS] ENCOLAR Tabla=${HOJA_CONTACTOS}`);
    console.log('[DEBUG FECHAS] Row ENCOLADO:', JSON.stringify(datos, null, 2));
  } catch (e) {
    console.log('[DEBUG FECHAS] Error log ENCOLADO:', e?.message);
  }

  // PASO 2: USAMOS LA FILA PARA LA TAREA (llamada original, sin cambios)
  await addTask(() => postTable(JSON.parse(JSON.stringify(APPSHEETCONFIG)), HOJA_CONTACTOS, [datos], PROPIEDADES))
  
  console.log(`📆 Contacto ${phone} actualizado con fechas.`)
  actualizarContactoEnCache({ ...contactoCompleto, ...datos })
} catch (err) {
  // [DEBUG] Error detallado (status + body si vienen)
  try {
    console.log(`❌ Error actualizando fechas para ${phone} via queue:`, err?.message);
    if (err?.response) {
      console.log('[DEBUG FECHAS] ERROR STATUS:', err.response.status);
      try {
        console.log('[DEBUG FECHAS] ERROR BODY:', JSON.stringify(err.response.data, null, 2));
      } catch (_) {
        console.log('[DEBUG FECHAS] ERROR BODY (raw):', err.response.data);
      }
    } else if (err?.body) {
      console.log('[DEBUG FECHAS] ERROR BODY (body):', err.body);
    } else if (err?.stack) {
      console.log('[DEBUG FECHAS] ERROR STACK:', err.stack);
    }
  } catch (e) {
    console.log('[DEBUG FECHAS] Error log RESP ERROR:', e?.message);
  }

  // Mantenemos tu consistencia local
  actualizarContactoEnCache({ ...contactoCompleto, ...datos })
  console.log(`⚠️ Cache actualizada localmente para ${phone} pese a error en AppSheet`)
}
}

export async function ActualizarResumenUltimaConversacion(contacto, phone, resumen) {
  console.log(`🧠 Intentando guardar resumen para ${phone}:`, resumen)

  if (
    !resumen ||
    resumen.length < 5 ||
    resumen.trim().startsWith('{') ||
    resumen.trim().startsWith('```json') ||
    resumen.toLowerCase().includes('"nombre"') ||
    resumen.toLowerCase().includes('"email"')
  ) {
    console.log(`⛔ Resumen ignorado por formato inválido para ${phone}`)
    return
  }

  let contactoCompleto = getContactoByTelefono(phone) || contacto || {}

  const datos = {
    ...contactoCompleto,
    TELEFONO: phone,
    RESUMEN_ULTIMA_CONVERSACION: resumen.trim()
  }

  try {
  // [DEBUG] Encolando actualización de RESUMEN (qué tabla y qué row mandamos)
  try {
    console.log(`[DEBUG RESUMEN] ENCOLAR Tabla=${HOJA_CONTACTOS}`);
    console.log('[DEBUG RESUMEN] Row ENCOLADO:', JSON.stringify(datos, null, 2));
  } catch (e) {
    console.log('[DEBUG RESUMEN] Error log ENCOLADO:', e?.message);
  }

  // PASO 2: USAMOS LA FILA TAMBIÉN AQUÍ (llamada original, sin cambios)
  await addTask(() => postTable(JSON.parse(JSON.stringify(APPSHEETCONFIG)), HOJA_CONTACTOS, [datos], PROPIEDADES))

  console.log(`📝 Resumen actualizado para ${phone}`)
  actualizarContactoEnCache({ ...contactoCompleto, ...datos })
} catch (err) {
  // [DEBUG] Error detallado (status + body si vienen)
  try {
    console.log(`❌ Error guardando resumen para ${phone} via queue:`, err?.message);
    if (err?.response) {
      console.log('[DEBUG RESUMEN] ERROR STATUS:', err.response.status);
      try {
        console.log('[DEBUG RESUMEN] ERROR BODY:', JSON.stringify(err.response.data, null, 2));
      } catch (_) {
        console.log('[DEBUG RESUMEN] ERROR BODY (raw):', err.response.data);
      }
    } else if (err?.body) {
      console.log('[DEBUG RESUMEN] ERROR BODY (body):', err.body);
    } else if (err?.stack) {
      console.log('[DEBUG RESUMEN] ERROR STACK:', err.stack);
    }
  } catch (e) {
    console.log('[DEBUG RESUMEN] Error log RESP ERROR:', e?.message);
  }

  // Consistencia local
  actualizarContactoEnCache({ ...contactoCompleto, ...datos })
  console.log(`⚠️ Cache actualizada localmente para ${phone} pese a error en AppSheet`)
}
}
