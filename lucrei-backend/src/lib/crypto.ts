import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('TOKEN_ENCRYPTION_KEY não configurada.');
  }
  const buffer = Buffer.from(key, 'hex');
  if (buffer.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY precisa ter 32 bytes (64 caracteres hex).');
  }
  return buffer;
}

export function encrypt(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

export function decrypt(cipherText: string): string {
  const [ivHex, authTagHex, encryptedHex] = cipherText.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Valor criptografado em formato inválido.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}
