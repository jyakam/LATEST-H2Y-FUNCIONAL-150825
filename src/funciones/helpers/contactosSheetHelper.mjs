import { postTable } from 'appsheet-connect'
import { ObtenerFechaActual } from '../../funciones/tiempo.mjs'
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
    // PASO 2: USAMOS LA FILA PARA LA TAREA
    // En lugar de llamar a postTable directamente, le pedimos a nuestro gestor que lo haga.
    await addTask(() => postTable(JSON.parse(JSON.stringify(APPSHEETCONFIG)), HOJA_CONTACTOS, [datos], PROPIEDADES))
    
    console.log(`📆 Contacto ${phone} actualizado con fechas.`)
    actualizarContactoEnCache({ ...contactoCompleto, ...datos })
  } catch (err) {
    console.log(`❌ Error actualizando fechas para ${phone} via queue:`, err.message)
    // Si la tarea en la fila falla, actualizamos la caché local para mantener la consistencia interna.
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
    // PASO 2: USAMOS LA FILA TAMBIÉN AQUÍ
    await addTask(() => postTable(JSON.parse(JSON.stringify(APPSHEETCONFIG)), HOJA_CONTACTOS, [datos], PROPIEDADES))

    console.log(`📝 Resumen actualizado para ${phone}`)
    actualizarContactoEnCache({ ...contactoCompleto, ...datos })
  } catch (err) {
    console.log(`❌ Error guardando resumen para ${phone} via queue:`, err.message)
    actualizarContactoEnCache({ ...contactoCompleto, ...datos })
    console.log(`⚠️ Cache actualizada localmente para ${phone} pese a error en AppSheet`)
  }
}
