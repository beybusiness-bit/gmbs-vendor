import { db, collection, getDocs, query } from '../firebase-init.js';

function fmt(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
}

const STATUS_META = {
  '발송대기':   { badge: 'badge-gray',   icon: '⏳', label: '발송 대기',   msg: '아직 계약서가 발송되지 않았습니다.' },
  '발송됨':     { badge: 'badge-blue',   icon: '📨', label: '발송됨',      msg: '계약서가 발송되었습니다. 카카오톡 또는 이메일로 온 서명 요청을 확인해 주세요.' },
  '서명진행중': { badge: 'badge-yellow', icon: '✍️', label: '서명 진행 중', msg: '서명이 진행 중입니다.' },
  '체결완료':   { badge: 'badge-green',  icon: '✅', label: '체결 완료',   msg: '계약이 체결되었습니다. 완료된 계약서는 담당자 이메일로 발송되며, 관리자 검토 후 최종 입점이 확정됩니다.' },
  '취소됨':     { badge: 'badge-red',    icon: '❌', label: '취소됨',      msg: '계약 요청이 취소되었습니다. 관리자에게 문의해 주세요.' },
};

export async function renderContracts({ userDoc, container }) {
  const brandId = userDoc?.brand_id;
  if (!brandId) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>연결된 브랜드가 없습니다</h2></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  // orderBy 없이 쿼리 (복합 인덱스 불필요), 클라이언트 정렬
  const snap = await getDocs(query(collection(db, 'brands', brandId, 'contracts')));
  const contracts = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.created_at?.toMillis?.() || 0) - (a.created_at?.toMillis?.() || 0));

  container.innerHTML = `
    <div style="max-width:720px">
      <div style="margin-bottom:24px">
        <h2 style="font-size:18px;font-weight:700">전자계약 상태</h2>
        <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
          계약 현황을 확인할 수 있습니다. 서명은 유캔사인에서 발송된 카카오톡 또는 이메일 알림을 통해 진행됩니다.
        </p>
      </div>
      ${contracts.length === 0
        ? `<div class="card" style="text-align:center;padding:48px;color:var(--gray-400)">
             <div style="font-size:40px;margin-bottom:12px">📄</div>
             <p style="font-size:15px;font-weight:600;margin-bottom:6px">등록된 계약서가 없습니다.</p>
             <p style="font-size:13px">계약서 발송은 운영자가 처리합니다.</p>
           </div>`
        : contracts.map(c => contractCard(c)).join('')
      }
    </div>`;
}

function contractCard(c) {
  const s    = c.status || '발송대기';
  const meta = STATUS_META[s] || { badge: 'badge-gray', icon: '❓', label: s, msg: '' };

  const dateRow = (() => {
    const parts = [];
    if (c.sent_at)      parts.push(`발송일: ${fmt(c.sent_at)}`);
    if (c.completed_at) parts.push(`체결일: ${fmt(c.completed_at)}`);
    if (c.canceled_at)  parts.push(`취소일: ${fmt(c.canceled_at)}`);
    if (c.created_at)   parts.push(`등록일: ${fmt(c.created_at)}`);
    return parts.join(' &nbsp;|&nbsp; ');
  })();

  const alertStyle = s === '발송됨'
    ? 'background:#eff6ff;border-left:3px solid var(--primary);'
    : s === '체결완료'
    ? 'background:#f0fdf4;border-left:3px solid var(--success);'
    : s === '취소됨'
    ? 'background:#fef2f2;border-left:3px solid var(--danger);'
    : 'background:var(--gray-50);border-left:3px solid var(--gray-300);';

  return `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-weight:700;font-size:15px;margin-bottom:6px">
            ${meta.icon} ${c.title || '계약서'}
          </div>
          <div style="font-size:12px;color:var(--gray-400)">${dateRow || '-'}</div>
        </div>
        <span class="badge ${meta.badge}" style="flex-shrink:0;font-size:13px;padding:5px 12px">${meta.label}</span>
      </div>
      ${meta.msg ? `
        <div style="padding:12px 14px;border-radius:8px;font-size:13px;line-height:1.6;${alertStyle}">
          ${meta.msg}
          ${s === '체결완료' && c.completed_at ? ` (${fmt(c.completed_at)})` : ''}
        </div>` : ''}
      ${s === '체결완료' ? `
        <div style="margin-top:12px">
          ${c.signed_pdf_url
            ? `<a href="${c.signed_pdf_url}" target="_blank" rel="noopener"
                class="btn btn-outline"
                style="width:auto;padding:8px 16px;font-size:13px;display:inline-flex;align-items:center;gap:6px;text-decoration:none">
                📄 계약서 PDF 다운로드
               </a>`
            : `<p style="font-size:13px;color:var(--gray-500)">📧 계약서는 이메일로 발송되었습니다.</p>`
          }
        </div>` : ''}
    </div>`;
}
