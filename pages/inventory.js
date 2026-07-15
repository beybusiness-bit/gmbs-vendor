import { db, collection, query, where, orderBy, limit, getDocs } from '../firebase-init.js';

function won(n) {
  if (n == null || n === '') return '-';
  return Number(n).toLocaleString('ko-KR') + '원';
}

export async function renderInventory({ userDoc, container }) {
  const brandId = userDoc?.brand_id;

  // 데이터가 있으면 보여주고, 없으면 준비중 안내
  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  let hasData = false;
  let items = [];

  if (brandId) {
    try {
      const q = query(
        collection(db, 'inventory'),
        where('brand_id', '==', brandId),
        orderBy('updated_at', 'desc'),
        limit(50),
      );
      const snap = await getDocs(q);
      items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      hasData = items.length > 0;
    } catch (_) {
      // 컬렉션 없거나 권한 없으면 준비중 표시
      hasData = false;
    }
  }

  if (!hasData) {
    container.innerHTML = `
      <div class="pending-wrap">
        <div class="pending-icon">📊</div>
        <h2>재고·판매 조회</h2>
        <p>Toss POS 연동 후 실시간 재고·판매 데이터가 여기 표시됩니다.<br>
           현재 데이터 연동 준비 중입니다.</p>
        <div style="margin-top:28px">
          <span class="badge badge-yellow">준비중</span>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="max-width:900px">
      <div style="margin-bottom:20px">
        <h2 style="font-size:18px;font-weight:700">재고·판매 조회</h2>
        <p style="font-size:13px;color:var(--gray-600);margin-top:4px">읽기 전용입니다.</p>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>상품명</th><th>바코드</th><th>재고수량</th><th>판매수량</th><th>최종 업데이트</th></tr>
          </thead>
          <tbody>
            ${items.map(r => `
              <tr>
                <td>${r.product_name || '-'}</td>
                <td style="font-family:monospace;font-size:13px">${r.barcode || '-'}</td>
                <td>${r.stock_qty != null ? r.stock_qty : '-'}</td>
                <td>${r.sold_qty  != null ? r.sold_qty  : '-'}</td>
                <td style="font-size:12px;color:var(--gray-400)">${fmtTs(r.updated_at)}</td>
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
