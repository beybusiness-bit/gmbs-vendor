/**
 * 사업자등록번호 / 주민등록번호 검증 유틸리티
 * 국세청 API 키는 Firestore settings/config.nts_api_key 에서 로드
 */

import { db, doc, getDoc } from '../firebase-init.js';

// ── 사업자등록번호 ──────────────────────────────────────────

/** 하이픈 없는 10자리 체크섬 검증 */
export function validateBizRegNumber(digits) {
  if (!/^\d{10}$/.test(digits)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += w[i] * parseInt(digits[i]);
  sum += Math.floor((5 * parseInt(digits[8])) / 10);
  return parseInt(digits[9]) === (10 - (sum % 10)) % 10;
}

/** 입력 중 자동 포맷: 000-00-00000 */
export function formatBizRegNumber(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return d.slice(0, 3) + '-' + d.slice(3);
  return d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5);
}

// ── 주민등록번호 ──────────────────────────────────────────

/**
 * 체크섬 + 생년월일 검증
 * @returns {{ ok: boolean, msg?: string }}
 */
export function validateResidentNumber(raw) {
  const digits = raw.replace(/-/g, '');
  if (!/^\d{13}$/.test(digits)) return { ok: false, msg: '13자리 숫자를 입력하세요.' };
  const mm = parseInt(digits.slice(2, 4));
  const dd = parseInt(digits.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31)
    return { ok: false, msg: '생년월일이 올바르지 않습니다.' };
  const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += w[i] * parseInt(digits[i]);
  if (parseInt(digits[12]) !== (11 - (sum % 11)) % 10)
    return { ok: false, msg: '주민등록번호 형식이 올바르지 않습니다.' };
  return { ok: true };
}

/** 입력 중 자동 하이픈: 000000-0000000 */
export function formatResidentNumber(raw) {
  let d = raw.replace(/[^\d-]/g, '');
  const digits = d.replace(/-/g, '');
  if (digits.length > 6 && !d.includes('-'))
    d = digits.slice(0, 6) + '-' + digits.slice(6, 13);
  return d.slice(0, 14);
}

// ── 국세청 API ──────────────────────────────────────────

let _ntsApiKey = null;
async function getNtsApiKey() {
  if (_ntsApiKey) return _ntsApiKey;
  const snap = await getDoc(doc(db, 'settings', 'config'));
  _ntsApiKey = snap.data()?.nts_api_key || '';
  return _ntsApiKey;
}

/**
 * 국세청 오픈API 사업자 상태 조회
 * @param {string} bizNumber - 하이픈 없는 10자리
 * @returns {{ status: 'active'|'dormant'|'closed'|'unknown', label: string }}
 */
export async function verifyBizNumber(bizNumber) {
  const apiKey = await getNtsApiKey();
  if (!apiKey) throw new Error('API 키가 설정되지 않았습니다. 운영자에게 문의하세요.');
  // 공공데이터포털 인코딩키는 이미 URL 인코딩된 값이므로 추가 인코딩 없이 그대로 사용
  const res = await fetch(
    'https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=' + apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ b_no: [bizNumber] }),
    }
  );
  if (!res.ok) throw new Error('API 응답 오류: ' + res.status);
  const item = (await res.json())?.data?.[0];
  if (!item) throw new Error('조회 결과가 없습니다.');
  const result = ({
    '01': { status: 'active',  label: '계속사업자' + (item.tax_type ? ' · ' + item.tax_type : '') },
    '02': { status: 'dormant', label: '휴업자' },
    '03': { status: 'closed',  label: '폐업자' },
  })[item.b_stt_cd] || { status: 'unknown', label: item.b_stt || '알 수 없음' };
  return { ...result, rawItem: item };
}

// ── 저장 전 최종 검증 ─────────────────────────────────────

/**
 * 정산 정보 폼 검증
 * @param {{ bizType, bizNumber, residentNumber }} formData
 * @returns {string[]} 오류 메시지 배열 (빈 배열이면 통과)
 */
export function validateSettlementForm({ bizType, bizNumber, residentNumber }) {
  const errors = [];
  if (bizType === 'business' && bizNumber) {
    const d = bizNumber.replace(/-/g, '');
    if (!validateBizRegNumber(d)) errors.push('사업자등록번호 형식이 올바르지 않습니다.');
  }
  if (bizType === 'individual' && residentNumber) {
    const r = validateResidentNumber(residentNumber);
    if (!r.ok) errors.push('주민등록번호: ' + r.msg);
  }
  return errors;
}
