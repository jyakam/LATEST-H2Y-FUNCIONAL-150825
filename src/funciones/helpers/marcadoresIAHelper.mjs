import { ARCHIVO } from '../../config/bot.mjs'
import { EnviarIA } from '../../flujos/bloques/enviarIA.mjs'

function normalizarClave(txt = '') {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function detectarSeccionesSolicitadas(respuesta) {
  const regex = /(?:[\p{Emoji}\u2600-\u27BF\uE000-\uF8FF\uD83C-\uDBFF\uDC00-\uDFFF])\s*([a-zA-Z0-9_]+)/gu;
  let match;
  const secciones = [];
  console.log('🔍 [MARCADORES] Analizando respuesta para marcadores:', respuesta);

  while ((match = regex.exec(respuesta)) !== null) {
    const claveRaw = match[1].trim();
    const claveNorm = normalizarClave(claveRaw);
    console.log('🟢 [MARCADORES] Marcador VÁLIDO detectado:', claveRaw, '-> Normalizado:', claveNorm);
    secciones.push(claveNorm);
  }

  if (!secciones.length) {
    console.log('🟡 [MARCADORES] No se encontraron marcadores válidos en la respuesta.');
    return null;
  }

  console.log('✅ [MARCADORES] Secciones solicitadas VÁLIDAS:', secciones);
  return secciones;
}

export async function cicloMarcadoresIA(res, txt, state, ctx, { flowDynamic, endFlow, gotoFlow, provider }) {
  let respuesta = res.respuesta || '';
  console.log('🟢 [MARCADORES] Procesando respuesta IA:', respuesta);

  const marcadorRegex = /(?:[\p{Emoji}\u2600-\u27BF\uE000-\uF8FF\uD83C-\uDBFF\uDC00-\uDFFF])\s*([a-zA-Z0-9_]+)/gu;
  let match;
  let marcadorProcesado = false;

  while ((match = marcadorRegex.exec(respuesta)) !== null) {
    const claveRaw = match[1].trim();
    const claveNorm = normalizarClave(claveRaw);

    if (!claveNorm) {
      console.log('⚠️ [MARCADORES] Valor de marcador inválido:', match);
      continue;
    }
    marcadorProcesado = true;
    console.log(`🟢 [MARCADORES] Procesando marcador: ${claveRaw} -> ${claveNorm}`);

    if (claveNorm.startsWith('paso_') && /^\d+$/.test(claveNorm.replace('paso_', ''))) {
      const pasoNum = parseInt(claveNorm.replace('paso_', '')) - 1;
      await state.update({ pasoFlujoActual: pasoNum, seccionesActivas: [] });
      console.log(`🟢 [MARCADORES] Actualizado pasoFlujoActual a PASO ${pasoNum + 1} y limpiadas seccionesActivas`);
    } else {
      const nuevasSecciones = state.get('seccionesActivas') || [];
      if (!nuevasSecciones.includes(claveNorm)) {
        nuevasSecciones.push(claveNorm);
        await state.update({ seccionesActivas: nuevasSecciones });
        console.log(`🟢 [MARCADORES] Añadida sección activa: ${claveNorm}`);
      } else {
        console.log(`🟡 [MARCADORES] Sección ya activa, no se añade: ${claveNorm}`);
      }
    }
  }

  if (marcadorProcesado) {
    const respuestaLimpia = respuesta.replace(/([\p{Emoji}\u2600-\u27BF\uE000-\uF8FF\uD83C-\uDBFF\uDC00-\uDFFF])\s*[A-Za-z0-9_áéíóúñüÁÉÍÓÚÑÜ]+( [^.,;\n]*)?/gu, '').trim();
    console.log('🟢 [MARCADORES] Respuesta limpia tras procesar marcadores:', respuestaLimpia);
    return { respuesta: respuestaLimpia, tipo: res.tipo || 0 };
  }

  console.log('🟢 [MARCADORES] No se procesaron marcadores, devolviendo respuesta original');
  return res;
}
