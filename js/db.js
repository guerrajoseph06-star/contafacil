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
  };

  const load = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const save = (key, val) => localStorage.setItem(key, JSON.stringify(val));
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

  // ── Init / Migración ───────────────────────────────────────
  function init() {
    if (!load(KEYS.categories))   save(KEYS.categories,   DEFAULT_CATEGORIES);
    if (!load(KEYS.accounts))     save(KEYS.accounts,     DEFAULT_ACCOUNTS);
    if (!load(KEYS.settings))     save(KEYS.settings,     DEFAULT_SETTINGS);
    if (!load(KEYS.transactions)) save(KEYS.transactions, []);
    if (!load(KEYS.inventory))    save(KEYS.inventory,    []);
    _migrateCategorias();
    _migrateUserNames();
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
    _logAudit('create_tx', `${tx.type === 'income' ? '📈' : tx.type === 'expense' ? '📉' : '📋'} ${tx.description} · $${tx.amount}`);
    return tx;
  }

  function updateTransaction(id, newData) {
    let txs = load(KEYS.transactions) || [];
    const idx = txs.findIndex(t => t.id === id);
    if (idx < 0) return null;

    const old = txs[idx];
    _applyInventory(old, 'reverse');

    // Eliminar CMV anterior vinculado
    if (old.linkedCogsId) {
      txs = txs.filter(t => t.id !== old.linkedCogsId);
    }

    // Construir la tx actualizada (sin los campos de COGS anteriores)
    const { linkedCogsId: _lc, cogsAmount: _ca, ...cleanOld } = old;
    const updated = { ...cleanOld, ...newData, amount: parseFloat(newData.amount), id };

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

    _logAudit('delete_tx', `🗑️ ${tx.description} · $${tx.amount}`);
    save(KEYS.transactions, txs.filter(t => !toDelete.has(t.id)));
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
    txs.forEach(t => {
      if (t.type === 'income')    income     += t.amount;
      if (t.type === 'expense')   t.isCogs ? (cogs += t.amount) : (opExpenses += t.amount);
      if (t.type === 'liability') liabilities += t.amount;
    });
    const totalExpenses = cogs + opExpenses;
    return { income, cogs, opExpenses, totalExpenses, liabilities,
             grossProfit: income - cogs, netProfit: income - cogs - opExpenses };
  }

  function getAllTimeBalance() {
    const txs = getTransactions();
    let income = 0, cogs = 0, opExpenses = 0, liabilities = 0;
    txs.forEach(t => {
      if (t.type === 'income')    income     += t.amount;
      if (t.type === 'expense')   t.isCogs ? (cogs += t.amount) : (opExpenses += t.amount);
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
    const expByCat    = {}; // desglose por categoría

    txs.forEach(t => {
      if (t.type === 'income') {
        if (t.affectsInventory) salesRevenue += t.amount;
        else                    serviceIncome += t.amount;
      }
      if (t.type === 'expense') {
        if (t.isCogs) {
          cogs += t.amount;
        } else {
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
      hasCogs: cogs > 0,
    };
  }

  function getPendingLiabilities() {
    return getTransactions().filter(t => t.type === 'liability' && t.liabilityStatus !== 'paid');
  }

  // ── Categorías ─────────────────────────────────────────────
  // getCategoriesByType excluye las de sistema (no mostrar c-cmv al usuario)
  function getCategories() { return load(KEYS.categories) || DEFAULT_CATEGORIES; }
  function getCategoriesByType(type) {
    return getCategories().filter(c => c.type === type && !c.isSystem);
  }
  function getCategoryById(id) { return getCategories().find(c => c.id === id) || null; }

  // ── Cuentas ────────────────────────────────────────────────
  function getAccounts() { return load(KEYS.accounts) || DEFAULT_ACCOUNTS; }
  function getAccountById(id) { return getAccounts().find(a => a.id === id) || null; }

  // ── Configuración ──────────────────────────────────────────
  function getSettings() { return { ...DEFAULT_SETTINGS, ...(load(KEYS.settings) || {}) }; }
  function updateSettings(data) { save(KEYS.settings, { ...getSettings(), ...data }); }

  // ── Inventario ─────────────────────────────────────────────
  function getInventory() { return load(KEYS.inventory) || []; }

  function addProduct(data) {
    const inv = getInventory();
    const p = { id: uuid(), quantity: 0, unitCost: 0, unit: 'unidades', ...data };
    inv.push(p);
    save(KEYS.inventory, inv);
    _logAudit('create_product', `📦 ${p.name || 'Producto nuevo'}`);
    return p;
  }

  function updateProduct(id, data) {
    const inv = getInventory();
    const idx = inv.findIndex(p => p.id === id);
    if (idx < 0) return null;
    inv[idx] = { ...inv[idx], ...data, id };
    save(KEYS.inventory, inv);
    return inv[idx];
  }

  function deleteProduct(id) {
    const p = getInventory().find(x => x.id === id);
    _logAudit('delete_product', `🗑️ ${p ? p.name : id}`);
    save(KEYS.inventory, getInventory().filter(p => p.id !== id));
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
    txs.filter(t => t.type === 'expense' && !t.isCogs).forEach(t => {
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
      if (t.type === 'income' && t.account) {
        bal[t.account] = (bal[t.account] || 0) + t.amount;
      }
      if (t.type === 'expense' && t.account) {
        bal[t.account] = (bal[t.account] || 0) - t.amount;
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
  // allowedScreens: array de screens ['dashboard','journal','inventory','cartera','reports','settings']
  // null = sin restricción (acceso completo)
  const ALL_SCREENS = ['dashboard','journal','inventory','cartera','reports','settings'];

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
    // Retrocompatibilidad: si es readOnly, restringir reports y settings
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
    const plain = new TextEncoder().encode(exportForSync());
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
    if (!wrapper.cf_encrypted) return importFromUser(jsonStr); // sin cifrado

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
    return importFromUser(new TextDecoder().decode(decrypted));
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
  function exportForSync() {
    const s = getSettings();
    return JSON.stringify({
      syncVersion: 1,
      exportedBy:  s.userName || 'Principal',
      companyName: s.companyName,
      exported:    new Date().toISOString(),
      transactions: load(KEYS.transactions) || [],
      receivables:  load(KEYS.receivables)  || [],
    }, null, 2);
  }

  // Importa el archivo de otro usuario: une transacciones y CxC sin duplicar por ID
  function importFromUser(jsonStr) {
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

    return { addedTxs, addedRecs, sourceUser };
  }

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
    const totalAssets        = totalCurrentAssets; // Activos fijos: próxima versión

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
      totalCurrentAssets, totalAssets,
      pendingLiabs, totalLiabilities,
      equity,
    };
  }

  // ── Onboarding ─────────────────────────────────────────────
  function isOnboarded() { return !!localStorage.getItem(KEYS.onboarded); }
  function markOnboarded() { localStorage.setItem(KEYS.onboarded, '1'); }

  // ── Exportar / Importar ────────────────────────────────────
  function exportData() {
    return JSON.stringify({
      version: 3, exported: new Date().toISOString(),
      transactions: load(KEYS.transactions),
      categories:   load(KEYS.categories),
      accounts:     load(KEYS.accounts),
      inventory:    load(KEYS.inventory),
      settings:     load(KEYS.settings),
    }, null, 2);
  }

  function importData(jsonStr) {
    const d = JSON.parse(jsonStr);
    if (d.transactions) save(KEYS.transactions, d.transactions);
    if (d.categories)   save(KEYS.categories,   d.categories);
    if (d.accounts)     save(KEYS.accounts,      d.accounts);
    if (d.inventory)    save(KEYS.inventory,     d.inventory);
    if (d.settings)     save(KEYS.settings,      d.settings);
  }

  return {
    init,
    getTransactions, getTransactionsByMonth, getTransactionById,
    addTransaction, updateTransaction, deleteTransaction,
    getMonthStats, getAllTimeBalance, getProfitStatement, getPendingLiabilities,
    getCategories, getCategoriesByType, getCategoryById,
    getAccounts, getAccountById,
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
    isOnboarded, markOnboarded,
    exportData, importData,
  };
})();
