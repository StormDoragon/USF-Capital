const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const SALT_ROUNDS = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateTotpSecret(email) {
  return speakeasy.generateSecret({ length: 20, name: `USF Capital (${email})`, issuer: 'USF Capital' });
}

function verifyTotpToken(secretBase32, token) {
  if (!token || typeof token !== 'string') return false;
  return speakeasy.totp.verify({
    secret: secretBase32,
    encoding: 'base32',
    token: token.replace(/\s+/g, ''),
    window: 1
  });
}

async function generateQrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

module.exports = { hashPassword, verifyPassword, generateTotpSecret, verifyTotpToken, generateQrDataUrl };
