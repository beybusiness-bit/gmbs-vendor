import { db, collection, query, where, orderBy, limit, getDocs } from '../firebase-init.js';

function noPerm(label) {
  return `<div style="max-width:480px;margin:80px auto;text-align:center;padding:40px">
    <div style="font-size:48px;margin-bottom:16px">🔒</div>
    <h3 style="font-size:17px;font-weight:700;margin-bottom:8px">접근 권한이 없습니다</h3>
    <p style="font-size:14px;color:var(--gray-500);line-height:1.6">[${label}] 메뉴에 대한 접근 권한이 없습니다.<br>주관리자에게 권한 부여를 요청하세요.</p>
  </div>`;
}

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

const REASON_LABELS = {
  '손상': { label: '손상', color: '#dc2626' },
  '도난': { label: '도난', color: '#7c3aed' },
  '판매중지-브랜드요청': { label: '판매중지 (브랜드 요청)', color: '#2563eb', isMine: true },
  '판매중지-가게요청': { label: '판매중지 (가게 요청)', color: '#ea580c' },
  '기타': { label: '기타', color: '#6b7280' },
};

function reasonBadge(reason) {
  const info = REASON_LABELS[reason] || { label: reason || '-', color: '#6b7280' };
  const extra = info.isMine
    ? ` title="브랜드가 직접 요청한 판매중지입니다"` : '';
  return `<span${extra} style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;
    border-radius:10px;font-size:12px;font-weight:600;background:${info.color}18;color:${info.color}">
    ${info.isMine ? '⭐ ' : ''}${info.label}
  </span>`;
}

function photoCell(urls) {
  if (!urls || !urls.length) return '-';
  return urls.map((url, i) =>
    `<a href="${url}" target="_blank" rel="noopener"
       style="display:inline-flex;align-items:center;justify-content:center;
              width:36px;height:36px;border-radius:6px;overflow:hidden;
              border:1px solid var(--gray-200);background:var(--gray-50)">
       <img src="${url}" alt="사진${i+1}"
            style="width:100%;height:100%;object-fit:cover"
            onerror="this.parentNode.innerHTML='📷'">
     </a>`
  ).join(' ');
}

export async function renderInventory({ userDoc, container, permissions }) {
  if (permissions && permissions['inventory.view'] === false) {
    container.innerHTML = noPerm('재고·판매 조회'); return;
  }
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

  const txItems    = txSnap.status    === 'fulfilled' ? txSnap.value.docs.map(d => ({ id: d.id, ...d.data() }))    : [];
  const salesItems = salesSnap.status === 'fulfilled' ? salesSnap.value.docs.map(d => ({ id: d.id, ...d.data() })) : [];

  // 불용처리 내역 분리
  const disposalItems = txItems.filter(tx => tx.transaction_type === '불용처리');

  // inventory_transactions → sku_id별 현재고 집계 (불용처리 포함 전체)
  const stockMap = {};
  txItems.forEach(tx => {
    const key = tx.sku_id || tx.id;
    if (!stockMap[key]) stockMap[key] = { sku_id: key, product_name: tx.product_name || '-', barcode: tx.barcode || '-', qty: 0 };
    stockMap[key].qty += (tx.quantity || 0);
  });
  const stockRows = Object.values(stockMap);

  const disposalBadge = disposalItems.length > 0
    ? ` <span style="display:inline-flex;align-items:center;justify-content:center;
        min-width:18px;height:18px;padding:0 5px;border-radius:9px;
        font-size:11px;font-weight:700;background:var(--danger);color:#fff;
        vertical-align:middle;margin-left:4px">${disposalItems.length}</span>` : '';

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
        <button id="tab-disposal" onclick="switchTab('disposal')"
          style="padding:10px 20px;font-size:14px;font-weight:600;border:none;background:none;
                 cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--gray-400)">
          🗑️ 불용처리 내역${disposalBadge}
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

      <!-- 불용처리 내역 -->
      <div id="panel-disposal" style="display:none">
        ${disposalItems.length === 0
          ? `<div class="pending-wrap" style="padding:40px">
               <div class="pending-icon">🗑️</div>
               <h2>불용처리 내역 없음</h2>
               <p>GMBS 관리자가 불용처리를 기록하면 여기 표시됩니다.</p>
             </div>`
          : `<div style="margin-bottom:12px;padding:10px 14px;border-radius:8px;
                         background:#fef9c3;border:1px solid #fde047;font-size:13px;color:#713f12">
               ⚠️ 아래 내역은 GMBS 관리자가 기록한 불용처리 정보입니다. 수정·삭제는 어드민에 문의하세요.
             </div>
             <div class="table-wrap">
               <table class="data-table">
                 <thead>
                   <tr><th>처리일</th><th>상품 ID</th><th>SKU ID</th><th>사유</th><th style="text-align:right">차감 수량</th><th>메모</th><th>사진</th></tr>
                 </thead>
                 <tbody>
                   ${disposalItems.map(tx => {
                     const qty = Math.abs(tx.quantity ?? 0);
                     const unitInfo = tx.unit_numbers?.length
                       ? `<div style="font-size:11px;color:var(--gray-400);margin-top:2px">${tx.unit_numbers.join(', ')}</div>` : '';
                     return `<tr>
                       <td style="font-size:12px;white-space:nowrap">${fmtTs(tx.created_at)}</td>
                       <td style="font-family:monospace;font-size:12px">${tx.product_id || '-'}</td>
                       <td style="font-family:monospace;font-size:12px">${tx.sku_id || '-'}</td>
                       <td>${reasonBadge(tx.reason)}</td>
                       <td style="text-align:right;font-weight:700;color:var(--danger)">−${qty}${unitInfo}</td>
                       <td style="font-size:13px;color:var(--gray-600);max-width:160px">${tx.memo || '-'}</td>
                       <td>${photoCell(tx.photo_urls)}</td>
                     </tr>`;
                   }).join('')}
                 </tbody>
               </table>
             </div>`
        }
      </div>
    </div>
  `;

  // 탭 전환 함수 (전역 등록)
  const TABS = ['stock', 'sales', 'disposal'];
  window.switchTab = (tab) => {
    TABS.forEach(t => {
      const panel = document.getElementById('panel-' + t);
      const btn   = document.getElementById('tab-' + t);
      if (!panel || !btn) return;
      const active = t === tab;
      panel.style.display = active ? '' : 'none';
      btn.style.borderBottomColor = active ? 'var(--primary)' : 'transparent';
      btn.style.color = active ? 'var(--primary)' : 'var(--gray-400)';
    });
  };
}
