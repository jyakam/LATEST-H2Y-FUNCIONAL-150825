// /funciones/helpers/marcadoresIAHelper.mjs

import { ARCHIVO } from '../../config/bot.mjs'
import { EnviarIA } from '../../flujos/bloques/enviarIA.mjs'

// Función auxiliar para detectar el marcador
export function detectarSeccionesSolicitadas(respuesta) {
  // Soporta corchetes, paréntesis, llaves, y algunos emojis como delimitador
  // Puedes agregar o quitar emojis según los que quieras soportar
  const regex = /([\[\(\{🟦⭐🔥🧩])\s*SOLICITAR[_\s-]?SECCI[OÓ]N[:：]?\s*([A-Za-z0-9_,-]+)\s*([\]\)\}🟦⭐🔥🧩])/gi;
  let match;
  const secciones = [];
  while ((match = regex.exec(respuesta)) !== null) {
    // El nombre de la sección queda en match[2]
    secciones.push(...match[2].split(',').map(x => x.trim()));
  }
  return secciones.length ? secciones : null;
}

// Función principal para el ciclo de marcadores
export async function cicloMarcadoresIA(res, txt, state, ctx, tools) {
  let seccionesSolicitadas = detectarSeccionesSolicitadas(res.respuesta)
  let intentos = 0
  const maxIntentos = 3
  let respuestaActual = res

  while (seccionesSolicitadas && intentos < maxIntentos) {
    console.log(`🔍 [MARCADORES] IA solicitó las siguientes secciones: ${seccionesSolicitadas.join(', ')}`)

    const bloques = ARCHIVO.PROMPT_BLOQUES

    let nuevosBloques = []
    let pasoFlujoActual = state.get('pasoFlujoActual') ?? 0
    const promptBase = [
      bloques['seccion_0_introduccion_general'] || '',
      (bloques.PASOS_FLUJO && bloques.PASOS_FLUJO[pasoFlujoActual]) || ''
    ].filter(Boolean).join('\n\n')
    nuevosBloques.push(promptBase)

    let seccionActivaNueva = null // Para registrar sección especial activa

    seccionesSolicitadas.forEach(nombreSeccion => {
      // Detectar si el marcador es un PASO del flujo (ej: PASO_2)
      const matchPaso = nombreSeccion.match(/^PASO[_\s-]?(\d+)$/i)
      if (matchPaso) {
        const nuevoPaso = Number(matchPaso[1]) - 1 // Índice de array, comienza en 0
        if (!isNaN(nuevoPaso)) {
          pasoFlujoActual = nuevoPaso
          state.update({ pasoFlujoActual: nuevoPaso })
          console.log(`🔄 [MARCADORES] Avanzando a PASO ${nuevoPaso + 1} (índice: ${nuevoPaso})`)
        }
      }

      // Buscar sección pedida (insensible a mayúsculas/minúsculas)
      let clave = Object.keys(bloques).find(
        k => k.toLowerCase() === nombreSeccion.toLowerCase()
      )
      if (!clave) {
        clave = Object.keys(bloques).find(
          k => k.toLowerCase().replace(/[\s-]/g, '_').includes(nombreSeccion.toLowerCase().replace(/[\s-]/g, '_'))
        )
      }
      if (clave) {
        nuevosBloques.push(bloques[clave])
        seccionActivaNueva = clave // guardar la sección activada
        console.log('🟣 [TRIGGER] Sección agregada al prompt:', clave)
      } else {
        console.warn('🔴 [TRIGGER] No se encontró el bloque:', nombreSeccion)
      }
    })

   // ... dentro de cicloMarcadoresIA ...

if (seccionesSolicitadas && seccionesSolicitadas.length) {
  const pasos = [];
  const nuevasSecciones = [];

  seccionesSolicitadas.forEach(nombreSeccion => {
    // ¿Es un PASO del flujo?
    const matchPaso = nombreSeccion.match(/^PASO[_\s-]?(\d+)$/i)
    if (matchPaso) {
      pasos.push(Number(matchPaso[1]) - 1); // Guarda el nuevo paso (índice base 0)
    } else {
      // Si es sección especial, añadir a lista
      // Busca el nombre clave de la sección
      let clave = Object.keys(bloques).find(
        k => k.toLowerCase() === nombreSeccion.toLowerCase()
      );
      if (!clave) {
        clave = Object.keys(bloques).find(
          k => k.toLowerCase().replace(/[\s-]/g, '_').includes(nombreSeccion.toLowerCase().replace(/[\s-]/g, '_'))
        );
      }
      if (clave) {
        nuevasSecciones.push(clave);
        console.log('🟣 [TRIGGER] Sección agregada al prompt:', clave);
      } else {
        console.warn('🔴 [TRIGGER] No se encontró el bloque:', nombreSeccion);
      }
    }
  });

  // Si hay algún paso pedido, borra todas las secciones activas y avanza solo el paso.
  if (pasos.length) {
    await state.update({
      pasoFlujoActual: pasos[pasos.length - 1], // Solo toma el último paso pedido
      seccionesActivas: []
    });
    console.log(`💾 [MARCADORES] Secciones activas ELIMINADAS por salto a PASO. Avanzando a PASO ${pasos[pasos.length - 1] + 1}`);
  } else if (nuevasSecciones.length) {
    // Si se pidieron secciones, añade todas (sin duplicados)
    let actuales = state.get('seccionesActivas') || [];
    nuevasSecciones.forEach(sec => {
      if (!actuales.includes(sec)) actuales.push(sec);
    });
  await state.update({ seccionesActivas: actuales });
console.log(`💾 [MARCADORES] Secciones activas guardadas en el state: [${actuales.join(', ')}]`);
console.log('🔵 [STATE] Secciones activas actuales:', state.get('seccionesActivas') || []);
  }
}

    // SOLO LOGUEA LOS NOMBRES Y LOS PRIMEROS 200 CARACTERES (no la BC completa)
    console.log('📝 [MARCADORES] Secciones enviadas a la IA:')
    nuevosBloques.forEach((bloque, i) => {
      const preview = (bloque || '').substring(0, 200).replace(/\n/g, ' ')
      console.log(`   • BLOQUE ${i + 1}: ${preview}${bloque && bloque.length > 200 ? '...' : ''}`)
    })

    respuestaActual = await EnviarIA(txt, nuevosBloques.filter(Boolean).join('\n\n'), {
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

  // Al terminar, log del paso actual
  let pasoActualFinal = state.get('pasoFlujoActual') ?? 0
  console.log(`✅ [MARCADORES] Paso de flujo actual después del ciclo: PASO ${pasoActualFinal + 1} (índice: ${pasoActualFinal})`)

  // EXTRA: log para saber cuál es la sección activa al terminar el ciclo
  if (state.get('seccionActiva')) {
    console.log(`🔵 [MARCADORES] Sección activa final: ${state.get('seccionActiva')}`)
  }

  return respuestaActual
}
