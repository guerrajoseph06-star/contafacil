/**
 * ContaFácil Pro — Application Logic v2.0
 * Tipos correctos: income | expense | transfer | liability
 */

// ── Estado global ─────────────────────────────────────────────────────────────
let currentScreen = 'dashboard';

// Versión del código. Si la app muestra una versión distinta a esta tras recargar,
// el navegador está usando archivos viejos en caché.
const APP_VERSION = '2026.05.23l';

// ── Service Worker: app 100% offline + actualizaciones limpias ────────────────
let _cfWantsReload = false; // solo recargar cuando el usuario pide actualizar
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(reg => {
        // Versión nueva ya descargada y esperando (de una visita anterior)
        if (reg.waiting && navigator.serviceWorker.controller) {
          _showUpdateBanner(reg.waiting);
        }
        // Detectar la descarga de una versión nueva en vivo
        reg.addEventListener('updatefound', () => {
          const nuevo = reg.installing;
          if (!nuevo) return;
          nuevo.addEventListener('statechange', () => {
            // installed + ya hay un SW controlando = es una ACTUALIZACIÓN
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
              _showUpdateBanner(nuevo);
            }
          });
        });
      })
      .catch(() => { /* sin SW la app sigue funcionando con internet */ });

    // Buscar actualizaciones cuando la app vuelve al primer plano
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
      }
    });

    // Cuando el SW nuevo toma el control, recargar (solo si el usuario lo pidió)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_cfWantsReload) location.reload();
    });
  });
}

// Banner "Actualización disponible" (se inyecta solo, sin tocar el HTML)
function _showUpdateBanner(worker) {
  if (document.getElementById('cf-update-banner')) return; // ya está visible
  const bar = document.createElement('div');
  bar.id = 'cf-update-banner';
  bar.style.cssText = 'position:fixed; left:0; right:0; bottom:0; z-index:99999;' +
    'background:#2563eb; color:#fff; padding:13px 16px; display:flex;' +
    'align-items:center; gap:12px; box-shadow:0 -4px 16px rgba(0,0,0,.20);';
  bar.innerHTML =
    '<div style="flex:1; font-size:13px; line-height:1.45;">' +
      '<strong>🎉 Actualización disponible</strong><br>' +
      '<span style="opacity:.85; font-size:12px;">Toca «Actualizar» para usar la versión más reciente</span>' +
    '</div>' +
    '<button id="cf-update-btn" style="background:#fff; color:#2563eb; border:none;' +
      'border-radius:9px; padding:10px 16px; font-size:13px; font-weight:800;' +
      'cursor:pointer; white-space:nowrap;">Actualizar</button>' +
    '<button id="cf-update-x" style="background:none; border:none; color:#fff;' +
      'font-size:22px; line-height:1; cursor:pointer; opacity:.7; padding:0 4px;">×</button>';
  document.body.appendChild(bar);
  document.getElementById('cf-update-btn').onclick = () => {
    _cfWantsReload = true;
    worker.postMessage('skipWaiting');
    document.getElementById('cf-update-btn').textContent = 'Actualizando…';
  };
  document.getElementById('cf-update-x').onclick = () => bar.remove();
}

// ── Modo Oscuro ───────────────────────────────────────────────────────────────
function applyTheme(dark) {
  // Usar clase en body — más compatible con Chrome Android que data-theme en html
  document.body.classList.toggle('dark-mode', dark);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#1a2035' : '#2563eb');
  const track = document.getElementById('dark-toggle-track');
  const desc  = document.getElementById('settings-dark-desc');
  if (track) track.classList.toggle('on', dark);
  if (desc)  desc.textContent = dark ? '🌙 Tema oscuro activo' : '☀️ Tema claro activo';
}
function toggleDarkMode() {
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('cf_dark_mode', isDark ? '0' : '1');
  applyTheme(!isDark);
}
// ── Variables PIN / Seguridad ─────────────────────────────────────────────────
let _pinBuffer      = '';        // dígitos ingresados en el momento
let _pinMode        = 'unlock';  // 'unlock' | 'confirm' | 'set' | 'confirm_new'
let _pinAction      = null;      // función a ejecutar tras PIN correcto
let _newPinTemp     = '';        // PIN nuevo (primer ingreso) para confirmar
let _pinTargetUser  = '';        // usuario cuyo PIN se está verificando/configurando
let _pinFailCount   = 0;         // intentos fallidos consecutivos
let _pinLockedUntil = 0;         // timestamp hasta el que el teclado está bloqueado
let _encImportPending = null;    // JSON cifrado pendiente de importar
let _inactivityTimer  = null;    // temporizador de auto-bloqueo

let editingTxId      = null;
let formType         = 'expense';
let journalFilter     = 'all';
let journalCatFilter  = '';      // filtro de categoría en el diario
let journalUserFilter = '';      // filtro de usuario en el diario
let journalSearch     = '';
let journalDateFilter = 'all';   // 'all'|'today'|'yesterday'|'week'|'month'|'custom'
let reportYear       = new Date().getFullYear();
let reportMonth      = new Date().getMonth() + 1;

// ── Formatos ──────────────────────────────────────────────────────────────────
function fmt(amount) {
  const s = DB.getSettings();
  return s.currencySymbol + ' ' + Number(amount).toLocaleString('es-CO', {
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
}
function fmtDate(str) {
  return new Date(str + 'T12:00:00').toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}
function today() { return new Date().toISOString().split('T')[0]; }
function escHtml(str) {
  return (str || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

// ── Navegación ────────────────────────────────────────────────────────────────
function navigate(screen, params = {}) {
  // Verificar acceso — BLINDADO: el propietario NUNCA se bloquea.
  // Capas de seguridad para que un fallo de datos jamás encierre al usuario:
  //   1. Si el usuario activo es el propietario → acceso total siempre.
  //   2. Si no hay un propietario definido → acceso total (fail-open).
  //   3. Si solo existe 1 usuario → acceso total (no tiene sentido restringir).
  //   4. Solo se bloquea a un NO-propietario, entre varios usuarios, con
  //      restricción explícita de pantalla.
  const currentUser = DB.getSettings().userName || 'Principal';
  const userList    = DB.getUserList();
  const ownerEntry  = userList.find(u => u.isOwner);
  const isOwner     = !ownerEntry || ownerEntry.name === currentUser;

  if (!isOwner && userList.length > 1 && !DB.isScreenAllowed(currentUser, screen)) {
    showToast('🔒 Tu usuario no tiene acceso a esta sección', 2500);
    return;
  }

  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('screen-' + screen);
  if (el) el.classList.add('active');
  currentScreen = screen;

  // Marcar visualmente tabs bloqueadas según permisos del usuario actual
  const allowed = DB.getUserAllowedScreens(currentUser);
  document.querySelectorAll('.nav-item').forEach(ni => {
    ni.classList.toggle('active', ni.dataset.screen === screen);
    const blocked = !allowed.includes(ni.dataset.screen);
    ni.style.opacity = blocked ? '0.35' : '';
    ni.title = blocked ? '🔒 Sin acceso' : '';
  });

  // FAB: contexto dinámico según pantalla
  const fab = document.getElementById('fab');
  if (fab) {
    const fabScreens = ['dashboard', 'journal', 'inventory', 'cartera', 'assets'];
    fab.style.display = fabScreens.includes(screen) ? 'flex' : 'none';
    if (screen === 'inventory') {
      fab.title = 'Agregar producto';
      fab.onclick = () => openProductForm();
    } else if (screen === 'cartera') {
      fab.title = 'Nueva venta a crédito';
      fab.onclick = () => openReceivableForm();
    } else if (screen === 'assets') {
      fab.title = 'Registrar activo fijo';
      fab.onclick = () => openAssetForm();
    } else {
      fab.title = 'Nueva transacción';
      fab.onclick = () => { setFormType('expense'); navigate('form'); };
    }
  }

  switch (screen) {
    case 'dashboard':  renderDashboard();  break;
    case 'journal':    renderJournal();    break;
    case 'form':       renderForm(params.id); break;
    case 'reports':    renderReports();    break;
    case 'inventory':  renderInventory();  break;
    case 'cartera':    renderCartera();    break;
    case 'assets':     renderAssets();     break;
    case 'settings':   renderSettings();   break;
  }
  window.scrollTo(0, 0);
}

// ── Onboarding ────────────────────────────────────────────────────────────────
let obSlide = 0;
const OB_SLIDES = [
  { emoji:'👋', title:'¡Bienvenido a ContaFácil Pro!', text:'La app de contabilidad diseñada para emprendedores. Registra ingresos, gastos, deudas e inventario en segundos.' },
  { emoji:'📒', title:'Diario Contable Correcto', text:'Diferenciamos ingresos, gastos, traslados entre cuentas y deudas/pasivos. Cada tipo se registra contablemente bien.' },
  { emoji:'📦', title:'Control de Inventario', text:'Lleva el stock de tus productos. Cada venta descuenta automáticamente y cada compra lo repone.' },
  { emoji:'📊', title:'Reportes en PDF', text:'Genera reportes mensuales profesionales con un toque. Sin internet, directo desde tu dispositivo.' },
];

function renderOnboarding() {
  document.getElementById('ob-slides').innerHTML = OB_SLIDES.map((s, i) => `
    <div class="ob-slide ${i === obSlide ? 'active' : ''}">
      <div class="ob-emoji">${s.emoji}</div>
      <h2 class="ob-title">${s.title}</h2>
      <p class="ob-text">${s.text}</p>
    </div>
  `).join('');
  document.getElementById('ob-dots').innerHTML = OB_SLIDES.map((_, i) =>
    `<div class="ob-dot ${i === obSlide ? 'active' : ''}"></div>`
  ).join('');
  document.getElementById('ob-next').textContent = obSlide === OB_SLIDES.length - 1 ? '¡Comenzar!' : 'Siguiente →';
}

function obNext() {
  if (obSlide < OB_SLIDES.length - 1) { obSlide++; renderOnboarding(); }
  else finishOnboarding();
}
function obPrev() { if (obSlide > 0) { obSlide--; renderOnboarding(); } }

function finishOnboarding() {
  DB.markOnboarded();
  document.getElementById('screen-onboarding').classList.remove('active');
  document.getElementById('bottom-nav').style.display = 'flex';
  navigate('dashboard');
}

// ══════════════════════════════════════════════════════════════════════════════
// SEGURIDAD — PIN de bloqueo + exportación cifrada AES-256
// ══════════════════════════════════════════════════════════════════════════════

function initSecurity() {
  const users      = DB.getUserList();
  const anyHasPin  = users.some(u => u.pinHash);
  if (!anyHasPin) return; // ningún usuario tiene PIN, entrar libremente

  if (users.length === 1) {
    // Un solo usuario: ir directo a su pantalla de PIN
    showLockScreen('unlock', null, users[0].name);
  } else {
    // Varios usuarios: mostrar selector primero
    showUserPickerLock();
  }
}

// Pantalla de selección de usuario (para el bloqueo al inicio)
function showUserPickerLock() {
  const s      = DB.getSettings();
  const lockEl = document.getElementById('screen-lock');
  const picker = document.getElementById('lock-user-picker');
  const pinArea = document.getElementById('lock-pin-area');

  document.getElementById('lock-company').textContent = s.companyName || 'ContaFácil Pro';
  document.getElementById('lock-msg').textContent = '👤 ¿Quién eres?';

  const users = DB.getUserList();
  picker.innerHTML = users.map(u => `
    <button onclick="selectLockUser('${u.name.replace(/\\/g,'\\\\').replace(/'/g, "\\'")}', ${!!u.pinHash})"
      style="display:flex; align-items:center; gap:14px; width:100%; padding:14px 18px;
        background:rgba(255,255,255,.18); border:none; border-radius:14px; color:white;
        cursor:pointer; text-align:left; -webkit-tap-highlight-color:transparent;">
      <div style="font-size:24px; width:44px; height:44px; background:rgba(255,255,255,.22);
        border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
        ${u.isOwner ? '👑' : '👤'}
      </div>
      <div style="flex:1; min-width:0;">
        <div style="font-size:16px; font-weight:700;">${u.name}</div>
        <div style="font-size:11px; opacity:.7;">
          ${u.isOwner ? '🏢 Propietario · ' : ''}${u.pinHash ? '🔒 Requiere PIN' : '🔓 Sin PIN'}
        </div>
      </div>
      <div style="font-size:20px; opacity:.6;">›</div>
    </button>
  `).join('');

  picker.style.display  = 'flex';
  pinArea.style.display = 'none';
  lockEl.style.display  = 'flex';
}

// Usuario seleccionado en el picker del bloqueo
function selectLockUser(name, hasPin) {
  if (hasPin) {
    showLockScreen('unlock', null, name);
  } else {
    // Sin PIN: cambiar directamente
    DB.switchUser(name);
    hideLockScreen();
    const nameEl = document.getElementById('dash-user-name');
    if (nameEl) nameEl.textContent = name;
    navigate('dashboard');
    showToast('👤 Bienvenido, ' + name, 1800);
  }
}

function showLockScreen(mode, action, targetUser) {
  _pinBuffer     = '';
  _pinMode       = mode;
  _pinAction     = action;
  // ⚠️ NO resetear _newPinTemp si vamos a confirm_new: contiene el primer PIN
  if (mode !== 'confirm_new') _newPinTemp = '';
  _pinTargetUser = targetUser || DB.getSettings().userName || 'Principal';

  const s      = DB.getSettings();
  const lockEl = document.getElementById('screen-lock');
  const picker  = document.getElementById('lock-user-picker');
  const pinArea = document.getElementById('lock-pin-area');

  document.getElementById('lock-company').textContent = s.companyName || 'ContaFácil Pro';
  document.getElementById('lock-msg').textContent =
    mode === 'confirm'     ? `🔐 Confirma tu PIN`         :
    mode === 'set'         ? `🔑 Elige tu PIN de 4 dígitos` :
    mode === 'confirm_new' ? '🔁 Repite el mismo PIN'      :
                             `🔒 PIN de ${_pinTargetUser}`;

  // Ocultar submsg secundario y área de recuperación
  const sub = document.getElementById('lock-submsg');
  if (sub) { sub.style.display = 'none'; sub.textContent = ''; }
  const recArea = document.getElementById('lock-recovery-area');
  if (recArea) recArea.style.display = 'none';

  // Botón "Olvidé mi PIN" — solo en unlock y si el usuario tiene código de recuperación
  const forgotBtn = document.getElementById('lock-forgot-btn');
  if (forgotBtn) {
    forgotBtn.style.display =
      (mode === 'unlock' && DB.userHasRecoveryCode(_pinTargetUser)) ? 'block' : 'none';
  }

  // Botón de retroceso/cancelar
  const backBtn = document.getElementById('lock-back-btn');
  if (backBtn) {
    const users = DB.getUserList();
    const multiUser = users.length > 1;
    if (mode === 'confirm_new') {
      backBtn.textContent = '← Volver a ingresar';
      backBtn.style.display = 'block';
    } else if (mode === 'set' || mode === 'confirm') {
      backBtn.textContent = '← Cancelar';
      backBtn.style.display = 'block';
    } else if (mode === 'unlock' && multiUser) {
      backBtn.textContent = '← Cambiar usuario';
      backBtn.style.display = 'block';
    } else {
      backBtn.style.display = 'none';
    }
  }

  // Mostrar numpad, ocultar picker
  if (picker)  picker.style.display  = 'none';
  if (pinArea) pinArea.style.display = 'flex';

  _updatePinDots();
  lockEl.style.display = 'flex';
}

function cancelPinEntry() {
  const users = DB.getUserList();
  if (_pinMode === 'confirm_new') {
    // Volver al primer paso del PIN
    _newPinTemp = '';
    showLockScreen('set', _pinAction, _pinTargetUser);
  } else if (_pinMode === 'unlock' && users.length > 1) {
    // Volver al selector de usuarios
    showUserPickerLock();
  } else {
    // Cancelar la acción y cerrar
    hideLockScreen();
    _pinAction  = null;
    _newPinTemp = '';
  }
}

function hideLockScreen() {
  document.getElementById('screen-lock').style.display = 'none';
  const sub = document.getElementById('lock-submsg');
  if (sub) { sub.style.display = 'none'; sub.textContent = ''; }
  _pinFailCount = 0; // resetear contador al cerrar exitosamente
  resetInactivityTimer();
}

function appendPinDigit(d) {
  // Verificar bloqueo por intentos fallidos
  if (_pinLockedUntil > Date.now()) {
    const segs = Math.ceil((_pinLockedUntil - Date.now()) / 1000);
    const msgEl = document.getElementById('lock-msg');
    if (msgEl) { msgEl.textContent = `⏳ Bloqueado ${segs}s`; msgEl.style.color = '#fca5a5'; }
    return;
  }
  if (_pinBuffer.length >= 4) return;
  _pinBuffer += String(d);
  _updatePinDots();
  if (_pinBuffer.length === 4) setTimeout(_processPinEntry, 180);
}

function deletePinDigit() {
  _pinBuffer = _pinBuffer.slice(0, -1);
  _updatePinDots();
}

function _updatePinDots() {
  document.querySelectorAll('.pin-dot').forEach((dot, i) => {
    dot.classList.toggle('filled', i < _pinBuffer.length);
    dot.style.transform = (i === _pinBuffer.length - 1 && _pinBuffer.length > 0) ? 'scale(1.3)' : 'scale(1)';
  });
}

async function _processPinEntry() {
  // Verificar si está bloqueado por intentos fallidos
  if (_pinLockedUntil > Date.now()) {
    _pinBuffer = '';
    _updatePinDots();
    return;
  }

  if (_pinMode === 'unlock') {
    // Verifica el PIN del usuario objetivo y lo activa
    const ok = await DB.verifyUserPin(_pinTargetUser, _pinBuffer);
    if (ok) {
      _pinFailCount = 0; // reset
      const current = DB.getSettings().userName || 'Principal';
      if (_pinTargetUser && _pinTargetUser !== current) {
        DB.switchUser(_pinTargetUser);
        const nameEl = document.getElementById('dash-user-name');
        if (nameEl) nameEl.textContent = _pinTargetUser;
        renderSettings();
      }
      DB.logAudit('login', `✅ Acceso: ${_pinTargetUser}`);
      hideLockScreen();
      if (_pinAction) { const fn = _pinAction; _pinAction = null; fn(); }
      else showToast('✅ Bienvenido, ' + _pinTargetUser, 1500);
    } else {
      _pinError('PIN incorrecto');
    }

  } else if (_pinMode === 'confirm') {
    // Verifica el PIN del usuario actual (sin cambiar de usuario)
    const ok = await DB.verifyUserPin(_pinTargetUser, _pinBuffer);
    if (ok) {
      _pinFailCount = 0; // reset
      hideLockScreen();
      if (_pinAction) { const fn = _pinAction; _pinAction = null; fn(); }
    } else {
      _pinError('PIN incorrecto');
    }

  } else if (_pinMode === 'set') {
    _newPinTemp = _pinBuffer;
    showLockScreen('confirm_new', _pinAction, _pinTargetUser);

  } else if (_pinMode === 'confirm_new') {
    if (_pinBuffer === _newPinTemp) {
      await DB.setUserPin(_pinTargetUser, _pinBuffer);
      // Generar código de recuperación y mostrarlo antes de cerrar
      const code = DB.generateRecoveryCode();
      await DB.setUserRecoveryCode(_pinTargetUser, code);
      hideLockScreen();
      renderSettings();
      if (_pinAction) { const fn = _pinAction; _pinAction = null; fn(); }
      // Mostrar el código de recuperación (IMPORTANTE: solo se ve una vez)
      _showRecoveryCodeModal(code, _pinTargetUser);
    } else {
      _newPinTemp = '';
      _pinError('Los PINs no coinciden.');
      setTimeout(() => showLockScreen('set', _pinAction, _pinTargetUser), 1200);
    }
  }
}

// Muestra el código de recuperación en un modal (solo al crear el PIN)
function _showRecoveryCodeModal(code, userName) {
  const overlay = document.createElement('div');
  overlay.id = 'recovery-modal';
  overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:10002;
    background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:24px;`;
  overlay.innerHTML = `
    <div style="background:white;border-radius:20px;padding:28px 24px;max-width:360px;width:100%;
      box-shadow:0 20px 60px rgba(0,0,0,.3);">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:44px;margin-bottom:10px;">🔑</div>
        <div style="font-size:18px;font-weight:900;color:#111;">Código de recuperación</div>
        <div style="font-size:12px;color:#6b7280;margin-top:6px;line-height:1.5;">
          Si olvidas tu PIN, este código te permitirá crear uno nuevo.<br>
          <strong style="color:#dc2626;">Guárdalo ahora — no se vuelve a mostrar.</strong>
        </div>
      </div>

      <!-- El código -->
      <div style="background:#f0f9ff;border:2px dashed #3b82f6;border-radius:14px;
        padding:18px;text-align:center;margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;color:#1e40af;letter-spacing:.5px;
          text-transform:uppercase;margin-bottom:8px;">Código de ${userName}</div>
        <div id="rc-code-display" style="font-size:28px;font-weight:900;color:#1e40af;
          letter-spacing:4px;font-family:monospace;">${code}</div>
      </div>

      <div style="background:#fef3c7;border-radius:10px;padding:12px;font-size:12px;
        color:#92400e;margin-bottom:20px;line-height:1.5;">
        📸 Toma una captura de pantalla o anótalo en un lugar seguro.
        No lo compartas con nadie.
      </div>

      <button onclick="
        navigator.clipboard?.writeText('${code}').catch(()=>{});
        this.textContent='✅ ¡Copiado!';
        this.style.background='#d1fae5';
        this.style.color='#065f46';
        this.style.borderColor='#6ee7b7';
      " style="width:100%;padding:12px;border:2px solid #3b82f6;border-radius:12px;
        background:#eff6ff;color:#1e40af;font-size:14px;font-weight:700;
        cursor:pointer;margin-bottom:10px;">
        📋 Copiar código
      </button>

      <button onclick="document.getElementById('recovery-modal').remove();"
        style="width:100%;padding:12px;border:none;border-radius:12px;
          background:#111827;color:white;font-size:14px;font-weight:700;cursor:pointer;">
        ✅ Ya guardé mi código
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
}

// Abre el flujo de recuperación de PIN (botón "Olvidé mi PIN")
function openForgotPin() {
  const lockEl  = document.getElementById('screen-lock');
  const pinArea = document.getElementById('lock-pin-area');
  const picker  = document.getElementById('lock-user-picker');
  const sub     = document.getElementById('lock-submsg');
  const recArea = document.getElementById('lock-recovery-area');

  if (pinArea)  pinArea.style.display  = 'none';
  if (picker)   picker.style.display   = 'none';
  if (recArea)  recArea.style.display  = 'flex';
  if (sub) { sub.style.display = 'none'; }

  document.getElementById('lock-msg').textContent = '🔑 Código de recuperación';
  document.getElementById('lock-company').textContent =
    DB.getSettings().companyName || 'ContaFácil Pro';

  const input = document.getElementById('lock-recovery-input');
  if (input) { input.value = ''; setTimeout(() => input.focus(), 200); }
}

async function submitRecoveryCode() {
  const input = document.getElementById('lock-recovery-input');
  const code  = input?.value?.trim();
  if (!code || code.length < 11) { showToast('⚠️ Ingresa el código completo (ej: AB3D-EF7G-HI9J)', 2500); return; }

  const ok = await DB.verifyRecoveryCode(_pinTargetUser, code);
  if (ok) {
    // Código correcto: cerrar recuperación y pedir nuevo PIN
    const recArea = document.getElementById('lock-recovery-area');
    if (recArea) recArea.style.display = 'none';
    showLockScreen('set', null, _pinTargetUser);
    showToast('✅ Código correcto. Elige tu nuevo PIN.', 2500);
  } else {
    showToast('❌ Código incorrecto. Verifica y vuelve a intentar.', 3000);
    if (input) { input.style.borderColor = '#dc2626'; setTimeout(() => { input.style.borderColor = ''; }, 1500); }
  }
}

function closeRecoveryArea() {
  const recArea = document.getElementById('lock-recovery-area');
  const pinArea = document.getElementById('lock-pin-area');
  if (recArea) recArea.style.display = 'none';
  if (pinArea) {
    pinArea.style.display = 'flex';
    document.getElementById('lock-msg').textContent = `🔒 PIN de ${_pinTargetUser}`;
  }
}

function _pinError(msg, isLockout) {
  _pinFailCount++;
  const msgEl = document.getElementById('lock-msg');
  const prev  = msgEl.textContent;

  let displayMsg = '❌ ' + msg;
  let lockDuration = 0;

  if (!isLockout) {
    const remaining = 3 - _pinFailCount;
    if (_pinFailCount >= 3) {
      // Bloqueo progresivo: 30s, 60s, 120s, 240s (máx)
      lockDuration = Math.min(30 * Math.pow(2, _pinFailCount - 3), 240) * 1000;
      _pinLockedUntil = Date.now() + lockDuration;
      const segs = lockDuration / 1000;
      displayMsg = `🔴 Bloqueado ${segs}s por intentos fallidos`;
    } else {
      displayMsg = `❌ PIN incorrecto · ${remaining} intento${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}`;
    }
  }

  msgEl.textContent = displayMsg;
  msgEl.style.color = '#fca5a5';

  const dots = document.getElementById('pin-dots');
  dots.style.animation = 'pinShake .4s ease';

  const delay = lockDuration > 0 ? lockDuration : 900;
  setTimeout(() => {
    dots.style.animation = '';
    _pinBuffer = '';
    _updatePinDots();
    if (!lockDuration) {
      msgEl.textContent = prev;
      msgEl.style.color = '';
    } else {
      // Mientras está bloqueado mostrar cuenta regresiva
      _startLockCountdown(msgEl, prev);
    }
  }, lockDuration > 0 ? 400 : 900);
}

function _startLockCountdown(msgEl, prevMsg) {
  const tick = () => {
    const left = _pinLockedUntil - Date.now();
    if (left <= 0) {
      msgEl.textContent = prevMsg;
      msgEl.style.color = '';
      return;
    }
    msgEl.textContent = `⏳ Bloqueado ${Math.ceil(left/1000)}s`;
    msgEl.style.color = '#fca5a5';
    setTimeout(tick, 500);
  };
  tick();
}

// Pide PIN si está configurado; si no, ejecuta la acción directamente
function requirePin(action) {
  const currentUser = DB.getSettings().userName || 'Principal';
  if (!DB.userHasPin(currentUser)) { action(); return; }
  showLockScreen('confirm', action, currentUser);
}

// Pide siempre el PIN del PROPIETARIO, sin importar quién esté activo.
// Usar para exportación PDF/Excel (solo el propietario puede).
function requireOwnerPin(action) {
  const users   = DB.getUserList();
  const owner   = users.find(u => u.isOwner);
  if (!owner) { action(); return; } // sin propietario definido, pasar

  const currentUser = DB.getSettings().userName || 'Principal';
  const isOwner     = owner.name === currentUser;

  if (!owner.pinHash) {
    // El propietario no tiene PIN: si es el owner, ejecutar; si no, rechazar
    if (isOwner) { action(); return; }
    showToast('⚠️ Solo el propietario puede exportar. Pídele que configure un PIN primero.', 4000);
    return;
  }

  if (isOwner) {
    // El usuario activo ES el propietario: pedir su propio PIN
    showLockScreen('confirm', action, owner.name);
  } else {
    // Usuario no-propietario: pedir el PIN del propietario
    // Mostramos mensaje explicativo en la pantalla de bloqueo
    _pinAction     = action;
    _pinMode       = 'confirm';
    _pinTargetUser = owner.name;
    _pinBuffer     = '';
    _newPinTemp    = '';

    const s      = DB.getSettings();
    const lockEl = document.getElementById('screen-lock');
    const picker = document.getElementById('lock-user-picker');
    const pinArea = document.getElementById('lock-pin-area');

    document.getElementById('lock-company').textContent = s.companyName || 'ContaFácil Pro';
    document.getElementById('lock-msg').textContent     = '🏢 Exportación restringida';

    // Mensaje secundario explicativo
    const sub = document.getElementById('lock-submsg');
    if (sub) {
      sub.textContent     = `Solo el propietario puede descargar archivos.\nIngresa el PIN de: ${owner.name}`;
      sub.style.display   = 'block';
      sub.style.whiteSpace = 'pre-line';
    }

    if (picker)  picker.style.display  = 'none';
    if (pinArea) pinArea.style.display = 'flex';
    _updatePinDots();
    lockEl.style.display = 'flex';
  }
}

// ── Roles / permisos ─────────────────────────────────────────────────────────
function isCurrentUserOwner() {
  const users   = DB.getUserList();
  const current = DB.getSettings().userName || 'Principal';
  return users.some(u => u.isOwner && u.name === current);
}

function isCurrentUserReadOnly() {
  const current = DB.getSettings().userName || 'Principal';
  return DB.isUserReadOnly(current);
}

function toggleUserScreen(userName, screen) {
  const allowed  = DB.getUserAllowedScreens(userName);
  const isOn     = allowed.includes(screen);
  const updated  = isOn
    ? allowed.filter(s => s !== screen && s !== 'dashboard') // dashboard siempre queda
    : [...allowed, screen];
  // Asegurar dashboard siempre incluido
  if (!updated.includes('dashboard')) updated.unshift('dashboard');
  DB.setUserAllowedScreens(userName, updated);
  openSecuritySettings(); // refrescar UI
}

// Restaura acceso completo a un usuario (elimina restricciones)
function resetUserPermissions(userName) {
  DB.setUserAllowedScreens(userName, null); // null = sin restricciones = acceso total
  showToast('✅ Acceso completo restaurado a ' + userName, 2000);
  openSecuritySettings();
}

// Pantallas bloqueadas para usuarios de solo-lectura (legacy, ahora usa allowedScreens)
const READONLY_BLOCKED_SCREENS = ['reports', 'settings'];

// ── Auto-bloqueo por inactividad ──────────────────────────────────────────────
function _getInactivityMs() {
  const mins = DB.getSettings().inactivityMinutes || 5;
  return mins * 60 * 1000;
}

function resetInactivityTimer() {
  clearTimeout(_inactivityTimer);
  const s = DB.getSettings();
  const currentUser = s.userName || 'Principal';
  if (!DB.userHasPin(currentUser)) return; // sin PIN, no bloquear
  _inactivityTimer = setTimeout(() => {
    const lockEl = document.getElementById('screen-lock');
    if (lockEl && lockEl.style.display !== 'none') return; // ya bloqueado
    if (document.getElementById('screen-onboarding')?.classList.contains('active')) return;
    showLockScreen('unlock', null, currentUser);
    showToast('🔒 Sesión bloqueada por inactividad', 2500);
  }, _getInactivityMs());
}

// ── Configuración de seguridad ────────────────────────────────────────────────
function openSecuritySettings() {
  const sec         = DB.getSecuritySettings();
  const s           = DB.getSettings();
  const currentUser = s.userName || 'Principal';
  const pinSet      = DB.userHasPin(currentUser);
  const userEntry   = DB.getUserEntry(currentUser);
  const isOwner     = !!(userEntry && userEntry.isOwner);
  const users       = DB.getUserList();

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">🔐 Seguridad</h3>

    <!-- Usuario actual -->
    <div style="background:var(--gray-50); border-radius:12px; padding:12px 16px; margin-bottom:14px;
      display:flex; align-items:center; gap:10px;">
      <div style="font-size:26px;">${isOwner ? '👑' : '👤'}</div>
      <div>
        <div style="font-size:13px; font-weight:800;">${currentUser}</div>
        <div style="font-size:11px; color:var(--gray-400);">
          ${isOwner ? 'Propietario de la empresa' : 'Usuario registrado'}
        </div>
      </div>
    </div>

    <!-- Estado PIN del usuario actual -->
    <div style="background:${pinSet ? '#f0fdf4' : '#fff7ed'}; border-radius:12px; padding:14px 16px; margin-bottom:14px;
      border:1.5px solid ${pinSet ? '#86efac' : '#fdba74'}; display:flex; align-items:center; gap:12px;">
      <div style="font-size:30px;">${pinSet ? '🔒' : '🔓'}</div>
      <div style="flex:1;">
        <div style="font-size:14px; font-weight:800; color:${pinSet ? '#166534' : '#9a3412'};">
          ${pinSet ? 'Tu PIN está activo' : 'Sin PIN configurado'}
        </div>
        <div style="font-size:11px; color:var(--gray-500); margin-top:2px;">
          ${pinSet ? 'Solo tú puedes entrar con tu PIN.' : 'Configura un PIN para proteger tu acceso.'}
        </div>
      </div>
    </div>

    <!-- Botones de PIN del usuario actual -->
    ${pinSet ? `
      <button class="btn btn-outline btn-block mb-8"
        onclick="closeSettingsSheet(); setTimeout(()=>requirePin(()=>showLockScreen('set', null, '${currentUser}')),200)">
        🔑 Cambiar mi PIN
      </button>
      <button class="btn btn-danger btn-block mb-14"
        onclick="closeSettingsSheet(); setTimeout(()=>requirePin(()=>{ DB.removeUserPin('${currentUser}'); showToast('🔓 PIN eliminado'); renderSettings(); }),200)">
        🔓 Eliminar mi PIN
      </button>
    ` : `
      <button class="btn btn-primary btn-block mb-14"
        onclick="closeSettingsSheet(); setTimeout(()=>showLockScreen('set', ()=>{ renderSettings(); }, '${currentUser}'),200)">
        🔒 Configurar mi PIN
      </button>
    `}

    ${users.length > 1 && isOwner ? `
    <!-- Gestión de usuarios (solo propietario) -->
    <div style="border-top:1px solid var(--gray-100); padding-top:14px; margin-bottom:14px;">
      <div style="font-size:11px; font-weight:700; color:var(--gray-500); text-transform:uppercase;
        letter-spacing:.5px; margin-bottom:10px;">🏢 Permisos de usuarios</div>
      ${users.filter(u => !u.isOwner).map(u => `
        <div style="background:var(--white); border:1.5px solid var(--gray-100); border-radius:12px;
          padding:12px 14px; margin-bottom:10px;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
            <div style="font-size:20px;">👤</div>
            <div style="flex:1;">
              <div style="font-size:13px; font-weight:700;">${u.name}</div>
              <div style="font-size:11px; color:var(--gray-400);">${u.pinHash ? '🔒 Tiene PIN' : '🔓 Sin PIN'}</div>
            </div>
            ${u.pinHash ? `
              <button class="btn btn-outline" style="font-size:11px; padding:5px 10px;"
                onclick="closeSettingsSheet(); setTimeout(()=>requirePin(()=>{ DB.removeUserPin('${u.name}'); showToast('🔓 PIN de ${u.name} eliminado'); openSecuritySettings(); }),200)">
                Quitar PIN
              </button>
            ` : ''}
          </div>
          <!-- Permisos de secciones (granular) -->
          <div style="background:var(--gray-50); border-radius:8px; padding:10px 12px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
              <div style="font-size:11px; font-weight:700; color:var(--gray-600);">📋 Secciones permitidas</div>
              ${(() => {
                const uAllowed = DB.getUserAllowedScreens(u.name);
                const hasRestriction = u.allowedScreens && Array.isArray(u.allowedScreens);
                return hasRestriction
                  ? `<button onclick="resetUserPermissions('${u.name}')"
                      style="font-size:10px; font-weight:700; padding:3px 8px; border-radius:20px;
                        background:#dcfce7; color:#166534; border:1.5px solid #86efac; cursor:pointer;">
                      ✅ Restablecer todo
                    </button>`
                  : '';
              })()}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${[
                { key:'dashboard', icon:'🏠', label:'Inicio'    },
                { key:'journal',   icon:'📒', label:'Diario'    },
                { key:'inventory', icon:'📦', label:'Inventario'},
                { key:'cartera',   icon:'💳', label:'Cartera'   },
                { key:'assets',    icon:'🏭', label:'Activos'   },
                { key:'reports',   icon:'📊', label:'Reportes'  },
                { key:'settings',  icon:'⚙️', label:'Ajustes'   },
              ].map(sc => {
                const allowed   = DB.getUserAllowedScreens(u.name);
                const isAllowed = allowed.includes(sc.key);
                // dashboard siempre permitido
                const fixed = sc.key === 'dashboard';
                return `
                  <button ${fixed ? 'disabled' : `onclick="toggleUserScreen('${u.name}','${sc.key}')"`}
                    style="padding:5px 10px; border-radius:20px; font-size:11px; font-weight:700;
                      border:1.5px solid ${isAllowed ? 'var(--primary)' : 'var(--gray-200)'};
                      background:${isAllowed ? 'var(--primary-light)' : 'var(--white)'};
                      color:${isAllowed ? 'var(--primary)' : 'var(--gray-400)'};
                      cursor:${fixed ? 'default' : 'pointer'}; opacity:${fixed ? '.6' : '1'};">
                    ${sc.icon} ${sc.label}
                  </button>`;
              }).join('')}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    ` : ''}

    <!-- Auto-bloqueo por inactividad -->
    <div style="background:var(--gray-50); border-radius:12px; padding:14px 16px; margin-bottom:14px;">
      <div style="font-size:14px; font-weight:700; margin-bottom:4px;">⏰ Auto-bloqueo por inactividad</div>
      <div style="font-size:11px; color:var(--gray-400); margin-bottom:10px;">
        La app se bloquea sola si no la usas por el tiempo elegido
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        ${[1, 2, 5, 10, 15, 30].map(m => {
          const current = s.inactivityMinutes || 5;
          const active  = current === m;
          return `<button onclick="DB.updateSettings({inactivityMinutes:${m}}); resetInactivityTimer(); openSecuritySettings();"
            style="padding:6px 14px; border-radius:20px; font-size:12px; font-weight:700; border:2px solid ${active ? 'var(--primary)' : 'var(--gray-200)'};
              background:${active ? 'var(--primary)' : 'var(--white)'}; color:${active ? 'white' : 'var(--gray-600)'}; cursor:pointer;">
            ${m}min
          </button>`;
        }).join('')}
      </div>
    </div>

    <!-- Exportación cifrada AES-256 -->
    <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe); border-radius:12px; padding:14px 16px; border:1.5px solid #bfdbfe;">
      <div style="font-size:14px; font-weight:800; color:#1e40af; margin-bottom:6px;">🔐 Sincronización cifrada AES-256</div>
      <div style="font-size:12px; color:#1e3a8a; line-height:1.6; margin-bottom:12px;">
        Exporta tu registro con cifrado militar. Nadie puede leerlo sin la contraseña.
      </div>
      <button class="btn btn-block" style="background:var(--primary); color:white;"
        onclick="closeSettingsSheet(); setTimeout(()=>openEncryptedExportSheet(),200)">
        🔐 Exportar registro cifrado
      </button>
    </div>

    <button class="btn btn-secondary btn-block mt-16" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function toggleExportPin() {
  const sec = DB.getSecuritySettings();
  if (!sec.requirePinForExport && !DB.isPinSet()) {
    showToast('⚠️ Primero configura un PIN', 2500); return;
  }
  const newVal = !sec.requirePinForExport;
  DB.setExportPin(newVal);
  document.getElementById('exp-pin-track').style.background = newVal ? 'var(--primary)' : 'var(--gray-200)';
  document.getElementById('exp-pin-thumb').style.left = newVal ? '23px' : '3px';
  showToast(newVal ? '🔐 PIN requerido para exportar' : '🔓 Exportación libre', 2000);
  renderSettings();
}

// ── Exportación cifrada (AES-256-GCM) ────────────────────────────────────────
function openEncryptedExportSheet() {
  const s = DB.getSettings();
  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">🔐 Exportar Registro Cifrado</h3>

    <div style="background:var(--primary-light); border-radius:10px; padding:14px; margin-bottom:14px; font-size:13px; color:var(--primary); line-height:1.7;">
      <strong>Cifrado AES-256-GCM</strong> — El archivo es completamente ilegible sin la contraseña.<br><br>
      1️⃣ Pon una contraseña segura<br>
      2️⃣ Envía el archivo por WhatsApp, email o USB<br>
      3️⃣ En el otro dispositivo: <strong>Importar → detecta el cifrado → pide contraseña</strong>
    </div>

    <div class="form-group">
      <label class="form-label">Contraseña de cifrado</label>
      <input type="password" class="form-control" id="enc-pass-1"
        placeholder="Mínimo 4 caracteres" autocomplete="new-password">
    </div>
    <div class="form-group">
      <label class="form-label">Repetir contraseña</label>
      <input type="password" class="form-control" id="enc-pass-2"
        placeholder="Igual que arriba" autocomplete="new-password">
    </div>

    <div style="font-size:11px; color:var(--gray-400); line-height:1.5; margin-bottom:16px;">
      💡 Usa la misma contraseña en ambos dispositivos. Si la pierdes, no hay forma de recuperar el archivo.
    </div>

    <button class="btn btn-primary btn-block" onclick="doEncryptedExport()">
      🔐 Cifrar y descargar
    </button>
    <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet()">Cancelar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

async function doEncryptedExport() {
  const p1 = document.getElementById('enc-pass-1')?.value;
  const p2 = document.getElementById('enc-pass-2')?.value;
  if (!p1 || p1.length < 4) { showToast('⚠️ Contraseña mínimo 4 caracteres'); return; }
  if (p1 !== p2)             { showToast('⚠️ Las contraseñas no coinciden');    return; }

  showToast('⏳ Cifrando datos...', 8000);
  try {
    const encrypted = await DB.exportForSyncEncrypted(p1);
    const s    = DB.getSettings();
    const blob = new Blob([encrypted], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    const safe = (s.userName || 'registro').replace(/[^a-zA-Z0-9]/g, '-');
    a.href     = url;
    a.download = `contafacil-cifrado-${safe}-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    closeSettingsSheet();
    showToast('🔐 Archivo cifrado descargado. ¡Guarda la contraseña!', 4000);
  } catch (e) {
    showToast('❌ Error al cifrar: ' + e.message, 3000);
  }
}

// ── Importación cifrada — detectada automáticamente ──────────────────────────
function openEncryptedImportSheet() {
  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>

    <div style="text-align:center; padding:16px 0 20px;">
      <div style="font-size:52px; margin-bottom:12px;">🔐</div>
      <div style="font-size:18px; font-weight:800; color:var(--gray-900);">Archivo cifrado</div>
      <div style="font-size:13px; color:var(--gray-500); margin-top:6px; line-height:1.5;">
        Este archivo está protegido con contraseña.<br>Ingresa la contraseña para importar los datos.
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Contraseña del archivo</label>
      <input type="password" class="form-control" id="import-enc-pass"
        placeholder="Contraseña de cifrado" autocomplete="current-password"
        onkeydown="if(event.key==='Enter') doDecryptImport()">
    </div>

    <button class="btn btn-primary btn-block mt-8" onclick="doDecryptImport()">
      🔓 Descifrar e importar
    </button>
    <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet(); _encImportPending=null;">
      Cancelar
    </button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

async function doDecryptImport() {
  const pass = document.getElementById('import-enc-pass')?.value;
  if (!pass) { showToast('⚠️ Ingresa la contraseña'); return; }
  showToast('⏳ Descifrando...', 8000);
  try {
    const result = await DB.importFromUserDecrypted(_encImportPending, pass);
    _encImportPending = null;
    closeSettingsSheet();
    const msg = result.addedTxs === 0
      ? `✅ Ya estaban importados (${result.sourceUser})`
      : `✅ ${result.addedTxs} registros de ${result.sourceUser} importados`;
    showToast(msg, 4000);
    renderDashboard();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Contraseña incorrecta'), 3000);
  }
}

// ── Resumen de hoy ────────────────────────────────────────────────────────────
function renderTodaySummary() {
  const el = document.getElementById('dash-today');
  if (!el) return;

  const todayStr = today();
  const txs = DB.getTransactions().filter(t => !t.isCogs && !t.isIva && t.date === todayStr);

  if (!txs.length) { el.style.display = 'none'; return; }

  const income  = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const liab    = txs.filter(t => t.type === 'liability').reduce((s, t) => s + t.amount, 0);
  const net     = income - expense;
  const netColor = net >= 0 ? 'var(--success)' : 'var(--danger)';
  const netSign  = net >= 0 ? '+' : '';

  const dateLabel = new Date().toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  const preview = txs.slice(0, 4);
  const hasMore = txs.length > 4;

  // Fila compacta por transacción
  const txRow = t => {
    const cat   = DB.getCategoryById(t.category);
    const emoji = cat ? cat.emoji : { income:'💰', expense:'💸', liability:'🔴', transfer:'↔️' }[t.type] || '💰';
    const color = { income:'var(--success)', expense:'var(--danger)', liability:'var(--warning)', transfer:'var(--primary)' }[t.type] || 'var(--gray-700)';
    const sign  = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
    return `
      <div class="today-tx-row" data-tx-id="${t.id}">
        <span style="font-size:19px; flex-shrink:0;">${emoji}</span>
        <span class="today-tx-desc">${escHtml(t.description)}</span>
        <span style="font-size:13px; font-weight:700; color:${color}; flex-shrink:0;">${sign}${fmt(t.amount)}</span>
      </div>`;
  };

  el.style.display = 'block';
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px; padding:14px 16px 8px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div style="font-size:13px; font-weight:800; color:var(--gray-700); text-transform:capitalize;">
          📅 ${escHtml(dateLabel)}
        </div>
        <button onclick="journalDateFilter='today'; navigate('journal');"
          style="font-size:12px; color:var(--primary); font-weight:600; background:none;">
          Ver todo →
        </button>
      </div>

      <!-- KPIs del día -->
      <div style="display:flex; gap:6px; margin-bottom:12px;">
        ${income > 0 ? `
        <div style="flex:1; background:var(--success-light); border-radius:8px; padding:8px 6px; text-align:center;">
          <div style="font-size:10px; color:var(--success); font-weight:700; text-transform:uppercase; margin-bottom:2px;">💰 Ingresos</div>
          <div style="font-size:14px; font-weight:800; color:var(--success);">+${fmt(income)}</div>
        </div>` : ''}
        ${expense > 0 ? `
        <div style="flex:1; background:var(--danger-light); border-radius:8px; padding:8px 6px; text-align:center;">
          <div style="font-size:10px; color:var(--danger); font-weight:700; text-transform:uppercase; margin-bottom:2px;">💸 Gastos</div>
          <div style="font-size:14px; font-weight:800; color:var(--danger);">−${fmt(expense)}</div>
        </div>` : ''}
        ${liab > 0 ? `
        <div style="flex:1; background:#fff7ed; border-radius:8px; padding:8px 6px; text-align:center;">
          <div style="font-size:10px; color:var(--warning); font-weight:700; text-transform:uppercase; margin-bottom:2px;">🔴 Deudas</div>
          <div style="font-size:14px; font-weight:800; color:var(--warning);">${fmt(liab)}</div>
        </div>` : ''}
        ${income > 0 && expense > 0 ? `
        <div style="flex:1; background:var(--gray-50); border-radius:8px; padding:8px 6px; text-align:center;">
          <div style="font-size:10px; color:var(--gray-500); font-weight:700; text-transform:uppercase; margin-bottom:2px;">📊 Neto</div>
          <div style="font-size:14px; font-weight:800; color:${netColor};">${netSign}${fmt(net)}</div>
        </div>` : ''}
      </div>

      <!-- Lista de transacciones del día -->
      <div style="border-top:1px solid var(--gray-100); margin:0 -16px; padding:0 16px;">
        ${preview.map(txRow).join('')}
        ${hasMore ? `
          <button onclick="journalDateFilter='today'; navigate('journal');"
            style="display:block; width:100%; text-align:center; padding:9px 0; font-size:13px;
              color:var(--primary); font-weight:600; background:none; border-top:1px solid var(--gray-100);">
            +${txs.length - 4} movimientos más →
          </button>` : ''}
      </div>
    </div>
  `;

  // Click en fila → abre detalle
  el.querySelectorAll('[data-tx-id]').forEach(row =>
    row.addEventListener('click', () => openTxDetail(row.dataset.txId))
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const stats   = DB.getMonthStats(y, m);
  const all     = DB.getAllTimeBalance();
  const s       = DB.getSettings();
  // Solo deudas REALES — el IVA por pagar no es una deuda del negocio (va en Reportes)
  const pending = DB.getPendingLiabilities().filter(t => !t.isIva);

  document.getElementById('dash-company').textContent  = s.companyName;
  // Badge multi-empresa en el header
  const coList  = DB.getCompanyList();
  const coBadge = document.getElementById('dash-company-badge');
  if (coBadge) {
    if (coList.length > 1) {
      coBadge.style.display = 'inline';
      coBadge.textContent   = coList.length + ' 🏢';
    } else {
      coBadge.style.display = 'none';
    }
  }
  document.getElementById('dash-balance').textContent  = fmt(all.netProfit);
  const userBtn = document.getElementById('dash-user-name');
  if (userBtn) userBtn.textContent = s.userName || 'Principal';
  document.getElementById('dash-income').textContent   = fmt(stats.income);
  document.getElementById('dash-expense').textContent  = fmt(stats.opExpenses);
  document.getElementById('dash-month').textContent    =
    new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  // Utilidad neta del mes
  const netEl = document.getElementById('dash-net');
  netEl.textContent = (stats.netProfit >= 0 ? '+' : '') + fmt(stats.netProfit);
  netEl.style.color = 'white';

  // Comparativa vs mes anterior
  const prevM    = m === 1 ? 12 : m - 1;
  const prevY    = m === 1 ? y - 1 : y;
  const prevStats = DB.getMonthStats(prevY, prevM);
  const prevLbl  = new Date(prevY, prevM - 1, 1).toLocaleDateString('es-CO', { month: 'short' });
  const _setCmp  = (id, cur, prev, inv = false) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = _cmpHeroBadge(cur, prev, inv) +
      (prev > 0 || cur > 0 ? `<span style="opacity:.45;"> vs ${prevLbl}.</span>` : '');
  };
  _setCmp('dash-net-cmp',     stats.netProfit,  prevStats.netProfit);
  _setCmp('dash-income-cmp',  stats.income,     prevStats.income);
  _setCmp('dash-expense-cmp', stats.opExpenses, prevStats.opExpenses, true);

  // Panel de CMV del mes (solo si hay COGS)
  const cogsPanel = document.getElementById('dash-cogs-panel');
  if (cogsPanel) {
    if (stats.cogs > 0) {
      cogsPanel.style.display = 'block';
      document.getElementById('dash-cogs-val').textContent     = fmt(stats.cogs);
      document.getElementById('dash-gross-val').textContent    = (stats.grossProfit >= 0 ? '+' : '') + fmt(stats.grossProfit);
      document.getElementById('dash-gross-val').style.color    = stats.grossProfit >= 0 ? 'var(--success)' : 'var(--danger)';
    } else {
      cogsPanel.style.display = 'none';
    }
  }

  // Banner modo solo-lectura
  const roEl = document.getElementById('dash-readonly-banner');
  if (roEl) roEl.style.display = isCurrentUserReadOnly() ? 'flex' : 'none';

  // Insignia de deudas en la esquina del rectángulo de Utilidad Neta
  // (toca para ver el desglose — sin banner que estrese al usuario)
  const debtBadge = document.getElementById('dash-debt-badge');
  const debtShown = pending.length > 0;
  if (debtBadge) {
    debtBadge.style.display = debtShown ? 'flex' : 'none';
    if (debtShown) {
      const cEl = document.getElementById('dash-debt-count');
      if (cEl) cEl.textContent = pending.length;
    }
  }

  // Insignia de cobros (cartera) — justo debajo de la de deudas
  const cobros = DB.getReceivables().filter(r => {
    const paid = (r.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    return (r.totalAmount || 0) - paid > 0.005;
  });
  const carteraBadge = document.getElementById('dash-cartera-badge');
  if (carteraBadge) {
    if (cobros.length) {
      carteraBadge.style.display = 'flex';
      carteraBadge.style.top = debtShown ? '46px' : '12px'; // debajo de deudas, o arriba si no hay
      const cEl = document.getElementById('dash-cartera-count');
      if (cEl) cEl.textContent = cobros.length;
    } else {
      carteraBadge.style.display = 'none';
    }
  }

  // Últimas 5 transacciones (excluir asientos auto-generados de CMV e IVA)
  const txs = DB.getTransactions().filter(t => !t.isCogs && !t.isIva).slice(0, 5);
  const recentEl = document.getElementById('dash-recent');
  recentEl.innerHTML = txs.length
    ? `<ul class="tx-list">${txs.map(txItemHTML).join('')}</ul>`
    : emptyHTML('📭', 'Sin movimientos', 'Toca + para agregar tu primera transacción');

  // Saldo por cuenta bancaria
  renderAccountBalances();

  // Alertas de presupuesto excedido
  renderBudgetAlerts();

  // Alertas de stock mínimo
  renderStockAlerts();

  // Chip de cartera con monto pendiente
  const carteraStats = DB.getReceivableStats();
  const chipVal = document.getElementById('dash-cartera-chip-val');
  if (chipVal && carteraStats.totalPendiente > 0) {
    chipVal.textContent = fmt(carteraStats.totalPendiente);
  } else if (chipVal) {
    chipVal.textContent = 'Cobrar';
  }

  // Chip de activos fijos con cantidad registrada
  const assetsChip = document.getElementById('dash-assets-chip-val');
  if (assetsChip) {
    const at = DB.getFixedAssetsTotals();
    assetsChip.textContent = at.count > 0 ? at.count + (at.count === 1 ? ' activo' : ' activos') : '+ Añadir';
  }

  // Resumen del día (visible solo si hay actividad hoy)
  renderTodaySummary();

  // Panel unificado de vencimientos (pagos recurrentes + cobros CxC)
  renderUpcomingAlerts();
}

// ── Comparativa mes anterior ──────────────────────────────────────────────────
// Devuelve HTML para un badge de comparativa (fondo hero oscuro)
function _cmpHeroBadge(cur, prev, lowerIsBetter = false) {
  if (prev === 0 && cur === 0) return '';
  if (prev === 0) return `<span style="opacity:.55;">—</span>`;
  const pct  = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (Math.abs(pct) < 1) return `<span style="opacity:.55;">≈ igual</span>`;
  const up    = pct > 0;
  const good  = lowerIsBetter ? !up : up;
  const color = good ? 'rgba(134,239,172,.9)' : 'rgba(252,165,165,.9)';
  return `<span style="color:${color};">${up ? '↑' : '↓'} ${up ? '+' : ''}${pct}%</span>`;
}

// Devuelve HTML de una píldora de comparativa para la tarjeta de Reportes
function _cmpPill(label, cur, prev, lowerIsBetter = false, prevLbl = '') {
  if (prev === 0 && cur === 0) return '';
  const noData = prev === 0;
  let arrow = '—', pctStr = '', color = 'var(--gray-400)';
  if (!noData) {
    const pct  = Math.round(((cur - prev) / Math.abs(prev)) * 100);
    const up   = pct > 0;
    const good = lowerIsBetter ? !up : up;
    const noChange = Math.abs(pct) < 1;
    arrow   = noChange ? '≈' : (up ? '↑' : '↓');
    pctStr  = noChange ? 'igual' : `${up ? '+' : ''}${pct}%`;
    color   = noChange ? 'var(--gray-400)' : (good ? 'var(--success)' : 'var(--danger)');
  }
  return `
    <div style="flex:1; background:var(--gray-50); border-radius:10px; padding:10px 8px; text-align:center;">
      <div style="font-size:10px; color:var(--gray-500); font-weight:700; margin-bottom:5px;">${label}</div>
      <div style="font-size:22px; color:${color}; line-height:1;">${arrow}</div>
      <div style="font-size:13px; font-weight:800; color:${color}; margin-top:3px;">${pctStr || '—'}</div>
      ${prevLbl ? `<div style="font-size:10px; color:var(--gray-400); margin-top:3px;">vs ${prevLbl}</div>` : ''}
    </div>`;
}

// ── Búsqueda global ───────────────────────────────────────────────────────────
let _gsTimeout = null;

function globalSearchInput(q) {
  const clearBtn = document.getElementById('dash-search-clear');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
  clearTimeout(_gsTimeout);
  if (!q.trim()) {
    const res = document.getElementById('dash-search-results');
    if (res) res.style.display = 'none';
    return;
  }
  _gsTimeout = setTimeout(() => _runGlobalSearch(q.trim()), 200);
}

function clearGlobalSearch() {
  const inp = document.getElementById('dash-search-input');
  if (inp) inp.value = '';
  const clearBtn = document.getElementById('dash-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  const res = document.getElementById('dash-search-results');
  if (res) res.style.display = 'none';
}

function _highlight(text, q) {
  if (!q || !text) return escHtml(text || '');
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return escHtml(text);
  return escHtml(text.slice(0, idx)) +
    `<mark style="background:#fef08a;border-radius:3px;padding:0 2px;">${escHtml(text.slice(idx, idx + q.length))}</mark>` +
    escHtml(text.slice(idx + q.length));
}

function _runGlobalSearch(q) {
  const qLow = q.toLowerCase();
  const sections = [];

  // ── Transacciones ──────────────────────────────────────
  const txs = DB.getTransactions()
    .filter(t => !t.isCogs && !t.isIva)
    .filter(t =>
      t.description.toLowerCase().includes(qLow) ||
      (t.notes     || '').toLowerCase().includes(qLow) ||
      (t.creditor  || '').toLowerCase().includes(qLow) ||
      (t.proveedor || '').toLowerCase().includes(qLow)
    ).slice(0, 7);
  if (txs.length) sections.push({ label: '📋 Transacciones', items: txs.map(t => {
    const cat   = DB.getCategoryById(t.category);
    const emoji = cat ? cat.emoji : { income:'💰', expense:'💸', liability:'🔴', transfer:'↔️' }[t.type] || '💰';
    const color = { income:'var(--success)', expense:'var(--danger)', liability:'var(--warning)', transfer:'var(--primary)' }[t.type];
    const sign  = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '';
    return `<div class="gs-item" onclick="clearGlobalSearch(); openTxDetail('${t.id}')">
      <span class="gs-icon">${emoji}</span>
      <div class="gs-body">
        <div class="gs-title">${_highlight(t.description, q)}</div>
        <div class="gs-sub">${fmtDate(t.date)}${cat ? ' · ' + cat.name : ''}</div>
      </div>
      <span class="gs-amt" style="color:${color};">${sign}${fmt(t.amount)}</span>
    </div>`;
  })});

  // ── Cartera (CxC) ──────────────────────────────────────
  const cobros = DB.getReceivables()
    .filter(r =>
      (r.clientName  || '').toLowerCase().includes(qLow) ||
      (r.description || '').toLowerCase().includes(qLow)
    ).slice(0, 4);
  if (cobros.length) sections.push({ label: '🧾 Cartera', items: cobros.map(r => {
    const paid    = (r.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    const pending = (r.totalAmount || 0) - paid;
    return `<div class="gs-item" onclick="clearGlobalSearch(); navigate('cartera')">
      <span class="gs-icon">🧾</span>
      <div class="gs-body">
        <div class="gs-title">${_highlight(r.clientName || 'Cliente', q)}</div>
        <div class="gs-sub">Pendiente: ${fmt(pending)}</div>
      </div>
      <span class="gs-amt" style="color:#0891b2;">${fmt(r.totalAmount || 0)}</span>
    </div>`;
  })});

  // ── Inventario ─────────────────────────────────────────
  const prods = DB.getInventory()
    .filter(p =>
      (p.name || '').toLowerCase().includes(qLow) ||
      (p.sku  || '').toLowerCase().includes(qLow)
    ).slice(0, 4);
  if (prods.length) sections.push({ label: '📦 Inventario', items: prods.map(p =>
    `<div class="gs-item" onclick="clearGlobalSearch(); navigate('inventory')">
      <span class="gs-icon">📦</span>
      <div class="gs-body">
        <div class="gs-title">${_highlight(p.name || 'Producto', q)}</div>
        <div class="gs-sub">${p.sku ? 'SKU: ' + escHtml(p.sku) + ' · ' : ''}Stock: ${p.stock || 0} uds</div>
      </div>
      <span class="gs-amt">${fmt(p.price || 0)}</span>
    </div>`
  )});

  // ── Activos Fijos ──────────────────────────────────────
  const assets = DB.getFixedAssets()
    .filter(a =>
      (a.name     || '').toLowerCase().includes(qLow) ||
      (a.category || '').toLowerCase().includes(qLow)
    ).slice(0, 3);
  if (assets.length) sections.push({ label: '🏭 Activos Fijos', items: assets.map(a => {
    const dep = DB.calcAssetDepreciation(a);
    return `<div class="gs-item" onclick="clearGlobalSearch(); navigate('assets')">
      <span class="gs-icon">🏭</span>
      <div class="gs-body">
        <div class="gs-title">${_highlight(a.name || 'Activo', q)}</div>
        <div class="gs-sub">${escHtml(a.category || '')} · Valor libro: ${fmt(dep.bookValue)}</div>
      </div>
      <span class="gs-amt">${fmt(a.cost || 0)}</span>
    </div>`;
  })});

  const el = document.getElementById('dash-search-results');
  if (!el) return;

  if (!sections.length) {
    el.style.display = 'block';
    el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:14px;">
      🔍 Sin resultados para "<strong>${escHtml(q)}</strong>"
    </div>`;
    return;
  }

  const sectHTML = sections.map(s => `
    <div class="gs-section-header">${s.label}</div>
    ${s.items.join('')}
  `).join('');

  const safeQ = escHtml(q).replace(/'/g, "\\'");
  el.style.display = 'block';
  el.innerHTML = sectHTML + `
    <div class="gs-footer">
      <button onclick="clearGlobalSearch(); navigate('journal'); setTimeout(()=>{ journalSearch='${safeQ}';
        const inp=document.getElementById('journal-search'); if(inp) inp.value='${safeQ}'; renderJournal(); }, 250);"
        style="font-size:13px;color:var(--primary);font-weight:600;background:none;padding:6px 8px;">
        Ver todas las transacciones con "${escHtml(q)}" →
      </button>
    </div>
  `;
}

// ── Saldo por cuenta bancaria ─────────────────────────────────────────────────
function renderAccountBalances() {
  const el   = document.getElementById('dash-accounts');
  if (!el) return;

  const balances = DB.getAccountBalances();
  const accounts = DB.getAccounts();

  // Solo cuentas que tienen movimientos (saldo ≠ 0)
  const used = accounts.filter(a => balances[a.id] !== 0);
  if (!used.length) { el.style.display = 'none'; return; }

  const totalCash = used.reduce((s, a) => s + (balances[a.id] || 0), 0);

  el.style.display = 'block';
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header" style="margin-bottom:4px;">
        <div class="card-title">💳 Saldo por Cuenta</div>
        <div style="font-size:13px; color:var(--gray-500); font-weight:600;">
          Total: <span style="color:${totalCash >= 0 ? 'var(--success)' : 'var(--danger)'};">${fmt(totalCash)}</span>
        </div>
      </div>
      <div style="font-size:11px; color:var(--gray-400); margin-bottom:10px;">
        Toca una cuenta para ver su desglose
      </div>
      ${used.map(a => {
        const bal = balances[a.id] || 0;
        const pct = totalCash !== 0 ? Math.abs(Math.round((bal / Math.abs(totalCash)) * 100)) : 0;
        return `
          <div onclick="openAccountDetail('${a.id}')"
            style="display:flex; align-items:center; gap:12px; padding:10px 0;
              border-bottom:1px solid var(--gray-100); cursor:pointer; -webkit-tap-highlight-color:transparent;">
            <div style="font-size:26px; width:36px; text-align:center;">${a.emoji}</div>
            <div style="flex:1; min-width:0;">
              <div style="font-size:14px; font-weight:700;">${a.name}</div>
              <div style="background:var(--gray-100); border-radius:4px; height:5px; margin-top:5px; overflow:hidden;">
                <div style="height:100%; width:${pct}%; background:${bal >= 0 ? 'var(--success)' : 'var(--danger)'}; border-radius:4px;"></div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
              <div style="text-align:right;">
                <div style="font-size:17px; font-weight:800; color:${bal >= 0 ? 'var(--success)' : 'var(--danger)'};">
                  ${bal >= 0 ? '' : '−'}${fmt(Math.abs(bal))}
                </div>
              </div>
              <div style="font-size:16px; color:var(--gray-300);">›</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ── Desglose de transacciones por cuenta ─────────────────────────────────────
// Cuánto movió una transacción EN una cuenta específica.
// En pagos divididos devuelve solo la parte que cayó en esa cuenta.
function _txAmountForAccount(t, accountId) {
  if (Array.isArray(t.splitPayments) && t.splitPayments.length) {
    const sp = t.splitPayments.find(s => s.account === accountId);
    return sp ? (parseFloat(sp.amount) || 0) : 0;
  }
  return t.amount;
}

function openAccountDetail(accountId) {
  const accounts = DB.getAccounts();
  const account  = accounts.find(a => a.id === accountId);
  if (!account) return;

  const allTxs = DB.getTransactions().filter(t => !t.isCogs);

  // Transacciones que afectan esta cuenta
  // Los campos reales son: t.account (income/expense), t.fromAccount / t.toAccount (transfer)
  const txs = allTxs.filter(t => {
    if (t.type === 'transfer') {
      return t.fromAccount === accountId || t.toAccount === accountId;
    }
    if (Array.isArray(t.splitPayments) && t.splitPayments.length) {
      return t.splitPayments.some(sp => sp.account === accountId);
    }
    return t.account === accountId;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  const balances = DB.getAccountBalances();
  const bal      = balances[accountId] || 0;

  const COLORS = { income:'var(--success)', expense:'var(--danger)', transfer:'var(--primary)', liability:'var(--warning)' };
  const TYPE_LABEL = { income:'Ingreso', expense:'Gasto', transfer:'Traslado', liability:'Deuda' };

  // Agrupar por mes
  const byMonth = {};
  txs.forEach(t => {
    const key = t.date.slice(0, 7); // YYYY-MM
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(t);
  });

  const monthLabel = key => {
    const [y, m] = key.split('-');
    return new Date(+y, +m - 1, 1).toLocaleDateString('es-CO', { month:'long', year:'numeric' });
  };

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>

    <!-- Encabezado de cuenta -->
    <div style="display:flex; align-items:center; gap:14px; margin-bottom:20px;">
      <div style="font-size:40px;">${account.emoji}</div>
      <div style="flex:1;">
        <div style="font-size:18px; font-weight:900;">${account.name}</div>
        <div style="font-size:14px; font-weight:700; color:${bal >= 0 ? 'var(--success)' : 'var(--danger)'}; margin-top:2px;">
          Saldo actual: ${bal >= 0 ? '' : '−'}${fmt(Math.abs(bal))}
        </div>
      </div>
    </div>

    <!-- Resumen rápido -->
    ${(() => {
      const ingresos  = txs.filter(t => t.type === 'income').reduce((s, t) => s + _txAmountForAccount(t, accountId), 0);
      const gastos    = txs.filter(t => t.type === 'expense').reduce((s, t) => s + _txAmountForAccount(t, accountId), 0);
      const traslados = txs.filter(t => t.type === 'transfer').length;
      return `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:18px;">
          <div style="background:#f0fdf4; border-radius:10px; padding:10px; text-align:center;">
            <div style="font-size:10px; font-weight:700; color:var(--success); text-transform:uppercase; letter-spacing:.5px;">Ingresos</div>
            <div style="font-size:16px; font-weight:800; color:var(--success); margin-top:2px;">${fmt(ingresos)}</div>
          </div>
          <div style="background:#fef2f2; border-radius:10px; padding:10px; text-align:center;">
            <div style="font-size:10px; font-weight:700; color:var(--danger); text-transform:uppercase; letter-spacing:.5px;">Gastos</div>
            <div style="font-size:16px; font-weight:800; color:var(--danger); margin-top:2px;">${fmt(gastos)}</div>
          </div>
        </div>
        ${traslados > 0 ? `<div style="font-size:11px; color:var(--gray-400); margin-bottom:14px; text-align:center;">+ ${traslados} traslado(s) entre cuentas</div>` : ''}
      `;
    })()}

    <!-- Listado agrupado por mes -->
    ${txs.length === 0
      ? `<div style="text-align:center; padding:30px 0; color:var(--gray-400);">
           <div style="font-size:36px; margin-bottom:8px;">📭</div>
           Sin movimientos en esta cuenta
         </div>`
      : Object.entries(byMonth).map(([key, mTxs]) => {
          const mInc = mTxs.filter(t => t.type === 'income').reduce((s,t) => s + _txAmountForAccount(t, accountId), 0);
          const mExp = mTxs.filter(t => t.type === 'expense').reduce((s,t) => s + _txAmountForAccount(t, accountId), 0);
          return `
            <div style="margin-bottom:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center;
                font-size:11px; font-weight:700; color:var(--gray-500); text-transform:uppercase;
                letter-spacing:.5px; margin-bottom:8px; padding-bottom:6px;
                border-bottom:2px solid var(--gray-100);">
                <span>${monthLabel(key)}</span>
                <span style="color:${(mInc-mExp) >= 0 ? 'var(--success)' : 'var(--danger)'};">
                  ${(mInc-mExp) >= 0 ? '+' : ''}${fmt(mInc - mExp)}
                </span>
              </div>
              ${mTxs.map(t => {
                const isOut = t.type === 'expense'
                  || (t.type === 'transfer' && t.fromAccount === accountId)
                  || (t.isIva && t.ivaDirection === 'credito');  // IVA pagado en compras = sale dinero
                const isIn  = t.type === 'income'
                  || (t.type === 'transfer' && t.toAccount === accountId)
                  || (t.isIva && t.ivaDirection === 'cobrado');  // IVA cobrado en ventas = entra dinero
                const sign  = isOut ? '−' : '+';
                const color = isOut ? 'var(--danger)' : 'var(--success)';
                return `
                  <div onclick="closeSettingsSheet(); setTimeout(()=>openTxDetail('${t.id}'),200);"
                    style="display:flex; align-items:center; gap:10px; padding:9px 0;
                      border-bottom:1px solid var(--gray-50); cursor:pointer; -webkit-tap-highlight-color:transparent;">
                    <div style="width:8px; height:8px; border-radius:50%; background:${COLORS[t.type] || 'var(--gray-300)'}; flex-shrink:0;"></div>
                    <div style="flex:1; min-width:0;">
                      <div style="font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.description}</div>
                      <div style="font-size:11px; color:var(--gray-400);">${fmtDate(t.date)} · ${TYPE_LABEL[t.type] || t.type}${(Array.isArray(t.splitPayments) && t.splitPayments.length) ? ' · 💳 parte de pago dividido' : ''}</div>
                    </div>
                    <div style="font-size:14px; font-weight:800; color:${color}; flex-shrink:0;">
                      ${sign}${fmt(_txAmountForAccount(t, accountId))}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `;
        }).join('')
    }

    <div style="font-size:11px; color:var(--gray-400); text-align:center; margin-top:8px;">
      ${txs.length} movimiento(s) en total
    </div>
    <button class="btn btn-secondary btn-block mt-16" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

// ── Swipe-to-reveal helpers ───────────────────────────────────────────────────
// ── Popup menú ⋯ de acciones por transacción ─────────────────────────────────
let _txMenuCloseHandler = null;

function openTxActionMenu(id, btn, canEdit, canDelete) {
  const menu    = document.getElementById('tx-action-menu');
  const editBtn = document.getElementById('tx-menu-edit');
  const delBtn  = document.getElementById('tx-menu-del');
  const divider = document.getElementById('tx-menu-divider');
  if (!menu) return;

  // Toggle: si ya está abierto para el mismo → cerrar
  if (menu.style.display === 'block' && menu.dataset.txId === id) {
    closeTxActionMenu(); return;
  }
  menu.dataset.txId = id;

  // Configurar botones
  if (editBtn) {
    editBtn.style.display = canEdit ? 'flex' : 'none';
    editBtn.onclick = () => { closeTxActionMenu(); navigate('form', { id }); };
  }
  if (delBtn) {
    delBtn.style.display = canDelete ? 'flex' : 'none';
    delBtn.onclick = () => { closeTxActionMenu(); _deleteTxFromMenu(id); };
  }
  if (divider) divider.style.display = (canEdit && canDelete) ? 'block' : 'none';

  // Posicionar junto al botón ⋯, dentro de la ventana
  const rect  = btn.getBoundingClientRect();
  const menuW = 168;
  let   left  = rect.right - menuW;
  let   top   = rect.bottom + 6;
  if (left < 8)                       left = 8;
  if (top + 100 > window.innerHeight) top  = rect.top - 106;
  menu.style.left    = left + 'px';
  menu.style.top     = top  + 'px';
  menu.style.display = 'block';

  // Cerrar al tocar fuera
  if (_txMenuCloseHandler) document.removeEventListener('click', _txMenuCloseHandler);
  setTimeout(() => {
    _txMenuCloseHandler = e => { if (!menu.contains(e.target)) closeTxActionMenu(); };
    document.addEventListener('click', _txMenuCloseHandler);
  }, 10);
}

function closeTxActionMenu() {
  const menu = document.getElementById('tx-action-menu');
  if (menu) { menu.style.display = 'none'; menu.dataset.txId = ''; }
  if (_txMenuCloseHandler) {
    document.removeEventListener('click', _txMenuCloseHandler);
    _txMenuCloseHandler = null;
  }
}

function _deleteTxFromMenu(id) {
  DB.deleteTransaction(id);
  showToast('🗑️ Registro eliminado');
  if      (currentScreen === 'journal')   renderJournal();
  else if (currentScreen === 'dashboard') renderDashboard();
}

// ── Diario ────────────────────────────────────────────────────────────────────
function renderJournal() {
  let txs = DB.getTransactions();

  // ── Filtro por tipo ───────────────────────────────────────
  if (journalFilter !== 'all') txs = txs.filter(t => t.type === journalFilter);

  // ── Filtro por texto (descripción + notas) ────────────────
  if (journalSearch.trim()) {
    const q = journalSearch.toLowerCase();
    txs = txs.filter(t =>
      t.description.toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q)
    );
  }

  // ── Selector de usuario (solo si hay múltiples usuarios) ─
  const userNames  = DB.getUserNames();
  const userWrap   = document.getElementById('journal-user-wrap');
  const userSelect = document.getElementById('journal-user-filter');
  const showUsers  = userNames.length > 1;
  if (userWrap) userWrap.style.display = showUsers ? 'block' : 'none';
  if (showUsers && userSelect) {
    const prevUser = userSelect.value;
    userSelect.innerHTML =
      '<option value="">👥 Todos los usuarios</option>' +
      userNames.map(n => `<option value="${n}" ${(prevUser === n || journalUserFilter === n) ? 'selected' : ''}>👤 ${n}</option>`).join('');
    if (journalUserFilter) userSelect.value = journalUserFilter;
  }

  // ── Filtro por usuario ──────────────────────────────────
  if (journalUserFilter) txs = txs.filter(t => t.userName === journalUserFilter);

  // ── Selector de categoría (dinámico según el tipo) ────────
  const catWrap   = document.getElementById('journal-cat-wrap');
  const catSelect = document.getElementById('journal-cat-filter');
  const showCats  = ['income','expense','liability'].includes(journalFilter);

  if (catWrap) catWrap.style.display = showCats ? 'block' : 'none';
  if (showCats && catSelect) {
    const catType = journalFilter === 'liability' ? 'liability' : journalFilter;
    const cats    = DB.getCategoriesByType(catType);
    const prev    = catSelect.value;
    catSelect.innerHTML =
      '<option value="">— Todas las categorías —</option>' +
      cats.map(c => `<option value="${c.id}" ${prev === c.id ? 'selected' : ''}>${c.emoji} ${c.name}</option>`).join('');
    if (journalCatFilter) catSelect.value = journalCatFilter;
  }

  // ── Filtro por categoría ──────────────────────────────────
  if (journalCatFilter) {
    txs = txs.filter(t => t.category === journalCatFilter);
  }

  // ── Filtro por fecha ──────────────────────────────────────
  const customWrap = document.getElementById('journal-date-custom');
  if (customWrap) customWrap.style.display = journalDateFilter === 'custom' ? 'block' : 'none';

  let dateLabel = '';
  if (journalDateFilter !== 'all') {
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    let fromDate = null, toDate = null;

    if (journalDateFilter === 'today') {
      fromDate = toDate = todayDate;
      dateLabel = 'Hoy';
    } else if (journalDateFilter === 'yesterday') {
      const y = new Date(todayDate);
      y.setDate(y.getDate() - 1);
      fromDate = toDate = y;
      dateLabel = 'Ayer';
    } else if (journalDateFilter === 'week') {
      fromDate = new Date(todayDate);
      fromDate.setDate(fromDate.getDate() - 6);
      toDate = todayDate;
      dateLabel = 'Últimos 7 días';
    } else if (journalDateFilter === 'month') {
      fromDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
      toDate = todayDate;
      dateLabel = 'Este mes';
    } else if (journalDateFilter === 'custom') {
      const fromVal = document.getElementById('journal-date-from')?.value;
      const toVal   = document.getElementById('journal-date-to')?.value;
      if (fromVal) fromDate = new Date(fromVal + 'T00:00:00');
      if (toVal)   toDate   = new Date(toVal   + 'T23:59:59');
      dateLabel = fromVal || toVal
        ? (fromVal && toVal ? `${fromVal} → ${toVal}` : fromVal ? `Desde ${fromVal}` : `Hasta ${toVal}`)
        : 'Rango personalizado';
    }

    if (fromDate || toDate) {
      txs = txs.filter(t => {
        const txDate = new Date(t.date + 'T12:00:00');
        if (fromDate && txDate < fromDate) return false;
        if (toDate) {
          const toEnd = new Date(toDate);
          toEnd.setHours(23, 59, 59, 999);
          if (txDate > toEnd) return false;
        }
        return true;
      });
    }
  }

  // Sincronizar chips de fecha activos
  document.querySelectorAll('#journal-date-bar .filter-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.df === journalDateFilter)
  );

  // ── Barra de resumen ──────────────────────────────────────
  const summaryEl = document.getElementById('journal-summary');
  if (summaryEl) {
    const hasFilter = journalFilter !== 'all' || journalSearch.trim() || journalCatFilter || journalDateFilter !== 'all';
    if (hasFilter && txs.length > 0) {
      const totalInc = txs.filter(t => t.type === 'income').reduce((s,t) => s+t.amount, 0);
      const totalExp = txs.filter(t => t.type === 'expense' && !t.isCogs).reduce((s,t) => s+t.amount, 0);
      const totalLib = txs.filter(t => t.type === 'liability').reduce((s,t) => s+t.amount, 0);
      const catName  = journalCatFilter ? DB.getCategoryById(journalCatFilter)?.name : null;

      let parts = [`<strong>${txs.length}</strong> registro${txs.length !== 1 ? 's' : ''}`];
      if (totalInc > 0) parts.push(`💰 Ingresos: <strong style="color:var(--success);">+${fmt(totalInc)}</strong>`);
      if (totalExp > 0) parts.push(`💸 Gastos: <strong style="color:var(--danger);">−${fmt(totalExp)}</strong>`);
      if (totalLib > 0) parts.push(`🔴 Deudas: <strong style="color:var(--warning);">${fmt(totalLib)}</strong>`);

      summaryEl.style.display = 'block';
      summaryEl.innerHTML = `
        <div style="background:var(--primary-light); border-radius:10px; padding:10px 14px; margin-bottom:8px; font-size:13px; color:var(--primary); line-height:1.8;">
          ${dateLabel ? `<div style="font-size:11px; font-weight:700; opacity:.75; margin-bottom:2px;">📅 ${dateLabel}</div>` : ''}
          ${catName ? `<div style="font-weight:700; margin-bottom:4px;">📂 ${catName}</div>` : ''}
          ${parts.join(' &nbsp;·&nbsp; ')}
          ${journalCatFilter ? `<button onclick="openCategoryReport('${journalCatFilter}')" style="float:right;font-size:12px;font-weight:700;background:none;color:var(--primary);">Ver reporte →</button>` : ''}
        </div>
      `;
    } else {
      summaryEl.style.display = 'none';
    }
  }

  const groups = {};
  txs.forEach(t => {
    const d = new Date(t.date + 'T12:00:00');
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  });

  const list = document.getElementById('journal-list');
  if (!txs.length) {
    list.innerHTML = emptyHTML('🔍', 'Sin resultados', 'Cambia el filtro o agrega una transacción');
    return;
  }

  list.innerHTML = Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(key => {
    const [y, m] = key.split('-').map(Number);
    const label = new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
    const items = groups[key];
    const income  = items.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = items.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return `
      <div style="padding:10px 0 4px; font-size:12px; font-weight:700; color:var(--gray-500); text-transform:uppercase; letter-spacing:.5px; display:flex; justify-content:space-between; align-items:center;">
        <span>${label}</span>
        <span>
          <span style="color:var(--success)">+${fmt(income)}</span>
          &nbsp;
          <span style="color:var(--danger)">-${fmt(expense)}</span>
        </span>
      </div>
      <div class="card" style="margin-bottom:8px; padding:4px 12px;">
        <ul class="tx-list">${items.map(txItemHTML).join('')}</ul>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-tx-id]').forEach(el =>
    el.addEventListener('click', () => openTxDetail(el.dataset.txId))
  );
}

function setJournalFilter(f) {
  journalFilter    = f;
  journalCatFilter = ''; // reset categoría al cambiar tipo
  document.querySelectorAll('.filter-chip[data-filter]').forEach(c =>
    c.classList.toggle('active', c.dataset.filter === f)
  );
  renderJournal();
}

function setJournalDateFilter(df) {
  journalDateFilter = df;
  // Si es custom, rellenar las fechas con hoy por defecto (si están vacías)
  if (df === 'custom') {
    const todayStr = new Date().toISOString().split('T')[0];
    const fromEl = document.getElementById('journal-date-from');
    const toEl   = document.getElementById('journal-date-to');
    if (fromEl && !fromEl.value) fromEl.value = todayStr;
    if (toEl   && !toEl.value)   toEl.value   = todayStr;
  }
  renderJournal();
}

function setJournalCatFilter(catId) {
  journalCatFilter = catId;
  renderJournal();
}

function setJournalUserFilter(name) {
  journalUserFilter = name;
  renderJournal();
}

// ── Exportar Diario filtrado a Excel ─────────────────────────────────────────
// Exporta exactamente lo que el usuario ve en pantalla (con todos los filtros activos).
function exportJournalExcel() {
  // ── Reproducir los mismos filtros de renderJournal ──────────────────────────
  let txs = DB.getTransactions();
  if (journalFilter !== 'all')  txs = txs.filter(t => t.type === journalFilter);
  if (journalSearch.trim()) {
    const q = journalSearch.toLowerCase();
    txs = txs.filter(t =>
      t.description.toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q)
    );
  }
  if (journalUserFilter) txs = txs.filter(t => t.userName === journalUserFilter);
  if (journalCatFilter)  txs = txs.filter(t => t.category === journalCatFilter);

  // Filtro de fecha
  if (journalDateFilter !== 'all') {
    const todayD = new Date(); todayD.setHours(0,0,0,0);
    let fromDate = null, toDate = null;
    if (journalDateFilter === 'today') {
      fromDate = toDate = todayD;
    } else if (journalDateFilter === 'yesterday') {
      const y = new Date(todayD); y.setDate(y.getDate()-1);
      fromDate = toDate = y;
    } else if (journalDateFilter === 'week') {
      fromDate = new Date(todayD); fromDate.setDate(fromDate.getDate()-6);
      toDate = todayD;
    } else if (journalDateFilter === 'month') {
      fromDate = new Date(todayD.getFullYear(), todayD.getMonth(), 1);
      toDate = todayD;
    } else if (journalDateFilter === 'custom') {
      const fv = document.getElementById('journal-date-from')?.value;
      const tv = document.getElementById('journal-date-to')?.value;
      if (fv) fromDate = new Date(fv + 'T00:00:00');
      if (tv) toDate   = new Date(tv + 'T23:59:59');
    }
    if (fromDate || toDate) {
      txs = txs.filter(t => {
        const d = new Date(t.date + 'T12:00:00');
        if (fromDate && d < fromDate) return false;
        if (toDate) { const te = new Date(toDate); te.setHours(23,59,59,999); if (d > te) return false; }
        return true;
      });
    }
  }

  txs = txs.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (!txs.length) { showToast('⚠️ No hay registros para exportar con los filtros activos'); return; }

  const s    = DB.getSettings();
  const sym  = s.currencySymbol || '$';
  const TYPE = { income:'Ingreso', expense:'Gasto', transfer:'Traslado', liability:'Deuda' };

  // ── Título descriptivo del filtro ──────────────────────────────────────────
  const filterParts = [];
  if (journalFilter !== 'all') filterParts.push(TYPE[journalFilter] || journalFilter);
  if (journalCatFilter) {
    const cn = DB.getCategoryById(journalCatFilter)?.name;
    if (cn) filterParts.push(cn);
  }
  if (journalUserFilter) filterParts.push('👤 ' + journalUserFilter);
  const dateLabels = { today:'Hoy', yesterday:'Ayer', week:'Últimos 7 días', month:'Este mes', custom:'Rango personalizado' };
  if (journalDateFilter !== 'all') filterParts.push(dateLabels[journalDateFilter] || '');
  if (journalSearch.trim()) filterParts.push('Búsqueda: "' + journalSearch.trim() + '"');
  const filtroTitulo = filterParts.length ? filterParts.join(' · ') : 'Todos los registros';

  const exportDate = new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' });

  // ── Filas de datos ─────────────────────────────────────────────────────────
  const header = [
    { v:'Fecha',        s:'header' },
    { v:'Descripción',  s:'header' },
    { v:'Tipo',         s:'header' },
    { v:'Categoría',    s:'header' },
    { v:'Cuenta',       s:'header' },
    { v:'Ingreso',      s:'header' },
    { v:'Gasto',        s:'header' },
    { v:'Traslado',     s:'header' },
    { v:'Deuda',        s:'header' },
    { v:'Notas',        s:'header' },
    { v:'Usuario',      s:'header' },
  ];

  let totalInc = 0, totalExp = 0, totalTrf = 0, totalLib = 0;

  const dataRows = txs.map(t => {
    const cat     = DB.getCategoryById(t.category);
    const acc     = DB.getAccountById(t.account);
    const fAcc    = DB.getAccountById(t.fromAccount);
    const tAcc    = DB.getAccountById(t.toAccount);
    const catName = cat ? cat.name : '';
    let accName   = acc ? acc.name : '';
    if (t.type === 'transfer' && fAcc && tAcc) accName = fAcc.name + ' → ' + tAcc.name;

    let inc = '', exp = '', trf = '', lib = '';
    if (t.type === 'income')   { inc = t.amount; totalInc += t.amount; }
    if (t.type === 'expense')  { exp = t.amount; totalExp += t.amount; }
    if (t.type === 'transfer') { trf = t.amount; totalTrf += t.amount; }
    if (t.type === 'liability'){ lib = t.amount; totalLib += t.amount; }

    return [
      { v: t.date,              s: 'label'  },
      { v: t.description || '', s: 'text'   },
      { v: TYPE[t.type] || '', s: 'text'   },
      { v: catName,             s: 'text'   },
      { v: accName,             s: 'text'   },
      { v: inc !== '' ? inc : null, s: inc !== '' ? 'money' : 'text' },
      { v: exp !== '' ? exp : null, s: exp !== '' ? 'money' : 'text' },
      { v: trf !== '' ? trf : null, s: trf !== '' ? 'money' : 'text' },
      { v: lib !== '' ? lib : null, s: lib !== '' ? 'money' : 'text' },
      { v: t.notes || '',       s: 'text'   },
      { v: t.userName || '',    s: 'text'   },
    ];
  });

  // Fila de totales
  const totalesRow = [
    { v: 'TOTALES', s: 'totalLabel' },
    { v: '', s: 'text' },
    { v: txs.length + ' registros', s: 'text' },
    { v: '', s: 'text' },
    { v: '', s: 'text' },
    { v: totalInc, s: 'moneyBold' },
    { v: totalExp, s: 'moneyBold' },
    { v: totalTrf, s: 'moneyBold' },
    { v: totalLib, s: 'moneyBold' },
    { v: '', s: 'text' },
    { v: '', s: 'text' },
  ];

  const rows = [
    // Título del reporte
    [{ v: s.companyName || 'Mi Negocio', s: 'title', merge: 10 }],
    [{ v: 'Diario Contable — ' + filtroTitulo, s: 'subtitle', merge: 10 }],
    [{ v: 'Exportado el ' + exportDate + ' · ' + txs.length + ' registro(s)', merge: 10 }],
    [], // fila vacía
    header,
    ...dataRows,
    [], // fila vacía
    totalesRow,
  ];

  const today = new Date().toISOString().slice(0,10);
  const companySlug = (s.companyName || 'Negocio').replace(/\s+/g,'-');
  const filename = 'Diario_' + companySlug + '_' + today + '.xlsx';

  try {
    const bytes = _buildXlsx([{
      name: 'Diario',
      cols: [100, 220, 85, 130, 130, 105, 105, 105, 105, 160, 90],
      rows,
    }], sym);
    _downloadXlsx(bytes, filename);
    DB.logAudit('export_excel', '📒 Diario exportado: ' + filename + ' (' + txs.length + ' registros)');
    showToast('📥 Excel descargado · ' + txs.length + ' registro(s)', 3000);
  } catch (err) {
    showToast('❌ Error al generar Excel: ' + err.message, 4000);
  }
}

// ── Ítem de transacción (display correcto por tipo) ───────────────────────────
function txItemHTML(tx) {
  const cat       = DB.getCategoryById(tx.category);
  const multiUser = DB.getUserNames().length > 1;
  const userTag   = (multiUser && tx.userName) ? ` · <span style="font-size:10px;background:var(--primary-light);color:var(--primary);border-radius:4px;padding:1px 5px;vertical-align:middle;">👤 ${tx.userName}</span>` : '';
  let emoji, amountText, amountClass, metaText, extraStyle = '';

  // CMV auto-generado: estilo diferente, no interactivo si se prefiere
  if (tx.isCogs) {
    emoji = '📦';
    amountText = '-' + fmt(tx.amount);
    amountClass = 'cogs';
    metaText = fmtDate(tx.date) + ' · Costo de Ventas (CMV) · Auto';
    extraStyle = 'opacity:.7; background:var(--gray-50);';
  } else if (tx.isIva) {
    // Asiento de IVA auto-generado
    emoji = '🧾';
    const cobrado = tx.ivaDirection === 'cobrado';
    amountText  = (cobrado ? '+' : '-') + fmt(tx.amount);
    amountClass = cobrado ? 'income' : 'expense';
    metaText    = fmtDate(tx.date) + ' · ' +
      (cobrado ? 'IVA cobrado en venta' : 'IVA pagado en compra') + ' · Auto';
    extraStyle  = 'opacity:.85; background:#fffbeb;';
  } else if (tx.type === 'income') {
    emoji = cat ? cat.emoji : '💰';
    amountText = '+' + fmt(tx.amount);
    amountClass = 'income';
    const cogsTag = tx.cogsAmount ? ` · CMV: -${fmt(tx.cogsAmount)}` : '';
    metaText = fmtDate(tx.date) + (cat ? ' · ' + cat.name : '') + cogsTag;

  } else if (tx.type === 'expense') {
    emoji = tx.isFactura ? '🧾' : (cat ? cat.emoji : '💸');
    amountText = '-' + fmt(tx.amount);
    amountClass = 'expense';
    const recTag = tx.isRecurring ? ' · 🔄 Auto' : '';
    const facTag = tx.isFactura ? ' · 🧾 Factura' : '';
    metaText = fmtDate(tx.date) + (cat ? ' · ' + cat.name : '') + facTag + recTag;

  } else if (tx.type === 'transfer') {
    const fromAcc = DB.getAccountById(tx.fromAccount);
    const toAcc   = DB.getAccountById(tx.toAccount);
    emoji = '↔️';
    amountText = fmt(tx.amount);
    amountClass = 'transfer';
    const from = fromAcc ? fromAcc.emoji + ' ' + fromAcc.name : 'Cuenta';
    const to   = toAcc   ? toAcc.emoji   + ' ' + toAcc.name   : 'Cuenta';
    metaText = fmtDate(tx.date) + ` · ${from} → ${to}`;

  } else if (tx.type === 'liability') {
    emoji = cat ? cat.emoji : '🔴';
    amountText = fmt(tx.amount);
    amountClass = 'liability';
    const status = tx.liabilityStatus === 'paid' ? ' ✅ Pagada' : ' 🔴 Pendiente';
    metaText = fmtDate(tx.date) + (cat ? ' · ' + cat.name : '') + status;
  }

  // Botón ⋯ de acciones (solo si el usuario puede editar o eliminar)
  const canEdit   = !tx.isCogs && !tx.isIva && !tx.isFactura && !isCurrentUserReadOnly();
  const canDelete = !tx.isCogs && !tx.isIva && isCurrentUserOwner();
  const menuBtn   = (canEdit || canDelete)
    ? `<button class="tx-menu-btn" onclick="event.stopPropagation();openTxActionMenu('${tx.id}',this,${canEdit},${canDelete})">⋯</button>`
    : '';

  return `
    <li class="tx-item" data-tx-id="${tx.id}" style="${extraStyle}">
      <div class="tx-icon ${tx.isCogs ? 'cogs' : tx.type}"><span>${emoji}</span></div>
      <div class="tx-info">
        <div class="tx-desc">${tx.description}${tx.hasReceipt ? ' 📎' : ''}${(tx.isCogs || tx.isIva) ? ' <span style="font-size:10px;background:#ede9fe;color:#7c3aed;border-radius:4px;padding:1px 5px;vertical-align:middle;">AUTO</span>' : ''}</div>
        <div class="tx-meta">${metaText}${userTag}</div>
      </div>
      <div class="tx-amount ${amountClass}">${amountText}</div>
      ${menuBtn}
    </li>
  `;
}

// ── Formulario de transacción ─────────────────────────────────────────────────
// ── Sistema inteligente: autocompletar descripciones + selector IVA ───────────
let _formIvaType      = 'IVA_INCLUIDO'; // tipo de IVA activo en el formulario
let _smartSuggestions = [];              // lista de sugerencias actuales (por índice)

// Normaliza texto a clave de aprendizaje: primeras 3 palabras ≥3 letras
function _normalizeDescKey(desc) {
  return (desc || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .slice(0, 3)
    .join(' ');
}

// Se dispara mientras el usuario escribe en "Descripción"
function onDescInput() {
  const val = (document.getElementById('f-desc')?.value || '').trim();
  if (val.length < 2) { _hideSuggestions(); return; }
  _showSmartSuggestions(val);
}

// Oculta el dropdown con retraso para que click/touch en sugerencia llegue primero
function _onDescBlur() { setTimeout(_hideSuggestions, 200); }

function _hideSuggestions() {
  const box = document.getElementById('smart-suggestions');
  if (box) box.style.display = 'none';
}

// Construye y muestra el dropdown de sugerencias
function _showSmartSuggestions(query) {
  const box = document.getElementById('smart-suggestions');
  if (!box) return;

  const norm     = _normalizeDescKey(query);
  const queryLow = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Sugerencias aprendidas del historial
  const learned = DB.getSmartDescSuggestions(norm || queryLow.replace(/[^a-z0-9\s]/g, '').trim());

  // Coincidencias en inventario
  const inv = DB.getInventory().filter(p =>
    (p.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(queryLow)
  ).slice(0, 3);

  _smartSuggestions = [];
  if (learned.length === 0 && inv.length === 0) { _hideSuggestions(); return; }

  const TYPE_ICON  = { income:'📈', expense:'📉', liability:'🔴', transfer:'↔️' };
  const TYPE_LABEL = { income:'Ingreso', expense:'Gasto', liability:'Deuda', transfer:'Traslado' };
  const IVA_LABEL  = { SIN_IVA:'Sin IVA', IVA_NO_INCLUIDO:'+IVA', IVA_INCLUIDO:'Inc. IVA' };

  let html = '';

  learned.forEach(s => {
    const idx = _smartSuggestions.length;
    _smartSuggestions.push({ source: 'learned', data: s });
    html += `
      <div onclick="_selectSuggestion(${idx})" onmousedown="event.preventDefault()"
        style="padding:11px 14px; border-bottom:1px solid var(--gray-100); cursor:pointer;
          display:flex; align-items:center; gap:10px;"
        onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
        <div style="font-size:22px;">${TYPE_ICON[s.type] || '📋'}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${(s.exampleDesc || s.key).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}
          </div>
          <div style="font-size:11px; color:var(--gray-400);">
            ${TYPE_LABEL[s.type] || 'Transacción'} · ${IVA_LABEL[s.ivaType] || 'Sin IVA'} · Usado ${s.count || 1}×
          </div>
        </div>
        <div style="font-size:10px; background:var(--primary-light); color:var(--primary);
          padding:3px 9px; border-radius:20px; font-weight:700; white-space:nowrap;">⚡ Auto</div>
      </div>`;
  });

  inv.forEach(p => {
    const idx = _smartSuggestions.length;
    _smartSuggestions.push({ source: 'inventory', data: p });
    const IVA_L = { SIN_IVA:'Sin IVA', IVA_NO_INCLUIDO:'+IVA', IVA_INCLUIDO:'Inc. IVA' };
    html += `
      <div onclick="_selectSuggestion(${idx})" onmousedown="event.preventDefault()"
        style="padding:11px 14px; border-bottom:1px solid var(--gray-100); cursor:pointer;
          display:flex; align-items:center; gap:10px;"
        onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
        <div style="font-size:22px;">${p.emoji || '📦'}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:700;">
            ${(p.name || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}
          </div>
          <div style="font-size:11px; color:var(--gray-400);">
            Producto · Stock: ${p.quantity} ${p.unit} · ${IVA_L[p.tipoIva] || 'Sin IVA'}
          </div>
        </div>
        <div style="font-size:10px; background:#dcfce7; color:#16a34a;
          padding:3px 9px; border-radius:20px; font-weight:700; white-space:nowrap;">📦 Stock</div>
      </div>`;
  });

  box.innerHTML = html;
  box.style.display = 'block';
}

// Aplica la sugerencia seleccionada al formulario
function _selectSuggestion(idx) {
  const entry = _smartSuggestions[idx];
  if (!entry) return;
  _hideSuggestions();

  if (entry.source === 'learned') {
    const s    = entry.data;
    const desc = document.getElementById('f-desc');
    if (desc) desc.value = s.exampleDesc || s.key;

    // Cambiar tipo si difiere (re-renderiza el formulario)
    if (s.type && s.type !== formType) { formType = s.type; updateTypeTabs(); }

    setTimeout(() => {
      if (s.category) { const c = document.getElementById('f-category'); if (c) c.value = s.category; }
      if (s.account)  { const a = document.getElementById('f-account');  if (a) a.value = s.account;  }
      if (s.creditor) { const r = document.getElementById('f-creditor'); if (r) r.value = s.creditor; }
      if (s.ivaType)  selectIva(s.ivaType);
      showToast('⚡ Campos completados automáticamente', 1800);
    }, 30);

  } else if (entry.source === 'inventory') {
    const p    = entry.data;
    const desc = document.getElementById('f-desc');
    if (desc) desc.value = 'Venta de ' + p.name;

    if (formType !== 'income') { formType = 'income'; updateTypeTabs(); }

    setTimeout(() => {
      const cb = document.getElementById('f-affects-inv');
      if (cb) { cb.checked = true; toggleInventorySection(); }
      const pe = document.getElementById('f-product');
      if (pe) pe.value = p.id;
      if (p.tipoIva) selectIva(p.tipoIva);
      showToast('⚡ Producto "' + p.name + '" seleccionado', 1800);
    }, 30);
  }
}

// Cambia el tipo de IVA activo y actualiza los botones + desglose
function selectIva(type) {
  _formIvaType = type;
  ['SIN_IVA', 'IVA_NO_INCLUIDO', 'IVA_INCLUIDO'].forEach(t => {
    const btn = document.getElementById('iva-btn-' + t);
    if (!btn) return;
    const on = t === type;
    btn.style.borderColor = on ? 'var(--primary)' : 'var(--gray-200)';
    btn.style.background  = on ? 'var(--primary-light)' : 'var(--white)';
    btn.style.color       = on ? 'var(--primary)' : 'var(--gray-400)';
    btn.style.fontWeight  = on ? '800' : '600';
  });
  _updateIvaBreakdown();
}

// Muestra en tiempo real el desglose base + IVA según monto y tipo
function _updateIvaBreakdown() {
  const el = document.getElementById('iva-breakdown');
  if (el) {
    const amount = parseFloat(document.getElementById('f-amount')?.value) || 0;
    if (!amount || _formIvaType === 'SIN_IVA') {
      el.innerHTML = '';
    } else {
      const s   = DB.getSettings();
      const pct = s.porcentajeIva || DB.IVA_DEFAULT;
      const res = DB.calcIva(amount, _formIvaType, pct);
      const sym = s.currencySymbol || '$';
      el.innerHTML = _formIvaType === 'IVA_NO_INCLUIDO'
        ? `<span style="color:var(--gray-500)">Base: ${sym} ${fmt(res.precioBase)} + IVA ${pct}%: ${sym} ${fmt(res.valorIva)} = <strong>Total: ${sym} ${fmt(res.precioFinal)}</strong></span>`
        : `<span style="color:var(--gray-500)">Incluye: base ${sym} ${fmt(res.precioBase)} + IVA ${pct}%: ${sym} ${fmt(res.valorIva)}</span>`;
    }
  }
  _updateSplitInfo(); // el total cambió → actualizar el reparto del pago dividido
  _liabilityHint();   // el monto cambió → actualizar la pista de plazo/cuota
}

// ── Pago dividido en 2 cuentas (ingreso/gasto recibido o pagado de 2 formas) ──
// Total real de la transacción incluyendo IVA (lo que se reparte entre cuentas)
function _formTotal() {
  const amount = parseFloat(document.getElementById('f-amount')?.value) || 0;
  if (!amount) return 0;
  if (_formIvaType === 'IVA_NO_INCLUIDO') {
    const pct = DB.getSettings().porcentajeIva || DB.IVA_DEFAULT;
    return DB.calcIva(amount, _formIvaType, pct).precioFinal;
  }
  return amount; // SIN_IVA e IVA_INCLUIDO: el monto ya es el total
}

function toggleSplitPayment() {
  const on  = document.getElementById('f-split-on')?.checked;
  const sec = document.getElementById('split-section');
  if (sec) sec.style.display = on ? 'block' : 'none';
  _updateSplitInfo();
}

// Muestra en vivo cómo se reparte el total entre las 2 cuentas
function _updateSplitInfo() {
  const el = document.getElementById('split-info');
  if (!el) return;
  if (!document.getElementById('f-split-on')?.checked) { el.innerHTML = ''; return; }
  const sym    = DB.getSettings().currencySymbol || '$';
  const total  = _formTotal();
  const monto2 = parseFloat(document.getElementById('f-split-amount')?.value) || 0;
  if (total <= 0) {
    el.innerHTML = `<span style="color:var(--gray-400)">Escribe primero el monto arriba</span>`;
  } else if (monto2 <= 0) {
    el.innerHTML = `<span style="color:var(--gray-400)">Total a repartir: ${sym} ${fmt(total)}</span>`;
  } else if (monto2 >= total) {
    el.innerHTML = `<span style="color:#dc2626; font-weight:700">⚠️ El monto de la 2da cuenta debe ser menor a ${sym} ${fmt(total)}</span>`;
  } else {
    const monto1 = Math.round((total - monto2) * 100) / 100;
    el.innerHTML = `<span style="color:#16a34a; font-weight:700">✅ Cuenta 1: ${sym} ${fmt(monto1)} &nbsp;·&nbsp; Cuenta 2: ${sym} ${fmt(monto2)}</span>`;
  }
}

// ── Foto de comprobante / factura (opcional en ingreso, gasto y deuda) ────────
let _formPhoto = null; // dataURL de la foto adjunta en el formulario actual

// Comprime una imagen: la redimensiona y la convierte a JPEG liviano
function _compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h && w > maxDim)  { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h > maxDim)      { w = Math.round(w * maxDim / h); h = maxDim; }
        const canvas  = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('imagen inválida'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('lectura fallida'));
    reader.readAsDataURL(file);
  });
}

// El usuario tomó una foto o eligió una de la galería
function onReceiptPhotoSelected(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = ''; // permitir volver a elegir el mismo archivo
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    showToast('⚠️ Selecciona una imagen'); return;
  }
  showToast('🖼️ Procesando foto…', 1200);
  _compressImage(file, 1280, 0.7)
    .then(dataUrl => {
      _formPhoto = dataUrl;
      _renderReceiptArea();
      showToast('✅ Comprobante adjuntado', 1500);
    })
    .catch(() => showToast('❌ No se pudo procesar la imagen', 2500));
}

// HTML estático de la sección de foto (input oculto + contenedor)
function _receiptSectionHTML() {
  return `
    <div class="form-group">
      <label class="form-label">📷 Foto de factura / comprobante (opcional)</label>
      <input type="file" id="f-receipt-input" accept="image/*"
        onchange="onReceiptPhotoSelected(event)" style="display:none;">
      <div id="receipt-area"></div>
    </div>`;
}

// Dibuja el área de foto según haya o no una foto adjunta
function _renderReceiptArea() {
  const area = document.getElementById('receipt-area');
  if (!area) return;
  if (_formPhoto) {
    area.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center; background:#f0fdf4;
        border:1.5px solid #86efac; border-radius:10px; padding:10px;">
        <img src="${_formPhoto}" onclick="_openPhotoViewer(_formPhoto)"
          style="width:58px; height:58px; object-fit:cover; border-radius:8px;
            cursor:pointer; flex-shrink:0;">
        <div style="flex:1; font-size:12px; color:#166534; font-weight:700; line-height:1.4;">
          ✅ Comprobante adjuntado
          <div style="font-weight:400; color:var(--gray-500); font-size:11px;">Toca la imagen para ampliarla</div>
        </div>
        <button type="button" onclick="_removeFormPhoto()"
          style="background:none; border:none; color:var(--danger); font-size:13px;
            font-weight:700; cursor:pointer; white-space:nowrap;">Quitar</button>
      </div>`;
  } else {
    area.innerHTML = `
      <button type="button" onclick="document.getElementById('f-receipt-input').click()"
        style="width:100%; padding:14px; border:1.5px dashed var(--gray-300);
          border-radius:10px; background:var(--gray-50); color:var(--gray-500);
          font-size:13px; font-weight:600; cursor:pointer;">
        📷 Tomar foto o elegir de la galería
      </button>`;
  }
}

function _removeFormPhoto() {
  _formPhoto = null;
  _renderReceiptArea();
}

// Visor de imagen a pantalla completa
function _openPhotoViewer(dataUrl) {
  if (!dataUrl) return;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.93);' +
    'display:flex; align-items:center; justify-content:center; padding:14px;';
  ov.innerHTML = `
    <img src="${dataUrl}" style="max-width:100%; max-height:100%; border-radius:8px;">
    <div style="position:absolute; top:16px; right:16px; width:44px; height:44px;
      border-radius:50%; background:rgba(255,255,255,.22); color:#fff; display:flex;
      align-items:center; justify-content:center; font-size:24px;">×</div>`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}

// ── Registrar factura de compra (IVA mixto + deducible) ───────────────────────
let _facturaPhoto = null;
let _facturaPago  = 'efectivo';

function openFacturaForm() {
  _facturaPhoto = null;
  _facturaPago  = 'efectivo';
  const accounts = DB.getAccounts();
  const cats     = DB.getCategoriesByType('expense');
  const pct      = DB.getSettings().porcentajeIva || DB.IVA_DEFAULT;

  const accOpts = '<option value="">— Selecciona cuenta —</option>' +
    accounts.map(a => `<option value="${a.id}">${a.emoji} ${a.name}</option>`).join('');
  const catOpts = '<option value="">— Categoría (opcional) —</option>' +
    cats.map(c => `<option value="${c.id}">${c.emoji} ${c.name}</option>`).join('');
  const dedTipos = [
    ['alimentacion', '🍽️ Alimentación'], ['salud', '⚕️ Salud'],
    ['vivienda', '🏠 Vivienda'], ['educacion', '📚 Educación'],
    ['vestimenta', '👕 Vestimenta'], ['turismo', '✈️ Turismo'],
  ];

  const sec = (n, title) => `<div style="font-size:11px; font-weight:800; color:var(--primary);
    text-transform:uppercase; letter-spacing:.5px; margin:18px 0 8px;">${n} · ${title}</div>`;
  const pagoBtn = (m, ico, lbl) => `<button type="button" id="fac-pago-${m}"
    onclick="selectFacturaPago('${m}')" style="flex:1; padding:10px 4px; border-radius:10px;
      font-size:12px; line-height:1.4; cursor:pointer; text-align:center;
      border:2px solid ${m === _facturaPago ? 'var(--primary)' : 'var(--gray-200)'};
      background:${m === _facturaPago ? 'var(--primary-light)' : 'var(--white)'};
      color:${m === _facturaPago ? 'var(--primary)' : 'var(--gray-400)'};
      font-weight:${m === _facturaPago ? '800' : '600'};">${ico}<br>${lbl}</button>`;

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">🧾 Registrar Factura de Compra</h3>

    ${sec('1', 'Datos de la factura')}
    <div class="form-group"><label class="form-label">Fecha de la factura</label>
      <input type="date" id="fac-fecha" class="form-control" value="${today()}"></div>
    <div class="form-group"><label class="form-label">Proveedor / negocio</label>
      <input type="text" id="fac-proveedor" class="form-control" placeholder="Ej: Supermaxi" maxlength="60"></div>
    <div class="form-group"><label class="form-label">Concepto</label>
      <input type="text" id="fac-concepto" class="form-control" placeholder="Ej: Compra de supermercado" maxlength="80"></div>
    <div class="form-group"><label class="form-label">Categoría (opcional)</label>
      <select id="fac-categoria" class="form-control">${catOpts}</select></div>

    ${sec('2', 'Valores de la factura')}
    <div style="font-size:12px; color:var(--gray-500); margin-bottom:8px;">
      Tecléalos de la parte de abajo de tu factura — vienen claros.</div>
    <div class="form-group"><label class="form-label">Tarifa 0% (sin IVA)</label>
      <input type="number" id="fac-t0" class="form-control" placeholder="0.00" min="0" step="any"
        inputmode="decimal" oninput="_facturaRecalc()"></div>
    <div class="form-group"><label class="form-label">Tarifa ${pct}% — base gravada</label>
      <input type="number" id="fac-t15" class="form-control" placeholder="0.00" min="0" step="any"
        inputmode="decimal" oninput="_facturaOnT15()"></div>
    <div class="form-group"><label class="form-label">IVA ${pct}%
      <span style="font-weight:400; color:var(--gray-400);">(se calcula solo, ajustable)</span></label>
      <input type="number" id="fac-iva" class="form-control" placeholder="0.00" min="0" step="any"
        inputmode="decimal" oninput="_facturaRecalc()"></div>
    <div class="form-group"><label class="form-label">TOTAL impreso en la factura</label>
      <input type="number" id="fac-total" class="form-control" placeholder="0.00" min="0" step="any"
        inputmode="decimal" oninput="_facturaRecalc()"></div>
    <div id="fac-calc" style="background:var(--gray-50); border-radius:10px; padding:12px 14px; margin-bottom:8px;"></div>

    ${sec('3', 'Forma de pago')}
    <div style="display:flex; gap:6px; margin-bottom:10px;">
      ${pagoBtn('efectivo', '💵', 'Efectivo')}
      ${pagoBtn('tarjeta', '💳', 'Tarjeta')}
      ${pagoBtn('transferencia', '🏦', 'Transferencia')}
    </div>
    <div class="form-group"><label class="form-label">Cuenta (de dónde salió el dinero)</label>
      <select id="fac-cuenta" class="form-control">${accOpts}</select></div>
    <div id="fac-efectivo-box">
      <div class="form-group"><label class="form-label">¿Con cuánto pagaste?</label>
        <input type="number" id="fac-pagocon" class="form-control" placeholder="Ej: 20.00" min="0"
          step="any" inputmode="decimal" oninput="_facturaRecalc()"></div>
      <div id="fac-vuelto" style="margin-bottom:8px;"></div>
    </div>

    ${sec('4', 'Deducible (opcional)')}
    <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:12px;
      background:var(--gray-50); border-radius:8px; margin-bottom:8px;">
      <input type="checkbox" id="fac-deducible-on" onchange="toggleFacturaDeducible()"
        style="width:18px; height:18px; accent-color:var(--primary);">
      <div><div style="font-weight:600; font-size:14px;">📋 ¿Cuenta como gasto personal deducible?</div>
      <div style="font-size:12px; color:var(--gray-500);">Para tu declaración de Impuesto a la Renta — no es dinero</div></div>
    </label>
    <div id="fac-deducible-box" style="display:none;">
      <div class="form-group"><label class="form-label">Tipo de deducible</label>
        <select id="fac-deducible-tipo" class="form-control">
          ${dedTipos.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Monto deducible</label>
        <input type="number" id="fac-deducible-monto" class="form-control"
          placeholder="Lo que dice tu factura en DEDUCIBLES" min="0" step="any" inputmode="decimal"></div>
    </div>

    ${sec('5', 'Foto de la factura (opcional)')}
    <input type="file" id="fac-photo-input" accept="image/*"
      onchange="onFacturaPhotoSelected(event)" style="display:none;">
    <div id="fac-photo-area" style="margin-bottom:8px;"></div>

    <button class="btn btn-primary btn-block mt-16" onclick="saveFactura()">✅ Guardar factura</button>
    <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet()">Cancelar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
  _renderFacturaPhotoArea();
  _facturaRecalc();
}

// Cuando cambia la tarifa gravada, recalcula el IVA automáticamente
function _facturaOnT15() {
  const t15   = parseFloat(document.getElementById('fac-t15')?.value) || 0;
  const pct   = DB.getSettings().porcentajeIva || DB.IVA_DEFAULT;
  const ivaEl = document.getElementById('fac-iva');
  if (ivaEl) ivaEl.value = t15 > 0 ? (Math.round(t15 * pct / 100 * 100) / 100) : '';
  _facturaRecalc();
}

// Recalcula subtotal, total, verificación de cuadre y vuelto en vivo
function _facturaRecalc() {
  const num = id => parseFloat(document.getElementById(id)?.value) || 0;
  const t0 = num('fac-t0'), t15 = num('fac-t15'), iva = num('fac-iva');
  const totalImpreso = num('fac-total');
  const subtotal  = t0 + t15;
  const totalCalc = subtotal + iva;
  const sym = DB.getSettings().currencySymbol || '$';
  const pct = DB.getSettings().porcentajeIva || DB.IVA_DEFAULT;

  let verif;
  if (totalImpreso <= 0) {
    verif = `<div style="color:var(--gray-400); font-size:12px;">✍️ Escribe el TOTAL impreso para verificar el cuadre</div>`;
  } else if (Math.abs(totalCalc - totalImpreso) < 0.02) {
    verif = `<div style="color:#16a34a; font-weight:700; font-size:13px;">✅ Cuadra con tu factura</div>`;
  } else {
    verif = `<div style="color:#dc2626; font-weight:700; font-size:13px;">⚠️ No cuadra: tú sumas ${sym} ${fmt(totalCalc)} pero la factura dice ${sym} ${fmt(totalImpreso)}. Revisa los valores.</div>`;
  }
  let ivaNote = '';
  if (t15 > 0 && iva > 0 && Math.abs(iva - t15 * pct / 100) > 0.10) {
    ivaNote = `<div style="color:#d97706; font-size:11px; margin-top:3px;">⚠️ El IVA no parece el ${pct}% de la tarifa gravada (sugerido: ${sym} ${fmt(t15 * pct / 100)})</div>`;
  }
  const calcEl = document.getElementById('fac-calc');
  if (calcEl) calcEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; font-size:13px; padding:3px 0;">
      <span style="color:var(--gray-500);">Subtotal sin IVA</span>
      <span style="font-weight:700;">${sym} ${fmt(subtotal)}</span></div>
    <div style="display:flex; justify-content:space-between; font-size:14px; padding:5px 0 3px;
      border-top:1px solid var(--gray-200); margin-top:2px;">
      <span style="font-weight:800;">Total calculado</span>
      <span style="font-weight:800; color:var(--primary);">${sym} ${fmt(totalCalc)}</span></div>
    <div style="margin-top:6px;">${verif}${ivaNote}</div>`;

  const vEl = document.getElementById('fac-vuelto');
  if (vEl && _facturaPago === 'efectivo') {
    const pagoCon  = num('fac-pagocon');
    const totalRef = totalImpreso > 0 ? totalImpreso : totalCalc;
    if (pagoCon > 0 && totalRef > 0) {
      const vuelto = pagoCon - totalRef;
      vEl.innerHTML = vuelto >= 0
        ? `<div style="color:#16a34a; font-weight:700; font-size:13px;">💵 Tu vuelto: ${sym} ${fmt(vuelto)}</div>`
        : `<div style="color:#dc2626; font-weight:700; font-size:13px;">⚠️ Falta ${sym} ${fmt(-vuelto)} para cubrir el total</div>`;
    } else { vEl.innerHTML = ''; }
  }
}

function selectFacturaPago(metodo) {
  _facturaPago = metodo;
  ['efectivo', 'tarjeta', 'transferencia'].forEach(m => {
    const btn = document.getElementById('fac-pago-' + m);
    if (!btn) return;
    const on = m === metodo;
    btn.style.borderColor = on ? 'var(--primary)' : 'var(--gray-200)';
    btn.style.background  = on ? 'var(--primary-light)' : 'var(--white)';
    btn.style.color       = on ? 'var(--primary)' : 'var(--gray-400)';
    btn.style.fontWeight  = on ? '800' : '600';
  });
  const box = document.getElementById('fac-efectivo-box');
  if (box) box.style.display = metodo === 'efectivo' ? 'block' : 'none';
  _facturaRecalc();
}

function toggleFacturaDeducible() {
  const on  = document.getElementById('fac-deducible-on')?.checked;
  const box = document.getElementById('fac-deducible-box');
  if (box) box.style.display = on ? 'block' : 'none';
}

function onFacturaPhotoSelected(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) { showToast('⚠️ Selecciona una imagen'); return; }
  showToast('🖼️ Procesando foto…', 1200);
  _compressImage(file, 1280, 0.7)
    .then(dataUrl => { _facturaPhoto = dataUrl; _renderFacturaPhotoArea(); showToast('✅ Foto adjuntada', 1500); })
    .catch(() => showToast('❌ No se pudo procesar la imagen', 2500));
}

function _renderFacturaPhotoArea() {
  const area = document.getElementById('fac-photo-area');
  if (!area) return;
  if (_facturaPhoto) {
    area.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center; background:#f0fdf4;
        border:1.5px solid #86efac; border-radius:10px; padding:10px;">
        <img src="${_facturaPhoto}" onclick="_openPhotoViewer(_facturaPhoto)"
          style="width:58px; height:58px; object-fit:cover; border-radius:8px; cursor:pointer; flex-shrink:0;">
        <div style="flex:1; font-size:12px; color:#166534; font-weight:700;">✅ Foto de factura adjuntada
          <div style="font-weight:400; color:var(--gray-500); font-size:11px;">Toca para ampliarla</div></div>
        <button type="button" onclick="_removeFacturaPhoto()" style="background:none; border:none;
          color:var(--danger); font-size:13px; font-weight:700; cursor:pointer;">Quitar</button>
      </div>`;
  } else {
    area.innerHTML = `
      <button type="button" onclick="document.getElementById('fac-photo-input').click()"
        style="width:100%; padding:14px; border:1.5px dashed var(--gray-300); border-radius:10px;
          background:var(--gray-50); color:var(--gray-500); font-size:13px; font-weight:600; cursor:pointer;">
        📷 Tomar foto o elegir de la galería
      </button>`;
  }
}

function _removeFacturaPhoto() { _facturaPhoto = null; _renderFacturaPhotoArea(); }

function saveFactura() {
  const val = id => document.getElementById(id)?.value;
  const num = id => parseFloat(document.getElementById(id)?.value) || 0;
  const fecha     = val('fac-fecha');
  const proveedor = (val('fac-proveedor') || '').trim();
  const concepto  = (val('fac-concepto')  || '').trim();
  const categoria = val('fac-categoria') || '';
  const t0    = num('fac-t0');
  const t15   = num('fac-t15');
  const iva   = num('fac-iva');
  const total = num('fac-total');
  const cuenta = val('fac-cuenta') || '';
  const base = t0 + t15;

  if (!fecha)    { showToast('⚠️ Selecciona la fecha de la factura'); return; }
  if (base <= 0) { showToast('⚠️ Ingresa los valores (tarifa 0% o tarifa gravada)'); return; }
  if (!cuenta)   { showToast('⚠️ Selecciona la cuenta de donde salió el dinero'); return; }

  let deducible = null;
  if (document.getElementById('fac-deducible-on')?.checked) {
    const monto = num('fac-deducible-monto');
    if (monto <= 0) { showToast('⚠️ Ingresa el monto del deducible'); return; }
    deducible = { tipo: val('fac-deducible-tipo') || 'alimentacion', amount: monto };
  }

  const totalCalc = base + iva;
  if (total > 0 && Math.abs(totalCalc - total) >= 0.02) {
    if (!confirm(`Los valores no cuadran con el total de la factura.\nTú sumas ${fmt(totalCalc)}, la factura dice ${fmt(total)}.\n\n¿Guardar de todos modos?`)) return;
  }

  const tx = DB.addFacturaCompra({
    date: fecha, proveedor, concepto, category: categoria,
    tarifa0: t0, tarifa15: t15, iva, total: total > 0 ? total : totalCalc,
    formaPago: _facturaPago, account: cuenta,
    hasReceipt: !!_facturaPhoto, deducible,
  });
  if (_facturaPhoto && tx) DB.savePhoto(tx.id, _facturaPhoto);

  closeSettingsSheet();
  showToast('✅ Factura registrada' + (deducible ? ' (con deducible)' : ''), 3000);
  navigate('dashboard');
}

// ── Panel de Deudas (se abre desde la insignia roja del tablero) ─────────────
function openDebtsPanel() {
  const sym   = DB.getSettings().currencySymbol || '$';
  const debts = DB.getPendingLiabilities()
    .filter(t => !t.isIva)
    .sort((a, b) => (a.liabilityEndDate || '9999-99').localeCompare(b.liabilityEndDate || '9999-99'));
  const total       = debts.reduce((s, t) => s + t.amount, 0);
  const totalMensual = debts.reduce((s, t) => s + (parseFloat(t.liabilityMonthly) || 0), 0);

  const rows = debts.map(t => {
    const cat    = DB.getCategoryById(t.category);
    const titulo = t.creditor || (cat ? cat.name : 'Deuda');
    const fechas = [];
    if (t.date)              fechas.push('Inicio: ' + fmtDate(t.date));
    if (t.liabilityEndDate)  fechas.push('Vence: ' + fmtDate(t.liabilityEndDate));
    const mensual = (parseFloat(t.liabilityMonthly) || 0) > 0
      ? `<div style="font-size:11px; color:var(--primary); font-weight:700; margin-top:2px;">💵 Cuota: ${sym} ${fmt(t.liabilityMonthly)}/mes</div>`
      : '';
    return `
      <div onclick="closeSettingsSheet(); setTimeout(()=>openTxDetail('${t.id}'),220);"
        style="background:var(--white); border:1.5px solid var(--gray-100); border-radius:12px;
          padding:12px 14px; margin-bottom:8px; cursor:pointer; display:flex;
          justify-content:space-between; align-items:flex-start; gap:10px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:14px; font-weight:800;">🔴 ${titulo}</div>
          ${fechas.length ? `<div style="font-size:11px; color:var(--gray-400); margin-top:2px;">${fechas.join(' · ')}</div>` : ''}
          ${mensual}
        </div>
        <div style="font-size:16px; font-weight:900; color:var(--danger); white-space:nowrap;">${sym} ${fmt(t.amount)}</div>
      </div>`;
  }).join('');

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">🔴 Mis Deudas</h3>
    ${debts.length === 0 ? `
      <div style="text-align:center; padding:36px 0; color:var(--gray-400);">
        <div style="font-size:44px; margin-bottom:10px;">✅</div>
        <div style="font-weight:700;">No tienes deudas pendientes</div>
      </div>
    ` : `
      <div style="background:linear-gradient(135deg,#dc2626,#b91c1c); border-radius:14px;
        padding:16px; color:#fff; margin-bottom:14px; text-align:center;">
        <div style="font-size:12px; opacity:.85;">Total que debes</div>
        <div style="font-size:28px; font-weight:900; margin-top:2px;">${sym} ${fmt(total)}</div>
        <div style="font-size:11px; opacity:.85; margin-top:4px;">
          ${debts.length} deuda${debts.length !== 1 ? 's' : ''} pendiente${debts.length !== 1 ? 's' : ''}${totalMensual > 0 ? ` · cuotas ${sym} ${fmt(totalMensual)}/mes` : ''}
        </div>
      </div>
      ${rows}
    `}
    <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

// Pista en vivo del formulario de deuda: plazo y cuota sugerida
function _liabilityHint() {
  const el = document.getElementById('liability-hint');
  if (!el) return;
  const total   = parseFloat(document.getElementById('f-amount')?.value) || 0;
  const inicio  = document.getElementById('f-date')?.value;
  const fin     = document.getElementById('f-liability-end')?.value;
  const mensual = parseFloat(document.getElementById('f-liability-monthly')?.value) || 0;
  const sym = DB.getSettings().currencySymbol || '$';
  const parts = [];
  if (inicio && fin) {
    const d1 = new Date(inicio + 'T12:00:00'), d2 = new Date(fin + 'T12:00:00');
    const meses = Math.round((d2 - d1) / (1000 * 60 * 60 * 24 * 30.44));
    if (meses >= 1) {
      parts.push(`Plazo ≈ ${meses} mes${meses !== 1 ? 'es' : ''}`);
      if (total > 0 && mensual <= 0) parts.push(`cuota sugerida ${sym} ${fmt(total / meses)}/mes`);
    }
  }
  if (total > 0 && mensual > 0) {
    const m = Math.ceil(total / mensual);
    parts.push(`a ${sym} ${fmt(mensual)}/mes se salda en ≈ ${m} mes${m !== 1 ? 'es' : ''}`);
  }
  el.innerHTML = parts.length
    ? `<span style="color:var(--gray-500);">💡 ${parts.join(' · ')}</span>` : '';
}

// ── Reporte: Mis Deducibles del año ──────────────────────────────────────────
let _deducibleYear = new Date().getFullYear();

function openDeduciblesReport() {
  _deducibleYear = new Date().getFullYear();
  _renderDeduciblesReport();
}

function _changeDeducibleYear(delta) {
  _deducibleYear += delta;
  _renderDeduciblesReport();
}

function _renderDeduciblesReport() {
  const sum = DB.getDeducibleSummary(_deducibleYear);
  const sym = DB.getSettings().currencySymbol || '$';
  const TIPO = {
    alimentacion: '🍽️ Alimentación', salud: '⚕️ Salud', vivienda: '🏠 Vivienda',
    educacion: '📚 Educación', vestimenta: '👕 Vestimenta', turismo: '✈️ Turismo',
  };
  const byTipoHTML = Object.keys(sum.byTipo).length
    ? Object.entries(sum.byTipo).map(([t, v]) => `
        <div style="display:flex; justify-content:space-between; padding:9px 0;
          border-bottom:1px solid var(--gray-100); font-size:14px;">
          <span>${TIPO[t] || t}</span><span style="font-weight:700;">${sym} ${fmt(v)}</span></div>`).join('')
    : `<div style="text-align:center; color:var(--gray-400); padding:16px; font-size:13px;">
        Sin deducibles registrados este año</div>`;

  const itemsHTML = sum.items.map(d => `
    <div style="display:flex; justify-content:space-between; padding:9px 0;
      border-bottom:1px solid var(--gray-50); font-size:13px;">
      <div><div style="font-weight:600;">${TIPO[d.tipo] || d.tipo}</div>
        <div style="font-size:11px; color:var(--gray-400);">${fmtDate(d.date)}${d.description ? ' · ' + d.description : ''}</div></div>
      <span style="font-weight:700;">${sym} ${fmt(d.amount)}</span></div>`).join('');

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">📋 Mis Deducibles</h3>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
      <button onclick="_changeDeducibleYear(-1)" style="width:38px; height:38px; border-radius:8px;
        background:var(--gray-100); border:none; cursor:pointer; font-size:18px;">‹</button>
      <span style="font-weight:800; font-size:18px;">${_deducibleYear}</span>
      <button onclick="_changeDeducibleYear(1)" style="width:38px; height:38px; border-radius:8px;
        background:var(--gray-100); border:none; cursor:pointer; font-size:18px;">›</button>
    </div>
    <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8); border-radius:14px;
      padding:18px; color:#fff; margin-bottom:14px; text-align:center;">
      <div style="font-size:12px; opacity:.85;">Total deducible ${_deducibleYear}</div>
      <div style="font-size:30px; font-weight:900; margin-top:4px;">${sym} ${fmt(sum.total)}</div>
      <div style="font-size:11px; opacity:.8; margin-top:6px;">No es dinero — es el monto que llevas a tu declaración de renta</div>
    </div>
    <div style="font-size:11px; font-weight:800; color:var(--gray-500); text-transform:uppercase;
      letter-spacing:.5px; margin-bottom:2px;">Por tipo</div>
    <div style="margin-bottom:16px;">${byTipoHTML}</div>
    ${sum.items.length ? `
      <div style="font-size:11px; font-weight:800; color:var(--gray-500); text-transform:uppercase;
        letter-spacing:.5px; margin-bottom:2px;">Detalle (${sum.items.length})</div>
      <div>${itemsHTML}</div>` : ''}
    <button class="btn btn-secondary btn-block mt-16" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

// ── Liquidación IVA Anual ────────────────────────────────────────────────────
let ivaTableOpen = false;
let ivaTableYear = new Date().getFullYear();

const MONTH_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function toggleIvaTable() {
  ivaTableOpen = !ivaTableOpen;
  document.getElementById('iva-annual-view').style.display = ivaTableOpen ? 'block' : 'none';
  document.getElementById('iva-table-toggle-icon').textContent = ivaTableOpen ? '▲' : '▼';
  if (ivaTableOpen) renderIvaTable();
}

function renderIvaTable() {
  const sym = DB.getSettings().currencySymbol || '$';
  document.getElementById('iva-table-year-label').textContent = ivaTableYear;

  let totCob = 0, totCred = 0, totNeto = 0;
  const rows = Array.from({ length: 12 }, (_, i) => {
    const m    = i + 1;
    const st   = DB.getMonthStats(ivaTableYear, m);
    const neto = st.ivaPorPagar; // cobrado - crédito
    totCob  += st.ivaCobrado;
    totCred += st.ivaCredito;
    totNeto += neto;
    const hasData   = st.ivaCobrado > 0 || st.ivaCredito > 0;
    const netoColor = neto > 0 ? '#dc2626' : neto < 0 ? '#16a34a' : 'var(--gray-400)';
    const netoLabel = neto > 0
      ? `<span style="color:#dc2626;font-weight:800;">−${fmt(neto)}</span>`
      : neto < 0
        ? `<span style="color:#16a34a;font-weight:800;">+${fmt(Math.abs(neto))}</span>`
        : `<span style="color:var(--gray-300);">—</span>`;

    return `
      <tr style="background:${i % 2 === 0 ? 'var(--gray-50)' : 'var(--white)'}; cursor:${hasData?'pointer':'default'};"
          onclick="${hasData ? `_openIvaForMonth(${ivaTableYear},${m})` : ''}">
        <td style="padding:7px 10px; font-weight:${hasData?'700':'400'}; color:${hasData?'var(--gray-900)':'var(--gray-400)'};">
          ${MONTH_SHORT[i]} ${ivaTableYear}
        </td>
        <td style="padding:7px 8px; text-align:right; color:#2563eb; font-weight:${st.ivaCobrado>0?'700':'400'};">
          ${st.ivaCobrado > 0 ? fmt(st.ivaCobrado) : '—'}
        </td>
        <td style="padding:7px 8px; text-align:right; color:#0891b2; font-weight:${st.ivaCredito>0?'700':'400'};">
          ${st.ivaCredito > 0 ? fmt(st.ivaCredito) : '—'}
        </td>
        <td style="padding:7px 10px; text-align:right;">${netoLabel}</td>
      </tr>`;
  }).join('');

  document.getElementById('iva-annual-tbody').innerHTML = rows;

  // Pie con totales
  const netoFinal     = totNeto;
  const netoFinalColor = netoFinal >= 0 ? '#dc2626' : '#16a34a';
  document.getElementById('iva-annual-tfoot').innerHTML = `
    <tr style="background:var(--primary); color:white; font-weight:800;">
      <td style="padding:8px 10px; border-radius:0 0 0 6px;">TOTAL ${ivaTableYear}</td>
      <td style="padding:8px 8px; text-align:right;">${fmt(totCob)}</td>
      <td style="padding:8px 8px; text-align:right;">${fmt(totCred)}</td>
      <td style="padding:8px 10px; text-align:right; border-radius:0 0 6px 0;">${fmt(Math.abs(netoFinal))}</td>
    </tr>`;

  // KPIs anuales
  const kpiData = [
    { label:'IVA Cobrado', value: totCob,  color:'#2563eb', icon:'📈',
      sub: 'Recibes de tus clientes' },
    { label:'IVA Crédito', value: totCred, color:'#0891b2', icon:'📉',
      sub: 'Pagas a proveedores' },
    { label: netoFinal >= 0 ? 'A pagar SRI' : 'A favor',
      value: Math.abs(netoFinal), color: netoFinalColor, icon: netoFinal >= 0 ? '🔴' : '✅',
      sub: netoFinal >= 0 ? 'Debes declarar' : 'Crédito tributario' },
  ];
  document.getElementById('iva-annual-kpis').innerHTML = kpiData.map(k => `
    <div style="background:var(--gray-50); border-radius:10px; padding:10px 8px; text-align:center;">
      <div style="font-size:18px; margin-bottom:4px;">${k.icon}</div>
      <div style="font-size:10px; color:var(--gray-500); font-weight:600; margin-bottom:3px;">${k.label}</div>
      <div style="font-size:13px; font-weight:800; color:${k.color};">${fmt(k.value)}</div>
      <div style="font-size:10px; color:var(--gray-400); margin-top:2px;">${k.sub}</div>
    </div>`).join('');
}

function _openIvaForMonth(year, month) {
  _ivaRepYear  = year;
  _ivaRepMonth = month;
  _renderIvaReport();
}

function exportIvaExcel() {
  const s   = DB.getSettings();
  const sym = s.currencySymbol || '$';
  let totCob = 0, totCred = 0, totNeto = 0;

  const header = [
    { v: 'Mes',         s: 'header' },
    { v: 'IVA Cobrado', s: 'header' },
    { v: 'IVA Crédito', s: 'header' },
    { v: 'IVA Neto',    s: 'header' },
    { v: 'Estado',      s: 'header' },
  ];

  const dataRows = Array.from({ length: 12 }, (_, i) => {
    const m    = i + 1;
    const st   = DB.getMonthStats(ivaTableYear, m);
    const neto = st.ivaPorPagar;
    totCob  += st.ivaCobrado;
    totCred += st.ivaCredito;
    totNeto += neto;
    return [
      { v: MONTH_SHORT[i] + ' ' + ivaTableYear, s: 'label' },
      { v: st.ivaCobrado > 0 ? st.ivaCobrado : null, s: 'money' },
      { v: st.ivaCredito > 0 ? st.ivaCredito : null, s: 'money' },
      { v: Math.abs(neto) > 0 ? Math.abs(neto) : null, s: 'money' },
      { v: st.ivaCobrado === 0 && st.ivaCredito === 0
            ? 'Sin IVA'
            : neto > 0 ? 'A pagar SRI'
            : neto < 0 ? 'Crédito tributario'
            : 'Neutro',
        s: 'text' },
    ];
  });

  const totalesRow = [
    { v: 'TOTALES ' + ivaTableYear, s: 'totalLabel' },
    { v: totCob,               s: 'moneyBold' },
    { v: totCred,              s: 'moneyBold' },
    { v: Math.abs(totNeto),    s: 'moneyBold' },
    { v: totNeto >= 0 ? 'A pagar SRI' : 'Crédito tributario', s: 'text' },
  ];

  const rows = [
    [{ v: s.companyName || 'Mi Negocio', s: 'title', merge: 4 }],
    [{ v: 'Liquidación IVA ' + ivaTableYear + ' — Declaración SRI Form 104', s: 'subtitle', merge: 4 }],
    [{ v: 'Exportado el ' + new Date().toLocaleDateString('es-CO', {day:'2-digit',month:'long',year:'numeric'}), merge: 4 }],
    [],
    header,
    ...dataRows,
    [],
    totalesRow,
    [],
    [{ v: 'NOTA: IVA Neto positivo = debes pagar al SRI. Negativo = crédito tributario que llevas al siguiente mes.' }],
  ];

  const filename = 'IVA_' + (s.companyName || 'Negocio').replace(/\s+/g,'-') + '_' + ivaTableYear + '.xlsx';
  try {
    const bytes = _buildXlsx([{
      name: 'IVA ' + ivaTableYear,
      cols: [110, 130, 130, 130, 160],
      rows,
    }], sym);
    _downloadXlsx(bytes, filename);
    DB.logAudit('export_excel', '🧾 IVA anual exportado: ' + filename);
    showToast('📥 Excel IVA ' + ivaTableYear + ' descargado', 3000);
  } catch (err) {
    showToast('❌ Error al generar Excel: ' + err.message, 4000);
  }
}

// ── Reporte: Detalle del IVA del mes (de dónde proviene cada asiento) ─────────
let _ivaRepYear  = new Date().getFullYear();
let _ivaRepMonth = new Date().getMonth() + 1;

function openIvaReport() {
  _ivaRepYear  = reportYear;   // arranca en el mes que se está viendo en Reportes
  _ivaRepMonth = reportMonth;
  _renderIvaReport();
}

function _changeIvaRepMonth(delta) {
  _ivaRepMonth += delta;
  if (_ivaRepMonth > 12) { _ivaRepMonth = 1;  _ivaRepYear++; }
  if (_ivaRepMonth < 1)  { _ivaRepMonth = 12; _ivaRepYear--; }
  _renderIvaReport();
}

function _renderIvaReport() {
  const sym = DB.getSettings().currencySymbol || '$';
  const ivaTxs  = DB.getTransactionsByMonth(_ivaRepYear, _ivaRepMonth).filter(t => t.isIva);
  const cobrado = ivaTxs.filter(t => t.ivaDirection === 'cobrado');
  const credito = ivaTxs.filter(t => t.ivaDirection === 'credito');
  const totCob  = cobrado.reduce((s, t) => s + t.amount, 0);
  const totCred = credito.reduce((s, t) => s + t.amount, 0);
  const neto    = totCob - totCred;
  const aPagar  = neto >= 0;
  const monthLabel = new Date(_ivaRepYear, _ivaRepMonth - 1, 1)
    .toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  // Una fila por asiento de IVA, mostrando la transacción de origen
  const ivaRow = t => {
    const parent  = t.linkedParentId ? DB.getTransactionById(t.linkedParentId) : null;
    const srcDesc = parent ? parent.description : t.description.replace(/^IVA[^·]*·\s*/, '');
    const baseAmt = parent ? parent.amount : 0;
    const isSplit = parent && Array.isArray(parent.splitPayments) && parent.splitPayments.length;
    const acc     = (parent && parent.account) ? DB.getAccountById(parent.account) : null;
    const accTxt  = isSplit ? '💳 pago dividido' : (acc ? acc.emoji + ' ' + acc.name : 'Sin cuenta');
    const tap     = parent
      ? `onclick="closeSettingsSheet(); setTimeout(()=>openTxDetail('${parent.id}'),220);" style="cursor:pointer;"`
      : '';
    return `
      <div ${tap} style="display:flex; align-items:center; gap:10px; padding:9px 0;
        border-bottom:1px solid var(--gray-50);">
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${srcDesc}</div>
          <div style="font-size:11px; color:var(--gray-400);">${fmtDate(t.date)} · Base: ${sym} ${fmt(baseAmt)} · ${accTxt}</div>
        </div>
        <div style="font-size:14px; font-weight:800; color:var(--primary); flex-shrink:0;">${sym} ${fmt(t.amount)}</div>
        ${parent ? '<div style="color:var(--gray-300); font-size:15px;">›</div>' : ''}
      </div>`;
  };
  const listOrEmpty = (arr, msg) => arr.length
    ? arr.map(ivaRow).join('')
    : `<div style="text-align:center; color:var(--gray-400); padding:14px; font-size:13px;">${msg}</div>`;

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">🧾 IVA</h3>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
      <button onclick="_changeIvaRepMonth(-1)" style="width:38px; height:38px; border-radius:8px;
        background:var(--gray-100); border:none; cursor:pointer; font-size:18px;">‹</button>
      <span style="font-weight:800; font-size:16px; text-transform:capitalize;">${monthLabel}</span>
      <button onclick="_changeIvaRepMonth(1)" style="width:38px; height:38px; border-radius:8px;
        background:var(--gray-100); border:none; cursor:pointer; font-size:18px;">›</button>
    </div>

    <div style="background:linear-gradient(135deg,${aPagar ? '#2563eb,#1d4ed8' : '#16a34a,#15803d'});
      border-radius:14px; padding:18px; color:#fff; margin-bottom:16px; text-align:center;">
      <div style="font-size:12px; opacity:.85;">${aPagar ? 'IVA a pagar al SRI' : 'IVA a favor (crédito)'}</div>
      <div style="font-size:30px; font-weight:900; margin-top:4px;">${sym} ${fmt(Math.abs(neto))}</div>
      <div style="font-size:11px; opacity:.85; margin-top:6px;">
        Cobrado ${sym} ${fmt(totCob)} − Crédito ${sym} ${fmt(totCred)}
      </div>
    </div>

    <div style="font-size:11px; font-weight:800; color:#16a34a; text-transform:uppercase;
      letter-spacing:.5px; margin-bottom:2px;">📈 IVA cobrado en ventas · ${sym} ${fmt(totCob)}</div>
    <div style="margin-bottom:16px;">${listOrEmpty(cobrado, 'Sin ventas con IVA este mes')}</div>

    <div style="font-size:11px; font-weight:800; color:#0891b2; text-transform:uppercase;
      letter-spacing:.5px; margin-bottom:2px;">📉 IVA crédito en compras · ${sym} ${fmt(totCred)}</div>
    <div style="margin-bottom:10px;">${listOrEmpty(credito, 'Sin compras con IVA este mes')}</div>

    <div style="background:var(--gray-50); border-radius:10px; padding:11px 13px; font-size:12px;
      color:var(--gray-500); line-height:1.5;">
      💡 Toca cualquier asiento para ver la transacción de donde proviene el IVA.
    </div>

    <button class="btn btn-secondary btn-block mt-16" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function renderForm(editId = null) {
  editingTxId = editId || null;
  const isEdit = !!editId;
  let tx = isEdit ? DB.getTransactionById(editId) : null;
  if (tx) formType = tx.type;

  document.getElementById('form-title').textContent = isEdit ? 'Editar Transacción' : 'Nueva Transacción';
  document.getElementById('btn-delete-tx').style.display = isEdit ? 'flex' : 'none';

  // Poblar campos estáticos desde la transacción (editar) o limpiarlos (nuevo)
  const amountEl = document.getElementById('f-amount');
  const descEl   = document.getElementById('f-desc');
  const dateEl   = document.getElementById('f-date');
  const notesEl  = document.getElementById('f-notes');
  if (tx) {
    // Al editar: si el IVA está incluido, mostrar el TOTAL que el usuario tecleó
    // (la transacción guarda solo la base); si es +IVA o sin IVA, mostrar el monto tal cual.
    if (amountEl) amountEl.value = (tx.ivaType === 'IVA_INCLUIDO' && tx.ivaTotal)
      ? tx.ivaTotal : tx.amount;
    if (descEl)   descEl.value   = tx.description;
    if (dateEl)   dateEl.value   = tx.date;
    if (notesEl)  notesEl.value  = tx.notes || '';
    _formIvaType = tx.ivaType || 'IVA_INCLUIDO'; // cargar IVA guardado
    // Cargar la foto del comprobante (si tiene) desde IndexedDB — asíncrono
    _formPhoto = null;
    if (tx.hasReceipt) {
      DB.getPhoto(tx.id).then(p => { _formPhoto = p; _renderReceiptArea(); });
    }
  } else {
    if (amountEl) amountEl.value = '';
    if (descEl)   descEl.value   = '';
    if (dateEl)   dateEl.value   = today();
    if (notesEl)  notesEl.value  = '';
    _formIvaType = 'IVA_INCLUIDO'; // default para transacción nueva
    _formPhoto   = null;
  }
  _hideSuggestions(); // cerrar sugerencias al abrir el formulario

  updateTypeTabs();
  renderFormFields(tx);
}

function updateTypeTabs() {
  document.querySelectorAll('.type-tab').forEach(tab => {
    tab.className = 'type-tab' + (tab.dataset.type === formType ? ' active-' + formType : '');
  });
  renderFormFields(editingTxId ? DB.getTransactionById(editingTxId) : null);
}

function setFormType(type) { formType = type; updateTypeTabs(); }

// Renderiza los campos dinámicamente según el tipo
function renderFormFields(tx) {
  const container = document.getElementById('form-dynamic-fields');
  const isTransfer   = formType === 'transfer';
  const isLiability  = formType === 'liability';
  const isIncome     = formType === 'income';
  const isExpense    = formType === 'expense';

  // Categorías filtradas por tipo
  const catOptions = isTransfer ? '' :
    '<option value="">— Categoría (opcional) —</option>' +
    DB.getCategoriesByType(isLiability ? 'liability' : formType)
      .map(c => `<option value="${c.id}" ${tx?.category === c.id ? 'selected' : ''}>${c.emoji} ${c.name}</option>`)
      .join('');

  // Cuentas
  const accOptions = acc =>
    '<option value="">— Cuenta (opcional) —</option>' +
    DB.getAccounts().map(a => `<option value="${a.id}" ${tx?.[acc] === a.id ? 'selected' : ''}>${a.emoji} ${a.name}</option>`).join('');

  // Productos para inventario
  const products = DB.getInventory();
  const prodOptions = '<option value="">— Seleccionar producto —</option>' +
    products.map(p => `<option value="${p.id}" ${tx?.productId === p.id ? 'selected' : ''}>${p.emoji || '📦'} ${p.name} (Stock: ${p.quantity} ${p.unit})</option>`).join('');

  let html = '';

  if (isTransfer) {
    // TRASLADO: origen → destino (sin categoría)
    html += `
      <div style="background:var(--primary-light); border-radius:10px; padding:12px; margin-bottom:16px; font-size:13px; color:var(--primary); font-weight:600;">
        ↔️ Un traslado mueve dinero entre tus cuentas. <strong>No afecta ingresos ni gastos.</strong>
      </div>
      <div class="form-group">
        <label class="form-label">Cuenta Origen (de)</label>
        <select id="f-from-account" class="form-control">${accOptions('fromAccount')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Cuenta Destino (a)</label>
        <select id="f-to-account" class="form-control">${accOptions('toAccount')}</select>
      </div>
    `;
  } else if (isLiability) {
    // DEUDA: con categoría de pasivos y estado
    html += `
      <div style="background:#fef3c7; border-radius:10px; padding:12px; margin-bottom:16px; font-size:13px; color:#92400e; font-weight:600;">
        🔴 Una deuda es dinero que <strong>debes</strong>. No afecta tu resultado hasta que la pagues.
      </div>
      <div class="form-group">
        <label class="form-label">Categoría de deuda</label>
        <select id="f-category" class="form-control">${catOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Acreedor (¿a quién le debes?)</label>
        <input type="text" id="f-creditor" class="form-control" value="${tx?.creditor || ''}" placeholder="Ej: Alianza del Valle, Banco X">
      </div>
      <div class="form-group">
        <label class="form-label">🏁 Vencimiento (fin de la deuda)</label>
        <input type="date" id="f-liability-end" class="form-control"
          value="${tx?.liabilityEndDate || ''}" onchange="_liabilityHint()">
      </div>
      <div class="form-group">
        <label class="form-label">💵 Monto mensual a pagar (opcional)</label>
        <input type="number" id="f-liability-monthly" class="form-control"
          value="${tx?.liabilityMonthly || ''}" placeholder="Ej: 100.00" min="0" step="any"
          inputmode="decimal" oninput="_liabilityHint()">
        <div id="liability-hint" style="font-size:12px; min-height:16px; margin-top:4px;"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Estado</label>
        <select id="f-liability-status" class="form-control">
          <option value="pending" ${tx?.liabilityStatus !== 'paid' ? 'selected' : ''}>🔴 Pendiente de pago</option>
          <option value="paid"    ${tx?.liabilityStatus === 'paid'  ? 'selected' : ''}>✅ Pagada</option>
        </select>
      </div>
    `;
  } else {
    // INGRESO o GASTO: categoría + cuenta (con opción de pago dividido) + IVA + inventario
    const splitOn      = !!(tx && Array.isArray(tx.splitPayments) && tx.splitPayments.length === 2);
    const acc1Sel      = splitOn ? tx.splitPayments[0].account : (tx?.account || '');
    const acc2Sel      = splitOn ? tx.splitPayments[1].account : '';
    const split2Amount = splitOn ? tx.splitPayments[1].amount  : '';
    const accSel = sel => '<option value="">— Cuenta —</option>' +
      DB.getAccounts().map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${a.emoji} ${a.name}</option>`).join('');

    html += `
      <div class="form-group">
        <label class="form-label">Categoría</label>
        <select id="f-category" class="form-control">${catOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Cuenta</label>
        <select id="f-account" class="form-control">${accSel(acc1Sel)}</select>
      </div>
      <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:10px 12px;
        background:var(--gray-50); border-radius:8px; margin-bottom:12px;">
        <input type="checkbox" id="f-split-on" ${splitOn ? 'checked' : ''} onchange="toggleSplitPayment()"
          style="width:18px; height:18px; accent-color:var(--primary);">
        <div style="font-size:13px; font-weight:600;">💳 El pago se dividió en 2 cuentas</div>
      </label>
      <div id="split-section" style="display:${splitOn ? 'block' : 'none'};">
        <div class="form-group">
          <label class="form-label">Segunda cuenta</label>
          <select id="f-account2" class="form-control">${accSel(acc2Sel)}</select>
        </div>
        <div class="form-group">
          <label class="form-label">¿Cuánto se recibió / pagó en la 2da cuenta?</label>
          <input type="number" id="f-split-amount" class="form-control" value="${split2Amount}"
            placeholder="0.00" min="0" step="any" inputmode="decimal" oninput="_updateSplitInfo()">
        </div>
        <div id="split-info" style="font-size:12px; min-height:16px; margin-bottom:8px;"></div>
      </div>
    `;

    // ── Selector de IVA ──────────────────────────────────────
    const ivaPct     = DB.getSettings().porcentajeIva || DB.IVA_DEFAULT;
    const ivaOptions = [
      ['SIN_IVA',         '🚫', 'Sin IVA'],
      ['IVA_NO_INCLUIDO', '➕', '+' + ivaPct + '% IVA'],
      ['IVA_INCLUIDO',    '✅', 'IVA incluido'],
    ];
    html += `
      <div class="form-group">
        <label class="form-label">🧾 IVA / Impuesto</label>
        <div style="display:flex; gap:6px; margin-bottom:6px;">
          ${ivaOptions.map(([t, ico, lbl]) => `
            <button type="button" id="iva-btn-${t}" onclick="selectIva('${t}')"
              style="flex:1; padding:10px 4px; border-radius:10px; font-size:11px; line-height:1.5;
                cursor:pointer; text-align:center; transition:all .15s;
                border:2px solid ${_formIvaType === t ? 'var(--primary)' : 'var(--gray-200)'};
                background:${_formIvaType === t ? 'var(--primary-light)' : 'var(--white)'};
                color:${_formIvaType === t ? 'var(--primary)' : 'var(--gray-400)'};
                font-weight:${_formIvaType === t ? '800' : '600'};">
              ${ico}<br>${lbl}
            </button>`).join('')}
        </div>
        <div id="iva-breakdown" style="font-size:12px; min-height:18px;"></div>
      </div>
    `;

    // Sección inventario (solo si hay productos)
    if (products.length) {
      const checked = tx?.affectsInventory ? 'checked' : '';
      html += `
        <div class="form-group">
          <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:12px; background:var(--gray-50); border-radius:8px;">
            <input type="checkbox" id="f-affects-inv" ${checked} onchange="toggleInventorySection()" style="width:18px;height:18px; accent-color:var(--primary);">
            <div>
              <div style="font-weight:600; font-size:14px;">📦 ${isExpense ? 'Esta compra' : 'Esta venta'} afecta inventario</div>
              <div style="font-size:12px; color:var(--gray-500);">${isExpense ? 'Suma stock al producto' : 'Resta stock del producto'}</div>
            </div>
          </label>
        </div>
        <div id="inv-section" style="display:${tx?.affectsInventory ? 'block' : 'none'}">
          <div class="form-group">
            <label class="form-label">Producto</label>
            <select id="f-product" class="form-control">${prodOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Cantidad ${isExpense ? 'comprada' : 'vendida'}</label>
            <input type="number" id="f-quantity" class="form-control" value="${tx?.quantity || ''}" placeholder="Ej: 6" min="0" step="1">
          </div>
        </div>
      `;
    } else {
      html += `
        <div style="background:var(--gray-50); border-radius:8px; padding:12px; margin-bottom:12px; font-size:13px; color:var(--gray-500); text-align:center;">
          📦 Agrega productos en <strong>Inventario</strong> para activar el control de stock.
        </div>
      `;
    }
  }

  // Foto de comprobante / factura — disponible en ingreso, gasto y deuda
  if (!isTransfer) html += _receiptSectionHTML();

  container.innerHTML = html;
  _renderReceiptArea(); // pinta el estado actual de la foto
  _updateSplitInfo();   // pinta el reparto del pago dividido (si aplica)
  _liabilityHint();     // pinta la pista de plazo/cuota (si es deuda)

  // La etiqueta de "Fecha" cambia de significado en una deuda
  const dateLabel = document.getElementById('f-date-label');
  if (dateLabel) dateLabel.textContent = isLiability ? '📅 Inicio de la deuda *' : 'Fecha *';
}

function toggleInventorySection() {
  const cb  = document.getElementById('f-affects-inv');
  const sec = document.getElementById('inv-section');
  if (sec) sec.style.display = cb?.checked ? 'block' : 'none';
}

function submitForm() {
  const amount = parseFloat(document.getElementById('f-amount')?.value);
  const desc   = document.getElementById('f-desc')?.value.trim();
  const date   = document.getElementById('f-date')?.value;
  const notes  = document.getElementById('f-notes')?.value.trim();

  if (!amount || amount <= 0) { showToast('⚠️ Ingresa un monto válido'); return; }
  if (!desc)                  { showToast('⚠️ Escribe una descripción'); return; }
  if (!date)                  { showToast('⚠️ Selecciona una fecha'); return; }

  let data = { type: formType, amount, description: desc, date, notes };

  if (formType === 'transfer') {
    const from = document.getElementById('f-from-account')?.value;
    const to   = document.getElementById('f-to-account')?.value;
    if (!from || !to)         { showToast('⚠️ Selecciona cuenta origen y destino'); return; }
    if (from === to)          { showToast('⚠️ Las cuentas deben ser diferentes'); return; }
    data.fromAccount = from;
    data.toAccount   = to;

  } else if (formType === 'liability') {
    data.category        = document.getElementById('f-category')?.value;
    data.creditor        = document.getElementById('f-creditor')?.value.trim();
    data.liabilityStatus = document.getElementById('f-liability-status')?.value || 'pending';
    data.liabilityEndDate = document.getElementById('f-liability-end')?.value || '';
    data.liabilityMonthly = parseFloat(document.getElementById('f-liability-monthly')?.value) || 0;

  } else {
    data.category = document.getElementById('f-category')?.value;
    data.ivaType  = _formIvaType; // guardar tipo de IVA seleccionado

    // Pago dividido en 2 cuentas (opcional)
    if (document.getElementById('f-split-on')?.checked) {
      const acc1   = document.getElementById('f-account')?.value;
      const acc2   = document.getElementById('f-account2')?.value;
      const monto2 = parseFloat(document.getElementById('f-split-amount')?.value) || 0;
      const total  = _formTotal();
      if (!acc1 || !acc2)   { showToast('⚠️ Selecciona las 2 cuentas del pago dividido'); return; }
      if (acc1 === acc2)    { showToast('⚠️ Las 2 cuentas deben ser diferentes'); return; }
      if (monto2 <= 0)      { showToast('⚠️ Indica cuánto se recibió en la 2da cuenta'); return; }
      if (monto2 >= total)  { showToast('⚠️ El monto de la 2da cuenta debe ser menor al total'); return; }
      data.splitPayments = [
        { account: acc1, amount: Math.round((total - monto2) * 100) / 100 },
        { account: acc2, amount: monto2 },
      ];
      data.account = ''; // el dinero se reparte vía splitPayments
    } else {
      data.account       = document.getElementById('f-account')?.value;
      data.splitPayments = null;
    }

    const affectsInv = document.getElementById('f-affects-inv')?.checked;
    if (affectsInv) {
      const productId = document.getElementById('f-product')?.value;
      const quantity  = parseFloat(document.getElementById('f-quantity')?.value);
      if (!productId) { showToast('⚠️ Selecciona un producto'); return; }
      if (!quantity)  { showToast('⚠️ Ingresa la cantidad'); return; }
      data.affectsInventory = true;
      data.productId = productId;
      data.quantity  = quantity;
    }
  }

  // Foto de comprobante (no aplica a traslados)
  const attachPhoto = formType !== 'transfer' && !!_formPhoto;
  data.hasReceipt   = attachPhoto;

  if (editingTxId) {
    DB.updateTransaction(editingTxId, data);
    if (attachPhoto) DB.savePhoto(editingTxId, _formPhoto);
    else             DB.deletePhoto(editingTxId); // se quitó la foto
    showToast('✅ Transacción actualizada');
  } else {
    const newTx = DB.addTransaction(data);
    if (attachPhoto && newTx) DB.savePhoto(newTx.id, _formPhoto);
    showToast('✅ Transacción guardada');
  }

  // ── Aprendizaje: recordar descripción + configuración para futuros autocompletados
  const descKey = _normalizeDescKey(desc);
  if (descKey && formType !== 'transfer') {
    DB.saveSmartDescEntry(descKey, {
      exampleDesc: desc,
      type:     formType,
      category: data.category  || null,
      account:  data.account   || null,
      ivaType:  _formIvaType,
      creditor: data.creditor  || null,
    });
    DB.recordIvaMemory(desc, data.category, _formIvaType);
  }

  // Ir al dashboard para mostrar el saldo actualizado inmediatamente
  navigate('dashboard');
}

function deleteCurrentTx() {
  if (!editingTxId) return;
  if (!confirm('¿Eliminar esta transacción?')) return;
  DB.deleteTransaction(editingTxId);
  showToast('🗑️ Eliminada');
  navigate('journal');
}

// ── Detalle de transacción (sheet) ────────────────────────────────────────────
function openTxDetail(id) {
  const tx  = DB.getTransactionById(id);
  if (!tx) return;
  const cat = DB.getCategoryById(tx.category);
  // Guardar descripción en global para acceder desde onclick sin problemas de escape
  window._txDescForReport = tx.description;

  const LABELS = { income:'Ingreso', expense:'Gasto', transfer:'Traslado', liability:'Deuda / Pasivo' };
  const BADGE  = { income:'badge-income', expense:'badge-expense', transfer:'badge-transfer', liability:'badge-liability' };
  const COLORS = { income:'var(--success)', expense:'var(--danger)', transfer:'var(--primary)', liability:'var(--warning)' };

  let amountSign = '', mainDetail = '';

  if (tx.type === 'income')  amountSign = '+';
  if (tx.type === 'expense') amountSign = '-';

  if (tx.type === 'transfer') {
    const from = DB.getAccountById(tx.fromAccount);
    const to   = DB.getAccountById(tx.toAccount);
    mainDetail = `
      <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Origen</span><span style="font-weight:600;">${from ? from.emoji + ' ' + from.name : '—'}</span></div>
      <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Destino</span><span style="font-weight:600;">${to ? to.emoji + ' ' + to.name : '—'}</span></div>
    `;
  } else if (tx.isIva) {
    const cobrado = tx.ivaDirection === 'cobrado';
    mainDetail = `
      <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:12px; font-size:13px; color:#92400e; line-height:1.6;">
        🧾 <strong>Asiento de IVA automático</strong><br>
        ${cobrado
          ? 'IVA cobrado en una venta — cuenta como parte de tu <strong>ingreso</strong> real. Su detalle tributario lo ves en <strong>Reportes → IVA</strong>.'
          : 'IVA pagado en una compra — cuenta como parte de tu <strong>gasto</strong> real. Su crédito tributario lo ves en <strong>Reportes → IVA</strong>.'}
      </div>
    `;
  } else if (tx.isFactura) {
    const acc = DB.getAccountById(tx.account);
    const pagoLabel = { efectivo:'💵 Efectivo', tarjeta:'💳 Tarjeta', transferencia:'🏦 Transferencia' }[tx.formaPago] || tx.formaPago || '—';
    mainDetail = `
      <div style="background:var(--gray-50); border-radius:10px; padding:12px 14px; font-size:13px; line-height:1.8;">
        <div style="font-weight:800; margin-bottom:6px;">🧾 Desglose de la factura${tx.proveedor ? ' — ' + tx.proveedor : ''}</div>
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Tarifa 0%</span><span>${fmt(tx.facturaTarifa0 || 0)}</span></div>
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">Tarifa gravada (base)</span><span>${fmt(tx.facturaTarifa15 || 0)}</span></div>
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500);">IVA</span><span>${fmt(tx.facturaIva || 0)}</span></div>
        <div style="display:flex; justify-content:space-between; border-top:1px solid var(--gray-200); margin-top:4px; padding-top:4px; font-weight:800;"><span>Total factura</span><span>${fmt(tx.facturaTotal || 0)}</span></div>
      </div>
      ${cat ? `<div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Categoría</span><span style="font-weight:600;">${cat.emoji} ${cat.name}</span></div>` : ''}
      ${acc ? `<div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Cuenta</span><span style="font-weight:600;">${acc.emoji} ${acc.name}</span></div>` : ''}
      <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Forma de pago</span><span style="font-weight:600;">${pagoLabel}</span></div>
    `;
  } else if (tx.type === 'liability') {
    const status  = tx.liabilityStatus === 'paid' ? '✅ Pagada' : '🔴 Pendiente';
    const detRow  = (lbl, val) => `<div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">${lbl}</span><span style="font-weight:600;">${val}</span></div>`;
    mainDetail = `
      ${tx.creditor ? detRow('Acreedor', tx.creditor) : ''}
      ${detRow('📅 Inicio de la deuda', fmtDate(tx.date))}
      ${tx.liabilityEndDate ? detRow('🏁 Vencimiento', fmtDate(tx.liabilityEndDate)) : ''}
      ${(parseFloat(tx.liabilityMonthly) || 0) > 0 ? detRow('💵 Cuota mensual', fmt(tx.liabilityMonthly)) : ''}
      ${detRow('Estado', status)}
    `;
  } else {
    const acc = DB.getAccountById(tx.account);
    const isSplit = Array.isArray(tx.splitPayments) && tx.splitPayments.length;
    const splitHTML = isSplit ? `
      <div style="background:var(--gray-50); border-radius:8px; padding:10px 12px; font-size:13px;">
        <div style="font-weight:700; margin-bottom:4px;">💳 Pago dividido en 2 cuentas</div>
        ${tx.splitPayments.map(sp => {
          const a = DB.getAccountById(sp.account);
          return `<div style="display:flex; justify-content:space-between;">
            <span style="color:var(--gray-500);">${a ? a.emoji + ' ' + a.name : 'Cuenta'}</span>
            <span style="font-weight:700;">${fmt(sp.amount)}</span></div>`;
        }).join('')}
      </div>` : '';
    mainDetail = `
      ${cat ? `<div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Categoría</span><span style="font-weight:600;">${cat.emoji} ${cat.name}</span></div>` : ''}
      ${isSplit ? splitHTML : (acc ? `<div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Cuenta</span><span style="font-weight:600;">${acc.emoji} ${acc.name}</span></div>` : '')}
      ${tx.affectsInventory ? `<div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Inventario</span><span style="font-weight:600; color:var(--primary);">📦 -${tx.quantity} unidades</span></div>` : ''}
    `;
  }

  document.getElementById('detail-content').innerHTML = `
    <div style="text-align:center; padding:8px 0 20px;">
      <div style="font-size:52px; margin-bottom:8px;">${cat ? cat.emoji : (tx.type === 'transfer' ? '↔️' : tx.type === 'liability' ? '🔴' : '💰')}</div>
      <span class="badge ${BADGE[tx.type]}" style="margin-bottom:12px;">${LABELS[tx.type]}</span>
      <div style="font-size:36px; font-weight:800; color:${COLORS[tx.type]}; margin-bottom:4px;">${amountSign}${fmt(tx.amount)}</div>
      <div style="font-size:18px; font-weight:600; margin-bottom:4px;">${tx.description}</div>
      <div style="font-size:13px; color:var(--gray-500);">${fmtDate(tx.date)}</div>
    </div>
    <div class="divider"></div>
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${mainDetail}
      ${tx.notes ? `<div><div style="color:var(--gray-500); font-size:14px; margin-bottom:4px;">Notas</div><div style="font-size:14px; color:var(--gray-700); background:var(--gray-50); border-radius:8px; padding:10px;">${tx.notes}</div></div>` : ''}
      ${tx.hasReceipt ? `<div id="detail-receipt"></div>` : ''}
    </div>
    <div style="display:flex; gap:10px; margin-top:24px;">
      ${(tx.isCogs || tx.isIva || tx.isFactura)
        ? `<button class="btn btn-secondary btn-block" style="opacity:.5; cursor:not-allowed;"
            onclick="showToast('${tx.isFactura ? '🧾 Para cambiar una factura: bórrala y regístrala de nuevo' : '⚙️ Asiento automático: edita la transacción original'}', 3200)">✏️ Editar</button>`
        : !isCurrentUserReadOnly()
          ? `<button class="btn btn-secondary btn-block" onclick="closeDetail(); navigate('form', {id:'${tx.id}'})">✏️ Editar</button>`
          : `<button class="btn btn-secondary btn-block" style="opacity:.4; cursor:not-allowed;"
              onclick="showToast('🔒 Modo solo-lectura: no puedes editar', 2000)">✏️ Editar</button>`
      }
      ${isCurrentUserOwner()
        ? `<button class="btn btn-danger btn-block" onclick="closeDetail(); setTimeout(()=>{ DB.deleteTransaction('${tx.id}'); showToast('🗑️ Eliminada'); renderJournal(); }, 100)">🗑️ Eliminar</button>`
        : `<button class="btn btn-danger btn-block" style="opacity:.45; cursor:not-allowed;"
            onclick="showToast('🚫 Solo el propietario puede eliminar registros', 2500)">🗑️ Eliminar</button>`
      }
    </div>
    ${!(tx.isCogs || tx.isIva) ? `
    <button class="btn btn-outline btn-block mt-8"
      onclick="closeDetail(); openDescriptionReport(window._txDescForReport)">
      🔍 Ver todos con: "${tx.description.length > 35 ? tx.description.substring(0,35)+'…' : tx.description}"
    </button>` : ''}
  `;
  document.getElementById('detail-overlay').classList.add('open');

  // Cargar la foto del comprobante (asíncrono desde IndexedDB)
  if (tx.hasReceipt) {
    DB.getPhoto(tx.id).then(p => {
      const el = document.getElementById('detail-receipt');
      if (!el) return;
      if (p) {
        window._detailPhoto = p;
        el.innerHTML = `
          <div style="color:var(--gray-500); font-size:14px; margin-bottom:6px;">📷 Comprobante / Factura</div>
          <img src="${p}" onclick="_openPhotoViewer(window._detailPhoto)"
            style="width:100%; max-height:260px; object-fit:contain; background:var(--gray-50);
              border-radius:10px; border:1px solid var(--gray-200); cursor:pointer;">`;
      } else {
        el.innerHTML = `
          <div style="font-size:12px; color:var(--gray-400); padding:10px;
            background:var(--gray-50); border-radius:8px;">
            📷 El comprobante no está guardado en este dispositivo
          </div>`;
      }
    });
  }
}

function closeDetail() { document.getElementById('detail-overlay').classList.remove('open'); }

// ── Comparativa vs mes anterior (Reportes) ───────────────────────────────────
function _renderReportComparison() {
  const card = document.getElementById('report-cmp-card');
  const pills = document.getElementById('report-cmp-pills');
  if (!card || !pills) return;

  const prevM   = reportMonth === 1 ? 12 : reportMonth - 1;
  const prevY   = reportMonth === 1 ? reportYear - 1 : reportYear;
  const cur     = DB.getMonthStats(reportYear, reportMonth);
  const prev    = DB.getMonthStats(prevY, prevM);
  const prevLbl = new Date(prevY, prevM - 1, 1).toLocaleDateString('es-CO', { month: 'long' });

  // Ocultar si no hay datos en ninguno de los dos meses
  if (!cur.income && !cur.opExpenses && !prev.income && !prev.opExpenses) {
    card.style.display = 'none'; return;
  }

  pills.innerHTML =
    _cmpPill('💰 Ingresos', cur.income,     prev.income,     false, prevLbl) +
    _cmpPill('💸 Gastos',   cur.opExpenses, prev.opExpenses, true,  prevLbl) +
    _cmpPill('📊 Utilidad', cur.netProfit,  prev.netProfit,  false, prevLbl);

  card.style.display = pills.innerHTML.trim() ? 'block' : 'none';
}

// ── Gráfico de desglose por categoría ────────────────────────────────────────
const CAT_CHART_COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#84cc16','#ec4899','#6366f1',
];
let _catChartInst = null;
let _catChartTab  = 'expense';

function setCatChartTab(type) {
  _catChartTab = type;
  document.getElementById('cat-tab-expense')?.classList.toggle('cat-tab-active', type === 'expense');
  document.getElementById('cat-tab-income') ?.classList.toggle('cat-tab-active', type === 'income');
  renderCategoryChart();
}

function renderCategoryChart() {
  const canvas   = document.getElementById('chart-category');
  const legendEl = document.getElementById('cat-chart-legend');
  const emptyEl  = document.getElementById('cat-chart-empty');
  const totalEl  = document.getElementById('cat-chart-total');
  const lblEl    = document.getElementById('cat-chart-month-label');
  if (!canvas) return;

  const monthLabel = new Date(reportYear, reportMonth - 1, 1)
    .toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  if (lblEl) lblEl.textContent = monthLabel;

  // Agrupar transacciones del mes por categoría
  const txs = DB.getTransactionsByMonth(reportYear, reportMonth)
    .filter(t => t.type === _catChartTab && !t.isCogs && !t.isIva);

  const grouped = {};
  txs.forEach(t => {
    const key = t.category || '__none__';
    grouped[key] = (grouped[key] || 0) + t.amount;
  });

  const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    canvas.style.display  = 'none';
    if (emptyEl)  emptyEl.style.display  = 'block';
    if (legendEl) legendEl.innerHTML     = '';
    if (totalEl)  totalEl.textContent    = fmt(0);
    if (_catChartInst) { _catChartInst.destroy(); _catChartInst = null; }
    return;
  }
  canvas.style.display = 'block';
  if (emptyEl) emptyEl.style.display = 'none';

  // Top 9 + "Otros"
  const TOP = 9;
  let chartEntries = entries.slice(0, TOP);
  if (entries.length > TOP) {
    const rest = entries.slice(TOP).reduce((s, [, v]) => s + v, 0);
    chartEntries.push(['__otros__', rest]);
  }

  const total  = entries.reduce((s, [, v]) => s + v, 0);
  if (totalEl) totalEl.textContent = fmt(total);

  const getLabel = catId => {
    if (catId === '__otros__') return '📁 Otros';
    if (catId === '__none__')  return '— Sin categoría';
    const c = DB.getCategoryById(catId);
    return c ? c.emoji + ' ' + c.name : '— Sin categoría';
  };

  const labels = chartEntries.map(([id]) => getLabel(id));
  const values = chartEntries.map(([, v]) => v);
  const colors = chartEntries.map((_, i) => CAT_CHART_COLORS[i % CAT_CHART_COLORS.length]);

  // Destruir instancia anterior
  if (_catChartInst) { _catChartInst.destroy(); _catChartInst = null; }

  _catChartInst = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 3,
        borderColor: '#fff',
        hoverOffset: 10,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt(ctx.raw)} · ${Math.round(ctx.raw / total * 100)}%`
          }
        }
      }
    }
  });

  // Leyenda personalizada
  if (legendEl) {
    legendEl.innerHTML = chartEntries.map(([catId, val], i) => {
      const pct = Math.round(val / total * 100);
      const cat = DB.getCategoryById(catId);
      const clickable = cat && catId !== '__otros__' && catId !== '__none__';
      const onclick   = clickable
        ? `onclick="journalFilter='${_catChartTab}'; journalCatFilter='${catId}'; navigate('journal');"`
        : '';
      return `
        <div class="cat-legend-row" ${onclick} ${!clickable ? 'style="cursor:default;"' : ''}>
          <div style="width:11px;height:11px;border-radius:3px;flex-shrink:0;background:${colors[i]};"></div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--gray-800);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${getLabel(catId)}</div>
            <div style="background:var(--gray-100);height:4px;border-radius:2px;margin-top:4px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:${colors[i]};border-radius:2px;"></div>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:13px;font-weight:700;color:var(--gray-800);">${fmt(val)}</div>
            <div style="font-size:11px;color:var(--gray-400);">${pct}%</div>
          </div>
          ${clickable ? '<div style="color:var(--gray-300);font-size:14px;">›</div>' : ''}
        </div>`;
    }).join('');
  }
}

// ── Reportes ───────────────────────────────────────────────────────────────────
function renderReports() {
  const pnl  = DB.getProfitStatement(reportYear, reportMonth);
  const txs  = DB.getTransactionsByMonth(reportYear, reportMonth);
  const s    = DB.getSettings();
  const monthLabel = new Date(reportYear, reportMonth - 1, 1)
    .toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  document.getElementById('report-month-name').textContent = monthLabel;

  // ── Comparativa vs mes anterior ───────────────────────────
  _renderReportComparison();

  // ── Gráfico de desglose por categoría ────────────────────
  renderCategoryChart();

  // ── Estado de Resultados (P&L) ────────────────────────────
  _renderPnL(pnl);

  // ── Panel de IVA del mes ──────────────────────────────────
  ivaTableYear = reportYear; // sincronizar año de la tabla IVA con el reporte
  _renderIvaPanel(pnl);

  // ── Deudas del mes (los asientos de IVA se reportan aparte) ──
  const liabilities = txs.filter(t => t.type === 'liability' && !t.isIva);
  const totalLiab   = liabilities.reduce((s, t) => s + t.amount, 0);
  const liabEl      = document.getElementById('report-liabilities-section');
  if (liabilities.length) {
    liabEl.style.display = 'block';
    document.getElementById('report-liabilities-total').textContent = fmt(totalLiab);
  } else {
    liabEl.style.display = 'none';
  }

  // ── Resumen superior del PDF mensual ─────────────────────────────────────────
  // Estos elementos existen en el HTML con display:none; el CSS @media print los
  // muestra. Sin este código los valores quedan en el "$ 0" del HTML inicial.
  const totalExpenses = pnl.opExpenses + pnl.cogs;
  const netSign       = pnl.netProfit >= 0;
  const elInc  = document.getElementById('print-summary-income');
  const elExp  = document.getElementById('print-summary-expense');
  const elNet  = document.getElementById('print-summary-net');
  const elLiab = document.getElementById('print-summary-liab');
  const elLiabRow = document.getElementById('print-liab-row');
  if (elInc)  elInc.textContent  = fmt(pnl.totalRevenue);
  if (elExp)  elExp.textContent  = fmt(totalExpenses);
  if (elNet) {
    elNet.textContent = (netSign ? '+' : '') + fmt(pnl.netProfit);
    elNet.style.color = netSign ? '#16a34a' : '#dc2626';
  }
  if (elLiab && elLiabRow) {
    if (totalLiab > 0) {
      elLiab.textContent    = fmt(totalLiab);
      elLiabRow.style.display = '';
    } else {
      elLiabRow.style.display = 'none';
    }
  }

  // ── Gastos operativos por categoría (barra) ───────────────
  const catTotals = {};
  txs.filter(t => t.type === 'expense' && !t.isCogs).forEach(t => {
    catTotals[t.category || 'otros'] = (catTotals[t.category || 'otros'] || 0) + t.amount;
  });
  const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxVal = sorted[0]?.[1] || 1;

  document.getElementById('report-cat-breakdown').innerHTML = sorted.length
    ? sorted.map(([catId, total]) => {
        const cat = DB.getCategoryById(catId);
        const pct = Math.round((total / maxVal) * 100);
        return `
          <div class="category-breakdown-item" onclick="openCategoryReport('${catId}')"
               style="cursor:pointer; border-radius:10px; padding:4px 6px; margin:-4px -6px; transition:background .15s;"
               onmouseenter="this.style.background='var(--gray-50)'" onmouseleave="this.style.background=''">
            <div style="font-size:22px;">${cat ? cat.emoji : '📝'}</div>
            <div class="cat-bar-wrap">
              <div class="cat-bar-label">
                <span style="font-weight:600;">${cat ? cat.name : 'Otros'}</span>
                <span style="color:var(--danger); font-weight:700;">-${fmt(total)}</span>
                <span style="font-size:11px; color:var(--gray-400); margin-left:4px;">→</span>
              </div>
              <div class="cat-bar-track">
                <div class="cat-bar-fill" style="width:${pct}%; background:${cat ? cat.color : '#6b7280'};"></div>
              </div>
            </div>
          </div>`;
      }).join('')
    : '<p style="color:var(--gray-400); text-align:center; padding:16px 0; font-size:14px;">Sin gastos operativos este mes</p>';

  // ── Libro Diario — tabla con columnas Debe/Haber ──────────
  // El CMV aparece con tipografía especial para diferenciarlo
  document.getElementById('print-tx-body').innerHTML = txs.length
    ? txs.map(t => {
        const cat     = DB.getCategoryById(t.category);
        const acc     = DB.getAccountById(t.account);
        const fromAcc = DB.getAccountById(t.fromAccount);
        const toAcc   = DB.getAccountById(t.toAccount);

        let debit = '', credit = '', typeLabel = '', catLabel = '';

        if (t.isCogs) {
          debit = '';  credit = fmt(t.amount);
          typeLabel = 'CMV';
          catLabel  = '📦 Costo de Ventas';
        } else if (t.isIva) {
          // El IVA cuenta como dinero real: cobrado = ingreso, crédito = gasto
          const cobrado = t.ivaDirection === 'cobrado';
          if (cobrado) { debit = fmt(t.amount); credit = '';            }
          else         { debit = '';            credit = fmt(t.amount); }
          typeLabel = 'IVA';
          catLabel  = cobrado ? '🧾 IVA cobrado en venta' : '🧾 IVA pagado en compra';
        } else if (t.type === 'income') {
          debit = fmt(t.amount); credit = '';
          typeLabel = 'Ingreso';
          catLabel  = acc ? acc.name : (cat ? cat.emoji + ' ' + cat.name : 'Ingresos');
        } else if (t.type === 'expense') {
          debit = ''; credit = fmt(t.amount);
          typeLabel = 'Gasto';
          catLabel  = cat ? cat.emoji + ' ' + cat.name : (acc ? acc.name : 'Gastos');
        } else if (t.type === 'transfer') {
          debit = fmt(t.amount); credit = fmt(t.amount);
          typeLabel = 'Traslado';
          catLabel  = (fromAcc ? fromAcc.name : '—') + ' → ' + (toAcc ? toAcc.name : '—');
        } else if (t.type === 'liability') {
          debit = ''; credit = fmt(t.amount);
          typeLabel = 'Deuda';
          catLabel  = t.creditor || (cat ? cat.name : 'Cuentas por pagar');
        }

        const typeColors = { income:'#16a34a', expense:'#dc2626', transfer:'#2563eb', liability:'#d97706', CMV:'#7c3aed', IVA:'#0891b2' };
        const rowBg = t.isCogs ? 'background:#faf5ff;' : t.isIva ? 'background:#fffbeb;' : '';
        return `<tr style="${rowBg}">
          <td>${fmtDate(t.date)}</td>
          <td>${t.description}${(t.isCogs || t.isIva) ? ' <em style="color:#9ca3af;font-size:11px;">(auto)</em>' : ''}</td>
          <td style="color:${typeColors[typeLabel] || '#374151'}; font-weight:600;">${typeLabel}</td>
          <td>${catLabel}</td>
          <td style="color:#16a34a; font-weight:700; text-align:right;">${debit}</td>
          <td style="color:#dc2626; font-weight:700; text-align:right;">${credit}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="6" style="text-align:center; color:#9ca3af; padding:20px;">Sin transacciones este mes</td></tr>';

  // Info de impresión
  document.getElementById('print-company').textContent   = s.companyName;
  document.getElementById('print-period').textContent    = 'Período: ' + monthLabel;
  document.getElementById('print-generated').textContent = 'Generado el ' + fmtDate(today());
  document.getElementById('print-footer-company').textContent = s.companyName;

  // ── Balance General (auto-refrescar si el panel estaba abierto) ──────────────
  if (balanceSheetOpen) renderBalanceSheet();

  // ── Presupuesto ───────────────────────────────────────────
  renderBudgetStatus();

  // ── Gráficas interactivas ─────────────────────────────────
  renderCharts();
}

// Renderiza el panel de IVA del mes (obligación tributaria — separado de las deudas)
function _renderIvaPanel(pnl) {
  const card = document.getElementById('iva-panel-card');
  if (!card) return;

  // Mostrar también la tarjeta de IVA Anual si hay IVA en cualquier mes del año
  const annualCard = document.getElementById('iva-annual-card');
  if (annualCard) {
    // Verificar si hay algún mes del año actual con IVA
    const hasAnyIva = Array.from({length:12},(_,i) => DB.getMonthStats(ivaTableYear, i+1))
      .some(st => st.ivaCobrado > 0 || st.ivaCredito > 0);
    annualCard.style.display = (pnl.hasIva || hasAnyIva) ? 'block' : 'none';
    if (ivaTableOpen) renderIvaTable(); // refrescar si estaba abierto
  }

  if (!pnl.hasIva) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  const sym     = DB.getSettings().currencySymbol || '$';
  const neto    = pnl.ivaPorPagar;        // IVA cobrado − IVA crédito
  const aPagar  = neto >= 0;
  const content = document.getElementById('iva-panel-content');
  if (!content) return;
  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; padding:7px 0; font-size:14px;
      border-bottom:1px solid var(--gray-100);">
      <span style="color:var(--gray-600);">IVA cobrado en ventas</span>
      <span style="font-weight:700;">${sym} ${fmt(pnl.ivaCobrado)}</span>
    </div>
    <div style="display:flex; justify-content:space-between; padding:7px 0; font-size:14px;
      border-bottom:1px solid var(--gray-100);">
      <span style="color:var(--gray-600);">IVA crédito en compras</span>
      <span style="font-weight:700;">− ${sym} ${fmt(pnl.ivaCredito)}</span>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; padding:11px 13px;
      margin-top:10px; background:${aPagar ? '#eff6ff' : '#f0fdf4'}; border-radius:10px;">
      <div>
        <div style="font-size:13px; font-weight:800; color:${aPagar ? '#1d4ed8' : '#16a34a'};">
          ${aPagar ? 'IVA a pagar al SRI' : 'IVA a favor (crédito)'}
        </div>
        <div style="font-size:11px; color:var(--gray-500); margin-top:1px;">
          ${aPagar ? 'Lo que declaras y pagas este mes' : 'Crédito que llevas al próximo mes'}
        </div>
      </div>
      <div style="font-size:21px; font-weight:900; color:${aPagar ? '#1d4ed8' : '#16a34a'}; white-space:nowrap;">
        ${sym} ${fmt(Math.abs(neto))}
      </div>
    </div>
  `;
}

// Renderiza el Estado de Resultados (P&L) — pantalla y PDF
function _renderPnL(pnl) {
  const pnlEl = document.getElementById('pnl-section');
  if (!pnlEl) return;

  const pct = v => v !== null ? ' (' + v.toFixed(1) + '%)' : '';
  const sign = v => (v >= 0 ? '+' : '') + fmt(v);
  const colorNet = v => v >= 0 ? 'var(--success)' : 'var(--danger)';

  pnlEl.innerHTML = `
    <!-- INGRESOS -->
    <div class="pnl-group">
      <div class="pnl-group-title income-title">💰 Ingresos</div>
      ${pnl.salesRevenue > 0 ? `
        <div class="pnl-row">
          <span>Ventas de productos</span>
          <span class="pnl-val income">${fmt(pnl.salesRevenue)}</span>
        </div>` : ''}
      ${pnl.serviceIncome > 0 ? `
        <div class="pnl-row">
          <span>Servicios / otros ingresos</span>
          <span class="pnl-val income">${fmt(pnl.serviceIncome)}</span>
        </div>` : ''}
      <div class="pnl-subtotal">
        <span>Total Ingresos</span>
        <span class="pnl-val income">${fmt(pnl.totalRevenue)}</span>
      </div>
    </div>

    <!-- COSTO DE VENTAS -->
    ${pnl.hasCogs ? `
    <div class="pnl-group">
      <div class="pnl-group-title cogs-title">📦 Costo de Mercadería Vendida</div>
      <div class="pnl-row">
        <span>CMV · Costo inventario vendido${pnl.cogsMargin > 0 ? ` <span class="pnl-pct">(${pnl.cogsMargin.toFixed(1)}% ventas)</span>` : ''}</span>
        <span class="pnl-val danger">-${fmt(pnl.cogs)}</span>
      </div>
    </div>` : ''}

    <!-- UTILIDAD BRUTA -->
    <div class="pnl-grand ${pnl.grossProfit >= 0 ? 'positive' : 'negative'}">
      <div>
        <div class="pnl-grand-label">📊 UTILIDAD BRUTA</div>
        <div class="pnl-grand-sub">${pnl.hasCogs ? 'Ventas − CMV' : 'Total Ingresos'}</div>
      </div>
      <div style="text-align:right;">
        <div class="pnl-grand-val" style="color:${colorNet(pnl.grossProfit)};">${sign(pnl.grossProfit)}</div>
        ${pnl.totalRevenue > 0 ? `<div class="pnl-grand-pct">${pnl.grossMargin.toFixed(1)}% margen</div>` : ''}
      </div>
    </div>

    <!-- GASTOS OPERATIVOS -->
    ${pnl.opExpenses > 0 ? `
    <div class="pnl-group">
      <div class="pnl-group-title expense-title">💸 Gastos Operativos</div>
      ${Object.entries(pnl.expByCat).sort((a,b) => b[1]-a[1]).map(([catId, amt]) => {
        const cat = DB.getCategoryById(catId);
        return `<div class="pnl-row">
          <span>${cat ? cat.emoji + ' ' + cat.name : 'Otros gastos'}</span>
          <span class="pnl-val danger">-${fmt(amt)}</span>
        </div>`;
      }).join('')}
      <div class="pnl-subtotal">
        <span>Total Gastos Operativos</span>
        <span class="pnl-val danger">-${fmt(pnl.opExpenses)}</span>
      </div>
    </div>` : ''}

    <!-- UTILIDAD NETA -->
    <div class="pnl-grand net ${pnl.netProfit >= 0 ? 'positive' : 'negative'}">
      <div>
        <div class="pnl-grand-label">🎯 UTILIDAD NETA</div>
        <div class="pnl-grand-sub">Utilidad Bruta − Gastos Operativos</div>
      </div>
      <div style="text-align:right;">
        <div class="pnl-grand-val" style="color:${colorNet(pnl.netProfit)}; font-size:26px;">${sign(pnl.netProfit)}</div>
        ${pnl.totalRevenue > 0 ? `<div class="pnl-grand-pct">${pnl.netMargin.toFixed(1)}% margen neto</div>` : ''}
      </div>
    </div>

    <!-- Explicación si no hay datos suficientes -->
    ${pnl.totalRevenue === 0 && pnl.opExpenses === 0 ? `
    <div style="text-align:center; padding:24px 16px; color:var(--gray-400); font-size:14px;">
      <div style="font-size:32px; margin-bottom:8px;">📊</div>
      Registra ingresos y gastos para ver el Estado de Resultados
    </div>` : ''}
  `;
}

// ── Balance General (Estado de Situación Financiera NIIF PYMES) ──────────────
let balanceSheetOpen = false;

function toggleBalanceSheet() {
  balanceSheetOpen = !balanceSheetOpen;
  document.getElementById('balance-sheet-view').style.display = balanceSheetOpen ? 'block' : 'none';
  document.getElementById('balance-toggle-icon').textContent  = balanceSheetOpen ? '▲' : '▼';
  if (balanceSheetOpen) renderBalanceSheet();
}

function renderBalanceSheet() {
  const el = document.getElementById('balance-sheet-content');
  if (!el) return;
  const bs = DB.getBalanceSheet();

  const todayStr = new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' });

  // ── helpers de render ──────────────────────────────────
  const sectionTitle = (label, color) => `
    <div style="font-size:11px; font-weight:800; text-transform:uppercase;
      letter-spacing:.6px; padding:12px 0 6px; color:${color};
      border-bottom:1.5px solid var(--gray-100); margin-bottom:2px;">
      ${label}
    </div>`;

  const row = (label, value, valColor = 'var(--gray-700)', indent = true) => {
    const colorCss = valColor;
    return `
    <div style="display:flex; justify-content:space-between; align-items:center;
      padding:${indent ? '5px 0 5px 14px' : '7px 0'}; font-size:${indent ? '13' : '14'}px;
      border-bottom:1px solid var(--gray-50);">
      <span style="color:var(--gray-600);">${label}</span>
      <span style="font-weight:700; color:${colorCss};">${fmt(value)}</span>
    </div>`;
  };

  const subtotal = (label, value, valColor = 'var(--primary)') => `
    <div style="display:flex; justify-content:space-between; align-items:center;
      padding:9px 0; font-size:14px; font-weight:800; color:${valColor};
      border-top:2px solid var(--gray-200); margin-top:4px;">
      <span>${label}</span>
      <span>${fmt(value)}</span>
    </div>`;

  // ── Activos Corrientes ─────────────────────────────────
  let activosHTML = sectionTitle('💚 ACTIVOS CORRIENTES', '#16a34a');

  if (bs.totalCash !== 0) {
    activosHTML += `<div style="font-size:11px; color:var(--gray-400); padding:5px 14px 2px; font-weight:600; letter-spacing:.3px;">Efectivo y Equivalentes de Efectivo</div>`;
    activosHTML += bs.cashAccounts.map(a =>
      row(a.emoji + ' ' + a.name, a.balance, a.balance >= 0 ? '#16a34a' : 'var(--danger)')
    ).join('');
  }

  if (bs.totalCxC > 0) {
    activosHTML += row('🧾 Cuentas por Cobrar (Cartera)', bs.totalCxC, '#0891b2');
  }

  if (bs.totalInventory > 0) {
    activosHTML += row('📦 Inventarios (al costo)', bs.totalInventory, '#7c3aed');
  }

  if (bs.totalCurrentAssets === 0) {
    activosHTML += `<div style="color:var(--gray-400); font-size:13px; text-align:center; padding:10px 0;">Sin activos corrientes aún</div>`;
  }
  activosHTML += subtotal('TOTAL ACTIVOS CORRIENTES', bs.totalCurrentAssets, '#16a34a');

  // ── Activos No Corrientes (Fijos) ──────────────────────
  let fijosHTML = '';
  if (bs.totalFixedAssets > 0 || bs.fixedAssetsTotals.count > 0) {
    fijosHTML += sectionTitle('🏭 ACTIVOS NO CORRIENTES', '#4338ca');
    if (bs.fixedAssetsTotals.count > 0) {
      fijosHTML += row('🏭 Propiedad, Planta y Equipo (costo)', bs.fixedAssetsTotals.totalCost, '#4338ca');
      fijosHTML += row('− Depreciación Acumulada', -bs.fixedAssetsTotals.totalAccumDep, 'var(--danger)');
      const netAssets = bs.fixedAssetsTotals.totalBookValue;
      fijosHTML += subtotal('TOTAL ACTIVOS NO CORRIENTES (neto)', netAssets, '#4338ca');
      fijosHTML += `
        <div style="font-size:11px; color:var(--gray-400); padding:4px 0 8px; line-height:1.5;">
          ${bs.fixedAssetsTotals.count} activo${bs.fixedAssetsTotals.count > 1 ? 's' : ''} registrado${bs.fixedAssetsTotals.count > 1 ? 's' : ''} ·
          <span style="color:#4338ca; cursor:pointer;" onclick="closeSettingsSheet(); navigate('assets')">Ver detalle →</span>
        </div>`;
    } else {
      fijosHTML += `<div style="color:var(--gray-400); font-size:13px; text-align:center; padding:10px 0;">Sin activos fijos registrados</div>`;
    }
  }

  // Solo mostrar TOTAL ACTIVOS si hay activos fijos (para evitar línea duplicada)
  const totalActivosHTML = bs.fixedAssetsTotals.count > 0
    ? subtotal('═══ TOTAL ACTIVOS', bs.totalAssets, '#16a34a')
    : '';

  // ── Pasivos ────────────────────────────────────────────
  let pasivosHTML = sectionTitle('🔴 PASIVOS CORRIENTES', 'var(--danger)');

  if (bs.pendingLiabs.length > 0) {
    pasivosHTML += bs.pendingLiabs.map(t => {
      const cat      = DB.getCategoryById(t.category);
      const creditor = t.creditor || (cat ? cat.name : 'Deuda');
      return row(`${creditor} <span style="font-size:10px; color:var(--gray-400);">(${fmtDate(t.date)})</span>`, t.amount, 'var(--danger)');
    }).join('');
  } else {
    pasivosHTML += `<div style="color:var(--gray-400); font-size:13px; text-align:center; padding:10px 0;">✅ Sin deudas pendientes</div>`;
  }
  pasivosHTML += subtotal('TOTAL PASIVOS', bs.totalLiabilities, bs.totalLiabilities > 0 ? 'var(--danger)' : 'var(--gray-400)');

  // ── Patrimonio ─────────────────────────────────────────
  const eqColor  = bs.equity >= 0 ? '#16a34a' : 'var(--danger)';
  const eqBg     = bs.equity >= 0
    ? 'linear-gradient(135deg,#f0fdf4,#dcfce7); border:1.5px solid #bbf7d0;'
    : 'linear-gradient(135deg,#fff1f2,#fee2e2); border:1.5px solid #fecaca;';

  let patrimonioHTML = sectionTitle('🏦 PATRIMONIO', 'var(--primary)');
  patrimonioHTML += row('Utilidades Acumuladas', bs.equity, eqColor);
  patrimonioHTML += subtotal('TOTAL PATRIMONIO', bs.equity, eqColor);

  // ── Ecuación contable ──────────────────────────────────
  const checkTotal = bs.totalLiabilities + bs.equity;
  const ecuHTML = `
    <div style="background:${eqBg} border-radius:10px; padding:12px 16px;
      margin-top:14px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-size:12px; font-weight:800; color:var(--gray-700);">📐 Ecuación Contable</div>
        <div style="font-size:11px; color:var(--gray-500); margin-top:2px;">Activos = Pasivos + Patrimonio</div>
        <div style="font-size:11px; color:var(--gray-400); margin-top:1px;">${fmt(bs.totalAssets)} = ${fmt(bs.totalLiabilities)} + ${fmt(bs.equity)}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:20px; font-weight:800; color:${eqColor};">${fmt(checkTotal)}</div>
        <div style="font-size:10px; color:var(--gray-400);">✓ Cuadra</div>
      </div>
    </div>
    <div style="font-size:11px; color:var(--gray-400); margin-top:10px; line-height:1.5; padding:0 2px;">
      💡 <strong>Patrimonio</strong> = lo que posees (activos) − lo que debes (pasivos). Refleja el valor real de tu negocio.
    </div>`;

  el.innerHTML = `
    <div style="font-size:11px; color:var(--gray-400); text-align:center; margin-bottom:10px;">
      📅 Al ${todayStr} · Acumulado total (independiente del mes seleccionado)
    </div>
    ${activosHTML}
    ${fijosHTML}
    ${totalActivosHTML}
    ${pasivosHTML}
    ${patrimonioHTML}
    ${ecuHTML}
  `;
}

// ── Reporte detallado por categoría ───────────────────────────────────────────
// Abre una sheet con TODAS las transacciones de una categoría (cualquier período)
function openCategoryReport(catId) {
  const cat  = DB.getCategoryById(catId);
  if (!cat) return;

  const allTxs = DB.getTransactions()
    .filter(t => t.category === catId && !t.isCogs)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const total    = allTxs.reduce((s, t) => s + t.amount, 0);
  const isIncome = cat.type === 'income';
  const sign     = isIncome ? '+' : '−';
  const color    = isIncome ? 'var(--success)' : cat.type === 'liability' ? 'var(--warning)' : 'var(--danger)';

  // Agrupar por mes
  const groups = {};
  allTxs.forEach(t => {
    const d = new Date(t.date + 'T12:00:00');
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  });

  const listHTML = Object.keys(groups).sort((a,b) => b.localeCompare(a)).map(key => {
    const [y, m]   = key.split('-').map(Number);
    const label    = new Date(y, m-1, 1).toLocaleDateString('es-CO', { month:'long', year:'numeric' });
    const items    = groups[key];
    const monthTotal = items.reduce((s,t) => s+t.amount, 0);
    return `
      <div style="padding:8px 0 4px; font-size:11px; font-weight:700; color:var(--gray-500); text-transform:uppercase; display:flex; justify-content:space-between;">
        <span>${label}</span>
        <span style="color:${color};">${sign}${fmt(monthTotal)}</span>
      </div>
      ${items.map(t => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--gray-100);">
          <div style="flex:1; min-width:0;">
            <div style="font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.description}</div>
            <div style="font-size:11px; color:var(--gray-400);">${fmtDate(t.date)}${t.notes ? ' · ' + t.notes : ''}</div>
          </div>
          <div style="font-size:15px; font-weight:700; color:${color}; flex-shrink:0;">${sign}${fmt(t.amount)}</div>
        </div>
      `).join('')}
    `;
  }).join('');

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>

    <!-- Encabezado -->
    <div style="text-align:center; padding:8px 0 16px;">
      <div style="font-size:48px; margin-bottom:8px;">${cat.emoji}</div>
      <div style="font-size:18px; font-weight:800;">${cat.name}</div>
      <div style="font-size:13px; color:var(--gray-500); margin-top:2px;">Historial completo · ${allTxs.length} registro${allTxs.length !== 1 ? 's' : ''}</div>
    </div>

    <!-- Total acumulado -->
    <div style="background:var(--gray-50); border-radius:12px; padding:14px; text-align:center; margin-bottom:16px;">
      <div style="font-size:11px; color:var(--gray-500); font-weight:700; letter-spacing:.5px; margin-bottom:4px;">TOTAL ACUMULADO</div>
      <div style="font-size:32px; font-weight:800; color:${color};">${sign}${fmt(total)}</div>
    </div>

    <!-- Botón ir al diario filtrado -->
    <button class="btn btn-outline btn-block mb-12" onclick="closeSettingsSheet(); setJournalFilter('${cat.type}'); setJournalCatFilter('${catId}'); navigate('journal');">
      📒 Ver en el Diario con este filtro
    </button>

    <!-- Lista por mes -->
    <div style="font-size:12px; font-weight:700; color:var(--gray-500); text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px;">Desglose por fecha</div>
    ${allTxs.length
      ? `<div style="max-height:55vh; overflow-y:auto;">${listHTML}</div>`
      : `<p style="color:var(--gray-400); text-align:center; padding:20px 0;">Sin registros en esta categoría</p>`}

    <button class="btn btn-secondary btn-block mt-16" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function prevMonth() {
  reportMonth--;
  if (reportMonth < 1) { reportMonth = 12; reportYear--; }
  renderReports();
}
function nextMonth() {
  reportMonth++;
  if (reportMonth > 12) { reportMonth = 1; reportYear++; }
  renderReports();
}
function printReport() {
  requireOwnerPin(() => {
    DB.logAudit('export_pdf', '📄 PDF exportado');
    showToast('📄 Preparando PDF...');
    setTimeout(() => window.print(), 400);
  });
}

// ── Inventario ─────────────────────────────────────────────────────────────────
function renderInventory() {
  const search   = (document.getElementById('inventory-search')?.value || '').toLowerCase().trim();
  const allProds = DB.getInventory();
  const products = search
    ? allProds.filter(p =>
        p.name.toLowerCase().includes(search) ||
        (p.sku || '').toLowerCase().includes(search)
      )
    : allProds;

  const container = document.getElementById('inventory-list');

  if (!allProds.length) {
    container.innerHTML = emptyHTML('📦', 'Sin productos', 'Agrega tu primer producto con el botón +');
  } else if (!products.length) {
    container.innerHTML = emptyHTML('🔍', 'Sin resultados', 'No hay productos con ese nombre o código');
  } else {
    container.innerHTML = products.map(p => {
      // Badge IVA
      const ivaBadge = p.tipoIva === 'SIN_IVA'
        ? `<span style="font-size:10px; background:#dcfce7; color:#15803d; border-radius:6px; padding:1px 6px; font-weight:700; margin-left:4px;">0%</span>`
        : p.tipoIva === 'IVA_NO_INCLUIDO'
        ? `<span style="font-size:10px; background:#fef3c7; color:#d97706; border-radius:6px; padding:1px 6px; font-weight:700; margin-left:4px;">+IVA</span>`
        : p.tipoIva === 'IVA_INCLUIDO'
        ? `<span style="font-size:10px; background:#eff6ff; color:#2563eb; border-radius:6px; padding:1px 6px; font-weight:700; margin-left:4px;">c/IVA</span>`
        : '';
      // Línea de precio con desglose si tiene IVA
      const precioLine = p.precioFinal > 0
        ? (p.tipoIva === 'IVA_INCLUIDO'
            ? `<div style="font-size:12px; color:var(--gray-500); margin-top:2px;">Precio: ${fmt(p.precioFinal)} <span style="font-size:10px;">(base ${fmt(p.precioBase)} + IVA ${fmt(p.valorIva)})</span></div>`
          : p.tipoIva === 'IVA_NO_INCLUIDO'
            ? `<div style="font-size:12px; color:var(--gray-500); margin-top:2px;">Precio base: ${fmt(p.precioBase)} → Total: ${fmt(p.precioFinal)}</div>`
          : `<div style="font-size:12px; color:var(--gray-500); margin-top:2px;">Precio: ${fmt(p.precioFinal)} (sin IVA)</div>`)
        : '';

      // Stock color & badge con minStock
      const minStk     = p.minStock || 0;
      const stockColor = minStk > 0
        ? (p.quantity <= minStk           ? 'var(--danger)'
         : p.quantity <= minStk * 2       ? 'var(--warning)'
         :                                  'var(--success)')
        : (p.quantity <= 5 ? 'var(--danger)' : p.quantity <= 15 ? 'var(--warning)' : 'var(--success)');
      const stockBadge = minStk > 0 && p.quantity <= minStk
        ? `<div style="font-size:10px; font-weight:700; color:var(--danger); white-space:nowrap; margin-top:2px;">⚠️ Stock bajo</div>`
        : minStk > 0 && p.quantity <= minStk * 2
        ? `<div style="font-size:10px; font-weight:700; color:var(--warning); white-space:nowrap; margin-top:2px;">📉 Quedando poco</div>`
        : '';

      return `
      <div class="card inv-card" style="margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="font-size:36px; width:48px; text-align:center;">${p.emoji || '📦'}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:16px; font-weight:700;">${p.name}${ivaBadge}</div>
            ${p.sku ? `<div style="font-size:11px; color:var(--primary); font-family:monospace; margin-top:2px; background:var(--primary-light); display:inline-block; padding:1px 7px; border-radius:5px;">📊 ${p.sku}</div>` : ''}
            ${precioLine}
            ${p.unitCost ? `<div style="font-size:12px; color:var(--gray-400);">Costo compra: ${fmt(p.unitCost)} / ${p.unit}</div>` : `<div style="font-size:12px; color:var(--gray-400);">${p.unit}</div>`}
          </div>
          <div style="text-align:right; flex-shrink:0;">
            <div style="font-size:24px; font-weight:800; color:${stockColor};">${p.quantity}</div>
            <div style="font-size:11px; color:var(--gray-500);">${p.unit}</div>
            ${minStk > 0 ? `<div style="font-size:10px; color:var(--gray-400);">mín: ${minStk}</div>` : ''}
            ${stockBadge}
          </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="openProductForm('${p.id}')">✏️ Editar</button>
          <button class="btn btn-outline btn-sm" onclick="adjustStock('${p.id}')">📥 Ajustar stock</button>
          <button class="btn btn-icon" style="background:var(--danger-light); color:var(--danger);" onclick="deleteProduct('${p.id}')">🗑️</button>
        </div>
      </div>
      `;
    }).join('');
  }

  // Total valor inventario (siempre sobre todos los productos, no los filtrados)
  const totalValue = allProds.reduce((s, p) => s + (p.quantity * (p.unitCost || 0)), 0);
  document.getElementById('inv-total-value').textContent = fmt(totalValue);
  document.getElementById('inv-total-items').textContent = allProds.length + ' producto' + (allProds.length !== 1 ? 's' : '');
}

function openProductForm(editId = null) {
  const p = editId ? DB.getProductById(editId) : null;
  const EMOJIS = ['📦','👗','👕','👖','👟','👔','👜','🧴','💄','🍕','🧃','📱','🔧','📚','🪑','🖥️'];
  const hasBarcode = 'BarcodeDetector' in window;
  const ivaPct = DB.getSettings().porcentajeIva || DB.IVA_DEFAULT;

  // Sugerencia IVA inicial (si es producto nuevo)
  const ivaInicial = p
    ? { tipoIva: p.tipoIva || 'SIN_IVA' }
    : DB.getIvaSuggestion('', null);

  const sheet = document.getElementById('settings-sheet');
  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">${p ? 'Editar Producto' : 'Nuevo Producto'}</h3>

    <div class="form-group">
      <label class="form-label">Emoji / Ícono</label>
      <div id="emoji-picker" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
        ${EMOJIS.map(e => `<button onclick="selectEmoji('${e}')" style="font-size:24px; width:40px; height:40px; border-radius:8px; background:${(p?.emoji||'📦')===e?'var(--primary-light)':'var(--gray-100)'}; border:${(p?.emoji||'📦')===e?'2px solid var(--primary)':'2px solid transparent'};" data-emoji="${e}">${e}</button>`).join('')}
      </div>
      <input type="hidden" id="p-emoji" value="${p?.emoji || '📦'}">
    </div>

    <div class="form-group">
      <label class="form-label">Nombre del producto *</label>
      <input type="text" class="form-control" id="p-name" value="${p?.name || ''}"
        placeholder="Ej: Jean Levi's, Arroz 1kg, Galletas"
        oninput="_onProductNameInput(this.value)">
      <div id="p-iva-hint" style="display:none; margin-top:6px; padding:8px 10px; border-radius:8px;
        background:#eff6ff; border:1px solid #bfdbfe; font-size:12px; color:#1e40af;"></div>
    </div>

    <!-- ════ SELECTOR IVA — EL CORAZÓN DEL SISTEMA ════ -->
    <div class="form-group">
      <label class="form-label">¿Cómo manejas el IVA en este producto?</label>
      <div id="iva-selector" style="display:flex; flex-direction:column; gap:8px;">

        <label id="iva-opt-sin" onclick="_selectIva('SIN_IVA')" style="cursor:pointer; display:flex; align-items:flex-start; gap:12px;
          padding:12px 14px; border-radius:12px; border:2px solid ${(p?.tipoIva||ivaInicial.tipoIva)==='SIN_IVA'?'var(--success)':'var(--gray-200)'};
          background:${(p?.tipoIva||ivaInicial.tipoIva)==='SIN_IVA'?'#f0fdf4':'white'}; transition:all .15s;">
          <div style="width:20px; height:20px; border-radius:50%; border:2px solid ${(p?.tipoIva||ivaInicial.tipoIva)==='SIN_IVA'?'var(--success)':'var(--gray-300)'};
            background:${(p?.tipoIva||ivaInicial.tipoIva)==='SIN_IVA'?'var(--success)':'white'};
            flex-shrink:0; margin-top:1px; display:flex; align-items:center; justify-content:center;">
            ${(p?.tipoIva||ivaInicial.tipoIva)==='SIN_IVA'?'<div style="width:8px;height:8px;border-radius:50%;background:white;"></div>':''}
          </div>
          <div style="flex:1;">
            <div style="font-size:14px; font-weight:700; color:var(--gray-800);">🟢 No lleva IVA</div>
            <div style="font-size:12px; color:var(--gray-500); margin-top:2px;">Tarifa 0%: alimentos naturales, medicinas, libros, etc.</div>
          </div>
        </label>

        <label id="iva-opt-noinc" onclick="_selectIva('IVA_NO_INCLUIDO')" style="cursor:pointer; display:flex; align-items:flex-start; gap:12px;
          padding:12px 14px; border-radius:12px; border:2px solid ${(p?.tipoIva||ivaInicial.tipoIva)==='IVA_NO_INCLUIDO'?'var(--warning)':'var(--gray-200)'};
          background:${(p?.tipoIva||ivaInicial.tipoIva)==='IVA_NO_INCLUIDO'?'#fffbeb':'white'}; transition:all .15s;">
          <div style="width:20px; height:20px; border-radius:50%; border:2px solid ${(p?.tipoIva||ivaInicial.tipoIva)==='IVA_NO_INCLUIDO'?'var(--warning)':'var(--gray-300)'};
            background:${(p?.tipoIva||ivaInicial.tipoIva)==='IVA_NO_INCLUIDO'?'var(--warning)':'white'};
            flex-shrink:0; margin-top:1px; display:flex; align-items:center; justify-content:center;">
            ${(p?.tipoIva||ivaInicial.tipoIva)==='IVA_NO_INCLUIDO'?'<div style="width:8px;height:8px;border-radius:50%;background:white;"></div>':''}
          </div>
          <div style="flex:1;">
            <div style="font-size:14px; font-weight:700; color:var(--gray-800);">🟡 El precio NO incluye IVA</div>
            <div style="font-size:12px; color:var(--gray-500); margin-top:2px;">Ingresas $10 → la app calcula +IVA ${ivaPct}% → total $${(10 * (1 + ivaPct/100)).toFixed(2)}</div>
          </div>
        </label>

        <label id="iva-opt-inc" onclick="_selectIva('IVA_INCLUIDO')" style="cursor:pointer; display:flex; align-items:flex-start; gap:12px;
          padding:12px 14px; border-radius:12px; border:2px solid ${(p?.tipoIva||ivaInicial.tipoIva)==='IVA_INCLUIDO'?'var(--primary)':'var(--gray-200)'};
          background:${(p?.tipoIva||ivaInicial.tipoIva)==='IVA_INCLUIDO'?'#eff6ff':'white'}; transition:all .15s;">
          <div style="width:20px; height:20px; border-radius:50%; border:2px solid ${(p?.tipoIva||ivaInicial.tipoIva)==='IVA_INCLUIDO'?'var(--primary)':'var(--gray-300)'};
            background:${(p?.tipoIva||ivaInicial.tipoIva)==='IVA_INCLUIDO'?'var(--primary)':'white'};
            flex-shrink:0; margin-top:1px; display:flex; align-items:center; justify-content:center;">
            ${(p?.tipoIva||ivaInicial.tipoIva)==='IVA_INCLUIDO'?'<div style="width:8px;height:8px;border-radius:50%;background:white;"></div>':''}
          </div>
          <div style="flex:1;">
            <div style="font-size:14px; font-weight:700; color:var(--gray-800);">🔵 El precio YA incluye IVA</div>
            <div style="font-size:12px; color:var(--gray-500); margin-top:2px;">Ingresas $${(10 * (1 + ivaPct/100)).toFixed(2)} → la app separa base $10 + IVA $${(10 * ivaPct/100).toFixed(2)}</div>
          </div>
        </label>

      </div>
      <input type="hidden" id="p-tipo-iva" value="${p?.tipoIva || ivaInicial.tipoIva}">
    </div>

    <div class="form-group">
      <label class="form-label" id="p-precio-label">Precio de venta</label>
      <div style="position:relative;">
        <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--gray-500); font-weight:700; pointer-events:none;">$</span>
        <input type="number" class="form-control" id="p-precio" min="0" step="any"
          value="${p?.precioFinal || p?.unitCost || ''}"
          placeholder="0.00"
          style="padding-left:26px;"
          oninput="_calcIvaPreview()">
      </div>
      <!-- Preview en tiempo real del desglose IVA -->
      <div id="p-iva-preview" style="display:none; margin-top:8px; padding:10px 12px; border-radius:10px;
        background:var(--gray-50); border:1px solid var(--gray-200); font-size:12px;"></div>
    </div>

    <div class="form-group">
      <label class="form-label">
        Código / SKU
        <span style="font-size:11px; color:var(--gray-400); font-weight:400;"> — código de barras o interno</span>
      </label>
      <div style="display:flex; gap:8px;">
        <input type="text" class="form-control" id="p-sku" value="${p?.sku || ''}"
          placeholder="Ej: 7501234567890, CAM-RJ-M"
          style="flex:1; font-family:monospace; letter-spacing:.5px;">
        ${hasBarcode
          ? `<button type="button" onclick="openBarcodeScanner('p-sku')"
               style="padding:0 14px; border-radius:10px; background:var(--primary); color:white; border:none; cursor:pointer; font-size:20px;">📷</button>`
          : `<button type="button" onclick="showToast('📷 Abre en Chrome Android para escanear',3000)"
               style="padding:0 14px; border-radius:10px; background:var(--gray-100); color:var(--gray-400); border:none; cursor:pointer; font-size:20px; opacity:.6;">📷</button>`}
      </div>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <div class="form-group">
        <label class="form-label">Stock actual</label>
        <input type="number" class="form-control" id="p-qty" value="${p?.quantity ?? 0}" min="0" step="1">
      </div>
      <div class="form-group">
        <label class="form-label">Unidad</label>
        <select class="form-control" id="p-unit">
          ${['unidades','pares','metros','litros','kilos','cajas','docenas'].map(u => `<option ${(p?.unit||'unidades')===u?'selected':''}>${u}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">
        Stock mínimo
        <span style="font-size:11px; color:var(--danger); font-weight:600; margin-left:4px;">⚠️ Alerta</span>
      </label>
      <input type="number" class="form-control" id="p-minstock" value="${p?.minStock ?? ''}"
        min="0" step="1" placeholder="0 = sin alertas">
      <div style="font-size:11px; color:var(--gray-400); margin-top:4px;">
        Recibirás una alerta en el inicio cuando el stock baje de este número
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Costo unitario de compra (opcional)</label>
      <input type="number" class="form-control" id="p-cost" value="${p?.unitCost || ''}" min="0" step="any" placeholder="0">
    </div>

    <button class="btn btn-primary btn-block mt-16" onclick="saveProduct('${editId || ''}')">
      ${p ? '✅ Actualizar Producto' : '✅ Agregar Producto'}
    </button>
    ${p ? `<button class="btn btn-danger btn-block mt-8" onclick="deleteProduct('${p.id}')">🗑️ Eliminar producto</button>` : ''}
  `;
  sheet.classList.add('open');

  // Si es nuevo producto y hay sugerencia, mostrar hint
  if (!p && ivaInicial.msg && ivaInicial.confianza !== 'baja') {
    setTimeout(() => {
      const hint = document.getElementById('p-iva-hint');
      if (hint) { hint.style.display = 'block'; hint.textContent = '💡 ' + ivaInicial.msg; }
    }, 300);
  }
  // Preview inicial si hay precio
  if (p?.precioFinal) setTimeout(_calcIvaPreview, 100);
}

// ── Lógica IVA en tiempo real ──────────────────────────────────────────────
let _ivaNameDebounce = null;
function _onProductNameInput(nombre) {
  clearTimeout(_ivaNameDebounce);
  _ivaNameDebounce = setTimeout(() => {
    if (!nombre.trim()) return;
    const sug  = DB.getIvaSuggestion(nombre, null);
    const hint = document.getElementById('p-iva-hint');
    if (!hint) return;
    if (sug.confianza === 'alta' || sug.confianza === 'media') {
      hint.style.display = 'block';
      hint.textContent   = '💡 ' + sug.msg;
      // Auto-seleccionar si la confianza es alta (memoria del negocio)
      if (sug.confianza === 'alta') _selectIva(sug.tipoIva);
    } else {
      hint.style.display = 'none';
    }
  }, 400);
}

function _selectIva(tipo) {
  const el = document.getElementById('p-tipo-iva');
  if (!el) return;
  el.value = tipo;

  const configs = {
    'SIN_IVA':          { id:'iva-opt-sin',   border:'var(--success)', bg:'#f0fdf4', dot:'var(--success)' },
    'IVA_NO_INCLUIDO':  { id:'iva-opt-noinc', border:'var(--warning)', bg:'#fffbeb', dot:'var(--warning)' },
    'IVA_INCLUIDO':     { id:'iva-opt-inc',   border:'var(--primary)', bg:'#eff6ff', dot:'var(--primary)' },
  };

  Object.entries(configs).forEach(([t, cfg]) => {
    const label = document.getElementById(cfg.id);
    if (!label) return;
    const isActive = t === tipo;
    label.style.border     = `2px solid ${isActive ? cfg.border : 'var(--gray-200)'}`;
    label.style.background = isActive ? cfg.bg : 'white';
    const circle = label.querySelector('div');
    if (circle) {
      circle.style.border     = `2px solid ${isActive ? cfg.dot : 'var(--gray-300)'}`;
      circle.style.background = isActive ? cfg.dot : 'white';
      circle.innerHTML = isActive ? '<div style="width:8px;height:8px;border-radius:50%;background:white;"></div>' : '';
    }
  });

  const lblEl = document.getElementById('p-precio-label');
  if (lblEl) {
    lblEl.textContent = tipo === 'SIN_IVA'         ? 'Precio de venta (sin IVA)'
                      : tipo === 'IVA_NO_INCLUIDO' ? 'Precio base (SIN IVA) — la app sumará el IVA'
                      : 'Precio de venta final (YA incluye IVA)';
  }
  _calcIvaPreview();
}

function _calcIvaPreview() {
  const precio = parseFloat(document.getElementById('p-precio')?.value) || 0;
  const tipo   = document.getElementById('p-tipo-iva')?.value || 'SIN_IVA';
  const ivaPct = DB.getSettings().porcentajeIva || DB.IVA_DEFAULT;
  const prev   = document.getElementById('p-iva-preview');
  if (!prev) return;

  if (!precio || tipo === 'SIN_IVA') { prev.style.display = 'none'; return; }

  const r = DB.calcIva(precio, tipo, ivaPct);
  const fmtN = n => '$' + n.toFixed(2);

  if (tipo === 'IVA_NO_INCLUIDO') {
    prev.style.display = 'block';
    prev.style.borderLeft = '3px solid var(--warning)';
    prev.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px; color:var(--gray-700);">💰 El cliente pagará:</div>
      <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
        <span style="color:var(--gray-500);">Precio base</span><span style="font-weight:700;">${fmtN(r.precioBase)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
        <span style="color:var(--gray-500);">IVA ${ivaPct}%</span><span style="font-weight:700; color:var(--warning);">+${fmtN(r.valorIva)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; padding-top:5px; border-top:1px solid var(--gray-200);">
        <span style="font-weight:800;">Total final</span><span style="font-weight:800; color:var(--primary); font-size:14px;">${fmtN(r.precioFinal)}</span>
      </div>`;
  } else if (tipo === 'IVA_INCLUIDO') {
    prev.style.display = 'block';
    prev.style.borderLeft = '3px solid var(--primary)';
    prev.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px; color:var(--gray-700);">📊 Desglose del precio final:</div>
      <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
        <span style="color:var(--gray-500);">Base gravable</span><span style="font-weight:700;">${fmtN(r.precioBase)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
        <span style="color:var(--gray-500);">IVA ${ivaPct}% (incluido)</span><span style="font-weight:700; color:var(--primary);">${fmtN(r.valorIva)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; padding-top:5px; border-top:1px solid var(--gray-200);">
        <span style="font-weight:800;">Precio final</span><span style="font-weight:800; color:var(--success); font-size:14px;">${fmtN(r.precioFinal)}</span>
      </div>`;
  }
}

function selectEmoji(e) {
  document.getElementById('p-emoji').value = e;
  document.querySelectorAll('#emoji-picker button').forEach(btn => {
    const isSelected = btn.dataset.emoji === e;
    btn.style.background = isSelected ? 'var(--primary-light)' : 'var(--gray-100)';
    btn.style.border = isSelected ? '2px solid var(--primary)' : '2px solid transparent';
  });
}

function saveProduct(editId) {
  const name = document.getElementById('p-name')?.value.trim();
  if (!name) { showToast('⚠️ Escribe el nombre del producto'); return; }

  const tipoIva    = document.getElementById('p-tipo-iva')?.value || 'SIN_IVA';
  const precioRaw  = parseFloat(document.getElementById('p-precio')?.value) || 0;
  const ivaPct     = DB.getSettings().porcentajeIva || DB.IVA_DEFAULT;
  const ivaCalc    = DB.calcIva(precioRaw, tipoIva, ivaPct);

  const data = {
    name,
    emoji:        document.getElementById('p-emoji')?.value || '📦',
    sku:          document.getElementById('p-sku')?.value.trim() || '',
    quantity:     parseFloat(document.getElementById('p-qty')?.value) || 0,
    minStock:     parseFloat(document.getElementById('p-minstock')?.value) || 0,
    unitCost:     parseFloat(document.getElementById('p-cost')?.value) || 0,
    unit:         document.getElementById('p-unit')?.value || 'unidades',
    // Campos IVA
    tipoIva,
    precioVenta:  precioRaw,
    precioBase:   ivaCalc.precioBase,
    precioFinal:  ivaCalc.precioFinal,
    valorIva:     ivaCalc.valorIva,
    porcentajeIva: ivaPct,
  };
  if (editId) DB.updateProduct(editId, data);
  else        DB.addProduct(data);
  closeSettingsSheet();
  renderInventory();
  showToast(editId ? '✅ Producto actualizado' : '✅ Producto agregado');
}

function adjustStock(productId) {
  const p = DB.getProductById(productId);
  if (!p) return;
  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">Ajustar Stock — ${p.emoji || '📦'} ${p.name}</h3>
    <div style="text-align:center; margin:16px 0; padding:16px; background:var(--gray-50); border-radius:10px;">
      <div style="font-size:13px; color:var(--gray-500);">Stock actual</div>
      <div style="font-size:42px; font-weight:800; color:var(--primary);">${p.quantity}</div>
      <div style="font-size:13px; color:var(--gray-500);">${p.unit}</div>
    </div>
    <div class="form-group">
      <label class="form-label">Nuevo stock</label>
      <input type="number" class="form-control" id="adj-qty" value="${p.quantity}" min="0" step="1">
    </div>
    <div class="form-group">
      <label class="form-label">Motivo</label>
      <input type="text" class="form-control" id="adj-reason" placeholder="Ej: Conteo físico, Pérdida, Devolución">
    </div>
    <button class="btn btn-primary btn-block mt-16" onclick="
      const qty = parseFloat(document.getElementById('adj-qty').value) || 0;
      DB.updateProduct('${productId}', { quantity: qty });
      closeSettingsSheet();
      renderInventory();
      showToast('✅ Stock ajustado a ' + qty + ' ${p.unit}');
    ">✅ Guardar ajuste</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function deleteProduct(id) {
  if (!isCurrentUserOwner()) {
    showToast('🚫 Solo el propietario puede eliminar productos', 2500); return;
  }
  if (!confirm('¿Eliminar este producto? El historial de transacciones no se verá afectado.')) return;
  DB.deleteProduct(id);
  closeSettingsSheet();
  renderInventory();
  showToast('🗑️ Producto eliminado');
}

// ── Importar desde Excel / CSV ────────────────────────────────────────────────
function importFromExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('⚠️ Conecta a internet una vez para cargar el módulo Excel', 4000);
    return;
  }
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.xlsx,.xls,.csv';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => _processExcelData(ev.target.result, file.name);
    reader.readAsArrayBuffer(file);
  };
  input.click();
}

function _processExcelData(buffer, filename) {
  let rows;
  try {
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  } catch {
    showToast('❌ No se pudo leer el archivo. Usa .xlsx o .csv'); return;
  }

  if (rows.length < 2) { showToast('⚠️ El archivo está vacío'); return; }

  // Detectar columnas por encabezado (flexible, case-insensitive)
  const header = rows[0].map(h => String(h).toLowerCase().trim());
  const iNombre   = header.findIndex(h => h.includes('producto') || h.includes('nombre'));
  const iCantidad = header.findIndex(h => h.includes('cantidad') || h.includes('qty') || h.includes('stock'));
  const iCosto    = header.findIndex(h => h.includes('costo') || h.includes('precio') || h.includes('price'));
  const iSku      = header.findIndex(h => h.includes('sku') || h.includes('codigo') || h.includes('código') || h.includes('code'));
  const iAccion   = header.findIndex(h => h.includes('accion') || h.includes('acción') || h.includes('operacion') || h.includes('operación') || h.includes('accion'));

  if (iNombre < 0) { showToast('❌ No se encontró columna "Producto" o "Nombre"'); return; }

  let added = 0, updated = 0, deleted = 0, skipped = 0;
  const errors = [];

  rows.slice(1).forEach((row, idx) => {
    const lineNum  = idx + 2;
    const nombre   = String(row[iNombre] ?? '').trim();
    const cantStr  = iCantidad >= 0 ? row[iCantidad] : 0;
    const costoStr = iCosto    >= 0 ? row[iCosto]    : 0;
    const skuVal   = iSku      >= 0 ? String(row[iSku]    || '').trim() : '';
    const accion   = iAccion   >= 0 ? String(row[iAccion] || '').toLowerCase().trim() : 'agregar';

    if (!nombre) return; // fila vacía — silencioso

    const cantidad = parseFloat(cantStr);
    const costo    = parseFloat(costoStr);

    const existente = DB.getInventory().find(
      p => p.name.toLowerCase() === nombre.toLowerCase() ||
           (skuVal && p.sku && p.sku.toLowerCase() === skuVal.toLowerCase())
    );

    // ── Eliminar ─────────────────────────────────────
    if (accion === 'eliminar' || accion === 'delete' || accion === 'borrar') {
      if (existente) {
        DB.deleteProduct(existente.id);
        deleted++;
      }
      return;
    }

    // ── Reducir stock ─────────────────────────────────
    const esReduccion = accion === 'reducir' || accion === 'restar' || accion === 'descontar' || cantidad < 0;
    const absQty      = Math.abs(isNaN(cantidad) ? 0 : cantidad);

    if (iCantidad >= 0 && isNaN(cantidad) && !esReduccion) {
      errors.push(`Fila ${lineNum}: cantidad inválida ("${cantStr}")`); skipped++; return;
    }
    if (iCosto >= 0 && isNaN(costo) && String(costoStr).trim() !== '') {
      errors.push(`Fila ${lineNum}: costo inválido ("${costoStr}")`); skipped++; return;
    }

    if (existente) {
      let newQty;
      if (esReduccion) {
        newQty = Math.max(0, (existente.quantity || 0) - absQty);
      } else {
        newQty = (existente.quantity || 0) + (isNaN(cantidad) ? 0 : cantidad);
      }
      const newCost = (!isNaN(costo) && costo > 0) ? costo : existente.unitCost;
      const newSku  = skuVal || existente.sku || '';
      DB.updateProduct(existente.id, { quantity: newQty, unitCost: newCost, sku: newSku });
      updated++;
    } else if (!esReduccion) {
      DB.addProduct({
        name:     nombre,
        sku:      skuVal,
        quantity: isNaN(cantidad) ? 0 : Math.max(0, cantidad),
        unitCost: isNaN(costo)    ? 0 : costo,
        emoji:    '📦',
        unit:     'unidades',
      });
      added++;
    }
  });

  renderInventory();
  const parts = [];
  if (added)   parts.push(added   + ' agregado' + (added   !== 1 ? 's' : ''));
  if (updated) parts.push(updated + ' actualizado' + (updated !== 1 ? 's' : ''));
  if (deleted) parts.push(deleted + ' eliminado' + (deleted !== 1 ? 's' : ''));
  if (skipped) parts.push(skipped + ' omitido' + (skipped  !== 1 ? 's' : ''));
  showToast('✅ ' + parts.join(' · '), 4000);
  if (errors.length) {
    console.warn('Errores de importación:', errors);
    setTimeout(() => showToast('⚠️ ' + errors[0], 4000), 2800);
  }
}

function openImportSheet() {
  const xlsxReady = typeof XLSX !== 'undefined';
  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">📊 Importar Inventario</h3>

    ${!xlsxReady ? `
      <div style="background:#fef3c7;border-radius:10px;padding:14px;margin-bottom:16px;font-size:13px;color:#92400e;">
        ⚠️ <strong>Se necesita internet una vez</strong> para cargar el módulo de Excel.<br>
        Después funciona sin conexión.
      </div>
    ` : ''}

    <div style="background:var(--primary-light);border-radius:10px;padding:14px;margin-bottom:12px;font-size:13px;color:var(--primary);line-height:1.6;">
      <strong>Columnas del archivo Excel:</strong><br><br>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <tr style="background:var(--primary);color:white;">
          <th style="padding:5px 8px;text-align:left;">Producto*</th>
          <th style="padding:5px 8px;text-align:left;">SKU</th>
          <th style="padding:5px 8px;text-align:left;">Cantidad</th>
          <th style="padding:5px 8px;text-align:left;">Costo</th>
          <th style="padding:5px 8px;text-align:left;">Accion</th>
        </tr>
        <tr style="background:white;">
          <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;">Blusas</td>
          <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;">BLU-001</td>
          <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;">10</td>
          <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;">25.00</td>
          <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;color:#16a34a;">agregar</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;">Jeans</td>
          <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;">JEA-32</td>
          <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;">5</td>
          <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;"></td>
          <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;color:#d97706;">reducir</td>
        </tr>
        <tr style="background:white;">
          <td style="padding:5px 8px;">Gorras</td>
          <td style="padding:5px 8px;font-family:monospace;">GOR-001</td>
          <td style="padding:5px 8px;"></td>
          <td style="padding:5px 8px;"></td>
          <td style="padding:5px 8px;color:#dc2626;">eliminar</td>
        </tr>
      </table>
      </div>
    </div>

    <div style="font-size:12px;color:var(--gray-600);margin-bottom:16px;line-height:1.7;">
      ✅ <strong>agregar</strong> (default) — suma al stock o crea si no existe<br>
      🔽 <strong>reducir</strong> — descuenta del stock actual<br>
      🗑️ <strong>eliminar</strong> — borra el producto del inventario<br>
      🔍 Busca por <strong>nombre</strong> o <strong>SKU</strong> para coincidir<br>
      📊 SKU: código de barras, EAN-13, o código interno
    </div>

    <button class="btn btn-primary btn-block mb-12" onclick="importFromExcel()">
      📂 Seleccionar archivo Excel / CSV
    </button>
    <button class="btn btn-outline btn-block mb-12" onclick="showExcelTemplate()">
      📥 Descargar plantilla de ejemplo
    </button>
    <button class="btn btn-secondary btn-block" onclick="closeSettingsSheet()">
      Cancelar
    </button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function showExcelTemplate() {
  if (typeof XLSX === 'undefined') { showToast('⚠️ Conecta a internet una vez para cargar el módulo'); return; }
  const ws = XLSX.utils.aoa_to_sheet([
    ['Producto',  'SKU',        'Cantidad', 'Costo',  'Accion'],
    ['Blusas',    'BLU-RJ-M',   10,         25.00,    'agregar'],
    ['Jeans',     'JEA-AZ-32',  5,          50.00,    'agregar'],
    ['Zapatos',   '7501234567890', 8,        80.00,    'agregar'],
    ['Camisetas', 'CAM-BL-S',  -3,          '',       'reducir'],
    ['Gorras',    'GOR-001',    '',          '',       'eliminar'],
  ]);
  ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  XLSX.writeFile(wb, 'plantilla-inventario.xlsx');
  showToast('📥 Plantilla descargada');
}

// ── Gastos Recurrentes ────────────────────────────────────────────────────────
const FREQ_LABELS = { monthly: 'Mensual' };
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

function fmtNextExec(r) {
  const d = DB.getNextExecution(r);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return 'Hoy';
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
}

// Renderiza la pantalla principal de recurrentes (dentro del sheet de settings)
function openRecurringManager() {
  const list = DB.getRecurrings();
  const total = list.filter(r => r.isActive).reduce((s, r) => s + r.amount, 0);

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <h3 class="sheet-title" style="margin:0;">⚙️ Gastos Recurrentes</h3>
      <button class="btn btn-primary btn-sm" onclick="openRecurringForm()">+ Nuevo</button>
    </div>

    ${list.length ? `
      <div style="background:var(--primary-light); border-radius:10px; padding:12px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:12px; color:var(--primary); font-weight:600;">Total fijo mensual</div>
          <div style="font-size:22px; font-weight:800; color:var(--primary);">${fmt(total)}</div>
        </div>
        <div style="font-size:11px; color:var(--primary); text-align:right;">
          ${list.filter(r => r.isActive).length} activo(s)<br>
          ${list.filter(r => !r.isActive).length} inactivo(s)
        </div>
      </div>
    ` : ''}

    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px;">
      ${list.length ? list.map(r => {
        const cat = DB.getCategoryById(r.category);
        const acc = DB.getAccountById(r.account);
        return `
          <div style="background:${r.isActive ? 'var(--white)' : 'var(--gray-50)'}; border:1.5px solid ${r.isActive ? 'var(--gray-200)' : 'var(--gray-200)'}; border-radius:12px; padding:14px; ${r.isActive ? '' : 'opacity:.6;'}">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="font-size:26px;">${cat ? cat.emoji : '💸'}</div>
              <div style="flex:1;">
                <div style="font-weight:700; font-size:15px;">${r.name}</div>
                <div style="font-size:12px; color:var(--gray-500); margin-top:2px;">
                  Día ${r.dayOfMonth} de cada mes &nbsp;·&nbsp;
                  ${cat ? cat.name : 'Sin categoría'}
                  ${acc ? ' · ' + acc.name : ''}
                </div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:17px; font-weight:800; color:var(--danger);">${fmt(r.amount)}</div>
                <div style="font-size:11px; color:var(--gray-400); margin-top:1px;">
                  Próx: ${r.isActive ? fmtNextExec(r) : 'Pausado'}
                </div>
              </div>
            </div>
            <div style="display:flex; gap:8px; margin-top:12px; padding-top:10px; border-top:1px solid var(--gray-100);">
              <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="openRecurringForm('${r.id}')">✏️ Editar</button>
              <button class="btn btn-sm" style="flex:1; background:${r.isActive ? '#fef3c7' : '#dcfce7'}; color:${r.isActive ? '#92400e' : '#166534'};"
                onclick="toggleRecurring('${r.id}', ${!r.isActive})">
                ${r.isActive ? '⏸ Pausar' : '▶️ Activar'}
              </button>
              <button class="btn btn-sm btn-icon" style="background:var(--danger-light); color:var(--danger); border-radius:8px; width:36px;"
                onclick="confirmDeleteRecurring('${r.id}')">🗑️</button>
            </div>
          </div>
        `;
      }).join('') : `
        <div style="text-align:center; padding:40px 20px; color:var(--gray-400);">
          <div style="font-size:48px; margin-bottom:12px;">🔄</div>
          <div style="font-size:16px; font-weight:600; color:var(--gray-700); margin-bottom:6px;">Sin gastos recurrentes</div>
          <p style="font-size:14px; line-height:1.5;">Configura Internet, Arriendo y otros gastos fijos para que se registren solos cada mes.</p>
        </div>
      `}
    </div>

    <div style="background:var(--gray-50); border-radius:10px; padding:12px; font-size:13px; color:var(--gray-600); line-height:1.6;">
      💡 Los gastos recurrentes se registran automáticamente cuando abres la app. Si no abriste la app en varios meses, se generan todos los meses pendientes.
    </div>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

// Formulario para agregar / editar un gasto recurrente
function openRecurringForm(editId = null) {
  const r   = editId ? DB.getRecurringById(editId) : null;
  const cats = DB.getCategoriesByType('expense');
  const accs = DB.getAccounts();

  const catOpts = '<option value="">— Categoría (recomendada) —</option>' +
    cats.map(c => `<option value="${c.id}" ${r?.category === c.id ? 'selected' : ''}>${c.emoji} ${c.name}</option>`).join('');

  const accOpts = '<option value="">— Cuenta (opcional) —</option>' +
    accs.map(a => `<option value="${a.id}" ${r?.account === a.id ? 'selected' : ''}>${a.emoji} ${a.name}</option>`).join('');

  const dayOpts = DAYS.map(d =>
    `<option value="${d}" ${(r?.dayOfMonth ?? 1) === d ? 'selected' : ''}>${d}</option>`
  ).join('');

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">${r ? 'Editar Gasto Recurrente' : 'Nuevo Gasto Recurrente'}</h3>

    <div style="background:var(--primary-light); border-radius:10px; padding:12px; margin-bottom:16px; font-size:13px; color:var(--primary); line-height:1.6;">
      🔄 Este gasto se registrará <strong>automáticamente</strong> cada mes en el día que indiques.
    </div>

    <div class="form-group">
      <label class="form-label">Nombre del gasto *</label>
      <input type="text" class="form-control" id="rec-name"
        value="${r?.name || ''}" placeholder="Ej: Internet, Arriendo, Netflix">
    </div>

    <div class="form-group">
      <label class="form-label">Monto mensual *</label>
      <input type="number" class="form-control" id="rec-amount"
        value="${r?.amount || ''}" placeholder="0" min="0" step="any" inputmode="decimal">
    </div>

    <div class="form-group">
      <label class="form-label">Categoría</label>
      <select class="form-control" id="rec-category">${catOpts}</select>
    </div>

    <div class="form-group">
      <label class="form-label">Cuenta de débito</label>
      <select class="form-control" id="rec-account">${accOpts}</select>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">Día del mes *</label>
        <select class="form-control" id="rec-day">${dayOpts}</select>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">Fecha de inicio</label>
        <input type="date" class="form-control" id="rec-start"
          value="${r?.startDate || today()}">
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Notas (opcional)</label>
      <input type="text" class="form-control" id="rec-notes"
        value="${r?.notes || ''}" placeholder="Ej: Plan básico, proveedor X">
    </div>

    <button class="btn btn-primary btn-block mt-8" onclick="saveRecurring('${editId || ''}')">
      ✅ ${r ? 'Actualizar' : 'Guardar gasto recurrente'}
    </button>
    <button class="btn btn-secondary btn-block mt-8" onclick="openRecurringManager()">
      ← Volver a la lista
    </button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function saveRecurring(editId) {
  const name   = document.getElementById('rec-name')?.value.trim();
  const amount = parseFloat(document.getElementById('rec-amount')?.value);

  if (!name)            { showToast('⚠️ Escribe el nombre del gasto'); return; }
  if (!amount || amount <= 0) { showToast('⚠️ Ingresa un monto válido'); return; }

  const data = {
    name,
    amount,
    category:   document.getElementById('rec-category')?.value || '',
    account:    document.getElementById('rec-account')?.value  || '',
    dayOfMonth: parseInt(document.getElementById('rec-day')?.value) || 1,
    startDate:  document.getElementById('rec-start')?.value || today(),
    notes:      document.getElementById('rec-notes')?.value.trim() || '',
  };

  if (editId) {
    DB.updateRecurring(editId, data);
    showToast('✅ Gasto recurrente actualizado');
  } else {
    DB.addRecurring(data);
    showToast('✅ Gasto recurrente configurado');
  }

  // Procesar inmediatamente por si el día ya pasó este mes
  const generated = DB.processRecurringExpenses();
  if (generated.length) showToast(`🔄 ${generated.length} gasto(s) generado(s) automáticamente`, 3500);

  openRecurringManager();
  if (currentScreen === 'dashboard') renderDashboard();
}

function toggleRecurring(id, newActive) {
  DB.updateRecurring(id, { isActive: newActive });
  if (newActive) {
    const generated = DB.processRecurringExpenses();
    if (generated.length) showToast(`🔄 ${generated.length} gasto(s) generado(s)`, 3000);
  }
  openRecurringManager();
  showToast(newActive ? '▶️ Recurrente activado' : '⏸ Recurrente pausado');
}

function confirmDeleteRecurring(id) {
  if (!isCurrentUserOwner()) {
    showToast('🚫 Solo el propietario puede eliminar gastos recurrentes', 2500); return;
  }
  const r = DB.getRecurringById(id);
  if (!r) return;
  if (!confirm(`¿Eliminar "${r.name}"?\n\nLas transacciones históricas ya generadas NO se borrarán.`)) return;
  DB.deleteRecurring(id);
  openRecurringManager();
  showToast('🗑️ Gasto recurrente eliminado');
}

// Renderiza el bloque de "Próximos pagos" del dashboard
// ── Panel unificado de vencimientos (pagos + cobros) ─────────────────────────
function renderUpcomingAlerts() {
  const el = document.getElementById('dash-upcoming');
  if (!el) return;

  const alerts   = DB.getUpcomingAlerts(7);
  const vencidos = alerts.filter(a => a.vencido);
  const proximos = alerts.filter(a => !a.vencido);
  const urgentes = alerts.filter(a => a.daysUntil <= 0).length; // hoy + vencidos

  if (!alerts.length) { el.style.display = 'none'; return; }

  const dayLabel = a => {
    if (a.vencido)      return `<span style="color:var(--danger);font-weight:700;">Venció hace ${Math.abs(a.daysUntil)} día${Math.abs(a.daysUntil) > 1 ? 's' : ''}</span>`;
    if (a.daysUntil === 0) return `<span style="color:var(--danger);font-weight:800;">HOY</span>`;
    if (a.daysUntil === 1) return `<span style="color:#d97706;font-weight:700;">Mañana</span>`;
    return `<span style="color:var(--gray-400);">En ${a.daysUntil} días · ${fmtDate(a.fecha)}</span>`;
  };

  const itemHTML = a => {
    const isPago   = a.tipo === 'pago';
    const bg       = a.vencido   ? '#fef2f2'
                   : a.daysUntil === 0 ? (isPago ? '#fff7ed' : '#f0fdf4')
                   : 'var(--gray-50)';
    const border   = a.vencido || a.daysUntil === 0
                   ? `border-left:3px solid ${a.vencido ? 'var(--danger)' : isPago ? '#f59e0b' : 'var(--success)'};` : '';
    const amtColor = a.vencido ? 'var(--danger)' : isPago ? 'var(--warning)' : 'var(--success)';
    const sign     = isPago ? '−' : '+';
    const badge    = isPago
      ? `<span style="font-size:9px;background:#fff7ed;color:#d97706;border:1px solid #f59e0b;border-radius:6px;padding:1px 5px;font-weight:700;margin-left:4px;">PAGO</span>`
      : `<span style="font-size:9px;background:#f0fdf4;color:var(--success);border:1px solid var(--success);border-radius:6px;padding:1px 5px;font-weight:700;margin-left:4px;">COBRO</span>`;
    return `
      <div style="display:flex; align-items:center; gap:10px; padding:10px 12px; margin-bottom:6px;
        background:${bg}; border-radius:10px; ${border}">
        <div style="font-size:20px; flex-shrink:0;">${a.emoji}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${a.titulo}${badge}
          </div>
          <div style="font-size:11px; margin-top:2px;">${dayLabel(a)}</div>
        </div>
        <div style="font-size:14px; font-weight:800; color:${amtColor}; flex-shrink:0; white-space:nowrap;">
          ${sign}${fmt(a.monto)}
        </div>
      </div>
    `;
  };

  const notifBtn = ('Notification' in window) && Notification.permission !== 'granted' && Notification.permission !== 'denied'
    ? `<button onclick="_requestNotifPermission()" style="width:100%; padding:9px; margin-top:4px;
        background:none; border:1.5px dashed var(--gray-300); border-radius:10px;
        font-size:12px; color:var(--gray-500); cursor:pointer; font-weight:600;">
        🔔 Activar recordatorios automáticos
      </button>`
    : '';

  el.style.display = 'block';
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header" style="margin-bottom:12px;">
        <div class="card-title">
          🔔 Próximos Vencimientos
          ${urgentes > 0 ? `<span style="background:var(--danger);color:white;border-radius:10px;
            font-size:10px;padding:2px 7px;margin-left:6px;font-weight:800;">${urgentes}</span>` : ''}
        </div>
        <span style="font-size:11px; color:var(--gray-400);">Próximos 7 días</span>
      </div>
      ${vencidos.length ? `
        <div style="font-size:10px; font-weight:800; color:var(--danger); text-transform:uppercase;
          letter-spacing:.5px; margin-bottom:6px;">⚠️ Vencidos</div>
        ${vencidos.map(itemHTML).join('')}
        ${proximos.length ? `<div style="height:1px; background:var(--gray-100); margin:10px 0;"></div>` : ''}
      ` : ''}
      ${proximos.map(itemHTML).join('')}
      ${notifBtn}
    </div>
  `;
}

// Alias para compatibilidad con llamadas existentes
function renderUpcomingRecurrings() { renderUpcomingAlerts(); }

// ── Notificaciones nativas del navegador ─────────────────────────────────────
async function _requestNotifPermission() {
  if (!('Notification' in window)) {
    showToast('❌ Tu navegador no admite notificaciones'); return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    showToast('✅ Notificaciones activadas');
    _fireNotifications(true); // forzar aunque ya se envió hoy
    renderUpcomingAlerts();
  } else {
    showToast('⚠️ Notificaciones bloqueadas en el navegador');
  }
}

function _fireNotifications(force = false) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Una vez por día (salvo que se llame con force=true)
  const today = new Date().toISOString().slice(0, 10);
  if (!force) {
    if (localStorage.getItem('cf_notif_lastCheck') === today) return;
  }
  localStorage.setItem('cf_notif_lastCheck', today);

  const s      = DB.getSettings();
  const alerts = DB.getUpcomingAlerts(7);
  const hoy    = alerts.filter(a => a.daysUntil === 0 && !a.vencido);
  const manana = alerts.filter(a => a.daysUntil === 1);
  const venc   = alerts.filter(a => a.vencido);

  hoy.forEach(a => {
    new Notification(a.tipo === 'cobro' ? '💳 Cobro HOY' : '💸 Pago HOY', {
      body: `${a.titulo}\n${fmt(a.monto)}`,
      icon: '/contafacil/icons/icon-192.png',
      tag:  `cf-${a.id}-${today}`,
    });
  });

  manana.forEach(a => {
    new Notification(a.tipo === 'cobro' ? '💳 Cobro mañana' : '💸 Pago mañana', {
      body: `${a.titulo}\n${fmt(a.monto)}`,
      icon: '/contafacil/icons/icon-192.png',
      tag:  `cf-${a.id}-${today}`,
    });
  });

  if (venc.length > 0) {
    new Notification(`⚠️ ${venc.length} cobro${venc.length > 1 ? 's' : ''} vencido${venc.length > 1 ? 's' : ''}`, {
      body: venc.slice(0, 3).map(a => `${a.titulo} · ${fmt(a.monto)}`).join('\n'),
      icon: '/contafacil/icons/icon-192.png',
      tag:  `cf-overdue-${today}`,
    });
  }
}

// ── Resumen Anual ─────────────────────────────────────────────────────────────
let annualYear      = new Date().getFullYear();
let annualOpen      = false;
let _chartAnnual    = null;
const MONTH_NAMES   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function toggleAnnualView() {
  annualOpen = !annualOpen;
  document.getElementById('annual-view').style.display = annualOpen ? 'block' : 'none';
  document.getElementById('annual-toggle-icon').textContent = annualOpen ? '▲' : '▼';
  if (annualOpen) renderAnnualView();
}

function renderAnnualView() {
  document.getElementById('annual-year-label').textContent = annualYear;
  document.getElementById('annual-year-title').textContent = annualYear;

  const months = Array.from({ length: 12 }, (_, i) => {
    const stats = DB.getMonthStats(annualYear, i + 1);
    return { m: i + 1, label: MONTH_NAMES[i], ...stats };
  });

  const totalIncome  = months.reduce((s, m) => s + m.income, 0);
  const totalExp     = months.reduce((s, m) => s + (m.opExpenses + m.cogs), 0);
  const totalNet     = months.reduce((s, m) => s + m.netProfit, 0);
  const bestMonth    = months.reduce((best, m) => m.netProfit > best.netProfit ? m : best, months[0]);

  // KPIs
  document.getElementById('annual-kpis').innerHTML = `
    <div style="background:var(--gray-50); border-radius:10px; padding:10px; text-align:center;">
      <div style="font-size:10px; color:var(--gray-500); font-weight:600; margin-bottom:4px;">INGRESOS</div>
      <div style="font-size:14px; font-weight:800; color:var(--success);">${fmt(totalIncome)}</div>
    </div>
    <div style="background:var(--gray-50); border-radius:10px; padding:10px; text-align:center;">
      <div style="font-size:10px; color:var(--gray-500); font-weight:600; margin-bottom:4px;">GASTOS</div>
      <div style="font-size:14px; font-weight:800; color:var(--danger);">${fmt(totalExp)}</div>
    </div>
    <div style="background:${totalNet >= 0 ? '#f0fdf4' : '#fff1f2'}; border-radius:10px; padding:10px; text-align:center; border:1.5px solid ${totalNet >= 0 ? '#bbf7d0' : '#fecaca'};">
      <div style="font-size:10px; color:var(--gray-500); font-weight:600; margin-bottom:4px;">UTILIDAD</div>
      <div style="font-size:14px; font-weight:800; color:${totalNet >= 0 ? 'var(--success)' : 'var(--danger)'};">${totalNet >= 0 ? '+' : ''}${fmt(totalNet)}</div>
    </div>
  `;

  // Tabla 12 meses
  const now = new Date();
  document.getElementById('annual-tbody').innerHTML = months.map(m => {
    const isCurrentMonth = m.m === (now.getMonth() + 1) && annualYear === now.getFullYear();
    const hasData = m.income > 0 || m.opExpenses > 0;
    const netColor = m.netProfit > 0 ? 'var(--success)' : m.netProfit < 0 ? 'var(--danger)' : 'var(--gray-400)';
    return `<tr style="background:${isCurrentMonth ? 'var(--primary-light)' : (m.m % 2 === 0 ? 'var(--gray-50)' : 'white')}; ${!hasData ? 'opacity:.5;' : ''}">
      <td style="padding:7px 10px; font-weight:${isCurrentMonth ? '700' : '500'}; color:${isCurrentMonth ? 'var(--primary)' : 'inherit'};">${m.label}${isCurrentMonth ? ' ●' : ''}</td>
      <td style="padding:7px 8px; text-align:right; color:var(--success); font-weight:600;">${m.income > 0 ? fmt(m.income) : '—'}</td>
      <td style="padding:7px 8px; text-align:right; color:var(--danger);">${(m.opExpenses + m.cogs) > 0 ? fmt(m.opExpenses + m.cogs) : '—'}</td>
      <td style="padding:7px 10px; text-align:right; font-weight:700; color:${netColor};">${hasData ? (m.netProfit >= 0 ? '+' : '') + fmt(m.netProfit) : '—'}</td>
    </tr>`;
  }).join('');

  // Totales
  document.getElementById('annual-tfoot').innerHTML = `
    <tr style="background:var(--primary); color:white; font-weight:700;">
      <td style="padding:8px 10px; border-radius:0 0 0 6px;">TOTAL ${annualYear}</td>
      <td style="padding:8px 8px; text-align:right;">${fmt(totalIncome)}</td>
      <td style="padding:8px 8px; text-align:right;">${fmt(totalExp)}</td>
      <td style="padding:8px 10px; text-align:right; border-radius:0 0 6px 0;">${totalNet >= 0 ? '+' : ''}${fmt(totalNet)}</td>
    </tr>
  `;

  // Gráfica anual (solo si Chart.js disponible)
  const ctx = document.getElementById('chart-annual')?.getContext('2d');
  if (ctx && typeof Chart !== 'undefined') {
    if (_chartAnnual) { _chartAnnual.destroy(); _chartAnnual = null; }
    _chartAnnual = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: MONTH_NAMES,
        datasets: [
          {
            label: 'Ingresos',
            data: months.map(m => m.income),
            backgroundColor: 'rgba(22,163,74,0.75)',
            borderRadius: 4,
            borderSkipped: false,
          },
          {
            label: 'Gastos',
            data: months.map(m => m.opExpenses + m.cogs),
            backgroundColor: 'rgba(220,38,38,0.70)',
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 12, padding: 8 } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const s = DB.getSettings();
                return ctx.dataset.label + ': ' + s.currencySymbol + ' ' +
                  Number(ctx.raw).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 } } },
          y: {
            grid: { color: '#f3f4f6' },
            ticks: {
              font: { size: 9 },
              callback: val => {
                const s = DB.getSettings();
                if (val >= 1000000) return s.currencySymbol + (val / 1000000).toFixed(1) + 'M';
                if (val >= 1000)    return s.currencySymbol + (val / 1000).toFixed(0) + 'K';
                return val === 0 ? '0' : '';
              },
            },
          },
        },
      },
    });
  }
}

// ── PDF Anual ─────────────────────────────────────────────────────────────────
// Construye la sección #print-annual-section con datos del año,
// activa body.print-annual (CSS oculta el contenido mensual),
// lanza window.print() y restaura el estado al cerrar el diálogo.
function printAnnualReport() {
  requireOwnerPin(() => {
    const s      = DB.getSettings();
    const months = Array.from({ length: 12 }, (_, i) => {
      const stats = DB.getMonthStats(annualYear, i + 1);
      return { m: i + 1, label: MONTH_NAMES[i], ...stats };
    });

    const totInc = months.reduce((a, m) => a + m.income, 0);
    const totExp = months.reduce((a, m) => a + m.opExpenses + m.cogs, 0);
    const totNet = months.reduce((a, m) => a + m.netProfit, 0);
    const sign   = v => (v >= 0 ? '+' : '') + fmt(v);
    const clr    = v => v >= 0 ? '#16a34a' : '#dc2626';

    // Llenar encabezado
    document.getElementById('pan-company').textContent   = s.companyName;
    document.getElementById('pan-title').textContent     = 'Resumen Anual ' + annualYear;
    document.getElementById('pan-generated').textContent = 'Generado el ' + fmtDate(today());

    // KPIs
    document.getElementById('pan-kpis').innerHTML = `
      <div style="flex:1; border:1px solid #e5e7eb; border-radius:10px; padding:12px; text-align:center;">
        <div style="font-size:10px; color:#6b7280; font-weight:700; margin-bottom:5px;">INGRESOS</div>
        <div style="font-size:17px; font-weight:800; color:#16a34a;">${fmt(totInc)}</div>
      </div>
      <div style="flex:1; border:1px solid #e5e7eb; border-radius:10px; padding:12px; text-align:center;">
        <div style="font-size:10px; color:#6b7280; font-weight:700; margin-bottom:5px;">GASTOS</div>
        <div style="font-size:17px; font-weight:800; color:#dc2626;">${fmt(totExp)}</div>
      </div>
      <div style="flex:1; border:1.5px solid ${totNet >= 0 ? '#bbf7d0' : '#fecaca'}; border-radius:10px; padding:12px; text-align:center; background:${totNet >= 0 ? '#f0fdf4' : '#fff1f2'};">
        <div style="font-size:10px; color:#6b7280; font-weight:700; margin-bottom:5px;">UTILIDAD</div>
        <div style="font-size:17px; font-weight:800; color:${clr(totNet)};">${sign(totNet)}</div>
      </div>`;

    // Tabla mensual
    document.getElementById('pan-tbody').innerHTML = months.map((m, i) => {
      const exp     = m.opExpenses + m.cogs;
      const hasData = m.income > 0 || exp > 0;
      return `<tr style="background:${i % 2 === 0 ? 'white' : '#f9fafb'}; ${!hasData ? 'opacity:.4;' : ''}">
        <td style="padding:9px 12px; font-weight:600;">${m.label}</td>
        <td style="padding:9px 10px; text-align:right; color:#16a34a; font-weight:600;">${m.income > 0 ? fmt(m.income) : '—'}</td>
        <td style="padding:9px 10px; text-align:right; color:#dc2626;">${exp > 0 ? fmt(exp) : '—'}</td>
        <td style="padding:9px 12px; text-align:right; font-weight:800; color:${clr(m.netProfit)};">${hasData ? sign(m.netProfit) : '—'}</td>
      </tr>`;
    }).join('');

    document.getElementById('pan-tfoot').innerHTML = `
      <tr style="background:#2563eb; color:white; font-weight:800;">
        <td style="padding:10px 12px; border-radius:0 0 0 6px;">TOTAL ${annualYear}</td>
        <td style="padding:10px 10px; text-align:right;">${fmt(totInc)}</td>
        <td style="padding:10px 10px; text-align:right;">${fmt(totExp)}</td>
        <td style="padding:10px 12px; text-align:right; border-radius:0 0 6px 0;">${sign(totNet)}</td>
      </tr>`;

    document.getElementById('pan-footer').textContent =
      'Generado con ContaFácil Pro · ' + s.companyName + ' · ' + annualYear;

    // Activar modo impresión anual: CSS oculta el contenido mensual
    DB.logAudit('export_pdf', '📅 PDF Anual ' + annualYear + ' exportado');
    document.body.classList.add('print-annual');
    setTimeout(() => {
      window.print();
      // Restaurar modo normal después de que se cierre el diálogo de impresión
      setTimeout(() => document.body.classList.remove('print-annual'), 1200);
    }, 300);
  });
}

// ── Generador de Excel .xlsx REAL, 100% OFFLINE ───────────────────────────────
// Genera un archivo .xlsx genuino (formato Open XML: un ZIP con XML adentro).
// Sin librerías, sin internet. Abre limpio en Excel PC, Excel móvil, Google
// Sheets y WPS — sin avisos de "archivo dañado". Con fórmulas reales auditables.
function _xmlEsc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function _xlsStatusLabel(st) {
  return ({ paid: 'Pagada', partial: 'Abono parcial', pending: 'Pendiente', overdue: 'Vencida' })[st]
    || (st || '—');
}

// Celda de fecha: si es YYYY-MM-DD válida, la marca como fecha real de Excel
function _xlsDate(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return { v: d, t: 'date', s: 'date' };
  }
  return d ? String(d) : '';
}

// Letra de columna a partir del número (1→A, 27→AA)
function _colLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Número de serie de fecha de Excel (días desde 1899-12-30)
function _excelSerial(iso) {
  const p = String(iso).split('-');
  return Math.floor((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Convierte una fórmula de notación R1C1 a A1 (la celda conoce su fila/columna)
function _r1c1ToA1(formula, curRow, curCol) {
  return formula.replace(/R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?/g, (m, rp, cp) => {
    let row, col;
    if (rp === undefined)   row = curRow;
    else if (rp[0] === '[') row = curRow + parseInt(rp.slice(1, -1), 10);
    else                    row = parseInt(rp, 10);
    if (cp === undefined)   col = curCol;
    else if (cp[0] === '[') col = curCol + parseInt(cp.slice(1, -1), 10);
    else                    col = parseInt(cp, 10);
    return _colLetter(col) + row;
  });
}

// Índice de cada estilo dentro de cellXfs (ver _xlsxStyles)
const _XLSX_STYLE = {
  title: 1, subtitle: 2, header: 3, label: 4, money: 5, moneyBold: 6,
  date: 7, percent: 8, sectionHead: 9, totalLabel: 10, totalRow: 11,
};

// styles.xml — fuentes, rellenos, bordes y formatos de número
function _xlsxStyles(sym) {
  const money = '&quot;' + _xmlEsc(sym || '$') + '&quot;#,##0.00';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3">' +
      '<numFmt numFmtId="164" formatCode="' + money + '"/>' +
      '<numFmt numFmtId="165" formatCode="0.0%"/>' +
      '<numFmt numFmtId="166" formatCode="dd/mm/yyyy"/>' +
    '</numFmts>' +
    '<fonts count="6">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="15"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF64748B"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="5">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FF1E3A8A"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="12">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="164" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="165" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
      '<xf numFmtId="0" fontId="5" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="164" fontId="3" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>' +
    '</cellXfs>' +
    '</styleSheet>';
}

// Genera el XML de una hoja de cálculo (worksheet OOXML)
function _xlsxSheetXML(sheet) {
  const merges = [];
  let body = '';
  sheet.rows.forEach((cells, ri) => {
    const rowNum = ri + 1;
    body += '<row r="' + rowNum + '">';
    let col = 1;
    cells.forEach(c => {
      if (c === null || c === undefined) { col++; return; }
      const cell = (typeof c === 'object') ? c : { v: c };
      const sIdx = cell.s ? (_XLSX_STYLE[cell.s] || 0) : 0;
      const sAttr = sIdx ? ' s="' + sIdx + '"' : '';
      const ref  = _colLetter(col) + rowNum;
      const hasVal = cell.v !== undefined && cell.v !== null && cell.v !== '';
      if (cell.merge) merges.push(ref + ':' + _colLetter(col + cell.merge) + rowNum);

      if (cell.f) {
        const f = _r1c1ToA1(String(cell.f).replace(/^=/, ''), rowNum, col);
        body += '<c r="' + ref + '"' + sAttr + '><f>' + _xmlEsc(f) + '</f><v>' +
                (hasVal ? cell.v : 0) + '</v></c>';
      } else if (cell.t === 'date' && hasVal) {
        body += '<c r="' + ref + '"' + sAttr + '><v>' + _excelSerial(cell.v) + '</v></c>';
      } else if (typeof cell.v === 'number') {
        body += '<c r="' + ref + '"' + sAttr + '><v>' + cell.v + '</v></c>';
      } else if (hasVal) {
        const txt = String(cell.v);
        const sp  = /^\s|\s$/.test(txt) ? ' xml:space="preserve"' : '';
        body += '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t' + sp + '>' +
                _xmlEsc(txt) + '</t></is></c>';
      } else if (sIdx) {
        body += '<c r="' + ref + '" s="' + sIdx + '"/>';
      }
      col += 1 + (cell.merge || 0);
    });
    body += '</row>';
  });
  let cols = '';
  if (sheet.cols && sheet.cols.length) {
    cols = '<cols>' + sheet.cols.map((w, i) =>
      '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' +
      (w / 7).toFixed(2) + '" customWidth="1"/>').join('') + '</cols>';
  }
  const mergeXml = merges.length
    ? '<mergeCells count="' + merges.length + '">' +
      merges.map(m => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>'
    : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    cols + '<sheetData>' + body + '</sheetData>' + mergeXml + '</worksheet>';
}

// CRC-32 (necesario para el ZIP)
let _CRC_TABLE = null;
function _crc32(bytes) {
  if (!_CRC_TABLE) {
    _CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = _CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Empaqueta los archivos en un ZIP (método "stored", sin compresión)
function _zipFiles(files) {
  const enc   = new TextEncoder();
  const parts = [];
  const meta  = [];
  let offset  = 0;
  const w16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const w32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
  const add = arr => {
    const u = (arr instanceof Uint8Array) ? arr : new Uint8Array(arr);
    parts.push(u); offset += u.length;
  };

  files.forEach(f => {
    const nameBytes = enc.encode(f.name);
    const data = f.data;
    const crc  = _crc32(data);
    meta.push({ nameBytes, crc, size: data.length, off: offset });
    add([].concat(
      [0x50, 0x4B, 0x03, 0x04], w16(20), w16(0), w16(0), w16(0), w16(0x21),
      w32(crc), w32(data.length), w32(data.length),
      w16(nameBytes.length), w16(0)
    ));
    add(nameBytes);
    add(data);
  });

  const cdStart = offset;
  files.forEach((f, i) => {
    const m = meta[i];
    add([].concat(
      [0x50, 0x4B, 0x01, 0x02], w16(20), w16(20), w16(0), w16(0), w16(0), w16(0x21),
      w32(m.crc), w32(m.size), w32(m.size),
      w16(m.nameBytes.length), w16(0), w16(0), w16(0), w16(0), w32(0),
      w32(m.off)
    ));
    add(m.nameBytes);
  });
  const cdSize = offset - cdStart;
  add([].concat(
    [0x50, 0x4B, 0x05, 0x06], w16(0), w16(0),
    w16(files.length), w16(files.length), w32(cdSize), w32(cdStart), w16(0)
  ));

  let total = 0;
  parts.forEach(p => total += p.length);
  const out = new Uint8Array(total);
  let pos = 0;
  parts.forEach(p => { out.set(p, pos); pos += p.length; });
  return out;
}

// Construye el .xlsx completo a partir del arreglo de hojas
function _buildXlsx(sheets, sym) {
  const enc   = new TextEncoder();
  const files = [];
  const e = (name, str) => files.push({ name, data: enc.encode(str) });

  let ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
  sheets.forEach((s, i) => {
    ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
          '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  });
  ct += '</Types>';
  e('[Content_Types].xml', ct);

  e('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>');

  let wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
  sheets.forEach((s, i) => {
    wb += '<sheet name="' + _xmlEsc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
  });
  wb += '</sheets></workbook>';
  e('xl/workbook.xml', wb);

  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  sheets.forEach((s, i) => {
    rels += '<Relationship Id="rId' + (i + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
      (i + 1) + '.xml"/>';
  });
  rels += '<Relationship Id="rId' + (sheets.length + 1) +
    '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
  rels += '</Relationships>';
  e('xl/_rels/workbook.xml.rels', rels);

  e('xl/styles.xml', _xlsxStyles(sym));
  sheets.forEach((s, i) => e('xl/worksheets/sheet' + (i + 1) + '.xml', _xlsxSheetXML(s)));

  return _zipFiles(files);
}

// Descarga un .xlsx
function _downloadXlsx(bytes, filename) {
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

// ── Exportar resumen anual a Excel ────────────────────────────────────────────
function exportAnnualExcel() {
  const s     = DB.getSettings();
  const sym   = s.currencySymbol || '$';
  const first = 5, last = 16; // los 12 meses ocupan las filas 5..16

  let tInc = 0, tOp = 0, tCmv = 0, tTotExp = 0, tNet = 0;
  const dataRows = MONTH_NAMES.map((mn, i) => {
    const st       = DB.getMonthStats(annualYear, i + 1);
    const gastoTot = st.opExpenses + st.cogs;
    tInc += st.income; tOp += st.opExpenses; tCmv += st.cogs;
    tTotExp += gastoTot; tNet += st.netProfit;
    return [
      { v: mn, s: 'label' },
      { v: st.income,     s: 'money' },
      { v: st.opExpenses, s: 'money' },
      { v: st.cogs,       s: 'money' },
      { f: '=RC[-2]+RC[-1]', v: gastoTot,     s: 'moneyBold' }, // Gastos Op + CMV
      { f: '=RC[-4]-RC[-1]', v: st.netProfit, s: 'moneyBold' }, // Ingresos - Gastos Totales
    ];
  });

  const rows = [
    [{ v: s.companyName, s: 'title', merge: 5 }],
    [{ v: 'Resumen Anual ' + annualYear, s: 'subtitle', merge: 5 }],
    [],
    ['Mes', 'Ingresos', 'Gastos Operativos', 'CMV', 'Gastos Totales', 'Utilidad Neta']
      .map(h => ({ v: h, s: 'header' })),
    ...dataRows,
    [
      { v: 'TOTAL ' + annualYear, s: 'totalLabel' },
      { f: '=SUM(R' + first + 'C2:R' + last + 'C2)', v: tInc,    s: 'totalRow' },
      { f: '=SUM(R' + first + 'C3:R' + last + 'C3)', v: tOp,     s: 'totalRow' },
      { f: '=SUM(R' + first + 'C4:R' + last + 'C4)', v: tCmv,    s: 'totalRow' },
      { f: '=SUM(R' + first + 'C5:R' + last + 'C5)', v: tTotExp, s: 'totalRow' },
      { f: '=SUM(R' + first + 'C6:R' + last + 'C6)', v: tNet,    s: 'totalRow' },
    ],
    [],
    [
      { v: 'Promedio mensual', s: 'label' },
      { f: '=AVERAGE(R' + first + 'C2:R' + last + 'C2)', v: tInc / 12,    s: 'moneyBold' },
      { f: '=AVERAGE(R' + first + 'C3:R' + last + 'C3)', v: tOp / 12,     s: 'moneyBold' },
      { f: '=AVERAGE(R' + first + 'C4:R' + last + 'C4)', v: tCmv / 12,    s: 'moneyBold' },
      { f: '=AVERAGE(R' + first + 'C5:R' + last + 'C5)', v: tTotExp / 12, s: 'moneyBold' },
      { f: '=AVERAGE(R' + first + 'C6:R' + last + 'C6)', v: tNet / 12,    s: 'moneyBold' },
    ],
  ];

  const filename = 'ContaFacil_Anual_' + annualYear + '_' +
    s.companyName.replace(/\s+/g, '-') + '.xlsx';
  try {
    const bytes = _buildXlsx([{
      name: 'Anual ' + annualYear,
      cols: [95, 125, 145, 105, 140, 135],
      rows,
    }], sym);
    _downloadXlsx(bytes, filename);
    DB.logAudit('export_excel', '📊 Excel anual: ' + filename);
    showToast('📥 Resumen anual ' + annualYear + ' descargado', 3000);
  } catch (err) {
    showToast('❌ No se pudo generar el Excel: ' + err.message, 4000);
  }
}

// ── Exportar a Excel mensual (100% offline, con fórmulas auditables) ──────────
function exportToExcel() {
  requireOwnerPin(_doExportToExcel);
}
function _doExportToExcel() {
  const s   = DB.getSettings();
  const sym = s.currencySymbol || '$';
  const txs = DB.getTransactionsByMonth(reportYear, reportMonth)
    .slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const pnl = DB.getProfitStatement(reportYear, reportMonth);
  const monthLabel = new Date(reportYear, reportMonth - 1, 1)
    .toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  const TYPE_LABELS = { income:'Ingreso', expense:'Gasto', transfer:'Traslado', liability:'Deuda' };
  const deudaTot = txs.filter(t => t.type === 'liability').reduce((a, t) => a + t.amount, 0);

  // ═══ HOJA «Transacciones» — datos crudos + fila TOTALES con fórmula SUM ═══
  const txData = [];
  txs.forEach(t => {
    const cat  = DB.getCategoryById(t.category);
    const acc  = DB.getAccountById(t.account);
    const fAcc = DB.getAccountById(t.fromAccount);
    const tAcc = DB.getAccountById(t.toAccount);
    let ingreso = '', gastoOp = '', cmv = '', deuda = '', catLabel = '', accLabel = '';
    const splitAcc = (Array.isArray(t.splitPayments) && t.splitPayments.length)
      ? t.splitPayments.map(sp => { const a = DB.getAccountById(sp.account); return a ? a.name : '?'; }).join(' + ')
      : '';
    if (t.isCogs) {
      cmv = t.amount; catLabel = 'Costo de Ventas (CMV)';
    } else if (t.type === 'income') {
      ingreso = t.amount; catLabel = cat ? cat.name : 'Ingresos'; accLabel = splitAcc || (acc ? acc.name : '');
    } else if (t.type === 'expense') {
      gastoOp = t.amount; catLabel = cat ? cat.name : 'Gastos'; accLabel = splitAcc || (acc ? acc.name : '');
    } else if (t.type === 'transfer') {
      catLabel = (fAcc ? fAcc.name : '—') + ' → ' + (tAcc ? tAcc.name : '—');
    } else if (t.type === 'liability') {
      deuda = t.amount; catLabel = t.creditor || (cat ? cat.name : 'Cuentas por pagar');
    }
    txData.push([
      _xlsDate(t.date),
      t.description + (t.isCogs ? ' (auto-CMV)' : ''),
      t.isCogs ? 'CMV' : (TYPE_LABELS[t.type] || t.type),
      catLabel, accLabel,
      ingreso === '' ? '' : { v: ingreso, s: 'money' },
      gastoOp === '' ? '' : { v: gastoOp, s: 'money' },
      cmv     === '' ? '' : { v: cmv,     s: 'money' },
      deuda   === '' ? '' : { v: deuda,   s: 'money' },
      t.notes || '',
    ]);
  });
  if (txData.length === 0) {
    txData.push(['—', 'Sin movimientos registrados este mes', '—', '', '', '', '', '', '', '']);
  }
  const txFirst = 5;                          // primera fila de datos
  const txLast  = txFirst + txData.length - 1; // última fila de datos
  const txTotal = txLast + 1;                  // fila TOTALES
  const txSheet = {
    name: 'Transacciones',
    cols: [80, 240, 70, 175, 135, 95, 95, 85, 95, 200],
    rows: [
      [{ v: s.companyName, s: 'title', merge: 9 }],
      [{ v: 'Transacciones — ' + monthLabel, s: 'subtitle', merge: 9 }],
      [],
      ['Fecha','Descripción','Tipo','Categoría','Cuenta','Ingreso','Gasto Op.','CMV','Deuda','Notas']
        .map(h => ({ v: h, s: 'header' })),
      ...txData,
      [
        { v: 'TOTALES', s: 'totalLabel' }, { s: 'totalLabel' }, { s: 'totalLabel' },
        { s: 'totalLabel' }, { s: 'totalLabel' },
        { f: '=SUM(R' + txFirst + 'C6:R' + txLast + 'C6)', v: pnl.totalRevenue, s: 'totalRow' },
        { f: '=SUM(R' + txFirst + 'C7:R' + txLast + 'C7)', v: pnl.opExpenses,   s: 'totalRow' },
        { f: '=SUM(R' + txFirst + 'C8:R' + txLast + 'C8)', v: pnl.cogs,         s: 'totalRow' },
        { f: '=SUM(R' + txFirst + 'C9:R' + txLast + 'C9)', v: deudaTot,         s: 'totalRow' },
        { s: 'totalRow' },
      ],
    ],
  };

  // ═══ HOJA «Estado de Resultados» — P&L con fórmulas encadenadas ═══
  const pr = [];
  pr.push([{ v: s.companyName, s: 'title', merge: 1 }]);
  pr.push([{ v: 'Estado de Resultados — ' + monthLabel, s: 'subtitle', merge: 1 }]);
  pr.push([]);
  pr.push([{ v: 'INGRESOS', s: 'sectionHead', merge: 1 }]);
  const incStart = pr.length + 1;
  if (pnl.salesRevenue > 0)  pr.push([{ v: '   Ventas de productos' },        { v: pnl.salesRevenue,  s: 'money' }]);
  if (pnl.serviceIncome > 0) pr.push([{ v: '   Servicios / otros ingresos' }, { v: pnl.serviceIncome, s: 'money' }]);
  if (pnl.salesRevenue === 0 && pnl.serviceIncome === 0)
    pr.push([{ v: '   (sin ingresos este mes)' }, { v: 0, s: 'money' }]);
  const incEnd = pr.length;
  pr.push([{ v: 'TOTAL INGRESOS', s: 'label' },
           { f: '=SUM(R' + incStart + 'C2:R' + incEnd + 'C2)', v: pnl.totalRevenue, s: 'moneyBold' }]);
  const rTotInc = pr.length;
  pr.push([]);
  pr.push([{ v: '(menos) Costo de Mercadería Vendida', s: 'label' }, { v: pnl.cogs, s: 'money' }]);
  const rCogs = pr.length;
  pr.push([{ v: '= UTILIDAD BRUTA', s: 'label' },
           { f: '=R' + rTotInc + 'C2-R' + rCogs + 'C2', v: pnl.grossProfit, s: 'moneyBold' }]);
  const rGross = pr.length;
  pr.push([]);
  pr.push([{ v: 'GASTOS OPERATIVOS', s: 'sectionHead', merge: 1 }]);
  const expStart = pr.length + 1;
  const expEnt = Object.entries(pnl.expByCat);
  if (expEnt.length === 0) {
    pr.push([{ v: '   (sin gastos operativos)' }, { v: 0, s: 'money' }]);
  } else {
    expEnt.forEach(([catId, val]) => {
      const c = DB.getCategoryById(catId);
      pr.push([{ v: '   ' + (c ? c.name : 'Otros gastos') }, { v: val, s: 'money' }]);
    });
  }
  const expEnd = pr.length;
  pr.push([{ v: 'TOTAL GASTOS OPERATIVOS', s: 'label' },
           { f: '=SUM(R' + expStart + 'C2:R' + expEnd + 'C2)', v: pnl.opExpenses, s: 'moneyBold' }]);
  const rTotExp = pr.length;
  pr.push([]);
  pr.push([{ v: 'UTILIDAD NETA DEL MES', s: 'totalLabel' },
           { f: '=R' + rGross + 'C2-R' + rTotExp + 'C2', v: pnl.netProfit, s: 'totalRow' }]);
  const rNet = pr.length;
  pr.push([]);
  pr.push([{ v: 'Margen bruto (Utilidad bruta / Ingresos)', s: 'label' },
           { f: '=IF(R' + rTotInc + 'C2=0,0,R' + rGross + 'C2/R' + rTotInc + 'C2)',
             v: pnl.grossMargin / 100, s: 'percent' }]);
  pr.push([{ v: 'Margen neto (Utilidad neta / Ingresos)', s: 'label' },
           { f: '=IF(R' + rTotInc + 'C2=0,0,R' + rNet + 'C2/R' + rTotInc + 'C2)',
             v: pnl.netMargin / 100, s: 'percent' }]);
  const pnlSheet = { name: 'Estado de Resultados', cols: [310, 150], rows: pr };

  // ═══ HOJA «Resumen» — tablero que referencia las otras hojas con fórmulas ═══
  const ES = "'Estado de Resultados'";
  const resumenSheet = {
    name: 'Resumen',
    cols: [255, 140, 300],
    rows: [
      [{ v: s.companyName, s: 'title', merge: 2 }],
      [{ v: 'Resumen del mes — ' + monthLabel, s: 'subtitle', merge: 2 }],
      [],
      ['Concepto', 'Monto', 'Cómo se calcula'].map(h => ({ v: h, s: 'header' })),
      [{ v: 'Ingresos totales', s: 'label' },
       { f: '=' + ES + '!R' + rTotInc + 'C2', v: pnl.totalRevenue, s: 'moneyBold' },
       'Ventas de productos + servicios'],
      [{ v: 'Costo de mercadería (CMV)', s: 'label' },
       { f: '=' + ES + '!R' + rCogs + 'C2', v: pnl.cogs, s: 'moneyBold' },
       'Costo de los productos vendidos'],
      [{ v: 'Utilidad bruta', s: 'label' },
       { f: '=' + ES + '!R' + rGross + 'C2', v: pnl.grossProfit, s: 'moneyBold' },
       'Ingresos menos CMV'],
      [{ v: 'Gastos operativos', s: 'label' },
       { f: '=' + ES + '!R' + rTotExp + 'C2', v: pnl.opExpenses, s: 'moneyBold' },
       'Suma de gastos del negocio'],
      [{ v: 'UTILIDAD NETA', s: 'totalLabel' },
       { f: '=' + ES + '!R' + rNet + 'C2', v: pnl.netProfit, s: 'totalRow' },
       { v: 'Utilidad bruta menos Gastos operativos', s: 'totalLabel' }],
      [],
      [{ v: 'Deudas registradas en el mes', s: 'label' },
       { f: '=Transacciones!R' + txTotal + 'C9', v: deudaTot, s: 'moneyBold' },
       'Suma de la columna Deuda'],
      [{ v: 'Transacciones del mes', s: 'label' },
       { v: txs.length },
       'Cantidad de movimientos registrados'],
    ],
  };

  const sheets = [resumenSheet, txSheet, pnlSheet];

  // ═══ HOJA «Cartera (CxC)» — cuentas por cobrar, si existen ═══
  const recs = DB.getReceivables();
  if (recs && recs.length > 0) {
    const cFirst = 5;
    let cT = 0, cC = 0, cP = 0;
    const cData = recs.map(rec => {
      const cobrado  = (rec.payments || []).reduce((a, p) => a + p.amount, 0);
      const total    = rec.totalAmount || 0;
      const pendiente = Math.max(total - cobrado, 0);
      cT += total; cC += cobrado; cP += pendiente;
      return [
        rec.clientName || '—',
        rec.description || '',
        _xlsDate(rec.issueDate),
        _xlsDate(rec.dueDate),
        { v: total,   s: 'money' },
        { v: cobrado, s: 'money' },
        { f: '=RC[-2]-RC[-1]', v: pendiente, s: 'moneyBold' }, // Pendiente = Total - Cobrado
        _xlsStatusLabel(rec.status),
      ];
    });
    const cLast = cFirst + cData.length - 1;
    sheets.push({
      name: 'Cartera (CxC)',
      cols: [150, 200, 95, 95, 110, 110, 110, 115],
      rows: [
        [{ v: s.companyName, s: 'title', merge: 7 }],
        [{ v: 'Cuentas por Cobrar', s: 'subtitle', merge: 7 }],
        [],
        ['Cliente','Descripción','Emisión','Vencimiento','Total','Cobrado','Pendiente','Estado']
          .map(h => ({ v: h, s: 'header' })),
        ...cData,
        [
          { v: 'TOTALES', s: 'totalLabel' }, { s: 'totalLabel' }, { s: 'totalLabel' }, { s: 'totalLabel' },
          { f: '=SUM(R' + cFirst + 'C5:R' + cLast + 'C5)', v: cT, s: 'totalRow' },
          { f: '=SUM(R' + cFirst + 'C6:R' + cLast + 'C6)', v: cC, s: 'totalRow' },
          { f: '=SUM(R' + cFirst + 'C7:R' + cLast + 'C7)', v: cP, s: 'totalRow' },
          { s: 'totalRow' },
        ],
      ],
    });
  }

  const filename = 'ContaFacil_' + s.companyName.replace(/\s+/g, '-') +
    '_' + reportYear + '-' + String(reportMonth).padStart(2, '0') + '.xlsx';
  try {
    const bytes = _buildXlsx(sheets, sym);
    _downloadXlsx(bytes, filename);
    DB.logAudit('export_excel', '📊 Excel: ' + filename);
    showToast('📥 Excel descargado: ' + filename, 3500);
  } catch (err) {
    showToast('❌ No se pudo generar el Excel: ' + err.message, 4000);
  }
}

// ── Log de auditoría ─────────────────────────────────────────────────────────
function openAuditLog() {
  const log    = DB.getAuditLog(150);
  const isOwner = isCurrentUserOwner();

  const ACTION_LABELS = {
    login:             { icon:'🔓', label:'Inicio de sesión',  color:'#2563eb' },
    create_tx:         { icon:'➕', label:'Registro creado',    color:'#16a34a' },
    create_factura:    { icon:'🧾', label:'Factura registrada', color:'#16a34a' },
    edit_tx:           { icon:'✏️', label:'Registro editado',   color:'#d97706' },
    delete_tx:         { icon:'🗑️', label:'Registro eliminado', color:'#dc2626' },
    create_product:    { icon:'📦', label:'Producto creado',    color:'#16a34a' },
    delete_product:    { icon:'🗑️', label:'Producto eliminado', color:'#dc2626' },
    create_receivable: { icon:'💳', label:'CxC creada',         color:'#16a34a' },
    delete_receivable: { icon:'🗑️', label:'CxC eliminada',      color:'#dc2626' },
    export_pdf:        { icon:'📄', label:'PDF exportado',      color:'#7c3aed' },
    export_excel:      { icon:'📊', label:'Excel exportado',    color:'#7c3aed' },
    export_encrypted:  { icon:'🔐', label:'Export cifrado',     color:'#7c3aed' },
    import:            { icon:'📥', label:'Datos importados',   color:'#0891b2' },
  };

  const fmtTs = ts => {
    const d = new Date(ts);
    return d.toLocaleDateString('es-CO', { day:'2-digit', month:'short' }) + ' · ' +
           d.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
  };

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <h3 class="sheet-title" style="margin:0;">🕵️ Log de Auditoría</h3>
      ${isOwner ? `<button class="btn btn-outline" style="font-size:11px; padding:5px 10px; color:var(--danger); border-color:var(--danger);"
        onclick="requirePin(()=>{ DB.clearAuditLog(); closeSettingsSheet(); showToast('🗑️ Log limpiado'); })">
        Limpiar
      </button>` : ''}
    </div>

    ${log.length === 0 ? `
      <div style="text-align:center; padding:40px 0; color:var(--gray-400);">
        <div style="font-size:40px; margin-bottom:12px;">📋</div>
        <div>Sin actividad registrada aún</div>
      </div>
    ` : `
      <div style="font-size:11px; color:var(--gray-400); margin-bottom:12px;">
        Últimas ${log.length} actividades · Máx. 150
      </div>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${log.map(e => {
          const info = ACTION_LABELS[e.action] || { icon:'📌', label: e.action, color:'#6b7280' };
          return `
            <div style="display:flex; gap:10px; align-items:flex-start; padding:10px 12px;
              background:var(--gray-50); border-radius:10px; border-left:3px solid ${info.color};">
              <div style="font-size:18px; flex-shrink:0; margin-top:1px;">${info.icon}</div>
              <div style="flex:1; min-width:0;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:2px;">
                  <div style="font-size:12px; font-weight:700; color:${info.color};">${info.label}</div>
                  <div style="font-size:10px; color:var(--gray-400); white-space:nowrap;">${fmtTs(e.ts)}</div>
                </div>
                <div style="font-size:12px; color:var(--gray-600); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${e.detail}</div>
                <div style="font-size:10px; color:var(--gray-400); margin-top:2px;">👤 ${e.user}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}

    <button class="btn btn-secondary btn-block mt-16" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

// ── Gestión multi-empresa ─────────────────────────────────────────────────────
function openCompanySwitcher() {
  const companies = DB.getCompanyList();
  const active    = DB.getActiveCompany();

  const rows = companies.map(co => {
    const isActive = active && co.id === active.id;
    return `
      <div style="display:flex; align-items:center; gap:12px; padding:12px 14px; margin-bottom:8px;
        background:${isActive ? 'var(--primary)' : 'var(--gray-50)'}; border-radius:12px;
        border:2px solid ${isActive ? 'var(--primary)' : 'var(--gray-200)'};">
        <div style="font-size:28px; flex-shrink:0;">🏢</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:14px; font-weight:800; color:${isActive ? 'white' : 'var(--gray-800)'};
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${co.name}</div>
          <div style="font-size:11px; color:${isActive ? 'rgba(255,255,255,.75)' : 'var(--gray-400)'}; margin-top:1px;">
            ${isActive ? '✓ Empresa activa' : 'Toca para cambiar'}
          </div>
        </div>
        ${isActive ? `
          <button onclick="_editCompanyName('${co.id}','${co.name.replace(/'/g,"&#39;")}')"
            style="background:rgba(255,255,255,.2); border:none; border-radius:8px; padding:6px 10px;
              color:white; font-size:12px; font-weight:700; cursor:pointer; flex-shrink:0;">
            ✏️ Renombrar
          </button>
        ` : `
          <div style="display:flex; gap:6px; flex-shrink:0;">
            <button onclick="_switchToCompany('${co.id}')"
              style="background:var(--primary); border:none; border-radius:8px; padding:6px 12px;
                color:white; font-size:12px; font-weight:700; cursor:pointer;">
              Cambiar
            </button>
            ${companies.length > 1 ? `
              <button onclick="_deleteCompany('${co.id}','${co.name.replace(/'/g,"&#39;")}')"
                style="background:#fef2f2; border:none; border-radius:8px; padding:6px 10px;
                  color:var(--danger); font-size:16px; cursor:pointer;">
                🗑️
              </button>
            ` : ''}
          </div>
        `}
      </div>
    `;
  }).join('');

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">🏢 Mis Empresas</h3>

    <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px;
      padding:12px 14px; font-size:12px; color:#1e40af; margin-bottom:16px; line-height:1.6;">
      Cada empresa tiene datos, usuarios y seguridad <strong>completamente independientes</strong>.
      Al cambiar de empresa tendrás que ingresar el PIN de esa empresa.
    </div>

    <div style="margin-bottom:4px;">${rows}</div>

    <button onclick="_addNewCompany()" class="btn btn-outline btn-block" style="margin-top:8px;">
      ➕ Crear nueva empresa
    </button>
    <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function _switchToCompany(id) {
  DB.switchToCompany(id);
  closeSettingsSheet();
  showToast('🔄 Cambiando de empresa…');
  setTimeout(() => location.reload(), 600);
}

function _addNewCompany() {
  const name = prompt('Nombre de la nueva empresa:');
  if (!name || !name.trim()) return;
  const co = DB.addCompany(name);
  DB.switchToCompany(co.id);
  closeSettingsSheet();
  showToast('✅ Empresa creada. Cargando…');
  setTimeout(() => location.reload(), 700);
}

function _editCompanyName(id, currentName) {
  const name = prompt('Nuevo nombre:', currentName);
  if (!name || !name.trim() || name.trim() === currentName) return;
  DB.updateCompanyName(id, name);
  // Actualizar también companyName en settings de esa empresa
  DB.updateSettings({ companyName: name.trim() });
  openCompanySwitcher();
  renderDashboard();
  showToast('✅ Empresa renombrada');
}

function _deleteCompany(id, name) {
  const msg = `⚠️ ¿Eliminar "${name}"?\n\nSe borrarán TODOS los datos: transacciones, inventario, usuarios y configuración. Esta acción NO se puede deshacer.`;
  if (!confirm(msg)) return;
  try {
    DB.deleteCompany(id);
    closeSettingsSheet();
    showToast('🗑️ Empresa eliminada. Recargando…');
    setTimeout(() => location.reload(), 700);
  } catch(e) {
    showToast('❌ ' + e.message);
  }
}

// ── Transferir configuración ─────────────────────────────────────────────────
function openSettingsTransferSheet() {
  const isOwner = isCurrentUserOwner();
  const s       = DB.getSettings();

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">🔄 Transferir Configuración</h3>

    <div style="background:var(--gray-50); border-radius:12px; padding:14px 16px; margin-bottom:18px;
      border:1px solid var(--gray-200); font-size:12px; color:var(--gray-600); line-height:1.6;">
      <strong style="color:var(--gray-800);">¿Qué incluye el archivo?</strong><br>
      ✅ Empresa, moneda, usuarios y PINs (cifrados)<br>
      ✅ Permisos y restricciones por usuario<br>
      ✅ Cuentas, categorías, presupuestos y recurrentes<br>
      ⛔ <em>No incluye</em>: transacciones, inventario, CxC
    </div>

    ${isOwner ? `
    <div style="margin-bottom:16px;">
      <p style="font-size:13px; color:var(--gray-700); margin-bottom:10px;">
        <strong>📥 Descargar configuración</strong><br>
        <span style="font-size:12px; color:var(--gray-500);">Genera un archivo .json para importar en otro dispositivo.</span>
      </p>
      <button class="btn btn-primary btn-block" onclick="_doExportConfig()">
        ⬇️ Descargar configuración
      </button>
    </div>
    ` : `
    <div style="background:#fef3c7; border:1px solid #f59e0b; border-radius:10px; padding:12px 14px;
      font-size:12px; color:#92400e; margin-bottom:16px;">
      ⚠️ Solo el propietario puede descargar la configuración.
    </div>
    `}

    <div style="margin-bottom:16px;">
      <p style="font-size:13px; color:var(--gray-700); margin-bottom:10px;">
        <strong>📤 Importar configuración</strong><br>
        <span style="font-size:12px; color:var(--gray-500);">Carga un archivo .json exportado desde otro dispositivo.<br>
        <strong style="color:var(--danger);">⚠️ Reemplaza la configuración actual.</strong></span>
      </p>
      <label class="btn btn-outline btn-block" style="cursor:pointer; display:block; text-align:center;">
        📂 Seleccionar archivo .json
        <input type="file" accept=".json,application/json" style="display:none"
          onchange="_doImportConfig(this)">
      </label>
    </div>

    <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function _doExportConfig() {
  requireOwnerPin(() => {
    try {
      const json = DB.exportSettings();
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const s    = DB.getSettings();
      const date = new Date().toISOString().slice(0, 10);
      a.href     = url;
      a.download = `contafacil-config-${(s.companyName || 'empresa').toLowerCase().replace(/\s+/g,'-')}-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      DB.logAudit('export_config', 'Configuración exportada como JSON');
      showToast('✅ Configuración descargada');
    } catch(e) {
      showToast('❌ Error al exportar: ' + e.message);
    }
  });
}

function _doImportConfig(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const result = DB.importSettings(e.target.result);
      DB.logAudit('import_config', `Config importada de ${result.exportedBy} (${result.userCount} usuarios)`);
      closeSettingsSheet();
      showToast('✅ Configuración importada. Recargando…');
      setTimeout(() => location.reload(), 1200);
    } catch(err) {
      showToast('❌ Archivo inválido: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ── Presupuesto por categoría ─────────────────────────────────────────────────
function openBudgetManager() {
  const cats    = DB.getCategoriesByType('expense');
  const budgets = DB.getBudgets();
  const now     = new Date();
  const status  = DB.getBudgetStatus(now.getFullYear(), now.getMonth() + 1);
  const totalBudget = Object.values(budgets).reduce((s, v) => s + v, 0);

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <h3 class="sheet-title" style="margin:0;">🎯 Presupuesto Mensual</h3>
    </div>

    ${totalBudget > 0 ? `
      <div style="background:var(--primary-light); border-radius:10px; padding:12px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:12px; color:var(--primary); font-weight:600;">Total presupuestado</div>
          <div style="font-size:22px; font-weight:800; color:var(--primary);">${fmt(totalBudget)}/mes</div>
        </div>
        <div style="font-size:11px; color:var(--primary);">${Object.keys(budgets).length} categoría(s)</div>
      </div>
    ` : `
      <div style="background:var(--gray-50); border-radius:10px; padding:14px; margin-bottom:16px; font-size:13px; color:var(--gray-600); line-height:1.6;">
        🎯 Define cuánto puedes gastar por categoría cada mes. Te avisaremos cuando estés cerca del límite.
      </div>
    `}

    <div style="font-size:12px; font-weight:700; color:var(--gray-500); text-transform:uppercase; letter-spacing:.5px; margin-bottom:10px;">Límite por categoría</div>

    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px;">
      ${cats.map(cat => {
        const limit = budgets[cat.id] || 0;
        const st    = status.find(s => s.catId === cat.id);
        const pct   = st ? st.pct : 0;
        const isOver = st?.isOver, isWarn = st?.isWarning;
        const barColor = isOver ? 'var(--danger)' : isWarn ? '#f59e0b' : 'var(--primary)';
        return `
          <div style="background:var(--white); border:1.5px solid var(--gray-100); border-radius:12px; padding:12px;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:${limit > 0 ? '8px' : '0'};">
              <span style="font-size:20px;">${cat.emoji}</span>
              <div style="flex:1; font-weight:600; font-size:14px;">${cat.name}</div>
              <input type="number" min="0" step="1000" placeholder="Sin límite"
                value="${limit || ''}"
                style="width:110px; padding:6px 10px; border:1.5px solid var(--gray-200); border-radius:8px; font-size:13px; text-align:right;"
                onchange="DB.setBudget('${cat.id}', this.value); openBudgetManager();"
                inputmode="decimal">
            </div>
            ${limit > 0 && st ? `
              <div style="background:var(--gray-100); border-radius:4px; height:6px; overflow:hidden;">
                <div style="height:100%; width:${pct}%; background:${barColor}; border-radius:4px; transition:width .3s;"></div>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:11px; margin-top:4px; color:var(--gray-500);">
                <span style="color:${isOver ? 'var(--danger)' : isWarn ? '#b45309' : 'var(--gray-500)'};">
                  ${isOver ? '⚠️ Excedido en ' + fmt(Math.abs(st.remaining)) : 'Gastado: ' + fmt(st.usedAmt)}
                </span>
                <span>${pct}% de ${fmt(limit)}</span>
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>

    <div style="background:var(--gray-50); border-radius:10px; padding:12px; font-size:13px; color:var(--gray-600); line-height:1.6;">
      💡 Deja en blanco las categorías sin límite. Los cambios aplican al mes actual inmediatamente.
    </div>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function renderBudgetStatus() {
  const now    = new Date();
  const status = DB.getBudgetStatus(reportYear, reportMonth);
  const card   = document.getElementById('budget-status-card');
  const list   = document.getElementById('budget-status-list');
  if (!card || !list) return;

  if (!status.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  list.innerHTML = status.map(st => {
    const barColor  = st.isOver ? 'var(--danger)' : st.isWarning ? '#f59e0b' : 'var(--primary)';
    const textColor = st.isOver ? 'var(--danger)' : st.isWarning ? '#b45309' : 'var(--gray-500)';
    const icon      = st.isOver ? '🔴' : st.isWarning ? '🟡' : '🟢';
    return `
      <div style="margin-bottom:12px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span>${st.cat ? st.cat.emoji : '📝'}</span>
            <span style="font-size:13px; font-weight:600;">${st.cat ? st.cat.name : 'Sin categoría'}</span>
            <span style="font-size:12px;">${icon}</span>
          </div>
          <span style="font-size:12px; color:${textColor}; font-weight:700;">
            ${fmt(st.usedAmt)} / ${fmt(st.limit)}
          </span>
        </div>
        <div style="background:var(--gray-100); border-radius:6px; height:8px; overflow:hidden;">
          <div style="height:100%; width:${st.pct}%; background:${barColor}; border-radius:6px; transition:width .4s;"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px; margin-top:3px; color:${textColor};">
          <span>${st.isOver ? '⚠️ Excedido en ' + fmt(Math.abs(st.remaining)) : 'Disponible: ' + fmt(Math.max(st.remaining, 0))}</span>
          <span>${st.pct}%</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderBudgetAlerts() {
  const now    = new Date();
  const status = DB.getBudgetStatus(now.getFullYear(), now.getMonth() + 1);
  const el     = document.getElementById('dash-budget-alert');
  if (!el) return;
  const alerts = status.filter(s => s.isOver || s.isWarning);
  if (!alerts.length) { el.style.display = 'none'; return; }

  const overCount = alerts.filter(s => s.isOver).length;
  const warnCount = alerts.filter(s => s.isWarning).length;
  const isRed = overCount > 0;

  el.style.display = 'flex';
  el.style.cssText = `
    display:flex; background:${isRed ? '#fee2e2' : '#fef3c7'};
    border:1.5px solid ${isRed ? '#fca5a5' : '#fcd34d'};
    border-radius:var(--radius); padding:12px 14px; gap:10px;
    align-items:center; margin-bottom:12px;
    color:${isRed ? '#991b1b' : '#92400e'};
  `;
  el.innerHTML = `
    <span style="font-size:20px;">${isRed ? '🔴' : '🟡'}</span>
    <div style="flex:1;">
      <div style="font-weight:700; font-size:14px;">
        ${overCount > 0 ? overCount + ' categoría(s) sobre presupuesto' : ''}
        ${warnCount > 0 ? (overCount > 0 ? ' · ' : '') + warnCount + ' cerca del límite' : ''}
      </div>
      <div style="font-size:12px; opacity:.8; margin-top:2px;">
        ${alerts.slice(0, 2).map(s => (s.cat?.emoji || '📝') + ' ' + (s.cat?.name || 'Sin cat')).join(' · ')}
      </div>
    </div>
    <button onclick="navigate('reports')" style="font-size:12px; font-weight:700; background:none; color:inherit; white-space:nowrap;">Ver →</button>
  `;
}

function renderStockAlerts() {
  const el = document.getElementById('dash-stock-alert');
  if (!el) return;

  const allProds  = DB.getInventory();
  const critical  = allProds.filter(p => (p.minStock || 0) > 0 && p.quantity <= p.minStock);
  const warning   = allProds.filter(p => (p.minStock || 0) > 0 && p.quantity > p.minStock && p.quantity <= p.minStock * 2);

  if (!critical.length && !warning.length) { el.style.display = 'none'; return; }

  const isRed   = critical.length > 0;
  const shown   = isRed ? critical : warning;
  const preview = shown.slice(0, 3)
    .map(p => `${p.emoji || '📦'} ${escHtml(p.name)} (${p.quantity}/${p.minStock})`)
    .join(' · ');

  el.style.cssText = `
    display:flex; background:${isRed ? '#fee2e2' : '#fef3c7'};
    border:1.5px solid ${isRed ? '#fca5a5' : '#fcd34d'};
    border-radius:var(--radius); padding:12px 14px; gap:10px;
    align-items:center; margin-bottom:12px;
    color:${isRed ? '#991b1b' : '#92400e'};
  `;
  el.innerHTML = `
    <span style="font-size:20px;">${isRed ? '🔴' : '🟡'}</span>
    <div style="flex:1;">
      <div style="font-weight:700; font-size:14px;">
        ${critical.length ? critical.length + ' producto(s) con stock bajo' : ''}
        ${warning.length ? (critical.length ? ' · ' : '') + warning.length + ' quedando poco' : ''}
      </div>
      <div style="font-size:12px; opacity:.8; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${preview}${shown.length > 3 ? ` +${shown.length - 3} más` : ''}
      </div>
    </div>
    <button onclick="navigate('inventory')" style="font-size:12px; font-weight:700; background:none; color:inherit; white-space:nowrap; border:none; cursor:pointer;">Ver →</button>
  `;
}

// ── Gráficas (Chart.js) ───────────────────────────────────────────────────────
let _chartEvolution = null;
let _chartDonut     = null;

function renderCharts() {
  if (typeof Chart === 'undefined') {
    // Chart.js no disponible (sin internet), ocultar cards de gráficas
    const ec = document.getElementById('chart-evolution-card');
    const dc = document.getElementById('chart-donut-card');
    if (ec) ec.style.display = 'none';
    if (dc) dc.style.display = 'none';
    return;
  }

  const months = DB.getLast6MonthsStats();

  // ── Barras: Ingresos vs Gastos 6 meses ───────────────────
  const ctx1 = document.getElementById('chart-evolution')?.getContext('2d');
  if (ctx1) {
    if (_chartEvolution) { _chartEvolution.destroy(); _chartEvolution = null; }
    _chartEvolution = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: months.map(m => m.label),
        datasets: [
          {
            label: 'Ingresos',
            data:  months.map(m => m.income),
            backgroundColor: 'rgba(22,163,74,0.80)',
            borderColor:     '#16a34a',
            borderWidth: 1.5,
            borderRadius: 6,
            borderSkipped: false,
          },
          {
            label: 'Gastos',
            data:  months.map(m => m.expenses),
            backgroundColor: 'rgba(220,38,38,0.75)',
            borderColor:     '#dc2626',
            borderWidth: 1.5,
            borderRadius: 6,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 11 }, boxWidth: 14, padding: 12 },
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const s = DB.getSettings();
                return ctx.dataset.label + ': ' + s.currencySymbol + ' ' +
                  Number(ctx.raw).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 } },
          },
          y: {
            grid: { color: '#f3f4f6' },
            ticks: {
              font: { size: 10 },
              callback: val => {
                const s = DB.getSettings();
                if (val >= 1000000) return s.currencySymbol + ' ' + (val / 1000000).toFixed(1) + 'M';
                if (val >= 1000)    return s.currencySymbol + ' ' + (val / 1000).toFixed(0) + 'K';
                return s.currencySymbol + ' ' + val;
              },
            },
          },
        },
      },
    });
  }

  // ── Donut: gastos por categoría del mes seleccionado ─────
  const txs = DB.getTransactionsByMonth(reportYear, reportMonth);
  const catTotals = {};
  txs.filter(t => t.type === 'expense' && !t.isCogs).forEach(t => {
    const k = t.category || '__otros__';
    catTotals[k] = (catTotals[k] || 0) + t.amount;
  });

  const entries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const donutCard = document.getElementById('chart-donut-card');

  if (!entries.length) {
    if (donutCard) donutCard.style.display = 'none';
    if (_chartDonut) { _chartDonut.destroy(); _chartDonut = null; }
  } else {
    if (donutCard) donutCard.style.display = 'block';
    const monthLabel = new Date(reportYear, reportMonth - 1, 1)
      .toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
    const el = document.getElementById('chart-donut-month');
    if (el) el.textContent = monthLabel;

    const donutLabels = entries.map(([id]) => {
      const c = DB.getCategoryById(id);
      return c ? c.emoji + ' ' + c.name : '📝 Otros';
    });
    const donutData   = entries.map(([, v]) => v);
    const donutColors = entries.map(([id]) => {
      const c = DB.getCategoryById(id);
      return c?.color || '#6b7280';
    });

    const ctx2 = document.getElementById('chart-donut')?.getContext('2d');
    if (ctx2) {
      if (_chartDonut) { _chartDonut.destroy(); _chartDonut = null; }
      _chartDonut = new Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: donutLabels,
          datasets: [{
            data:            donutData,
            backgroundColor: donutColors,
            borderWidth:     2,
            borderColor:     '#ffffff',
            hoverOffset:     10,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { font: { size: 10 }, boxWidth: 12, padding: 8 },
            },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const s     = DB.getSettings();
                  const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                  const pct   = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                  return ctx.label + ': ' + s.currencySymbol + ' ' +
                    Number(ctx.raw).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) +
                    ' (' + pct + '%)';
                },
              },
            },
          },
        },
      });
    }
  }
}

// ── Activos Fijos (NIIF PYMES — Depreciación Línea Recta) ────────────────────
// Equipos, vehículos, maquinaria, inmuebles con depreciación mensual automática.

function renderAssets() {
  const assets  = DB.getFixedAssets();
  const totals  = DB.getFixedAssetsTotals();

  // Hero resumen (fmt ya incluye el símbolo de moneda)
  const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  setEl('assets-total-cost',  fmt(totals.totalCost));
  setEl('assets-book-value',  fmt(totals.totalBookValue));
  setEl('assets-accum-dep',   fmt(totals.totalAccumDep));
  setEl('assets-count',       totals.count);

  // Depreciación mensual total
  let totalMonthlyDep = 0;
  assets.forEach(a => { totalMonthlyDep += DB.calcAssetDepreciation(a).monthlyDep; });
  setEl('assets-monthly-dep', fmt(totalMonthlyDep));

  // Lista de activos
  const listEl = document.getElementById('assets-list');
  if (!listEl) return;

  if (assets.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:var(--gray-400);">
        <div style="font-size:48px; margin-bottom:12px;">🏭</div>
        <div style="font-size:16px; font-weight:700; margin-bottom:6px;">Sin activos fijos</div>
        <div style="font-size:13px; line-height:1.5;">Registra equipos, vehículos, maquinaria<br>y la app calculará la depreciación automáticamente.</div>
        <button class="btn btn-primary" style="margin-top:16px;" onclick="openAssetForm()">+ Registrar primer activo</button>
      </div>`;
    return;
  }

  const cats = DB.getAssetCategories();
  const catMap = {};
  cats.forEach(c => { catMap[c.id] = c; });

  listEl.innerHTML = assets.map(a => {
    const dep  = DB.calcAssetDepreciation(a);
    const cat  = catMap[a.categoryId] || { emoji: '📦', name: a.categoryId || 'Otro' };
    const pct  = Math.round(dep.pctDepreciated);
    const barW = Math.min(100, pct);
    const barColor = pct >= 90 ? '#dc2626' : pct >= 60 ? '#f59e0b' : '#4338ca';
    const statusLabel = dep.isFullyDepreciated
      ? '<span style="color:#dc2626;font-size:11px;font-weight:700;">TOTALMENTE DEPRECIADO</span>'
      : `<span style="font-size:11px;color:var(--gray-400);">${dep.remainingMonths} mes${dep.remainingMonths === 1 ? '' : 'es'} restante${dep.remainingMonths === 1 ? '' : 's'}</span>`;

    return `
    <div class="card" style="margin-bottom:10px; cursor:pointer;" onclick="openAssetDetail('${a.id}')">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="font-size:32px; flex-shrink:0;">${cat.emoji}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.name}</div>
          <div style="font-size:12px; color:var(--gray-400); margin-top:1px;">${cat.name} · Comprado ${fmtDate(a.purchaseDate)}</div>
          <!-- Barra de progreso depreciación -->
          <div style="margin-top:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
              <span style="font-size:11px; color:var(--gray-500);">Depreciación: ${pct}%</span>
              ${statusLabel}
            </div>
            <div style="background:var(--gray-100); border-radius:99px; height:5px; overflow:hidden;">
              <div style="width:${barW}%; background:${barColor}; height:100%; border-radius:99px; transition:width .4s;"></div>
            </div>
          </div>
        </div>
        <div style="text-align:right; flex-shrink:0;">
          <div style="font-size:15px; font-weight:800; color:#4338ca;">${fmt(dep.bookValue)}</div>
          <div style="font-size:11px; color:var(--gray-400); margin-top:2px;">en libros</div>
          <div style="font-size:11px; color:var(--gray-500); margin-top:4px;">−${fmt(dep.monthlyDep)}/mes</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openAssetDetail(id) {
  const a    = DB.getFixedAssets().find(x => x.id === id);
  if (!a) return;
  const dep  = DB.calcAssetDepreciation(a);
  const cats = DB.getAssetCategories();
  const cat  = cats.find(c => c.id === a.categoryId) || { emoji: '📦', name: 'Otro' };
  const pct  = Math.round(dep.pctDepreciated);

  const row = (label, val, valColor = 'var(--gray-700)') => `
    <div style="display:flex; justify-content:space-between; align-items:center;
      padding:9px 0; border-bottom:1px solid var(--gray-100);">
      <span style="font-size:13px; color:var(--gray-500);">${label}</span>
      <span style="font-size:14px; font-weight:700; color:${valColor};">${val}</span>
    </div>`;

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>

    <div style="text-align:center; padding:8px 0 16px;">
      <div style="font-size:48px; margin-bottom:8px;">${cat.emoji}</div>
      <div style="font-size:18px; font-weight:800;">${a.name}</div>
      <div style="font-size:12px; color:var(--gray-400); margin-top:2px;">${cat.name}</div>
    </div>

    <!-- Barra depreciación -->
    <div style="background:var(--gray-50); border-radius:12px; padding:14px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <span style="font-size:12px; font-weight:700; color:var(--gray-600);">Progreso de Depreciación</span>
        <span style="font-size:12px; font-weight:800; color:#4338ca;">${pct}%</span>
      </div>
      <div style="background:var(--gray-200); border-radius:99px; height:10px; overflow:hidden;">
        <div style="width:${Math.min(100,pct)}%; background:${pct>=90?'#dc2626':pct>=60?'#f59e0b':'#4338ca'}; height:100%; border-radius:99px;"></div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px;">
        <div style="text-align:center;">
          <div style="font-size:11px; color:var(--gray-400); margin-bottom:2px;">Valor en Libros</div>
          <div style="font-size:18px; font-weight:800; color:#4338ca;">${fmt(dep.bookValue)}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:11px; color:var(--gray-400); margin-bottom:2px;">Dep. Acumulada</div>
          <div style="font-size:18px; font-weight:800; color:var(--danger);">${fmt(dep.accumulatedDep)}</div>
        </div>
      </div>
    </div>

    <!-- Detalle contable -->
    ${row('Costo de adquisición', fmt(a.purchaseCost), '#4338ca')}
    ${row('Valor residual', fmt(a.residualValue || 0), 'var(--gray-700)')}
    ${row('Depreciación anual', fmt(dep.annualDep), 'var(--danger)')}
    ${row('Depreciación mensual', fmt(dep.monthlyDep), 'var(--danger)')}
    ${row('Vida útil', a.usefulLifeYears + ' año' + (a.usefulLifeYears === 1 ? '' : 's'), 'var(--gray-700)')}
    ${row('Fecha de compra', fmtDate(a.purchaseDate), 'var(--gray-700)')}
    ${row('Meses en uso', dep.monthsElapsed + ' mes' + (dep.monthsElapsed === 1 ? '' : 'es'), 'var(--gray-700)')}
    ${dep.isFullyDepreciated
      ? `<div style="background:#fee2e2; border-radius:10px; padding:10px 14px; margin-top:10px; text-align:center; font-size:13px; color:#dc2626; font-weight:700;">⚠️ Activo totalmente depreciado</div>`
      : row('Meses restantes', dep.remainingMonths + ' mes' + (dep.remainingMonths === 1 ? '' : 'es'), '#16a34a')
    }
    ${a.notes ? `<div style="font-size:13px; color:var(--gray-500); padding:10px 0 4px;">📝 ${a.notes}</div>` : ''}

    <!-- Acciones -->
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:18px;">
      <button class="btn btn-outline" onclick="closeSettingsSheet(); openAssetForm('${a.id}')">✏️ Editar</button>
      <button class="btn btn-danger"  onclick="confirmDeleteAsset('${a.id}')">🗑️ Eliminar</button>
    </div>
  `;

  document.getElementById('settings-sheet').classList.add('open');
}

function openAssetForm(editId = null) {
  const a    = editId ? DB.getFixedAssets().find(x => x.id === editId) : null;
  const s    = DB.getSettings();
  const sym  = s.currencySymbol || '$';
  const cats = DB.getAssetCategories();
  const accs = DB.getAccounts();

  const val = (field, def = '') => a ? (a[field] ?? def) : def;
  const esc = str => (str || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));

  const catsOpts = cats.map(c =>
    `<option value="${c.id}" data-years="${c.years}" ${val('categoryId') === c.id ? 'selected' : ''}>${c.emoji} ${c.name} (${c.years} años)</option>`
  ).join('');

  const accsOpts = accs.map(ac =>
    `<option value="${ac.id}" ${val('accountId', 'a-banco') === ac.id ? 'selected' : ''}>${ac.emoji} ${ac.name}</option>`
  ).join('');

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <div style="font-size:17px; font-weight:800; margin-bottom:18px; padding-top:4px;">
      ${a ? '✏️ Editar activo fijo' : '🏭 Registrar activo fijo'}
    </div>

    <div class="form-group">
      <label class="form-label">Nombre del activo *</label>
      <input type="text" id="asset-name" class="form-control" placeholder="Ej: Computadora Dell, Toyota Hilux 2022"
        value="${esc(val('name'))}" oninput="updateAssetYears()">
    </div>

    <div class="form-group">
      <label class="form-label">Categoría *</label>
      <select id="asset-category" class="form-control" onchange="updateAssetYears()">
        ${catsOpts}
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">Fecha de compra *</label>
      <input type="date" id="asset-date" class="form-control" value="${val('purchaseDate', new Date().toISOString().slice(0,10))}">
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <div class="form-group">
        <label class="form-label">Costo de compra (${sym}) *</label>
        <input type="number" id="asset-cost" class="form-control" placeholder="0.00"
          min="0" step="any" value="${val('purchaseCost', '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Valor residual (${sym})</label>
        <input type="number" id="asset-residual" class="form-control" placeholder="0.00"
          min="0" step="any" value="${val('residualValue', '0')}">
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Vida útil (años) *
        <span style="font-size:11px; color:var(--gray-400); font-weight:400;"> — NIIF PYMES Ecuador</span>
      </label>
      <input type="number" id="asset-years" class="form-control" placeholder="5"
        min="1" max="50" step="1" value="${val('usefulLifeYears', '')}">
      <div id="asset-dep-preview" style="font-size:12px; color:var(--gray-400); margin-top:4px;"></div>
    </div>

    <div class="form-group">
      <label class="form-label">Cuenta usada para la compra</label>
      <select id="asset-account" class="form-control">
        ${accsOpts}
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">Notas (opcional)</label>
      <input type="text" id="asset-notes" class="form-control" placeholder="Modelo, serie, descripción..."
        value="${esc(val('notes'))}">
    </div>

    <button class="btn btn-primary btn-block mt-8" onclick="saveAsset(${a ? `'${a.id}'` : 'null'})">
      💾 ${a ? 'Guardar cambios' : 'Registrar activo'}
    </button>
    ${a ? `<button class="btn btn-danger btn-block mt-8" onclick="confirmDeleteAsset('${a.id}')">🗑️ Eliminar activo</button>` : ''}
    <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet()">Cancelar</button>
  `;

  document.getElementById('settings-sheet').classList.add('open');

  // Pre-llenar años según categoría seleccionada si es nuevo
  if (!a) updateAssetYears();
  // Preview depreciación al cambiar costo/años
  ['asset-cost', 'asset-years', 'asset-residual'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateAssetDepPreview);
  });
  updateAssetDepPreview();
}

function updateAssetYears() {
  const sel     = document.getElementById('asset-category');
  const yearsEl = document.getElementById('asset-years');
  if (!sel || !yearsEl) return;
  const opt = sel.options[sel.selectedIndex];
  // Auto-llenar años según categoría (NIIF Ecuador)
  if (opt) yearsEl.value = opt.dataset.years || '5';
  updateAssetDepPreview();
}

function updateAssetDepPreview() {
  const previewEl = document.getElementById('asset-dep-preview');
  if (!previewEl) return;
  const cost   = parseFloat(document.getElementById('asset-cost')?.value)   || 0;
  const resid  = parseFloat(document.getElementById('asset-residual')?.value) || 0;
  const years  = parseFloat(document.getElementById('asset-years')?.value)  || 0;

  if (cost > 0 && years > 0) {
    const annual  = (cost - resid) / years;
    const monthly = annual / 12;
    // fmt() ya incluye el símbolo de moneda
    previewEl.textContent = `Depreciación: ${fmt(monthly)}/mes · ${fmt(annual)}/año`;
  } else {
    previewEl.textContent = '';
  }
}

function saveAsset(editId) {
  const name   = (document.getElementById('asset-name')?.value || '').trim();
  const catId  = document.getElementById('asset-category')?.value;
  const date   = document.getElementById('asset-date')?.value;
  const cost   = parseFloat(document.getElementById('asset-cost')?.value);
  const resid  = parseFloat(document.getElementById('asset-residual')?.value) || 0;
  const years  = parseInt(document.getElementById('asset-years')?.value);
  const accId  = document.getElementById('asset-account')?.value;
  const notes  = (document.getElementById('asset-notes')?.value || '').trim();

  if (!name)               { showToast('⚠️ Ingresa el nombre del activo'); return; }
  if (!date)               { showToast('⚠️ Selecciona la fecha de compra'); return; }
  if (!cost || cost <= 0)  { showToast('⚠️ El costo debe ser mayor a 0'); return; }
  if (!years || years < 1) { showToast('⚠️ La vida útil debe ser al menos 1 año'); return; }
  if (resid >= cost)       { showToast('⚠️ El valor residual no puede ser mayor al costo'); return; }

  DB.saveFixedAsset({
    id:              editId || undefined,
    name,
    categoryId:      catId,
    purchaseDate:    date,
    purchaseCost:    cost,
    residualValue:   resid,
    usefulLifeYears: years,
    accountId:       accId,
    notes,
  });

  closeSettingsSheet();
  renderAssets();
  showToast(editId ? '✅ Activo actualizado' : '✅ Activo registrado');
  // Actualizar chip del dashboard si está visible
  const chip = document.getElementById('dash-assets-chip-val');
  if (chip) {
    const at = DB.getFixedAssetsTotals();
    chip.textContent = at.count > 0 ? at.count + (at.count === 1 ? ' activo' : ' activos') : '+ Añadir';
  }
  // Si el Balance General está abierto, re-renderizarlo
  if (balanceSheetOpen) renderBalanceSheet();
}

function confirmDeleteAsset(id) {
  const a = DB.getFixedAssets().find(x => x.id === id);
  if (!a) return;
  closeSettingsSheet();
  setTimeout(() => {
    if (confirm(`¿Eliminar el activo "${a.name}"? Esta acción no se puede deshacer.`)) {
      DB.deleteFixedAsset(id);
      renderAssets();
      showToast('🗑️ Activo eliminado');
      if (balanceSheetOpen) renderBalanceSheet();
    }
  }, 200);
}

// ── Cartera de Clientes (Cuentas por Cobrar) ──────────────────────────────────
// Ecuador · NIIF PYMES · SRI · cartera vencida · cobros parciales

let carteraFilter = 'all';

const CARTERA_STATUS = {
  pending: { label: '⏳ Pendiente',  color: '#f59e0b', bg: '#fef3c7' },
  partial: { label: '🔵 Cobro parcial', color: '#0891b2', bg: '#e0f2fe' },
  overdue: { label: '🔴 Vencida',    color: '#dc2626', bg: '#fee2e2' },
  paid:    { label: '✅ Cobrada',    color: '#16a34a', bg: '#f0fdf4' },
};

function setCarteraFilter(f) {
  carteraFilter = f;
  document.querySelectorAll('[data-cf]').forEach(c =>
    c.classList.toggle('active', c.dataset.cf === f)
  );
  renderCarteraList();
}

function renderCartera() {
  const stats = DB.getReceivableStats();
  const s     = DB.getSettings();

  // Hero KPIs
  document.getElementById('cartera-total').textContent      = fmt(stats.totalCartera);
  document.getElementById('cartera-pendiente').textContent  = fmt(stats.totalPendiente);
  document.getElementById('cartera-cobrado').textContent    = fmt(stats.totalCobrado);
  document.getElementById('cartera-vencida-count').textContent = stats.overdueCount + ' doc' + (stats.overdueCount !== 1 ? 's' : '');
  document.getElementById('cartera-total-count').textContent   = stats.total;

  // Aging card
  const agingCard = document.getElementById('cartera-aging-card');
  const { d30, d60, d90, d90plus } = stats.aging;
  const totalVencida = d30 + d60 + d90 + d90plus;
  if (totalVencida > 0 && agingCard) {
    agingCard.style.display = 'block';
    document.getElementById('cartera-aging-list').innerHTML = `
      ${d30     > 0 ? agingRow('1–30 días',   fmt(d30),     '#f59e0b') : ''}
      ${d60     > 0 ? agingRow('31–60 días',  fmt(d60),     '#ea580c') : ''}
      ${d90     > 0 ? agingRow('61–90 días',  fmt(d90),     '#dc2626') : ''}
      ${d90plus > 0 ? agingRow('+90 días',    fmt(d90plus), '#7f1d1d') : ''}
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1.5px solid var(--gray-200);margin-top:4px;font-weight:700;font-size:14px;">
        <span>Total cartera vencida</span>
        <span style="color:var(--danger);">${fmt(totalVencida)}</span>
      </div>
    `;
  } else if (agingCard) {
    agingCard.style.display = 'none';
  }

  renderCarteraList();
}

function agingRow(label, val, color) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--gray-100);">
    <span style="font-size:13px;color:var(--gray-700);">${label}</span>
    <span style="font-size:14px;font-weight:700;color:${color};">${val}</span>
  </div>`;
}

function renderCarteraList() {
  const all = DB.getReceivables()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const filtered = carteraFilter === 'all' ? all : all.filter(r => r.status === carteraFilter);

  const container = document.getElementById('cartera-list');
  if (!container) return;

  if (!filtered.length) {
    container.innerHTML = emptyHTML('🧾', 'Sin registros',
      carteraFilter === 'all'
        ? 'Toca + para registrar una venta a crédito'
        : 'No hay documentos en este estado');
    return;
  }

  container.innerHTML = filtered.map(rec => {
    const paid    = (rec.payments || []).reduce((s, p) => s + p.amount, 0);
    const pending = Math.max(rec.totalAmount - paid, 0);
    const pct     = rec.totalAmount > 0 ? Math.min(Math.round((paid / rec.totalAmount) * 100), 100) : 0;
    const st      = CARTERA_STATUS[rec.status] || CARTERA_STATUS.pending;
    const due     = rec.dueDate ? new Date(rec.dueDate + 'T12:00:00') : null;
    const today   = new Date();
    const daysLeft = due ? Math.ceil((due - today) / 86400000) : null;

    let dueLabel = '';
    if (rec.status !== 'paid' && due) {
      if (daysLeft < 0)     dueLabel = `<span style="color:var(--danger);font-size:11px;">⚠️ Vencida hace ${Math.abs(daysLeft)} días</span>`;
      else if (daysLeft === 0) dueLabel = `<span style="color:var(--warning);font-size:11px;">⚠️ Vence hoy</span>`;
      else if (daysLeft <= 7)  dueLabel = `<span style="color:#b45309;font-size:11px;">Vence en ${daysLeft} días</span>`;
      else                     dueLabel = `<span style="color:var(--gray-400);font-size:11px;">Vence ${fmtDate(rec.dueDate)}</span>`;
    }

    return `
      <div class="card" style="margin-bottom:10px;padding:14px;cursor:pointer;border-left:4px solid ${st.color};"
           onclick="openReceivableDetail('${rec.id}')">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <div style="font-size:28px;">🧾</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
              <div style="font-size:15px;font-weight:700;color:var(--gray-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${rec.clientName}</div>
              <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:${st.bg};color:${st.color};white-space:nowrap;">${st.label}</span>
            </div>
            <div style="font-size:12px;color:var(--gray-500);margin-bottom:4px;">${rec.description || 'Sin descripción'}</div>
            ${rec.ruc ? `<div style="font-size:11px;color:var(--gray-400);">RUC/CI: ${rec.ruc}</div>` : ''}
            ${dueLabel}
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:17px;font-weight:800;color:var(--gray-900);">${fmt(rec.totalAmount)}</div>
            ${rec.status !== 'paid' ? `<div style="font-size:12px;color:var(--danger);font-weight:600;">Por cobrar: ${fmt(pending)}</div>` : `<div style="font-size:12px;color:var(--success);">Cobrado ✅</div>`}
          </div>
        </div>
        ${rec.status !== 'paid' && rec.status !== 'pending' ? `
        <div style="margin-top:10px;">
          <div style="background:var(--gray-100);border-radius:6px;height:6px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${st.color};border-radius:6px;"></div>
          </div>
          <div style="font-size:11px;color:var(--gray-400);margin-top:3px;text-align:right;">${pct}% cobrado</div>
        </div>` : ''}
      </div>
    `;
  }).join('');
}

function openReceivableForm(editId = null) {
  const rec  = editId ? DB.getReceivableById(editId) : null;
  const sheet = document.getElementById('settings-sheet');

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">${rec ? '✏️ Editar Venta a Crédito' : '🧾 Nueva Venta a Crédito'}</h3>

    <div style="background:#e0f2fe;border-radius:10px;padding:12px;margin-bottom:16px;font-size:13px;color:#0c4a6e;line-height:1.6;">
      💡 Registra ventas a crédito (plazo de cobro). La cartera vencida se calcula automáticamente según la fecha de vencimiento.
    </div>

    <div class="form-group">
      <label class="form-label">Cliente *</label>
      <input type="text" class="form-control" id="cxc-client"
        value="${rec?.clientName || ''}" placeholder="Nombre o razón social del cliente">
    </div>
    <div class="form-group">
      <label class="form-label">RUC / Cédula (opcional)</label>
      <input type="text" class="form-control" id="cxc-ruc"
        value="${rec?.ruc || ''}" placeholder="Ej: 1712345678001" maxlength="13" inputmode="numeric">
    </div>
    <div class="form-group">
      <label class="form-label">Descripción de la venta *</label>
      <input type="text" class="form-control" id="cxc-desc"
        value="${rec?.description || ''}" placeholder="Ej: Venta mercadería mayo, Servicio consultoría">
    </div>
    <div class="form-group">
      <label class="form-label">Monto total *</label>
      <input type="number" class="form-control" id="cxc-amount"
        value="${rec?.totalAmount || ''}" placeholder="0.00" min="0" step="0.01" inputmode="decimal">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">Fecha de venta *</label>
        <input type="date" class="form-control" id="cxc-issue" value="${rec?.issueDate || today()}">
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">Fecha de vencimiento *</label>
        <input type="date" class="form-control" id="cxc-due" value="${rec?.dueDate || ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Notas (opcional)</label>
      <textarea class="form-control" id="cxc-notes" rows="2"
        placeholder="# factura, acuerdo de pago, cuotas...">${rec?.notes || ''}</textarea>
    </div>

    <button class="btn btn-primary btn-block mt-8" onclick="saveReceivable('${editId || ''}')">
      ✅ ${rec ? 'Actualizar' : 'Registrar venta a crédito'}
    </button>
    ${rec ? `<button class="btn btn-danger btn-block mt-8" onclick="confirmDeleteReceivable('${rec.id}')">🗑️ Eliminar</button>` : ''}
    <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet()">Cancelar</button>
  `;
  sheet.classList.add('open');
}

function saveReceivable(editId) {
  const clientName  = document.getElementById('cxc-client')?.value.trim();
  const description = document.getElementById('cxc-desc')?.value.trim();
  const totalAmount = parseFloat(document.getElementById('cxc-amount')?.value);
  const issueDate   = document.getElementById('cxc-issue')?.value;
  const dueDate     = document.getElementById('cxc-due')?.value;

  if (!clientName)         { showToast('⚠️ Escribe el nombre del cliente'); return; }
  if (!description)        { showToast('⚠️ Escribe la descripción'); return; }
  if (!totalAmount || totalAmount <= 0) { showToast('⚠️ Ingresa un monto válido'); return; }
  if (!issueDate)          { showToast('⚠️ Selecciona la fecha de la venta'); return; }
  if (!dueDate)            { showToast('⚠️ Selecciona la fecha de vencimiento'); return; }

  const data = {
    clientName, description, totalAmount, issueDate, dueDate,
    ruc:   document.getElementById('cxc-ruc')?.value.trim() || '',
    notes: document.getElementById('cxc-notes')?.value.trim() || '',
  };

  if (editId) {
    DB.updateReceivable(editId, data);
    showToast('✅ Venta a crédito actualizada');
  } else {
    DB.addReceivable(data);
    showToast('✅ Venta a crédito registrada');
  }
  closeSettingsSheet();
  renderCartera();
}

function confirmDeleteReceivable(id) {
  if (!isCurrentUserOwner()) {
    showToast('🚫 Solo el propietario puede eliminar cuentas por cobrar', 2500); return;
  }
  const rec = DB.getReceivableById(id);
  if (!rec) return;
  if (!confirm(`¿Eliminar la cuenta por cobrar de "${rec.clientName}"?\n\nEsta acción no se puede deshacer.`)) return;
  DB.deleteReceivable(id);
  closeSettingsSheet();
  renderCartera();
  showToast('🗑️ Eliminado');
}

function openReceivableDetail(id) {
  const rec = DB.getReceivableById(id);
  if (!rec) return;

  const paid    = (rec.payments || []).reduce((s, p) => s + p.amount, 0);
  const pending = Math.max(rec.totalAmount - paid, 0);
  const pct     = rec.totalAmount > 0 ? Math.min(Math.round((paid / rec.totalAmount) * 100), 100) : 0;
  const st      = CARTERA_STATUS[rec.status] || CARTERA_STATUS.pending;

  const paymentsHTML = rec.payments?.length
    ? rec.payments.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--gray-100);">
          <div>
            <div style="font-size:13px;font-weight:600;">${fmtDate(p.date)}</div>
            ${p.notes ? `<div style="font-size:11px;color:var(--gray-400);">${p.notes}</div>` : ''}
          </div>
          <div style="font-size:15px;font-weight:700;color:var(--success);">+${fmt(p.amount)}</div>
        </div>`).join('')
    : '<p style="color:var(--gray-400);font-size:13px;text-align:center;padding:12px 0;">Sin cobros registrados</p>';

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>

    <!-- Encabezado cliente -->
    <div style="text-align:center;padding:8px 0 16px;">
      <div style="font-size:48px;margin-bottom:8px;">🧾</div>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${st.bg};color:${st.color};">${st.label}</span>
      <div style="font-size:20px;font-weight:800;margin-top:10px;">${rec.clientName}</div>
      ${rec.ruc ? `<div style="font-size:12px;color:var(--gray-400);">RUC/CI: ${rec.ruc}</div>` : ''}
      <div style="font-size:13px;color:var(--gray-500);margin-top:4px;">${rec.description}</div>
    </div>

    <!-- Montos -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
      <div style="background:var(--gray-50);border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:10px;color:var(--gray-500);font-weight:600;margin-bottom:2px;">TOTAL</div>
        <div style="font-size:15px;font-weight:800;">${fmt(rec.totalAmount)}</div>
      </div>
      <div style="background:#f0fdf4;border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:10px;color:var(--gray-500);font-weight:600;margin-bottom:2px;">COBRADO</div>
        <div style="font-size:15px;font-weight:800;color:var(--success);">${fmt(paid)}</div>
      </div>
      <div style="background:${pending > 0 ? '#fff1f2' : '#f0fdf4'};border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:10px;color:var(--gray-500);font-weight:600;margin-bottom:2px;">PENDIENTE</div>
        <div style="font-size:15px;font-weight:800;color:${pending > 0 ? 'var(--danger)' : 'var(--success)'};">${fmt(pending)}</div>
      </div>
    </div>

    <!-- Barra de progreso -->
    ${rec.status !== 'pending' ? `
    <div style="margin-bottom:16px;">
      <div style="background:var(--gray-100);border-radius:8px;height:10px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${st.color};border-radius:8px;transition:width .4s;"></div>
      </div>
      <div style="font-size:11px;color:var(--gray-400);margin-top:4px;text-align:right;">${pct}% cobrado</div>
    </div>` : ''}

    <!-- Fechas -->
    <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--gray-600);margin-bottom:16px;background:var(--gray-50);border-radius:10px;padding:10px 14px;">
      <div><div style="font-size:10px;font-weight:600;color:var(--gray-400);">FECHA VENTA</div><div style="font-weight:600;">${fmtDate(rec.issueDate)}</div></div>
      <div style="text-align:right;"><div style="font-size:10px;font-weight:600;color:var(--gray-400);">VENCIMIENTO</div><div style="font-weight:600;color:${rec.status === 'overdue' ? 'var(--danger)' : 'inherit'};">${rec.dueDate ? fmtDate(rec.dueDate) : '—'}</div></div>
    </div>

    ${rec.notes ? `<div style="background:var(--gray-50);border-radius:10px;padding:12px;margin-bottom:16px;font-size:13px;color:var(--gray-700);">📝 ${rec.notes}</div>` : ''}

    <!-- Historial de cobros -->
    <div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Historial de cobros</div>
    <div style="margin-bottom:16px;">${paymentsHTML}</div>

    <!-- Botones -->
    ${rec.status !== 'paid' ? `
    <button class="btn btn-primary btn-block mb-8" onclick="openRegisterPayment('${rec.id}')">
      💰 Registrar cobro
    </button>` : ''}
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" style="flex:1;" onclick="openReceivableForm('${rec.id}')">✏️ Editar</button>
      <button class="btn btn-secondary" style="flex:1;" onclick="closeSettingsSheet()">Cerrar</button>
    </div>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function openRegisterPayment(receivableId) {
  const rec = DB.getReceivableById(receivableId);
  if (!rec) return;
  const paid    = (rec.payments || []).reduce((s, p) => s + p.amount, 0);
  const pending = Math.max(rec.totalAmount - paid, 0);

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">💰 Registrar Cobro</h3>
    <div style="background:#f0fdf4;border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="font-size:12px;color:var(--gray-500);">Cliente: <strong>${rec.clientName}</strong></div>
      <div style="font-size:12px;color:var(--gray-500);">Saldo pendiente: <strong style="color:var(--danger);">${fmt(pending)}</strong></div>
    </div>
    <div class="form-group">
      <label class="form-label">Monto cobrado *</label>
      <input type="number" class="form-control" id="pay-amount"
        value="${pending}" placeholder="0.00" min="0.01" step="0.01" max="${pending}" inputmode="decimal">
    </div>
    <div class="form-group">
      <label class="form-label">Fecha de cobro *</label>
      <input type="date" class="form-control" id="pay-date" value="${today()}">
    </div>
    <div class="form-group">
      <label class="form-label">Notas (opcional)</label>
      <input type="text" class="form-control" id="pay-notes"
        placeholder="Ej: Transferencia banco, efectivo, cuota #1">
    </div>
    <button class="btn btn-primary btn-block mt-8" onclick="saveReceivablePayment('${receivableId}')">
      ✅ Confirmar cobro
    </button>
    <button class="btn btn-secondary btn-block mt-8" onclick="openReceivableDetail('${receivableId}')">
      ← Volver
    </button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function saveReceivablePayment(receivableId) {
  const amount = parseFloat(document.getElementById('pay-amount')?.value);
  const date   = document.getElementById('pay-date')?.value;

  if (!amount || amount <= 0) { showToast('⚠️ Ingresa un monto válido'); return; }
  if (!date)                  { showToast('⚠️ Selecciona la fecha'); return; }

  const rec = DB.addReceivablePayment(receivableId, {
    amount,
    date,
    notes: document.getElementById('pay-notes')?.value.trim() || '',
  });

  if (rec.status === 'paid') {
    showToast('🎉 ¡Cobro completo! Cartera cerrada.');
  } else {
    const paid    = (rec.payments || []).reduce((s, p) => s + p.amount, 0);
    const pending = Math.max(rec.totalAmount - paid, 0);
    showToast(`✅ Cobro registrado · Pendiente: ${fmt(pending)}`);
  }

  closeSettingsSheet();
  renderCartera();
}

// Alerta cartera vencida en dashboard
// Panel de Cuentas por Cobrar — se abre desde la insignia de cartera del tablero
function openCarteraPanel() {
  const sym = DB.getSettings().currencySymbol || '$';
  const hoy = new Date().toISOString().slice(0, 10);
  const list = DB.getReceivables().map(r => {
    const paid = (r.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    return { ...r, _pend: Math.max((r.totalAmount || 0) - paid, 0) };
  }).filter(r => r._pend > 0.005)
    .sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99'));

  const total    = list.reduce((s, r) => s + r._pend, 0);
  const vencidas = list.filter(r => r.dueDate && r.dueDate < hoy);
  const ESTADO   = {
    overdue: { txt: '🔴 Vencida',        col: '#dc2626' },
    partial: { txt: '🔵 Abono parcial',  col: '#0891b2' },
    pending: { txt: '⏳ Pendiente',      col: '#d97706' },
  };

  const rows = list.map(r => {
    const venc = r.dueDate && r.dueDate < hoy;
    const est  = venc ? ESTADO.overdue : (ESTADO[r.status] || ESTADO.pending);
    const fechas = [];
    if (r.issueDate) fechas.push('Emitida: ' + fmtDate(r.issueDate));
    if (r.dueDate)   fechas.push('Vence: ' + fmtDate(r.dueDate));
    return `
      <div onclick="closeSettingsSheet(); setTimeout(()=>navigate('cartera'),220);"
        style="background:var(--white); border:1.5px solid var(--gray-100); border-radius:12px;
          padding:12px 14px; margin-bottom:8px; cursor:pointer; display:flex;
          justify-content:space-between; align-items:flex-start; gap:10px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:14px; font-weight:800;">🧾 ${_xmlEsc(r.clientName || 'Cliente')}</div>
          ${r.description ? `<div style="font-size:11px; color:var(--gray-500); margin-top:1px;">${_xmlEsc(r.description)}</div>` : ''}
          ${fechas.length ? `<div style="font-size:11px; color:var(--gray-400); margin-top:2px;">${fechas.join(' · ')}</div>` : ''}
          <div style="font-size:11px; font-weight:700; color:${est.col}; margin-top:2px;">${est.txt}</div>
        </div>
        <div style="font-size:16px; font-weight:900; color:#0891b2; white-space:nowrap;">${sym} ${fmt(r._pend)}</div>
      </div>`;
  }).join('');

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">🧾 Cuentas por Cobrar</h3>
    ${list.length === 0 ? `
      <div style="text-align:center; padding:36px 0; color:var(--gray-400);">
        <div style="font-size:44px; margin-bottom:10px;">✅</div>
        <div style="font-weight:700;">No tienes cobros pendientes</div>
      </div>
    ` : `
      <div style="background:linear-gradient(135deg,#0891b2,#0e7490); border-radius:14px;
        padding:16px; color:#fff; margin-bottom:14px; text-align:center;">
        <div style="font-size:12px; opacity:.85;">Total por cobrar</div>
        <div style="font-size:28px; font-weight:900; margin-top:2px;">${sym} ${fmt(total)}</div>
        <div style="font-size:11px; opacity:.85; margin-top:4px;">
          ${list.length} cuenta${list.length !== 1 ? 's' : ''} por cobrar${vencidas.length ? ` · ${vencidas.length} vencida${vencidas.length !== 1 ? 's' : ''}` : ''}
        </div>
      </div>
      ${rows}
      <button class="btn btn-outline btn-block mt-8" onclick="closeSettingsSheet(); navigate('cartera');">
        Ver cartera completa
      </button>
    `}
    <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

// ── Escáner de código de barras (BarcodeDetector API — nativo Chrome) ─────────
// 100% offline, sin IA, sin servidor externo. Solo cámara del dispositivo.
async function openBarcodeScanner(targetFieldId) {
  if (!('BarcodeDetector' in window)) {
    showToast('📷 Escáner disponible en Chrome Android actualizado', 4000);
    return;
  }

  const sheet = document.getElementById('settings-sheet');
  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title" style="text-align:center;">📷 Escanear Código</h3>
    <div style="position:relative; background:#000; border-radius:14px; overflow:hidden; margin-bottom:14px;">
      <video id="barcode-video" autoplay playsinline muted
        style="width:100%; max-height:260px; object-fit:cover; display:block;"></video>
      <!-- Marco de guía -->
      <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none;">
        <div style="width:75%; height:120px; border:3px solid #38bdf8; border-radius:10px; box-shadow:0 0 0 2000px rgba(0,0,0,.4);"></div>
      </div>
      <div id="scan-hint" style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,.7); color:white; padding:10px; text-align:center; font-size:13px;">
        📦 Apunta al código de barras o QR...
      </div>
    </div>
    <p style="font-size:12px; color:var(--gray-500); text-align:center; margin-bottom:14px;">
      Soporta EAN-13, EAN-8, Code 128, QR y más. Sin internet — funciona en tu dispositivo.
    </p>
    <button class="btn btn-secondary btn-block" onclick="stopBarcodeScanner()">✕ Cancelar</button>
  `;
  sheet.classList.add('open');
  window._barcodeScanActive = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    const video = document.getElementById('barcode-video');
    if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream;
    window._barcodeStream = stream;
    await video.play();

    const formats = ['ean_13','ean_8','code_128','code_39','qr_code','upc_a','upc_e','itf','codabar'];
    const detector = new BarcodeDetector({ formats });

    const scan = async () => {
      if (!window._barcodeScanActive) return;
      const vid = document.getElementById('barcode-video');
      if (!vid || vid.readyState < 2) { requestAnimationFrame(scan); return; }
      try {
        const codes = await detector.detect(vid);
        if (codes.length > 0) {
          const raw = codes[0].rawValue;
          stopBarcodeScanner();
          const field = document.getElementById(targetFieldId);
          if (field) { field.value = raw; field.dispatchEvent(new Event('input')); }
          showToast('✅ Código detectado: ' + raw, 3000);
          return;
        }
      } catch (_) {}
      requestAnimationFrame(scan);
    };
    requestAnimationFrame(scan);

  } catch (err) {
    stopBarcodeScanner();
    if (err.name === 'NotAllowedError') {
      showToast('❌ Permiso de cámara denegado. Actívalo en ajustes del navegador.', 4000);
    } else {
      showToast('❌ No se pudo acceder a la cámara.', 3000);
    }
  }
}

function stopBarcodeScanner() {
  window._barcodeScanActive = false;
  if (window._barcodeStream) {
    window._barcodeStream.getTracks().forEach(t => t.stop());
    window._barcodeStream = null;
  }
  closeSettingsSheet();
}

// ── Régimen Tributario Ecuador ─────────────────────────────────────────────────
function openRegimenGeneral() {
  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">📋 Régimen Tributario · SRI Ecuador</h3>

    <div style="background:#f0fdf4;border-radius:12px;padding:14px;margin-bottom:10px;border:1.5px solid #bbf7d0;">
      <div style="font-size:13px;font-weight:800;color:#166534;margin-bottom:8px;">🟢 RIMPE — Negocio Popular</div>
      <div style="font-size:12px;color:#166534;line-height:1.8;">
        📌 Ingresos hasta <strong>$20,000 / año</strong><br>
        💰 Pago único anual (desde ~$60)<br>
        🧾 No emite facturas — usa RISE<br>
        📊 Sin declaración mensual de IVA<br>
        📒 Sin contabilidad formal obligatoria
      </div>
    </div>

    <div style="background:#eff6ff;border-radius:12px;padding:14px;margin-bottom:10px;border:1.5px solid #bfdbfe;">
      <div style="font-size:13px;font-weight:800;color:#1d4ed8;margin-bottom:8px;">🔵 RIMPE — Emprendedor</div>
      <div style="font-size:12px;color:#1d4ed8;line-height:1.8;">
        📌 Ingresos entre <strong>$20,001 y $300,000 / año</strong><br>
        💰 Impuesto: <strong>2% sobre ingresos brutos</strong><br>
        🧾 Facturas electrónicas SRI obligatorias<br>
        📊 Declara IVA mensual (Form. 104A)<br>
        📒 Contabilidad simplificada
      </div>
    </div>

    <div style="background:#fff7ed;border-radius:12px;padding:14px;margin-bottom:10px;border:1.5px solid #fed7aa;">
      <div style="font-size:13px;font-weight:800;color:#9a3412;margin-bottom:8px;">🟠 Régimen General</div>
      <div style="font-size:12px;color:#9a3412;line-height:1.8;">
        📌 Ingresos <strong>superiores a $300,000/año</strong> o sociedades<br>
        💰 Impuesto a la renta: <strong>25% sobre utilidad neta</strong><br>
        🧾 Facturas electrónicas + retenciones (Form. 103)<br>
        📊 Declara IVA mensual (Form. 104)<br>
        📒 <strong>Contabilidad completa NIIF obligatoria</strong><br>
        👔 Requiere Contador Público Autorizado (CPA)
      </div>
    </div>

    <div style="background:var(--primary-light);border-radius:10px;padding:12px;font-size:12px;color:var(--primary);line-height:1.7;margin-bottom:20px;">
      💡 <strong>ContaFácil Pro</strong> aplica principios <strong>NIIF PYMES</strong> compatibles con todos los regímenes. Estado de Resultados, Cartera de Clientes y Balance General en los módulos activos.
    </div>

    <button class="btn btn-secondary btn-block" onclick="closeSettingsSheet()">Entendido ✓</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

// ── Placeholders IVA y Facturación
function openIvaPlaceholder() {
  const s      = DB.getSettings();
  const actual = s.porcentajeIva || DB.IVA_DEFAULT;

  const paises = [
    { flag:'🇪🇨', pais:'Ecuador',  pct:15, nombre:'IVA 15% (SRI)' },
    { flag:'🇨🇴', pais:'Colombia', pct:19, nombre:'IVA 19% (DIAN)' },
    { flag:'🇲🇽', pais:'México',   pct:16, nombre:'IVA 16% (SAT)' },
    { flag:'🇵🇪', pais:'Perú',     pct:18, nombre:'IGV 18% (SUNAT)' },
    { flag:'🌍',  pais:'Otro',     pct: 0, nombre:'Personalizado' },
  ];

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">🏛️ Configuración de IVA</h3>

    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px;
      padding:14px; margin-bottom:18px; font-size:13px; color:#15803d; line-height:1.6;">
      <strong>Porcentaje actual:</strong> <span style="font-size:18px; font-weight:800;">${actual}%</span><br>
      Este % se usa para calcular IVA en todos los productos del inventario.
    </div>

    <div class="form-group">
      <label class="form-label">Selecciona tu país / tasa</label>
      <div style="display:flex; flex-direction:column; gap:6px;" id="pais-list">
        ${paises.map(p => `
          <button onclick="_setPorcentajeIva(${p.pct})" style="display:flex; align-items:center; gap:10px;
            padding:10px 14px; border-radius:10px; border:2px solid ${actual===p.pct?'var(--primary)':'var(--gray-200)'};
            background:${actual===p.pct?'#eff6ff':'white'}; cursor:pointer; text-align:left;">
            <span style="font-size:22px;">${p.flag}</span>
            <div style="flex:1;">
              <div style="font-size:13px; font-weight:700;">${p.pais}</div>
              <div style="font-size:11px; color:var(--gray-500);">${p.nombre}</div>
            </div>
            <div style="font-size:18px; font-weight:900; color:${actual===p.pct?'var(--primary)':'var(--gray-400)'};">${p.pct > 0 ? p.pct+'%' : '✎'}</div>
          </button>`).join('')}
      </div>
    </div>

    <div class="form-group" id="custom-iva-group" style="${actual > 0 && paises.find(p=>p.pct===actual&&p.pct>0)?'display:none':''}">
      <label class="form-label">Porcentaje personalizado</label>
      <div style="display:flex; gap:8px; align-items:center;">
        <input type="number" class="form-control" id="custom-iva-pct" value="${actual}" min="0" max="99" step="1"
          style="flex:1;" placeholder="Ej: 15">
        <span style="font-size:18px; font-weight:700;">%</span>
      </div>
      <button class="btn btn-primary btn-block mt-8" onclick="_setPorcentajeIva(parseFloat(document.getElementById('custom-iva-pct').value)||0, true)">
        Guardar porcentaje
      </button>
    </div>

    <button class="btn btn-secondary btn-block mt-16" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function _setPorcentajeIva(pct, esCustom = false) {
  DB.updateSettings({ porcentajeIva: pct });
  closeSettingsSheet();
  showToast(`✅ IVA configurado al ${pct}%`);
  // Actualizar descripción en Settings
  const el = document.getElementById('settings-iva-desc');
  if (el) el.textContent = `IVA ${pct}% · SRI Ecuador`;
}

function openFacturacionPlaceholder() {
  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <div style="text-align:center;padding:24px 0 16px;">
      <div style="font-size:56px;margin-bottom:12px;">📄</div>
      <h2 style="font-size:20px;font-weight:800;color:#0891b2;margin-bottom:8px;">Facturación Electrónica</h2>
      <p style="font-size:14px;color:var(--gray-500);line-height:1.6;">Próximamente podrás generar comprobantes de venta en PDF para tus clientes.</p>
    </div>
    <div style="background:#e0f2fe;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;color:#0c4a6e;margin-bottom:10px;">📋 Incluirá:</div>
      <div style="font-size:13px;color:#0c4a6e;line-height:1.8;">
        ✅ Factura con datos del cliente (RUC/Cédula)<br>
        ✅ Desglose de productos y servicios<br>
        ✅ Cálculo de IVA automático<br>
        ✅ Export PDF profesional<br>
        ✅ Compatible con SRI Ecuador
      </div>
    </div>
    <button class="btn btn-secondary btn-block" onclick="closeSettingsSheet()">Entendido</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

// ── Cambio rápido de usuario (misma app, mismo dispositivo) ─────────────────
function openQuickUserSwitch() {
  const s           = DB.getSettings();
  const currentUser = s.userName || 'Principal';
  const users       = DB.getUserList();
  const isOwner     = isCurrentUserOwner();
  const owner       = users.find(u => u.isOwner);

  // Banner de recuperación cuando el usuario activo NO es el propietario
  const recoveryBanner = (!isOwner && owner) ? `
    <div style="background:#fef3c7; border:1px solid #f59e0b; border-radius:10px;
      padding:12px 14px; margin-bottom:14px; display:flex; gap:10px; align-items:flex-start;">
      <div style="font-size:20px; flex-shrink:0;">⚠️</div>
      <div>
        <div style="font-size:13px; font-weight:700; color:#92400e; margin-bottom:4px;">
          No estás como propietario
        </div>
        <div style="font-size:12px; color:#78350f; line-height:1.5;">
          Algunos botones están bloqueados porque el usuario activo
          (<strong>${currentUser}</strong>) no es el propietario.<br>
          Toca <strong>${owner.name}</strong> abajo para recuperar acceso completo.
        </div>
      </div>
    </div>` : '';

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <h3 class="sheet-title">👥 Cambiar Usuario</h3>
    ${recoveryBanner}
    <div style="font-size:13px; color:var(--gray-600); margin-bottom:16px; line-height:1.5;">
      Usuario activo: <strong style="color:var(--primary);">${currentUser}</strong><br>
      <span style="font-size:11px; color:var(--gray-400);">
        Cada usuario entra solo con su propio PIN.
      </span>
    </div>

    <!-- Lista de usuarios -->
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px;">
      ${users.map(u => `
        <button onclick="switchToUser('${u.name.replace(/'/g, '&#39;')}')"
          style="display:flex; align-items:center; gap:12px; padding:14px 16px; border-radius:12px;
            border:2px solid ${u.name === currentUser ? 'var(--primary)' : 'var(--gray-100)'};
            background:${u.name === currentUser ? 'var(--primary-light)' : 'var(--white)'};
            cursor:pointer; text-align:left; width:100%;">
          <div style="font-size:24px; width:42px; height:42px; display:flex; align-items:center;
            justify-content:center; background:${u.name === currentUser ? 'var(--primary)' : 'var(--gray-100)'};
            border-radius:50%; flex-shrink:0;">
            ${u.name === currentUser ? '✅' : (u.isOwner ? '👑' : '👤')}
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:15px; font-weight:700;
              color:${u.name === currentUser ? 'var(--primary)' : 'var(--gray-800)'};">
              ${u.name}${u.isOwner ? ' <span style="font-size:10px;color:var(--gray-400);">Propietario</span>' : ''}
            </div>
            <div style="font-size:11px; color:var(--gray-400);">
              ${u.name === currentUser ? '✓ Activo ahora' : (u.pinHash ? '🔒 Requiere su PIN' : '🔓 Sin PIN · Toca para cambiar')}
            </div>
          </div>
          ${u.name !== currentUser ? '<div style="font-size:18px; color:var(--gray-300);">›</div>' : ''}
        </button>
      `).join('')}
    </div>

    <!-- Agregar nuevo usuario -->
    <div style="border-top:1px solid var(--gray-100); padding-top:16px;">
      <div style="font-size:11px; font-weight:700; color:var(--gray-500); text-transform:uppercase;
        letter-spacing:.5px; margin-bottom:10px;">➕ Agregar usuario nuevo</div>
      <div style="display:flex; gap:8px;">
        <input type="text" id="new-user-input" class="form-control"
          placeholder="Nombre (ej: Ana, Vendedor 2)" maxlength="30" style="flex:1;"
          onkeydown="if(event.key==='Enter') addAndSwitchUser()">
        <button class="btn btn-primary" onclick="addAndSwitchUser()" style="flex-shrink:0; padding:0 16px;">
          Crear
        </button>
      </div>
      <div style="font-size:11px; color:var(--gray-400); margin-top:6px; line-height:1.5;">
        Se pedirá elegir un PIN para el nuevo usuario.
      </div>
    </div>

    <button class="btn btn-secondary btn-block mt-16" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

function switchToUser(name) {
  const currentUser = DB.getSettings().userName || 'Principal';
  if (name === currentUser) { closeSettingsSheet(); return; } // ya está activo

  const entry = DB.getUserEntry(name);
  closeSettingsSheet();

  if (entry && entry.pinHash) {
    // El usuario objetivo tiene PIN: pedírselo
    setTimeout(() => {
      showLockScreen('unlock', () => {
        // ── CRÍTICO: persistir el cambio en settings.userName ─────────────────
        // Sin esta línea el DOM se actualiza pero el estado interno queda en el
        // usuario anterior; isCurrentUserOwner() y permisos fallan silenciosamente.
        DB.switchUser(name);
        document.getElementById('dash-user-name').textContent = name;
        showToast('👤 Bienvenido, ' + name, 2000);
        renderSettings();
      }, name);
    }, 200);
  } else {
    // Sin PIN: cambiar directamente
    DB.switchUser(name);
    document.getElementById('dash-user-name').textContent = name;
    showToast('👤 Usuario activo: ' + name, 2000);
    renderSettings();
  }
}

function addAndSwitchUser() {
  const name = document.getElementById('new-user-input')?.value.trim();
  if (!name) { showToast('⚠️ Escribe un nombre'); return; }
  if (DB.getUserEntry(name)) { showToast('⚠️ Ese nombre ya existe'); return; }

  DB.addUserToList(name);
  closeSettingsSheet();

  // ── CRÍTICO: NO cambiar al nuevo usuario después de crear su PIN ──────────
  // Antes el código hacía DB.switchUser(name) dentro del callback, lo cual
  // activaba el nuevo usuario (no-propietario) y bloqueaba todas las acciones
  // del propietario. Ahora: se crea el usuario y su PIN, pero el propietario
  // sigue activo. El nuevo usuario puede iniciar sesión desde el selector.
  setTimeout(() => {
    showToast(`👤 Nuevo usuario "${name}" creado. Asignando PIN…`, 2500);
    showLockScreen('set', () => {
      // Volver a abrir gestión de seguridad como confirmación, SIN cambiar usuario
      renderSettings();
      openSecuritySettings();
      showToast(`✅ PIN de "${name}" configurado. El propietario sigue activo.`, 3000);
    }, name);
  }, 300);
}

// ── Reporte por descripción ───────────────────────────────────────────────────
// Muestra todos los registros que tienen exactamente la misma descripción
function openDescriptionReport(desc) {
  const allTxs = DB.getTransactions()
    .filter(t => t.description.toLowerCase() === desc.toLowerCase() && !t.isCogs)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!allTxs.length) { showToast('Sin registros con esa descripción'); return; }

  const totalInc = allTxs.filter(t => t.type === 'income')   .reduce((s,t) => s+t.amount, 0);
  const totalExp = allTxs.filter(t => t.type === 'expense')  .reduce((s,t) => s+t.amount, 0);
  const totalLib = allTxs.filter(t => t.type === 'liability').reduce((s,t) => s+t.amount, 0);

  // Agrupar por mes
  const groups = {};
  allTxs.forEach(t => {
    const d = new Date(t.date + 'T12:00:00');
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  });

  const listHTML = Object.keys(groups).sort((a,b) => b.localeCompare(a)).map(key => {
    const [y,m] = key.split('-').map(Number);
    const label = new Date(y, m-1, 1).toLocaleDateString('es-CO', { month:'long', year:'numeric' });
    const items = groups[key];
    const mInc  = items.filter(t=>t.type==='income') .reduce((s,t)=>s+t.amount, 0);
    const mExp  = items.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount, 0);
    const typeColors = { income:'var(--success)', expense:'var(--danger)', transfer:'var(--primary)', liability:'var(--warning)' };
    return `
      <div style="padding:8px 0 4px; font-size:11px; font-weight:700; color:var(--gray-500);
        text-transform:uppercase; display:flex; justify-content:space-between;">
        <span>${label}</span>
        <span>
          ${mInc > 0 ? `<span style="color:var(--success);">+${fmt(mInc)}</span>` : ''}
          ${mInc > 0 && mExp > 0 ? ' · ' : ''}
          ${mExp > 0 ? `<span style="color:var(--danger);">-${fmt(mExp)}</span>` : ''}
        </span>
      </div>
      ${items.map(t => {
        const cat  = DB.getCategoryById(t.category);
        const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '';
        const multiUser = DB.getUserNames().length > 1;
        return `
          <div style="display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid var(--gray-100);">
            <div style="font-size:20px; flex-shrink:0;">${cat ? cat.emoji : (t.type==='income'?'💰':t.type==='expense'?'💸':t.type==='transfer'?'↔️':'🔴')}</div>
            <div style="flex:1; min-width:0;">
              <div style="font-size:12px; color:var(--gray-500);">${fmtDate(t.date)}${cat ? ' · '+cat.name : ''}${t.notes ? ' · '+t.notes : ''}</div>
              ${(multiUser && t.userName) ? `<div style="font-size:10px; color:var(--primary); margin-top:1px;">👤 ${t.userName}</div>` : ''}
            </div>
            <div style="font-size:15px; font-weight:700; color:${typeColors[t.type]||'var(--gray-700)'}; flex-shrink:0;">${sign}${fmt(t.amount)}</div>
          </div>`;
      }).join('')}
    `;
  }).join('');

  // Botón "Ver en diario" con búsqueda pre-cargada
  const safeDesc = desc.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');

  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>

    <div style="padding:4px 0 16px;">
      <div style="font-size:11px; color:var(--gray-400); font-weight:600; text-transform:uppercase;
        letter-spacing:.5px; margin-bottom:6px;">🔍 Descripción</div>
      <div style="font-size:18px; font-weight:800; color:var(--gray-900); word-break:break-word;">"${desc}"</div>
      <div style="font-size:13px; color:var(--gray-400); margin-top:4px;">
        ${allTxs.length} registro${allTxs.length!==1?'s':''} · todos los períodos
      </div>
    </div>

    <!-- Totales -->
    <div style="display:grid; grid-template-columns:${[totalInc,totalExp,totalLib].filter(v=>v>0).length>1?'1fr 1fr':'1fr'}; gap:8px; margin-bottom:14px;">
      ${totalInc>0?`<div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:10px;color:var(--gray-400);font-weight:700;letter-spacing:.3px;">INGRESOS</div><div style="font-size:20px;font-weight:800;color:var(--success);">+${fmt(totalInc)}</div></div>`:''}
      ${totalExp>0?`<div style="background:#fff1f2;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:10px;color:var(--gray-400);font-weight:700;letter-spacing:.3px;">GASTOS</div><div style="font-size:20px;font-weight:800;color:var(--danger);">-${fmt(totalExp)}</div></div>`:''}
      ${totalLib>0?`<div style="background:#fef3c7;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:10px;color:var(--gray-400);font-weight:700;letter-spacing:.3px;">DEUDAS</div><div style="font-size:20px;font-weight:800;color:var(--warning);">${fmt(totalLib)}</div></div>`:''}
    </div>

    <button class="btn btn-outline btn-block mb-12" onclick="
      closeSettingsSheet();
      journalSearch = '${safeDesc}';
      const el = document.getElementById('journal-search');
      if(el) el.value = '${safeDesc}';
      navigate('journal');
    ">📒 Ver en el Diario con este filtro →</button>

    <div style="font-size:12px; font-weight:700; color:var(--gray-500); text-transform:uppercase;
      letter-spacing:.5px; margin-bottom:8px;">Desglose por fecha</div>
    <div style="max-height:50vh; overflow-y:auto;">${listHTML}</div>

    <button class="btn btn-secondary btn-block mt-16" onclick="closeSettingsSheet()">Cerrar</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
}

// ── Multi-usuario / Sincronización ────────────────────────────────────────────
function openUserSyncSheet(mode) {
  const s        = DB.getSettings();
  const userName = s.userName || 'Principal';
  const users    = DB.getUserNames();
  let content    = '';

  if (mode === 'name') {
    content = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">👤 Mi Nombre de Usuario</h3>
      <div style="font-size:13px; color:var(--gray-600); margin-bottom:16px; line-height:1.6;">
        Este nombre identifica tus registros cuando combines datos con otro dispositivo o vendedor.
      </div>
      <div class="form-group">
        <label class="form-label">Nombre (ej: Ana, Vendedor 1, Sucursal Norte)</label>
        <input type="text" class="form-control" id="user-name-input"
          value="${userName}" placeholder="Principal" maxlength="30"
          style="font-size:16px; font-weight:600;">
      </div>
      <div style="font-size:11px; color:var(--gray-400); margin-bottom:16px; line-height:1.5;">
        💡 Los registros que ya tienes quedan con el nombre actual. El nuevo nombre aplica a futuros registros.
      </div>
      <button class="btn btn-primary btn-block" onclick="saveUserName()">✅ Guardar nombre</button>
      <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet()">Cancelar</button>
    `;
  } else if (mode === 'export') {
    content = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">📤 Exportar Mi Registro</h3>
      <div style="background:var(--primary-light); border-radius:10px; padding:14px; margin-bottom:14px; font-size:13px; color:var(--primary); line-height:1.7;">
        <strong>¿Cómo sincronizar con otro dispositivo?</strong><br><br>
        1️⃣ Toca <strong>"Exportar"</strong> → se descarga un archivo <code>.json</code><br>
        2️⃣ Envía ese archivo por <strong>WhatsApp, email, USB o Drive</strong><br>
        3️⃣ En el otro dispositivo: Ajustes → Equipo → <strong>Importar registro de compañero</strong><br>
        4️⃣ Los datos se unen automáticamente sin duplicar ✅
      </div>
      <div style="background:var(--gray-50); border-radius:10px; padding:12px; margin-bottom:14px; font-size:13px;">
        <div style="font-weight:700; margin-bottom:6px; color:var(--gray-700);">📦 El archivo incluye:</div>
        <div style="color:var(--gray-600); line-height:1.8;">
          ✅ Todas tus transacciones (ingresos, gastos, deudas, traslados)<br>
          ✅ Cartera de clientes (cuentas por cobrar)<br>
          ❌ Inventario (se gestiona por dispositivo)<br>
          ❌ Configuración (se mantiene en cada dispositivo)
        </div>
      </div>
      <div style="font-size:13px; color:var(--gray-600); margin-bottom:16px; padding:10px 12px; background:var(--gray-50); border-radius:8px;">
        Exportando como: <strong style="color:var(--primary); font-size:15px;">👤 ${userName}</strong>
      </div>
      <button class="btn btn-primary btn-block" onclick="doExportForSync()">
        📤 Exportar registro de ${userName}
      </button>
      <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet()">Cancelar</button>
    `;
  } else if (mode === 'import') {
    const usersInfo = users.length > 1
      ? `<div style="background:var(--gray-50); border-radius:8px; padding:10px 12px; margin-bottom:14px; font-size:13px; color:var(--gray-600);">
           👥 Usuarios en esta app: ${users.map(u => `<strong>${u}</strong>`).join(', ')}
         </div>`
      : '';
    content = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">📥 Importar Registro de Compañero</h3>
      <div style="background:var(--primary-light); border-radius:10px; padding:14px; margin-bottom:14px; font-size:13px; color:var(--primary); line-height:1.7;">
        <strong>Pasos:</strong><br><br>
        1️⃣ Tu compañero exporta su registro (Ajustes → Equipo → <strong>Exportar</strong>)<br>
        2️⃣ Te envía el archivo <code>.json</code><br>
        3️⃣ Toca <strong>"Seleccionar archivo"</strong> aquí<br>
        4️⃣ Los datos se combinan, verás ambos en el Diario ✅
      </div>
      <div style="background:#f0fdf4; border-radius:10px; padding:10px 12px; margin-bottom:14px; font-size:13px; color:#166534; line-height:1.6;">
        🛡️ <strong>Protección anti-duplicados</strong> — Si ya importaste antes el mismo archivo, no se vuelve a duplicar nada. Puedes importar el mismo archivo varias veces con total seguridad.
      </div>
      ${usersInfo}
      <button class="btn btn-primary btn-block" onclick="doImportFromUser()">
        📂 Seleccionar archivo de compañero (.json)
      </button>
      ${users.length > 1 ? `
        <button class="btn btn-outline btn-block mt-8" onclick="closeSettingsSheet(); setJournalUserFilter(''); navigate('journal');">
          📒 Ver Diario filtrado por usuario →
        </button>` : ''}
      <button class="btn btn-secondary btn-block mt-8" onclick="closeSettingsSheet()">Cancelar</button>
    `;
  }

  document.getElementById('settings-sheet-content').innerHTML = content;
  document.getElementById('settings-sheet').classList.add('open');
}

function saveUserName() {
  const name = document.getElementById('user-name-input')?.value.trim();
  if (!name) { showToast('⚠️ Ingresa un nombre'); return; }

  const oldName = DB.getSettings().userName || 'Principal';
  if (name === oldName) { closeSettingsSheet(); return; }

  // ── CRÍTICO: actualizar el nombre en el array users[] conservando isOwner ──
  // Si solo se actualiza settings.userName sin tocar users[], isCurrentUserOwner()
  // deja de encontrar coincidencia y el propietario pierde todos sus permisos.
  const users = DB.getUserList();
  const idx   = users.findIndex(u => u.name === oldName);
  if (idx >= 0) {
    users[idx] = { ...users[idx], name }; // renombrar preservando isOwner, pinHash, etc.
    DB.updateSettings({ userName: name, users });
  } else {
    DB.updateSettings({ userName: name });
  }

  closeSettingsSheet();
  renderSettings();
  showToast('✅ Nombre guardado: ' + name);
}

async function doExportForSync() {
  const s    = DB.getSettings();
  showToast('⏳ Preparando archivo (incluye fotos)…', 6000);
  const json = await DB.exportForSync();
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().split('T')[0];
  const safe = (s.userName || 'Principal').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]/g, '-');
  a.href     = url;
  a.download = `contafacil-${safe}-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  closeSettingsSheet();
  showToast('📤 Archivo exportado — envíalo a tu compañero', 3500);
}

function doImportFromUser() {
  const input  = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const text = ev.target.result;
      try {
        const parsed = JSON.parse(text);
        if (parsed.cf_encrypted) {
          // Archivo cifrado detectado → pedir contraseña
          _encImportPending = text;
          closeSettingsSheet();
          setTimeout(() => openEncryptedImportSheet(), 200);
          return;
        }
        // Archivo normal (no cifrado)
        const result = await DB.importFromUser(text);
        closeSettingsSheet();
        const msg = result.addedTxs === 0
          ? `✅ Sin cambios — los datos de ${result.sourceUser} ya estaban importados`
          : `✅ ${result.addedTxs} registro${result.addedTxs !== 1 ? 's' : ''} de ${result.sourceUser} importados`;
        showToast(msg, 4000);
        renderDashboard();
      } catch {
        showToast('❌ Archivo inválido o corrupto. Usa el archivo .json de ContaFácil.', 3500);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── Settings ───────────────────────────────────────────────────────────────────
// ── Recuperación de acceso del propietario ────────────────────────────────────
// Llamado desde el banner rojo en Settings cuando el usuario activo NO es owner.
// Si el propietario no tiene PIN → cambia directamente.
// Si tiene PIN → pide el PIN del propietario antes de cambiar.
function recoverOwnerAccess() {
  const users = DB.getUserList();
  const owner = users.find(u => u.isOwner);
  if (!owner) {
    // No hay propietario definido: marcar al primer usuario como propietario
    const firstUser = users[0];
    if (firstUser) {
      DB.switchUser(firstUser.name);
      showToast('✅ Acceso restaurado como propietario', 3000);
      setTimeout(() => location.reload(), 800);
    }
    return;
  }

  if (!owner.pinHash) {
    // Propietario sin PIN → cambiar directo
    DB.switchUser(owner.name);
    showToast('✅ Bienvenido de nuevo, ' + owner.name, 2500);
    setTimeout(() => location.reload(), 800);
  } else {
    // Propietario con PIN → pedir verificación
    showLockScreen('unlock', () => {
      DB.switchUser(owner.name);
      showToast('✅ Acceso restaurado: ' + owner.name, 2500);
      setTimeout(() => location.reload(), 800);
    }, owner.name);
  }
}

function renderSettings() {
  const s = DB.getSettings();
  document.getElementById('settings-company-val').textContent  = s.companyName;
  document.getElementById('settings-currency-val').textContent = s.currency;

  // ── Banner de recuperación de acceso ──────────────────────────────────────
  const recoveryBanner = document.getElementById('settings-recovery-banner');
  if (recoveryBanner) {
    const isOwner = isCurrentUserOwner();
    recoveryBanner.style.display = isOwner ? 'none' : 'block';
    if (!isOwner) {
      const users    = DB.getUserList();
      const owner    = users.find(u => u.isOwner);
      const msgEl    = document.getElementById('recovery-banner-msg');
      const current  = s.userName || 'Principal';
      if (msgEl && owner) {
        msgEl.textContent = `Usuario activo: "${current}" (no es propietario). ` +
          `Toca el botón para recuperar el acceso como "${owner.name}".`;
      }
    }
  }

  // Indicador IVA
  const ivaDescEl = document.getElementById('settings-iva-desc');
  if (ivaDescEl) {
    const pct = s.porcentajeIva || DB.IVA_DEFAULT;
    ivaDescEl.textContent = `IVA ${pct}% · activo en inventario`;
  }

  // Indicador multi-empresa
  const coList = DB.getCompanyList();
  const coEl   = document.getElementById('settings-company-switcher-desc');
  if (coEl) {
    coEl.textContent = coList.length > 1
      ? `${coList.length} empresas · toca para cambiar`
      : 'Toca para agregar otra empresa';
  }
  const unEl = document.getElementById('settings-username-val');
  if (unEl) unEl.textContent = s.userName || 'Principal';

  // Etiqueta de versión (confirma que el navegador cargó código fresco)
  const verEl = document.getElementById('settings-version-tag');
  if (verEl) verEl.textContent = 'ContaFácil Pro · v' + APP_VERSION;

  // Sincronizar toggle modo oscuro
  const isDark = document.body.classList.contains('dark-mode');
  applyTheme(isDark);

  const recs   = DB.getRecurrings();
  const active = recs.filter(r => r.isActive);
  const descEl = document.getElementById('settings-recurring-desc');
  if (descEl) {
    descEl.textContent = active.length
      ? `${active.length} activo(s) · ${fmt(active.reduce((s, r) => s + r.amount, 0))}/mes`
      : 'Internet, arriendo, suscripciones…';
  }

  const budgets    = DB.getBudgets();
  const budgetCount = Object.keys(budgets).length;
  const budgetDesc  = document.getElementById('settings-budget-desc');
  if (budgetDesc) {
    budgetDesc.textContent = budgetCount
      ? `${budgetCount} categoría(s) · ${fmt(Object.values(budgets).reduce((s, v) => s + v, 0))}/mes`
      : 'Límites por categoría de gasto';
  }

  // Seguridad
  const pinDescEl = document.getElementById('settings-pin-desc');
  if (pinDescEl) {
    const cu = DB.getSettings().userName || 'Principal';
    pinDescEl.textContent = DB.userHasPin(cu) ? `🟢 PIN activo (${cu})` : 'Sin PIN configurado';
  }
  const expPinDescEl = document.getElementById('settings-export-pin-desc');
  if (expPinDescEl) {
    const sec = DB.getSecuritySettings();
    expPinDescEl.textContent = sec.requirePinForExport
      ? '🔒 Se pide PIN antes de exportar'
      : 'Exportar sin confirmación de PIN';
  }

  const auditDescEl = document.getElementById('settings-audit-desc');
  if (auditDescEl) {
    const count = DB.getAuditLog(1).length;
    auditDescEl.textContent = count > 0 ? 'Ver historial de actividad' : 'Sin actividad aún';
  }

  // Estado del botón de notificaciones
  const notifDesc  = document.getElementById('settings-notif-desc');
  const notifArrow = document.getElementById('settings-notif-arrow');
  const notifBtn   = document.getElementById('settings-notif-btn');
  if (notifDesc && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      notifDesc.textContent = '🟢 Notificaciones activas';
      if (notifArrow) notifArrow.textContent = '✓';
      if (notifBtn)   notifBtn.style.opacity = '0.7';
    } else if (Notification.permission === 'denied') {
      notifDesc.textContent = '🔴 Bloqueadas en el navegador';
      if (notifArrow) notifArrow.textContent = '✗';
    } else {
      notifDesc.textContent = 'Toca para activar recordatorios';
      if (notifArrow) notifArrow.textContent = '›';
    }
  } else if (notifDesc) {
    notifDesc.textContent = 'No compatible con este navegador';
  }
}

function openSettingsSheet(type) {
  const s = DB.getSettings();
  const content = document.getElementById('settings-sheet-content');

  if (type === 'company') {
    content.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Información del Negocio</h3>
      <div class="form-group"><label class="form-label">Nombre del negocio</label>
        <input class="form-control" id="s-company" value="${s.companyName}" placeholder="Ej: Tienda Doña María"></div>
      <div class="form-group"><label class="form-label">Propietario</label>
        <input class="form-control" id="s-owner" value="${s.ownerName || ''}" placeholder="Tu nombre"></div>
      <button class="btn btn-primary btn-block mt-16" onclick="DB.updateSettings({companyName:document.getElementById('s-company').value,ownerName:document.getElementById('s-owner').value}); closeSettingsSheet(); renderSettings(); showToast('✅ Guardado');">Guardar</button>
    `;
  } else if (type === 'currency') {
    const currencies = [['COP','$','Peso colombiano'],['MXN','$','Peso mexicano'],['PEN','S/','Sol peruano'],['CLP','$','Peso chileno'],['ARS','$','Peso argentino'],['USD','$','Dólar'],['EUR','€','Euro'],['BRL','R$','Real brasileño']];
    content.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Moneda</h3>
      ${currencies.map(([code, sym, name]) => `
        <button class="settings-item" onclick="DB.updateSettings({currency:'${code}',currencySymbol:'${sym}'}); closeSettingsSheet(); renderSettings(); showToast('✅ Moneda: ${code}');">
          <span style="font-size:18px; font-weight:700; width:38px; color:var(--primary);">${sym}</span>
          <div class="settings-item-info"><div class="settings-item-label">${name}</div><div class="settings-item-desc">${code}</div></div>
          ${s.currency === code ? '<span style="color:var(--success); font-size:20px;">✓</span>' : ''}
        </button>`).join('')}
    `;
  } else if (type === 'export') {
    content.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Exportar / Importar</h3>
      <p style="font-size:14px; color:var(--gray-600); margin-bottom:20px; line-height:1.6;">Guarda una copia de seguridad o transfiere tus datos a otro dispositivo.</p>
      <button class="btn btn-primary btn-block mb-12" onclick="exportData()">📥 Exportar datos (JSON)</button>
      <div class="form-group"><label class="form-label">Importar datos</label>
        <input type="file" class="form-control" id="import-file" accept=".json" onchange="importData(this)"></div>
      <div style="background:var(--warning-light); border-radius:8px; padding:12px; margin-top:12px; font-size:13px; color:var(--warning);">⚠️ Importar reemplazará todos los datos actuales.</div>
    `;
  } else if (type === 'guide') {
    content.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Guía de Uso</h3>
      <div class="guide-step"><div class="guide-num">1</div><div class="guide-text"><strong>Ingreso</strong> — Ventas, servicios, comisiones. Suma al resultado neto.</div></div>
      <div class="guide-step"><div class="guide-num">2</div><div class="guide-text"><strong>Gasto</strong> — Arriendo, internet, compras, salarios. Resta al resultado neto.</div></div>
      <div class="guide-step"><div class="guide-num">3</div><div class="guide-text"><strong>Traslado</strong> — Mover dinero entre Caja y Banco. <strong>NO afecta el resultado</strong>.</div></div>
      <div class="guide-step"><div class="guide-num">4</div><div class="guide-text"><strong>Deuda/Pasivo</strong> — Dinero que debes. Ej: "Alianza del Valle". <strong>NO afecta el resultado</strong> hasta que la registres como gasto al pagar.</div></div>
      <div class="guide-step"><div class="guide-num">5</div><div class="guide-text"><strong>Inventario</strong> — Registra productos. Al vender con "afecta inventario", el stock baja automáticamente.</div></div>
      <div class="guide-step"><div class="guide-num">6</div><div class="guide-text"><strong>PDF</strong> — En Reportes, elige el mes y toca "Generar PDF". El libro diario muestra columnas Debe/Haber.</div></div>
      <button class="btn btn-secondary mt-16" onclick="closeSettingsSheet()">Entendido ✓</button>
    `;
  } else if (type === 'about') {
    content.innerHTML = `
      <div class="sheet-handle"></div>
      <div style="text-align:center; padding:20px 0;">
        <div style="font-size:64px; margin-bottom:12px;">💼</div>
        <h2 style="font-size:22px; font-weight:800; color:var(--primary); margin-bottom:6px;">ContaFácil Pro</h2>
        <p style="font-size:14px; color:var(--gray-500);">v2.0 — Contabilidad correcta para emprendedores</p>
        <p style="font-size:13px; color:var(--gray-400); margin-top:12px;">100% offline · Datos guardados en tu dispositivo</p>
      </div>
      <button class="btn btn-secondary btn-block mt-16" onclick="closeSettingsSheet()">Cerrar</button>
    `;
  }

  document.getElementById('settings-sheet').classList.add('open');
}

function closeSettingsSheet() {
  // Detener cámara del escáner si estaba activa
  if (window._barcodeStream) {
    window._barcodeStream.getTracks().forEach(t => t.stop());
    window._barcodeStream = null;
    window._barcodeScanActive = false;
  }
  document.getElementById('settings-sheet').classList.remove('open');
}

// ── Export / Import ────────────────────────────────────────────────────────────
async function exportData() {
  showToast('⏳ Preparando respaldo (incluye fotos)…', 6000);
  const blob = new Blob([await DB.exportData()], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `contafacil-backup-${today()}.json` });
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ Datos exportados');
}

function importData(input) {
  const reader = new FileReader();
  reader.onload = async e => {
    try { await DB.importData(e.target.result); closeSettingsSheet(); navigate('dashboard'); showToast('✅ Datos importados'); }
    catch { showToast('❌ Archivo inválido'); }
  };
  reader.readAsText(input.files[0]);
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function emptyHTML(icon, title, text) {
  return `<div class="empty-state"><div class="empty-state-icon">${icon}</div><div class="empty-state-title">${title}</div><p class="empty-state-text">${text}</p></div>`;
}

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  DB.init();
  initSecurity();

  // Disparar notificaciones nativas al abrir la app (una vez por día)
  _fireNotifications();

  // Auto-bloqueo por inactividad: reiniciar temporizador en cualquier interacción
  ['click', 'touchstart', 'keydown', 'scroll'].forEach(ev =>
    document.addEventListener(ev, resetInactivityTimer, { passive: true })
  );
  resetInactivityTimer();

  // Pantalla de privacidad: ocultar contenido al minimizar la app (App Switcher)
  document.addEventListener('visibilitychange', () => {
    const privEl = document.getElementById('screen-privacy');
    if (!privEl) return;
    if (document.hidden) {
      privEl.style.display = 'flex'; // cubrir contenido
    } else {
      privEl.style.display = 'none'; // mostrar al volver
      resetInactivityTimer();        // reiniciar timer al regresar
      _fireNotifications();          // disparar alertas al volver a la app
    }
  });

  // Aplicar tema guardado (modo oscuro)
  const savedDark = localStorage.getItem('cf_dark_mode') === '1';
  applyTheme(savedDark);

  // Procesar gastos recurrentes pendientes al abrir la app
  setTimeout(() => {
    const generated = DB.processRecurringExpenses();
    if (generated.length) {
      const names = [...new Set(generated.map(g => g.name))].join(', ');
      showToast(`🔄 ${generated.length} gasto(s) automático(s) registrado(s): ${names}`, 4500);
      if (currentScreen === 'dashboard') renderDashboard();
      if (currentScreen === 'journal')   renderJournal();
    }
  }, 800);

  if (!DB.isOnboarded()) {
    document.getElementById('screen-onboarding').classList.add('active');
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('fab').style.display = 'none';
    renderOnboarding();
  } else {
    navigate('dashboard');
  }

  document.getElementById('journal-search').addEventListener('input', e => {
    journalSearch = e.target.value;
    renderJournal();
  });

  document.getElementById('inventory-search')?.addEventListener('input', () => renderInventory());

  document.getElementById('detail-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('detail-overlay')) closeDetail();
  });
  document.getElementById('settings-sheet').addEventListener('click', e => {
    if (e.target === document.getElementById('settings-sheet')) closeSettingsSheet();
  });

  document.querySelectorAll('.nav-item').forEach(item =>
    item.addEventListener('click', () => navigate(item.dataset.screen))
  );

  document.getElementById('dash-recent').addEventListener('click', e => {
    const li = e.target.closest('[data-tx-id]');
    if (li) openTxDetail(li.dataset.txId);
  });

  // Cierra resultados de búsqueda global al tocar fuera
  document.addEventListener('click', e => {
    const wrap = document.getElementById('dash-search-wrap');
    if (wrap && !wrap.contains(e.target)) clearGlobalSearch();
  });
});
