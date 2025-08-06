//TT MODULOS
import { GuardarArchivos } from '../../funciones/proveedor.mjs'
import { BOT } from '../../config/bot.mjs'

//FF TIPOS DE ARCHIVOS
export const ENUM_TIPO_ARCHIVO = {
  TEXTO: 0,
  IMAGEN: 1,
  NOTA_VOZ: 2,
  DOCUMENTO: 3
}

//TT DETECTAR ARCHIVOS ENVIADOS
export async function DetectarArchivos(ctx, state) {
  //SS IMAGEN
  if (ctx.body.includes('_event_media_')) {
    console.log('📁 🌄 imagen detectado')
    console.log(`[DIAGNÓSTICO DE CONFIG] Verificando flag BOT.PROCESAR_IMG. Valor leído: [${BOT.PROCESAR_IMG}]`);
    if (BOT.PROCESAR_IMG) {
      const ruta = await GuardarArchivos(ctx)
      if (ruta) {
        const archivos = state.get('archivos') ? state.get('archivos') : []
        const archivo = { tipo: ENUM_TIPO_ARCHIVO.IMAGEN, ruta }
        archivos.push(archivo)
        await state.update({ archivos, tipoMensaje: ENUM_TIPO_ARCHIVO.IMAGEN })
        return {
          from: ctx.from,
          body: ctx.message.imageMessage.caption ? ctx.message.imageMessage.caption : '',
          tipo: ENUM_TIPO_ARCHIVO.IMAGEN // <-- CAMBIO CLAVE: Devolvemos el tipo
        }
      }
    }
    else {
      const txt = ctx.message.imageMessage.caption ? ctx.message.imageMessage.caption + '\n' + ctx.body : ctx.body
      await state.update({ tipoMensaje: ENUM_TIPO_ARCHIVO.TEXTO })
      return { from: ctx.from, body: txt, tipo: ENUM_TIPO_ARCHIVO.TEXTO } // <-- CAMBIO CLAVE
    }
  }
  //SS NOTA DE VOZ DETECTADA
  else if (ctx.body.includes('_event_voice_note_')) {
    console.log('📁 🎵 nota de voz detectada')
    console.log(`[DIAGNÓSTICO DE CONFIG] Verificando flag BOT.PROCESAR_AUDIOS. Valor leído: [${BOT.PROCESAR_AUDIOS}]`);
    if (BOT.PROCESAR_AUDIOS) {
      const ruta = await GuardarArchivos(ctx)
      if (ruta) {
        const archivos = state.get('archivos') ? state.get('archivos') : []
        const archivo = { tipo: ENUM_TIPO_ARCHIVO.NOTA_VOZ, ruta }
        archivos.push(archivo)
        await state.update({ archivos, tipoMensaje: ENUM_TIPO_ARCHIVO.NOTA_VOZ })
        return { from: ctx.from, body: '', tipo: ENUM_TIPO_ARCHIVO.NOTA_VOZ } // <-- CAMBIO CLAVE
      }
    }
    else {
      return { from: ctx.from, body: ctx.body, tipo: ENUM_TIPO_ARCHIVO.TEXTO } // <-- CAMBIO CLAVE
    }
  }
  //SS DOCUMENTO DETECTADO
  else if (ctx.body.includes('_event_document_')) {
    console.log('📁 📦 documento  detectado')
    const ruta = await GuardarArchivos(ctx)
    if (ruta) {
      const archivos = state.get('archivos') ? state.get('archivos') : []
      const archivo = { tipo: ENUM_TIPO_ARCHIVO.DOCUMENTO, ruta }
      archivos.push(archivo)
      await state.update({ archivos, tipoMensaje: ENUM_TIPO_ARCHIVO.DOCUMENTO })
      return { from: ctx.from, body: ctx.body, tipo: ENUM_TIPO_ARCHIVO.DOCUMENTO } // <-- CAMBIO CLAVE
    }
    return { from: ctx.from, body: ctx.body, tipo: ENUM_TIPO_ARCHIVO.TEXTO } // <-- CAMBIO CLAVE
  }
  //SS SOLO TEXTO
  else {
    console.log('📄 texto detectado')
    await state.update({ tipoMensaje: ENUM_TIPO_ARCHIVO.TEXTO })
    return { from: ctx.from, body: ctx.body, tipo: ENUM_TIPO_ARCHIVO.TEXTO } // <-- CAMBIO CLAVE
  }
}
