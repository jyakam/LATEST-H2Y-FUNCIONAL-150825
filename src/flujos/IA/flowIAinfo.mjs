import 'dotenv/config'
import fs from 'fs'
import { addKeyword, EVENTS } from '@builderbot/bot'
import { ActualizarContacto } from '../../config/contactos.mjs'
import { BOT, ARCHIVO } from '../../config/bot.mjs'
import { ENUM_IA_RESPUESTAS } from '../../APIs/OpenAi/IAEnumRespuestas.mjs'
import { AgruparMensaje } from '../../funciones/agruparMensajes.mjs'
import { Escribiendo } from '../../funciones/proveedor.mjs'
import { Esperar } from '../../funciones/tiempo.mjs'
import { ENUNGUIONES } from '../../APIs/OpenAi/guiones.mjs'
import { ComprobrarListaNegra } from '../../config/listaNegra.mjs'
import { reset, idleFlow } from '../idle.mjs'
import { DetectarArchivos } from '../bloques/detectarArchivos.mjs'
import { EnviarImagenes } from '../bloques/enviarMedia.mjs'
import { EnviarIA } from '../bloques/enviarIA.mjs'
import { cargarProductosAlState } from '../../funciones/helpers/cacheProductos.mjs'
import { filtrarPorTextoLibre } from '../../funciones/helpers/filtrarPorTextoLibre.mjs'
import { generarContextoProductosIA } from '../../funciones/helpers/generarContextoProductosIA.mjs'
import { flowProductos } from '../flowProductos.mjs'
import { flowDetallesProducto } from '../flowDetallesProducto.mjs'
import { ActualizarFechasContacto, ActualizarResumenUltimaConversacion } from '../../funciones/helpers/contactosSheetHelper.mjs'
import { generarResumenConversacionIA } from '../../funciones/helpers/generarResumenConversacion.mjs'
import { esMensajeRelacionadoAProducto } from '../../funciones/helpers/detectorProductos.mjs'
import { obtenerIntencionConsulta } from '../../funciones/helpers/obtenerIntencionConsulta.mjs'
import { traducirTexto } from '../../funciones/helpers/traducirTexto.mjs'
import { enviarImagenProductoOpenAI } from '../../APIs/OpenAi/enviarImagenProductoOpenAI.mjs'
import { verificarYActualizarContactoSiEsNecesario, detectarIntencionContactoIA } from '../../funciones/helpers/contactosIAHelper.mjs'
import { actualizarHistorialConversacion } from '../../funciones/helpers/historialConversacion.mjs';
import { cicloMarcadoresIA } from '../../funciones/helpers/marcadoresIAHelper.mjs'

// === BLOQUES DE AYUDA PARA EL FLUJO Y PROMPT ===

function getPasoFlujoActual(state) {
  // Obtiene el paso actual del flujo, o 0 si no existe.
  return state.get('pasoFlujoActual') ?? 0;
}

// Normaliza claves para buscar secciones/pasos/categorías
function normalizarClave(txt = '') {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/[^a-z0-9_]/g, '_') // cualquier cosa que no sea letra/numero -> _
    .replace(/_+/g, '_')         // reemplaza multiples _ por uno solo
    .replace(/^_+|_+$/g, '');    // quita _ al inicio/final
}

