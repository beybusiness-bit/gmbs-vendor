import { db, collection, query, where, orderBy, limit, getDocs } from '../firebase-init.js';

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

export async function renderInventory({ userDoc, container }) {
  const brandId = userDoc?.brand_id;
  if (!brandId) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>연결된 브랜드가 없습니다</h2></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  // 재고·판매 데이터 병렬 조회
  const [txSnap, salesSnap] = await Promise.allSettled([
    getDocs(query(
      collection(db, 'inventory_transactions'),
      where('brand_id', '==', brandId),
      orderBy('created_at', 'desc'),
      limit(500),
    )),
    getDocs(query(
      collection(db, 'sales'),
      where('brand_id', '==', brandId),
      orderBy('sold_at', 'desc'),
      limit(100),
    )),
  ]);

  const txItems   = txSnap.status    === 'fulfilled' ? txSnap.value.docs.map(d => ({ id: d.id, ...d.data() }))    : [];
  const salesItems = salesSnap.status === 'fulfilled' ? salesSnap.value.docs.map(d => ({ id: d.id, ...d.data() })) : [];

  // inventory_transactions → sku_id별 현재고 집계
  const stockMap = {};
  txItems.forEach(tx => {
    const key = tx.sku_id || tx.id;
    if (!stockMap[key]) stockMap[key] = { sku_id: key, product_name: tx.product_name || '-', barcode: tx.barcode || '-', qty: 0 };
    stockMap[key].qty += (tx.quantity || 0);
  });
  const stockRows = Object.values(stockMap);

  container.innerHTML = `
    <div style="max-width:900px">
      <div style="margin-bottom:20px">
        <h2 style="font-size:18px;font-weight:700">재고·판매 조회</h2>
        <p style="font-size:13px;color:var(--gray-600);margin-top:4px">읽기 전용입니다. GMBS 기준 재고이며 Toss POS 재고와 별개입니다.</p>
      </div>

      <!-- 탭 -->
      <div style="display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid var(--gray-200)">
        <button id="tab-stock" onclick="switchTab('stock')"
          style="padding:10px 20px;font-size:14px;font-weight:600;border:none;background:none;
                 cursor:pointer;border-bottom:2px solid var(--primary);margin-bottom:-2px;color:var(--primary)">
          📦 재고 현황
        </button>
        <button id="tab-sales" onclick="switchTab('sales')"
          style="padding:10px 20px;font-size:14px;font-weight:600;border:none;background:none;
                 cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--gray-400)">
          🧾 판매 내역
        </button>
      </div>

      <!-- 재고 현황 -->
      <div id="panel-stock">
        ${stockRows.length === 0
          ? `<div class="pending-wrap" style="padding:40px">
               <div class="pending-icon">📦</div>
               <h2>재고 데이터 없음</h2>
               <p>Toss POS 연동 후 재고 입출고 내역이 여기 표시됩니다.</p>
               <div style="margin-top:28px"><span class="badge badge-yellow">준비중</span></div>
             </div>`
          : `<div class="table-wrap">
               <table class="data-table">
                 <thead>
                   <tr><th>SKU ID</th><th>상품명</th><th>바코드</th><th>현재고</th></tr>
                 </thead>
                 <tbody>
                   ${stockRows.map(r => `
                     <tr>
                       <td style="font-family:monospace;font-size:12px">${r.sku_id}</td>
                       <td>${r.product_name}</td>
                       <td style="font-family:monospace;font-size:12px">${r.barcode}</td>
                       <td style="font-weight:700;color:${r.qty <= 0 ? 'var(--danger)' : 'inherit'}">${r.qty}</td>
                     </tr>`).join('')}
                 </tbody>
               </table>
             </div>`
        }
      </div>

      <!-- 판매 내역 -->
      <div id="panel-sales" style="display:none">
        ${salesItems.length === 0
          ? `<div class="pending-wrap" style="padding:40px">
               <div class="pending-icon">🧾</div>
               <h2>판매 데이터 없음</h2>
               <p>Toss POS에서 주문이 완료되면 판매 내역이 여기 표시됩니다.</p>
               <div style="margin-top:28px"><span class="badge badge-yellow">준비중</span></div>
             </div>`
          : `<div class="table-wrap">
               <table class="data-table">
                 <thead>
                   <tr><th>판매일</th><th>상품 ID</th><th>SKU ID</th><th>수량</th><th>단가</th><th>구분</th></tr>
                 </thead>
                 <tbody>
                   ${salesItems.map(s => `
                     <tr>
                       <td style="font-size:12px">${fmtTs(s.sold_at)}</td>
                       <td style="font-family:monospace;font-size:12px">${s.product_id || '-'}</td>
                       <td style="font-family:monospace;font-size:12px">${s.sku_id || '-'}</td>
                       <td>${s.quantity ?? '-'}</td>
                       <td>${won(s.unit_price)}</td>
                       <td><span class="badge ${s.sale_type === '환불' ? 'badge-red' : 'badge-blue'}">${s.sale_type || '-'}</span></td>
                     </tr>`).join('')}
                 </tbody>
               </table>
             </div>`
        }
      </div>
    </div>
  `;

  // 탭 전환 함수 (전역 등록)
  window.switchTab = (tab) => {
    document.getElementById('panel-stock').style.display = tab === 'stock' ? '' : 'none';
    document.getElementById('panel-sales').style.display = tab === 'sales' ? '' : 'none';
    document.getElementById('tab-stock').style.borderBottomColor = tab === 'stock' ? 'var(--primary)' : 'transparent';
    document.getElementById('tab-stock').style.color = tab === 'stock' ? 'var(--primary)' : 'var(--gray-400)';
    document.getElementById('tab-sales').style.borderBottomColor = tab === 'sales' ? 'var(--primary)' : 'transparent';
    document.getElementById('tab-sales').style.color = tab === 'sales' ? 'var(--primary)' : 'var(--gray-400)';
  };
}
