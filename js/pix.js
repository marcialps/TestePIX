/* =====================================================
   GERADOR DE PAYLOAD PIX — Padrão EMV/BACEN
   Manual de Padrões para Iniciação do Pix (BACEN)
   Versão corrigida — CRC16 mascarado, QR estático
===================================================== */

/**
 * Formata um campo EMV: ID (2 chars) + tamanho (2 chars) + valor
 * Comprimento usa byte count (para ASCII é igual a .length)
 */
const emvField = (id, value) => {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
};

/**
 * CRC16-CCITT — implementação CORRETA com máscara 0xFFFF em cada iteração.
 *
 * Falha comum: sem a máscara, JavaScript acumula valores maiores que 16 bits
 * durante os shifts, resultando em CRC errado e payload rejeitado pelos bancos.
 *
 * Parâmetros BACEN:
 *   - Polinômio: 0x1021
 *   - Valor inicial: 0xFFFF
 *   - Entrada: string ASCII (sem BOM)
 */
const crc16 = (str) => {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= (str.charCodeAt(i) << 8);
    for (let j = 0; j < 8; j++) {
      // Máscara 0xFFFF OBRIGATÓRIA aqui — mantém 16 bits a cada passo
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

/**
 * Sanitiza string para campos nome/cidade do PIX:
 * Remove acentos e caracteres não-ASCII (exigência do protocolo BACEN).
 */
const clean = (str, maxLen = 25) =>
  (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // remove diacríticos
    .replace(/[^a-zA-Z0-9 ]/g, '')     // só letras, números e espaço
    .trim()
    .slice(0, maxLen);

/**
 * Gera um txId válido (alphanumeric, 1-25 chars) a partir de uma string qualquer.
 * Fallback para string aleatória se a entrada resultar em vazia.
 */
const sanitizeTxId = (txId) => {
  const safe = (txId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 25);
  if (safe.length > 0) return safe;
  // Gera txId aleatório válido caso nenhum seja fornecido
  return Math.random().toString(36).slice(2, 14).toUpperCase();
};

/**
 * Gera o payload completo PIX Copia e Cola (QR Code Estático — campo 01 = 11)
 * conforme Manual de Padrões para Iniciação do Pix do BACEN.
 *
 * @param {object} opts
 * @param {string} opts.chave    Chave PIX (CPF, CNPJ, email, telefone, EVP)
 * @param {string} opts.nome     Nome do beneficiário (máx 25 chars, sem acentos)
 * @param {string} opts.cidade   Cidade (máx 15 chars, sem acentos)
 * @param {number} [opts.valor]  Valor em reais. 0 ou omitido = sem valor fixo.
 * @param {string} [opts.txId]   ID da transação (1–25 chars, [a-zA-Z0-9])
 * @param {string} [opts.desc]   Descrição adicional (máx 72 chars, opcional)
 * @returns {string}             Linha digitável PIX (Copia e Cola)
 */
export const generatePixPayload = ({
  chave,
  nome,
  cidade,
  valor = 0,
  txId = '',
  desc = '',
}) => {
  if (!chave) throw new Error('Chave PIX é obrigatória.');

  // ── Campo 26: Merchant Account Information ───────────────────────────────
  // Subcampo 00: GUI obrigatório
  const gui      = emvField('00', 'br.gov.bcb.pix');
  // Subcampo 01: chave PIX do recebedor
  const keyField = emvField('01', chave);
  // Subcampo 02: descrição opcional (max 72 chars)
  const descF    = desc ? emvField('02', String(desc).slice(0, 72)) : '';
  const merchantInfo = emvField('26', gui + keyField + descF);

  // ── Campo 54: Valor (só inclui quando > 0) ───────────────────────────────
  const amountField = (valor && valor > 0)
    ? emvField('54', Number(valor).toFixed(2))
    : '';

  // ── Campo 62: Additional Data Field — txId (Reference Label) ─────────────
  // BACEN exige: apenas [a-zA-Z0-9], tamanho 1–25
  const safeId = sanitizeTxId(txId);
  const additionalData = emvField('62', emvField('05', safeId));

  // ── Monta payload (sem CRC ainda) ────────────────────────────────────────
  const payload = [
    emvField('00', '01'),           // Payload Format Indicator
    emvField('01', '11'),           // Point of Initiation: 11 = QR Estático ✅
    merchantInfo,                   // Merchant Account Information (campo 26)
    emvField('52', '0000'),         // Merchant Category Code
    emvField('53', '986'),          // Currency: BRL (ISO 4217)
    amountField,                    // Transaction Amount (opcional)
    emvField('58', 'BR'),           // Country Code
    emvField('59', clean(nome, 25)),// Merchant Name (sem acentos)
    emvField('60', clean(cidade, 15)), // Merchant City (sem acentos)
    additionalData,                 // Additional Data (txId)
    '6304',                         // CRC placeholder — valor calculado a seguir
  ].join('');

  return payload + crc16(payload);
};
