/* =====================================================
   IMPORTADOR DE EXTRATOS BANCÁRIOS — Conciliacão
   Formatos: OFX, OFD (Febraban) e CSV (internet banking)
   Retorna transações normalizadas:
   { id, data, dataRaw, valor(positivo), tipo:'C'|'D',
     descricao, fitid, e2e, txid, isPix, origem }
===================================================== */

const normalizeCsvHeader = (h) =>
  String(h || '')
    .trim()
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"]/g, '');

const parseMoney = (raw) => {
  if (raw === null || raw === undefined || raw === '') return 0;
  let s = String(raw).trim().replace(/\s/g, '');
  if (s === '') return 0;
  let sign = 1;
  if (s.startsWith('-') || s.startsWith('(')) sign = -1;
  s = s.replace(/^[-+()]/g, '').replace(/[R$\s]/g, '');
  if (!s) return 0;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let num = 0;
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      num = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    } else {
      num = parseFloat(s.replace(/,/g, ''));
    }
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) num = parseFloat(s.replace(/,/g, ''));
    else num = parseFloat(s.replace(',', '.'));
  } else {
    num = parseFloat(s);
  }
  if (isNaN(num)) num = 0;
  return sign * num;
};

const normalizeDate = (raw) => {
  if (!raw) return '';
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = String(m[3]).length === 2 ? '20' + m[3] : m[3];
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  return s.slice(0, 10);
};

const toDateObj = (ymd) => {
  if (!ymd) return null;
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
};

export const daysBetween = (a, b) => {
  const da = toDateObj(a);
  const db = toDateObj(b);
  if (!da || !db) return 9999;
  return Math.round((db - da) / 86400000);
};

const extractPixInfo = (desc = '') => {
  const s = String(desc || '');
  const out = { e2e: '', txid: '', isPix: false };
  if (s.toUpperCase().includes('PIX')) out.isPix = true;
  const e2e = s.match(/([0-9A-Fa-f]{32})/);
  if (e2e) out.e2e = e2e[1].toUpperCase();
  const txid = s.match(/txid[: ]*([0-9A-Za-z]{1,25})/i);
  if (txid) out.txid = txid[1];
  return out;
};

const fingerprint = (t) => {
  const h = `${t.data}|${t.valor}|${t.tipo}|${t.fitid || ''}|${t.descricao || ''}`;
  let hash = 0;
  for (let i = 0; i < h.length; i++) hash = ((hash << 5) - hash + h.charCodeAt(i)) | 0;
  return 'tx_' + (hash >>> 0).toString(36);
};

export const fingerprintList = (txs) => {
  const h = txs.map(t => fingerprint(t)).sort().join('|');
  let hash = 0;
  for (let i = 0; i < h.length; i++) hash = ((hash << 5) - hash + h.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36) + '_' + txs.length;
};

const dedup = (txs) => {
  const seen = new Set();
  const out = [];
  for (const t of txs) {
    const fp = fingerprint(t);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push({ ...t, id: fp });
  }
  return out;
};

/* ---------------- OFX ---------------- */
const parseOfx = (content) => {
  const out = [];
  const blocks = content.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/g) || [];
  for (const block of blocks) {
    const inner = block.replace(/^<STMTTRN>/i, '').replace(/<\/STMTTRN>\s*$/i, '');
    const fields = {};
    const tagRe = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let mm;
    while ((mm = tagRe.exec(inner))) fields[mm[1].toUpperCase()] = mm[2].trim();
    const rawAmount = fields.TRNAMT != null ? fields.TRNAMT : '';
    const trntype = (fields.TRNTYPE || '').toUpperCase();
    const desc = fields.MEMO || fields.NAME || '';
    let signed = parseMoney(rawAmount);
    let tipo = signed >= 0 ? 'C' : 'D';
    if (/DEBIT|DEBT|DÉBIT/.test(trntype) && signed === 0) tipo = 'D';
    const pix = extractPixInfo(desc);
    out.push({
      data: normalizeDate(fields.DTPOSTED || ''),
      dataRaw: fields.DTPOSTED || '',
      valor: Math.abs(signed),
      tipo,
      descricao: desc || '',
      fitid: fields.FITID || '',
      e2e: pix.e2e || '',
      txid: pix.txid || '',
      isPix: !!pix.isPix,
      origem: 'ofx',
      trntype
    });
  }
  return out;
};

