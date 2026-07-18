/* ContaFácil Pro — Capa de plataforma
 * ════════════════════════════════════
 * Punto ÚNICO donde la app toca el "mundo exterior": guardar archivos,
 * imprimir/generar PDF, compartir y escanear códigos. El resto del código
 * llama SIEMPRE a Platform.* y nunca directamente a las APIs del navegador.
 *
 * Entornos:
 *  - 'web'       → navegador / PWA (implementaciones del navegador)
 *  - 'capacitor' → app Android instalada (plugins nativos)
 *  - 'tauri'     → app de escritorio Windows (Fase 3)
 */
const Platform = (() => {

  // ── Detección del entorno de ejecución ──────────────────────────────────
  function env() {
    if (window.Capacitor && window.Capacitor.isNativePlatform &&
        window.Capacitor.isNativePlatform()) return 'capacitor'; // app Android/iOS
    if (window.__TAURI__) return 'tauri';                        // app Windows/Mac/Linux
    return 'web';                                                // navegador / PWA
  }
  const _isNative = () => env() === 'capacitor';
  const _plugins  = () => window.Capacitor.Plugins;

  function _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = () => resolve(String(r.result).split(',')[1]); // sin el prefijo data:
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // Escribe el blob en la caché de la app y devuelve su URI nativa
  async function _writeToCache(blob, filename) {
    const data = await _blobToBase64(blob);
    const res  = await _plugins().Filesystem.writeFile({
      path: filename, data, directory: 'CACHE',
    });
    return res.uri;
  }

  // ── Guardar un archivo en el dispositivo ────────────────────────────────
  // Web:    dispara la descarga del navegador.
  // Nativo: genera el archivo y abre el menú del sistema (Guardar en el
  //         teléfono / WhatsApp / Drive…) — sin pedir permisos de almacenamiento.
  async function saveFile(blob, filename) {
    if (_isNative()) {
      const uri = await _writeToCache(blob, filename);
      try {
        await _plugins().Share.share({ title: filename, files: [uri] });
      } catch (e) { /* usuario cerró el menú — el archivo ya quedó generado */ }
      return;
    }
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  // ── Compartir un archivo (WhatsApp / Nearby Share / correo…) ────────────
  // Devuelve: 'shared'      → se abrió el menú y se completó
  //           'cancel'      → el usuario cerró el menú (no hacer nada más)
  //           'unsupported' → no se pudo compartir (el llamador decide el fallback)
  async function shareFile(blob, filename, title, text) {
    if (_isNative()) {
      try {
        const uri = await _writeToCache(blob, filename);
        await _plugins().Share.share({
          title: title || 'ContaFácil Pro', text: text || filename, files: [uri],
        });
        return 'shared';
      } catch (e) {
        return /cancel/i.test(String(e && e.message)) ? 'cancel' : 'unsupported';
      }
    }
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
  // Nativo: diálogo de impresión de Android → imprimir o "Guardar como PDF".
  function printPage() {
    if (_isNative()) {
      _plugins().PrinterBridge.printCurrentPage({ name: 'ContaFacil' })
        .catch(() => window.print());
      return;
    }
    window.print();
  }

  // ── Abrir un documento HTML autocontenido para imprimir/guardar como PDF ─
  // Devuelve false si el navegador bloqueó la ventana emergente (solo web).
  function printHTML(html) {
    if (_isNative()) {
      _plugins().PrinterBridge.printHtml({ html, name: 'ContaFacil' }).catch(() => {});
      return true;
    }
    const win = window.open('', '_blank');
    if (!win) return false;
    win.document.write(html);
    win.document.close();
    return true;
  }

  // ── Escanear código de barras / QR (solo nativo) ────────────────────────
  // El WebView de Android no trae BarcodeDetector; se usa el escáner de
  // Google (ML Kit) que no requiere permiso de cámara. Devuelve el código
  // leído, o null si el usuario canceló. En web devuelve null (la app usa
  // su propio flujo con BarcodeDetector).
  async function scanBarcode() {
    if (!_isNative()) return null;
    const { BarcodeScanner } = _plugins();
    try {
      const r = await BarcodeScanner.scan();
      if (r && r.barcodes && r.barcodes.length) {
        return r.barcodes[0].rawValue || r.barcodes[0].displayValue || null;
      }
      return null;
    } catch (e) {
      const msg = String(e && e.message || '');
      if (/cancel/i.test(msg)) return null;
      if (/module/i.test(msg)) {
        // El módulo del escáner de Google aún no está en el teléfono: pedir su descarga
        try { await BarcodeScanner.installGoogleBarcodeScannerModule(); } catch (_) {}
        throw new Error('Descargando el escáner (una sola vez) — intenta de nuevo en unos segundos');
      }
      throw e;
    }
  }

  // ── Dictado por voz (registro hablado de asientos) ──────────────────────
  // Nativo: reconocedor de Android (RecognizerIntent) — offline si el idioma
  // español está descargado. Web: Web Speech API (necesita internet al dictar).
  async function dictate(prompt) {
    if (_isNative()) {
      const r = await _plugins().VozBridge.dictar({ prompt: prompt || 'Dicta tu registro…' });
      return (r && r.texto) ? r.texto : '';
    }
    return new Promise((resolve, reject) => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { reject(new Error('Este navegador no admite dictado — usa la app instalada')); return; }
      const rec = new SR();
      rec.lang = 'es-EC'; rec.interimResults = false; rec.maxAlternatives = 1;
      let done = false;
      rec.onresult = e => { done = true; resolve(e.results[0][0].transcript || ''); };
      rec.onerror  = e => {
        if (done) return;
        done = true;
        reject(new Error(e.error === 'not-allowed' ? 'Permiso de micrófono denegado'
          : e.error === 'no-speech' ? 'No escuché nada' : 'No se pudo dictar'));
      };
      rec.onend = () => { if (!done) { done = true; resolve(''); } };
      rec.start();
    });
  }

  // ── Notificaciones (recordatorios de cobros/pagos) ──────────────────────
  // Web: API Notification del navegador. App instalada: notificaciones
  // NATIVAS de Android (LocalNotifications) — el WebView no trae la API web.
  let _notifPerm = 'unsupported'; // caché síncrona: granted | denied | prompt | unsupported

  function _syncWebNotifPerm() {
    if ('Notification' in window) {
      _notifPerm = Notification.permission === 'default' ? 'prompt' : Notification.permission;
    }
  }

  async function _refreshNotifPerm() {
    if (_isNative()) {
      try {
        const r = await _plugins().LocalNotifications.checkPermissions();
        _notifPerm = r.display === 'prompt-with-rationale' ? 'prompt' : r.display;
      } catch (e) { _notifPerm = 'unsupported'; }
    } else {
      _syncWebNotifPerm();
    }
    return _notifPerm;
  }

  // Estado actual del permiso (síncrono, desde la caché)
  function notifState() { return _notifPerm; }

  async function requestNotifPermission() {
    if (_isNative()) {
      try {
        const r = await _plugins().LocalNotifications.requestPermissions();
        _notifPerm = r.display === 'prompt-with-rationale' ? 'prompt' : r.display;
      } catch (e) { _notifPerm = 'denied'; }
      return _notifPerm;
    }
    if (!('Notification' in window)) return 'unsupported';
    await Notification.requestPermission();
    _syncWebNotifPerm();
    return _notifPerm;
  }

  let _notifSeq = Math.floor(Date.now() / 1000) % 100000; // ids únicos para Android
  async function showNotification(title, body) {
    if (_isNative()) {
      try {
        await _plugins().LocalNotifications.schedule({
          notifications: [{ id: (_notifSeq++ % 2147480000), title, body }],
        });
      } catch (e) { /* sin permiso o plugin ausente: silencio */ }
      return;
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body, icon: 'icons/icon-192.png' }); } catch (e) {}
  }

  // Poblar la caché de permiso al cargar (en web es inmediato)
  _syncWebNotifPerm();

  // ── Arranque en app nativa: botón atrás de Android + barra de estado ────
  if (env() === 'capacitor') {
    document.addEventListener('DOMContentLoaded', () => {
      const { App: CapApp, StatusBar } = window.Capacitor.Plugins;
      if (CapApp) {
        CapApp.addListener('backButton', ({ canGoBack }) => {
          // 1) si hay una hoja/modal abierta, el botón atrás la cierra
          const overlay = document.querySelector('.modal-overlay.open');
          if (overlay) { overlay.classList.remove('open'); return; }
          // 2) si hay historial de navegación, retrocede de pantalla
          if (canGoBack) { window.history.back(); return; }
          // 3) en el inicio, minimiza la app (nunca la mata)
          CapApp.minimizeApp();
        });
      }
      if (StatusBar) {
        // Blanco + iconos oscuros: coincide con la barra superior blanca de la app
        StatusBar.setBackgroundColor({ color: '#ffffff' }).catch(() => {});
        StatusBar.setStyle({ style: 'LIGHT' }).catch(() => {});
      }
      _refreshNotifPerm(); // poblar la caché con el permiso nativo real
    });
  }

  return {
    env, saveFile, shareFile, printPage, printHTML, scanBarcode, dictate,
    notifState, requestNotifPermission, showNotification,
  };
})();
