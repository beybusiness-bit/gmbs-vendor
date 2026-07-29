import {
  db, collection, query, where, getDocs,
  updateDoc, doc, getDoc, auth,
} from '../firebase-init.js';

function noPerm(label) {
  return `<div style="max-width:480px;margin:80px auto;text-align:center;padding:40px">
    <div style="font-size:48px;margin-bottom:16px">🔒</div>
    <h3 style="font-size:17px;font-weight:700;margin-bottom:8px">접근 권한이 없습니다</h3>
    <p style="font-size:14px;color:var(--gray-500);line-height:1.6">[${label}] 메뉴에 대한 접근 권한이 없습니다.<br>주관리자에게 권한 부여를 요청하세요.</p>
  </div>`;
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function won(n) {
  if (n == null || n === '') return '-';
  return Number(n).toLocaleString('ko-KR') + '원';
}

function fmtDate(s) {
  if (!s) return '-';
  // YYYY-MM-DD string
  if (typeof s === 'string') return s.replace(/-/g, '.');
  // Timestamp fallback
  const d = s.toDate ? s.toDate() : new Date(s);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
}

function statusBadge(p) {
  const hasPending = p.pending_changes && p.pending_changes.type;
  if (p.approval_status === '승인대기') {
    const label = hasPending ? '수정 요청 심사 중' : '신규 등록 심사 중';
    return `<span class="badge badge-yellow">${label}</span>`;
  }
  if (p.approval_status === '승인') return `<span class="badge badge-green">승인</span>`;
  if (p.approval_status === '거절') return `<span class="badge badge-red">거절</span>`;
  if (p.approval_status === '판매중지') return `<span class="badge badge-gray">판매중지</span>`;
  return `<span class="badge badge-gray">${p.approval_status || '-'}</span>`;
}

export async function renderProducts({ userDoc, container, showModal, closeModal, permissions } = {}) {
  if (permissions && permissions['products.view'] === false) {
    container.innerHTML = noPerm('상품 관리'); return;
  }
  const brandId = userDoc?.brand_id;
  if (!brandId) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>연결된 브랜드가 없습니다</h2></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  let products;
  let brandTypes = [];
  try {
    const [prodSnap, brandSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'products'),
        where('brand_id', '==', brandId),
      )),
      getDoc(doc(db, 'brands', brandId)),
    ]);
    products = prodSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const da = a.created_at || '';
        const db_ = b.created_at || '';
        return da < db_ ? 1 : da > db_ ? -1 : 0;
      });
    const bd = brandSnap.data() || {};
    brandTypes = bd.brand_types || (bd.brand_type ? [bd.brand_type] : []);
  } catch (e) {
    console.error('상품 목록 로드 실패:', e);
    container.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--danger)">
      상품 목록을 불러오지 못했습니다.<br>
      <span style="font-size:12px;color:var(--gray-400);margin-top:8px;display:block">${e.message}</span>
    </div>`;
    return;
  }

  const multiType = brandTypes.length > 1;

  const filterRow = multiType ? `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <button class="btn btn-outline tx-filter-btn active" data-tx=""
        style="width:auto;padding:6px 14px;font-size:13px">전체</button>
      ${brandTypes.map(t => `
        <button class="btn btn-outline tx-filter-btn" data-tx="${t}"
          style="width:auto;padding:6px 14px;font-size:13px">${t}</button>
      `).join('')}
    </div>` : '';

  const tableHtml = products.length === 0
    ? `<div class="card" style="text-align:center;padding:40px;color:var(--gray-400)">
         등록된 상품이 없습니다.
       </div>`
    : `${filterRow}
       <div class="table-wrap">
         <table class="data-table">
           <thead>
             <tr>
               <th>상품명</th>
               ${multiType ? '<th>거래유형</th>' : ''}
               <th>기본 판매가</th>
               <th>상태</th>
               <th>등록일</th>
               <th></th>
             </tr>
           </thead>
           <tbody>
             ${products.map(p => productRow(p, multiType)).join('')}
           </tbody>
         </table>
       </div>`;

  container.innerHTML = `
    <div style="max-width:960px">
      <div style="margin-bottom:20px">
        <h2 style="font-size:18px;font-weight:700">상품 관리</h2>
        <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
          어드민에서 등록된 상품을 확인하고 수정을 요청할 수 있습니다.
        </p>
      </div>
      ${tableHtml}
    </div>
  `;

  container.querySelectorAll('.btn-product-detail').forEach(btn => {
    const pId = btn.dataset.id;
    const product = products.find(p => p.id === pId);
    btn.addEventListener('click', () => {
      openProductDetail({ brandId, product, brandTypes, showModal, closeModal, container, userDoc, permissions });
    });
  });

  if (multiType) {
    container.querySelectorAll('.tx-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.tx-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.tx;
        container.querySelectorAll('tbody tr').forEach(tr => {
          const tx = tr.dataset.tx || '';
          tr.style.display = (!filter || tx === filter) ? '' : 'none';
        });
      });
    });
  }
}

function productRow(p, multiType) {
  const canRequest = p.approval_status === '승인' && !p.pending_changes;
  return `
    <tr data-tx="${p.transaction_type || ''}">
      <td style="font-weight:600">${p.product_name || '-'}</td>
      ${multiType ? `<td>${p.transaction_type ? `<span class="badge badge-gray">${p.transaction_type}</span>` : '-'}</td>` : ''}
      <td>${won(p.base_price)}</td>
      <td>${statusBadge(p)}</td>
      <td style="font-size:12px;color:var(--gray-400)">${fmtDate(p.created_at)}</td>
      <td>
        <button class="btn btn-outline btn-product-detail" data-id="${p.id}"
          style="width:auto;padding:6px 12px;font-size:12px">
          ${canRequest ? '수정 요청' : '상세'}
        </button>
      </td>
    </tr>`;
}

async function openProductDetail({ brandId, product: p, brandTypes, showModal, closeModal, container, userDoc, permissions }) {
  const canRequest = p.approval_status === '승인' && !p.pending_changes;
  const multiType = brandTypes.length > 1;

  // Fetch SKUs
  let skus = [];
  try {
    const skuSnap = await getDocs(collection(db, 'products', p.id, 'skus'));
    skus = skuSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) {}

  const skuSection = skus.length > 0 ? `
    <div style="margin-bottom:20px">
      <div style="font-weight:600;font-size:14px;margin-bottom:8px">SKU 목록</div>
      <div class="table-wrap" style="font-size:13px">
        <table class="data-table">
          <thead>
            <tr>
              <th>SKU명</th>
              <th>옵션</th>
              <th>바코드</th>
              <th>판매가</th>
            </tr>
          </thead>
          <tbody>
            ${skus.map(s => `
              <tr>
                <td>${s.sku_name || s.name || '-'}</td>
                <td>${s.option || '-'}</td>
                <td>${s.barcode || '-'}</td>
                <td>${won(s.price ?? s.base_price)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  const pendingBanner = p.pending_changes ? `
    <div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;color:#92400e">
      수정 요청이 심사 중입니다. 어드민 검토 후 반영됩니다.
    </div>` : '';

  const rejectionRow = p.approval_status === '거절' && p.rejection_reason ? `
    <div class="info-row" style="background:#fff5f5;border-radius:6px;padding:8px 12px">
      <span class="info-label" style="color:var(--danger)">거절 사유</span>
      <span class="info-value" style="color:var(--danger)">${p.rejection_reason}</span>
    </div>` : '';

  showModal(`
    <div class="modal-title">${p.product_name || '상품 상세'}</div>
    ${pendingBanner}
    <div style="display:grid;gap:10px;margin-bottom:20px">
      <div class="info-row">
        <span class="info-label">상태</span>
        <span class="info-value">${statusBadge(p)}</span>
      </div>
      ${p.product_number ? `<div class="info-row"><span class="info-label">상품번호</span><span class="info-value">${p.product_number}</span></div>` : ''}
      ${multiType && p.transaction_type ? `<div class="info-row"><span class="info-label">거래유형</span><span class="info-value"><span class="badge badge-gray">${p.transaction_type}</span></span></div>` : ''}
      <div class="info-row"><span class="info-label">기본 판매가</span><span class="info-value" style="font-weight:700">${won(p.base_price)}</span></div>
      <div class="info-row"><span class="info-label">공급가</span><span class="info-value">${won(p.supply_price)} <span style="font-size:11px;color:var(--gray-400)">(참고용)</span></span></div>
      <div class="info-row"><span class="info-label">수수료율</span><span class="info-value">${p.commission_rate != null ? p.commission_rate + '%' : '-'} <span style="font-size:11px;color:var(--gray-400)">(참고용)</span></span></div>
      ${p.retail_price_auto != null ? `<div class="info-row"><span class="info-label">자동계산 판매가</span><span class="info-value">${won(p.retail_price_auto)}</span></div>` : ''}
      <div class="info-row"><span class="info-label">등록일</span><span class="info-value">${fmtDate(p.created_at)}</span></div>
      ${rejectionRow}
    </div>
    ${skuSection}
    <div class="modal-footer" style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-detail-close" style="flex:1">닫기</button>
      ${canRequest ? `<button class="btn btn-primary" id="btn-detail-edit" style="flex:2">수정 요청하기</button>` : ''}
    </div>
  `);

  document.getElementById('btn-detail-close').addEventListener('click', closeModal);
  if (canRequest) {
    document.getElementById('btn-detail-edit').addEventListener('click', () => {
      closeModal();
      openEditRequestModal({ product: p, showModal, closeModal, container, userDoc, permissions });
    });
  }
}

function openEditRequestModal({ product: p, showModal, closeModal, container, userDoc, permissions }) {
  showModal(`
    <div class="modal-title">상품 수정 요청</div>
    <div style="background:var(--gray-50);border-radius:8px;padding:12px;margin-bottom:20px;font-size:13px;color:var(--gray-600)">
      수정 요청은 어드민 검토 후 반영됩니다. 승인 전까지 추가 요청은 불가합니다.
    </div>
    <div class="form-group">
      <label class="form-label">상품명 <span style="color:var(--danger)">*</span></label>
      <input id="edit-name" class="form-input" type="text" value="${p.product_name || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">판매가 (원) <span style="color:var(--danger)">*</span></label>
      <input id="edit-price" class="form-input" type="number" min="0" value="${p.base_price || ''}">
      <div class="form-hint">
        공급가: ${won(p.supply_price)} (참고용, 변경 불가) &nbsp;|&nbsp; 수수료율: ${p.commission_rate != null ? p.commission_rate + '%' : '-'}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">수정 요청 메모</label>
      <textarea id="edit-memo" class="form-input" rows="3" style="resize:vertical"
        placeholder="수정 내용 또는 요청 사항을 입력해 주세요">${p.memo || ''}</textarea>
    </div>
    <div id="edit-error" class="form-error"></div>
    <div class="modal-footer" style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-edit-cancel" style="flex:1">취소</button>
      <button class="btn btn-primary" id="btn-edit-save" style="flex:2">수정 요청 제출</button>
    </div>
  `);

  document.getElementById('btn-edit-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-edit-save').addEventListener('click', async () => {
    const errEl = document.getElementById('edit-error');
    const saveBtn = document.getElementById('btn-edit-save');
    errEl.textContent = '';

    const newName  = document.getElementById('edit-name').value.trim();
    const newPrice = Number(document.getElementById('edit-price').value || 0);
    const newMemo  = document.getElementById('edit-memo').value.trim();

    if (!newName) { errEl.textContent = '상품명을 입력해 주세요.'; return; }
    if (!newPrice) { errEl.textContent = '판매가를 입력해 주세요.'; return; }

    saveBtn.disabled = true;
    saveBtn.textContent = '처리 중...';

    try {
      await updateDoc(doc(db, 'products', p.id), {
        pending_changes: {
          type: 'edit',
          product_name: newName,
          base_price: newPrice,
          memo: newMemo,
          requested_at: today(),
          requested_by: auth.currentUser?.uid || '',
        },
        approval_status: '승인대기',
        updated_at: today(),
      });

      closeModal();
      await renderProducts({ userDoc, container, showModal, closeModal, permissions });
    } catch (e) {
      errEl.textContent = '처리 중 오류가 발생했습니다.';
      saveBtn.disabled = false;
      saveBtn.textContent = '수정 요청 제출';
    }
  });
}
