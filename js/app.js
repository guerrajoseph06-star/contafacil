/**
 * ContaFácil Pro — Application Logic v2.0
 * Tipos correctos: income | expense | transfer | liability
 */

// ── Estado global ─────────────────────────────────────────────────────────────
let currentScreen = 'dashboard';

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
let editingTxId   = null;
let formType      = 'expense';
let journalFilter = 'all';
let journalSearch = '';
let reportYear    = new Date().getFullYear();
let reportMonth   = new Date().getMonth() + 1;

// ── Formatos ──────────────────────────────────────────────────────────────────
function fmt(amount) {
  const s = DB.getSettings();
  return s.currencySymbol + ' ' + Number(amount).toLocaleString('es-CO', {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}
function fmtDate(str) {
  return new Date(str + 'T12:00:00').toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}
function today() { return new Date().toISOString().split('T')[0]; }

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

// ── Navegación ────────────────────────────────────────────────────────────────
function navigate(screen, params = {}) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('screen-' + screen);
  if (el) el.classList.add('active');
  currentScreen = screen;

  document.querySelectorAll('.nav-item').forEach(ni =>
    ni.classList.toggle('active', ni.dataset.screen === screen)
  );

  // FAB: contexto dinámico según pantalla
  const fab = document.getElementById('fab');
  if (fab) {
    const fabScreens = ['dashboard', 'journal', 'inventory', 'cartera'];
    fab.style.display = fabScreens.includes(screen) ? 'flex' : 'none';
    if (screen === 'inventory') {
      fab.title = 'Agregar producto';
      fab.onclick = () => openProductForm();
    } else if (screen === 'cartera') {
      fab.title = 'Nueva venta a crédito';
      fab.onclick = () => openReceivableForm();
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

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const stats   = DB.getMonthStats(y, m);
  const all     = DB.getAllTimeBalance();
  const s       = DB.getSettings();
  const pending = DB.getPendingLiabilities();

  document.getElementById('dash-company').textContent  = s.companyName;
  document.getElementById('dash-balance').textContent  = fmt(all.netProfit);
  document.getElementById('dash-income').textContent   = fmt(stats.income);
  document.getElementById('dash-expense').textContent  = fmt(stats.opExpenses);
  document.getElementById('dash-month').textContent    =
    new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  // Utilidad neta del mes
  const netEl = document.getElementById('dash-net');
  netEl.textContent = (stats.netProfit >= 0 ? '+' : '') + fmt(stats.netProfit);
  netEl.style.color = 'white';

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

  // Alerta deudas pendientes
  const alertEl = document.getElementById('dash-liabilities-alert');
  if (pending.length) {
    const total = pending.reduce((s, t) => s + t.amount, 0);
    alertEl.style.display = 'flex';
    alertEl.innerHTML = `
      <span style="font-size:20px;">🔴</span>
      <div>
        <div style="font-weight:700; font-size:14px;">Deudas pendientes: ${fmt(total)}</div>
        <div style="font-size:12px; opacity:.8;">${pending.length} deuda${pending.length > 1 ? 's' : ''} sin pagar</div>
      </div>
    `;
  } else {
    alertEl.style.display = 'none';
  }

  // Últimas 5 transacciones (excluir entradas de CMV auto-generadas)
  const txs = DB.getTransactions().filter(t => !t.isCogs).slice(0, 5);
  const recentEl = document.getElementById('dash-recent');
  recentEl.innerHTML = txs.length
    ? `<ul class="tx-list">${txs.map(txItemHTML).join('')}</ul>`
    : emptyHTML('📭', 'Sin movimientos', 'Toca + para agregar tu primera transacción');

  // Alertas de presupuesto excedido
  renderBudgetAlerts();

  // Alerta cartera vencida
  renderCarteraAlert();

  // Chip de cartera con monto pendiente
  const carteraStats = DB.getReceivableStats();
  const chipVal = document.getElementById('dash-cartera-chip-val');
  if (chipVal && carteraStats.totalPendiente > 0) {
    chipVal.textContent = fmt(carteraStats.totalPendiente);
  } else if (chipVal) {
    chipVal.textContent = 'Cobrar';
  }

  // Próximos gastos recurrentes
  renderUpcomingRecurrings();
}

// ── Diario ────────────────────────────────────────────────────────────────────
function renderJournal() {
  let txs = DB.getTransactions();

  if (journalFilter !== 'all') txs = txs.filter(t => t.type === journalFilter);
  if (journalSearch.trim()) {
    const q = journalSearch.toLowerCase();
    txs = txs.filter(t => t.description.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q));
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
  journalFilter = f;
  document.querySelectorAll('.filter-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.filter === f)
  );
  renderJournal();
}

// ── Ítem de transacción (display correcto por tipo) ───────────────────────────
function txItemHTML(tx) {
  const cat = DB.getCategoryById(tx.category);
  let emoji, amountText, amountClass, metaText, extraStyle = '';

  // CMV auto-generado: estilo diferente, no interactivo si se prefiere
  if (tx.isCogs) {
    emoji = '📦';
    amountText = '-' + fmt(tx.amount);
    amountClass = 'cogs';
    metaText = fmtDate(tx.date) + ' · Costo de Ventas (CMV) · Auto';
    extraStyle = 'opacity:.7; background:var(--gray-50);';
  } else if (tx.type === 'income') {
    emoji = cat ? cat.emoji : '💰';
    amountText = '+' + fmt(tx.amount);
    amountClass = 'income';
    const cogsTag = tx.cogsAmount ? ` · CMV: -${fmt(tx.cogsAmount)}` : '';
    metaText = fmtDate(tx.date) + (cat ? ' · ' + cat.name : '') + cogsTag;

  } else if (tx.type === 'expense') {
    emoji = cat ? cat.emoji : '💸';
    amountText = '-' + fmt(tx.amount);
    amountClass = 'expense';
    const recTag = tx.isRecurring ? ' · 🔄 Auto' : '';
    metaText = fmtDate(tx.date) + (cat ? ' · ' + cat.name : '') + recTag;

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

  return `
    <li class="tx-item" data-tx-id="${tx.id}" style="${extraStyle}">
      <div class="tx-icon ${tx.isCogs ? 'cogs' : tx.type}"><span>${emoji}</span></div>
      <div class="tx-info">
        <div class="tx-desc">${tx.description}${tx.isCogs ? ' <span style="font-size:10px;background:#ede9fe;color:#7c3aed;border-radius:4px;padding:1px 5px;vertical-align:middle;">AUTO</span>' : ''}</div>
        <div class="tx-meta">${metaText}</div>
      </div>
      <div class="tx-amount ${amountClass}">${amountText}</div>
    </li>
  `;
}

// ── Formulario de transacción ─────────────────────────────────────────────────
function renderForm(editId = null) {
  editingTxId = editId || null;
  const isEdit = !!editId;
  let tx = isEdit ? DB.getTransactionById(editId) : null;
  if (tx) formType = tx.type;

  document.getElementById('form-title').textContent = isEdit ? 'Editar Transacción' : 'Nueva Transacción';
  document.getElementById('btn-delete-tx').style.display = isEdit ? 'flex' : 'none';

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
        <label class="form-label">Estado</label>
        <select id="f-liability-status" class="form-control">
          <option value="pending" ${tx?.liabilityStatus !== 'paid' ? 'selected' : ''}>🔴 Pendiente de pago</option>
          <option value="paid"    ${tx?.liabilityStatus === 'paid'  ? 'selected' : ''}>✅ Pagada</option>
        </select>
      </div>
    `;
  } else {
    // INGRESO o GASTO: categoría + cuenta + inventario opcional
    html += `
      <div class="form-group">
        <label class="form-label">Categoría</label>
        <select id="f-category" class="form-control">${catOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Cuenta</label>
        <select id="f-account" class="form-control">${accOptions('account')}</select>
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

  container.innerHTML = html;
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

  } else {
    data.category = document.getElementById('f-category')?.value;
    data.account  = document.getElementById('f-account')?.value;
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

  if (editingTxId) {
    DB.updateTransaction(editingTxId, data);
    showToast('✅ Transacción actualizada');
  } else {
    DB.addTransaction(data);
    showToast('✅ Transacción guardada');
  }

  navigate('journal');
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
  } else if (tx.type === 'liability') {
    const status = tx.liabilityStatus === 'paid' ? '✅ Pagada' : '🔴 Pendiente';
    mainDetail = `
      ${tx.creditor ? `<div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Acreedor</span><span style="font-weight:600;">${tx.creditor}</span></div>` : ''}
      <div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Estado</span><span style="font-weight:600;">${status}</span></div>
    `;
  } else {
    const acc = DB.getAccountById(tx.account);
    mainDetail = `
      ${cat ? `<div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Categoría</span><span style="font-weight:600;">${cat.emoji} ${cat.name}</span></div>` : ''}
      ${acc ? `<div style="display:flex; justify-content:space-between;"><span style="color:var(--gray-500); font-size:14px;">Cuenta</span><span style="font-weight:600;">${acc.emoji} ${acc.name}</span></div>` : ''}
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
    </div>
    <div style="display:flex; gap:10px; margin-top:24px;">
      <button class="btn btn-secondary btn-block" onclick="closeDetail(); navigate('form', {id:'${tx.id}'})">✏️ Editar</button>
      <button class="btn btn-danger btn-block" onclick="closeDetail(); setTimeout(()=>{ DB.deleteTransaction('${tx.id}'); showToast('🗑️ Eliminada'); renderJournal(); }, 100)">🗑️ Eliminar</button>
    </div>
  `;
  document.getElementById('detail-overlay').classList.add('open');
}

function closeDetail() { document.getElementById('detail-overlay').classList.remove('open'); }

// ── Reportes ───────────────────────────────────────────────────────────────────
function renderReports() {
  const pnl  = DB.getProfitStatement(reportYear, reportMonth);
  const txs  = DB.getTransactionsByMonth(reportYear, reportMonth);
  const s    = DB.getSettings();
  const monthLabel = new Date(reportYear, reportMonth - 1, 1)
    .toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  document.getElementById('report-month-name').textContent = monthLabel;

  // ── Estado de Resultados (P&L) ────────────────────────────
  _renderPnL(pnl);

  // ── Deudas del mes ────────────────────────────────────────
  const liabilities = txs.filter(t => t.type === 'liability');
  const liabEl = document.getElementById('report-liabilities-section');
  if (liabilities.length) {
    const totalLiab = liabilities.reduce((s, t) => s + t.amount, 0);
    liabEl.style.display = 'block';
    document.getElementById('report-liabilities-total').textContent = fmt(totalLiab);
  } else {
    liabEl.style.display = 'none';
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
          <div class="category-breakdown-item">
            <div style="font-size:22px;">${cat ? cat.emoji : '📝'}</div>
            <div class="cat-bar-wrap">
              <div class="cat-bar-label">
                <span style="font-weight:600;">${cat ? cat.name : 'Otros'}</span>
                <span style="color:var(--danger); font-weight:700;">-${fmt(total)}</span>
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

        const typeColors = { income:'#16a34a', expense:'#dc2626', transfer:'#2563eb', liability:'#d97706', CMV:'#7c3aed' };
        const rowBg = t.isCogs ? 'background:#faf5ff;' : '';
        return `<tr style="${rowBg}">
          <td>${fmtDate(t.date)}</td>
          <td>${t.description}${t.isCogs ? ' <em style="color:#9ca3af;font-size:11px;">(auto)</em>' : ''}</td>
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

  // ── Presupuesto ───────────────────────────────────────────
  renderBudgetStatus();

  // ── Gráficas interactivas ─────────────────────────────────
  renderCharts();
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
  showToast('📄 Preparando PDF...');
  setTimeout(() => window.print(), 400);
}

// ── Inventario ─────────────────────────────────────────────────────────────────
function renderInventory() {
  const products = DB.getInventory();
  const container = document.getElementById('inventory-list');

  if (!products.length) {
    container.innerHTML = emptyHTML('📦', 'Sin productos', 'Agrega tu primer producto con el botón +');
    return;
  }

  container.innerHTML = products.map(p => `
    <div class="card inv-card" style="margin-bottom:10px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="font-size:36px; width:48px; text-align:center;">${p.emoji || '📦'}</div>
        <div style="flex:1;">
          <div style="font-size:16px; font-weight:700;">${p.name}</div>
          <div style="font-size:13px; color:var(--gray-500); margin-top:2px;">
            ${p.unitCost ? 'Costo: ' + fmt(p.unitCost) + ' / ' + p.unit : p.unit}
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:24px; font-weight:800; color:${p.quantity <= 5 ? 'var(--danger)' : p.quantity <= 15 ? 'var(--warning)' : 'var(--success)'};">${p.quantity}</div>
          <div style="font-size:11px; color:var(--gray-500);">${p.unit}</div>
        </div>
      </div>
      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="openProductForm('${p.id}')">✏️ Editar</button>
        <button class="btn btn-outline btn-sm" onclick="adjustStock('${p.id}')">📥 Ajustar stock</button>
        <button class="btn btn-icon" style="background:var(--danger-light); color:var(--danger);" onclick="deleteProduct('${p.id}')">🗑️</button>
      </div>
    </div>
  `).join('');

  // Total valor inventario
  const totalValue = products.reduce((s, p) => s + (p.quantity * (p.unitCost || 0)), 0);
  document.getElementById('inv-total-value').textContent = fmt(totalValue);
  document.getElementById('inv-total-items').textContent = products.length + ' producto' + (products.length !== 1 ? 's' : '');
}

function openProductForm(editId = null) {
  const p = editId ? DB.getProductById(editId) : null;
  const EMOJIS = ['📦','👗','👕','👖','👟','👔','👜','🧴','💄','🍕','🧃','📱','🔧','📚','🪑','🖥️'];

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
      <input type="text" class="form-control" id="p-name" value="${p?.name || ''}" placeholder="Ej: Blusas, Zapatos, Shampoo">
    </div>
    <div class="form-group">
      <label class="form-label">Stock actual</label>
      <input type="number" class="form-control" id="p-qty" value="${p?.quantity ?? 0}" min="0" step="1">
    </div>
    <div class="form-group">
      <label class="form-label">Costo unitario (opcional)</label>
      <input type="number" class="form-control" id="p-cost" value="${p?.unitCost || ''}" min="0" step="any" placeholder="0">
    </div>
    <div class="form-group">
      <label class="form-label">Unidad de medida</label>
      <select class="form-control" id="p-unit">
        ${['unidades','pares','metros','litros','kilos','cajas','docenas'].map(u => `<option ${(p?.unit||'unidades')===u?'selected':''}>${u}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-primary btn-block mt-16" onclick="saveProduct('${editId || ''}')">
      ${p ? '✅ Actualizar' : '✅ Agregar Producto'}
    </button>
    ${p ? `<button class="btn btn-danger btn-block mt-8" onclick="deleteProduct('${p.id}')">🗑️ Eliminar producto</button>` : ''}
  `;
  sheet.classList.add('open');
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
  const data = {
    name,
    emoji:    document.getElementById('p-emoji')?.value || '📦',
    quantity: parseFloat(document.getElementById('p-qty')?.value) || 0,
    unitCost: parseFloat(document.getElementById('p-cost')?.value) || 0,
    unit:     document.getElementById('p-unit')?.value || 'unidades',
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

  if (iNombre < 0) { showToast('❌ No se encontró columna "Producto" o "Nombre"'); return; }

  let added = 0, updated = 0, skipped = 0;
  const errors = [];

  rows.slice(1).forEach((row, idx) => {
    const lineNum = idx + 2;
    const nombre   = String(row[iNombre] ?? '').trim();
    const cantStr  = iCantidad >= 0 ? row[iCantidad] : 0;
    const costoStr = iCosto    >= 0 ? row[iCosto]    : 0;

    if (!nombre) return; // fila vacía — silencioso

    const cantidad = parseFloat(cantStr);
    const costo    = parseFloat(costoStr);

    if (iCantidad >= 0 && isNaN(cantidad)) {
      errors.push(`Fila ${lineNum}: cantidad inválida ("${cantStr}")`); skipped++; return;
    }
    if (iCosto >= 0 && isNaN(costo)) {
      errors.push(`Fila ${lineNum}: costo inválido ("${costoStr}")`); skipped++; return;
    }

    const existente = DB.getInventory().find(
      p => p.name.toLowerCase() === nombre.toLowerCase()
    );

    if (existente) {
      // Suma cantidad, actualiza costo si se indicó
      const newQty  = (existente.quantity || 0) + (isNaN(cantidad) ? 0 : cantidad);
      const newCost = (!isNaN(costo) && costo > 0) ? costo : existente.unitCost;
      DB.updateProduct(existente.id, { quantity: newQty, unitCost: newCost });
      updated++;
    } else {
      DB.addProduct({
        name:     nombre,
        quantity: isNaN(cantidad) ? 0 : cantidad,
        unitCost: isNaN(costo)    ? 0 : costo,
        emoji:    '📦',
        unit:     'unidades',
      });
      added++;
    }
  });

  renderInventory();
  const msg = `✅ ${added} agregados · ${updated} actualizados${skipped ? ` · ${skipped} omitidos` : ''}`;
  showToast(msg, 4000);
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

    <div style="background:var(--primary-light);border-radius:10px;padding:14px;margin-bottom:16px;font-size:13px;color:var(--primary);line-height:1.6;">
      <strong>Formato requerido del archivo Excel:</strong><br><br>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr style="background:var(--primary);color:white;">
          <th style="padding:6px 10px;text-align:left;border-radius:4px 0 0 0;">Producto</th>
          <th style="padding:6px 10px;text-align:left;">Cantidad</th>
          <th style="padding:6px 10px;text-align:left;border-radius:0 4px 0 0;">Costo</th>
        </tr>
        <tr style="background:white;">
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">Blusas</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">10</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">25000</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:6px 10px;">Jeans</td>
          <td style="padding:6px 10px;">5</td>
          <td style="padding:6px 10px;">50000</td>
        </tr>
      </table>
    </div>

    <div style="font-size:13px;color:var(--gray-600);margin-bottom:16px;line-height:1.6;">
      • Si el producto <strong>ya existe</strong>, la cantidad se <strong>suma</strong> al stock actual.<br>
      • Si es <strong>nuevo</strong>, se crea automáticamente.<br>
      • Las filas vacías se ignoran.
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
    ['Producto', 'Cantidad', 'Costo'],
    ['Blusas',   10,         25000],
    ['Jeans',    5,          50000],
    ['Zapatos',  8,          80000],
  ]);
  ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 14 }];
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
  const r = DB.getRecurringById(id);
  if (!r) return;
  if (!confirm(`¿Eliminar "${r.name}"?\n\nLas transacciones históricas ya generadas NO se borrarán.`)) return;
  DB.deleteRecurring(id);
  openRecurringManager();
  showToast('🗑️ Gasto recurrente eliminado');
}

// Renderiza el bloque de "Próximos pagos" del dashboard
function renderUpcomingRecurrings() {
  const el = document.getElementById('dash-upcoming');
  if (!el) return;
  const actives = DB.getRecurrings().filter(r => r.isActive);
  if (!actives.length) { el.style.display = 'none'; return; }

  // Ordenar por próxima ejecución
  const sorted = actives
    .map(r => ({ r, next: DB.getNextExecution(r) }))
    .sort((a, b) => a.next - b.next)
    .slice(0, 4);

  const now   = new Date();
  const items = sorted.map(({ r, next }) => {
    const cat    = DB.getCategoryById(r.category);
    const daysTo = Math.ceil((next - now) / 86400000);
    const label  = daysTo <= 0 ? '<span style="color:var(--danger);font-weight:700;">Hoy</span>'
                 : daysTo === 1 ? '<span style="color:var(--warning);font-weight:600;">Mañana</span>'
                 : `<span style="color:var(--gray-500);">en ${daysTo} días</span>`;
    return `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--gray-100);">
        <div style="font-size:20px;">${cat ? cat.emoji : '💸'}</div>
        <div style="flex:1;">
          <div style="font-size:14px; font-weight:600;">${r.name}</div>
          <div style="font-size:12px;">${label} · día ${r.dayOfMonth}</div>
        </div>
        <div style="font-size:14px; font-weight:700; color:var(--danger);">${fmt(r.amount)}</div>
      </div>
    `;
  }).join('');

  const totalMensual = actives.reduce((s, r) => s + r.amount, 0);

  el.style.display = 'block';
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header" style="margin-bottom:4px;">
        <div class="card-title">🔄 Gastos Automáticos</div>
        <button style="font-size:13px; color:var(--primary); font-weight:600; background:none;" onclick="openRecurringManager(); document.getElementById('settings-sheet').classList.add('open');">Gestionar →</button>
      </div>
      <div style="font-size:12px; color:var(--gray-400); margin-bottom:10px;">Total fijo: ${fmt(totalMensual)}/mes</div>
      ${items}
    </div>
  `;
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

function exportAnnualExcel() {
  if (typeof XLSX === 'undefined') { showToast('⚠️ Necesitas internet para cargar el módulo Excel', 4000); return; }

  const s = DB.getSettings();
  const rows = [
    [s.companyName + ' — Resumen Anual ' + annualYear],
    [],
    ['Mes', 'Ingresos', 'Gastos Operativos', 'CMV', 'Gastos Total', 'Utilidad Neta'],
  ];

  let totIncome = 0, totExp = 0, totNet = 0;
  Array.from({ length: 12 }, (_, i) => {
    const stats = DB.getMonthStats(annualYear, i + 1);
    const exp   = stats.opExpenses + stats.cogs;
    totIncome += stats.income; totExp += exp; totNet += stats.netProfit;
    rows.push([MONTH_NAMES[i], stats.income, stats.opExpenses, stats.cogs, exp, stats.netProfit]);
  });
  rows.push([]);
  rows.push(['TOTAL', totIncome, '', '', totExp, totNet]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Resumen Anual ' + annualYear);
  XLSX.writeFile(wb, `ContaFacil_Anual_${annualYear}_${s.companyName.replace(/\s+/g, '-')}.xlsx`);
  showToast('📥 Resumen anual ' + annualYear + ' descargado', 3000);
}

// ── Exportar a Excel ──────────────────────────────────────────────────────────
function exportToExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('⚠️ Necesitas internet una vez para cargar el módulo Excel', 4000);
    return;
  }

  const s         = DB.getSettings();
  const txs       = DB.getTransactionsByMonth(reportYear, reportMonth);
  const pnl       = DB.getProfitStatement(reportYear, reportMonth);
  const monthLabel = new Date(reportYear, reportMonth - 1, 1)
    .toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  const TYPE_LABELS = { income:'Ingreso', expense:'Gasto', transfer:'Traslado', liability:'Deuda' };

  // ── Hoja 1: Transacciones detalladas ─────────────────────
  const txRows = [
    ['Fecha', 'Descripción', 'Tipo', 'Categoría', 'Cuenta', 'Monto', 'Debe (+)', 'Haber (−)', 'Notas'],
  ];

  txs.forEach(t => {
    const cat     = DB.getCategoryById(t.category);
    const acc     = DB.getAccountById(t.account);
    const fromAcc = DB.getAccountById(t.fromAccount);
    const toAcc   = DB.getAccountById(t.toAccount);
    let debit = '', credit = '', catLabel = '', accLabel = '';

    if (t.isCogs) {
      credit = t.amount; catLabel = 'Costo de Ventas (CMV)';
    } else if (t.type === 'income') {
      debit  = t.amount;
      catLabel = cat ? cat.name : 'Ingresos';
      accLabel = acc ? acc.name : '';
    } else if (t.type === 'expense') {
      credit = t.amount;
      catLabel = cat ? cat.name : 'Gastos';
      accLabel = acc ? acc.name : '';
    } else if (t.type === 'transfer') {
      debit = t.amount; credit = t.amount;
      catLabel = (fromAcc?.name || '—') + ' → ' + (toAcc?.name || '—');
    } else if (t.type === 'liability') {
      credit = t.amount;
      catLabel = t.creditor || (cat ? cat.name : 'Cuentas por pagar');
    }

    txRows.push([
      t.date,
      t.description + (t.isCogs ? ' (auto-CMV)' : ''),
      t.isCogs ? 'CMV' : (TYPE_LABELS[t.type] || t.type),
      catLabel,
      accLabel,
      t.amount,
      debit,
      credit,
      t.notes || '',
    ]);
  });

  // ── Hoja 2: Estado de Resultados ─────────────────────────
  const pnlRows = [
    ['ContaFácil Pro — ' + s.companyName],
    ['Estado de Resultados · ' + monthLabel],
    [],
    ['INGRESOS', ''],
  ];
  if (pnl.salesRevenue > 0)  pnlRows.push(['  Ventas de productos',  pnl.salesRevenue]);
  if (pnl.serviceIncome > 0) pnlRows.push(['  Servicios / otros',     pnl.serviceIncome]);
  pnlRows.push(['TOTAL INGRESOS', pnl.totalRevenue]);
  if (pnl.hasCogs) {
    pnlRows.push([]);
    pnlRows.push(['COSTO MERCADERÍA VENDIDA (CMV)', -pnl.cogs]);
  }
  pnlRows.push([]);
  pnlRows.push(['UTILIDAD BRUTA', pnl.grossProfit]);
  pnlRows.push([]);
  pnlRows.push(['GASTOS OPERATIVOS', '']);
  Object.entries(pnl.expByCat).forEach(([catId, val]) => {
    const cat = DB.getCategoryById(catId);
    pnlRows.push(['  ' + (cat ? cat.name : 'Otros'), -val]);
  });
  pnlRows.push(['TOTAL GASTOS', -pnl.opExpenses]);
  pnlRows.push([]);
  pnlRows.push(['UTILIDAD NETA', pnl.netProfit]);

  // ── Crear libro Excel ─────────────────────────────────────
  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet(txRows);
  ws1['!cols'] = [
    { wch: 12 }, { wch: 32 }, { wch: 10 }, { wch: 22 },
    { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'Transacciones');

  const ws2 = XLSX.utils.aoa_to_sheet(pnlRows);
  ws2['!cols'] = [{ wch: 34 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Estado de Resultados');

  const filename = `ContaFacil_${s.companyName.replace(/\s+/g,'-')}_${reportYear}-${String(reportMonth).padStart(2,'0')}.xlsx`;
  XLSX.writeFile(wb, filename);
  showToast('📥 Excel descargado: ' + filename, 3500);
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
function renderCarteraAlert() {
  const el = document.getElementById('dash-cartera-alert');
  if (!el) return;
  const stats = DB.getReceivableStats();
  if (!stats.overdueCount && !stats.pendingCount) { el.style.display = 'none'; return; }

  const { d30, d60, d90, d90plus } = stats.aging;
  const totalVencida = d30 + d60 + d90 + d90plus;

  if (totalVencida > 0) {
    el.style.cssText = `display:flex;background:#fee2e2;border:1.5px solid #fca5a5;border-radius:var(--radius);padding:12px 14px;gap:10px;align-items:center;margin-bottom:12px;color:#991b1b;`;
    el.innerHTML = `
      <span style="font-size:20px;">🧾</span>
      <div style="flex:1;">
        <div style="font-weight:700;font-size:14px;">${stats.overdueCount} cuenta(s) por cobrar vencida(s)</div>
        <div style="font-size:12px;opacity:.8;margin-top:2px;">Cartera vencida: ${fmt(totalVencida)}</div>
      </div>
      <button onclick="navigate('cartera')" style="font-size:12px;font-weight:700;background:none;color:inherit;white-space:nowrap;">Ver →</button>
    `;
  } else if (stats.pendingCount > 0) {
    el.style.cssText = `display:flex;background:#e0f2fe;border:1.5px solid #7dd3fc;border-radius:var(--radius);padding:12px 14px;gap:10px;align-items:center;margin-bottom:12px;color:#0c4a6e;`;
    el.innerHTML = `
      <span style="font-size:20px;">🧾</span>
      <div style="flex:1;">
        <div style="font-weight:700;font-size:14px;">${stats.pendingCount} cobro(s) por recibir</div>
        <div style="font-size:12px;opacity:.8;margin-top:2px;">Pendiente: ${fmt(stats.totalPendiente)}</div>
      </div>
      <button onclick="navigate('cartera')" style="font-size:12px;font-weight:700;background:none;color:inherit;white-space:nowrap;">Ver →</button>
    `;
  } else {
    el.style.display = 'none';
  }
}

// Placeholders IVA y Facturación
function openIvaPlaceholder() {
  document.getElementById('settings-sheet-content').innerHTML = `
    <div class="sheet-handle"></div>
    <div style="text-align:center;padding:24px 0 16px;">
      <div style="font-size:56px;margin-bottom:12px;">🏛️</div>
      <h2 style="font-size:20px;font-weight:800;color:#0891b2;margin-bottom:8px;">IVA · SRI Ecuador</h2>
      <p style="font-size:14px;color:var(--gray-500);line-height:1.6;">Próximamente podrás calcular y liquidar el IVA 15% según normativa SRI Ecuador.</p>
    </div>
    <div style="background:#e0f2fe;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;color:#0c4a6e;margin-bottom:10px;">🗺️ Multi-país (próximamente)</div>
      <div style="font-size:13px;color:#0c4a6e;line-height:1.7;">
        🇪🇨 Ecuador — IVA 15% (SRI)<br>
        🇨🇴 Colombia — IVA 19% (DIAN)<br>
        🇲🇽 México — IVA 16% (SAT)<br>
        🇵🇪 Perú — IGV 18% (SUNAT)
      </div>
    </div>
    <div style="background:var(--gray-50);border-radius:12px;padding:14px;margin-bottom:20px;font-size:13px;color:var(--gray-600);line-height:1.6;">
      Selecciona tu país de origen para aplicar automáticamente las tasas de IVA correctas en tus ventas y reportes.
    </div>
    <button class="btn btn-secondary btn-block" onclick="closeSettingsSheet()">Entendido</button>
  `;
  document.getElementById('settings-sheet').classList.add('open');
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

// ── Settings ───────────────────────────────────────────────────────────────────
function renderSettings() {
  const s = DB.getSettings();
  document.getElementById('settings-company-val').textContent  = s.companyName;
  document.getElementById('settings-currency-val').textContent = s.currency;

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

function closeSettingsSheet() { document.getElementById('settings-sheet').classList.remove('open'); }

// ── Export / Import ────────────────────────────────────────────────────────────
function exportData() {
  const blob = new Blob([DB.exportData()], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `contafacil-backup-${today()}.json` });
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ Datos exportados');
}

function importData(input) {
  const reader = new FileReader();
  reader.onload = e => {
    try { DB.importData(e.target.result); closeSettingsSheet(); navigate('dashboard'); showToast('✅ Datos importados'); }
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
});
