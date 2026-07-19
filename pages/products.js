import {
  db, collection, query, where, orderBy, getDocs,
  addDoc, updateDoc, doc, getDoc, serverTimestamp,
} from '../firebase-init.js';

function noPerm(label) {
  return `<div style="max-width:480px;margin:80px auto;text-align:center;padding:40px">
    <div style="font-size:48px;margin-bottom:16px">🔒</div>
    <h3 style="font-size:17px;font-weight:700;margin-bottom:8px">접근 권한이 없습니다</h3>
    <p style="font-size:14px;color:var(--gray-500);line-height:1.6">[${label}] 메뉴에 대한 접근 권한이 없습니다.<br>주관리자에게 권한 부여를 요청하세요.</p>
  </div>`;
}

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
  let feeInfo = {};
  try {
    const [prodSnap, brandSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'products'),
        where('brand_id', '==', brandId),
        orderBy('submitted_at', 'desc'),
      )),
      getDoc(doc(db, 'brands', brandId)),
    ]);
    products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const bd = brandSnap.data() || {};
    brandTypes = bd.brand_types || (bd.brand_type ? [bd.brand_type] : []);
    feeInfo = bd.fee_info || {};
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
               <th>카테고리</th>
               ${multiType ? '<th>거래유형</th>' : ''}
               <th>판매가</th>
               <th>공급가</th>
               <th>수수료율</th>
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
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="font-size:18px;font-weight:700">상품 관리</h2>
          <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
            신규 상품 등록 및 수정 요청을 할 수 있습니다. 위탁 상품은 공급가·수수료율을 직접 입력합니다.
          </p>
        </div>
        <button class="btn btn-primary" id="btn-add-product" style="width:auto;padding:10px 18px">
          + 상품 등록
        </button>
      </div>
      ${tableHtml}
    </div>
  `;

  document.getElementById('btn-add-product').addEventListener('click', () => {
    openProductModal({ brandId, product: null, brandTypes, feeInfo, showModal, closeModal, container, userDoc, permissions });
  });

  container.querySelectorAll('.btn-product-detail').forEach(btn => {
    const pId = btn.dataset.id;
    const product = products.find(p => p.id === pId);
    btn.addEventListener('click', () => {
      openProductDetail({ brandId, product, brandTypes, feeInfo, showModal, closeModal, container, userDoc, permissions });
    });
  });

  // transaction_type filter
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
  const canEdit = p.status === PRODUCT_STATUS.PENDING || p.status === PRODUCT_STATUS.REJECTED;
  return `
    <tr data-tx="${p.transaction_type || ''}">
      <td style="font-weight:600">${p.product_name || '-'}</td>
      <td>${p.category || '-'}</td>
      ${multiType ? `<td>${p.transaction_type ? `<span class="badge badge-gray">${p.transaction_type}</span>` : '-'}</td>` : ''}
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

