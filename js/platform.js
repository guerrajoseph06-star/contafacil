/* ContaFácil Pro — Capa de plataforma
 * ════════════════════════════════════
 * Punto ÚNICO donde la app toca el "mundo exterior": guardar archivos,
 * imprimir/generar PDF y compartir. El resto del código llama SIEMPRE a
 * Platform.* y nunca directamente a las APIs del navegador.
 *
 * Hoy corre la implementación WEB (navegador / PWA). Cuando la app se
 * empaquete como aplicación instalada (Capacitor en Android, Tauri en
 * Windows), estas funciones se reemplazan por implementaciones nativas
 * SIN tocar ninguna otra parte del código.
 */
const Platform = (() => {

  // ── Detección del entorno de ejecución ──────────────────────────────────
  function env() {
    if (window.Capacitor && window.Capacitor.isNativePlatform &&
        window.Capacitor.isNativePlatform()) return 'capacitor'; // app Android/iOS
    if (window.__TAURI__) return 'tauri';                        // app Windows/Mac/Linux
    return 'web';                                                // navegador / PWA
  }

  // ── Guardar un archivo en el dispositivo ────────────────────────────────
  // Web: dispara la descarga del navegador.
  // Nativo (Fase 1): se guardará en Documentos/Descargas con plugin Filesystem.
  async function saveFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  // ── Compartir un archivo (WhatsApp / Nearby Share / correo…) ────────────
  // Devuelve: 'shared'      → se abrió el menú y se completó
  //           'cancel'      → el usuario cerró el menú (no hacer nada más)
  //           'unsupported' → el equipo no soporta compartir (el llamador decide el fallback)
  // Nativo (Fase 1): plugin Share de Capacitor (más estable que el del navegador).
  async function shareFile(blob, filename, title, text) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: title || 'ContaFácil Pro', text: text || filename });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel';
      // cualquier otro error → tratar como no soportado
    }
    return 'unsupported';
  }

  // ── Imprimir la pantalla actual (reportes usan CSS @media print) ────────
  // Nativo (Fase 1): diálogo de impresión nativo de Android.
  function printPage() { window.print(); }

  // ── Abrir un documento HTML autocontenido para imprimir/guardar como PDF ─
  // Devuelve false si el navegador bloqueó la ventana emergente.
  // Nativo (Fase 1): se renderiza e imprime con el motor nativo, sin ventanas.
  function printHTML(html) {
    const win = window.open('', '_blank');
    if (!win) return false;
    win.document.write(html);
    win.document.close();
    return true;
  }

  return { env, saveFile, shareFile, printPage, printHTML };
})();
