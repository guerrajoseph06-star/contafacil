/**
 * ContaFácil Pro — Data Layer v3.0
 * Principios NIIF PYMES / Contabilidad básica:
 *   income    → Ingreso (afecta P&L positivo)
 *   expense   → Gasto operativo (afecta P&L negativo)
 *              Si isCogs=true → Costo de Mercadería Vendida (CMV), se crea automáticamente
 *   transfer  → Traslado interno (NO afecta P&L)
 *   liability → Deuda/Pasivo (NO afecta P&L hasta que se pague)
 *
 * Fórmulas:
 *   Utilidad Bruta = Ventas – CMV
 *   Utilidad Neta  = Utilidad Bruta – Gastos Operativos
 */

const DB = (() => {
  const KEYS = {
    transactions: 'cf_transactions',
    settings:     'cf_settings',
    categories:   'cf_categories',
    accounts:     'cf_accounts',
    inventory:    'cf_inventory',
    recurring:    'cf_recurring',
    budgets:      'cf_budgets',
    receivables:  'cf_receivables',
    fixedAssets:  'cf_fixed_assets',
    onboarded:    'cf_onboarded',
    auditLog:     'cf_audit_log',
    templates:    'cf_templates',
  };

  // ── Claves globales (no pertenecen a ninguna empresa) ─────────────────────────
  const GKEYS = { companies: 'cf_companies', active: 'cf_active_co' };
  const loadG = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const saveG = (key, val) => localStorage.setItem(key, JSON.stringify(val));

  // _prefix se inicializa en init() con el ID de la empresa activa ('coXXX_')
  let _prefix = '';
  const load = key => { try { return JSON.parse(localStorage.getItem(_prefix + key)); } catch { return null; } };
  const save = (key, val) => localStorage.setItem(_prefix + key, JSON.stringify(val));

  function uuid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ── Log de auditoría ─────────────────────────────────────────────────────────
  // Registra quién hizo qué y cuándo. Máx. 500 entradas (FIFO).
  function _logAudit(action, detail) {
    const s   = getSettings();
    const log = load(KEYS.auditLog) || [];
    log.unshift({ id: uuid(), ts: new Date().toISOString(), user: s.userName || 'Principal', action, detail });
    if (log.length > 500) log.length = 500;
    save(KEYS.auditLog, log);
  }

  function logAudit(action, detail) { _logAudit(action, detail); } // público (para app.js)

  function getAuditLog(limit = 100) {
    return (load(KEYS.auditLog) || []).slice(0, limit);
  }

  function clearAuditLog() { save(KEYS.auditLog, []); }

  // ── Categorías ────────────────────────────────────────────
  // c-cmv es de sistema: no aparece en selects del usuario, solo en entradas auto-COGS
  const DEFAULT_CATEGORIES = [
    // INGRESOS
    { id:'c-ventas',    name:'Ventas',              type:'income',    emoji:'🛒', color:'#16a34a' },
    { id:'c-servicios', name:'Servicios',            type:'income',    emoji:'💼', color:'#0ea5e9' },
    { id:'c-comision',  name:'Comisiones',           type:'income',    emoji:'🤝', color:'#8b5cf6' },
    { id:'c-interes',   name:'Intereses',            type:'income',    emoji:'📈', color:'#f59e0b' },
    { id:'c-otros-i',   name:'Otros ingresos',       type:'income',    emoji:'💰', color:'#a3e635' },
    // GASTOS OPERATIVOS
    { id:'c-compras',   name:'Compras / Mercancía',  type:'expense',   emoji:'📦', color:'#dc2626' },
    { id:'c-arriendo',  name:'Arriendo',             type:'expense',   emoji:'🏢', color:'#ea580c' },
    { id:'c-internet',  name:'Internet',             type:'expense',   emoji:'🌐', color:'#0891b2' },
    { id:'c-serv-bas',  name:'Servicios básicos',    type:'expense',   emoji:'💡', color:'#ca8a04' },
    { id:'c-salarios',  name:'Salarios',             type:'expense',   emoji:'👥', color:'#2563eb' },
    { id:'c-marketing', name:'Marketing',            type:'expense',   emoji:'📣', color:'#7c3aed' },
    { id:'c-transporte',name:'Transporte',           type:'expense',   emoji:'🚗', color:'#475569' },
    { id:'c-impuestos', name:'Impuestos',            type:'expense',   emoji:'🏛️', color:'#9f1239' },
    { id:'c-equipos',   name:'Equipos / Herramientas',type:'expense',  emoji:'🔧', color:'#78350f' },
    { id:'c-comida',    name:'Alimentación',         type:'expense',   emoji:'🍽️', color:'#65a30d' },
    { id:'c-tarjeta-cr', name:'Tarjeta de crédito',   type:'expense',   emoji:'💳', color:'#0284c7' },
    { id:'c-otros-e',   name:'Otros gastos',         type:'expense',   emoji:'📝', color:'#6b7280' },
    // PASIVOS / DEUDAS
    { id:'c-deuda-prov',name:'Deuda proveedor',      type:'liability', emoji:'🏭', color:'#b45309' },
    { id:'c-deuda-serv',name:'Deuda servicios',      type:'liability', emoji:'📋', color:'#7c3aed' },
    { id:'c-prestamo',  name:'Préstamo bancario',    type:'liability', emoji:'🏦', color:'#dc2626' },
    { id:'c-otros-l',   name:'Otras deudas',         type:'liability', emoji:'🔴', color:'#6b7280' },
    // SISTEMA — Costo de Mercadería Vendida (auto-generado, no visible para el usuario)
    { id:'c-cmv', name:'Costo de Ventas (CMV)', type:'expense', emoji:'📦', color:'#7c3aed', isSystem:true },
    // SISTEMA — IVA (asientos auto-generados, no visibles en los selectores)
    { id:'c-iva-ventas',  name:'IVA en Ventas (por pagar al SRI)',     type:'liability', emoji:'🧾', color:'#dc2626', isSystem:true },
    { id:'c-iva-compras', name:'IVA en Compras (crédito tributario)',  type:'expense',   emoji:'🧾', color:'#0891b2', isSystem:true },
  ];

  const DEFAULT_ACCOUNTS = [
    { id:'a-caja',    name:'Caja (Efectivo)',   emoji:'💵', color:'#16a34a' },
    { id:'a-banco',   name:'Cuenta Bancaria',   emoji:'🏦', color:'#2563eb' },
    { id:'a-tarjeta', name:'Tarjeta',           emoji:'💳', color:'#7c3aed' },
    { id:'a-digital', name:'Billetera Digital', emoji:'📱', color:'#0891b2' },
  ];

  const DEFAULT_SETTINGS = {
    companyName: 'Mi Negocio', ownerName: '',
    currency: 'COP', currencySymbol: '$',
    userName: 'Principal',   // nombre del usuario activo en este dispositivo
    users:    ['Principal'], // lista de todos los usuarios conocidos
  };

  // ── Init / Migración ───────────────────────────────────────────────────────
  function init() {
    // ── 1. Multi-empresa: seleccionar o crear empresa activa ────────────────────
    let companies = loadG(GKEYS.companies);

    if (!companies || companies.length === 0) {
      // Primera vez con multi-empresa: crear empresa por defecto y migrar datos
      const defId = 'co' + Date.now().toString(36);
      companies   = [{ id: defId, name: 'Mi Empresa', createdAt: new Date().toISOString() }];
      saveG(GKEYS.companies, companies);
      saveG(GKEYS.active, defId);
      _prefix = defId + '_';

      // Migrar datos existentes (sin prefijo) al nuevo espacio de empresa
      const knownKeys = [
        'cf_transactions','cf_settings','cf_categories','cf_accounts',
        'cf_inventory','cf_recurring','cf_budgets','cf_receivables',
        'cf_fixed_assets','cf_onboarded','cf_audit_log','cf_security',
      ];
      knownKeys.forEach(k => {
        const v = localStorage.getItem(k);
        if (v !== null) { localStorage.setItem(_prefix + k, v); localStorage.removeItem(k); }
      });
    } else {
      let activeId = loadG(GKEYS.active);
      if (!activeId || !companies.find(c => c.id === activeId)) {
        activeId = companies[0].id;
        saveG(GKEYS.active, activeId);
      }
      _prefix = activeId + '_';
    }

    // ── 2. Inicializar datos por defecto si la empresa es nueva ─────────────────
    if (!load(KEYS.categories))   save(KEYS.categories,   DEFAULT_CATEGORIES);
    if (!load(KEYS.accounts))     save(KEYS.accounts,     DEFAULT_ACCOUNTS);
    if (!load(KEYS.settings))     save(KEYS.settings,     DEFAULT_SETTINGS);
    if (!load(KEYS.transactions)) save(KEYS.transactions, []);
    if (!load(KEYS.inventory))    save(KEYS.inventory,    []);
    _migrateCategorias();
    _migrateUserNames();
    _migrateIvaTypes();
    _repairOwnerState();
  }

  // ── Reparación automática de estado de propietario ───────────────────────────
  // Detecta y corrige situaciones donde:
  //   (A) settings.userName no existe en users[]  → renombrado sin actualizar array
  //   (B) usuario activo es no-propietario con allowedScreens restringido que
  //       bloquea pantallas básicas (journal, inventory) Y el propietario no tiene PIN
  //       → el sistema cambió al nuevo usuario tras asignar PIN (bug antiguo)
  //
  // SEGURO: en caso B solo actúa si el propietario no tiene PIN (sin verificación
  // extra). Si el propietario tiene PIN, la reparación manual se hace desde Settings.
  function _repairOwnerState() {
    const raw = load(KEYS.settings);
    if (!raw) return; // empresa nueva, nada que reparar

    const users = Array.isArray(raw.users) ? raw.users : [];
    if (users.length === 0) return; // aún no hay estructura de usuarios

    const currentName  = raw.userName || 'Principal';
    const currentEntry = users.find(u => u.name === currentName);

    // ── Caso A: nombre activo no existe en users[] ───────────────────────────
    if (!currentEntry) {
      const owner = users.find(u => u.isOwner) || users[0];
      if (owner) save(KEYS.settings, { ...raw, userName: owner.name });
      return;
    }

    // Caso B eliminado: los bugs 1-3 que causaban estados corruptos ya están
    // corregidos. Mantener Caso B interfería con la gestión legítima de permisos:
    // si el dueño restringía journal o inventory, _repairOwnerState los expulsaba
    // al propietario en cada carga, haciendo imposible mantener restricciones.
  }

  // Estampa userName en transacciones y CxC que no lo tengan (migración al activar multi-usuario)
  function _migrateUserNames() {
    const s           = getSettings();
    const defaultName = s.userName || 'Principal';

    let txs     = load(KEYS.transactions) || [];
    let changed = false;
    txs = txs.map(t => { if (!t.userName) { changed = true; return { ...t, userName: defaultName }; } return t; });
    if (changed) save(KEYS.transactions, txs);

    let recs        = load(KEYS.receivables) || [];
    let changedRecs = false;
    recs = recs.map(r => { if (!r.userName) { changedRecs = true; return { ...r, userName: defaultName }; } return r; });
    if (changedRecs) save(KEYS.receivables, recs);
  }

  function _migrateCategorias() {
    const existing = load(KEYS.categories) || [];
    const existingIds = new Set(existing.map(c => c.id));
    const missing = DEFAULT_CATEGORIES.filter(c => !existingIds.has(c.id));
    if (missing.length) save(KEYS.categories, [...existing, ...missing]);
  }

  // Migración: los asientos de IVA antes eran type 'liability'; ahora cuentan
  // como dinero real (income/expense) para que el saldo cuadre con la utilidad.
  function _migrateIvaTypes() {
    const txs = load(KEYS.transactions);
    if (!Array.isArray(txs)) return;
    let changed = false;
    const fixed = txs.map(t => {
      if (t.isIva && t.type === 'liability') {
        changed = true;
        const { liabilityStatus, ...rest } = t;
        return { ...rest, type: t.ivaDirection === 'cobrado' ? 'income' : 'expense' };
      }
      return t;
    });
    if (changed) save(KEYS.transactions, fixed);
  }

  // ── F1: compra capitalizada a inventario ───────────────────────────────────
  // Una compra que repone inventario NO es gasto del P&L: es convertir efectivo en
  // un activo (inventario). El gasto se reconoce solo vía CMV al vender.
  // inventoryAsset es una MARCA CONTABLE DERIVADA (no un subsistema): se usa para
  // excluir la compra de los cálculos de utilidad/gasto/presupuesto, conservando
  // su efecto en caja, IVA e inventario.
  function _isInventoryBuy(tx) {
    return tx.type === 'expense' && tx.affectsInventory && !!tx.productId && (parseFloat(tx.quantity) || 0) > 0;
  }

  // Actualiza el costo unitario del producto con el ÚLTIMO costo de compra.
  // Usa tx.amount, que tras _applyIvaToTransaction ya es la BASE sin IVA.
  // Modelo simple "último costo": sin promedio, FIFO/LIFO ni kardex.
  function _applyLastCost(tx) {
    if (!_isInventoryBuy(tx)) return;
    const qty  = parseFloat(tx.quantity) || 0;
    const base = parseFloat(tx.amount)   || 0; // ya es base sin IVA
    if (qty <= 0 || base <= 0) return;
    const unit = Math.round((base / qty) * 100) / 100;
    const inv  = getInventory();
    const idx  = inv.findIndex(p => p.id === tx.productId);
    if (idx < 0) return;
    inv[idx].unitCost = unit;
    save(KEYS.inventory, inv);
  }

  // ── COGS helper ────────────────────────────────────────────
  // Construye la entrada de CMV vinculada a una venta
  function _buildCogsEntry(saleTx, product) {
    if (!product || !(product.unitCost > 0)) return null;
    const qty     = parseFloat(saleTx.quantity) || 0;
    const cogsAmt = qty * product.unitCost;
    if (cogsAmt <= 0) return null;
    return {
      id:           uuid(),
      createdAt:    saleTx.createdAt,
      type:         'expense',
      isCogs:       true,
      linkedSaleId: saleTx.id,
      description:  'CMV · ' + product.name + ' × ' + qty,
      amount:       cogsAmt,
      date:         saleTx.date,
      category:     'c-cmv',
      account:      saleTx.account || '',
    };
  }

  // Detecta si una tx de ingreso debe generar CMV
  function _needsCogs(tx) {
    return tx.type === 'income' && tx.affectsInventory && tx.productId && tx.quantity;
  }

  // ── IVA helper ─────────────────────────────────────────────
  // Detecta si una transacción necesita generar un asiento de IVA
  function _needsIva(tx) {
    return (tx.type === 'income' || tx.type === 'expense')
      && !tx.isCogs && !tx.isIva
      && tx.ivaType && tx.ivaType !== 'SIN_IVA';
  }

  // Construye el asiento de IVA vinculado a una venta o compra.
  // El IVA cuenta como DINERO REAL (ingreso/gasto) para que el saldo siempre
  // cuadre con la utilidad. Su detalle tributario se ve en Reportes → IVA.
  //   Ventas  → IVA cobrado  → cuenta como ingreso
  //   Compras → IVA pagado   → cuenta como gasto
  function _buildIvaEntry(parentTx, ivaValue) {
    const isIncome = parentTx.type === 'income';
    return {
      id:             uuid(),
      createdAt:      parentTx.createdAt,
      userName:       parentTx.userName,
      type:           isIncome ? 'income' : 'expense',
      isIva:          true,
      ivaDirection:   isIncome ? 'cobrado' : 'credito',
      linkedParentId: parentTx.id,
      description:    'IVA ' + (parentTx.porcentajeIva || IVA_DEFAULT) + '% · ' + parentTx.description,
      amount:         ivaValue,
      date:           parentTx.date,
      account:        parentTx.account || '',
      category:       isIncome ? 'c-iva-ventas' : 'c-iva-compras',
    };
  }

  // Desglosa el IVA: ajusta el monto de la transacción a la BASE (sin IVA)
  // y agrega el asiento de IVA vinculado al array de transacciones.
  function _applyIvaToTransaction(tx, txs) {
    if (!_needsIva(tx)) return;
    const pct  = parseFloat(tx.porcentajeIva) || getSettings().porcentajeIva || IVA_DEFAULT;
    const calc = calcIva(tx.amount, tx.ivaType, pct);
    tx.porcentajeIva = pct;
    tx.ivaBase       = calc.precioBase;
    tx.ivaAmount     = calc.valorIva;
    tx.ivaTotal      = calc.precioFinal;
    tx.amount        = calc.precioBase; // la transacción principal guarda SOLO la base
    if (calc.valorIva > 0) {
      const ivaEntry = _buildIvaEntry(tx, calc.valorIva);
      tx.linkedIvaId = ivaEntry.id;
      txs.push(ivaEntry);
    }
  }

  // ── Transacciones ──────────────────────────────────────────
  function getTransactions() {
    return (load(KEYS.transactions) || []).sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function getTransactionsByMonth(year, month) {
    return getTransactions().filter(t => {
      const d = new Date(t.date + 'T12:00:00');
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    });
  }

  function getTransactionById(id) {
    return (load(KEYS.transactions) || []).find(t => t.id === id) || null;
  }

  function addTransaction(data) {
    const txs = load(KEYS.transactions) || [];
    const amount = parseFloat(data.amount);
    const s  = getSettings();
    const tx = { id: uuid(), createdAt: new Date().toISOString(), userName: s.userName || 'Principal', ...data, amount };

    // Auto-IVA: desglosa el IVA y crea el asiento vinculado (ajusta tx.amount a la base)
    _applyIvaToTransaction(tx, txs);

    // F1: compra que repone inventario → marca contable (no gasta P&L, solo CMV al vender)
    if (_isInventoryBuy(tx)) tx.inventoryAsset = true;

    // Auto-COGS: cuando es una venta con inventario
    if (_needsCogs(tx)) {
      const product = getProductById(tx.productId);
      const cogsTx  = _buildCogsEntry(tx, product);
      if (cogsTx) {
        tx.linkedCogsId = cogsTx.id;
        tx.cogsAmount   = cogsTx.amount;
        txs.push(cogsTx);  // primero el CMV
      }
    }

    txs.push(tx);
    save(KEYS.transactions, txs);
    _applyInventory(tx, 'add');
    _applyLastCost(tx); // último costo: alimenta product.unitCost (base sin IVA)
    _logAudit('create_tx', `${tx.type === 'income' ? '📈' : tx.type === 'expense' ? '📉' : '📋'} ${tx.description} · $${tx.amount}`);
    return tx;
  }

  function updateTransaction(id, newData) {
    let txs = load(KEYS.transactions) || [];
    const idx = txs.findIndex(t => t.id === id);
    if (idx < 0) return null;

    const old = txs[idx];
    _applyInventory(old, 'reverse');

    // Eliminar CMV e IVA anteriores vinculados
    if (old.linkedCogsId) {
      txs = txs.filter(t => t.id !== old.linkedCogsId);
    }
    if (old.linkedIvaId) {
      txs = txs.filter(t => t.id !== old.linkedIvaId);
    }

    // Construir la tx actualizada (sin los campos de COGS/IVA anteriores)
    const { linkedCogsId: _lc, cogsAmount: _ca,
            linkedIvaId: _li, ivaBase: _ib, ivaAmount: _ia, ivaTotal: _it, ...cleanOld } = old;
    const updated = { ...cleanOld, ...newData, amount: parseFloat(newData.amount), id };

    // Recalcular IVA si aplica (ajusta updated.amount a la base)
    _applyIvaToTransaction(updated, txs);

    // F1: re-evaluar la marca según el estado FINAL (si destildan inventario, se quita)
    if (_isInventoryBuy(updated)) updated.inventoryAsset = true;
    else                          delete updated.inventoryAsset;

    // Recalcular CMV si aplica
    if (_needsCogs(updated)) {
      const product = getProductById(updated.productId);
      const cogsTx  = _buildCogsEntry(updated, product);
      if (cogsTx) {
        updated.linkedCogsId = cogsTx.id;
        updated.cogsAmount   = cogsTx.amount;
        txs.push(cogsTx);
      }
    }

    // Reemplazar la tx original en el array (que puede haber cambiado por el filter)
    const newIdx = txs.findIndex(t => t.id === id);
    if (newIdx >= 0) txs[newIdx] = updated;
    else txs.push(updated);

    save(KEYS.transactions, txs);
    _applyInventory(updated, 'add');
    _applyLastCost(updated); // último costo (base sin IVA) si sigue siendo compra de inventario
    _logAudit('edit_tx', `✏️ ${updated.description} · $${updated.amount}`);
    return updated;
  }

  function deleteTransaction(id) {
    let txs = load(KEYS.transactions) || [];
    const tx = txs.find(t => t.id === id);
    if (!tx) return;

    _applyInventory(tx, 'reverse');

    const toDelete = new Set([id]);

    if (tx.linkedCogsId) {
      // Borrar también la entrada CMV vinculada
      toDelete.add(tx.linkedCogsId);
    }
    if (tx.linkedIvaId) {
      // Borrar también el asiento de IVA vinculado
      toDelete.add(tx.linkedIvaId);
    }
    if (tx.isCogs && tx.linkedSaleId) {
      // Si se borra el CMV directamente, limpiar el link en la venta
      txs = txs.map(t => {
        if (t.id === tx.linkedSaleId) {
          const { linkedCogsId, cogsAmount, ...rest } = t;
          return rest;
        }
        return t;
      });
    }
    if (tx.isIva && tx.linkedParentId) {
      // Si se borra el asiento de IVA directamente, limpiar el link en la transacción
      txs = txs.map(t => {
        if (t.id === tx.linkedParentId) {
          const { linkedIvaId, ivaBase, ivaAmount, ivaTotal, ...rest } = t;
          return rest;
        }
        return t;
      });
    }

    _logAudit('delete_tx', `🗑️ ${tx.description} · $${tx.amount}`);
    save(KEYS.transactions, txs.filter(t => !toDelete.has(t.id)));

    // Borrar la foto del comprobante asociada (si existe)
    if (tx.hasReceipt) deletePhoto(id);
    // Borrar memorandos de deducible vinculados (si era una factura)
    deleteDeduciblesByTx(id);
  }

  // ── Gastos personales deducibles (Impuesto a la Renta — Ecuador) ─────────────
  // Memorandos informativos: NO afectan caja, ingresos, gastos ni utilidad.
  // Solo se acumulan por año para la declaración de renta de personas naturales.
  function getDeducibles() { return load('cf_deducibles') || []; }

  function addDeducible(data) {
    const list = getDeducibles();
    const d = {
      id:          uuid(),
      createdAt:   new Date().toISOString(),
      userName:    getSettings().userName || 'Principal',
      date:        data.date,
      tipo:        data.tipo || 'alimentacion',
      amount:      parseFloat(data.amount) || 0,
      description: data.description || '',
      linkedTxId:  data.linkedTxId || null,
    };
    list.push(d);
    save('cf_deducibles', list);
    return d;
  }

  function deleteDeduciblesByTx(txId) {
    const list     = getDeducibles();
    const filtered = list.filter(d => d.linkedTxId !== txId);
    if (filtered.length !== list.length) save('cf_deducibles', filtered);
  }

  // Resumen de deducibles de un año: total + desglose por tipo
  function getDeducibleSummary(year) {
    const items = getDeducibles().filter(d => {
      const y = new Date((d.date || '') + 'T12:00:00').getFullYear();
      return y === year;
    });
    const byTipo = {};
    let total = 0;
    items.forEach(d => { byTipo[d.tipo] = (byTipo[d.tipo] || 0) + d.amount; total += d.amount; });
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { year, total, byTipo, items };
  }

  // ── Registrar factura de compra ──────────────────────────────────────────────
  // Genera de un solo golpe: el gasto (base sin IVA), el asiento de IVA crédito
  // tributario y, opcionalmente, el memorando de deducible. Maneja IVA mixto
  // (parte a 0% + parte a 15%, como las facturas de supermercado).
  function addFacturaCompra(data) {
    const txs  = load(KEYS.transactions) || [];
    const s    = getSettings();
    const t0   = parseFloat(data.tarifa0)  || 0;
    const t15  = parseFloat(data.tarifa15) || 0;
    const iva  = parseFloat(data.iva)      || 0;
    const base = t0 + t15;
    const pct  = parseFloat(data.porcentajeIva) || s.porcentajeIva || IVA_DEFAULT;

    const expenseTx = {
      id:          uuid(),
      createdAt:   new Date().toISOString(),
      userName:    s.userName || 'Principal',
      type:        'expense',
      description: data.concepto ||
                   (data.proveedor ? 'Compra · ' + data.proveedor : 'Factura de compra'),
      amount:      base,
      date:        data.date,
      account:     data.account  || '',
      category:    data.category || '',
      notes:       data.notes    || '',
      // Metadatos de la factura
      isFactura:       true,
      proveedor:       data.proveedor || '',
      facturaTarifa0:  t0,
      facturaTarifa15: t15,
      facturaIva:      iva,
      facturaTotal:    parseFloat(data.total) || (base + iva),
      formaPago:       data.formaPago || 'efectivo',
      hasReceipt:      !!data.hasReceipt,
    };

    // Asiento de IVA crédito tributario (solo si la factura tiene IVA)
    if (iva > 0) {
      expenseTx.porcentajeIva = pct;
      const ivaEntry = _buildIvaEntry(expenseTx, iva);
      expenseTx.linkedIvaId = ivaEntry.id;
      txs.push(ivaEntry);
    }
    txs.push(expenseTx);
    save(KEYS.transactions, txs);

    // Memorando de deducible (opcional) — NO afecta las finanzas
    if (data.deducible && parseFloat(data.deducible.amount) > 0) {
      addDeducible({
        date:        data.date,
        tipo:        data.deducible.tipo,
        amount:      data.deducible.amount,
        description: expenseTx.description,
        linkedTxId:  expenseTx.id,
      });
    }

    _logAudit('create_factura', `🧾 Factura ${data.proveedor || ''} · $${expenseTx.amount}`);
    return expenseTx;
  }

  function _applyInventory(tx, action) {
    if (!tx.affectsInventory || !tx.productId || !tx.quantity) return;
    const products = load(KEYS.inventory) || [];
    const idx = products.findIndex(p => p.id === tx.productId);
    if (idx < 0) return;
    const qty   = parseFloat(tx.quantity) || 0;
    const delta = tx.type === 'income' ? -qty : qty; // venta resta, compra suma
    const real  = action === 'add' ? delta : -delta;
    products[idx].quantity = Math.max(0, (products[idx].quantity || 0) + real);
    save(KEYS.inventory, products);
  }

  // ── Estadísticas simples (dashboard) ──────────────────────
  function getMonthStats(year, month) {
    const txs = getTransactionsByMonth(year, month);
    let income = 0, cogs = 0, opExpenses = 0, liabilities = 0;
    let ivaCobrado = 0, ivaCredito = 0;
    txs.forEach(t => {
      // El IVA se contabiliza también por separado para el reporte tributario,
      // pero SÍ cuenta como ingreso/gasto real (el saldo debe cuadrar).
      if (t.isIva) {
        if (t.ivaDirection === 'cobrado') ivaCobrado += t.amount;
        else                              ivaCredito += t.amount;
      }
      if (t.type === 'income')    income     += t.amount;
      if (t.type === 'expense')   t.isCogs ? (cogs += t.amount) : (!t.inventoryAsset && (opExpenses += t.amount)); // F1: compra de inventario no es gasto P&L
      if (t.type === 'liability') liabilities += t.amount;
    });
    const totalExpenses = cogs + opExpenses;
    return { income, cogs, opExpenses, totalExpenses, liabilities,
             ivaCobrado, ivaCredito, ivaPorPagar: ivaCobrado - ivaCredito,
             grossProfit: income - cogs, netProfit: income - cogs - opExpenses };
  }

  function getAllTimeBalance() {
    const txs = getTransactions();
    let income = 0, cogs = 0, opExpenses = 0, liabilities = 0;
    txs.forEach(t => {
      // El IVA cuenta como ingreso/gasto real (el saldo debe cuadrar con la utilidad)
      if (t.type === 'income')    income     += t.amount;
      if (t.type === 'expense')   t.isCogs ? (cogs += t.amount) : (!t.inventoryAsset && (opExpenses += t.amount)); // F1: compra de inventario no es gasto P&L
      if (t.type === 'liability') liabilities += t.amount;
    });
    return { income, cogs, opExpenses, liabilities,
             netProfit: income - cogs - opExpenses };
  }

  // ── Estado de Resultados (P&L completo) ───────────────────
  function getProfitStatement(year, month) {
    const txs = getTransactionsByMonth(year, month);

    let salesRevenue  = 0;  // ingresos con inventario (ventas de producto)
    let serviceIncome = 0;  // otros ingresos (servicios, comisiones, etc.)
    let cogs          = 0;  // CMV auto-generado
    let opExpenses    = 0;  // gastos operativos (sin CMV)
    let ivaCobrado    = 0;  // IVA cobrado en ventas (pasivo: por pagar al SRI)
    let ivaCredito    = 0;  // IVA pagado en compras (activo: crédito tributario)
    const expByCat    = {}; // desglose por categoría

    txs.forEach(t => {
      // El IVA se totaliza para el reporte tributario y además cuenta como
      // ingreso/gasto real (el saldo debe cuadrar con la utilidad).
      if (t.isIva) {
        if (t.ivaDirection === 'cobrado') ivaCobrado += t.amount;
        else                              ivaCredito += t.amount;
      }
      if (t.type === 'income') {
        if (t.affectsInventory) salesRevenue += t.amount;
        else                    serviceIncome += t.amount;
      }
      if (t.type === 'expense') {
        if (t.isCogs) {
          cogs += t.amount;
        } else if (!t.inventoryAsset) { // F1: la compra de inventario no es gasto operativo
          opExpenses += t.amount;
          const cat = t.category || 'otros';
          expByCat[cat] = (expByCat[cat] || 0) + t.amount;
        }
      }
    });

    const totalRevenue  = salesRevenue + serviceIncome;
    const grossProfit   = totalRevenue - cogs;
    const netProfit     = grossProfit - opExpenses;
    const grossMargin   = totalRevenue > 0 ? (grossProfit / totalRevenue * 100) : 0;
    const netMargin     = totalRevenue > 0 ? (netProfit   / totalRevenue * 100) : 0;
    const cogsMargin    = salesRevenue > 0 ? (cogs / salesRevenue * 100) : 0;

    return {
      salesRevenue, serviceIncome, totalRevenue,
      cogs, cogsMargin,
      grossProfit, grossMargin,
      opExpenses, expByCat,
      netProfit, netMargin,
      ivaCobrado, ivaCredito, ivaPorPagar: ivaCobrado - ivaCredito,
      hasCogs: cogs > 0,
      hasIva:  (ivaCobrado + ivaCredito) > 0,
    };
  }

  function getPendingLiabilities() {
    // Solo deudas reales. Los asientos de IVA ya no son type 'liability'.
    return getTransactions().filter(t =>
      t.type === 'liability' && t.liabilityStatus !== 'paid'
    );
  }

  // ── Capa tributaria interna (DESACOPLADA) ──────────────────
  // Las reglas tributarias viven en CÓDIGO, nunca en los datos del usuario.
  // Filosofía: ORIENTA, NO IMPONE. La metadata es sugestiva, jamás bloqueante.
  //   ivaSugerido       → 'CON_IVA' | 'SIN_IVA' | null  (pre-selección suave; null = neutral)
  //   avisoIva          → texto blando opcional (informativo, editable por el usuario)
  //   creditoRevisable  → si true, el borrador 104 SEÑALA (no excluye) su IVA para revisión
  // No se guarda nada: se deriva en tiempo de lectura. Cambiar esta tabla NO migra datos.
  const _DEFAULT_TAX_PROFILE = { taxProfile: 'OPERATIVO', ivaSugerido: null, avisoIva: '', creditoRevisable: false };
  const CATEGORY_TAX_PROFILES = {
    // INGRESOS
    'c-ventas':     { taxProfile: 'INGRESO_OPERATIVO', ivaSugerido: 'CON_IVA' },
    'c-servicios':  { taxProfile: 'INGRESO_OPERATIVO', ivaSugerido: 'CON_IVA' },
    'c-comision':   { taxProfile: 'INGRESO_OPERATIVO', ivaSugerido: 'CON_IVA' },
    'c-otros-i':    { taxProfile: 'INGRESO_OTRO',      ivaSugerido: null },     // neutral (puede ser gravado u ocasional)
    'c-interes':    { taxProfile: 'INGRESO_OTRO',      ivaSugerido: null },     // oculto (compatibilidad histórica)
    // GASTOS
    'c-compras':    { taxProfile: 'COGS',           ivaSugerido: 'CON_IVA' },
    'c-arriendo':   { taxProfile: 'OPERATIVO',      ivaSugerido: 'CON_IVA' },
    'c-internet':   { taxProfile: 'OPERATIVO',      ivaSugerido: 'CON_IVA' },
    'c-serv-bas':   { taxProfile: 'OPERATIVO',      ivaSugerido: 'CON_IVA' },
    'c-salarios':   { taxProfile: 'OPERATIVO',      ivaSugerido: 'SIN_IVA', avisoIva: 'Los sueldos normalmente no llevan IVA.' },
    'c-marketing':  { taxProfile: 'OPERATIVO',      ivaSugerido: 'CON_IVA' },
    'c-transporte': { taxProfile: 'OPERATIVO',      ivaSugerido: 'CON_IVA' },
    'c-impuestos':  { taxProfile: 'IMPUESTO',       ivaSugerido: 'SIN_IVA', avisoIva: 'Un impuesto no suele generar crédito de IVA.' },
    'c-equipos':    { taxProfile: 'OPERATIVO_CAPEX', ivaSugerido: 'CON_IVA', avisoIva: 'Este gasto podría registrarse como activo fijo en contabilidades avanzadas.' },
    'c-comida':     { taxProfile: 'PERSONAL_NO_DEDUCIBLE', ivaSugerido: 'CON_IVA', avisoIva: 'Si es consumo personal, su IVA podría no dar crédito. Revísalo con tu contador.', creditoRevisable: true },
    'c-tarjeta-cr': { taxProfile: 'FINANCIERO',     ivaSugerido: 'SIN_IVA' },   // oculto (es forma de pago, no categoría)
    'c-otros-e':    { taxProfile: 'OPERATIVO',      ivaSugerido: null },        // comodín neutral
    // PASIVOS / DEUDAS
    'c-deuda-prov': { taxProfile: 'PASIVO', ivaSugerido: 'SIN_IVA' },
    'c-deuda-serv': { taxProfile: 'PASIVO', ivaSugerido: 'SIN_IVA' },
    'c-prestamo':   { taxProfile: 'PASIVO', ivaSugerido: 'SIN_IVA' },
    'c-otros-l':    { taxProfile: 'PASIVO', ivaSugerido: 'SIN_IVA' },
  };

  // Categorías que se OCULTAN del selector pero siguen siendo resolubles por id
  // (para no romper transacciones históricas que las usaron).
  const HIDDEN_CATEGORY_IDS = new Set(['c-interes', 'c-tarjeta-cr']);

  // Devuelve el perfil tributario de una categoría. Con fallback por tipo para
  // categorías personalizadas o futuras (jamás devuelve null).
  function getCategoryTaxProfile(id) {
    if (CATEGORY_TAX_PROFILES[id]) return { ..._DEFAULT_TAX_PROFILE, ...CATEGORY_TAX_PROFILES[id] };
    const cat  = getCategoryById(id);
    const type = cat && cat.type;
    if (type === 'income')    return { ..._DEFAULT_TAX_PROFILE, taxProfile: 'INGRESO_OTRO' };
    if (type === 'liability') return { ..._DEFAULT_TAX_PROFILE, taxProfile: 'PASIVO', ivaSugerido: 'SIN_IVA' };
    return { ..._DEFAULT_TAX_PROFILE }; // gasto/desconocida → operativo neutral
  }

  // ── Categorías ─────────────────────────────────────────────
  // getCategoriesByType excluye las de sistema (c-cmv) y las ocultas (c-interes…)
  function getCategories() { return load(KEYS.categories) || DEFAULT_CATEGORIES; }
  function getCategoriesByType(type) {
    return getCategories().filter(c =>
      c.type === type && !c.isSystem && !HIDDEN_CATEGORY_IDS.has(c.id));
  }
  function getCategoryById(id) { return getCategories().find(c => c.id === id) || null; }

  // ── Cuentas ────────────────────────────────────────────────
  function getAccounts() { return load(KEYS.accounts) || DEFAULT_ACCOUNTS; }
  function getAccountById(id) { return getAccounts().find(a => a.id === id) || null; }

  // Última cuenta usada por tipo de movimiento ('income' | 'expense').
  // Default inteligente para altas nuevas. Por empresa (prefijo). Siempre editable.
  function getLastAccount(type) { return load('cf_last_acc_' + type) || ''; }
  function setLastAccount(type, id) { if (id) save('cf_last_acc_' + type, id); }

  // ── Configuración ──────────────────────────────────────────
  function getSettings() { return { ...DEFAULT_SETTINGS, ...(load(KEYS.settings) || {}) }; }
  function updateSettings(data) { save(KEYS.settings, { ...getSettings(), ...data }); }

  // ── Sistema IVA Ecuador ────────────────────────────────────────────────────────
  // Porcentaje vigente en Ecuador (SRI). Puede editarse en configuración.
  const IVA_DEFAULT = 15; // 15% desde abril 2024

  // Catálogo de palabras clave para sugerencia automática de tipo IVA
  // Fuente: Ley de Régimen Tributario Interno Ecuador (LORTI) art. 55 (tarifa 0%)
  const _IVA_CERO_KEYWORDS = [
    // Alimentos naturales / no procesados
    'arroz','papa','papas','yuca','camote','verde','platano','plátano','maiz','maíz',
    'quinua','cebada','trigo','centeno','avena','harina','azucar','azúcar','sal',
    'panela','aceite','manteca','mantequilla','leche','queso','yogur','yogurt',
    'huevo','huevos','pollo crudo','carne','res','cerdo','pescado','camaron','camarón',
    'atun','atún','sardina','tilapia','corvina','trucha','marisco',
    'tomate','cebolla','ajo','zanahoria','remolacha','espinaca','lechuga','brocoli',
    'brócoli','pepino','zucchini','vainita','arveja','frijol','lenteja','garbanzo',
    'naranja','mandarina','manzana','pera','uva','guineo','banano','mango','papaya',
    'piña','melon','melón','sandia','sandía','fresa','mora','guayaba','limón','limon',
    'pan','tortilla','arroz de cebada',
    // Medicinas
    'medicina','medicamento','pastilla','tableta','capsula','cápsula','jarabe','ampolla',
    'inyeccion','inyección','vacuna','suero','antibiotico','antibiótico','analgesico',
    'analgésico','antiinflamatorio','pomada','crema medicinal','gasa','venda',
    // Educación
    'libro','cuaderno','lapiz','lápiz','pluma','borrador','regla','compas','compás',
    'utiles','útiles','escolar','texto escolar','uniforme escolar',
    // Semillas / agro
    'semilla','fertilizante','pesticida','fumigante','abono',
    // Transporte público
    'pasaje','tiquete bus',
  ];

  const _IVA_15_KEYWORDS = [
    // Ropa y calzado
    'jean','jeans','pantalon','pantalón','camisa','camiseta','polo','blusa','vestido',
    'falda','short','bermuda','ropa','prenda','chompa','chaqueta','abrigo','buzo',
    'zapato','zapatilla','sandalia','bota','tenis','deportivo','calzado','suela',
    'medias','calcetines','ropa interior','pijama','traje','saco',
    // Electrónica
    'celular','telefono','teléfono','tablet','laptop','computadora','computador','pc',
    'televisor','tv','monitor','impresora','router','modem','audifono','audífono',
    'cargador','cable','funda','case','estuche','auricular','parlante','bocina',
    // Alimentos procesados / snacks
    'galleta','galletas','chips','snack','chocolatina','chocolate','caramelo','dulce',
    'gaseosa','cola','pepsi','coca','fanta','sprite','cerveza','vino','licor',
    'whisky','ron','vodka','bebida alcoholica','energizante','jugo en caja','néctar',
    'nectar','enlatado','conserva','salsa','mayonesa','ketchup','mostaza','atún en lata',
    'spam','salchicha','embutido','chorizo','mortadela','jamón','jamon',
    // Higiene y belleza
    'shampoo','acondicionador','jabón','jabon','desodorante','perfume','colonia',
    'crema facial','maquillaje','labial','rimel','esmalte','base','polvo compacto',
    'papel higienico','pañal','tampón','toalla femenina','cepillo dientes',
    'pasta dental','hilo dental','enjuague',
    // Hogar / limpieza
    'detergente','lavaplatos','desinfectante','suavizante','cloro','limpiapisos',
    'escoba','trapeador','mopa','esponja','guante limpieza',
    // Muebles / decoración
    'mueble','silla','mesa','sofa','sofá','cama','colchon','colchón','escritorio',
    'armario','closet','estante','lampara','lámpara','cortina','espejo','cuadro',
    // Herramientas / ferretería
    'martillo','tornillo','pintura','brocha','tubo','cable electrico','cerradura',
    'herramienta','taladro','sierra','llave','perno','clavo','cemento','varilla',
    // Vehículos / repuestos
    'llanta','bateria','batería','aceite motor','filtro','repuesto','accesorio auto',
    // Cosméticos / spa
    'spa','manicura','pedicura','tinte','tinte cabello','extensiones',
  ];

  // Calcula los campos IVA de un precio ingresado según el tipo
  function calcIva(precio, tipoIva, porcentajeIva) {
    const pct = (porcentajeIva || IVA_DEFAULT) / 100;
    precio = parseFloat(precio) || 0;
    if (tipoIva === 'SIN_IVA' || !tipoIva) {
      return { precioBase: precio, valorIva: 0, precioFinal: precio, tipoIva: tipoIva || 'SIN_IVA', porcentajeIva: 0 };
    }
    if (tipoIva === 'IVA_NO_INCLUIDO') {
      const valorIva = Math.round(precio * pct * 100) / 100;
      return { precioBase: precio, valorIva, precioFinal: Math.round((precio + valorIva) * 100) / 100, tipoIva, porcentajeIva: porcentajeIva || IVA_DEFAULT };
    }
    if (tipoIva === 'IVA_INCLUIDO') {
      const precioBase = Math.round((precio / (1 + pct)) * 100) / 100;
      const valorIva   = Math.round((precio - precioBase) * 100) / 100;
      return { precioBase, valorIva, precioFinal: precio, tipoIva, porcentajeIva: porcentajeIva || IVA_DEFAULT };
    }
    return { precioBase: precio, valorIva: 0, precioFinal: precio, tipoIva: 'SIN_IVA', porcentajeIva: 0 };
  }

  // Sugerencia automática de tipo IVA basada en nombre del producto
  // 1. Busca en historial del negocio (aprendizaje)
  // 2. Busca en palabras clave del catálogo SRI
  // Retorna: { tipoIva, confianza: 'alta'|'media'|'baja', fuente: 'historial'|'catalogo'|'default' }
  function getIvaSuggestion(nombre, categoriaId) {
    nombre = (nombre || '').toLowerCase().trim();

    // 1. Historial del negocio (aprendizaje por nombre exacto y categoría)
    const mem = load('cf_iva_memory') || {};

    // Coincidencia exacta de nombre
    if (mem[nombre]) {
      const e = mem[nombre];
      return { tipoIva: e.tipoIva, confianza: 'alta', fuente: 'historial',
               msg: `Usaste "${e.tipoIva === 'SIN_IVA' ? 'Sin IVA' : e.tipoIva === 'IVA_NO_INCLUIDO' ? 'IVA aparte' : 'IVA incluido'}" para este producto antes` };
    }

    // Historial por categoría
    if (categoriaId && mem['cat_' + categoriaId]) {
      const e = mem['cat_' + categoriaId];
      return { tipoIva: e.tipoIva, confianza: 'media', fuente: 'historial_cat',
               msg: `Usualmente esta categoría lleva: ${e.tipoIva === 'SIN_IVA' ? 'Sin IVA' : e.tipoIva === 'IVA_NO_INCLUIDO' ? 'IVA aparte' : 'IVA incluido'}` };
    }

    // 2. Catálogo SRI — tarifa 0%
    const palabras = nombre.split(/\s+/);
    const esCero = _IVA_CERO_KEYWORDS.some(kw => {
      if (kw.includes(' ')) return nombre.includes(kw);
      return palabras.some(p => p === kw || p.startsWith(kw.slice(0, -1)));
    });
    if (esCero) {
      return { tipoIva: 'SIN_IVA', confianza: 'media', fuente: 'catalogo',
               msg: '📋 Posible tarifa 0% (SRI Ecuador) — confirma si aplica' };
    }

    // 3. Catálogo SRI — gravado con IVA
    const esGravado = _IVA_15_KEYWORDS.some(kw => {
      if (kw.includes(' ')) return nombre.includes(kw);
      return palabras.some(p => p === kw || p.startsWith(kw.slice(0, -1)));
    });
    if (esGravado) {
      return { tipoIva: 'IVA_INCLUIDO', confianza: 'media', fuente: 'catalogo',
               msg: '📋 Producto gravado con IVA — sugerimos "precio ya incluye IVA"' };
    }

    // 4. Sin coincidencia
    return { tipoIva: 'IVA_INCLUIDO', confianza: 'baja', fuente: 'default',
             msg: 'Sin historial para este producto — elige el tipo que aplica' };
  }

  // Guardar en memoria de aprendizaje
  function recordIvaMemory(nombre, categoriaId, tipoIva) {
    nombre = (nombre || '').toLowerCase().trim();
    if (!nombre || !tipoIva) return;
    const mem = load('cf_iva_memory') || {};
    mem[nombre] = { tipoIva, updatedAt: new Date().toISOString() };
    if (categoriaId) mem['cat_' + categoriaId] = { tipoIva, updatedAt: new Date().toISOString() };
    save('cf_iva_memory', mem);
  }

  // ── Memoria inteligente de descripciones (aprendizaje de transacciones) ───────
  // Cada clave es la descripción normalizada; guarda tipo, categoría, cuenta, IVA, etc.
  function saveSmartDescEntry(normalizedKey, data) {
    if (!normalizedKey) return;
    const mem  = load('cf_smart_desc') || {};
    const prev = mem[normalizedKey] || {};
    mem[normalizedKey] = {
      ...prev,
      ...data,
      count:    (prev.count || 0) + 1,
      lastUsed: new Date().toISOString().slice(0, 10),
    };
    save('cf_smart_desc', mem);
  }

  // Devuelve hasta 5 sugerencias ordenadas por frecuencia de uso
  function getSmartDescSuggestions(query) {
    if (!query || query.length < 2) return [];
    const mem = load('cf_smart_desc') || {};
    return Object.entries(mem)
      .filter(([k]) => k.includes(query))
      .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
      .slice(0, 5)
      .map(([k, v]) => ({ key: k, ...v }));
  }

  // ── Fotos de comprobantes / facturas (IndexedDB) ──────────────────────────────
  // Se usa IndexedDB en lugar de localStorage porque las imágenes ocuparían
  // demasiado espacio: IndexedDB soporta cientos de fotos sin problema.
  const PHOTO_DB_NAME = 'contafacil_photos';
  const PHOTO_STORE   = 'receipts';
  let   _photoDbPromise = null;

  function _openPhotoDb() {
    if (_photoDbPromise) return _photoDbPromise;
    _photoDbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB no disponible')); return; }
      const req = indexedDB.open(PHOTO_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    return _photoDbPromise;
  }

  // Guarda una foto (dataURL) bajo una clave (el id de la transacción)
  function savePhoto(key, dataUrl) {
    return _openPhotoDb().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(PHOTO_STORE, 'readwrite');
      t.objectStore(PHOTO_STORE).put(dataUrl, key);
      t.oncomplete = () => resolve(true);
      t.onerror    = () => reject(t.error);
    }));
  }

  // Recupera una foto; null si no existe o si IndexedDB falla
  function getPhoto(key) {
    return _openPhotoDb().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(PHOTO_STORE, 'readonly');
      const r = t.objectStore(PHOTO_STORE).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror   = () => reject(r.error);
    })).catch(() => null);
  }

  // Elimina una foto (al borrar la transacción asociada)
  function deletePhoto(key) {
    return _openPhotoDb().then(db => new Promise(resolve => {
      const t = db.transaction(PHOTO_STORE, 'readwrite');
      t.objectStore(PHOTO_STORE).delete(key);
      t.oncomplete = () => resolve(true);
      t.onerror    = () => resolve(false);
    })).catch(() => false);
  }

  // Lee varias fotos a la vez → { idTransaccion: dataURL }  (para respaldos)
  function getPhotosFor(keys) {
    if (!keys || !keys.length) return Promise.resolve({});
    return _openPhotoDb().then(db => new Promise(resolve => {
      const out   = {};
      const t     = db.transaction(PHOTO_STORE, 'readonly');
      const store = t.objectStore(PHOTO_STORE);
      let pending = keys.length;
      keys.forEach(k => {
        const r = store.get(k);
        r.onsuccess = () => { if (r.result) out[k] = r.result; if (--pending === 0) resolve(out); };
        r.onerror   = () => { if (--pending === 0) resolve(out); };
      });
    })).catch(() => ({}));
  }

  // Guarda un lote de fotos { idTransaccion: dataURL }  (al importar un respaldo)
  function savePhotosMap(map) {
    const keys = Object.keys(map || {});
    if (!keys.length) return Promise.resolve(true);
    return _openPhotoDb().then(db => new Promise(resolve => {
      const t     = db.transaction(PHOTO_STORE, 'readwrite');
      const store = t.objectStore(PHOTO_STORE);
      keys.forEach(k => { if (map[k]) store.put(map[k], k); });
      t.oncomplete = () => resolve(true);
      t.onerror    = () => resolve(false);
    })).catch(() => false);
  }

  // ── Inventario ─────────────────────────────────────────────
  function getInventory() { return load(KEYS.inventory) || []; }

  function addProduct(data) {
    const inv = getInventory();
    // Calcular campos IVA antes de guardar
    const ivaCalc = calcIva(data.precioVenta || data.unitCost || 0, data.tipoIva, data.porcentajeIva);
    const p = { id: uuid(), quantity: 0, unitCost: 0, unit: 'unidades',
                tipoIva: 'SIN_IVA', precioBase: 0, precioFinal: 0, valorIva: 0, porcentajeIva: 0,
                ...data, ...ivaCalc };
    inv.push(p);
    save(KEYS.inventory, inv);
    recordIvaMemory(p.name, p.category, p.tipoIva);
    _logAudit('create_product', `📦 ${p.name || 'Producto nuevo'}`);
    return p;
  }

  function updateProduct(id, data) {
    const inv = getInventory();
    const idx = inv.findIndex(p => p.id === id);
    if (idx < 0) return null;
    const merged = { ...inv[idx], ...data, id };
    // Recalcular IVA si cambió el precio o el tipo
    if (data.tipoIva || data.precioVenta !== undefined) {
      const ivaCalc = calcIva(merged.precioVenta || merged.unitCost || 0, merged.tipoIva, merged.porcentajeIva);
      Object.assign(merged, ivaCalc);
    }
    inv[idx] = merged;
    save(KEYS.inventory, inv);
    if (data.tipoIva) recordIvaMemory(merged.name, merged.category, merged.tipoIva);
    return inv[idx];
  }

  function deleteProduct(id) {
    const p = getInventory().find(x => x.id === id);
    _logAudit('delete_product', `🗑️ ${p ? p.name : id}`);
    save(KEYS.inventory, getInventory().filter(p => p.id !== id));
    deletePhoto('prod_' + id).catch(() => {}); // limpiar la foto del producto (IndexedDB)
  }
  function getProductById(id) { return getInventory().find(p => p.id === id) || null; }

  // ── Gastos Recurrentes ─────────────────────────────────────
  // Modelo: { id, name, amount, category, account, dayOfMonth, startDate,
  //           isActive, description, notes, createdAt }
  // dayOfMonth: 1-28 (evitamos 29-31 para compatibilidad con todos los meses)

  function getRecurrings() { return load(KEYS.recurring) || []; }

  function addRecurring(data) {
    const list = getRecurrings();
    const r = {
      id:         uuid(),
      createdAt:  new Date().toISOString(),
      isActive:   true,
      dayOfMonth: 1,
      startDate:  new Date().toISOString().split('T')[0],
      ...data,
      amount: parseFloat(data.amount),
    };
    list.push(r);
    save(KEYS.recurring, list);
    return r;
  }

  function updateRecurring(id, data) {
    const list = getRecurrings();
    const idx  = list.findIndex(r => r.id === id);
    if (idx < 0) return null;
    // amount se actualiza solo para el futuro — el histórico queda intacto
    list[idx] = { ...list[idx], ...data, id,
                  amount: data.amount !== undefined ? parseFloat(data.amount) : list[idx].amount };
    save(KEYS.recurring, list);
    return list[idx];
  }

  function deleteRecurring(id) {
    save(KEYS.recurring, getRecurrings().filter(r => r.id !== id));
    // NO elimina transacciones históricas generadas por este recurrente
  }

  function getRecurringById(id) { return getRecurrings().find(r => r.id === id) || null; }

  // Calcula la próxima fecha de ejecución de un recurrente
  function getNextExecution(r) {
    const now  = new Date();
    const y    = now.getFullYear(), m = now.getMonth();
    const cap  = d => Math.min(d, new Date(y, m + 1, 0).getDate()); // days in month
    const thisMonthDate = new Date(y, m, cap(r.dayOfMonth));
    if (thisMonthDate >= now) return thisMonthDate;
    // siguiente mes
    const nm = m === 11 ? 0 : m + 1, ny = m === 11 ? y + 1 : y;
    const capN = Math.min(r.dayOfMonth, new Date(ny, nm + 1, 0).getDate());
    return new Date(ny, nm, capN);
  }

  // Verifica si ya se generó el recurrente para un mes/año específico
  function _isRecGenerated(recurringId, year, month) {
    return (load(KEYS.transactions) || []).some(t => {
      if (t.recurringId !== recurringId) return false;
      const d = new Date(t.date + 'T12:00:00');
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    });
  }

  // Genera automáticamente los gastos recurrentes pendientes.
  // Se llama al abrir la app. Hace "catch-up" de meses no generados.
  // Retorna un array con los gastos generados (para mostrar notificación).
  function processRecurringExpenses() {
    const actives = getRecurrings().filter(r => r.isActive);
    if (!actives.length) return [];

    const now       = new Date();
    const generated = [];

    actives.forEach(r => {
      const start = new Date(r.startDate + 'T12:00:00');
      let sy = start.getFullYear(), sm = start.getMonth(); // 0-indexed

      while (true) {
        // Días en este mes del bucle
        const daysInM = new Date(sy, sm + 1, 0).getDate();
        const day     = Math.min(r.dayOfMonth, daysInM);
        const txDate  = new Date(sy, sm, day);

        // Parar si la fecha de ejecución es futura
        if (txDate > now) break;

        const month1  = sm + 1; // 1-indexed para comparaciones

        if (!_isRecGenerated(r.id, sy, month1)) {
          const dateStr = `${sy}-${String(month1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const txs = load(KEYS.transactions) || [];
          txs.push({
            id:          uuid(),
            createdAt:   new Date().toISOString(),
            type:        'expense',
            isRecurring: true,
            recurringId: r.id,
            description: r.name,
            amount:      parseFloat(r.amount),
            date:        dateStr,
            category:    r.category || '',
            account:     r.account  || '',
            notes:       'Gasto recurrente · generado automáticamente',
          });
          save(KEYS.transactions, txs);
          generated.push({ name: r.name, amount: r.amount, date: dateStr });
        }

        // Avanzar al siguiente mes
        sm++;
        if (sm > 11) { sm = 0; sy++; }

        // Seguridad: no procesar más de 36 meses hacia atrás
        const monthsProcessed = (sy - start.getFullYear()) * 12 + (sm - start.getMonth());
        if (monthsProcessed > 36) break;
      }
    });

    return generated;
  }

  // ── Presupuestos por categoría ────────────────────────────
  // Estructura: { [categoryId]: amount }
  function getBudgets() { return load(KEYS.budgets) || {}; }
  function setBudget(categoryId, amount) {
    const b = getBudgets();
    if (!amount || amount <= 0) { delete b[categoryId]; }
    else                        { b[categoryId] = parseFloat(amount); }
    save(KEYS.budgets, b);
  }
  function deleteBudget(categoryId) {
    const b = getBudgets();
    delete b[categoryId];
    save(KEYS.budgets, b);
  }
  // Retorna estado de presupuesto para cada categoría que tiene límite
  function getBudgetStatus(year, month) {
    const budgets = getBudgets();
    if (!Object.keys(budgets).length) return [];
    const txs = getTransactionsByMonth(year, month);
    const spent = {};
    txs.filter(t => t.type === 'expense' && !t.isCogs && !t.inventoryAsset).forEach(t => {
      const k = t.category || '__sin_cat__';
      spent[k] = (spent[k] || 0) + t.amount;
    });
    return Object.entries(budgets).map(([catId, limit]) => {
      const cat       = getCategories().find(c => c.id === catId);
      const usedAmt   = spent[catId] || 0;
      const pct       = Math.min(Math.round((usedAmt / limit) * 100), 100);
      const isOver    = usedAmt > limit;
      const isWarning = !isOver && pct >= 80;
      return { catId, cat, limit, usedAmt, remaining: limit - usedAmt, pct, isOver, isWarning };
    }).sort((a, b) => b.pct - a.pct);
  }

  // ── Cuentas por Cobrar (Cartera de Clientes) ─────────────
  // Ecuador NIIF PYMES · SRI · plazo de crédito · cartera vencida
  // status: 'pending' | 'partial' | 'paid' | 'overdue'

  function _calcReceivableStatus(rec) {
    const paid  = (rec.payments || []).reduce((s, p) => s + p.amount, 0);
    if (paid >= rec.totalAmount) return 'paid';
    const today = new Date();
    const due   = new Date(rec.dueDate + 'T12:00:00');
    if (paid > 0) return today > due ? 'overdue' : 'partial';
    return today > due ? 'overdue' : 'pending';
  }

  function getReceivables() { return load(KEYS.receivables) || []; }

  function getReceivableById(id) {
    return getReceivables().find(r => r.id === id) || null;
  }

  function addReceivable(data) {
    const list = getReceivables();
    const rec = {
      id:          uuid(),
      createdAt:   new Date().toISOString(),
      clientName:  data.clientName  || '',
      ruc:         data.ruc         || '',
      description: data.description || '',
      totalAmount: parseFloat(data.totalAmount) || 0,
      issueDate:   data.issueDate   || new Date().toISOString().split('T')[0],
      dueDate:     data.dueDate     || '',
      notes:       data.notes       || '',
      payments:    [],
    };
    rec.status = _calcReceivableStatus(rec);
    list.push(rec);
    save(KEYS.receivables, list);
    _logAudit('create_receivable', `💳 CxC ${rec.clientName} · $${rec.totalAmount}`);
    return rec;
  }

  function updateReceivable(id, data) {
    const list = getReceivables();
    const idx  = list.findIndex(r => r.id === id);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], ...data, id, payments: list[idx].payments || [] };
    list[idx].status = _calcReceivableStatus(list[idx]);
    save(KEYS.receivables, list);
    return list[idx];
  }

  function deleteReceivable(id) {
    const rec = getReceivables().find(r => r.id === id);
    _logAudit('delete_receivable', `🗑️ CxC ${rec ? rec.clientName : id}`);
    save(KEYS.receivables, getReceivables().filter(r => r.id !== id));
  }

  function addReceivablePayment(receivableId, payment) {
    const list = getReceivables();
    const idx  = list.findIndex(r => r.id === receivableId);
    if (idx < 0) return null;
    const p = {
      id:     uuid(),
      date:   payment.date   || new Date().toISOString().split('T')[0],
      amount: parseFloat(payment.amount) || 0,
      notes:  payment.notes  || '',
    };
    list[idx].payments = [...(list[idx].payments || []), p];
    list[idx].status   = _calcReceivableStatus(list[idx]);
    save(KEYS.receivables, list);
    return list[idx];
  }

  // Estadísticas de cartera con aging (cartera vencida por rango de días)
  function getReceivableStats() {
    const list  = getReceivables();
    const today = new Date();
    let totalCartera = 0, totalCobrado = 0, totalPendiente = 0;
    const aging = { d30: 0, d60: 0, d90: 0, d90plus: 0 };

    list.forEach(rec => {
      const paid    = (rec.payments || []).reduce((s, p) => s + p.amount, 0);
      const pending = Math.max(rec.totalAmount - paid, 0);
      totalCartera  += rec.totalAmount;
      totalCobrado  += paid;
      totalPendiente += pending;

      const due = new Date(rec.dueDate + 'T12:00:00');
      if (pending > 0 && today > due) {
        const daysOver = Math.floor((today - due) / 86400000);
        if      (daysOver <= 30) aging.d30     += pending;
        else if (daysOver <= 60) aging.d60     += pending;
        else if (daysOver <= 90) aging.d90     += pending;
        else                     aging.d90plus += pending;
      }
    });

    return {
      total:          list.length,
      totalCartera,   totalCobrado,   totalPendiente,
      overdueCount:   list.filter(r => r.status === 'overdue').length,
      pendingCount:   list.filter(r => r.status === 'pending' || r.status === 'partial').length,
      aging,
    };
  }

  // ── Estadísticas multi-mes (para gráficas) ────────────────
  function getLast6MonthsStats() {
    const result = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear(), m = d.getMonth() + 1;
      const stats = getMonthStats(y, m);
      result.push({
        year: y, month: m,
        label: d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' }),
        income:    stats.income,
        expenses:  stats.opExpenses + stats.cogs,
        netProfit: stats.netProfit,
      });
    }
    return result;
  }

  // ── Saldo por cuenta bancaria ─────────────────────────────
  // Calcula el saldo real de cada cuenta sumando ingresos, restando gastos
  // y aplicando traslados entre cuentas.
  function getAccountBalances() {
    const txs  = getTransactions();
    const accs = getAccounts();
    const bal  = {};
    accs.forEach(a => { bal[a.id] = 0; });

    txs.forEach(t => {
      if (t.isCogs) return;
      // Los asientos de IVA ya son type income/expense → se manejan abajo igual
      // que cualquier movimiento normal (mueven efectivo real).
      // Pago dividido: el dinero entró/salió por 2 cuentas
      const split = Array.isArray(t.splitPayments) && t.splitPayments.length
        ? t.splitPayments : null;
      if (t.type === 'income') {
        if (split) {
          split.forEach(sp => { if (sp.account)
            bal[sp.account] = (bal[sp.account] || 0) + (parseFloat(sp.amount) || 0); });
        } else if (t.account) {
          bal[t.account] = (bal[t.account] || 0) + t.amount;
        }
      }
      if (t.type === 'expense') {
        if (split) {
          split.forEach(sp => { if (sp.account)
            bal[sp.account] = (bal[sp.account] || 0) - (parseFloat(sp.amount) || 0); });
        } else if (t.account) {
          bal[t.account] = (bal[t.account] || 0) - t.amount;
        }
      }
      if (t.type === 'transfer') {
        if (t.fromAccount) bal[t.fromAccount] = (bal[t.fromAccount] || 0) - t.amount;
        if (t.toAccount)   bal[t.toAccount]   = (bal[t.toAccount]   || 0) + t.amount;
      }
    });
    return bal; // { accountId: saldo }
  }

  // ── Seguridad: PIN de bloqueo ─────────────────────────────────────────────────
  // El PIN se almacena como hash SHA-256 (nunca en texto plano)
  const SEC_KEY = 'cf_security';

  function getSecuritySettings() {
    return load(SEC_KEY) || { pinHash: null, requirePinForExport: false };
  }

  // ── Helpers de hash ──────────────────────────────────────────────────────────
  async function _hashPin(pin) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cfpin_' + pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ── PIN por usuario ──────────────────────────────────────────────────────────
  // Cada usuario tiene su propio pinHash. El propietario (isOwner:true) es el
  // usuario principal de la empresa. Nadie puede entrar con el PIN de otro.

  function getUserList() {
    const s         = getSettings();
    const ownerName = s.userName || 'Principal';
    const stored    = Array.isArray(s.users) ? s.users : [];

    // Ya tiene formato nuevo (array de objetos)
    if (stored.length > 0 && typeof stored[0] === 'object' && stored[0] !== null) {
      // Asegurar que haya exactamente un owner marcado
      if (!stored.some(u => u.isOwner)) {
        const updated = stored.map((u, i) => i === 0 ? { ...u, isOwner: true } : u);
        updateSettings({ users: updated });
        return updated;
      }
      return stored;
    }

    // Formato antiguo (strings) o vacío → migrar
    const sec   = load(SEC_KEY) || {};
    const names = stored.length > 0 ? stored : [ownerName];
    const list  = names.map((name, i) => ({
      name,
      pinHash: name === ownerName ? (sec.pinHash || null) : null,
      isOwner: i === 0 || name === ownerName,
    }));
    // Dejar solo un owner
    let ownerSet = false;
    const deduped = list.map(u => {
      if (u.isOwner && !ownerSet) { ownerSet = true; return u; }
      return { ...u, isOwner: false };
    });
    updateSettings({ users: deduped });
    return deduped;
  }

  function getUserEntry(userName) {
    return getUserList().find(u => u.name === userName) || null;
  }

  function userHasPin(userName) {
    const e = getUserEntry(userName);
    return !!(e && e.pinHash);
  }

  async function setUserPin(userName, pin) {
    const hash = await _hashPin(pin);
    const list = getUserList();
    const idx  = list.findIndex(u => u.name === userName);
    if (idx >= 0) list[idx] = { ...list[idx], pinHash: hash };
    else list.push({ name: userName, pinHash: hash, isOwner: false });
    updateSettings({ users: list });
    // Sincronizar cf_security para el owner (retrocompatibilidad con export)
    if (list[idx]?.isOwner || (idx < 0 && false))
      save(SEC_KEY, { ...getSecuritySettings(), pinHash: hash });
    const entry = list.find(u => u.name === userName);
    if (entry?.isOwner) save(SEC_KEY, { ...getSecuritySettings(), pinHash: hash });
  }

  async function verifyUserPin(userName, pin) {
    const e = getUserEntry(userName);
    if (!e || !e.pinHash) return true; // sin PIN = siempre pasa
    const hash = await _hashPin(pin);
    return hash === e.pinHash;
  }

  function removeUserPin(userName) {
    const list = getUserList().map(u =>
      u.name === userName ? { ...u, pinHash: null } : u
    );
    updateSettings({ users: list });
    const entry = list.find(u => u.name === userName);
    if (entry?.isOwner) save(SEC_KEY, { ...getSecuritySettings(), pinHash: null });
  }

  function addUserToList(name) {
    const list = getUserList();
    if (list.find(u => u.name === name)) return; // ya existe
    list.push({ name, pinHash: null, isOwner: false });
    updateSettings({ users: list });
  }

  function removeUserFromList(name) {
    // No se puede eliminar al owner ni al único usuario
    const list = getUserList();
    if (list.length <= 1) return;
    const filtered = list.filter(u => u.name !== name || u.isOwner);
    updateSettings({ users: filtered });
  }

  // ── Código de recuperación (si se olvida el PIN) ────────────────────────────
  // Genera un código de 12 caracteres sin caracteres ambiguos, en grupos de 4
  function generateRecoveryCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0,O,1,I,l
    const arr   = crypto.getRandomValues(new Uint8Array(12));
    let raw = '';
    arr.forEach(b => { raw += chars[b % chars.length]; });
    return raw.slice(0,4) + '-' + raw.slice(4,8) + '-' + raw.slice(8,12);
  }

  async function setUserRecoveryCode(userName, plainCode) {
    const normalized = plainCode.replace(/-/g, '').toUpperCase();
    const hash = await _hashPin('recovery_' + normalized); // prefijo distinto al PIN
    const list = getUserList().map(u =>
      u.name === userName ? { ...u, recoveryHash: hash } : u
    );
    updateSettings({ users: list });
  }

  async function verifyRecoveryCode(userName, plainCode) {
    const e = getUserEntry(userName);
    if (!e || !e.recoveryHash) return false;
    const normalized = plainCode.replace(/-/g, '').toUpperCase();
    const hash = await _hashPin('recovery_' + normalized);
    return hash === e.recoveryHash;
  }

  function userHasRecoveryCode(userName) {
    const e = getUserEntry(userName);
    return !!(e && e.recoveryHash);
  }

  // Marca un usuario como solo-lectura (empleado sin acceso a Reportes/Ajustes)
  function setUserReadOnly(userName, val) {
    const list = getUserList().map(u =>
      u.name === userName ? { ...u, isReadOnly: !!val } : u
    );
    updateSettings({ users: list });
  }

  function isUserReadOnly(userName) {
    const e = getUserEntry(userName);
    return !!(e && !e.isOwner && e.isReadOnly);
  }

  // Secciones permitidas por usuario (granular).
  // allowedScreens: array de screens permitidos
  // null = sin restricción (acceso completo)
  const ALL_SCREENS = ['dashboard','journal','inventory','cartera','assets','reports','settings'];

  function setUserAllowedScreens(userName, screens) {
    const list = getUserList().map(u =>
      u.name === userName ? { ...u, allowedScreens: screens } : u
    );
    updateSettings({ users: list });
  }

  function getUserAllowedScreens(userName) {
    const e = getUserEntry(userName);
    if (!e || e.isOwner) return ALL_SCREENS; // propietario: todo
    if (e.allowedScreens) return e.allowedScreens;
    // Retrocompatibilidad: si es readOnly, restringir reports, assets y settings
    if (e.isReadOnly) return ['dashboard','journal','inventory','cartera'];
    return ALL_SCREENS;
  }

  function isScreenAllowed(userName, screen) {
    return getUserAllowedScreens(userName).includes(screen);
  }

  // ── Funciones de seguridad (delegadas al usuario actual) ─────────────────────
  function isPinSet() {
    const s = getSettings();
    return userHasPin(s.userName || 'Principal');
  }

  async function setPinHash(pin) {
    const s = getSettings();
    await setUserPin(s.userName || 'Principal', pin);
  }

  async function verifyPin(pin) {
    const s = getSettings();
    return verifyUserPin(s.userName || 'Principal', pin);
  }

  function removePin() {
    const s = getSettings();
    removeUserPin(s.userName || 'Principal');
  }

  function setExportPin(val) {
    save(SEC_KEY, { ...getSecuritySettings(), requirePinForExport: !!val });
  }

  // ── Cifrado AES-256-GCM (Web Crypto API — 100% offline) ──────────────────────
  // Exportación cifrada: nadie puede leer el archivo sin la contraseña.

  async function _deriveKey(password, salt) {
    const km = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
      km,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function exportForSyncEncrypted(password) {
    const plain = new TextEncoder().encode(await exportForSync());
    const salt  = crypto.getRandomValues(new Uint8Array(16));
    const iv    = crypto.getRandomValues(new Uint8Array(12));
    const key   = await _deriveKey(password, salt);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);

    // Empacar: magic(8) + salt(16) + iv(12) + ciphertext
    const magic  = new TextEncoder().encode('CFPRO_01'); // 8 bytes identificador
    const packed = new Uint8Array(8 + 16 + 12 + cipher.byteLength);
    packed.set(magic,   0);
    packed.set(salt,    8);
    packed.set(iv,      24);
    packed.set(new Uint8Array(cipher), 36);

    return JSON.stringify({
      cf_encrypted: true,
      version:      1,
      data:         btoa(String.fromCharCode(...packed)),
    }, null, 2);
  }

  async function importFromUserDecrypted(jsonStr, password) {
    const wrapper = JSON.parse(jsonStr);
    if (!wrapper.cf_encrypted) return await importFromUser(jsonStr); // sin cifrado

    const packed = Uint8Array.from(atob(wrapper.data), c => c.charCodeAt(0));
    // Verificar magic
    const magic = new TextDecoder().decode(packed.slice(0, 8));
    if (magic !== 'CFPRO_01') throw new Error('Formato no reconocido');

    const salt   = packed.slice(8,  24);
    const iv     = packed.slice(24, 36);
    const cipher = packed.slice(36);

    let decrypted;
    try {
      const key = await _deriveKey(password, salt);
      decrypted  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    } catch {
      throw new Error('Contraseña incorrecta');
    }
    return await importFromUser(new TextDecoder().decode(decrypted));
  }

  // ── Multi-usuario / Sincronización entre dispositivos ────────────────────────
  // Lógica: cada dispositivo tiene su userName. Exporta sus transacciones (con
  // userName estampado), el otro dispositivo las importa y la app une sin duplicar.

  // Lista completa de usuarios (nombres) para backward compat
  function getUsers() {
    const list    = getUserList();
    const txUsers = getUserNames();
    const all     = new Set([...list.map(u => u.name), ...txUsers]);
    return [...all].sort();
  }

  // Cambia el usuario activo; si no existe en la lista lo agrega (sin PIN)
  function switchUser(name) {
    const list = getUserList();
    if (!list.find(u => u.name === name)) {
      list.push({ name, pinHash: null, isOwner: false });
    }
    // Agregar usuarios de transacciones que no estén en la lista
    getUserNames().forEach(txUser => {
      if (!list.find(u => u.name === txUser))
        list.push({ name: txUser, pinHash: null, isOwner: false });
    });
    updateSettings({ userName: name, users: list });
  }

  // Retorna los nombres de usuario únicos que existen en las transacciones
  function getUserNames() {
    const txs   = load(KEYS.transactions) || [];
    const names = new Set();
    txs.forEach(t => { if (t.userName) names.add(t.userName); });
    return [...names].sort();
  }

  // Exporta solo transacciones + CxC con userName (sin inventario ni settings)
  // Incluye las fotos de comprobantes de las transacciones que las tengan.
  async function exportForSync() {
    const s    = getSettings();
    const txs  = load(KEYS.transactions) || [];
    const recs = load(KEYS.receivables)  || [];
    const photos = await getPhotosFor(txs.filter(t => t.hasReceipt).map(t => t.id));
    return JSON.stringify({
      syncVersion: 1,
      exportedBy:  s.userName || 'Principal',
      companyName: s.companyName,
      exported:    new Date().toISOString(),
      transactions: txs,
      receivables:  recs,
      photos,   // { idTransaccion: dataURL }
    }, null, 2);
  }

  // Importa el archivo de otro usuario: une transacciones y CxC sin duplicar por ID
  async function importFromUser(jsonStr) {
    const d = JSON.parse(jsonStr);
    if (!d.transactions && !d.syncVersion) throw new Error('Formato no reconocido');

    const sourceUser = d.exportedBy || d.settings?.companyName || 'Importado';
    const sourceTxs  = d.transactions || [];
    const sourceRecs = d.receivables  || [];

    // Merge transacciones (skip by UUID)
    let txs = load(KEYS.transactions) || [];
    const existIds  = new Set(txs.map(t => t.id));
    let addedTxs = 0;
    sourceTxs.forEach(t => {
      if (!existIds.has(t.id)) {
        if (!t.userName) t.userName = sourceUser;
        txs.push(t);
        addedTxs++;
      }
    });
    txs.sort((a, b) => new Date(b.date) - new Date(a.date));
    save(KEYS.transactions, txs);

    // Merge CxC (skip by UUID)
    let recs = load(KEYS.receivables) || [];
    const existRecIds = new Set(recs.map(r => r.id));
    let addedRecs = 0;
    sourceRecs.forEach(r => {
      if (!existRecIds.has(r.id)) {
        if (!r.userName) r.userName = sourceUser;
        recs.push(r);
        addedRecs++;
      }
    });
    save(KEYS.receivables, recs);

    // Restaurar las fotos de comprobantes incluidas en el archivo
    if (d.photos) await savePhotosMap(d.photos);

    return { addedTxs, addedRecs, sourceUser };
  }

  // ── Activos Fijos (NIIF PYMES — depreciación línea recta) ───────────────────
  // Categorías estándar Ecuador con vida útil sugerida
  const ASSET_CATEGORIES = [
    { id: 'eq-computo',    name: 'Equipos de Cómputo',   years: 3,  emoji: '💻' },
    { id: 'eq-maquinaria', name: 'Maquinaria / Equipos', years: 10, emoji: '⚙️' },
    { id: 'vehiculos',     name: 'Vehículos',             years: 5,  emoji: '🚗' },
    { id: 'muebles',       name: 'Muebles y Enseres',     years: 10, emoji: '🪑' },
    { id: 'edificios',     name: 'Edificios / Inmuebles', years: 20, emoji: '🏢' },
    { id: 'otros',         name: 'Otros Activos',         years: 5,  emoji: '📦' },
  ];

  function getFixedAssets() {
    return load(KEYS.fixedAssets) || [];
  }

  function saveFixedAsset(asset) {
    const list = getFixedAssets();
    if (asset.id) {
      const idx = list.findIndex(a => a.id === asset.id);
      if (idx >= 0) list[idx] = { ...asset };
      else list.push({ ...asset, createdAt: new Date().toISOString() });
    } else {
      list.push({ ...asset, id: uuid(), createdAt: new Date().toISOString() });
    }
    save(KEYS.fixedAssets, list);
    _logAudit('fixed_asset', `${asset.id ? 'Editó' : 'Registró'} activo: ${asset.name}`);
  }

  function deleteFixedAsset(id) {
    const name = (getFixedAssets().find(a => a.id === id) || {}).name || id;
    save(KEYS.fixedAssets, getFixedAssets().filter(a => a.id !== id));
    _logAudit('fixed_asset', `Eliminó activo: ${name}`);
  }

  // Calcula depreciación línea recta para un activo fijo.
  // Retorna: { monthlyDep, annualDep, accumulatedDep, bookValue, pctDepreciated,
  //            isFullyDepreciated, remainingMonths, monthsElapsed }
  function calcAssetDepreciation(asset) {
    const cost    = asset.purchaseCost    || 0;
    const resid   = asset.residualValue   || 0;
    const years   = asset.usefulLifeYears || 5;
    const depBase = Math.max(0, cost - resid);
    const annualDep  = years > 0 ? depBase / years : 0;
    const monthlyDep = annualDep / 12;

    const purchDate    = new Date(asset.purchaseDate + 'T12:00:00');
    const today        = new Date();
    const monthsElapsed = Math.max(0,
      (today.getFullYear() - purchDate.getFullYear()) * 12 +
      (today.getMonth()    - purchDate.getMonth())
    );

    const accumulatedDep     = Math.min(depBase, monthlyDep * monthsElapsed);
    const bookValue          = cost - accumulatedDep;
    const pctDepreciated     = depBase > 0 ? (accumulatedDep / depBase) * 100 : 100;
    const isFullyDepreciated = accumulatedDep >= depBase - 0.001;
    const remainingMonths    = isFullyDepreciated
      ? 0
      : Math.ceil((depBase - accumulatedDep) / Math.max(monthlyDep, 0.001));

    return {
      monthlyDep, annualDep, accumulatedDep, bookValue,
      pctDepreciated, isFullyDepreciated, remainingMonths, monthsElapsed,
    };
  }

  // Suma los valores contables actuales de todos los activos fijos
  function getFixedAssetsTotals() {
    const assets = getFixedAssets();
    let totalCost = 0, totalBookValue = 0, totalAccumDep = 0;
    assets.forEach(a => {
      const d = calcAssetDepreciation(a);
      totalCost      += a.purchaseCost || 0;
      totalBookValue += d.bookValue;
      totalAccumDep  += d.accumulatedDep;
    });
    return { totalCost, totalBookValue, totalAccumDep, count: assets.length };
  }

  // Getter de categorías (para uso desde app.js)
  function getAssetCategories() { return ASSET_CATEGORIES; }

  // ── Balance General (Estado de Situación Financiera) ─────────────────────────
  // NIIF PYMES Ecuador — snapshot del momento actual (no por período mensual)
  // Ecuación contable fundamental: Activos = Pasivos + Patrimonio
  function getBalanceSheet() {
    // ── Activos Corrientes ──────────────────────────────
    const accBalances = getAccountBalances();
    const accounts    = getAccounts();

    // Efectivo y equivalentes (cuentas con saldo ≠ 0)
    const cashAccounts = accounts
      .map(a => ({ ...a, balance: accBalances[a.id] || 0 }))
      .filter(a => (accBalances[a.id] || 0) !== 0);
    const totalCash = cashAccounts.reduce((s, a) => s + a.balance, 0);

    // Cuentas por Cobrar — cartera pendiente de cobro (crédito no cobrado aún)
    const recStats   = getReceivableStats();
    const totalCxC   = recStats.totalPendiente;

    // Inventario — valorado al costo unitario × cantidad en stock
    const inventory      = getInventory();
    const totalInventory = inventory.reduce((s, p) => s + (p.quantity * (p.unitCost || 0)), 0);

    const totalCurrentAssets = totalCash + totalCxC + totalInventory;

    // ── Activos No Corrientes (Activos Fijos) ───────────────
    const fixedAssetsTotals = getFixedAssetsTotals();
    const totalFixedAssets  = fixedAssetsTotals.totalBookValue; // valor neto en libros

    const totalAssets = totalCurrentAssets + totalFixedAssets;

    // ── Pasivos Corrientes ──────────────────────────────
    const pendingLiabs     = getPendingLiabilities();
    const totalLiabilities = pendingLiabs.reduce((s, t) => s + t.amount, 0);

    // ── Patrimonio ──────────────────────────────────────
    // Patrimonio = Activos − Pasivos (ecuación contable)
    const equity = totalAssets - totalLiabilities;

    return {
      cashAccounts, totalCash,
      totalCxC,
      inventory, totalInventory,
      totalCurrentAssets,
      fixedAssetsTotals, totalFixedAssets,
      totalAssets,
      pendingLiabs, totalLiabilities,
      equity,
    };
  }

  // ── Plantillas rápidas ─────────────────────────────────────
  // Guardan configuraciones de transacciones frecuentes para registrar de 1 toque.
  // Estructura: { id, name, emoji, type, amount, description, category, account,
  //               bankName, ivaType, createdAt }

  function getTemplates() { return load(KEYS.templates) || []; }

  function saveTemplate(data) {
    const list = getTemplates();
    const tpl = {
      id:          uuid(),
      createdAt:   new Date().toISOString(),
      name:        '',
      emoji:       '⭐',
      type:        'expense',
      amount:      0,
      description: '',
      category:    '',
      account:     '',
      bankName:    '',
      ivaType:     'IVA_INCLUIDO',
      ...data,
    };
    list.push(tpl);
    save(KEYS.templates, list);
    return tpl;
  }

  function deleteTemplate(id) {
    save(KEYS.templates, getTemplates().filter(t => t.id !== id));
  }

  // ── Onboarding ─────────────────────────────────────────────
  function isOnboarded() { return !!localStorage.getItem(KEYS.onboarded); }
  function markOnboarded() { localStorage.setItem(KEYS.onboarded, '1'); }

  // ── Exportar / Importar ────────────────────────────────────
  // El respaldo completo incluye las fotos de comprobantes.
  async function exportData() {
    const txs    = load(KEYS.transactions) || [];
    const inv    = load(KEYS.inventory)    || [];
    // Fotos de comprobantes (claves = id de transacción) + fotos de productos (prod_<id>)
    const photoKeys = [
      ...txs.filter(t => t.hasReceipt).map(t => t.id),
      ...inv.filter(p => p.hasPhoto).map(p => 'prod_' + p.id),
    ];
    const photos = await getPhotosFor(photoKeys);
    return JSON.stringify({
      version: 4, exported: new Date().toISOString(),
      transactions: txs,
      categories:   load(KEYS.categories),
      accounts:     load(KEYS.accounts),
      inventory:    load(KEYS.inventory),
      settings:     load(KEYS.settings),
      deducibles:   getDeducibles(),
      photos,   // { idTransaccion: dataURL }
    }, null, 2);
  }

  async function importData(jsonStr) {
    const d = JSON.parse(jsonStr);
    if (d.transactions) save(KEYS.transactions, d.transactions);
    if (d.categories)   save(KEYS.categories,   d.categories);
    if (d.accounts)     save(KEYS.accounts,      d.accounts);
    if (d.inventory)    save(KEYS.inventory,     d.inventory);
    if (d.settings)     save(KEYS.settings,      d.settings);
    if (d.deducibles)   save('cf_deducibles',    d.deducibles);
    if (d.photos)       await savePhotosMap(d.photos);
  }

  // ── Exportar / Importar configuración completa ───────────────────────────────
  // Incluye: empresa, usuarios+permisos+PINs(hash), moneda, cuentas,
  // categorías, presupuestos, recurrentes y ajustes de seguridad.
  // NO incluye: transacciones ni inventario (esos van por exportForSync).
  // ── Gestión multi-empresa ─────────────────────────────────────────────────────
  // Cada empresa tiene su propio espacio de datos en localStorage (prefijo único).
  // Las claves globales (cf_companies, cf_active_co) no llevan prefijo.

  function getCompanyList() { return loadG(GKEYS.companies) || []; }

  function getActiveCompany() {
    const id = loadG(GKEYS.active);
    return getCompanyList().find(c => c.id === id) || null;
  }

  function addCompany(name) {
    const list = getCompanyList();
    const id   = 'co' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
    const co   = { id, name: name.trim() || 'Nueva Empresa', createdAt: new Date().toISOString() };
    list.push(co);
    saveG(GKEYS.companies, list);
    return co;
  }

  function switchToCompany(id) {
    if (!getCompanyList().find(c => c.id === id)) return false;
    saveG(GKEYS.active, id);
    _prefix = id + '_';
    _migrateIvaTypes(); // asegurar que esta empresa tenga el IVA migrado
    return true;
  }

  function updateCompanyName(id, name) {
    const list = getCompanyList();
    const c    = list.find(c => c.id === id);
    if (c && name.trim()) { c.name = name.trim(); saveG(GKEYS.companies, list); }
  }

  function deleteCompany(id) {
    const list = getCompanyList();
    if (list.length <= 1) throw new Error('No puedes eliminar la única empresa');
    // Eliminar todos los datos de esa empresa del localStorage
    const pre = id + '_';
    Object.keys(localStorage).filter(k => k.startsWith(pre)).forEach(k => localStorage.removeItem(k));
    const newList = list.filter(c => c.id !== id);
    saveG(GKEYS.companies, newList);
    // Si era la activa, cambiar a la primera disponible
    if (loadG(GKEYS.active) === id) saveG(GKEYS.active, newList[0].id);
  }

  // ── Alertas de vencimiento unificadas ────────────────────────────────────────
  // Combina recurrentes activos + CxC pendientes en los próximos N días
  // También incluye CxC ya vencidas (daysUntil negativo).
  function getUpcomingAlerts(days = 7) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const cutoff     = new Date(todayStart); cutoff.setDate(cutoff.getDate() + days);
    const alerts     = [];

    // Recurrentes activos → próxima fecha de ejecución
    getRecurrings().filter(r => r.isActive).forEach(r => {
      const next = getNextExecution(r);
      if (next >= todayStart && next <= cutoff) {
        alerts.push({
          id:        r.id,
          tipo:      'pago',
          titulo:    r.name || r.description || 'Recurrente',
          monto:     r.amount,
          fecha:     next.toISOString().slice(0, 10),
          daysUntil: Math.floor((next - todayStart) / 86400000),
          fuente:    'recurring',
          emoji:     '💸',
        });
      }
    });

    // CxC pendientes → fecha de vencimiento (incluye vencidas como daysUntil negativo)
    getReceivables().filter(r => r.status !== 'paid' && r.dueDate).forEach(r => {
      const d       = new Date(r.dueDate + 'T12:00:00');
      const pagado  = (r.payments || []).reduce((s, p) => s + p.amount, 0);
      const pendiente = r.totalAmount - pagado;
      if (pendiente <= 0) return;

      const daysUntil = Math.floor((d - todayStart) / 86400000);
      if (daysUntil > days) return; // demasiado lejos

      alerts.push({
        id:        r.id,
        tipo:      'cobro',
        titulo:    r.clientName + (r.description ? ' · ' + r.description : ''),
        monto:     pendiente,
        fecha:     r.dueDate,
        daysUntil,
        fuente:    'receivable',
        emoji:     daysUntil < 0 ? '⚠️' : '💳',
        vencido:   daysUntil < 0,
      });
    });

    alerts.sort((a, b) => a.fecha.localeCompare(b.fecha));
    return alerts;
  }

  function exportSettings() {
    const s = getSettings();
    return JSON.stringify({
      cfConfigVersion: 1,
      exportedAt:      new Date().toISOString(),
      exportedBy:      s.userName || 'Principal',
      // Ajustes generales (empresa, moneda, usuario activo, lista de usuarios con PINs)
      settings:  load(KEYS.settings),
      // Seguridad global (requirePinForExport, etc.)
      security:  load(SEC_KEY),
      // Cuentas bancarias/efectivo
      accounts:  load(KEYS.accounts),
      // Categorías (por si el usuario agregó personalizadas)
      categories: load(KEYS.categories),
      // Presupuestos por categoría
      budgets:   load(KEYS.budgets),
      // Gastos recurrentes (plantillas, no transacciones generadas)
      recurring: load(KEYS.recurring),
    }, null, 2);
  }

  function importSettings(jsonStr) {
    const d = JSON.parse(jsonStr);
    if (!d.cfConfigVersion) throw new Error('Archivo de configuración no reconocido');

    // Restaurar todo
    if (d.settings)    save(KEYS.settings,    d.settings);
    if (d.security)    save(SEC_KEY,           d.security);
    if (d.accounts)    save(KEYS.accounts,     d.accounts);
    if (d.categories)  save(KEYS.categories,   d.categories);
    if (d.budgets)     save(KEYS.budgets,      d.budgets);
    if (d.recurring)   save(KEYS.recurring,    d.recurring);

    return {
      exportedBy: d.exportedBy || '—',
      exportedAt: d.exportedAt || '',
      userCount:  Array.isArray(d.settings?.users) ? d.settings.users.length : 1,
    };
  }

  return {
    init,
    getTransactions, getTransactionsByMonth, getTransactionById,
    addTransaction, updateTransaction, deleteTransaction,
    getMonthStats, getAllTimeBalance, getProfitStatement, getPendingLiabilities,
    getCategories, getCategoriesByType, getCategoryById, getCategoryTaxProfile,
    getAccounts, getAccountById, getLastAccount, setLastAccount,
    getInventory, addProduct, updateProduct, deleteProduct, getProductById,
    getSettings, updateSettings,
    getRecurrings, addRecurring, updateRecurring, deleteRecurring,
    getRecurringById, getNextExecution, processRecurringExpenses,
    getLast6MonthsStats,
    getBudgets, setBudget, deleteBudget, getBudgetStatus,
    getAccountBalances,
    getBalanceSheet,
    getSecuritySettings, isPinSet, setPinHash, verifyPin, removePin, setExportPin,
    getUserList, getUserEntry, userHasPin, setUserPin, verifyUserPin,
    removeUserPin, addUserToList, removeUserFromList,
    setUserReadOnly, isUserReadOnly,
    setUserAllowedScreens, getUserAllowedScreens, isScreenAllowed,
    generateRecoveryCode, setUserRecoveryCode, verifyRecoveryCode, userHasRecoveryCode,
    logAudit, getAuditLog, clearAuditLog,
    exportForSyncEncrypted, importFromUserDecrypted,
    getUsers, getUserNames, switchUser, exportForSync, importFromUser,
    getReceivables, getReceivableById, addReceivable, updateReceivable,
    deleteReceivable, addReceivablePayment, getReceivableStats,
    getFixedAssets, saveFixedAsset, deleteFixedAsset, calcAssetDepreciation,
    getFixedAssetsTotals, getAssetCategories,
    isOnboarded, markOnboarded,
    exportData, importData,
    exportSettings, importSettings,
    getUpcomingAlerts,
    getCompanyList, getActiveCompany, addCompany, switchToCompany, updateCompanyName, deleteCompany,
    calcIva, getIvaSuggestion, recordIvaMemory, IVA_DEFAULT,
    saveSmartDescEntry, getSmartDescSuggestions,
    savePhoto, getPhoto, deletePhoto,
    addFacturaCompra, getDeducibles, getDeducibleSummary,
    getTemplates, saveTemplate, deleteTemplate,
  };
})();
