import { db, doc, getDoc, updateDoc, serverTimestamp } from '../firebase-init.js';

// 브랜드 상태 뱃지 색상
function statusBadge(status) {
  const map = {
    '입점신청중': 'badge-yellow',
    '입점확정':   'badge-green',
    '입점취소':   'badge-red',
    '심사중':     'badge-yellow',
    '승인':       'badge-green',
    '거절':       'badge-red',
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status || '-'}</span>`;
}

function fmt(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
}

export async function renderBrandInfo({ userDoc, container, showModal, closeModal }) {
  const brandId = userDoc?.brand_id;
  if (!brandId) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>브랜드 정보 없음</h2>
      <p>연결된 브랜드가 없습니다. 운영자에게 문의해 주세요.</p></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  const snap = await getDoc(doc(db, 'brands', brandId));
  if (!snap.exists()) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>브랜드를 찾을 수 없습니다</h2></div>`;
    return;
  }

  const b = snap.data();

  container.innerHTML = `
    <div style="max-width:720px">
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <div>
            <h2 style="font-size:22px;font-weight:800">${b.brand_name || '-'}</h2>
            <div style="margin-top:6px">${statusBadge(b.brand_status || b.status)}</div>
          </div>
          <button class="btn btn-outline" id="btn-edit-brand" style="width:auto;padding:10px 20px">
            ✏️ 정보 수정
          </button>
        </div>
        <div class="info-grid">
          ${infoRow('사업자 등록번호', b.biz_no)}
          ${infoRow('대표자명', b.ceo_name)}
          ${infoRow('카테고리', b.category)}
          ${infoRow('연락처', b.phone)}
          ${infoRow('이메일', b.email)}
          ${infoRow('주소', b.address)}
          ${infoRow('입점일', fmt(b.created_at))}
        </div>
      </div>

      ${b.description ? `
      <div class="card" style="margin-bottom:20px">
        <div style="font-weight:700;margin-bottom:10px">브랜드 소개</div>
        <p style="color:var(--gray-600);font-size:14px;line-height:1.7">${b.description}</p>
      </div>` : ''}
    </div>
  `;

  document.getElementById('btn-edit-brand').addEventListener('click', () => {
    openEditModal({ brandId, brand: b, showModal, closeModal, container, userDoc });
  });
}

function infoRow(label, value) {
  return `
    <div class="info-row">
      <span class="info-label">${label}</span>
      <span class="info-value">${value || '-'}</span>
    </div>`;
}

async function openEditModal({ brandId, brand: b, showModal, closeModal, container, userDoc }) {
  showModal(`
    <div class="modal-title">브랜드 정보 수정</div>
    <p style="font-size:13px;color:var(--gray-600);margin-bottom:20px">
      브랜드명·사업자번호·대표자명은 운영자만 변경할 수 있습니다.<br>
      연락처·이메일·주소·소개 내용은 직접 수정하실 수 있습니다.
    </p>
    <div class="form-group">
      <label class="form-label">연락처</label>
      <input id="edit-phone" class="form-input" type="tel" value="${b.phone || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">이메일</label>
      <input id="edit-email" class="form-input" type="email" value="${b.email || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">주소</label>
      <input id="edit-address" class="form-input" type="text" value="${b.address || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">브랜드 소개</label>
      <textarea id="edit-desc" class="form-input" rows="4" style="resize:vertical">${b.description || ''}</textarea>
    </div>
    <div id="edit-error" class="form-error"></div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn btn-outline" id="btn-edit-cancel" style="flex:1">취소</button>
      <button class="btn btn-primary" id="btn-edit-save" style="flex:2">저장</button>
    </div>
  `);

  document.getElementById('btn-edit-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-edit-save').addEventListener('click', async () => {
    const saveBtn = document.getElementById('btn-edit-save');
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';
    try {
      await updateDoc(doc(db, 'brands', brandId), {
        phone:       document.getElementById('edit-phone').value.trim(),
        email:       document.getElementById('edit-email').value.trim(),
        address:     document.getElementById('edit-address').value.trim(),
        description: document.getElementById('edit-desc').value.trim(),
        updated_at:  serverTimestamp(),
      });
      closeModal();
      await renderBrandInfo({ userDoc, container, showModal, closeModal });
    } catch (e) {
      document.getElementById('edit-error').textContent = '저장 중 오류가 발생했습니다. 다시 시도해 주세요.';
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  });
}
