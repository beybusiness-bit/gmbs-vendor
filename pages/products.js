import {
  db, collection, query, where, orderBy, getDocs,
  addDoc, updateDoc, doc, serverTimestamp,
} from '../firebase-init.js';

const PRODUCT_STATUS = {
  PENDING:   '등록신청',
  APPROVED:  '승인',
  REJECTED:  '거절',
  MOD_REQ:   '수정요청중',
  MOD_DONE:  '수정반영',
};

function statusBadge(status) {
  const map = {
    '등록신청':   'badge-yellow',
    '승인':       'badge-green',
    '거절':       'badge-red',
    '수정요청중': 'badge-yellow',
    '수정반영':   'badge-blue',
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status || '-'}</span>`;
}

function fmt(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
}

function won(n) {
  if (n == null || n === '') return '-';
  return Number(n).toLocaleString('ko-KR') + '원';
}

export async function renderProducts({ userDoc, container, showModal, closeModal }) {
  const brandId = userDoc?.brand_id;
  if (!brandId) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>연결된 브랜드가 없습니다</h2></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  let products;
  try {
    const q = query(
      collection(db, 'products'),
      where('brand_id', '==', brandId),
      orderBy('submitted_at', 'desc'),
    );
    const snap = await getDocs(q);
    products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('상품 목록 로드 실패:', e);
    container.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--danger)">
      상품 목록을 불러오지 못했습니다.<br>
      <span style="font-size:12px;color:var(--gray-400);margin-top:8px;display:block">${e.message}</span>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div style="max-width:900px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="font-size:18px;font-weight:700">상품 관리</h2>
          <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
            신규 상품 등록 및 수정 요청을 할 수 있습니다. 가격·수수료율은 운영자가 설정합니다.
          </p>
        </div>
        <button class="btn btn-primary" id="btn-add-product" style="width:auto;padding:10px 18px">
          + 상품 등록
        </button>
      </div>
      ${products.length === 0
        ? `<div class="card" style="text-align:center;padding:40px;color:var(--gray-400)">
             등록된 상품이 없습니다.
           </div>`
        : `<div class="table-wrap">
             <table class="data-table">
               <thead>
                 <tr>
                   <th>상품명</th>
                   <th>카테고리</th>
                   <th>희망 소비자가</th>
                   <th>공급가</th>
                   <th>수수료율</th>
                   <th>상태</th>
                   <th>등록일</th>
                   <th></th>
                 </tr>
               </thead>
               <tbody>
                 ${products.map(p => productRow(p)).join('')}
               </tbody>
             </table>
           </div>`
      }
    </div>
  `;

  document.getElementById('btn-add-product').addEventListener('click', () => {
    openProductModal({ brandId, product: null, showModal, closeModal, container, userDoc });
  });

  container.querySelectorAll('.btn-product-detail').forEach(btn => {
    const pId = btn.dataset.id;
    const product = products.find(p => p.id === pId);
    btn.addEventListener('click', () => {
      openProductDetail({ brandId, product, showModal, closeModal, container, userDoc });
    });
  });
}

function productRow(p) {
  const canEdit = p.status === PRODUCT_STATUS.PENDING || p.status === PRODUCT_STATUS.REJECTED;
  return `
    <tr>
      <td style="font-weight:600">${p.product_name || '-'}</td>
      <td>${p.category || '-'}</td>
      <td>${won(p.retail_price)}</td>
      <td>${won(p.supply_price)}</td>
      <td>${p.commission_rate != null ? p.commission_rate + '%' : '-'}</td>
      <td>${statusBadge(p.status)}</td>
      <td style="font-size:12px;color:var(--gray-400)">${fmt(p.submitted_at)}</td>
      <td>
        <button class="btn btn-outline btn-product-detail" data-id="${p.id}"
          style="width:auto;padding:6px 12px;font-size:12px">
          ${canEdit ? '수정요청' : '상세'}
        </button>
      </td>
    </tr>`;
}

