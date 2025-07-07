import { ARCHIVO } from '../../config/bot.mjs'
import { EnviarIA } from '../../flujos/bloques/enviarIA.mjs'

// Utilidad para normalizar nombres: minúsculas, sin tildes, sin espacios extras, solo letras/números/guiones_bajos
function normalizarClave(txt = '') {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/[^a-z0-9_]/g, '_') // cualquier cosa que no sea letra/numero -> _
    .replace(/_+/g, '_')         // reemplaza multiples _ por uno solo
    .replace(/^_+|_+$/g, '');    // quita _ al inicio/final
}

// ✅ NUEVA VERSIÓN - REEMPLAZAR LA FUNCIÓN ANTIGUA
export function detectarSeccionesSolicitadas(respuesta) {
  // Regex corregida: busca un emoji, pero SOLO captura la palabra clave alfanumérica (con guiones bajos) que le sigue.
  // Ejemplo: "Hola 🧩seccion_3 texto" -> captura "seccion_3"
  // No capturará palabras sueltas.
  const regex = /(?:[\p{Emoji}\u2600-\u27BF\uE000-\uF8FF\uD83C-\uDBFF\uDC00-\uDFFF])\s*([a-zA-Z0-9_]+)/gu;
  let match;
  const secciones = [];
  console.log('🔍 [MARCADORES] Analizando respuesta para marcadores:', respuesta);

  while ((match = regex.exec(respuesta)) !== null) {
    // La clave capturada está en match[1]
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

// Función principal para el ciclo de marcadores
export async function cicloMarcadoresIA(res, txt, state, ctx, { flowDynamic, endFlow, gotoFlow, provider }) {
  let respuesta = res.respuesta || '';
  console.log('🟢 [MARCADORES] Procesando respuesta IA:', respuesta);

  // Regex flexible: cualquier emoji + palabra, ignora mayúsculas, tildes, etc.
  const marcadorRegex = /([\p{Emoji}\u2600-\u27BF\uE000-\uF8FF\uD83C-\uDBFF\uDC00-\uDFFF])\s*([A-Za-z0-9_áéíóúñüÁÉÍÓÚÑÜ]+)/gu;
  let match;
  let marcadorProcesado = false;

  // Procesa todos los marcadores encontrados
  while ((match = marcadorRegex.exec(respuesta)) !== null) {
    const claveRaw = match[2].trim();
    const claveNorm = normalizarClave(claveRaw);

    if (!claveNorm) {
      console.log('⚠️ [MARCADORES] Valor de marcador inválido:', match);
      continue;
    }
    marcadorProcesado = true;
    console.log(`🟢 [MARCADORES] Procesando marcador: ${claveRaw} -> ${claveNorm}`);

    // Si es un PASO_N (ej: PASO_2) también normaliza
    if (claveNorm.startsWith('paso_') && /^\d+$/.test(claveNorm.replace('paso_', ''))) {
      const pasoNum = parseInt(claveNorm.replace('paso_', '')) - 1;
      await state.update({ pasoFlujoActual: pasoNum, seccionesActivas: [] });
      console.log(`🟢 [MARCADORES] Actualizado pasoFlujoActual a PASO ${pasoNum + 1} y limpiadas seccionesActivas`);
    } else {
      // Agrega la sección activa si no existe
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

  // Limpia la respuesta de TODOS los marcadores (emoji + clave + opcional texto extra)
  if (marcadorProcesado) {
    const respuestaLimpia = respuesta.replace(/([\p{Emoji}\u2600-\u27BF\uE000-\uF8FF\uD83C-\uDBFF\uDC00-\uDFFF])\s*[A-Za-z0-9_áéíóúñüÁÉÍÓÚÑÜ]+( [^.,;\n]*)?/gu, '').trim();
    console.log('🟢 [MARCADORES] Respuesta limpia tras procesar marcadores:', respuestaLimpia);
    return { respuesta: respuestaLimpia, tipo: res.tipo || 0 };
  }

  console.log('🟢 [MARCADORES] No se procesaron marcadores, devolviendo respuesta original');
  return res;
}