function armarPromptOptimizado(state, bloques, opciones = {}) {
  // 1. Siempre incluir SECCIÓN 0 (intro, presentación, reglas básicas)
  const seccion0 = bloques['seccion_0_introduccion_general'] || '';

  // 2. Obtener sección activa (paso o secciones activas)
  const pasoFlujoActual = getPasoFlujoActual(state);
  const seccionesActivas = state.get('seccionesActivas') || [];
  const pasos = bloques.PASOS_FLUJO || [];

  // 3. Construir bloques a enviar
  let bloquesEnviados = [
    { nombre: 'SECCIÓN_0 (Introducción)', texto: seccion0 }
  ];

  // Priorizar secciones activas si existen
  if (seccionesActivas.length && normalizarClave(seccionesActivas[0]) !== normalizarClave('seccion_0_introduccion_general')) {
    seccionesActivas.forEach(sec => {
      const secNorm = normalizarClave(sec);
      if (bloques[secNorm]) {
        bloquesEnviados.push({ nombre: `SECCIÓN_ACTIVA (${secNorm})`, texto: bloques[secNorm] });
      } else {
        console.log('⚠️ [FLOW] Sección activa no encontrada en bloques:', sec, '-> Normalizado:', secNorm);
      }
    });
  } else if (pasos[pasoFlujoActual]) {
    // Usar el paso actual si no hay secciones activas
    bloquesEnviados.push({ nombre: `PASO_FLUJO_${pasoFlujoActual + 1}`, texto: pasos[pasoFlujoActual] });
  } else {
    // Fallback a PASO 1 solo si no hay nada definido
    bloquesEnviados.push({ nombre: 'PASO_FLUJO_1', texto: pasos[0] || '' });
  }

  // 4. Incluir productos o testimonios si se solicitan
  let textoProductos = '';
  let categoriaLog = '';
  if (opciones.incluirProductos && opciones.categoriaProductos) {
    const cat = normalizarClave(opciones.categoriaProductos);
    categoriaLog = cat;
    textoProductos = bloques.CATEGORIAS_PRODUCTOS?.[cat] || '';
    if (textoProductos) {
      bloquesEnviados.push({ nombre: `CATEGORÍA_PRODUCTOS (${categoriaLog})`, texto: textoProductos });
    }
  }
  let textoTestimonios = '';
  if (opciones.incluirTestimonios) {
    textoTestimonios = bloques['seccion_4_testimonio_de_clientes_y_preguntas_frecuentes'] || '';
    if (textoTestimonios) {
      bloquesEnviados.push({ nombre: 'SECCIÓN_4 (Testimonios y FAQ)', texto: textoTestimonios });
    }
  }

  // 5. LOG detallado para saber qué secciones/pasos van a la IA
  console.log('🚦 [PROMPT DEBUG] SE ENVÍA A LA IA:');
  bloquesEnviados.forEach(b => {
    console.log(`   • ${b.nombre} (${b.texto.length} caracteres)`);
  });

  // 6. Retorna el prompt unificado para la IA
  return bloquesEnviados.map(b => b.texto).filter(Boolean).join('\n\n');
}

// IMPORTANTE: Cache de contactos (nuevo sistema)
import { getContactoByTelefono, getCacheContactos, actualizarContactoEnCache } from '../../funciones/helpers/cacheContactos.mjs'

export function extraerNombreProductoDeVision(texto) {
  const match = texto.match(/["“](.*?)["”]/)
  if (match && match[1]) return match[1]
  return texto
}