function openProductModal({ brandId, product, showModal, closeModal, container, userDoc }) {
  const isEdit = !!product;
  showModal(`
    <div class="modal-title">${isEdit ? '상품 수정 요청' : '신규 상품 등록'}</div>
    ${isEdit ? `<div style="background:var(--gray-50);border-radius:8px;padding:12px;margin-bottom:20px;font-size:13px;color:var(--gray-600)">
      현재 상태: ${statusBadge(product.status)}<br>
      공급가·수수료율은 운영자가 검토 후 설정합니다.
    </div>` : ''}
    <div class="form-group">
      <label class="form-label">상품명 <span style="color:var(--danger)">*</span></label>
      <input id="prod-name" class="form-input" type="text"
        value="${isEdit ? (product.product_name||'') : ''}">
    </div>
    <div class="form-group">
      <label class="form-label">카테고리</label>
      <input id="prod-cat" class="form-input" type="text"
        value="${isEdit ? (product.category||'') : ''}" placeholder="예: 의류, 잡화, 식품">
    </div>
    <div class="form-group">
      <label class="form-label">바코드 (선택)</label>
      <input id="prod-barcode" class="form-input" type="text"
        value="${isEdit ? (product.barcode||'') : ''}">
    </div>
    <div class="form-group">
      <label class="form-label">희망 소비자가 (원) <span style="color:var(--danger)">*</span></label>
      <input id="prod-price" class="form-input" type="number" min="0"
        value="${isEdit ? (product.retail_price||'') : ''}">
    </div>
    <div class="form-group">
      <label class="form-label">상품 설명</label>
      <textarea id="prod-desc" class="form-input" rows="3" style="resize:vertical">${isEdit ? (product.description||'') : ''}</textarea>
    </div>
    ${isEdit ? `<div class="form-group">
      <label class="form-label">수정 요청 사유</label>
      <textarea id="prod-reason" class="form-input" rows="2" style="resize:vertical"
        placeholder="어떤 내용을 수정하고 싶으신지 적어주세요"></textarea>
    </div>` : ''}
    <div id="prod-error" class="form-error"></div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn btn-outline" id="btn-prod-cancel" style="flex:1">취소</button>
      <button class="btn btn-primary" id="btn-prod-save" style="flex:2">
        ${isEdit ? '수정 요청 제출' : '등록 신청'}
      </button>
    </div>
  `);

  document.getElementById('btn-prod-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-prod-save').addEventListener('click', async () => {
    const name  = document.getElementById('prod-name').value.trim();
    const price = document.getElementById('prod-price').value;
    const errEl = document.getElementById('prod-error');
    const saveBtn = document.getElementById('btn-prod-save');
    errEl.textContent = '';

    if (!name)  { errEl.textContent = '상품명을 입력해 주세요.'; return; }
    if (!price) { errEl.textContent = '희망 소비자가를 입력해 주세요.'; return; }

    saveBtn.disabled = true;
    saveBtn.textContent = '처리 중...';

    try {
      const data = {
        product_name: name,
        category:     document.getElementById('prod-cat').value.trim(),
        barcode:      document.getElementById('prod-barcode').value.trim(),
        retail_price: Number(price),
        description:  document.getElementById('prod-desc').value.trim(),
        brand_id:     brandId,
        updated_at:   serverTimestamp(),
      };

      if (isEdit) {
        data.status = PRODUCT_STATUS.MOD_REQ;
        data.mod_reason = document.getElementById('prod-reason').value.trim();
        data.mod_requested_at = serverTimestamp();
        await updateDoc(doc(db, 'products', product.id), data);
      } else {
        data.status = PRODUCT_STATUS.PENDING;
        data.supply_price     = null;
        data.commission_rate  = null;
        data.submitted_at     = serverTimestamp();
        await addDoc(collection(db, 'products'), data);
      }

      closeModal();
      await renderProducts({ userDoc, container, showModal, closeModal });
    } catch (e) {
      errEl.textContent = '처리 중 오류가 발생했습니다.';
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? '수정 요청 제출' : '등록 신청';
    }
  });
}

function openProductDetail({ brandId, product: p, showModal, closeModal, container, userDoc }) {
  const canEdit = p.status === PRODUCT_STATUS.PENDING || p.status === PRODUCT_STATUS.REJECTED;
  showModal(`
    <div class="modal-title">${p.product_name || '상품 상세'}</div>
    <div style="display:grid;gap:10px;margin-bottom:20px">
      <div class="info-row">${infoRow2('상태', statusBadge(p.status))}</div>
      <div class="info-row">${infoRow2('카테고리', p.category || '-')}</div>
      <div class="info-row">${infoRow2('바코드', p.barcode || '-')}</div>
      <div class="info-row">${infoRow2('희망 소비자가', won(p.retail_price))}</div>
      <div class="info-row">${infoRow2('공급가 (운영자 설정)', won(p.supply_price))}</div>
      <div class="info-row">${infoRow2('수수료율 (운영자 설정)',
        p.commission_rate != null ? p.commission_rate + '%' : '-')}</div>
      <div class="info-row">${infoRow2('등록일', fmt(p.submitted_at))}</div>
      ${p.rejection_reason ? `<div class="info-row">${infoRow2('거절 사유',
        `<span style="color:var(--danger)">${p.rejection_reason}</span>`)}</div>` : ''}
    </div>
    ${p.description ? `<div style="background:var(--gray-50);border-radius:8px;padding:14px;font-size:14px;margin-bottom:20px">
      <div style="font-weight:600;margin-bottom:6px">상품 설명</div>
      <p style="color:var(--gray-600);line-height:1.6">${p.description}</p>
    </div>` : ''}
    <div style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-detail-close" style="flex:1">닫기</button>
      ${canEdit ? `<button class="btn btn-primary" id="btn-detail-edit" style="flex:2">수정 요청하기</button>` : ''}
    </div>
  `);

  document.getElementById('btn-detail-close').addEventListener('click', closeModal);
  if (canEdit) {
    document.getElementById('btn-detail-edit').addEventListener('click', () => {
      closeModal();
      openProductModal({ brandId, product: p, showModal, closeModal, container, userDoc });
    });
  }
}

function infoRow2(label, value) {
  return `<span class="info-label">${label}</span><span class="info-value">${value}</span>`;
}