/* ---------------- OFD ---------------- */
const OFD_NODE_RE = /(transac|lancamento|movimento|stmttrn)/;

const ofdToTx = (map) => {
  const keys = Object.keys(map);
  const findKey = (re) => keys.find(k => re.test(k));
  const dataKey = findKey(/^(data)/);
  const valorKey = findKey(/valor/);
  const descKey = findKey(/historico|descricao|memoria|complemento|memo|referencia/);
  if (!dataKey && !valorKey) return null;
  const rawVal = map[valorKey] || '0';
  const tipoAttr = map[valorKey + '::tipo'] || '';
  let signed = parseMoney(rawVal);
  let tipo = signed >= 0 ? 'C' : 'D';
  const tKey = findKey(/^(tipo|debito|credito)\b/);
  if (tKey) {
    const tv = String(map[tKey]).toUpperCase();
    if (/DEB|DÉB|PAG|SAÍ|SAI/.test(tv)) tipo = 'D';
    else if (/CRE|CRÉ|RECEB|ENTR/.test(tv)) tipo = 'C';
  }
  if (tipoAttr) {
    const tv = String(tipoAttr).toUpperCase();
    if (/^D|DEB|DÉB|DEBIT/.test(tv)) tipo = 'D';
    else if (/^C|CRED|CRÉ/.test(tv)) tipo = 'C';
  }
  if (tipo === 'D' && signed > 0) signed = -signed;
  if (tipo === 'C' && signed < 0) signed = Math.abs(signed);
  const desc = map[descKey] || '';
  const pix = extractPixInfo(desc);
  const fitKey = findKey(/^(fitid|nro|numero|numeroidentificacao|identificador|id)\b/);
  return {
    data: normalizeDate(map[dataKey] || ''),
    dataRaw: map[dataKey] || '',
    valor: Math.abs(signed),
    tipo,
    descricao: desc,
    fitid: map[fitKey] || '',
    e2e: pix.e2e || '',
    txid: pix.txid || '',
    isPix: !!pix.isPix,
    origem: 'ofd'
  };
};

const collectMap = (el, map) => {
  for (const child of el.children) {
    const key = (child.localName || child.nodeName || '').toLowerCase();
    const hasChildren = child.children && child.children.length > 0;
    if (hasChildren) {
      collectMap(child, map);
    } else {
      const text = (child.textContent || '').trim();
      if (text) map[key] = text;
      const tipoAttr = child.getAttribute ? (child.getAttribute('Tipo') || child.getAttribute('tipo') || '') : '';
      if (tipoAttr && /valor/.test(key)) map[key + '::tipo'] = tipoAttr;
    }
  }
};

const parseOfd = (content) => {
  const out = [];
  let xml = content.replace(/<\?xml[^>]*\?>\s*/i, '').trim();
  let doc = null;
  try { doc = new DOMParser().parseFromString(xml, 'text/xml'); } catch (e) { doc = null; }
  const parseError = !doc || doc.getElementsByTagName('parsererror').length > 0;
  if (!parseError) {
    const all = doc.getElementsByTagName('*');
    for (const el of all) {
      const ln = (el.localName || el.nodeName || '').toLowerCase();
      if (OFD_NODE_RE.test(ln)) {
        const map = {};
        collectMap(el, map);
        const t = ofdToTx(map);
        if (t) out.push(t);
      }
    }
  }
  if (out.length === 0) {
    const re = /<(Transacao|Lancamento|Movimento|STMTTRN)[^>]*>([\s\S]*?)<\/\1\s*>/g;
    let m;
    while ((m = re.exec(content))) {
      const map = {};
      const tagRe = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/g;
      let mm;
      while ((mm = tagRe.exec(m[2]))) {
        map[mm[1].toLowerCase()] = mm[3].trim();
        const tm = String(mm[2]).match(/[Tt]ipo\s*=\s*["']?(\w+)/);
        if (tm && /valor/.test(mm[1].toLowerCase())) map[mm[1].toLowerCase() + '::tipo'] = tm[1];
      }
      const t = ofdToTx(map);
      if (t) out.push(t);
    }
  }
  return out;
};

/* ---------------- CSV ---------------- */
const splitCsvLine = (line, delim) => {
  const parts = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else { cur += ch; }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      parts.push(cur); cur = '';
    } else { cur += ch; }
  }
  parts.push(cur);
  return parts;
};

