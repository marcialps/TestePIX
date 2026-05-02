/* =====================================================
   GERADOR DE PAYLOAD PIX — Padrão EMV/BACEN
   Copia e Cola / QR Code
===================================================== */

/**
 * Formata um campo EMV: ID (2 chars) + tamanho (2 chars) + valor
 */
const emvField = (id, value) => {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
};

/**
 * Calcula CRC16-CCITT (0xFFFF inicial, polinômio 0x1021)
 * Exigido pelo padrão BACEN para validar o payload
 */
const crc16 = (str) => {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
};

/**
 * Remove caracteres especiais mantendo apenas letras, números e espaços
 * (exigência do protocolo para nome e cidade)
 */
const clean = (str) =>
  (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .slice(0, 25)
    .trim();

/**
 * Gera o payload completo EMV PIX (Copia e Cola)
 *
 * @param {object} opts
 * @param {string} opts.chave    - Chave PIX (CPF, CNPJ, email, telefone ou aleatória)
 * @param {string} opts.nome     - Nome do beneficiário (máx 25 chars)
 * @param {string} opts.cidade   - Cidade do beneficiário (máx 15 chars)
 * @param {number} opts.valor    - Valor em reais (ex: 49.90) — use 0 para "sem valor fixo"
 * @param {string} [opts.txId]   - Identificador da transação (máx 25 chars, sem espaços)
 * @param {string} [opts.desc]   - Descrição/mensagem (opcional)
 * @returns {string} Linha digitável PIX pronta para Copia e Cola / QR Code
 */
export const generatePixPayload = ({ chave, nome, cidade, valor = 0, txId = '***', desc = '' }) => {
  // --- Merchant Account Info (ID 26) ---
  const gui = emvField('00', 'br.gov.bcb.pix');
  const keyField = emvField('01', chave);
  const descField = desc ? emvField('02', desc.slice(0, 72)) : '';
  const merchantInfo = emvField('26', gui + keyField + descField);

  // --- Transaction Amount (ID 54) — só inclui se valor > 0 ---
  const amountField = valor > 0
    ? emvField('54', Number(valor).toFixed(2))
    : '';

  // --- Additional Data (ID 62) — txId ---
  const safeTxId = (txId || '***').replace(/\s/g, '').slice(0, 25) || '***';
  const additionalData = emvField('62', emvField('05', safeTxId));

  // --- Monta o payload sem CRC ---
  const payload =
    emvField('00', '01') +          // Payload Format Indicator
    emvField('01', '12') +          // Point of Initiation: 12 = QR reutilizável
    merchantInfo +
    emvField('52', '0000') +        // Merchant Category Code
    emvField('53', '986') +         // Transaction Currency: BRL
    amountField +
    emvField('58', 'BR') +          // Country Code
    emvField('59', clean(nome).slice(0, 25)) +
    emvField('60', clean(cidade).slice(0, 15)) +
    additionalData +
    '6304';                          // CRC placeholder (sem valor ainda)

  return payload + crc16(payload);
};
