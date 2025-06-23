import { ARCHIVO } from '../../config/bot.mjs'
import { EnviarIA } from '../../flujos/bloques/enviarIA.mjs'

// Función auxiliar para detectar el marcador
export function detectarSeccionesSolicitadas(respuesta) {
  // Soporta emojis al inicio (🟦⭐🔥🧩) y valores sin delimitador final ni SOLICITAR_SECCIÓN
  const regex = /(?:[\[\(\{🟦⭐🔥🧩])\s*(?:SOLICITAR[_\s-]?SECCI[OÓ]N[:：]?\s*)?([A-Za-z0-9_ ,-]+)(?:[\]\)\}🟦⭐🔥🧩])?/gi;
  let match;
  const secciones = [];
  console.log('🔍 [MARCADORES] Analizando respuesta para marcadores:', respuesta);
  while ((match = regex.exec(respuesta)) !== null) {
    const valor = match[1].trim();
    console.log('🟢 [MARCADORES] Marcador detectado:', valor);
    secciones.push(...valor.split(',').map(x => x.trim()));
  }
  if (!secciones.length) {
    console.log('⚠️ [MARCADORES] No se encontraron marcadores en la respuesta');
    return null;
  }
  console.log('🟢 [MARCADORES] Secciones solicitadas:', secciones);
  return secciones;
}

// Función principal para el ciclo de marcadores
export async function cicloMarcadoresIA(res, txt, state, ctx, { flowDynamic, endFlow, gotoFlow, provider }) {
  let respuesta = res.respuesta || '';
  console.log('🟢 [MARCADORES] Procesando respuesta IA:', respuesta);
  const respuestaLower = respuesta.toLowerCase();
  // Soporta marcadores con corchetes (anidados o simples) y emojis
  const marcadorRegex = /\[ACTIVANDO MARCADOR: \[SOLICITAR_SECCI[OÓ]N: ([A-Z0-9_]+)\]\]|\[SOLICITAR_SECCI[OÓ]N: ([A-Z0-9_]+)\]|🧩([A-Z0-9_]+)/gi;
  let match;
  let marcadorProcesado = false;

  while ((match = marcadorRegex.exec(respuesta)) !== null) {
    const valor = match[1] || match[2] || match[3]; // Captura el valor (corchetes o emoji)
    if (!valor) {
      console.log('⚠️ [MARCADORES] Valor de marcador inválido:', match);
      continue;
    }
    marcadorProcesado = true;
    console.log(`🟢 [MARCADORES] Procesando marcador: ${valor}`);

    if (valor.match(/^PASO_\d+$/)) {
      const pasoNum = parseInt(valor.replace('PASO_', '')) - 1;
      await state.update({ pasoFlujoActual: pasoNum });
      console.log(`🟢 [MARCADORES] Actualizado pasoFlujoActual a PASO ${pasoNum + 1}`);
    } else if (valor === 'mostrarproductos' || valor === 'mostrardetalles') {
      console.log(`🟢 [MARCADORES] Redirigiendo a flujo para: ${valor}`);
      await gotoFlow(valor === 'mostrarproductos' ? flowProductos : flowDetallesProducto);
    } else {
      const nuevasSecciones = state.get('seccionesActivas') || [];
      if (!nuevasSecciones.includes(valor)) {
        nuevasSecciones.push(valor);
        await state.update({ seccionesActivas: nuevasSecciones });
        console.log(`🟢 [MARCADORES] Añadida sección activa: ${valor}`);
      } else {
        console.log(`🟡 [MARCADORES] Sección ya activa, no se añade: ${valor}`);
      }
    }
  }

  if (marcadorProcesado) {
    console.log('🟢 [MARCADORES] Respuesta limpia tras procesar marcadores:', respuesta.replace(marcadorRegex, '').trim());
    return { respuesta: respuesta.replace(marcadorRegex, '').trim(), tipo: res.tipo || 0 };
  }

  console.log('🟢 [MARCADORES] No se procesaron marcadores, devolviendo respuesta original');
  return res;
}