const parseCsv = (content) => {
  const lines = content.split(/\r?\n/).filter(l => l && l.trim() !== '');
  if (lines.length < 2) return [];

  const detectDelim = (first) => {
    for (const d of [';', ',', '\t', '|']) {
      const counts = lines.slice(0, 25).map(l => splitCsvLine(l, d).length);
      if (counts.every(c => c === counts[0]) && counts[0] >= 2) return d;
    }
    const c = (first.match(/,/g) || []).length;
    const s = (first.match(/;/g) || []).length;
    return s >= c ? ';' : ',';
  };

  const delim = detectDelim(lines[0]);
  const header = splitCsvLine(lines[0], delim).map(normalizeCsvHeader);
  const idx = (names) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    for (let i = 0; i < header.length; i++) if (names.some(n => header[i].includes(n))) return i;
    return -1;
  };
  const dIdx = idx(['data', 'date', 'data pagamento', 'data lancamento']);
  const vIdx = idx(['valor', 'amount', 'value', 'valor lancamento']);
  const descIdx = idx(['historico', 'descricao', 'description', 'memoria', 'complemento', 'lancamento']);
  const tipoIdx = idx(['tipo', 'type', 'debito/credito', 'debito', 'credito', 'credito/debito']);
  const debitIdx = idx(['debito', 'saida', 'valor debito', 'valor saida']);
  const creditIdx = idx(['credito', 'entrada', 'valor credito', 'valor entrada']);
  const fitIdx = idx(['fitid', 'identificador', 'numero', 'nro', 'id']);

  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim);
    if (cols.length < 2) continue;
    const get = (i2) => (cols[i2] !== undefined ? cols[i2].trim() : '');
    let tipo = 'C';
    let signed = 0;
    if (vIdx >= 0) {
      signed = parseMoney(get(vIdx));
      tipo = signed >= 0 ? 'C' : 'D';
    } else if (creditIdx >= 0 && debitIdx >= 0) {
      const cr = parseMoney(get(creditIdx));
      const db = parseMoney(get(debitIdx));
      if (cr) { tipo = 'C'; signed = cr; }
      else if (db) { tipo = 'D'; signed = -db; }
    }
    if (tipoIdx >= 0) {
      const tv = get(tipoIdx).toUpperCase();
      if (/DEB|DÉB|SAÍ|SAI|PAG/.test(tv)) { tipo = 'D'; if (signed > 0) signed = -signed; }
      if (/CRE|CRÉ|ENTR|RECEB/.test(tv)) { tipo = 'C'; if (signed < 0) signed = Math.abs(signed); }
    }
    const desc = get(descIdx) || get(0);
    const pix = extractPixInfo(desc);
    out.push({
      data: normalizeDate(get(dIdx) || ''),
      dataRaw: get(dIdx) || '',
      valor: Math.abs(signed),
      tipo,
      descricao: desc,
      fitid: fitIdx >= 0 ? get(fitIdx) : '',
      e2e: pix.e2e || '',
      txid: pix.txid || '',
      isPix: !!pix.isPix,
      origem: 'csv'
    });
  }
  return out;
};

/* ---------------- Detecção de formato ---------------- */
const detectFormat = (filename = '', content = '') => {
  const name = (filename || '').toLowerCase();
  const head = String(content || '').slice(0, 4000);
  if (name.endsWith('.ofx') || /^\s*<OFX/i.test(head)) return 'ofx';
  if (name.endsWith('.ofd') || /^\s*<OFD/i.test(head)) return 'ofd';
  if (name.endsWith('.csv')) return 'csv';
  if (head.includes('\n') && /[,;]\t?/.test(head)) return 'csv';
  return null;
};

