import { db, collection, query, where, orderBy, getDocs } from '../firebase-init.js';

function won(n) {
  if (n == null || n === '') return '-';
  return Number(n).toLocaleString('ko-KR') + '원';
}

function fmtTs(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' +
    String(d.getDate()).padStart(2,'0');
}

// period_start Timestamp → "YYYY년 MM월" 표기
function fmtPeriod(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '년 ' + String(d.getMonth()+1).padStart(2,'0') + '월';
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
        where('status', '==', '확정'),      // admin 확정분만 표시
        orderBy('period_start', 'desc'),
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
        <p>확정된 월별 정산 내역이 여기 표시됩니다.<br>
           admin이 정산을 확정하면 자동으로 반영됩니다.</p>
        <div style="margin-top:28px">
          <span class="badge badge-yellow">준비중</span>
        </div>
      </div>`;
    return;
  }

  // 연도별 공급금액 합계
  const byYear = {};
  items.forEach(s => {
    const year = s.period_start?.toDate
      ? s.period_start.toDate().getFullYear()
      : (s.year || '기타');
    if (!byYear[year]) byYear[year] = 0;
    byYear[year] += (s.total_supply_amount ?? s.amount ?? 0);
  });

  container.innerHTML = `
    <div style="max-width:800px">
      <div style="margin-bottom:20px">
        <h2 style="font-size:18px;font-weight:700">정산 조회</h2>
        <p style="font-size:13px;color:var(--gray-600);margin-top:4px">확정된 정산 내역만 표시됩니다. 읽기 전용입니다.</p>
      </div>

      <!-- 연도별 합계 카드 -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:24px">
        ${Object.entries(byYear).sort((a,b) => b[0]-a[0]).map(([y, total]) => `
          <div class="card" style="text-align:center;padding:16px">
            <div style="font-size:12px;color:var(--gray-400);margin-bottom:4px">${y}년 공급금액 합계</div>
            <div style="font-size:18px;font-weight:800;color:var(--primary)">${won(total)}</div>
          </div>`).join('')}
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>정산 기간</th>
              <th>판매 건수</th>
              <th>총 판매금액</th>
              <th>공급금액 (정산액)</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(s => `
              <tr>
                <td>${fmtPeriod(s.period_start)}</td>
                <td>${s.sale_count ?? '-'}건</td>
                <td>${won(s.total_sales_amount)}</td>
                <td style="font-weight:700">${won(s.total_supply_amount ?? s.amount)}</td>
                <td><span class="badge badge-green">${s.status || '확정'}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
