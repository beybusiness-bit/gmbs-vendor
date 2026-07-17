/**
 * AES-GCM 암호화 유틸리티
 * 키는 Firestore app_configs/encryption 문서의 aes_key_b64 필드에서 로드.
 * 어드민과 동일한 키를 공유해야 복호화 가능.
 * 암호화된 값 형식: "ENC:<base64(iv + ciphertext)>"
 */

import { db, doc, getDoc } from '../firebase-init.js';

let _cachedKey = null;

async function loadCryptoKey() {
  if (_cachedKey) return _cachedKey;
  const snap = await getDoc(doc(db, 'app_configs', 'encryption'));
  if (!snap.exists()) throw new Error('암호화 설정(app_configs/encryption)이 없습니다.');
  const { aes_key_b64 } = snap.data();
  if (!aes_key_b64) throw new Error('암호화 키(aes_key_b64)가 설정되지 않았습니다.');
  const keyBytes = b64ToBytes(aes_key_b64);
  _cachedKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return _cachedKey;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function encryptValue(plaintext) {
  if (!plaintext) return '';
  const key = await loadCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(12 + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), 12);
  return 'ENC:' + bytesToB64(combined);
}

export async function decryptValue(value) {
  if (!value || !value.startsWith('ENC:')) return value || '';
  const key = await loadCryptoKey();
  const combined = b64ToBytes(value.slice(4));
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith('ENC:');
}
