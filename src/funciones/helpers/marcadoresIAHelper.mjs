// /funciones/helpers/marcadoresIAHelper.mjs

import { ARCHIVO } from '../../config/bot.mjs'
import { EnviarIA } from '../../flujos/bloques/enviarIA.mjs'

// Función auxiliar para detectar el marcador
export function detectarSeccionesSolicitadas(respuesta) {
  // Soporta corchetes, paréntesis, llaves, y algunos emojis como delimitador
  // Puedes agregar o quitar emojis según los que quieras soportar
  const regex = /([\[\(\{🟦⭐🔥🧩])\s*SOLICITAR[_\s-]?SECCI[OÓ]N[:：]?\s*([A-Za-z0-9_ ,-]+)\s*([\]\)\}🟦⭐🔥🧩])/gi;
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
    console.log('🟠 [MARCADORES] Marcadores detectados en la respuesta de IA:', seccionesSolicitadas);

    const bloques = ARCHIVO.PROMPT_BLOQUES

    let nuevosBloques = [];
    // Siempre incluir SECCION 0
    nuevosBloques.push(bloques['seccion_0_introduccion_general'] || '');

    // --- NUEVO: SOLO este ciclo moderno, el anterior lo eliminamos ---
    if (seccionesSolicitadas && seccionesSolicitadas.length) {
      const pasos = [];
      const nuevasSecciones = [];

      seccionesSolicitadas.forEach(nombreSeccion => {
        // ¿Es un PASO del flujo?
        const matchPaso = nombreSeccion.match(/^PASO[_\s-]?(\d+)$/i)
        if (matchPaso) {
          const nuevoPaso = Number(matchPaso[1]) - 1; // Índice base 0
          pasos.push(nuevoPaso);

          // ACTUALIZACIÓN: Añadir inmediatamente el paso pedido al prompt
          const pasosFlujo = bloques.PASOS_FLUJO || [];
          if (pasosFlujo[nuevoPaso]) {
            nuevosBloques.push(pasosFlujo[nuevoPaso].contenido || pasosFlujo[nuevoPaso]);
            console.log(`🔄 [MARCADORES] Añadido PASO ${nuevoPaso + 1} al prompt (índice: ${nuevoPaso})`);
          } else {
            console.warn(`❗ [MARCADORES] El PASO ${nuevoPaso + 1} no existe en el array de pasos`);
          }
        } else {
          // Si es sección especial, añadir a lista
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
            nuevosBloques.push(bloques[clave]);
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

  // EXTRA: log para saber cuáles son las secciones activas al terminar el ciclo
  console.log('🔵 [STATE] Secciones activas actuales:', state.get('seccionesActivas') || [])

  return respuestaActual
}