export const flowIAinfo = addKeyword(EVENTS.WELCOME)
  .addAction(async (ctx, tools) => {
    const { flowDynamic, endFlow, gotoFlow, provider, state } = tools;
    const phone = ctx.from.split('@')[0];
    const message = ctx.body.trim();

    // ==== INICIALIZA SOLO EN EL PRIMER MENSAJE ====
    // Si no hay pasoFlujoActual o seccionesActivas, inicializa en PASO 1
    if (!state.get('pasoFlujoActual') && !state.get('seccionesActivas')) {
      await state.update({ 
        pasoFlujoActual: 0,     // PASO 1 del flujo
        seccionesActivas: []    // No hay secciones activas al arrancar
      });
      console.log('🟢 [IAINFO] Estado inicializado: PASO 1, seccionesActivas vacías');
    } else {
      console.log('🟢 [IAINFO] Estado existente: PASO', state.get('pasoFlujoActual') + 1, ', seccionesActivas:', state.get('seccionesActivas') || []);
    }

    console.log('📩 [IAINFO] Mensaje recibido de:', phone)
    console.log(`🔍 [IAINFO] Estado inicial de la caché: ${getCacheContactos().length} contactos`)
  
    // --- [LOGS para depuración] ---
console.log('🟡 [DEBUG] Claves disponibles en bloques:', Object.keys(ARCHIVO.PROMPT_BLOQUES));
    
    // Construye el promptSistema para la IA usando los bloques de la BC (sección 1 y 2)
const bloques = ARCHIVO.PROMPT_BLOQUES;
    // DEBUG: Muestra cuántos pasos detectó en la sección de flujo
console.log('🟠 [DEBUG] PASOS_FLUJO:', (bloques.PASOS_FLUJO || []).map(paso => paso.substring(0, 100) + '...'));

// --- Detecta intención de productos y testimonios (ajusta según tus helpers) ---
const { esConsultaProductos, categoriaDetectada, esConsultaTestimonios } =
  await obtenerIntencionConsulta(message, '', state);

// --- Construye el prompt optimizado ---
const promptSistema = armarPromptOptimizado(state, bloques, {
  incluirProductos: esConsultaProductos,
  categoriaProductos: categoriaDetectada,
  incluirTestimonios: esConsultaTestimonios
});
console.log('🟢 [FLOW] Secciones activas en el state:', state.get('seccionesActivas') || []);
    
    // ------ BLOQUE DE CONTACTOS: SIEMPRE SE EJECUTA ------
    let contacto = getContactoByTelefono(phone)
    if (!contacto) {
      console.log(`🔄 [IAINFO] Contacto no encontrado, intentando recargar caché`)
      await cargarContactosDesdeAppSheet()
      contacto = getContactoByTelefono(phone)
      console.log('🔍 [DEBUG] Contacto después de recargar caché:', contacto)
      console.log(`🔍 [IAINFO] Contacto tras recargar caché:`, contacto)
    }

    if (!contacto) {
      console.log(`🆕 [IAINFO] Creando contacto nuevo para: ${phone}`)
      try {
        await ActualizarContacto(phone, { NOMBRE: 'Sin Nombre', RESP_BOT: 'Sí', ETIQUETA: 'Nuevo' })
        contacto = getContactoByTelefono(phone)
        console.log(`🔍 [IAINFO] Contacto tras ActualizarContacto:`, contacto)
        if (!contacto) {
          console.warn(`⚠️ [IAINFO] Contacto ${phone} no encontrado, creando localmente`)
          const contactoLocal = {
            TELEFONO: phone,
            NOMBRE: 'Sin Nombre',
            RESP_BOT: 'Sí',
            ETIQUETA: 'Nuevo',
            FECHA_PRIMER_CONTACTO: new Date().toLocaleDateString('es-CO'),
            FECHA_ULTIMO_CONTACTO: new Date().toLocaleDateString('es-CO')
          }
          actualizarContactoEnCache(contactoLocal)
          contacto = getContactoByTelefono(phone)
          console.log(`🔍 [IAINFO] Contacto tras creación local:`, contacto)
        }
        if (!contacto) {
          console.error(`❌ [IAINFO] Contacto ${phone} no creado, usando fallback`)
          contacto = {
            TELEFONO: phone,
            NOMBRE: 'Sin Nombre',
            RESP_BOT: 'Sí',
            ETIQUETA: 'Nuevo'
          }
        }
        console.log('👤 [IAINFO] Contacto nuevo registrado:', phone)
      } catch (error) {
        console.error(`❌ [IAINFO] Error al crear contacto ${phone}:`, error.message, error.stack)
        contacto = {
          TELEFONO: phone,
          NOMBRE: 'Sin Nombre',
          RESP_BOT: 'Sí',
          ETIQUETA: 'Nuevo'
        }
        console.log(`⚠️ [IAINFO] Usando contacto local para ${phone}`)
      }
    }

    if (contacto) await ActualizarFechasContacto(contacto, phone)

    // ------ BLOQUE DE IA PARA DATOS DE CONTACTO: SIEMPRE SE EJECUTA ------
       const datos = {}
    if (/me llamo|mi nombre es/i.test(message)) {
      const nombre = message.split(/me llamo|mi nombre es/i)[1]?.trim()
      if (nombre && !/\d/.test(nombre)) datos.NOMBRE = nombre
    }
    const email = message.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
    if (email) datos.EMAIL = email[0]

    // IA para detectar y actualizar contacto completo
    const { detectarIntencionContactoIA, verificarYActualizarContactoSiEsNecesario } = await import('../../funciones/helpers/contactosIAHelper.mjs')
    const esDatosContacto = await detectarIntencionContactoIA(message)
    if (esDatosContacto) {
      console.log("🛡️ [FLOWIAINFO][WELCOME] Se va a actualizar contacto. Contacto en cache:", contacto)
      await verificarYActualizarContactoSiEsNecesario(message, phone, contacto, datos)
    }

    // ------ CHEQUEO DEL FLAG DE PRODUCTOS ------
    if (!BOT.PRODUCTOS) {
      console.log('🛑 [IAINFO] Flag PRODUCTOS está en FALSE, saltando lógica de productos.')
      // Aquí la IA responde SIN lógica de productos pero contactos sí funcionan
      const res = await EnviarIA(ctx.body, promptSistema, {
        ctx, flowDynamic, endFlow, gotoFlow, provider, state, promptExtra: ''
      }, { esClienteNuevo: !contacto || contacto.NOMBRE === 'Sin Nombre', contacto: contacto || {} })
      await Responder(res, ctx, flowDynamic, state)
      return
    }

    // ------ LÓGICA DE PRODUCTOS (SOLO SI EL FLAG ESTÁ EN TRUE) ------
    if (!state.get('_productosFull')?.length) {
      await cargarProductosAlState(state)
      await state.update({ __productosCargados: true })
      console.log('📦 [IAINFO] Productos cargados en cache para:', phone)
    }

    await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' })

    const detectar = await DetectarArchivos(ctx, state)

    if (state.get('tipoMensaje') === 1) {
      const imagenes = state.get('archivos')?.filter(item => item.tipo === 1)
      let resultado = ''
      if (imagenes?.length > 0) {
        const fileBuffer = fs.readFileSync(imagenes[0].ruta)
        resultado = await enviarImagenProductoOpenAI(fileBuffer)
        resultado = extraerNombreProductoDeVision(resultado)
      }
      if (resultado && resultado !== '' && resultado !== 'No es un producto') {
        await state.update({
          productoDetectadoEnImagen: true,
          productoReconocidoPorIA: resultado
        })
        console.log(`🖼️ [IAINFO] Producto detectado en imagen: ${resultado}`)
      }
    }

    AgruparMensaje(detectar, async (txt) => {
      // Guardar mensaje del cliente en el historial
      actualizarHistorialConversacion(txt, 'cliente', state);
      Escribiendo(ctx)
      console.log('🧾 [IAINFO] Texto agrupado final del usuario:', txt)

      const productos = await obtenerProductosCorrectos(txt, state)
      const promptExtra = productos.length ? generarContextoProductosIA(productos, state) : ''

      if (productos.length) {
        await state.update({ productosUltimaSugerencia: productos })
        console.log(`📦 [IAINFO] ${productos.length} productos encontrados y asociados al mensaje.`)
      }

      const estado = {
        esClienteNuevo: !contacto || contacto.NOMBRE === 'Sin Nombre',
        contacto: contacto || {}
      }

      // console.log('=== [PROMPT SISTEMA REAL] ===\n', promptSistema);  // <--- AHORA NO SE VE EN EL LOG

const res = await EnviarIA(txt, promptSistema, {
  ctx, flowDynamic, endFlow, gotoFlow, provider, state, promptExtra
}, estado)

      console.log('📥 [IAINFO] Respuesta completa recibida de IA:', res?.respuesta)

      await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, txt)

      await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' })
    })
  })

  .addAction({ capture: true }, async (ctx, tools) => {
    const { flowDynamic, endFlow, gotoFlow, provider, state } = tools;
    const phone = ctx.from.split('@')[0];
    const message = ctx.body.trim();

    // ==== NO REINICIAR EL STATE EN MENSAJES POSTERIORES ====
    // Mantener pasoFlujoActual y seccionesActivas existentes
    console.log('🟢 [IAINFO] Estado actual: PASO', state.get('pasoFlujoActual') + 1, ', seccionesActivas:', state.get('seccionesActivas') || []);

  let contacto = getContactoByTelefono(phone)
  const datos = {}

    // --- [LOGS para depuración] ---
console.log('🟡 [DEBUG] Claves disponibles en bloques:', Object.keys(ARCHIVO.PROMPT_BLOQUES));

// Construye el promptSistema para la IA usando los bloques de la BC (sección 1 y 2)
const bloques = ARCHIVO.PROMPT_BLOQUES;

// DEBUG: Muestra cuántos pasos detectó en la sección de flujo
console.log('🟠 [DEBUG] PASOS_FLUJO:', (bloques.PASOS_FLUJO || []).map(paso => paso.substring(0, 100) + '...'));
    
// --- Detecta intención de productos y testimonios (ajusta según tus helpers) ---
const { esConsultaProductos, categoriaDetectada, esConsultaTestimonios } =
  await obtenerIntencionConsulta(message, '', state);

// --- Construye el prompt optimizado ---
const promptSistema = armarPromptOptimizado(state, bloques, {
  incluirProductos: esConsultaProductos,
  categoriaProductos: categoriaDetectada,
  incluirTestimonios: esConsultaTestimonios
});
console.log('🟢 [FLOW] Secciones activas en el state:', state.get('seccionesActivas') || []);
    
  await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' })

  // Detecta y guarda nombre/email si está presente literal
  if (/me llamo|mi nombre es/i.test(message)) {
    const nombre = message.split(/me llamo|mi nombre es/i)[1]?.trim()
    if (nombre && !/\d/.test(nombre)) datos.NOMBRE = nombre
  }
  const email = message.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
  if (email) datos.EMAIL = email[0]

  // ------ SIEMPRE intentar actualización completa de contacto por IA ------
  const { detectarIntencionContactoIA, verificarYActualizarContactoSiEsNecesario } = await import('../../funciones/helpers/contactosIAHelper.mjs')
  const esDatosContacto = await detectarIntencionContactoIA(message)
  if (esDatosContacto) {
    console.log("🛡️ [FLOWIAINFO][capture] Se va a actualizar contacto. Contacto en cache:", contacto)
    await verificarYActualizarContactoSiEsNecesario(message, phone, contacto, datos)
    contacto = getContactoByTelefono(phone)
  }

  // Actualiza fechas de contacto SIEMPRE
  if (contacto) await ActualizarFechasContacto(contacto, phone)

  // ------ CHEQUEO DEL FLAG DE PRODUCTOS ------
  if (!BOT.PRODUCTOS) {
    console.log('🛑 [IAINFO][capture] Flag PRODUCTOS está en FALSE, saltando lógica de productos.')
    const res = await EnviarIA(message, promptSistema, {
      ctx, flowDynamic, endFlow, gotoFlow, provider, state, promptExtra: ''
    }, { esClienteNuevo: !contacto || contacto.NOMBRE === 'Sin Nombre', contacto: contacto || {} })
    await Responder(res, ctx, flowDynamic, state)
    return tools.fallBack()
  }

  // ------ DESDE AQUÍ SOLO CORRE SI HAY PRODUCTOS ACTIVOS ------
  if (!state.get('_productosFull')?.length) {
    await cargarProductosAlState(state)
    await state.update({ __productosCargados: true })
  }

  const detectar = await DetectarArchivos(ctx, state)

  if (state.get('tipoMensaje') === 1) {
    const imagenes = state.get('archivos')?.filter(item => item.tipo === 1)
    let resultado = ''
    if (imagenes?.length > 0) {
      const fileBuffer = fs.readFileSync(imagenes[0].ruta)
      resultado = await enviarImagenProductoOpenAI(fileBuffer)
      resultado = extraerNombreProductoDeVision(resultado)
    }
    if (resultado && resultado !== '' && resultado !== 'No es un producto') {
      await state.update({
        productoDetectadoEnImagen: true,
        productoReconocidoPorIA: resultado
      })
      console.log(`🖼️ [IAINFO] Producto detectado en imagen: ${resultado}`)
    }
  }

  AgruparMensaje(detectar, async (txt) => {
    // Guardar mensaje del cliente en el historial
    actualizarHistorialConversacion(txt, 'cliente', state);
    if (ComprobrarListaNegra(ctx) || !BOT.ESTADO) return gotoFlow(idleFlow)
    reset(ctx, gotoFlow, BOT.IDLE_TIME * 60)
    Escribiendo(ctx)

    console.log('✏️ [IAINFO] Mensaje capturado en continuación de conversación:', txt)

    const productos = await obtenerProductosCorrectos(txt, state)
    const promptExtra = productos.length ? generarContextoProductosIA(productos, state) : ''

    if (productos.length) {
      await state.update({ productosUltimaSugerencia: productos })
    }

    // ------ SIEMPRE chequear si hay nuevos datos de contacto ------
    const { detectarIntencionContactoIA, verificarYActualizarContactoSiEsNecesario } = await import('../../funciones/helpers/contactosIAHelper.mjs')
    const esDatosContacto = await detectarIntencionContactoIA(txt)
    if (esDatosContacto) {
      console.log("🛡️ [FLOWIAINFO][capture][AgruparMensaje] Se va a actualizar contacto. Contacto en cache:", contacto)
      await verificarYActualizarContactoSiEsNecesario(txt, phone, contacto, datos)
      contacto = getContactoByTelefono(phone)
    }

    const estado = {
      esClienteNuevo: !contacto || contacto.NOMBRE === 'Sin Nombre',
      contacto: contacto || {}
    }

    // console.log('=== [PROMPT SISTEMA REAL] ===\n', promptSistema);  // <--- AHORA NO SE VE EN EL LOG
const res = await EnviarIA(txt, promptSistema, {
  ctx, flowDynamic, endFlow, gotoFlow, provider, state, promptExtra
}, estado)

    await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, txt)
    await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' })
  })

  return tools.fallBack()
})

