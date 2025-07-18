// flowIAinfo.mjs - VERSIÓN CORREGIDA PARA PROCESAR AUDIOS
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

// --- VERSIÓN FINAL Y DEFINITIVA CON ANÁLISIS DE HISTORIAL ---
/**
 * Detecta la señal 🧩AGREGAR_CARRITO🧩. Si la encuentra, analiza el historial
 * reciente de la conversación para extraer los detalles del producto y los añade al estado.
 * @param {string} respuestaIA - La respuesta completa de la IA.
 * @param {object} state - El estado actual del bot.
 * @param {object} tools - El conjunto de herramientas del bot (ctx, flowDynamic, etc.).
 */
async function agregarProductoAlCarrito(respuestaIA, state, tools) {
    if (!respuestaIA || !respuestaIA.includes('🧩AGREGAR_CARRITO🧩')) {
        return; 
    }

    console.log('🛒 [CARRITO] Señal 🧩AGREGAR_CARRITO🧩 detectada. Analizando historial...');

    // CORRECCIÓN CLAVE: Obtenemos el historial de la conversación desde el state
    const historial = state.get('historialMensajes') || [];
    
    // Tomamos los últimos 4 mensajes (2 del bot, 2 del cliente) para tener el contexto completo de la oferta y aceptación
    const contextoReciente = historial.slice(-4).map(msg => `${msg.rol}: ${msg.texto}`).join('\n');

    if (contextoReciente.length === 0) {
        console.error('❌ [CARRITO] No se encontró historial para analizar.');
        return;
    }

    const promptExtractor = `
      Eres un sistema experto en extracción de datos. Analiza el siguiente fragmento de una conversación de WhatsApp y extrae la información del ÚLTIMO producto que el cliente confirmó comprar.

      REGLAS CRÍTICAS:
      - "sku": EXTRAE el código SKU del producto que el cliente aceptó. Si no se menciona, usa "N/A".
      - "nombre": EXTRAE el nombre completo del producto que el cliente aceptó.
      - "cantidad": EXTRAE la cantidad. Si no se especifica, asume 1. Debe ser un NÚMERO.
      - "precio": EXTRAE el precio unitario final. Debe ser un NÚMERO, sin símbolos ni separadores.
      - "categoria": EXTRAE la categoría del producto. Si no se menciona, infiérela.

      Devuelve ÚNICAMENTE el objeto JSON válido.

      Fragmento de Conversación a analizar:
      ---
      ${contextoReciente}
      ---
    `;
    
    const resultadoExtraccion = await EnviarIA(promptExtractor, '', tools, {}); 
    
    try {
        const jsonLimpio = resultadoExtraccion.respuesta.replace(/```json\n|```/g, '').trim();
        const productoJSON = JSON.parse(jsonLimpio);

        if (productoJSON.nombre && productoJSON.cantidad && productoJSON.precio && productoJSON.sku && productoJSON.categoria) {
            const carrito = state.get('carrito') || [];
            
            const nuevoProductoEnCarrito = {
                sku: productoJSON.sku,
                nombre: productoJSON.nombre,
                cantidad: productoJSON.cantidad,
                precio: productoJSON.precio,
                categoria: productoJSON.categoria
            };

            carrito.push(nuevoProductoEnCarrito);
            await state.update({ carrito });
            console.log('🛒✅ [CARRITO] Producto añadido silenciosamente al estado:', nuevoProductoEnCarrito);
        } else {
            console.error('❌ [CARRITO] El JSON extraído del HISTORIAL por la IA está incompleto:', productoJSON);
        }
    } catch (e) {
        console.error('❌ [CARRITO] Error parseando JSON extraído del HISTORIAL:', resultadoExtraccion.respuesta, e);
    }
    
    return;
}

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
    .replace(/_+/g, '_')       // reemplaza multiples _ por uno solo
    .replace(/^_+|_+$/g, '');   // quita _ al inicio/final
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
    console.log(`    • ${b.nombre} (${b.texto.length} caracteres)`);
  });

  // 6. Retorna el prompt unificado para la IA
  return bloquesEnviados.map(b => b.texto).filter(Boolean).join('\n\n');
}

// IMPORTANTE: Cache de contactos (nuevo sistema)
import { getContactoByTelefono, getCacheContactos, actualizarContactoEnCache, cargarContactosDesdeAppSheet } from '../../funciones/helpers/cacheContactos.mjs'

export function extraerNombreProductoDeVision(texto) {
  const match = texto.match(/["“](.*?)["”]/)
  if (match && match[1]) return match[1]
  return texto
}

