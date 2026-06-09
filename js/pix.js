/* =====================================================
   GERADOR DE PAYLOAD PIX — Padrão EMV/BACEN
===================================================== */

if(typeof window !== 'undefined' && window.DEBUG) window.DEBUG('pix.js carregando...');

const emvField = (id, value) => {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
};

// CRC16-CCITT com máscara 0xFFFF obrigatória a cada passo
const crc16 = (str) => {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= (str.charCodeAt(i) << 8);
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

// Mantém só ASCII imprimível (0x20–0x7E) — obrigatório pelo BACEN
const toAscii = (str) =>
  (str || '').split('').filter(c => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) <= 0x7E).join('');

// Remove acentos e não-ASCII; limita tamanho
const clean = (str, maxLen = 25) =>
  (str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, maxLen);

// txId válido: apenas [a-zA-Z0-9], 1-25 chars
const safeTxId = (id) => {
  const s = (id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
  return s || Math.random().toString(36).slice(2, 14).toUpperCase();
};

/**
 * Sanitiza a chave PIX conforme o tipo declarado.
 * Garante que chegue ao BACEN no formato correto.
 */
export const sanitizeChave = (tipo, chave) => {
  const v = (chave || '').trim();
  switch (tipo) {
    case 'cpf':   return v.replace(/\D/g, '');             // só dígitos: 11 chars
    case 'cnpj':  return v.replace(/\D/g, '');             // só dígitos: 14 chars
    case 'telefone': {
      const d = v.replace(/[^\d+]/g, '');
      // Garante formato +55XXXXXXXXXXX
      if (d.startsWith('+')) return d;
      if (d.startsWith('55')) return '+' + d;
      return '+55' + d;
    }
    case 'email':     return v.toLowerCase();
    case 'aleatoria': return v;                            // UUID sem alteração
    default:          return v;
  }
};

/**
 * Gera o payload PIX Copia e Cola (QR Estático — campo 01 = 11)
 * conforme Manual de Padrões para Iniciação do Pix do BACEN.
 */
export const generatePixPayload = ({ chave, nome, cidade, valor = 0, txId = '', desc = '' }) => {
  if (!chave) throw new Error('Chave PIX obrigatória.');

  // Campo 26 — Merchant Account Info
  const gui      = emvField('00', 'br.gov.bcb.pix');
  const keyField = emvField('01', chave);
  // desc: somente ASCII imprimível, máx 72 chars
  const cleanDesc = toAscii(desc).slice(0, 72);
  const descF    = cleanDesc ? emvField('02', cleanDesc) : '';
  const merchantInfo = emvField('26', gui + keyField + descF);

  // Campo 54 — Valor
  const amountField = (valor && valor > 0) ? emvField('54', Number(valor).toFixed(2)) : '';

  // Campo 62 — Additional Data (txId)
  const additionalData = emvField('62', emvField('05', safeTxId(txId)));

  const payload = [
    emvField('00', '01'),              // Payload Format Indicator
    emvField('01', '11'),              // QR Estático
    merchantInfo,
    emvField('52', '0000'),            // MCC
    emvField('53', '986'),             // BRL
    amountField,
    emvField('58', 'BR'),
    emvField('59', clean(nome, 25)),   // Nome sem acentos
    emvField('60', clean(cidade, 15)), // Cidade sem acentos
    additionalData,
    '6304',                            // CRC placeholder
  ].join('');

  const result = payload + crc16(payload);
  console.log('[PIX] Payload gerado:', result);
  console.log('[PIX] Chave usada:', chave, '| Nome:', clean(nome,25), '| Cidade:', clean(cidade,15));
  return result;
};

if(typeof window !== 'undefined' && window.DEBUG) window.DEBUG('pix.js OK - funções PIX exportadas');