// ✅ REEMPLAZA TODO TU BLOQUE manejarRespuestaIA POR ESTA VERSIÓN
async function manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, txt) {
  let respuestaActual = res;
  let intentos = 0;
  const maxIntentos = 2; // Solo permitimos 1 reconsulta máxima para evitar loops.

  console.log('🔄 [MANEJAR_IA] Iniciando ciclo de procesamiento de respuesta...');

  // Guarda el paso y secciones activas antes de procesar marcadores
  let anteriorPaso = state.get('pasoFlujoActual');
  let anterioresSecciones = JSON.stringify(state.get('seccionesActivas') || []);

  while (intentos < maxIntentos) {
    // 1. Procesamos marcadores: actualiza el STATE y nos da la respuesta LIMPIA.
    respuestaActual = await cicloMarcadoresIA(respuestaActual, txt, state, ctx, { flowDynamic, endFlow, gotoFlow, provider: ctx.provider, state });
    const textoRespuestaLimpia = (respuestaActual.respuesta || '').trim();

    // Detecta si hubo cambio de paso o de secciones activas tras procesar marcadores
    let nuevoPaso = state.get('pasoFlujoActual');
    let nuevasSecciones = JSON.stringify(state.get('seccionesActivas') || []);
    let huboCambioDePaso = (anteriorPaso !== nuevoPaso);
    let huboCambioDeSeccion = (anterioresSecciones !== nuevasSecciones);

    if (huboCambioDePaso || huboCambioDeSeccion) {
      // Actualizamos los snapshots para evitar dobles saltos en bucle
      anteriorPaso = nuevoPaso;
      anterioresSecciones = nuevasSecciones;

      // Reconstruimos el prompt con el contexto actualizado
      const bloques = ARCHIVO.PROMPT_BLOQUES;
      const promptSistema = armarPromptOptimizado(state, bloques);
      const contactoCache = getContactoByTelefono(ctx.from);
      const estado = {
        esClienteNuevo: !contactoCache || contactoCache.NOMBRE === 'Sin Nombre',
        contacto: contactoCache || {}
      };

      // Hacemos SOLO UNA reconsulta a la IA, pero ya en el paso correcto.
      respuestaActual = await EnviarIA(txt, promptSistema, {
        ctx, flowDynamic, endFlow, gotoFlow, provider: ctx.provider, state, promptExtra: ''
      }, estado);

      // Procesamos marcadores de la segunda respuesta, por si hay doble salto (muy raro, pero seguro).
      respuestaActual = await cicloMarcadoresIA(respuestaActual, txt, state, ctx, { flowDynamic, endFlow, gotoFlow, provider: ctx.provider, state });

      intentos++;
      continue; // Solo permitimos una reconsulta máxima
    }

    // Si la respuesta está vacía (solo venía marcador), respondemos DIRECTO con el contenido del paso/sección activa.
    if (!textoRespuestaLimpia) {
      const bloques = ARCHIVO.PROMPT_BLOQUES;
      const seccionesActivas = state.get('seccionesActivas') || [];
      let respuestaFinal = '';

      if (seccionesActivas.length) {
        seccionesActivas.forEach(sec => {
          const secNorm = normalizarClave(sec);
          if (bloques[secNorm]) {
            respuestaFinal += (bloques[secNorm] + '\n\n');
          }
        });
      }
      if (!respuestaFinal) {
        const pasoActual = (state.get('pasoFlujoActual') ?? 0) + 1;
        const pasoKey = `paso_${pasoActual}`;
        if (bloques[pasoKey]) {
          respuestaFinal = bloques[pasoKey];
        }
      }
      if (!respuestaFinal) {
        respuestaFinal = 'No se encontró información específica para tu solicitud. ¿Puedes aclararme lo que necesitas?';
      }
      await Responder({ respuesta: respuestaFinal, tipo: ENUM_IA_RESPUESTAS.TEXTO }, ctx, flowDynamic, state);
      return;
    }

    // Si llegamos aquí, tenemos una respuesta real para el usuario.
    console.log('✅ [MANEJAR_IA] Respuesta final obtenida:', textoRespuestaLimpia);
    break;
  }

  if (intentos >= maxIntentos) {
    console.error('❌ [ERROR] Se alcanzó el número máximo de re-consultas a la IA. El bot podría estar en un bucle. Finalizando flujo.');
    await flowDynamic('Lo siento, parece que he tenido un problema procesando tu solicitud. Por favor, intenta de nuevo en un momento.');
    return;
  }

  // Procesamos acciones especiales (mostrar productos, detalles, ayuda, etc.)
  const respuestaIA = respuestaActual.respuesta?.toLowerCase?.() || '';
  console.log('🧠 [MANEJAR_IA] Analizando tokens de acción en respuesta final...');

  if (respuestaIA.includes('🧩mostrarproductos')) {
    console.log('➡️ [ACCIÓN] Detectado token para mostrar productos.');
    await state.update({ ultimaConsulta: txt });
    return gotoFlow(flowProductos);
  }
  if (respuestaIA.includes('🧩mostrardetalles')) {
    console.log('➡️ [ACCIÓN] Detectado token para mostrar detalles.');
    return gotoFlow(flowDetallesProducto);
  }
  if (respuestaIA.includes('🧩solicitarayuda')) {
    console.log('➡️ [ACCIÓN] Detectado token para solicitar ayuda.');
    return gotoFlow(flowProductos); 
  }

  // Enviamos la respuesta final al usuario
  await Responder(respuestaActual, ctx, flowDynamic, state);

  // Si la IA pide avanzar de paso con ⏭️siguiente paso, avanzamos en el flujo principal
  if (respuestaActual.respuesta?.includes('⏭️siguiente paso')) {
    let pasoActual = state.get('pasoFlujoActual') ?? 0;
    await state.update({ pasoFlujoActual: pasoActual + 1, seccionesActivas: [] }); // Limpiamos secciones al avanzar de paso
    console.log('➡️ [FLUJO] Avanzando al siguiente paso del flujo:', pasoActual + 2);
  }
}

