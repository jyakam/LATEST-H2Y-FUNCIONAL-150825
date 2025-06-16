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
async function cicloMarcadoresIA(res, txt, state, ctx, { flowDynamic, endFlow, gotoFlow, provider }) {
  let respuesta = res.respuesta || '';
  const respuestaLower = respuesta.toLowerCase();
  const marcadorRegex = /\[ACTIVANDO MARCADOR: \[SOLICITAR_SECCI[OÓ]N: ([A-Z0-9_]+)\]\]|\[SOLICITAR_SECCI[OÓ]N: ([A-Z0-9_]+)\]/gi;
  let match;
  let marcadorProcesado = false;

  while ((match = marcadorRegex.exec(respuesta)) !== null) {
    const valor = match[1] || match[2]; // Captura el valor del marcador (ej. PASO_2, SECCIÓN_3_BLOQUE_DE_PRODUCTOS)
    if (!valor) continue;
    marcadorProcesado = true;
    console.log(`🟢 [MARCADORES] Procesando marcador: ${valor}`);

    if (valor.match(/^PASO_\d+$/)) {
      const pasoNum = parseInt(valor.replace('PASO_', '')) - 1;
      await state.update({ pasoFlujoActual: pasoNum });
      console.log(`🟢 [MARCADORES] Actualizado pasoFlujoActual a PASO ${pasoNum + 1}`);
    } else {
      const nuevasSecciones = state.get('seccionesActivas') || [];
      if (!nuevasSecciones.includes(valor)) {
        nuevasSecciones.push(valor);
        await state.update({ seccionesActivas: nuevasSecciones });
        console.log(`🟢 [MARCADORES] Añadida sección activa: ${valor}`);
      }
    }
  }

  if (marcadorProcesado) {
    return { respuesta: respuesta.replace(marcadorRegex, '').trim(), tipo: res.tipo || 0 };
  }

  return res;
}
