import { db, collection, query, where, orderBy, getDocs } from '../firebase-init.js';

function won(n) {
  if (n == null || n === '') return '-';
  return Number(n).toLocaleString('ko-KR') + '원';
}

function statusBadge(status) {
  const map = { '지급완료': 'badge-green', '지급예정': 'badge-yellow', '보류': 'badge-red' };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status || '-'}</span>`;
}

export async function renderSettlements({ userDoc, container }) {
  const brandId = userDoc?.brand_id;

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  let items = [];
  let hasData = false;

  if (brandId) {
    try {
      const q = query(
        collection(db, 'settlements'),
        where('brand_id', '==', brandId),
        orderBy('year', 'desc'),
      );
      const snap = await getDocs(q);
      items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      hasData = items.length > 0;
    } catch (_) {
      hasData = false;
    }
  }

  if (!hasData) {
    container.innerHTML = `
      <div class="pending-wrap">
        <div class="pending-icon">💰</div>
        <h2>정산 조회</h2>
        <p>월별 정산 내역이 여기 표시됩니다.<br>
           정산 자동화 시스템 연동 준비 중입니다.</p>
        <div style="margin-top:28px">
          <span class="badge badge-yellow">준비중</span>
        </div>
      </div>`;
    return;
  }

  // 연도별 합계 계산
  const byYear = {};
  items.forEach(s => {
    const y = s.year || '기타';
    if (!byYear[y]) byYear[y] = 0;
    byYear[y] += (s.amount || 0);
  });

  container.innerHTML = `
    <div style="max-width:720px">
      <div style="margin-bottom:20px">
        <h2 style="font-size:18px;font-weight:700">정산 조회</h2>
        <p style="font-size:13px;color:var(--gray-600);margin-top:4px">읽기 전용입니다.</p>
      </div>

      <!-- 연도별 합계 카드 -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:24px">
        ${Object.entries(byYear).map(([y, total]) => `
          <div class="card" style="text-align:center;padding:16px">
            <div style="font-size:12px;color:var(--gray-400);margin-bottom:4px">${y}년 합계</div>
            <div style="font-size:18px;font-weight:800;color:var(--primary)">${won(total)}</div>
          </div>`).join('')}
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>연도</th><th>월</th><th>정산금액</th><th>상태</th><th>지급일</th></tr>
          </thead>
          <tbody>
            ${items.map(s => `
              <tr>
                <td>${s.year || '-'}</td>
                <td>${s.month ? s.month + '월' : '-'}</td>
                <td style="font-weight:600">${won(s.amount)}</td>
                <td>${statusBadge(s.status)}</td>
                <td style="font-size:12px;color:var(--gray-400)">${fmtTs(s.paid_at)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function fmtTs(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' +
    String(d.getDate()).padStart(2,'0');
}