async function Responder(res, ctx, flowDynamic, state) {
  if (res.tipo === ENUM_IA_RESPUESTAS.TEXTO && res.respuesta) {
    await Esperar(BOT.DELAY);

    const yaRespondido = state.get('ultimaRespuestaSimple') || '';
    let nuevaRespuesta = res.respuesta.trim();

    // 🔴🔴🔴 LIMPIEZA DE MARCADORES INTERNOS (emoji + clave + texto extra) 🔴🔴🔴
nuevaRespuesta = nuevaRespuesta.replace(/🧩[A-Za-z0-9_]+🧩|\[.*?: [^\]]+\]/gi, '').trim();

    // Opcional: Log para ver si hubo marcadores eliminados
    if (nuevaRespuesta !== res.respuesta.trim()) {
      console.log('⚠️ [FILTRO] Se eliminó un marcador interno de la respuesta IA.');
    }

    // (Convierte a minúsculas para el control de respuestas repetidas)
    const nuevaRespuestaComparar = nuevaRespuesta.toLowerCase();

    if (nuevaRespuestaComparar && nuevaRespuestaComparar === yaRespondido) {
      console.log('⚡ Respuesta ya fue enviada antes, evitando repetición.');
      return;
    }

    await state.update({ ultimaRespuestaSimple: nuevaRespuestaComparar });

    const msj = await EnviarImagenes(nuevaRespuesta, flowDynamic, ctx);  // Usamos la respuesta LIMPIA
    const startTime = Date.now();
    console.log('⏱️ [DEBUG] Inicio de envío de mensaje a', ctx.from.split('@')[0]);
    await flowDynamic(msj);

    // Guardar mensaje del bot en el historial
    actualizarHistorialConversacion(nuevaRespuesta, 'bot', state);

    console.log('⏱️ [DEBUG] Fin de envío de mensaje a', ctx.from.split('@')[0], 'Tiempo:', Date.now() - startTime, 'ms');
    // Solo UNA llamada a flowDynamic, problema resuelto.
    return;
  }
}

