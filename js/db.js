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
    onboarded:    'cf_onboarded',
  };

  const load = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const save = (key, val) => localStorage.setItem(key, JSON.stringify(val));
  function uuid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

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
  };

  // ── Init / Migración ───────────────────────────────────────
  function init() {
    if (!load(KEYS.categories))   save(KEYS.categories,   DEFAULT_CATEGORIES);
    if (!load(KEYS.accounts))     save(KEYS.accounts,     DEFAULT_ACCOUNTS);
    if (!load(KEYS.settings))     save(KEYS.settings,     DEFAULT_SETTINGS);
    if (!load(KEYS.transactions)) save(KEYS.transactions, []);
    if (!load(KEYS.inventory))    save(KEYS.inventory,    []);
    _migrateCategorias();
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
    const tx = { id: uuid(), createdAt: new Date().toISOString(), ...data, amount };

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

  function deleteProduct(id) { save(KEYS.inventory, getInventory().filter(p => p.id !== id)); }
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
    isOnboarded, markOnboarded,
    exportData, importData,
  };
})();