export const flowIAinfo = addKeyword(EVENTS.WELCOME)
  .addAction(async (ctx, tools) => {
    // 🎙️ MICROFONO DE DIAGNÓSTICO 1 - INICIO DE NUEVA CONVERSACIÓN
    console.log('⚡️⚡️⚡️ [DIAGNÓSTICO] INICIANDO "WELCOME" PARA EL CLIENTE: ⚡️⚡️⚡️', ctx.from);
    const currentStateWelcome = { paso: tools.state.get('pasoFlujoActual'), secciones: tools.state.get('seccionesActivas') };
    console.log('      [DIAGNÓSTICO] Estado ANTES de procesar:', JSON.stringify(currentStateWelcome));

    const { flowDynamic, endFlow, gotoFlow, provider, state } = tools;
    const phone = ctx.from.split('@')[0];
    const message = ctx.body.trim();

    // ==== INICIALIZA SOLO EN EL PRIMER MENSAJE ====
    // Si no hay pasoFlujoActual o seccionesActivas, inicializa en PASO 1
    if (!state.get('pasoFlujoActual') && !state.get('seccionesActivas')) {
      await state.update({
        pasoFlujoActual: 0,
        seccionesActivas: [],
        carrito: [] // Asegúrate de que esta línea esté aquí
      });
      console.log('🟢 [IAINFO] Estado inicializado: PASO 1, seccionesActivas y carrito vacíos');
      } else {
      console.log('🟢 [IAINFO] Estado existente: PASO', state.get('pasoFlujoActual') + 1, ', seccionesActivas:', state.get('seccionesActivas') || []);
    }

    console.log('📩 [IAINFO] Mensaje recibido de:', phone)
    console.log(`🔍 [IAINFO] Estado inicial de la caché: ${getCacheContactos().length} contactos`)

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
    const esDatosContacto = await detectarIntencionContactoIA(message)
    if (esDatosContacto) {
      console.log("🛡️ [FLOWIAINFO][WELCOME] Se va a actualizar contacto. Contacto en cache:", contacto)
      await verificarYActualizarContactoSiEsNecesario(message, phone, contacto, datos)
    }

    // ✅✅✅ INICIO DE LA CORRECCIÓN ✅✅✅
    // La detección de archivos ahora se hace ANTES de verificar el flag de productos.

    await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' });
    const detectar = await DetectarArchivos(ctx, state);

    if (state.get('tipoMensaje') === 1) { // Si es una imagen
      const imagenes = state.get('archivos')?.filter(item => item.tipo === 1);
      let resultado = '';
      if (imagenes?.length > 0) {
        const fileBuffer = fs.readFileSync(imagenes[0].ruta);
        resultado = await enviarImagenProductoOpenAI(fileBuffer);
        resultado = extraerNombreProductoDeVision(resultado);
      }
      if (resultado && resultado !== '' && resultado !== 'No es un producto') {
        await state.update({
          productoDetectadoEnImagen: true,
          productoReconocidoPorIA: resultado
        });
        console.log(`🖼️ [IAINFO] Producto detectado en imagen: ${resultado}`);
      }
    }

    // AgruparMensaje envuelve toda la lógica para procesar el texto final (de un mensaje de texto o de un audio transcrito).
    AgruparMensaje(detectar, async (txt) => {
      // Guardar mensaje del cliente en el historial
      actualizarHistorialConversacion(txt, 'cliente', state);
      Escribiendo(ctx);
      console.log('🧾 [IAINFO] Texto agrupado final del usuario:', txt);

      // Construye el promptSistema para la IA usando los bloques de la BC
      const bloques = ARCHIVO.PROMPT_BLOQUES;
      const { esConsultaProductos, categoriaDetectada, esConsultaTestimonios } = await obtenerIntencionConsulta(txt, '', state);
      const promptSistema = armarPromptOptimizado(state, bloques, {
        incluirProductos: esConsultaProductos,
        categoriaProductos: categoriaDetectada,
        incluirTestimonios: esConsultaTestimonios
      });

      const estado = {
        esClienteNuevo: !contacto || contacto.NOMBRE === 'Sin Nombre',
        contacto: contacto || {}
      };

      // ------ CHEQUEO DEL FLAG DE PRODUCTOS ------
      if (!BOT.PRODUCTOS) {
        // MODO SIN PRODUCTOS: La IA responde usando solo la BC, sin catálogo.
        console.log('🛑 [IAINFO] Flag PRODUCTOS está en FALSE. Usando IA general.');
        const res = await EnviarIA(txt, promptSistema, {
          ctx, flowDynamic, endFlow, gotoFlow, provider, state, promptExtra: ''
        }, estado);
        await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, txt);

      } else {
        // MODO CON PRODUCTOS: Lógica de productos completa.
        if (!state.get('_productosFull')?.length) {
          await cargarProductosAlState(state);
          await state.update({ __productosCargados: true });
          console.log('📦 [IAINFO] Productos cargados en cache para:', phone);
        }

        const productos = await obtenerProductosCorrectos(txt, state);
        const promptExtra = productos.length ? generarContextoProductosIA(productos, state) : '';

        if (productos.length) {
          await state.update({ productosUltimaSugerencia: productos });
          console.log(`📦 [IAINFO] ${productos.length} productos encontrados y asociados al mensaje.`);
        }

        const res = await EnviarIA(txt, promptSistema, {
          ctx, flowDynamic, endFlow, gotoFlow, provider, state, promptExtra
        }, estado);

        console.log('📥 [IAINFO] Respuesta completa recibida de IA:', res?.respuesta);
        await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, txt);
      }

      await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' });
    });
  })

 .addAction({ capture: true }, async (ctx, tools) => {
    // 🎙️ MICROFONO DE DIAGNÓSTICO 2 - INICIO DE MENSAJE DE CONTINUACIÓN
    console.log('⚡️⚡️⚡️ [DIAGNÓSTICO] INICIANDO "CAPTURE" PARA EL CLIENTE: ⚡️⚡️⚡️', ctx.from);
    const currentStateCapture = { paso: tools.state.get('pasoFlujoActual'), secciones: tools.state.get('seccionesActivas') };
    console.log('      [DIAGNÓSTICO] Estado ANTES de procesar:', JSON.stringify(currentStateCapture));

    const { flowDynamic, endFlow, gotoFlow, provider, state } = tools;
    const phone = ctx.from.split('@')[0];
    const message = ctx.body.trim();

    console.log('🟢 [IAINFO] Estado actual: PASO', state.get('pasoFlujoActual') + 1, ', seccionesActivas:', state.get('seccionesActivas') || []);

    let contacto = getContactoByTelefono(phone);
    const datos = {};

    // Detecta y guarda nombre/email si está presente literal
    if (/me llamo|mi nombre es/i.test(message)) {
      const nombre = message.split(/me llamo|mi nombre es/i)[1]?.trim();
      if (nombre && !/\d/.test(nombre)) datos.NOMBRE = nombre;
    }
    const email = message.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (email) datos.EMAIL = email[0];

    // ------ SIEMPRE intentar actualización completa de contacto por IA ------
    const esDatosContacto = await detectarIntencionContactoIA(message);
    if (esDatosContacto) {
      console.log("🛡️ [FLOWIAINFO][capture] Se va a actualizar contacto. Contacto en cache:", contacto);
      await verificarYActualizarContactoSiEsNecesario(message, phone, contacto, datos);
      contacto = getContactoByTelefono(phone);
    }

    // Actualiza fechas de contacto SIEMPRE
    if (contacto) await ActualizarFechasContacto(contacto, phone);

    // ✅✅✅ INICIO DE LA CORRECCIÓN (SECCIÓN CAPTURE) ✅✅✅
    await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' });
    const detectar = await DetectarArchivos(ctx, state);

    if (state.get('tipoMensaje') === 1) { // Si es una imagen
      const imagenes = state.get('archivos')?.filter(item => item.tipo === 1);
      let resultado = '';
      if (imagenes?.length > 0) {
        const fileBuffer = fs.readFileSync(imagenes[0].ruta);
        resultado = await enviarImagenProductoOpenAI(fileBuffer);
        resultado = extraerNombreProductoDeVision(resultado);
      }
      if (resultado && resultado !== '' && resultado !== 'No es un producto') {
        await state.update({
          productoDetectadoEnImagen: true,
          productoReconocidoPorIA: resultado
        });
        console.log(`🖼️ [IAINFO] Producto detectado en imagen: ${resultado}`);
      }
    }

    AgruparMensaje(detectar, async (txt) => {
      // Guardar mensaje del cliente en el historial
      actualizarHistorialConversacion(txt, 'cliente', state);
      if (ComprobrarListaNegra(ctx) || !BOT.ESTADO) return gotoFlow(idleFlow);
      reset(ctx, gotoFlow, BOT.IDLE_TIME * 60);
      Escribiendo(ctx);

      console.log('✏️ [IAINFO] Mensaje capturado en continuación de conversación:', txt);

      // Construye el promptSistema para la IA
      const bloques = ARCHIVO.PROMPT_BLOQUES;
      const { esConsultaProductos, categoriaDetectada, esConsultaTestimonios } = await obtenerIntencionConsulta(txt, state.get('ultimaConsulta') || '', state);
      const promptSistema = armarPromptOptimizado(state, bloques, {
        incluirProductos: esConsultaProductos,
        categoriaProductos: categoriaDetectada,
        incluirTestimonios: esConsultaTestimonios
      });

      const estado = {
        esClienteNuevo: !contacto || contacto.NOMBRE === 'Sin Nombre',
        contacto: contacto || {}
      };

      // ------ CHEQUEO DEL FLAG DE PRODUCTOS ------
      if (!BOT.PRODUCTOS) {
        // MODO SIN PRODUCTOS
        console.log('🛑 [IAINFO][capture] Flag PRODUCTOS está en FALSE. Usando IA general.');
        const res = await EnviarIA(txt, promptSistema, {
          ctx, flowDynamic, endFlow, gotoFlow, provider, state, promptExtra: ''
        }, estado);
        await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, txt);

      } else {
        // MODO CON PRODUCTOS
        if (!state.get('_productosFull')?.length) {
          await cargarProductosAlState(state);
          await state.update({ __productosCargados: true });
        }

        const productos = await obtenerProductosCorrectos(txt, state);
        const promptExtra = productos.length ? generarContextoProductosIA(productos, state) : '';

        if (productos.length) {
          await state.update({ productosUltimaSugerencia: productos });
        }

        const res = await EnviarIA(txt, promptSistema, {
          ctx, flowDynamic, endFlow, gotoFlow, provider, state, promptExtra
        }, estado);

        await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, txt);
      }

      await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' });
    });

    return tools.fallBack();
 });