async function obtenerProductosCorrectos(texto, state) {
  const sugeridos = state.get('productosUltimaSugerencia') || []
  console.log('🧪 [flowIAinfo] Texto recibido para búsqueda:', texto)

  if (state.get('productoDetectadoEnImagen') && state.get('productoReconocidoPorIA')) {
    const productosFull = state.get('_productosFull') || []
    let productos = filtrarPorTextoLibre(productosFull, state.get('productoReconocidoPorIA'))

    const mejorScore = productos.length ? Math.max(...productos.map(p => p.score || 0)) : 0

    if (mejorScore < 25 && productos.length) {
      console.log(`🔎 [IAINFO] Mejor score encontrado: ${mejorScore}. Se probarán equivalencias IA en los top 15 productos.`)
      const topProductos = productos
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 15)

      for (const producto of topProductos) {
        const esSimilar = await esProductoSimilarPorIA(producto.NOMBRE, state.get('productoReconocidoPorIA'))
        if (esSimilar) {
          productos = [producto]
          console.log(`✅ [IAINFO] Equivalencia IA encontrada: ${producto.NOMBRE}`)
          break
        }
      }
    }

    console.log(`🔍 [IAINFO] Buscando producto por imagen detectada: ${state.get('productoReconocidoPorIA')}`)

    if (!productos.length || !encontroProductoExacto(productos, state.get('productoReconocidoPorIA'))) {
      console.log('🔎 [IAINFO] No se encontró producto exacto, intentando traducción...')
      const traduccion = await traducirTexto(state.get('productoReconocidoPorIA'))
      productos = filtrarPorTextoLibre(productosFull, traduccion)
      console.log(`🔎 [IAINFO] Resultado después de traducción: ${productos.length} productos encontrados.`)
    }

    return productos
  }

  if (await esAclaracionSobreUltimaSugerencia(texto, state) && sugeridos.length) {
    console.log('🔍 [IAINFO] Aclaración sobre producto sugerido anteriormente.')
    return filtrarPorTextoLibre(sugeridos, texto)
  }

  if (await esMensajeRelacionadoAProducto(texto, state)) {
    console.log('🔍 [IAINFO] Producto detectado con contexto dinámico.')
    const productosFull = state.get('_productosFull') || []
    return filtrarPorTextoLibre(productosFull, texto)
  }

  const { esConsultaProductos } = await obtenerIntencionConsulta(texto, state.get('ultimaConsulta') || '', state)
  if (esConsultaProductos) {
    console.log('🔍 [IAINFO] Intención de producto detectada vía OpenAI.')
    const productosFull = state.get('_productosFull') || []
    return filtrarPorTextoLibre(productosFull, texto)
  }

  console.log('🚫 [IAINFO] No se detectó relación con productos.')
  return []
}

