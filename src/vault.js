// AES-256-GCM encryption for stored passwords and secret notes.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

function loadKey() {
  if (process.env.VAULT_KEY) {
    const key = Buffer.from(process.env.VAULT_KEY, 'hex');
    if (key.length !== 32) throw new Error('VAULT_KEY must be 64 hex characters (32 bytes).');
    return key;
  }
  const file = path.join(DATA_DIR, 'vault.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    console.warn(`\n[vault] Generated a new encryption key at ${file}\n[vault] BACK IT UP. Without it, stored passwords cannot be decrypted.\n`);
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

const KEY = loadKey();

function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(blob) {
  if (!blob) return '';
  const [v, iv, tag, ct] = blob.split(':');
  if (v !== 'v1') throw new Error('Unknown vault format');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
