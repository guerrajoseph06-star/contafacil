/**
 * ContaFácil Pro — Módulo Tributario BETA (Ecuador)
 * ──────────────────────────────────────────────────────────────────────────────
 * EXPERIMENTAL. Asistencia tributaria simple para microempresas ecuatorianas.
 *
 * PRINCIPIOS DE DISEÑO (no romper):
 *  - 100% DESACOPLADO: este módulo SOLO LEE de DB (getters). Nunca escribe ni
 *    modifica la contabilidad del usuario.
 *  - SIN BACKEND: no envía nada al SRI, no firma, no presenta. Solo prepara
 *    BORRADORES REFERENCIALES para revisión humana.
 *  - VERSIONADO: las tarifas/tablas viven en TAX_CONFIG. Una reforma tributaria
 *    = editar una tabla, sin tocar la lógica.
 *
 * Depende de globals ya definidos en app.js: DB, fmt, escHtml, navigate,
 * showToast, closeSettingsSheet. (tax.js se carga DESPUÉS de app.js.)
 */
const SRI = (() => {

  // ── ① Configuración tributaria VERSIONADA ───────────────────────────────────
  // Cada entrada aplica desde 'vigenciaDesde'. forPeriod() elige la más reciente
  // cuya vigencia sea <= al periodo consultado. Reforma futura = nueva entrada.
  const TAX_CONFIG = {
    versions: [
      {
        vigenciaDesde: '2024-04-01',
        ivaPct: 15,                         // IVA general Ecuador (SRI) desde abr-2024
        // Tabla RIMPE Emprendedores (reservada para una fase futura, no se usa aún)
        rimpeEmprendedor: [
          { hasta: 20000,  base: 0,    pct: 0    },
          { hasta: 50000,  base: 0,    pct: 0.01 },
          { hasta: 75000,  base: 300,  pct: 0.015 },
          { hasta: 100000, base: 675,  pct: 0.02 },
          { hasta: 300000, base: 1175, pct: 0.02 },
        ],
        rimpeTopeIngresos: 300000,          // límite anual del régimen RIMPE
      },
    ],
    forPeriod(year, month) {
      const key = `${year}-${String(month).padStart(2, '0')}-01`;
      // la última versión cuya vigencia sea <= al periodo (orden ascendente)
      let chosen = this.versions[0];
      this.versions.forEach(v => { if (v.vigenciaDesde <= key) chosen = v; });
      return chosen;
    },
  };

  // ── ② Aviso legal (se acepta una sola vez por dispositivo) ───────────────────
  const LEGAL_KEY = 'cf_beta_legal_ok';
  const legal = {
    isAccepted: () => localStorage.getItem(LEGAL_KEY) === '1',
    accept:     () => localStorage.setItem(LEGAL_KEY, '1'),
  };

  // ── Estado de periodo del borrador IVA ───────────────────────────────────────
  let _y = new Date().getFullYear();
  let _m = new Date().getMonth() + 1;

  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  // ── ③ Motor de cálculo IVA (Formulario 104, subconjunto referencial) ─────────
  const ivaModule = {
    /**
     * Calcula los bloques del borrador 104 leyendo SOLO datos ya registrados.
     * Modelo real de la app:
     *   - tx normal (income/expense, !isIva, !isCogs): amount = BASE imponible
     *   - tx.ivaType: 'SIN_IVA' | 'IVA_NO_INCLUIDO' | 'IVA_INCLUIDO'
     *   - asiento IVA vinculado: isIva=true, ivaDirection='cobrado'|'credito',
     *     amount = valor del IVA
     */
    compute104(year, month) {
      const txs = DB.getTransactionsByMonth(year, month);
      const cfg = TAX_CONFIG.forPeriod(year, month);

      let ventas15 = 0, ventas0 = 0, ivaVentas = 0;
      let compras15 = 0, compras0 = 0, ivaCompras = 0;
      let countVentas = 0, countCompras = 0;
      let ivaRevisable = 0; // IVA incluido en el crédito pero que conviene revisar (ej. consumo personal)

      txs.forEach(t => {
        if (t.isCogs) return;                       // costo interno: no es IVA
        if (t.isIva) {                              // asiento de IVA
          if (t.ivaDirection === 'cobrado') ivaVentas  += t.amount;
          else                              ivaCompras += t.amount;
          return;
        }
        const gravado = t.ivaType && t.ivaType !== 'SIN_IVA';
        if (t.type === 'income') {
          countVentas++;
          if (gravado) ventas15 += t.amount; else ventas0 += t.amount;
        } else if (t.type === 'expense') {
          countCompras++;
          if (gravado) {
            compras15 += t.amount;
            // NO se excluye: el crédito se mantiene completo; solo se SEÑALA para revisión humana.
            const prof = DB.getCategoryTaxProfile(t.category);
            if (prof.creditoRevisable && t.ivaAmount) ivaRevisable += t.ivaAmount;
          } else {
            compras0 += t.amount;
          }
        }
      });

      const neto = ivaVentas - ivaCompras;
      return {
        year, month, ivaPct: cfg.ivaPct,
        ventas15, ventas0, ventasTotal: ventas15 + ventas0, ivaVentas,
        compras15, compras0, comprasTotal: compras15 + compras0, ivaCompras,
        ivaPorPagar:   neto > 0 ? neto : 0,
        creditoAFavor: neto < 0 ? -neto : 0,
        ivaRevisable,
        countVentas, countCompras,
        movimientos: countVentas + countCompras,
      };
    },

    /** Detecta inconsistencias simples y útiles (no afirma exactitud) */
    detect(d) {
      const w = [];
      const pushW = (level, msg) => w.push({ level, msg });

      if (d.movimientos === 0) {
        pushW('info', 'No hay movimientos registrados este mes. Tu declaración iría en cero.');
        return w;
      }
      if (d.ivaVentas > 0 && d.ventas15 === 0)
        pushW('warn', 'Hay IVA cobrado pero no se ve la base de ventas gravadas. Revisa tus ventas del mes.');
      if (d.ivaCompras > 0 && d.compras15 === 0)
        pushW('warn', 'Hay IVA en compras pero sin base de compras gravadas registrada.');
      if (d.creditoAFavor > 0)
        pushW('info', `Tu IVA de compras supera al de ventas: tendrías ${fmt(d.creditoAFavor)} de crédito tributario a favor para el próximo periodo.`);
      if (d.ivaRevisable > 0)
        pushW('warn', `De tu crédito de IVA, ${fmt(d.ivaRevisable)} proviene de gastos a revisar (ej. consumo personal). El borrador lo incluye, pero confírmalo con tu contador.`);

      // Chequeo de coherencia: el IVA de ventas debería rondar el % sobre la base
      if (d.ventas15 > 0) {
        const esperado = d.ventas15 * (d.ivaPct / 100);
        if (Math.abs(esperado - d.ivaVentas) > Math.max(1, esperado * 0.05))
          pushW('warn', 'El IVA de ventas no coincide con el ' + d.ivaPct + '% de la base. Puede haber ventas con tarifa mixta — revísalo.');
      }
      if (w.length === 0)
        pushW('ok', 'No detectamos inconsistencias evidentes en los datos registrados.');
      return w;
    },
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  UI
  // ════════════════════════════════════════════════════════════════════════════

  // Abre la sección Beta (hoja de ajustes). Punto de entrada desde Ajustes.
  function openBeta() {
    const sheet   = document.getElementById('settings-sheet');
    const content = document.getElementById('settings-sheet-content');
    if (!content || !sheet) return;

    content.innerHTML = `
      <div class="sheet-handle"></div>
      <div style="display:flex; align-items:center; gap:9px; margin-bottom:6px;">
        <h3 class="sheet-title" style="margin:0;">⚗️ Funciones Experimentales</h3>
        <span style="font-size:10px; font-weight:800; background:#7c3aed; color:#fff;
          border-radius:6px; padding:2px 7px; letter-spacing:.04em;">BETA</span>
      </div>
      <p style="font-size:13px; color:var(--gray-500); line-height:1.55; margin-bottom:16px;">
        Asistencia tributaria experimental para microempresas del Ecuador. Convierte
        tu contabilidad ya registrada en borradores de referencia. <strong>No reemplaza
        al SRI ni a tu contador.</strong>
      </p>

      <button onclick="SRI.openIva104()" style="width:100%; text-align:left; background:var(--white);
        border:1.5px solid var(--gray-200); border-radius:14px; padding:15px; cursor:pointer;
        display:flex; align-items:center; gap:13px; margin-bottom:10px;">
        <span style="font-size:28px; flex-shrink:0;">🧾</span>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800; font-size:15px; color:var(--gray-900);">Borrador IVA · Formulario 104</div>
          <div style="font-size:12px; color:var(--gray-500); margin-top:2px; line-height:1.4;">
            Estima tu IVA del mes a partir de tus ventas y compras.</div>
        </div>
        <span style="color:var(--gray-300); font-size:20px;">›</span>
      </button>

      <div style="background:var(--gray-50); border-radius:12px; padding:13px 15px; margin-top:6px;">
        <div style="font-size:11px; font-weight:700; color:var(--gray-400); text-transform:uppercase;
          letter-spacing:.05em; margin-bottom:8px;">🔒 Próximamente</div>
        ${['📊 Estimador de Renta (RIMPE)', '💡 Alertas tributarias inteligentes']
          .map(t => `<div style="font-size:13px; color:var(--gray-400); padding:5px 0;">${t}</div>`).join('')}
      </div>

      <button class="btn btn-secondary btn-block mt-16" onclick="closeSettingsSheet()">Cerrar</button>
    `;
    sheet.classList.add('open');
  }

  // Verifica el aviso legal antes de abrir cualquier herramienta tributaria
  function _withLegal(cb) {
    if (legal.isAccepted()) { cb(); return; }
    const sheet   = document.getElementById('settings-sheet');
    const content = document.getElementById('settings-sheet-content');
    if (!content || !sheet) return;

    content.innerHTML = `
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">⚠️ Antes de continuar</h3>
      <div style="background:#fffbeb; border:1.5px solid #fcd34d; border-radius:12px;
        padding:14px 16px; font-size:13px; color:#92400e; line-height:1.6; margin-bottom:16px;">
        Esta es una <strong>herramienta experimental</strong> que genera
        <strong>borradores referenciales</strong> a partir de tus datos.
        <ul style="margin:10px 0 0 18px; padding:0;">
          <li>No es una declaración oficial.</li>
          <li>No envía ni presenta nada ante el SRI.</li>
          <li>La exactitud depende de cómo registraste tu contabilidad.</li>
          <li>Revisa siempre con tu contador antes de declarar.</li>
        </ul>
      </div>
      <p style="font-size:12px; color:var(--gray-500); line-height:1.5; margin-bottom:16px;">
        Al continuar, entiendes que la responsabilidad tributaria es tuya y de tu contador.
      </p>
      <button class="btn btn-primary btn-block" onclick="SRI._acceptLegal()">Entiendo, continuar</button>
      <button class="btn btn-secondary btn-block mt-8" onclick="SRI.openBeta()">Volver</button>
    `;
    sheet.classList.add('open');
  }

  function _acceptLegal() {
    legal.accept();
    closeSettingsSheet();
    navigate('tax-iva');
  }

  // Abre el borrador IVA (verificando aviso legal)
  function openIva104() {
    _withLegal(() => { closeSettingsSheet(); navigate('tax-iva'); });
  }

  function ivaPrevMonth() { _m--; if (_m < 1)  { _m = 12; _y--; } renderIva104(); }
  function ivaNextMonth() { _m++; if (_m > 12) { _m = 1;  _y++; } renderIva104(); }

  // Tarjeta de un bloque de casillero (etiqueta + casillero referencial + monto)
  function _block(label, casillero, value, color) {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center;
        padding:12px 0; border-bottom:1px solid var(--gray-100);">
        <div style="min-width:0;">
          <div style="font-size:14px; font-weight:600; color:var(--gray-800);">${label}</div>
          ${casillero ? `<div style="font-size:11px; color:var(--gray-400); margin-top:1px;">Casillero ${casillero} · referencial</div>` : ''}
        </div>
        <div style="font-size:15px; font-weight:800; color:${color || 'var(--gray-900)'}; white-space:nowrap;">${fmt(value)}</div>
      </div>`;
  }

  // Renderiza la pantalla del borrador IVA 104
  function renderIva104() {
    const d = ivaModule.compute104(_y, _m);
    const warnings = ivaModule.detect(d);
    const body = document.getElementById('tax-iva-body');
    if (!body) return;

    const isRimpeHint = ''; // (sin lógica RIMPE aún)
    const warnColors = { warn:'#92400e', info:'#1e40af', ok:'#166534' };
    const warnBg     = { warn:'#fffbeb', info:'#eff6ff', ok:'#f0fdf4' };
    const warnBorder = { warn:'#fcd34d', info:'#bfdbfe', ok:'#86efac' };
    const warnIcon   = { warn:'⚠️', info:'ℹ️', ok:'✅' };

    body.innerHTML = `
      <!-- Navegador de mes -->
      <div class="month-nav">
        <button class="month-nav-btn" onclick="SRI.ivaPrevMonth()">‹</button>
        <div class="month-name">${MESES[_m - 1]} ${_y}</div>
        <button class="month-nav-btn" onclick="SRI.ivaNextMonth()">›</button>
      </div>

      <!-- Banner BORRADOR NO OFICIAL -->
      <div style="display:flex; align-items:center; gap:10px; background:#fef2f2;
        border:1.5px solid #fca5a5; border-radius:12px; padding:11px 14px; margin-bottom:14px;">
        <span style="font-size:18px;">📌</span>
        <div style="font-size:12px; color:#991b1b; font-weight:600; line-height:1.45;">
          BORRADOR NO OFICIAL · valor referencial.<br>
          <span style="font-weight:400;">Revísalo con tu contador antes de declarar en el SRI.</span>
        </div>
      </div>

      <!-- Resumen principal: IVA estimado -->
      <div style="background:linear-gradient(135deg,#2563eb,#1e40af); border-radius:16px;
        padding:20px; color:#fff; margin-bottom:14px;">
        <div style="font-size:13px; opacity:.85;">IVA estimado ${d.ivaPorPagar > 0 ? 'por pagar' : 'a favor'} este mes</div>
        <div style="font-size:34px; font-weight:800; margin-top:4px;">
          ${fmt(d.ivaPorPagar > 0 ? d.ivaPorPagar : d.creditoAFavor)}
        </div>
        <div style="font-size:12px; opacity:.8; margin-top:6px;">
          ${d.ivaPorPagar > 0
            ? `IVA cobrado ${fmt(d.ivaVentas)} − crédito ${fmt(d.ivaCompras)}`
            : d.creditoAFavor > 0
              ? `Crédito tributario a favor para el próximo mes`
              : `Sin IVA a pagar este mes`}
        </div>
      </div>

      <!-- Ventas -->
      <div class="card">
        <div class="card-title" style="margin-bottom:6px;">🟢 Ventas / Ingresos</div>
        ${_block('Ventas gravadas ' + d.ivaPct + '% (base)', '411', d.ventas15)}
        ${_block('Ventas tarifa 0%', '413', d.ventas0)}
        ${_block('IVA cobrado en ventas', '429', d.ivaVentas, 'var(--success)')}
      </div>

      <!-- Compras -->
      <div class="card">
        <div class="card-title" style="margin-bottom:6px;">🔴 Compras / Gastos</div>
        ${_block('Compras gravadas ' + d.ivaPct + '% (base)', '510', d.compras15)}
        ${_block('Compras tarifa 0%', '517', d.compras0)}
        ${_block('Crédito tributario (IVA compras)', '520', d.ivaCompras, 'var(--primary)')}
      </div>

      <!-- Inconsistencias -->
      <div style="margin:14px 0 8px; font-size:12px; font-weight:700; color:var(--gray-500);
        text-transform:uppercase; letter-spacing:.05em;">Revisión automática</div>
      ${warnings.map(wn => `
        <div style="display:flex; gap:10px; background:${warnBg[wn.level]};
          border:1px solid ${warnBorder[wn.level]}; border-radius:10px; padding:11px 13px;
          margin-bottom:8px; font-size:13px; color:${warnColors[wn.level]}; line-height:1.5;">
          <span>${warnIcon[wn.level]}</span><span style="flex:1;">${escHtml(wn.msg)}</span>
        </div>`).join('')}

      <!-- Exportar -->
      <button class="btn btn-primary btn-block mt-16" onclick="SRI.ivaExportPdf()">
        📄 Exportar PDF de referencia
      </button>

      <div style="font-size:11px; color:var(--gray-400); text-align:center; margin-top:14px; line-height:1.5;">
        Este borrador no incluye proporcionalidad, crédito de meses anteriores,
        retenciones ni exportaciones. Consúltalo con tu contador.
      </div>
    `;
  }

  // ── ⑤ Exportar PDF de referencia (ventana autocontenida, sin tocar el CSS de impresión global) ──
  function ivaExportPdf() {
    const d = ivaModule.compute104(_y, _m);
    const s = DB.getSettings();

    const row = (label, val, strong) => `
      <tr>
        <td style="padding:8px 10px; border-bottom:1px solid #e5e7eb; ${strong ? 'font-weight:700;' : ''}">${label}</td>
        <td style="padding:8px 10px; border-bottom:1px solid #e5e7eb; text-align:right; ${strong ? 'font-weight:800;' : ''}">${fmt(val)}</td>
      </tr>`;

    const html = `
      <!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>Borrador IVA ${MESES[_m - 1]} ${_y}</title></head>
      <body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif; color:#111827; max-width:720px; margin:0 auto; padding:32px;">
        <div style="border-bottom:2px solid #1d4ed8; padding-bottom:14px; margin-bottom:8px;">
          <h1 style="font-size:22px; color:#1d4ed8; margin:0;">Borrador IVA — Formulario 104</h1>
          <div style="color:#6b7280; font-size:13px; margin-top:4px;">
            ${escHtml(s.companyName || 'Mi Negocio')} · ${MESES[_m - 1]} ${_y} · IVA ${d.ivaPct}%
          </div>
        </div>
        <div style="background:#fef2f2; border:1.5px solid #fca5a5; color:#991b1b; border-radius:8px;
          padding:10px 12px; font-size:12px; margin:14px 0;">
          <strong>BORRADOR NO OFICIAL — valor referencial.</strong> No es una declaración válida ante el SRI.
          Revísalo con tu contador. La responsabilidad tributaria es del contribuyente.
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:10px;">
          <tr style="background:#f3f4f6;"><td colspan="2" style="padding:7px 10px; font-weight:700;">Ventas / Ingresos</td></tr>
          ${row('Ventas gravadas ' + d.ivaPct + '% (base) · casillero 411 ref.', d.ventas15)}
          ${row('Ventas tarifa 0% · casillero 413 ref.', d.ventas0)}
          ${row('IVA cobrado en ventas · casillero 429 ref.', d.ivaVentas, true)}
          <tr style="background:#f3f4f6;"><td colspan="2" style="padding:7px 10px; font-weight:700;">Compras / Gastos</td></tr>
          ${row('Compras gravadas ' + d.ivaPct + '% (base) · casillero 510 ref.', d.compras15)}
          ${row('Compras tarifa 0% · casillero 517 ref.', d.compras0)}
          ${row('Crédito tributario (IVA compras) · casillero 520 ref.', d.ivaCompras, true)}
          <tr style="background:#eff6ff;">
            ${d.ivaPorPagar > 0
              ? `<td style="padding:11px 10px; font-weight:800;">IVA estimado por pagar</td>
                 <td style="padding:11px 10px; text-align:right; font-weight:800; color:#1d4ed8;">${fmt(d.ivaPorPagar)}</td>`
              : `<td style="padding:11px 10px; font-weight:800;">Crédito tributario a favor</td>
                 <td style="padding:11px 10px; text-align:right; font-weight:800; color:#16a34a;">${fmt(d.creditoAFavor)}</td>`}
          </tr>
        </table>
        <div style="margin-top:22px; font-size:11px; color:#9ca3af; border-top:1px solid #e5e7eb; padding-top:10px;">
          Generado por ContaFácil Pro (módulo experimental). No incluye proporcionalidad,
          crédito de periodos anteriores, retenciones ni exportaciones.
        </div>
        <script>setTimeout(function(){window.print();}, 350);<\/script>
      </body></html>`;
    if (!Platform.printHTML(html)) { showToast('⚠️ Permite ventanas emergentes para exportar', 3000); return; }
    DB.logAudit('beta_iva_pdf', `🧾 Borrador IVA ${MESES[_m - 1]} ${_y}`);
  }

  // API pública del módulo
  return {
    TAX_CONFIG, legal,
    iva: ivaModule,
    openBeta, openIva104, renderIva104,
    ivaPrevMonth, ivaNextMonth, ivaExportPdf,
    _acceptLegal,
  };
})();