import { EnviarTextoOpenAI } from '../../APIs/OpenAi/enviarTextoOpenAI.mjs'

async function esAclaracionSobreUltimaSugerencia(texto = '', state) {
  const ultimaSugerencia = state.get('productosUltimaSugerencia') || []

  if (!ultimaSugerencia.length) return false

  const nombresProductos = ultimaSugerencia.map(p => p.NOMBRE).slice(0, 3).join('\n')

  const prompt = `
Eres un asistente conversacional de ventas para una tienda online. 
Tu tarea es únicamente responder si la siguiente consulta del cliente es una continuación o aclaración relacionada a los siguientes productos que se le ofrecieron anteriormente.

Productos sugeridos anteriormente:
${nombresProductos}

Mensaje actual del cliente:
"${texto}"

Responde solamente este JSON:
{
  "esAclaracion": true o false
}
  `.trim()

  try {
    const respuesta = await EnviarTextoOpenAI(prompt, 'aclaracion', 'INFO', {})
    const parsed = JSON.parse(respuesta.respuesta || '{}')
    return parsed.esAclaracion || false
  } catch (e) {
    console.log('❌ [IAINFO] Error detectando aclaración:', e)
    return false
  }
}

async function esProductoSimilarPorIA(nombreProducto, textoConsulta) {
  const prompt = `
Eres un asistente experto en e-commerce. 
Tu tarea es determinar si las dos frases siguientes hacen referencia al mismo producto, teniendo en cuenta posibles errores de ortografía, sinónimos, traducciones o abreviaciones.

Frase 1 (producto del catálogo):
"${nombreProducto}"

Frase 2 (consulta del cliente):
"${textoConsulta}"

Responde solamente este JSON:
{
  "esSimilar": true o false
}
  `.trim()

  try {
    const respuesta = await EnviarTextoOpenAI(prompt, 'similaridad', 'INFO', {})
    const parsed = JSON.parse(respuesta.respuesta || '{}')
    return parsed.esSimilar || false
  } catch (e) {
    console.log('❌ [IAINFO] Error verificando equivalencia de producto:', e)
    return false
  }
}

function encontroProductoExacto(productos, nombreBuscado) {
  const nombreLimpio = nombreBuscado.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/)
  return productos.some(p => {
    const productoLimpio = p.NOMBRE.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/)
    const coincidencias = nombreLimpio.filter(palabra => productoLimpio.includes(palabra)).length
    const porcentaje = coincidencias / nombreLimpio.length
    return porcentaje >= 0.7
  })
}

