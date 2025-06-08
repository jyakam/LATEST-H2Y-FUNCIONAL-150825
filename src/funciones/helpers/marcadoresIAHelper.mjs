// /funciones/helpers/marcadoresIAHelper.mjs

import { ARCHIVO } from '../../config/bot.mjs'
import { EnviarIA } from '../../flujos/bloques/enviarIA.mjs'

// Función auxiliar para detectar el marcador
export function detectarSeccionesSolicitadas(respuesta) {
  const regex = /\[SOLICITAR_SECCION:\s*([A-Za-z0-9_,-]+)\]/i
  const match = respuesta.match(regex)
  if (match) {
    return match[1].split(',').map(x => x.trim())
  }
  return null
}

// Función principal para el ciclo de marcadores
export async function cicloMarcadoresIA(res, txt, state, ctx, tools) {
  let seccionesSolicitadas = detectarSeccionesSolicitadas(res.respuesta)
  let intentos = 0
  const maxIntentos = 3
  let respuestaActual = res

  while (seccionesSolicitadas && intentos < maxIntentos) {
    const bloques = ARCHIVO.PROMPT_BLOQUES

    let nuevosBloques = []
    const pasoFlujoActual = state.get('pasoFlujoActual') ?? 0
    const promptBase = [
      bloques['seccion_0_introduccion_general'] || '',
      (bloques.PASOS_FLUJO && bloques.PASOS_FLUJO[pasoFlujoActual]) || ''
    ].filter(Boolean).join('\n\n')
    nuevosBloques.push(promptBase)

    seccionesSolicitadas.forEach(nombreSeccion => {
      let clave = Object.keys(bloques).find(
        k => k.toLowerCase() === nombreSeccion.toLowerCase()
      )
      if (!clave) {
        clave = Object.keys(bloques).find(
          k => k.toLowerCase().includes(nombreSeccion.toLowerCase())
        )
      }
      if (clave) {
        nuevosBloques.push(bloques[clave])
        console.log('🟣 [TRIGGER] Sección agregada al prompt:', clave)
      } else {
        console.warn('🔴 [TRIGGER] No se encontró el bloque:', nombreSeccion)
      }
    })

    const nuevoPrompt = nuevosBloques.filter(Boolean).join('\n\n')

    respuestaActual = await EnviarIA(txt, nuevoPrompt, {
      ...tools,
      promptExtra: ''
    }, {
      esClienteNuevo: state.get('contacto')?.NOMBRE === 'Sin Nombre',
      contacto: state.get('contacto') || {}
    })
    console.log('🟣 [TRIGGER] Respuesta recibida tras agregar secciones:', respuestaActual?.respuesta)
    seccionesSolicitadas = detectarSeccionesSolicitadas(respuestaActual.respuesta)
    intentos++
  }

  return respuestaActual
}