// En el archivo: src/flujos/IA/flowIAinfo.mjs
async function manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, txt) {
    const tools = { ctx, flowDynamic, endFlow, gotoFlow, provider, state };
    
    console.log('🔄 [MANEJAR_IA] Iniciando procesamiento de respuesta...');
    const pasoAnterior = state.get('pasoFlujoActual');

    // Procesamos marcadores de la PRIMERA respuesta para actualizar el estado
    let respuestaProcesada = await cicloMarcadoresIA(res, txt, state, ctx, tools);

    const pasoNuevo = state.get('pasoFlujoActual');
    const huboCambioDePaso = (pasoAnterior !== pasoNuevo);

    let respuestaFinal = respuestaProcesada; // Por defecto, la respuesta final es la primera procesada

    // Si hubo cambio de paso, realizamos la re-consulta
    if (huboCambioDePaso) {
        console.log(`➡️ [TRANSICIÓN] Detectado cambio de PASO ${pasoAnterior + 1} a PASO ${pasoNuevo + 1}. Se requiere re-consulta.`);
        const bloques = ARCHIVO.PROMPT_BLOQUES;
        const nuevoPromptSistema = armarPromptOptimizado(state, bloques);
        const contactoCache = getContactoByTelefono(ctx.from);
        const estado = {
            esClienteNuevo: !contactoCache || contactoCache.NOMBRE === 'Sin Nombre',
            contacto: contactoCache || {}
        };
        
        console.log('   [ACCIÓN] Realizando la re-consulta controlada a la IA...');
        respuestaFinal = await EnviarIA(txt, nuevoPromptSistema, tools, estado);
    }
    
    // LÓGICA DE CARRITO ÚNICA Y FINAL: Se procesa solo la respuesta definitiva.
    if (respuestaFinal && respuestaFinal.respuesta) {
        await agregarProductoAlCarrito(respuestaFinal.respuesta, state, tools);
    }
    
    // Se envía la respuesta final (sea de la primera o de la segunda consulta) al cliente.
    await Responder(respuestaFinal, ctx, flowDynamic, state);
    return;
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

    const nuevaRespuestaComparar = nuevaRespuesta.toLowerCase();

    if (nuevaRespuestaComparar && nuevaRespuestaComparar === yaRespondido) {
      console.log('⚡ Respuesta ya fue enviada antes, evitando repetición.');
      return;
    }

    await state.update({ ultimaRespuestaSimple: nuevaRespuestaComparar });

    const msj = await EnviarImagenes(nuevaRespuesta, flowDynamic, ctx); // Usamos la respuesta LIMPIA
    const startTime = Date.now();
    console.log('⏱️ [DEBUG] Inicio de envío de mensaje a', ctx.from.split('@')[0]);
    await flowDynamic(msj);

    // Guardar mensaje del bot en el historial
    actualizarHistorialConversacion(nuevaRespuesta, 'bot', state);

    console.log('⏱️ [DEBUG] Fin de envío de mensaje a', ctx.from.split('@')[0], 'Tiempo:', Date.now() - startTime, 'ms');
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