export const parseBankFile = (filename, content) => {
  const format = detectFormat(filename, content);
  if (!format) throw new Error('Formato não reconhecido. Use OFX, OFD ou CSV exportado do internet banking.');
  let txs = [];
  if (format === 'ofx') txs = parseOfx(content);
  else if (format === 'ofd') txs = parseOfd(content);
  else txs = parseCsv(content);
  const unique = dedup(txs);
  return { format, count: unique.length, transactions: unique };
};

/* =====================================================
   CONCILIAÇÃO — cruza extrato (banco) x agendamentos
===================================================== */
export const reconcileBank = (bankTxs, apts) => {
  const credits = bankTxs.filter(t => t.tipo === 'C');
  const debits = bankTxs.filter(t => t.tipo === 'D');
  const usedBank = new Set();
  const usedApt = new Set();
  const conciliados = [];
  const matchMap = {};

  const expectedApts = apts.filter(a => {
    if (a.status === 'cancelado' || a.status === 'cancelada') return false;
    const st = (a.status || '').toLowerCase();
    if (st === 'concluido' || st === 'concluída' || st === 'concluído') return true;
    return !!a.pixStatus && a.pixStatus !== 'pendente';
  });

  const mark = (t, a) => {
    usedBank.add(t.id); usedApt.add(a.id);
    matchMap[t.id] = a.id;
    conciliados.push({ bankTx: t, apt: a });
  };

  // 0) vínculos manuais já persistidos (aptId) sempre prevalecem
  for (const t of credits) {
    if (!t.aptId || usedBank.has(t.id)) continue;
    const a = expectedApts.find(x => x.id === t.aptId);
    if (a) { mark(t, a); continue; }
    matchMap[t.id] = t.aptId;
    usedBank.add(t.id);
    conciliados.push({ bankTx: t, apt: null });
  }

  // 1) forte: id do agendamento contido em txid/e2e/fitid/descricao
  for (const t of credits) {
    if (usedBank.has(t.id)) continue;
    const hay = ((t.e2e || '') + ' ' + (t.txid || '') + ' ' + (t.fitid || '') + ' ' + (t.descricao || '')).toLowerCase();
    const a = expectedApts.find(x => !usedApt.has(x.id) && (hay.includes('' + x.id) || (x.txId && hay.includes(String(x.txId).toLowerCase()))));
    if (a) mark(t, a);
  }

  // 2) valor + data (tolerância 1 dia para compensação D0/D1)
  for (const t of credits) {
    if (usedBank.has(t.id)) continue;
    const cand = expectedApts.filter(a => !usedApt.has(a.id) && Math.abs(Number(a.price || 0) - t.valor) < 0.01);
    if (!cand.length) continue;
    let best = null, bestScore = Infinity;
    for (const a of cand) {
      const d = Math.abs(daysBetween(t.data, a.date));
      if (d > 1) continue;
      if (d < bestScore) { bestScore = d; best = a; }
    }
    if (best) mark(t, best);
  }

  // 3) valor apenas — só quando existe exatamente 1 candidato esperado
  for (const t of credits) {
    if (usedBank.has(t.id)) continue;
    const cand = expectedApts.filter(a => !usedApt.has(a.id) && Math.abs(Number(a.price || 0) - t.valor) < 0.01);
    if (cand.length === 1) mark(t, cand[0]);
  }

  return {
    conciliados,
    matchMap,
    creditsUnmatched: credits.filter(t => !usedBank.has(t.id)),
    debitsUnmatched: debits,
    esperadosNaoRecebidos: expectedApts.filter(a => !usedApt.has(a.id)),
    totalCredits: credits.reduce((s, t) => s + t.valor, 0),
    totalConciliado: conciliados.reduce((s, c) => s + (c.bankTx.valor || 0), 0),
    totalDespesas: debits.reduce((s, t) => s + t.valor, 0),
    expectedValue: expectedApts.reduce((s, a) => s + Number(a.price || 0), 0),
    totalDivergencias: credits.filter(t => !usedBank.has(t.id)).length + expectedApts.filter(a => !usedApt.has(a.id)).length
  };
};