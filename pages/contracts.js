import { db, collection, getDocs, orderBy, query } from '../firebase-init.js';

function fmt(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
}

export async function renderContracts({ userDoc, container }) {
  const brandId = userDoc?.brand_id;
  if (!brandId) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>연결된 브랜드가 없습니다</h2></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  const q    = query(collection(db, 'brands', brandId, 'contracts'), orderBy('created_at', 'desc'));
  const snap = await getDocs(q);
  const contracts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  container.innerHTML = `
    <div style="max-width:720px">
      <div style="margin-bottom:20px">
        <h2 style="font-size:18px;font-weight:700">계약서</h2>
        <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
          계약서는 조회만 가능합니다. 수정이 필요하면 운영자에게 문의해 주세요.
        </p>
      </div>
      ${contracts.length === 0
        ? `<div class="card" style="text-align:center;padding:40px;color:var(--gray-400)">
             등록된 계약서가 없습니다.
           </div>`
        : contracts.map(c => contractCard(c)).join('')
      }
    </div>
  `;
}

function contractCard(c) {
  const hasFile = !!(c.file_url);
  return `
    <div class="card" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-weight:700;margin-bottom:4px">📄 ${c.title || '계약서'}</div>
        <div style="font-size:12px;color:var(--gray-400)">
          등록일: ${fmt(c.created_at)}
          ${c.signed_at ? ` &nbsp;|&nbsp; 서명일: ${fmt(c.signed_at)}` : ''}
        </div>
      </div>
      ${hasFile
        ? `<a href="${c.file_url}" target="_blank" rel="noopener"
             class="btn btn-outline" style="width:auto;padding:9px 16px;font-size:13px;text-decoration:none">
             ⬇️ 다운로드
           </a>`
        : `<span style="font-size:13px;color:var(--gray-400)">파일 없음</span>`
      }
    </div>`;
}
