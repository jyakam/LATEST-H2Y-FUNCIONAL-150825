import 'dotenv/config'
import { OpenAI } from 'openai'

//TT MODULOS
import { ENUM_IA_RESPUESTAS } from './IAEnumRespuestas.mjs'
import { DetectarFuncion, FuncionesIA } from './funcionesIA.mjs'
import { ObtenerHistorial } from './historial.mjs'
import { Notificar, ENUM_NOTI } from '../../config/notificaciones.mjs'
import { BOT, MENSAJES } from '../../config/bot.mjs'

//TT AGREGAR CLAVE
function OpenIA() {
  return new OpenAI({
    apiKey: BOT.KEY_IA || process.env.OPENAI_API_KEY
  })
}

//TT LLAMAR IA
export async function EnviarTextoOpenAI(msj, userId, guion, estado, llamada = null) {
  try {
    const _historial = ObtenerHistorial(userId, guion, estado)

// 🔴 NUEVO BLOQUE QUE DEBES AGREGAR 🔴
if (!_historial.length || !_historial[0] || _historial[0].role !== 'system') {
  _historial.unshift({
    role: 'system',
    content: 'Eres un asistente virtual que ayuda a los clientes a resolver sus dudas y procesar solicitudes.'
  });
}
// 🔴 FIN DEL BLOQUE NUEVO 🔴

if (!llamada) {
  _historial.push({ role: 'user', content: msj })
} else {
  if (Array.isArray(llamada)) {
    _historial.push(...llamada)
  } else if (typeof llamada === 'object') {
    _historial.push(llamada)
  }
}

    // 🟣 OPTIMIZACIÓN: Solo un system prompt, nunca duplicado 🟣
    // system prompt siempre debe estar SOLO en la posición [0]
    // Limitar el resto a los últimos 8 mensajes user/assistant
    const mensajesUserAssistant = _historial.slice(1).filter(
      m => m.role === 'user' || m.role === 'assistant'
    )
    const ultimosTurnos = mensajesUserAssistant.slice(-8)
    const historialFinal = [_historial[0], ...ultimosTurnos]

    const openai = OpenIA()
    const request = {
      model: BOT.MODELO_IA,
      messages: historialFinal,
      max_tokens: BOT.TOKENS,
      temperature: BOT.TEMPERATURA
    }

    // 🚨 Solo agrega 'functions' si hay funciones disponibles
    const funciones = FuncionesIA(guion)
    if (Array.isArray(funciones) && funciones.length > 0) {
      request.functions = funciones
      request.function_call = 'auto'
    }

    // LOG 1: Ver resumen del historial SIN imprimir el contenido completo
    console.log('================= [DEBUG PROMPT OPENAI] =================');
    console.log('[DEBUG] Largo del historial:', historialFinal.length);
    historialFinal.forEach((m, idx) => {
      const preview = m.content ? m.content.substring(0, 100).replace(/\n/g, ' ') : '';
      const dots = m.content && m.content.length > 100 ? '... [truncado]' : '';
      console.log(`[${idx}] (${m.role}) [${m.content?.length || 0} chars]: "${preview}${dots}"`);
    });
    console.log('Longitud total del prompt (caracteres):', historialFinal.reduce((acc, m) => acc + (m.content?.length || 0), 0));
    console.log('==========================================================');

    // LOG 2: Mostrar SOLO un resumen de roles, longitudes y primeros 100 caracteres
    console.log('======= [PROMPT RESUMEN ENVIADO A LA IA] =======');
    historialFinal.forEach((m, idx) => {
      const preview = m.content ? m.content.substring(0, 100).replace(/\n/g, ' ') : '';
      const dots = m.content && m.content.length > 100 ? '... [truncado]' : '';
      console.log(`[${idx}] (${m.role}) [${m.content?.length || 0} chars]: "${preview}${dots}"`);
    });
    console.log('Longitud total del prompt (caracteres):', historialFinal.reduce((acc, m) => acc + (m.content?.length || 0), 0));
    console.log('=============================================');

    const completion = await openai.chat.completions.create(request)

    const message = completion.choices?.[0]?.message
    if (!message) throw new Error('❌ La IA no devolvió ninguna respuesta válida.')

    const respuesta = await DetectarFuncion(message, userId, guion, estado)
    _historial.push({ role: 'assistant', content: respuesta })

    return { respuesta, tipo: ENUM_IA_RESPUESTAS.TEXTO }
  } catch (error) {
    console.error('💥 TXT - Error al llamar a la API de OpenAI:', error)
    const msj = '⚠️ No es posible conectar con *OpenAI (TXT)*. Revisa la clave de API, tokens o el saldo de la cuenta.'
    Notificar(ENUM_NOTI.ERROR, { msj })
    return { respuesta: MENSAJES.ERROR || '❌ No pude procesar tu solicitud, por favor intentá más tarde.', tipo: ENUM_IA_RESPUESTAS.TEXTO }
  }
}