function openProductModal({ brandId, product, brandTypes = [], feeInfo = {}, showModal, closeModal, container, userDoc, permissions }) {
  const isEdit = !!product;
  const initTxType = (isEdit ? product.transaction_type : '') || (brandTypes.length === 1 ? brandTypes[0] : '');

  const txTypeHtml = (() => {
    if (brandTypes.length === 0) return '';
    if (brandTypes.length === 1) {
      return `<input type="hidden" id="prod-tx-type" value="${brandTypes[0]}">`;
    }
    return `
      <div class="form-group">
        <label class="form-label">거래유형 <span style="color:var(--danger)">*</span></label>
        <select id="prod-tx-type" class="form-input form-select">
          <option value="">선택하세요</option>
          ${brandTypes.map(t => `<option value="${t}"${initTxType === t ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>`;
  })();

  showModal(`
    <div class="modal-title">${isEdit ? '상품 수정 요청' : '신규 상품 등록'}</div>
    ${isEdit ? `<div style="background:var(--gray-50);border-radius:8px;padding:12px;margin-bottom:20px;font-size:13px;color:var(--gray-600)">
      현재 상태: ${statusBadge(product.status)}
    </div>` : ''}
    ${txTypeHtml}
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
    <div id="prod-price-section"></div>
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
    <div class="modal-footer" style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-prod-cancel" style="flex:1">취소</button>
      <button class="btn btn-primary" id="btn-prod-save" style="flex:2">
        ${isEdit ? '수정 요청 제출' : '등록 신청'}
      </button>
    </div>
  `);

  function renderPriceSection(txType) {
    const section = document.getElementById('prod-price-section');
    if (!section) return;

    if (txType === '위탁') {
      const initCommRate = (isEdit && product.commission_rate != null ? product.commission_rate : '') || feeInfo.commission_rate || '';
      const initMode = (isEdit && product.price_calc_mode) || 'supply';
      const initSupply = isEdit ? (product.supply_price || '') : '';
      const initRetail = isEdit ? (product.retail_price || '') : '';

      section.innerHTML = `
        <div class="form-group">
          <label class="form-label">가격 결정 방식</label>
          <div style="display:flex;gap:24px;margin-top:6px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
              <input type="radio" name="price-mode" value="supply" ${initMode !== 'retail' ? 'checked' : ''}>
              공급가 기준 (공급가 → 판매가 자동계산)
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
              <input type="radio" name="price-mode" value="retail" ${initMode === 'retail' ? 'checked' : ''}>
              판매가 기준 (판매가 → 공급가 자동계산)
            </label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">위탁수수료율 (%) <span style="color:var(--danger)">*</span></label>
          <input id="prod-comm-rate" class="form-input" type="number" min="0" max="100" step="0.1"
            value="${initCommRate}" placeholder="예: 30">
        </div>
        <div class="form-group">
          <label class="form-label" id="label-supply">공급가 (원) <span style="color:var(--danger)">*</span></label>
          <input id="prod-supply-price" class="form-input" type="number" min="0" value="${initSupply}"
            style="${initMode === 'retail' ? 'background:var(--gray-50);color:var(--gray-400)' : ''}">
          <div id="hint-supply" class="form-hint" style="display:${initMode === 'retail' ? 'block' : 'none'}">판매가 기준 모드: 자동계산됩니다</div>
        </div>
        <div class="form-group">
          <label class="form-label" id="label-retail">판매가 (원) <span style="color:var(--danger)">*</span></label>
          <input id="prod-retail-price" class="form-input" type="number" min="0" value="${initRetail}"
            style="${initMode !== 'retail' ? 'background:var(--gray-50);color:var(--gray-400)' : ''}">
          <div id="hint-retail" class="form-hint" style="display:${initMode !== 'retail' ? 'block' : 'none'}">공급가 기준 모드: 자동계산됩니다</div>
        </div>
      `;

      attachPriceListeners();
    } else {
      const initRetail = isEdit ? (product.retail_price || '') : '';
      section.innerHTML = `
        <div class="form-group">
          <label class="form-label">판매가 (원) <span style="color:var(--danger)">*</span></label>
          <input id="prod-retail-price" class="form-input" type="number" min="0" value="${initRetail}">
        </div>
      `;
    }
  }

  function attachPriceListeners() {
    function getMode() {
      return document.querySelector('input[name="price-mode"]:checked')?.value || 'supply';
    }

    function calcPrices() {
      const mode = getMode();
      const commRate = Number(document.getElementById('prod-comm-rate')?.value || 0);
      const supplyEl = document.getElementById('prod-supply-price');
      const retailEl = document.getElementById('prod-retail-price');
      if (!supplyEl || !retailEl) return;

      if (mode === 'supply') {
        const supply = Number(supplyEl.value || 0);
        if (supply > 0 && commRate > 0 && commRate < 100) {
          retailEl.value = Math.ceil(supply / (1 - commRate / 100) / 100) * 100;
        } else {
          retailEl.value = '';
        }
      } else {
        const retail = Number(retailEl.value || 0);
        if (retail > 0 && commRate >= 0 && commRate < 100) {
          supplyEl.value = Math.floor(retail * (1 - commRate / 100));
        } else {
          supplyEl.value = '';
        }
      }
    }

    function applyModeStyles() {
      const mode = getMode();
      const supplyEl = document.getElementById('prod-supply-price');
      const retailEl = document.getElementById('prod-retail-price');
      const hintSupply = document.getElementById('hint-supply');
      const hintRetail = document.getElementById('hint-retail');
      if (!supplyEl || !retailEl) return;

      if (mode === 'supply') {
        supplyEl.style.background = '';
        supplyEl.style.color = '';
        supplyEl.readOnly = false;
        retailEl.style.background = 'var(--gray-50)';
        retailEl.style.color = 'var(--gray-400)';
        retailEl.readOnly = true;
        if (hintSupply) hintSupply.style.display = 'none';
        if (hintRetail) hintRetail.style.display = 'block';
      } else {
        retailEl.style.background = '';
        retailEl.style.color = '';
        retailEl.readOnly = false;
        supplyEl.style.background = 'var(--gray-50)';
        supplyEl.style.color = 'var(--gray-400)';
        supplyEl.readOnly = true;
        if (hintRetail) hintRetail.style.display = 'none';
        if (hintSupply) hintSupply.style.display = 'block';
      }
    }

    document.querySelectorAll('input[name="price-mode"]').forEach(r => {
      r.addEventListener('change', () => {
        applyModeStyles();
        calcPrices();
      });
    });
    document.getElementById('prod-comm-rate')?.addEventListener('input', calcPrices);
    document.getElementById('prod-supply-price')?.addEventListener('input', () => {
      if (getMode() === 'supply') calcPrices();
    });
    document.getElementById('prod-retail-price')?.addEventListener('input', () => {
      if (getMode() === 'retail') calcPrices();
    });

    // Initial state
    applyModeStyles();
    if (isEdit && (product.supply_price || product.retail_price)) calcPrices();
  }

  // Initial render
  renderPriceSection(initTxType);

  // Re-render price section when tx type changes (multi-type brand)
  const txSelect = document.getElementById('prod-tx-type');
  if (txSelect && brandTypes.length > 1) {
    txSelect.addEventListener('change', () => renderPriceSection(txSelect.value));
  }

  document.getElementById('btn-prod-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-prod-save').addEventListener('click', async () => {
    const errEl = document.getElementById('prod-error');
    const saveBtn = document.getElementById('btn-prod-save');
    errEl.textContent = '';

    const name    = document.getElementById('prod-name').value.trim();
    const txType  = document.getElementById('prod-tx-type')?.value || '';
    const isWitag = txType === '위탁';

    if (!name) { errEl.textContent = '상품명을 입력해 주세요.'; return; }
    if (brandTypes.length > 1 && !txType) { errEl.textContent = '거래유형을 선택해 주세요.'; return; }

    let retailPrice, supplyPrice, commRate, priceCalcMode;

    if (isWitag) {
      commRate = document.getElementById('prod-comm-rate')?.value;
      supplyPrice = Number(document.getElementById('prod-supply-price')?.value || 0);
      retailPrice = Number(document.getElementById('prod-retail-price')?.value || 0);
      priceCalcMode = document.querySelector('input[name="price-mode"]:checked')?.value || 'supply';

      if (!commRate) { errEl.textContent = '위탁수수료율을 입력해 주세요.'; return; }
      if (priceCalcMode === 'supply' && !supplyPrice) { errEl.textContent = '공급가를 입력해 주세요.'; return; }
      if (priceCalcMode === 'retail' && !retailPrice) { errEl.textContent = '판매가를 입력해 주세요.'; return; }
      if (!retailPrice || !supplyPrice) { errEl.textContent = '가격을 입력하면 자동계산 후 저장됩니다.'; return; }
    } else {
      retailPrice = Number(document.getElementById('prod-retail-price')?.value || 0);
      if (!retailPrice) { errEl.textContent = '판매가를 입력해 주세요.'; return; }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = '처리 중...';

    try {
      const data = {
        product_name:     name,
        category:         document.getElementById('prod-cat').value.trim(),
        barcode:          document.getElementById('prod-barcode').value.trim(),
        retail_price:     retailPrice,
        description:      document.getElementById('prod-desc').value.trim(),
        transaction_type: txType || (brandTypes[0] || null),
        brand_id:         brandId,
        updated_at:       serverTimestamp(),
      };

      if (isWitag) {
        data.supply_price    = supplyPrice;
        data.commission_rate = Number(commRate);
        data.price_calc_mode = priceCalcMode;
      } else {
        data.supply_price    = null;
        data.commission_rate = null;
      }

      if (isEdit) {
        data.status = PRODUCT_STATUS.MOD_REQ;
        data.mod_reason = document.getElementById('prod-reason').value.trim();
        data.mod_requested_at = serverTimestamp();
        await updateDoc(doc(db, 'products', product.id), data);
      } else {
        data.status = PRODUCT_STATUS.PENDING;
        if (!isWitag) data.supply_price = null;
        data.submitted_at = serverTimestamp();
        await addDoc(collection(db, 'products'), data);
      }

      closeModal();
      await renderProducts({ userDoc, container, showModal, closeModal, permissions });
    } catch (e) {
      errEl.textContent = '처리 중 오류가 발생했습니다.';
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? '수정 요청 제출' : '등록 신청';
    }
  });
}

function openProductDetail({ brandId, product: p, brandTypes, feeInfo, showModal, closeModal, container, userDoc, permissions }) {
  const canEdit = p.status === PRODUCT_STATUS.PENDING || p.status === PRODUCT_STATUS.REJECTED;
  const isWitag = p.transaction_type === '위탁';

  const priceRows = isWitag ? `
    <div class="info-row">${infoRow2('공급가', won(p.supply_price))}</div>
    <div class="info-row">${infoRow2('수수료율', p.commission_rate != null ? p.commission_rate + '%' : '-')}</div>
    <div class="info-row">${infoRow2('판매가 (자동계산)', won(p.retail_price))}</div>
  ` : `
    <div class="info-row">${infoRow2('판매가', won(p.retail_price))}</div>
    <div class="info-row">${infoRow2('공급가 (운영자 설정)', won(p.supply_price))}</div>
    <div class="info-row">${infoRow2('수수료율 (운영자 설정)', p.commission_rate != null ? p.commission_rate + '%' : '-')}</div>
  `;

  showModal(`
    <div class="modal-title">${p.product_name || '상품 상세'}</div>
    <div style="display:grid;gap:10px;margin-bottom:20px">
      <div class="info-row">${infoRow2('상태', statusBadge(p.status))}</div>
      ${p.transaction_type ? `<div class="info-row">${infoRow2('거래유형', `<span class="badge badge-gray">${p.transaction_type}</span>`)}</div>` : ''}
      <div class="info-row">${infoRow2('카테고리', p.category || '-')}</div>
      <div class="info-row">${infoRow2('바코드', p.barcode || '-')}</div>
      ${priceRows}
      <div class="info-row">${infoRow2('등록일', fmt(p.submitted_at))}</div>
      ${p.rejection_reason ? `<div class="info-row">${infoRow2('거절 사유',
        `<span style="color:var(--danger)">${p.rejection_reason}</span>`)}</div>` : ''}
    </div>
    ${p.description ? `<div style="background:var(--gray-50);border-radius:8px;padding:14px;font-size:14px;margin-bottom:20px">
      <div style="font-weight:600;margin-bottom:6px">상품 설명</div>
      <p style="color:var(--gray-600);line-height:1.6">${p.description}</p>
    </div>` : ''}
    <div class="modal-footer" style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-detail-close" style="flex:1">닫기</button>
      ${canEdit ? `<button class="btn btn-primary" id="btn-detail-edit" style="flex:2">수정 요청하기</button>` : ''}
    </div>
  `);

  document.getElementById('btn-detail-close').addEventListener('click', closeModal);
  if (canEdit) {
    document.getElementById('btn-detail-edit').addEventListener('click', () => {
      closeModal();
      openProductModal({ brandId, product: p, brandTypes, feeInfo, showModal, closeModal, container, userDoc, permissions });
    });
  }
}

function infoRow2(label, value) {
  return `<span class="info-label">${label}</span><span class="info-value">${value}</span>`;
}
