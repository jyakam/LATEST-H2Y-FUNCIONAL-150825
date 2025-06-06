// /src/bc/cargarBC.mjs
import { getTxtDoc, getIdDocFromUrl } from 'googledocs-downloader'
import { BOT, ARCHIVO } from '../config/bot.mjs'

/**
 * Esta función se debe llamar UNA sola vez al iniciar el bot.
 * Descarga el documento desde Google Docs, extrae los bloques/secciones y los guarda en memoria global.
 */
export async function cargarYDividirBC() {
  try {
    if (!BOT.URLPROMPT) {
      console.error('❌ [cargarBC] No se ha configurado la URL de la Base de Conocimiento (BOT.URLPROMPT).')
      return
    }
    console.log('📥 [cargarBC] Descargando Base de Conocimiento desde Google Docs...')
    const rawText = await getTxtDoc(getIdDocFromUrl(BOT.URLPROMPT))
    const bloques = extraerBloquesBC(rawText)
    ARCHIVO.PROMPT_BLOQUES = bloques // Guarda todos los bloques en memoria global

    // Extrae los pasos de SECCION 2 como array
    const claveSeccion2 = Object.keys(bloques).find(k => k.includes('seccion_2'))
    if (claveSeccion2) {
      ARCHIVO.PROMPT_BLOQUES.PASOS_FLUJO = extraerPasosSeccion2(bloques[claveSeccion2])
      console.log('✅ [cargarBC] SECCION 2 dividida en', ARCHIVO.PROMPT_BLOQUES.PASOS_FLUJO.length, 'pasos.')
    }

    // Extrae las categorías del BLOQUE DE PRODUCTOS (SECCION 3)
    const claveSeccion3 = Object.keys(bloques).find(k => k.includes('seccion_3'))
    if (claveSeccion3) {
      ARCHIVO.PROMPT_BLOQUES.CATEGORIAS_PRODUCTOS = extraerCategoriasProductos(bloques[claveSeccion3])
      console.log('✅ [cargarBC] SECCION 3 dividida en categorías:', Object.keys(ARCHIVO.PROMPT_BLOQUES.CATEGORIAS_PRODUCTOS))
    }

    console.log('✅ [cargarBC] Base de Conocimiento cargada y dividida en', Object.keys(bloques).length, 'bloques.')
    return bloques
  } catch (err) {
    console.error('❌ [cargarBC] Error al cargar y dividir la Base de Conocimiento:', err.message)
    ARCHIVO.PROMPT_BLOQUES = {} // Deja vacío si falla
    return {}
  }
}

/**
 * Extrae los bloques/secciones principales usando delimitadores INICIO y FIN.
 * Los nombres de los bloques se vuelven claves del objeto resultado (en minúsculas y sin espacios).
 */
function extraerBloquesBC(texto) {
  const bloques = {}
  // Regex para encontrar cada bloque completo (con nombre flexible)
  const re = /=== INICIO SECCION: (.*?) ===([\s\S]*?)=== FIN SECCION: \1 ===/gi
  let match
  while ((match = re.exec(texto)) !== null) {
    const nombreOriginal = match[1].trim()
    const nombreClave = nombreOriginal
      .toLowerCase()
      .replace(/[^a-z0-9]/gi, '_') // Solo letras, números y guiones bajos
      .replace(/_+/g, '_') // Reemplaza varios _ seguidos por uno solo
      .replace(/^_|_$/g, '') // Quita _ inicial o final
    const contenido = match[2].trim()
    bloques[nombreClave] = contenido
    console.log(`🟢 [cargarBC] Bloque cargado: "${nombreClave}" (${nombreOriginal})`)
  }
  if (Object.keys(bloques).length === 0) {
    console.warn('⚠️ [cargarBC] No se encontraron bloques en el documento. ¿Los delimitadores están bien puestos?')
  }
  return bloques
}

/**
 * Divide SECCION 2 en pasos individuales (array) usando 📌 como delimitador.
 */
function extraerPasosSeccion2(textoSeccion2) {
  if (!textoSeccion2) return []
  // Regex para dividir por pasos (mantiene el título del paso)
  const partes = textoSeccion2.split(/(?=📌\s*PASO\s*\d+:)/i).map(x => x.trim()).filter(x => x)
  return partes
}

/**
 * Extrae las categorías de productos del BLOQUE DE PRODUCTOS (SECCION 3).
 * Devuelve un objeto: { categoria1: texto, categoria2: texto, ... }
 */
function extraerCategoriasProductos(textoSeccion3) {
  const categorias = {}
  const re = /=== INICIO CATEGORIA: (.*?) ===([\s\S]*?)=== FIN CATEGORIA: \1 ===/gi
  let match
  while ((match = re.exec(textoSeccion3)) !== null) {
    const nombreOriginal = match[1].trim()
    const nombreClave = nombreOriginal
      .toLowerCase()
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
    categorias[nombreClave] = match[2].trim()
    console.log(`🟠 [cargarBC] Categoría cargada: "${nombreClave}" (${nombreOriginal})`)
  }
  if (Object.keys(categorias).length === 0) {
    console.warn('⚠️ [cargarBC] No se encontraron categorías de productos en SECCION 3.')
  }
  return categorias
}
