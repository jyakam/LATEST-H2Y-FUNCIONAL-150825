import { postTable, AppSheetUser } from 'appsheet-connect' // Añadimos AppSheetUser
import { ObtenerFechaActual } from '../../funciones/tiempo.mjs'
import { appsheetId, appsheetKey } from '../../config/bot.mjs' // Cambiamos la importación
import { APPSHEETCONFIG } from '../../config/bot.mjs'
// IMPORTANTE: importa la función para actualizar la cache
import { getContactoByTelefono, actualizarContactoEnCache } from './cacheContactos.mjs'
// PASO 1: IMPORTAMOS NUESTRO NUEVO GESTOR DE LA FILA
import { addTask } from './taskQueue.mjs'

// -- utilitario local para contactosSheetHelper --
function aIso(entrada) {
  if (!entrada || typeof entrada !== 'string') return entrada
  const s = entrada.trim()
  // admite "dd/mm/yyyy" o "dd-mm-yyyy"
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if (m) {
    const [_, dd, mm, yyyy] = m
    const d = String(dd).padStart(2, '0')
    const M = String(mm).padStart(2, '0')
    return `${yyyy}-${M}-${d}` // ISO
  }
  // si ya viene ISO o algo distinto, lo dejamos igual
  return entrada
}

function limpiarRowContacto(row) {
  const out = { ...row }
  // 1) nunca enviar _RowNumber
  delete out._RowNumber
  // 2) mapear 'TIPO DE CLIENTE' -> 'TIPO_DE_CLIENTE' si llega con espacio
  if (out['TIPO DE CLIENTE'] && !out.TIPO_DE_CLIENTE) {
    out.TIPO_DE_CLIENTE = out['TIPO DE CLIENTE']
    delete out['TIPO DE CLIENTE']
  }
  // 3) no mandar columnas inexistentes aquí (ej: FECHA_NACIMIENTO)
  delete out.FECHA_NACIMIENTO

  // 4) fechas a ISO cuando existan
  if (out.FECHA_PRIMER_CONTACTO) out.FECHA_PRIMER_CONTACTO = aIso(out.FECHA_PRIMER_CONTACTO)
  if (out.FECHA_ULTIMO_CONTACTO) out.FECHA_ULTIMO_CONTACTO = aIso(out.FECHA_ULTIMO_CONTACTO)
  if (out.FECHA_DE_CUMPLEANOS) out.FECHA_DE_CUMPLEANOS = aIso(out.FECHA_DE_CUMPLEANOS)

  return out
}

// Todas las actualizaciones desde este helper son EDICIONES a una fila existente
const PROPIEDADES = { Action: 'Edit', UserSettings: { DETECTAR: false } }
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
    console.log(`[DEBUG FECHAS] ENCOLAR Tabla=${HOJA_CONTACTOS}`)
    console.log('[DEBUG FECHAS] Row ENCOLADO:', JSON.stringify(datos, null, 2))

    // 👉 limpiar payload antes de enviar
    const row = limpiarRowContacto(datos)

    // PASO 2: USAMOS LA FILA PARA LA TAREA (Edit)
    await addTask(() =>
      postTable(JSON.parse(JSON.stringify(APPSHEETCONFIG)), HOJA_CONTACTOS, [row], PROPIEDADES)
    )

    console.log(`📆 Contacto ${phone} actualizado con fechas.`)
    actualizarContactoEnCache({ ...contactoCompleto, ...datos })
  } catch (err) {
    // [DEBUG] Error detallado (status + body si vienen)
    console.log(`❌ Error actualizando fechas para ${phone} via queue:`, err?.message)
    if (err?.response) {
      console.log('[DEBUG FECHAS] ERROR STATUS:', err.response.status)
      const body = err.response.data ?? err.response.body ?? {}
      try {
        console.log('[DEBUG FECHAS] ERROR BODY:', JSON.stringify(body, null, 2))
      } catch {
        console.log('[DEBUG FECHAS] ERROR BODY (raw):', body)
      }
    } else if (err?.body) {
      console.log('[DEBUG FECHAS] ERROR BODY (body):', err.body)
    } else if (err?.stack) {
      console.log('[DEBUG FECHAS] ERROR STACK:', err.stack)
    }

    // Consistencia local
    actualizarContactoEnCache({ ...contactoCompleto, ...datos })
    console.log(`⚠️ Cache actualizada localmente para ${phone} pese a error en AppSheet`)
  }
}

export async function ActualizarResumenUltimaConversacion(contacto, phone, resumen) {
  console.log(`🧠 Intentando guardar resumen para ${phone}:`, resumen)

  // validaciones ya existentes
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
    console.log(`[DEBUG RESUMEN] ENCOLAR Tabla=${HOJA_CONTACTOS}`)
    console.log('[DEBUG RESUMEN] Row ENCOLADO:', JSON.stringify(datos, null, 2))

    // 👉 limpiar payload antes de enviar
    const row = limpiarRowContacto(datos)

    // PASO 2: USAMOS LA FILA TAMBIÉN AQUÍ (Edit)
    await addTask(() =>
      postTable(JSON.parse(JSON.stringify(APPSHEETCONFIG)), HOJA_CONTACTOS, [row], PROPIEDADES)
    )

    console.log(`📝 Resumen actualizado para ${phone}`)
    actualizarContactoEnCache({ ...contactoCompleto, ...datos })
  } catch (err) {
    // [DEBUG] Error detallado (status + body si vienen)
    console.log(`❌ Error guardando resumen para ${phone} via queue:`, err?.message)
    if (err?.response) {
      console.log('[DEBUG RESUMEN] ERROR STATUS:', err.response.status)
      const body = err.response.data ?? err.response.body ?? {}
      try {
        console.log('[DEBUG RESUMEN] ERROR BODY:', JSON.stringify(body, null, 2))
      } catch {
        console.log('[DEBUG RESUMEN] ERROR BODY (raw):', body)
      }
    } else if (err?.body) {
      console.log('[DEBUG RESUMEN] ERROR BODY (body):', err.body)
    } else if (err?.stack) {
      console.log('[DEBUG RESUMEN] ERROR STACK:', err.stack)
    }

    // Consistencia local
    actualizarContactoEnCache({ ...contactoCompleto, ...datos })
    console.log(`⚠️ Cache actualizada localmente para ${phone} pese a error en AppSheet`)
  }
}
