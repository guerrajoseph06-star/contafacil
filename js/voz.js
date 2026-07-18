/* ContaFácil Pro — Intérprete de dictado por voz
 * ════════════════════════════════════════════════
 * 100% LOCAL: convierte el texto dictado en un asiento estructurado sin
 * internet, sin APIs y sin costo. Solo aplica a los 5 asientos contables
 * (ingreso, gasto, traslado, deuda, retiro) — nunca guarda solo: el
 * resultado SIEMPRE se revisa en el formulario antes de Guardar.
 *
 * Productos del inventario: solo por NOMBRE EXACTO o CÓDIGO (SKU) tal como
 * los guardó el usuario — sin interpretaciones creativas (regla del dueño).
 */
const VOZ = (() => {

  // Normaliza: minúsculas, sin tildes, sin signos raros
  const norm = s => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s.,]/g, ' ').replace(/\s+/g, ' ').trim();

  // ── Números en palabras (0–999 y "mil", + "con X" para centavos) ────────
  const NUM = {
    cero:0, un:1, uno:1, una:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7,
    ocho:8, nueve:9, diez:10, once:11, doce:12, trece:13, catorce:14, quince:15,
    dieciseis:16, diecisiete:17, dieciocho:18, diecinueve:19, veinte:20,
    veintiun:21, veintiuno:21, veintidos:22, veintitres:23, veinticuatro:24,
    veinticinco:25, veintiseis:26, veintisiete:27, veintiocho:28, veintinueve:29,
    treinta:30, cuarenta:40, cincuenta:50, sesenta:60, setenta:70, ochenta:80,
    noventa:90, cien:100, ciento:100, doscientos:200, trescientos:300,
    cuatrocientos:400, quinientos:500, seiscientos:600, setecientos:700,
    ochocientos:800, novecientos:900,
  };

  // Convierte una secuencia de palabras-número contiguas en un valor
  function wordsToNumber(tokens, start) {
    let val = 0, i = start, consumed = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t === 'y') { i++; consumed++; continue; }
      if (t === 'mil') { val = (val || 1) * 1000; i++; consumed++; continue; }
      if (NUM[t] !== undefined) { val += NUM[t]; i++; consumed++; continue; }
      break;
    }
    return consumed > 0 ? { value: val, consumed } : null;
  }

  // Busca el monto: primero dígitos ("20", "20.50"), luego palabras ("veinte con cincuenta")
  function findAmount(text) {
    const digit = text.match(/(\d+(?:[.,]\d{1,2})?)/);
    if (digit) return { amount: parseFloat(digit[1].replace(',', '.')), raw: digit[1] };
    const tokens = text.split(' ');
    for (let i = 0; i < tokens.length; i++) {
      const r = wordsToNumber(tokens, i);
      if (r && r.value > 0) {
        let amount = r.value;
        // "con cincuenta" → centavos
        const j = i + r.consumed;
        if (tokens[j] === 'con') {
          const cents = wordsToNumber(tokens, j + 1);
          if (cents && cents.value < 100) amount += cents.value / 100;
        }
        return { amount, raw: tokens.slice(i, i + r.consumed).join(' ') };
      }
    }
    return null;
  }

  // ── Tipo de asiento (el orden importa: lo específico primero) ───────────
  const TYPES = [
    ['withdrawal', /\b(retiro|retire|retirar)\b/],
    ['transfer',   /\b(traslado|traslade|deposite|deposito|transferi|transferencia de|pase de|pasar de)\b/],
    ['liability',  /\b(deuda|prestamo|presto|prestaron|debo|fiado|fie)\b/],
    ['expense',    /\b(gasto|gaste|pague|pagamos|compre|compra de|pago de)\b/],
    ['income',     /\b(ingreso|ingresa|venta|vendi|vendimos|cobre|cobramos|recibi)\b/],
  ];

  // ── Cuentas (palabras genéricas; los nombres reales del usuario pesan más) ──
  const ACCOUNTS = [
    ['a-caja',    /\b(efectivo|caja|cash)\b/],
    ['a-banco',   /\b(banco|bancaria|transferencia|cuenta)\b/],
    ['a-tarjeta', /\b(tarjeta)\b/],
    ['a-digital', /\b(billetera|digital|deuna|de una|payphone)\b/],
  ];

  function findAccounts(text) {
    const hits = []; // { id, index }
    // nombres reales de las cuentas del usuario (mandan sobre las genéricas)
    try {
      DB.getAccounts().forEach(a => {
        const n = norm(a.name);
        const idx = n ? text.indexOf(n) : -1;
        if (idx >= 0) hits.push({ id: a.id, index: idx, len: n.length });
      });
    } catch (e) {}
    ACCOUNTS.forEach(([id, re]) => {
      const m = text.match(re);
      if (m && !hits.some(h => h.id === id)) hits.push({ id, index: m.index, len: m[0].length });
    });
    hits.sort((a, b) => a.index - b.index);
    return hits;
  }

  // ── IVA ─────────────────────────────────────────────────────────────────
  function findIva(text) {
    if (/\b(mas iva|más iva)\b/.test(text) || /\+\s*iva/.test(text)) return 'IVA_NO_INCLUIDO';
    if (/\b(con iva|iva incluido|incluye iva|incluido el iva)\b/.test(text)) return 'IVA_INCLUIDO';
    if (/\bsin iva\b/.test(text)) return 'SIN_IVA';
    return null;
  }

  // ── Producto del inventario: SOLO nombre exacto o SKU (regla del dueño) ──
  function findProduct(text) {
    let best = null;
    try {
      DB.getInventory().forEach(p => {
        const candidates = [norm(p.name), norm(p.sku || '')].filter(c => c.length >= 3);
        candidates.forEach(c => {
          const idx = text.indexOf(c);
          if (idx >= 0 && (!best || c.length > best.len)) best = { id: p.id, index: idx, len: c.length };
        });
      });
    } catch (e) {}
    if (!best) return null;
    // cantidad: número justo antes del nombre ("dos blusa talla m" / "3 blusa…")
    const before = text.slice(0, best.index).trim().split(' ');
    const lastTok = before[before.length - 1] || '';
    let qty = 1;
    if (/^\d+$/.test(lastTok)) qty = parseInt(lastTok, 10);
    else if (NUM[lastTok] !== undefined && NUM[lastTok] > 0) qty = NUM[lastTok];
    return { id: best.id, qty };
  }

  // ── Descripción: lo que queda tras retirar lo ya entendido ──────────────
  function buildDescription(text, consumed) {
    let d = ' ' + text + ' ';
    consumed.forEach(frag => { if (frag) d = d.replace(frag, ' '); });
    d = d
      .replace(/\b(ingreso|ingresa|venta|vendi|vendimos|cobre|cobramos|recibi|gasto|gaste|pague|pagamos|compre|deuda|prestamo|presto|debo|retiro|retire|traslado|traslade|deposite|transferi)\b/g, ' ')
      .replace(/\b(dolares|dolar|usd|pesos|pagado|pagada|cobrado|cobrada)\b/g, ' ')
      .replace(/\b(en|con|por|de|del|la|el|los|las|a|al|un|una|listo|ok)\b/g, ' ')
      .replace(/\b(efectivo|caja|banco|bancaria|tarjeta|billetera|digital|transferencia|cuenta)\b/g, ' ')
      .replace(/\b(mas iva|con iva|sin iva|iva incluido|incluye iva|iva)\b/g, ' ')
      .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!d) return '';
    return d.charAt(0).toUpperCase() + d.slice(1);
  }

  // ── Intérprete principal ────────────────────────────────────────────────
  function parse(rawText) {
    const escuchado = String(rawText || '').trim();
    const text = norm(escuchado);
    const faltantes = [];
    const consumed = [];

    // tipo
    let type = null;
    for (const [t, re] of TYPES) { if (re.test(text)) { type = t; break; } }
    if (!type) { type = 'income'; faltantes.push('el tipo (asumí Ingreso)'); }

    // monto
    const amt = findAmount(text);
    if (amt) consumed.push(amt.raw); else faltantes.push('el monto');

    // cuentas (traslado usa dos)
    const accs = findAccounts(text);
    let account = null, fromAccount = null, toAccount = null;
    if (type === 'transfer') {
      if (accs.length >= 2) { fromAccount = accs[0].id; toAccount = accs[1].id; }
      else if (accs.length === 1) { fromAccount = accs[0].id; faltantes.push('la cuenta destino'); }
      else faltantes.push('las cuentas (origen y destino)');
    } else {
      if (accs.length) account = accs[0].id;
      // la deuda no lleva cuenta en su formulario; retiro/ingreso/gasto sí
      else if (type !== 'liability') faltantes.push('la cuenta');
    }

    // IVA (solo ingreso/gasto)
    let ivaType = null;
    if (type === 'income' || type === 'expense') {
      ivaType = findIva(text);
      if (!ivaType) faltantes.push('el IVA (quedó en Sin IVA)');
    }

    // producto exacto (solo ingreso/gasto)
    const product = (type === 'income' || type === 'expense') ? findProduct(text) : null;

    // descripción
    const description = buildDescription(text, consumed);
    if (!description && !product) faltantes.push('la descripción');

    return {
      escuchado, type,
      amount: amt ? amt.amount : null,
      description, account, fromAccount, toAccount,
      ivaType, product: product ? product.id : null, qty: product ? product.qty : null,
      faltantes,
    };
  }

  return { parse };
})();
