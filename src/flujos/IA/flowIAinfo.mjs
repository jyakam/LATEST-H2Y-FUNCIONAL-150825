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
import { DetectarArchivos, ENUM_TIPO_ARCHIVO } from '../bloques/detectarArchivos.mjs'
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
// El nuevo bloque que debes pegar
async function agregarProductoAlCarrito(respuestaIA, state, tools) {
    if (!respuestaIA || !respuestaIA.includes('🧩AGREGAR_CARRITO🧩')) {
        return;
    }

    console.log('🛒 [CARRITO] Señal 🧩AGREGAR_CARRITO🧩 detectada.');
    const productosOfrecidos = state.get('productosOfrecidos') || [];
    const historial = state.get('historialMensajes') || [];
    const ultimoMensajeCliente = historial.filter(h => h.rol === 'cliente').pop()?.texto || '';

    // --- INICIO: NUEVO MÉTODO INTELIGENTE (SELECTOR DE MEMORIA) ---
    if (productosOfrecidos.length > 0 && ultimoMensajeCliente) {
        console.log('🧠 [CARRITO] Usando memoria de productos ofrecidos para seleccionar.');
        const listaParaIA = productosOfrecidos.map((p, index) => `${index + 1}. ${p.nombre} (Precio: ${p.precio})`).join('\n');

        const promptSelector = `
            Un cliente quiere comprar un producto de la siguiente lista. Basado en su último mensaje, ¿cuál producto eligió?

            Último mensaje del cliente: "${ultimoMensajeCliente}"
            ---
            Lista de productos ofrecidos:
            ${listaParaIA}
            ---
            Responde ÚNICAMENTE con el NÚMERO del producto elegido. Si no estás seguro, responde "0".
        `;
        
        const resultadoSeleccion = await EnviarIA(promptSelector, '', tools, {});
        const seleccion = parseInt(resultadoSeleccion.respuesta.trim(), 10);

        if (!isNaN(seleccion) && seleccion > 0 && productosOfrecidos[seleccion - 1]) {
            const productoSeleccionado = productosOfrecidos[seleccion - 1];
            
            const nuevoProductoEnCarrito = {
                SKU: productoSeleccionado.sku || 'N/A',
                NOMBRE_PRODUCTO: productoSeleccionado.nombre,
                CANTIDAD: 1,
                PRECIO_UNITARIO: Number(String(productoSeleccionado.precio).replace(/[^0-9]/g, '')),
                CATEGORIA: productoSeleccionado.categoria || 'General',
                OPCION_1_COLOR: '', OPCION_2_TALLA: '', OPCION_3_TAMANO: '', OPCION_4_SABOR: '', NOTA_PRODUCTO: ''
            };

            const carrito = state.get('carrito') || [];
            carrito.push(nuevoProductoEnCarrito);
            await state.update({ carrito });
            console.log('🛒✅ [CARRITO] Producto añadido desde la MEMORIA:', nuevoProductoEnCarrito);
            return; // Termina la función con éxito
        } else {
            console.log('⚠️ [CARRITO] El selector IA no pudo determinar el producto desde la memoria. Usando método de respaldo.');
        }
    }
    // --- FIN: NUEVO MÉTODO INTELIGENTE ---


    // --- INICIO: MÉTODO DE RESPALDO (TU CÓDIGO ORIGINAL) ---
    console.log(' fallback [CARRITO] Analizando historial como método de respaldo...');
    const contextoReciente = historial.slice(-4).map(msg => `${msg.rol}: ${msg.texto}`).join('\n');

    if (contextoReciente.length === 0) {
        console.error('❌ [CARRITO] No se encontró historial para analizar.');
        return;
    }

    const promptExtractor = `
      Eres un sistema experto en extracción de datos. Analiza el siguiente fragmento de una conversación de WhatsApp y extrae la información del ÚLTIMO producto que el cliente confirmó comprar.
      REGLAS CRÍTICAS:
      - "sku": EXTRAE el código SKU. Si no se menciona, usa "N/A".
      - "nombre": EXTRAE el nombre completo del producto.
      - "cantidad": EXTRAE la cantidad. Si no se especifica, asume 1. Debe ser un NÚMERO.
      - "precio": EXTRAE el precio unitario final. Debe ser un NÚMERO, sin símbolos.
      - "categoria": EXTRAE la categoría del producto.
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

        if (productoJSON.nombre && productoJSON.cantidad && productoJSON.precio) {
            const carrito = state.get('carrito') || [];
            const nuevoProductoEnCarrito = {
                SKU: productoJSON.sku || 'N/A',
                NOMBRE_PRODUCTO: productoJSON.nombre,
                CANTIDAD: Number(productoJSON.cantidad),
                PRECIO_UNITARIO: Number(productoJSON.precio),
                CATEGORIA: productoJSON.categoria || 'General',
                OPCION_1_COLOR: '', OPCION_2_TALLA: '', OPCION_3_TAMANO: '', OPCION_4_SABOR: '', NOTA_PRODUCTO: ''
            };

            carrito.push(nuevoProductoEnCarrito);
            await state.update({ carrito });
            console.log('🛒✅ [CARRITO] Producto añadido silenciosamente desde el HISTORIAL:', nuevoProductoEnCarrito);
        } else {
            console.error('❌ [CARRITO] El JSON extraído del HISTORIAL por la IA está incompleto:', productoJSON);
        }
    } catch (e) {
        console.error('❌ [CARRITO] Error parseando JSON extraído del HISTORIAL:', resultadoExtraccion.respuesta, e);
    }
    // --- FIN: MÉTODO DE RESPALDO ---
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
import * as Cache from '../../funciones/helpers/cacheContactos.mjs'

export function extraerNombreProductoDeVision(texto) {
  const match = texto.match(/["“](.*?)["”]/)
  if (match && match[1]) return match[1]
  return texto
}

// Esta función usa la IA para verificar si una imagen es un comprobante de pago
async function esComprobanteDePagoIA(fileBuffer) {
    try {
        const prompt = 'Analiza esta imagen y responde únicamente con "true" si parece ser un comprobante de pago, un recibo o una captura de pantalla de una transferencia bancaria, o "false" si no lo es.';
        // Asumiendo que tienes una función para enviar imágenes a OpenAI que devuelve texto
        const respuestaTexto = await enviarImagenProductoOpenAI(fileBuffer, prompt); 
        return respuestaTexto.toLowerCase().includes('true');
    } catch (error) {
        console.error('❌ Error en esComprobanteDePagoIA:', error);
        return false;
    }
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
    console.log(`🔍 [IAINFO] Estado inicial de la caché: ${Cache.getCacheContactos().length} contactos`)

    // ------ BLOQUE DE CONTACTOS: SIEMPRE SE EJECUTA ------
    let contacto = Cache.getContactoByTelefono(phone)
    if (!contacto) {
      console.log(`🔄 [IAINFO] Contacto no encontrado, intentando recargar caché`)
      await Cache.cargarContactosDesdeAppSheet()
      contacto = Cache.getContactoByTelefono(phone)
      console.log('🔍 [DEBUG] Contacto después de recargar caché:', contacto)
      console.log(`🔍 [IAINFO] Contacto tras recargar caché:`, contacto)
    }

    if (!contacto) {
      console.log(`🆕 [IAINFO] Creando contacto nuevo para: ${phone}`)
      try {
        await ActualizarContacto(phone, { NOMBRE: 'Sin Nombre', RESP_BOT: 'Sí', ETIQUETA: 'Nuevo' })
        contacto = Cache.getContactoByTelefono(phone)
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
         Cache.actualizarContactoEnCache(contactoLocal)
          contacto = Cache.getContactoByTelefono(phone)
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

      // --- INICIO DE BLOQUE DE DEPURACIÓN DE FECHAS ---
console.log('🐞 [DEBUG FECHAS] Verificando variables ANTES de llamar a ActualizarFechasContacto...');
console.log('🐞 [DEBUG FECHAS] Valor de la variable "phone":', phone);
console.log('🐞 [DEBUG FECHAS] Tipo de la variable "phone":', typeof phone);
// console.log('🐞 [DEBUG FECHAS] Objeto "contacto" a enviar:', JSON.stringify(contacto, null, 2));
// --- FIN DE BLOQUE DE DEPURACIÓN DE FECHAS ---
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
     // console.log("🛡️ [FLOWIAINFO][WELCOME] Se va a actualizar contacto. Contacto en cache:", contacto)
      await verificarYActualizarContactoSiEsNecesario(message, phone, contacto, datos)
    }

    // ✅✅✅ INICIO DE LA CORRECCIÓN ✅✅✅
    // La detección de archivos ahora se hace ANTES de verificar el flag de productos.

    await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' });
    const tipoMensajeActual = state.get('tipoMensaje');

    // --- CAMINO 1: EL MENSAJE ES IMAGEN O AUDIO ---
    if (tipoMensajeActual === ENUM_TIPO_ARCHIVO.IMAGEN || tipoMensajeActual === ENUM_TIPO_ARCHIVO.NOTA_VOZ) {
        
        console.log(`🔀 [FLUJO] Detectado tipo de mensaje: ${tipoMensajeActual}. Se procesará como archivo multimedia.`);

        // Lógica de pre-procesamiento para imágenes (comprobante, producto)
        if (tipoMensajeActual === ENUM_TIPO_ARCHIVO.IMAGEN) {
            const imagenes = state.get('archivos')?.filter(item => item.tipo === 1);
            if (imagenes?.length > 0) {
                const fileBuffer = fs.readFileSync(imagenes[0].ruta);
                if (await esComprobanteDePagoIA(fileBuffer)) {
                    await state.update({ estado_pago: 'Comprobante Enviado' });
                    console.log('🧾 [PAGO] La imagen es un comprobante. Estado actualizado.');
                } else {
                    const resultado = extraerNombreProductoDeVision(await enviarImagenProductoOpenAI(fileBuffer));
                    if (resultado && resultado !== '' && resultado !== 'No es un producto') {
                        await state.update({ productoDetectadoEnImagen: true, productoReconocidoPorIA: resultado });
                        console.log(`🖼️ [IAINFO] Producto detectado en imagen: ${resultado}`);
                    }
                }
            }
        }
        
       // El texto que acompaña (caption) se pasa, si no hay, se pasa vacío.
const textoAdjunto = ctx.message?.imageMessage?.caption || ctx.message?.videoMessage?.caption || '';
const herramientas = { ctx, flowDynamic, endFlow, gotoFlow, provider, state }; // <-- AÑADE ESTA LÍNEA
const res = await EnviarIA(textoAdjunto, '', herramientas, {});                  // <-- USA "herramientas" AQUÍ
await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, textoAdjunto);

    // --- CAMINO 2: EL MENSAJE ES TEXTO ---
    } else {
        console.log(`🔀 [FLUJO] Detectado tipo de mensaje: ${tipoMensajeActual}. Se procesará como texto.`);
        AgruparMensaje(ctx, async (txt, ctx) => {
            const phone = ctx.from.split('@')[0];
            const tools = { ctx, flowDynamic, endFlow, gotoFlow, provider, state };
            const textoFinalUsuario = txt;
            const contacto = Cache.getContactoByTelefono(phone);

            actualizarHistorialConversacion(textoFinalUsuario, 'cliente', state);
            if (ComprobrarListaNegra(ctx) || !BOT.ESTADO) return gotoFlow(idleFlow);
            reset(ctx, gotoFlow, BOT.IDLE_TIME * 60);
            Escribiendo(ctx);

            const bloques = ARCHIVO.PROMPT_BLOQUES;
            const { esConsultaProductos, categoriaDetectada, esConsultaTestimonios } = await obtenerIntencionConsulta(textoFinalUsuario, state.get('ultimaConsulta') || '', state);
            const promptSistema = armarPromptOptimizado(state, bloques, {
                incluirProductos: esConsultaProductos,
                categoriaProductos: categoriaDetectada,
                incluirTestimonios: esConsultaTestimonios
            });

            const estado = {
                esClienteNuevo: !contacto || contacto.NOMBRE === 'Sin Nombre',
                contacto: contacto || {}
            };
            
            if (!BOT.PRODUCTOS) {
                const res = await EnviarIA(textoFinalUsuario, promptSistema, tools, estado);
                await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, textoFinalUsuario);
            } else {
                if (!state.get('_productosFull')?.length) {
                    await cargarProductosAlState(state);
                    await state.update({ __productosCargados: true });
                }
                const productos = await obtenerProductosCorrectos(textoFinalUsuario, state);
                const promptExtra = productos.length ? generarContextoProductosIA(productos, state) : '';
                if (productos.length) {
                    await state.update({ productosUltimaSugerencia: productos });
                }
                const res = await EnviarIA(textoFinalUsuario, promptSistema, { ...tools, promptExtra }, estado);
                await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, textoFinalUsuario);
            }

            await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' });
        });
    }
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

    let contacto = Cache.getContactoByTelefono(phone);
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
     // console.log("🛡️ [FLOWIAINFO][capture] Se va a actualizar contacto. Contacto en cache:", contacto);
      await verificarYActualizarContactoSiEsNecesario(message, phone, contacto, datos);
      contacto = Cache.getContactoByTelefono(phone);
    }

    // Actualiza fechas de contacto SIEMPRE
     // --- INICIO DE BLOQUE DE DEPURACIÓN DE FECHAS ---
console.log('🐞 [DEBUG FECHAS] Verificando variables ANTES de llamar a ActualizarFechasContacto...');
console.log('🐞 [DEBUG FECHAS] Valor de la variable "phone":', phone);
console.log('🐞 [DEBUG FECHAS] Tipo de la variable "phone":', typeof phone);
// console.log('🐞 [DEBUG FECHAS] Objeto "contacto" a enviar:', JSON.stringify(contacto, null, 2));
// --- FIN DE BLOQUE DE DEPURACIÓN DE FECHAS ---
    if (contacto) await ActualizarFechasContacto(contacto, phone);

    // ✅✅✅ INICIO DE LA CORRECCIÓN (SECCIÓN CAPTURE) ✅✅✅
    await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' });
    const resultadoDeteccion = await DetectarArchivos(ctx, state);
    const tipoMensajeActual = resultadoDeteccion.tipo;

    // --- CAMINO 1: EL MENSAJE ES IMAGEN O AUDIO ---
    if (tipoMensajeActual === ENUM_TIPO_ARCHIVO.IMAGEN || tipoMensajeActual === ENUM_TIPO_ARCHIVO.NOTA_VOZ) {
        
        console.log(`🔀 [FLUJO CAPTURE] Detectado tipo de mensaje: ${tipoMensajeActual}. Se procesará como archivo multimedia.`);

        // Lógica de pre-procesamiento para imágenes (comprobante, producto)
        if (tipoMensajeActual === ENUM_TIPO_ARCHIVO.IMAGEN) {
            const imagenes = state.get('archivos')?.filter(item => item.tipo === 1);
            if (imagenes?.length > 0) {
                const fileBuffer = fs.readFileSync(imagenes[0].ruta);
                if (await esComprobanteDePagoIA(fileBuffer)) {
                    await state.update({ estado_pago: 'Comprobante Enviado' });
                    console.log('🧾 [PAGO CAPTURE] La imagen es un comprobante. Estado actualizado.');
                } else {
                    const resultado = extraerNombreProductoDeVision(await enviarImagenProductoOpenAI(fileBuffer));
                    if (resultado && resultado !== '' && resultado !== 'No es un producto') {
                        await state.update({ productoDetectadoEnImagen: true, productoReconocidoPorIA: resultado });
                        console.log(`🖼️ [IAINFO CAPTURE] Producto detectado en imagen: ${resultado}`);
                    }
                }
            }
        }
        
       // El texto que acompaña (caption) se pasa, si no hay, se pasa vacío.
const textoAdjunto = ctx.message?.imageMessage?.caption || ctx.message?.videoMessage?.caption || '';
const herramientas = { ctx, flowDynamic, endFlow, gotoFlow, provider, state }; // <-- AÑADE ESTA LÍNEA
const res = await EnviarIA(textoAdjunto, '', herramientas, {});                  // <-- USA "herramientas" AQUÍ
await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, textoAdjunto);

    // --- CAMINO 2: EL MENSAJE ES TEXTO ---
    } else {
        console.log(`🔀 [FLUJO CAPTURE] Detectado tipo de mensaje: ${tipoMensajeActual}. Se procesará como texto.`);
        AgruparMensaje(ctx, async (txt, ctx) => {
            const phone = ctx.from.split('@')[0];
            const tools = { ctx, flowDynamic, endFlow, gotoFlow, provider, state };
            const textoFinalUsuario = txt;
            const contacto = Cache.getContactoByTelefono(phone);

            actualizarHistorialConversacion(textoFinalUsuario, 'cliente', state);
            if (ComprobrarListaNegra(ctx) || !BOT.ESTADO) return gotoFlow(idleFlow);
            reset(ctx, gotoFlow, BOT.IDLE_TIME * 60);
            Escribiendo(ctx);

            const bloques = ARCHIVO.PROMPT_BLOQUES;
            const { esConsultaProductos, categoriaDetectada, esConsultaTestimonios } = await obtenerIntencionConsulta(textoFinalUsuario, state.get('ultimaConsulta') || '', state);
            const promptSistema = armarPromptOptimizado(state, bloques, {
                incluirProductos: esConsultaProductos,
                categoriaProductos: categoriaDetectada,
                incluirTestimonios: esConsultaTestimonios
            });

            const estado = {
                esClienteNuevo: !contacto || contacto.NOMBRE === 'Sin Nombre',
                contacto: contacto || {}
            };
            
            if (!BOT.PRODUCTOS) {
                const res = await EnviarIA(textoFinalUsuario, promptSistema, tools, estado);
                await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, textoFinalUsuario);
            } else {
                if (!state.get('_productosFull')?.length) {
                    await cargarProductosAlState(state);
                    await state.update({ __productosCargados: true });
                }
                const productos = await obtenerProductosCorrectos(textoFinalUsuario, state);
                const promptExtra = productos.length ? generarContextoProductosIA(productos, state) : '';
                if (productos.length) {
                    await state.update({ productosUltimaSugerencia: productos });
                }
                const res = await EnviarIA(textoFinalUsuario, promptSistema, { ...tools, promptExtra }, estado);
                await manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, textoFinalUsuario);
            }

            await state.update({ productoDetectadoEnImagen: false, productoReconocidoPorIA: '' });
        });
    }
    return tools.fallBack();
 });

// En el archivo: src/flujos/IA/flowIAinfo.mjs
// -------- NUEVA Y DEFINITIVA FUNCIÓN MANEJARRESPUESTAIA (PEGAR ESTA) --------
// Reemplaza tu función manejarRespuestaIA con esta versión final y completa
async function manejarRespuestaIA(res, ctx, flowDynamic, endFlow, gotoFlow, provider, state, txt) {
    const phone = ctx.from.split('@')[0];
    const tools = { ctx, flowDynamic, endFlow, gotoFlow, provider, state };

    console.log('🔄 [MANEJAR_IA] Iniciando procesamiento de respuesta...');
    const pasoAnterior = state.get('pasoFlujoActual');

    // 1. Se procesan los marcadores de la Base de Conocimiento para actualizar el estado.
    await cicloMarcadoresIA(res, txt, state, ctx, tools);

    const pasoNuevo = state.get('pasoFlujoActual');
    const huboCambioDePaso = (pasoAnterior !== pasoNuevo);

    let respuestaFinal = res; // Por defecto, la respuesta final es la original.

    // 2. Si hubo cambio de paso en la BC, se hace una segunda consulta a la IA.
    if (huboCambioDePaso) {
        console.log(`➡️ [TRANSICIÓN] Detectado cambio de PASO ${pasoAnterior + 1} a PASO ${pasoNuevo + 1}. Se requiere re-consulta.`);
        const bloques = ARCHIVO.PROMPT_BLOQUES;
        const nuevoPromptSistema = armarPromptOptimizado(state, bloques);
        const contactoCache = Cache.getContactoByTelefono(phone);
        const estado = {
            esClienteNuevo: !contactoCache || contactoCache.NOMBRE === 'Sin Nombre',
            contacto: contactoCache || {}
        };
        
        console.log('   [ACCIÓN] Realizando la re-consulta controlada a la IA...');
        respuestaFinal = await EnviarIA(txt, nuevoPromptSistema, tools, estado);
    }
    
    // --- INICIO DE LA LÓGICA DE FUSIÓN ---

    // OBTENEMOS EL TEXTO FINAL DE LA RESPUESTA DE LA IA
    const respuestaTextoIA = respuestaFinal.respuesta || '';
    
    // --- INICIO: LÓGICA AÑADIDA ---
    // 1. "TOMAR APUNTES" DE PRODUCTOS OFRECIDOS
    const productosOfrecidos = state.get('productosOfrecidos') || [];
    const matchesProductos = [...respuestaTextoIA.matchAll(/🧩PRODUCTO_OFRECIDO\[(.*?)\]🧩/g)];
    
    if (matchesProductos.length > 0) {
        console.log(`📝 [MEMORIA] Detectados ${matchesProductos.length} productos ofrecidos para memorizar.`);
        for (const match of matchesProductos) {
            try {
                const productoJSON = JSON.parse(match[1]);
                if (!productosOfrecidos.some(p => p.sku === productoJSON.sku)) {
                    productosOfrecidos.push(productoJSON);
                }
            } catch (e) {
                console.error('❌ Error parseando JSON de PRODUCTO_OFRECIDO:', match[1]);
            }
        }
        await state.update({ productosOfrecidos: productosOfrecidos.slice(-5) }); // Guarda solo los últimos 5
    }

    // 2. DETECTAR FORMA DE PAGO
    const matchFormaPago = respuestaTextoIA.match(/🧩FORMA_PAGO\[(.*?)\]🧩/);
    if (matchFormaPago && matchFormaPago[1]) {
        const formaPago = matchFormaPago[1];
        await state.update({ forma_pago: formaPago });
        console.log(`💰 [PAGO] Forma de pago guardada en memoria: ${formaPago}`);
    }
    // --- FIN: LÓGICA AÑADIDA ---

    const respuestaTextoIA_lower = respuestaTextoIA.toLowerCase();
    console.log('🧠 [ROUTER] Analizando respuesta final de IA para acciones:', respuestaTextoIA_lower);

    // 3. ROUTER DE PRODUCTOS (Lógica Antigua Restaurada) - INTACTO
    if (respuestaTextoIA_lower.includes('🧩mostrarproductos')) {
        console.log('✅ [ROUTER] Acción detectada: 🧩mostrarproductos. Yendo a flowProductos.');
        await state.update({ ultimaConsulta: txt });
        return gotoFlow(flowProductos);
    }

    if (respuestaTextoIA_lower.includes('🧩mostrardetalles')) {
        console.log('✅ [ROUTER] Acción detectada: 🧩mostrardetalles. Yendo a flowDetallesProducto.');
        return gotoFlow(flowDetallesProducto);
    }

    if (respuestaTextoIA_lower.includes('🧩solicitarayuda')) {
        console.log('✅ [ROUTER] Acción detectada: 🧩solicitarayuda.');
        return gotoFlow(flowProductos); // TODO: Cambiar por flow de ayuda real
    }

    // 4. LÓGICA DE CARRITO (Lógica Nueva Preservada) - INTACTO
    await agregarProductoAlCarrito(respuestaFinal.respuesta, state, tools);
    
    // 5. RESPUESTA FINAL - INTACTO
    console.log('➡️ [ROUTER] Ninguna acción de cambio de flujo detectada. Enviando respuesta de texto.');
    await Responder(respuestaFinal, ctx, flowDynamic, state);
    return;
}

async function Responder(res, ctx, flowDynamic, state) {
  if (res.tipo === ENUM_IA_RESPUESTAS.TEXTO && res.respuesta) {
    await Esperar(BOT.DELAY);

    const yaRespondido = state.get('ultimaRespuestaSimple') || '';
    let nuevaRespuesta = res.respuesta.trim();

 // 🔴🔴🔴 LIMPIEZZA DE MARCADORES INTERNOS (emoji + clave + texto extra) 🔴🔴🔴
    nuevaRespuesta = nuevaRespuesta.replace(/🧩[A-Z0-9_]+(\[.*?\])?🧩/gi, '').trim();

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
