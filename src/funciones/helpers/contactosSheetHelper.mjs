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

// Wrapper local para que la respuesta vacía de AppSheet no rompa la ejecución
async function postTableWithRetrySafe(config, table, data, props, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      // usamos la misma firma que postTable, pero tolerante a cuerpo vacío / string
      const resp = await postTable(config, table, data, props)
      if (!resp) return [] // AppSheet a veces responde sin cuerpo (204)
      if (typeof resp === 'string') {
        try { return JSON.parse(resp) } catch { return [] }
      }
      return resp
    } catch (err) {
      if (i === retries - 1) throw err
      await new Promise(r => setTimeout(r, delay))
    }
  }
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

  // ¿Existe ya en la caché?
  const existeEnCache = !!getContactoByTelefono(phone)
  let contactoCompleto = getContactoByTelefono(phone) || contacto || {}

  const datos = {
    ...contactoCompleto,
    TELEFONO: phone,
    // Si ya existía, conservamos la primera; si es nuevo, la fijamos hoy
    FECHA_PRIMER_CONTACTO: contactoCompleto?.FECHA_PRIMER_CONTACTO || hoy,
    FECHA_ULTIMO_CONTACTO: hoy
  }

  console.log(`🕓 [FECHAS] Contacto ${phone} →`, datos)

  try {
    console.log(`[DEBUG FECHAS] ENCOLAR Tabla=${HOJA_CONTACTOS}`)
    console.log('[DEBUG FECHAS] Row ENCOLADO (crudo):', JSON.stringify(datos, null, 2))

    // Sanitizar/normalizar antes de enviar (fechas a ISO, sin _RowNumber, etc.)
    const row = limpiarRowContacto(datos)
    console.log('[DEBUG FECHAS] Row FINAL (sanitizado):', JSON.stringify(row, null, 2))

    // Acción dinámica: Add si NO existe, Edit si SÍ existe
    const propsDinamicas = existeEnCache
      ? { Action: 'Edit', UserSettings: { DETECTAR: false } }
      : { Action: 'Add',  UserSettings: { DETECTAR: false } }

    console.log(`[DEBUG FECHAS] Acción AppSheet = ${propsDinamicas.Action}`)

    // 🔑 Instancia FRESCA de AppSheet por operación (evita estado raro)
    await addTask(() => {
      const localCfg = new AppSheetUser(appsheetId, appsheetKey)
      console.log('[DEBUG FECHAS] Usando instancia AppSheet local para la operación')
      return postTableWithRetrySafe(localCfg, HOJA_CONTACTOS, [row], propsDinamicas)
    })

    console.log(`📆 Contacto ${phone} actualizado con fechas.`)
    actualizarContactoEnCache({ ...contactoCompleto, ...datos })
  } catch (err) {
    console.log(`❌ Error actualizando fechas para ${phone} via queue:`, err?.message)
    if (err?.response) {
      console.log('[DEBUG FECHAS] ERROR STATUS:', err.response.status)
      const body = err.response.data ?? err.response.body ?? {}
      try { console.log('[DEBUG FECHAS] ERROR BODY:', JSON.stringify(body, null, 2)) }
      catch { console.log('[DEBUG FECHAS] ERROR BODY (raw):', body) }
    } else if (err?.body) {
      console.log('[DEBUG FECHAS] ERROR BODY (body):', err.body)
    } else if (err?.stack) {
      console.log('[DEBUG FECHAS] ERROR STACK:', err.stack)
    }

    // Consistencia local aunque falle AppSheet
    actualizarContactoEnCache({ ...contactoCompleto, ...datos })
    console.log(`⚠️ Cache actualizada localmente para ${phone} pese a error en AppSheet`)
  }
}

export async function ActualizarResumenUltimaConversacion(contacto, phone, resumen) {
  console.log(`🧠 Intentando guardar resumen para ${phone}:`, resumen)

  // Validaciones para guardar solo resúmenes útiles
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

  const existeEnCache = !!getContactoByTelefono(phone)
  let contactoCompleto = getContactoByTelefono(phone) || contacto || {}

  const datos = {
    ...contactoCompleto,
    TELEFONO: phone,
    RESUMEN_ULTIMA_CONVERSACION: resumen.trim()
  }

  try {
    console.log(`[DEBUG RESUMEN] ENCOLAR Tabla=${HOJA_CONTACTOS}`)
    console.log('[DEBUG RESUMEN] Row ENCOLADO (crudo):', JSON.stringify(datos, null, 2))

    const row = limpiarRowContacto(datos)
    console.log('[DEBUG RESUMEN] Row FINAL (sanitizado):', JSON.stringify(row, null, 2))

    const propsDinamicas = existeEnCache
      ? { Action: 'Edit', UserSettings: { DETECTAR: false } }
      : { Action: 'Add',  UserSettings: { DETECTAR: false } }

    console.log(`[DEBUG RESUMEN] Acción AppSheet = ${propsDinamicas.Action}`)

    // Instancia FRESCA por operación
    await addTask(() => {
      const localCfg = new AppSheetUser(appsheetId, appsheetKey)
      console.log('[DEBUG RESUMEN] Usando instancia AppSheet local para la operación')
      return postTableWithRetrySafe(localCfg, HOJA_CONTACTOS, [row], propsDinamicas)
    })

    console.log(`📝 Resumen actualizado para ${phone}`)
    actualizarContactoEnCache({ ...contactoCompleto, ...datos })
  } catch (err) {
    console.log(`❌ Error guardando resumen para ${phone} via queue:`, err?.message)
    if (err?.response) {
      console.log('[DEBUG RESUMEN] ERROR STATUS:', err.response.status)
      const body = err.response.data ?? err.response.body ?? {}
      try { console.log('[DEBUG RESUMEN] ERROR BODY:', JSON.stringify(body, null, 2)) }
      catch { console.log('[DEBUG RESUMEN] ERROR BODY (raw):', body) }
    } else if (err?.body) {
      console.log('[DEBUG RESUMEN] ERROR BODY (body):', err.body)
    } else if (err?.stack) {
      console.log('[DEBUG RESUMEN] ERROR STACK:', err.stack)
    }

    actualizarContactoEnCache({ ...contactoCompleto, ...datos })
    console.log(`⚠️ Cache actualizada localmente para ${phone} pese a error en AppSheet`)
  }
}
