import { db, doc, getDoc, updateDoc, serverTimestamp, storage, ref, uploadBytes, getDownloadURL } from '../firebase-init.js';
import { encryptValue, decryptValue, isEncrypted } from '../utils/encryption.js';
import {
  validateBizRegNumber, formatBizRegNumber,
  validateResidentNumber, formatResidentNumber,
  verifyBizNumber, validateSettlementForm,
} from '../utils/validation.js';
import { esc, safeUrl } from '../utils/sanitize.js';

// onboarding_status 값 기반 뱃지
function statusBadge(status) {
  const map = {
    '미계약':             ['badge-gray',   '계약 전'],
    '계약 전':            ['badge-gray',   '계약 전'],
    '계약 정보 입력 필요': ['badge-orange', '계약 정보 입력 필요'],
    '심사중':             ['badge-yellow', '심사중'],
    '계약완료':           ['badge-yellow', '계약완료'],
    '승인':               ['badge-green',  '승인'],
    '입점확정':           ['badge-green',  '입점확정'],
    '거절':               ['badge-red',    '거절'],
    '종료':               ['badge-red',    '종료'],
  };
  const [cls, label] = map[status] || ['badge-gray', status || '-'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function fmt(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
}

function infoRow(label, value) {
  if (!value) return '';
  return `
    <div class="info-row">
      <span class="info-label">${label}</span>
      <span class="info-value">${value}</span>
    </div>`;
}

function sectionHeader(title) {
  return `<div style="font-size:12px;font-weight:600;color:var(--gray-500);letter-spacing:.04em;margin:20px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--gray-100)">${title}</div>`;
}

export async function renderBrandInfo({ userDoc, container, showModal, closeModal, permissions }) {
  if (permissions && permissions['brand-info.view'] === false) {
    container.innerHTML = `<div style="max-width:480px;margin:80px auto;text-align:center;padding:40px">
      <div style="font-size:48px;margin-bottom:16px">🔒</div>
      <h3 style="font-size:17px;font-weight:700;margin-bottom:8px">접근 권한이 없습니다</h3>
      <p style="font-size:14px;color:var(--gray-500);line-height:1.6">[브랜드 정보] 메뉴에 대한 접근 권한이 없습니다.<br>주관리자에게 권한 부여를 요청하세요.</p>
    </div>`;
    return;
  }
  const canEditBrandInfo = !permissions || permissions['brand-info.edit'] !== false;
  const canViewSettlement = !permissions || permissions['settlement-info.view'] !== false;
  const canEditSettlement = !permissions || permissions['settlement-info.edit'] !== false;

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
  const si = b.settlement_info || {};
  const onboardingStatus = b.onboarding_status || b.brand_status || b.status;
  const brandType = b.brand_type || '';

  // 관련 사이트
  const websiteUrlsHtml = (() => {
    const urls = b.website_urls || (b.brand_link ? [b.brand_link] : []);
    if (!urls.length) return '';
    return `
      <div class="info-row">
        <span class="info-label">관련 사이트</span>
        <span class="info-value" style="display:flex;flex-direction:column;gap:4px">
          ${urls.map(u => safeUrl(u) ? `<a href="${safeUrl(u)}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:underline;font-size:13px;word-break:break-all">${esc(u)}</a>` : '').join('')}
        </span>
      </div>`;
  })();

  // 정산 정보 (운영자 확정값: 읽기 전용)
  const adminConfirmedHtml = (() => {
    const rows = [];
    if (brandType) rows.push(infoRow('거래유형', brandType));
    if (b.brand_code) rows.push(`
      <div class="info-row">
        <span class="info-label">브랜드 코드</span>
        <span class="info-value">
          <code style="background:var(--primary-light);color:var(--primary);padding:3px 10px;border-radius:6px;font-size:13px;font-weight:700;letter-spacing:.05em">${esc(b.brand_code)}</code>
        </span>
      </div>`);
    const commissionRate = b.fee_info?.commission_rate;
    if (brandType === '위탁' && commissionRate != null) {
      rows.push(infoRow('위탁판매대행수수료', `${commissionRate}%`));
    }
    return rows.join('');
  })();

  // 계약 및 정산 정보 (벤더 입력 — 민감 정보 마스킹)
  const settlementHtml = (() => {
    if (!si || (!si.bank_name && !si.account_holder)) return '';
    const bizLabel = si.business_type === 'business' ? '사업자' : si.business_type === 'individual' ? '개인(사업자없음)' : '';
    const rows = [];
    if (bizLabel) rows.push(infoRow('사업자 여부', bizLabel));
    if (si.address) rows.push(infoRow('주소', esc(si.address)));
    if (si.business_type === 'business') {
      if (si.corp_name)           rows.push(infoRow('상호', esc(si.corp_name)));
      if (si.representative_name) rows.push(infoRow('대표자명', esc(si.representative_name)));
      if (si.business_start_date) rows.push(infoRow('사업자등록일', si.business_start_date));
      if (si.business_reg_number) rows.push(infoRow('사업자등록번호', si.business_reg_number));
      if (si.taxation_type)       rows.push(infoRow('과세유형', si.taxation_type));
    }
    if (si.business_type === 'individual' && si.resident_number) {
      rows.push(infoRow('주민등록번호', '••••••-•••••••'));
    }
    if (si.bank_name) rows.push(infoRow('은행명', si.bank_name));
    if (si.account_holder) rows.push(infoRow('예금주명', si.account_holder));
    if (si.account_number) rows.push(infoRow('계좌번호', '••••••-••-••••••'));
    return rows.join('');
  })();

  const hasSettlement = settlementHtml.length > 0;
  const needsContractInfo = onboardingStatus === '계약 정보 입력 필요' && !hasSettlement;

  const contractCompleteNotice = onboardingStatus === '계약완료' ? `
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:flex-start;gap:12px">
      <span style="font-size:20px;flex-shrink:0">✍️</span>
      <div>
        <div style="font-weight:700;font-size:14px;color:#1d4ed8;margin-bottom:4px">계약 서명이 완료되었습니다</div>
        <div style="font-size:13px;color:#3b82f6;line-height:1.6">관리자 검토 후 최종 승인이 완료되면 입점이 확정됩니다.</div>
      </div>
    </div>` : '';

  container.innerHTML = `
    <div style="max-width:720px">
      ${contractCompleteNotice}
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:16px">
          <div style="display:flex;align-items:center;gap:16px">
            ${(b.logo_url || b.brand_photo_url)
              ? `<img src="${esc(b.logo_url || b.brand_photo_url)}" alt="${esc(b.brand_name || '')}"
                   style="width:72px;height:72px;border-radius:12px;object-fit:cover;border:1px solid var(--gray-200);flex-shrink:0">`
              : `<div style="width:72px;height:72px;border-radius:12px;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;flex-shrink:0">
                   ${(b.brand_name || '?')[0].toUpperCase()}
                 </div>`}
            <div>
              <h2 style="font-size:22px;font-weight:800">${esc(b.brand_name) || '-'}</h2>
              <div style="margin-top:6px">${statusBadge(onboardingStatus)}</div>
            </div>
          </div>
          ${canEditBrandInfo ? `<button class="btn btn-outline" id="btn-edit-brand" style="width:auto;padding:10px 20px;flex-shrink:0">
            ✏️ 정보 수정
          </button>` : ''}
        </div>

        <div class="info-grid">
          ${adminConfirmedHtml}
          ${b.approved_at ? infoRow('입점승인일', fmt(b.approved_at)) : ''}
          ${b.contract_completed_at ? infoRow('입점계약체결일', fmt(b.contract_completed_at)) : ''}
          ${(!b.approved_at && !b.contract_completed_at && b.created_at) ? infoRow('등록일', fmt(b.created_at)) : ''}
          ${websiteUrlsHtml}
        </div>

        ${b.brand_desc || b.description ? `
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--gray-100)">
            <div style="font-size:12px;font-weight:600;color:var(--gray-500);margin-bottom:6px">브랜드 소개</div>
            <p style="color:var(--gray-600);font-size:14px;line-height:1.7">${esc(b.brand_desc || b.description)}</p>
          </div>` : ''}
      </div>

      ${(brandType === 'pb' || !canViewSettlement) ? '' : `<div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-weight:700">계약 및 정산 정보</div>
          ${canEditSettlement ? (hasSettlement
            ? `<button class="btn btn-outline" id="btn-edit-settlement" style="width:auto;padding:8px 16px;font-size:13px;margin-top:0">✏️ 수정</button>`
            : `<button class="btn btn-primary" id="btn-edit-settlement" style="width:auto;padding:8px 16px;font-size:13px;margin-top:0">+ 입력</button>`)
          : ''}
        </div>
        <p style="font-size:12px;color:var(--gray-500);margin-bottom:12px;line-height:1.6">
          입점 계약 체결 및 정산 연결을 위해 필요한 정보를 요청합니다. 민감한 정보는 암호화 저장됩니다.
        </p>
        ${needsContractInfo ? `
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;display:flex;align-items:flex-start;gap:10px;margin-bottom:12px">
          <span style="font-size:18px;flex-shrink:0">📋</span>
          <div>
            <div style="font-weight:700;font-size:13px;color:#c2410c;margin-bottom:3px">계약 정보 입력이 필요합니다</div>
            <div style="font-size:12px;color:#ea580c;line-height:1.5">아래 [입력] 버튼을 눌러 계약 및 정산 정보를 입력해 주세요. 입력 완료 후 계약 절차가 진행됩니다.</div>
          </div>
        </div>` : ''}
        ${hasSettlement ? `
        <div class="info-grid">
          ${settlementHtml}
        </div>
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--gray-100)">
          <div style="font-size:12px;font-weight:600;color:var(--gray-500);margin-bottom:10px">서류</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${[
              { key: 'id_card_url',   label: '신분증 사본' },
              { key: 'bank_book_url', label: '통장 사본' },
              { key: 'biz_reg_url',   label: '사업자등록증' },
            ].map(({ key, label }) => si[key]
              ? `<div style="display:flex;align-items:center;gap:10px">
                   <span style="font-size:13px;color:var(--gray-700);min-width:80px">${esc(label)}</span>
                   <span style="font-size:12px;color:var(--success);font-weight:600">✅ 등록완료 (자동저장)</span>
                   ${safeUrl(si[key]) ? `<a href="${safeUrl(si[key])}" target="_blank" rel="noopener"
                     style="font-size:12px;color:var(--primary);text-decoration:underline;margin-left:4px">열기</a>` : ''}
                 </div>`
              : `<div style="display:flex;align-items:center;gap:10px">
                   <span style="font-size:13px;color:var(--gray-700);min-width:80px">${label}</span>
                   <span style="font-size:12px;color:var(--gray-400)">미등록</span>
                 </div>`
            ).join('')}
          </div>
        </div>` : ''}
      </div>`}
    </div>
  `;

  document.getElementById('btn-edit-brand')?.addEventListener('click', () => {
    openEditBrandModal({ brandId, brand: b, showModal, closeModal, container, userDoc });
  });
  document.getElementById('btn-edit-settlement')?.addEventListener('click', () => {
    openEditSettlementModal({ brandId, brand: b, showModal, closeModal, container, userDoc });
  });
}

// ── 기본 정보 수정 모달 ──
async function openEditBrandModal({ brandId, brand: b, showModal, closeModal, container, userDoc }) {
  const urls = b.website_urls || (b.brand_link ? [b.brand_link] : []);

  showModal(`
    <div class="modal-title">브랜드 기본 정보 수정</div>
    <p style="font-size:13px;color:var(--gray-500);margin-bottom:20px">
      브랜드명·거래유형·브랜드코드는 운영자만 변경할 수 있습니다.
    </p>

    <div class="form-group">
      <label class="form-label">브랜드 대표 이미지 <span style="color:var(--gray-400);font-weight:400">(정사각형 500×500px 권장, JPG/PNG)</span></label>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        ${(b.logo_url || b.brand_photo_url)
          ? `<img id="edit-photo-preview-img" src="${esc(b.logo_url || b.brand_photo_url)}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid var(--gray-200)">`
          : `<div id="edit-photo-preview-img" style="width:64px;height:64px;border-radius:8px;background:var(--gray-100);display:flex;align-items:center;justify-content:center;color:var(--gray-400);font-size:22px">🖼️</div>`}
        <div style="flex:1">
          <input id="edit-brand-photo" type="file" accept="image/jpeg,image/png"
            style="display:block;width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:13px;cursor:pointer">
        </div>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">브랜드 간단 소개</label>
      <textarea id="edit-desc" class="form-input" rows="3" style="resize:vertical">${b.brand_desc || b.description || ''}</textarea>
    </div>

    <div class="form-group">
      <label class="form-label">관련 사이트 <span style="color:var(--gray-400);font-weight:400">(최대 5개)</span></label>
      <div id="edit-url-list">
        ${urls.map(u => `
          <div class="edit-url-row" style="display:flex;gap:8px;margin-bottom:8px">
            <input class="form-input edit-url-input" type="url" value="${u}" style="flex:1">
            <button type="button" class="edit-url-remove" style="padding:0 12px;background:none;border:1.5px solid var(--gray-200);border-radius:8px;font-size:16px;color:var(--gray-400);cursor:pointer">✕</button>
          </div>`).join('')}
      </div>
      <button type="button" id="btn-edit-add-url"
        style="margin-top:4px;padding:7px 14px;background:none;border:1.5px dashed var(--gray-300);border-radius:8px;font-size:13px;color:var(--gray-500);cursor:pointer;width:100%;${urls.length >= 5 ? 'display:none' : ''}">
        + URL 추가
      </button>
    </div>

    <div id="edit-error" class="form-error"></div>
    <div class="modal-footer" style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-edit-cancel" style="flex:1">취소</button>
      <button class="btn btn-primary" id="btn-edit-save" style="flex:2">저장</button>
    </div>
  `);

  // 사진 미리보기
  document.getElementById('edit-brand-photo').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const preview = document.getElementById('edit-photo-preview-img');
      if (preview.tagName === 'IMG') {
        preview.src = ev.target.result;
      } else {
        const img = document.createElement('img');
        img.id = 'edit-photo-preview-img';
        img.style.cssText = 'width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid var(--gray-200)';
        img.src = ev.target.result;
        preview.replaceWith(img);
      }
    };
    reader.readAsDataURL(file);
  });

  // URL 행 추가/삭제
  function attachRemoveListeners() {
    document.querySelectorAll('.edit-url-remove').forEach(btn => {
      btn.onclick = () => {
        btn.closest('.edit-url-row').remove();
        const count = document.querySelectorAll('.edit-url-row').length;
        document.getElementById('btn-edit-add-url').style.display = count >= 5 ? 'none' : 'block';
      };
    });
  }
  attachRemoveListeners();

  document.getElementById('btn-edit-add-url').addEventListener('click', () => {
    const list = document.getElementById('edit-url-list');
    const count = list.querySelectorAll('.edit-url-row').length;
    if (count >= 5) return;
    const row = document.createElement('div');
    row.className = 'edit-url-row';
    row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
    row.innerHTML = `
      <input class="form-input edit-url-input" type="url" placeholder="https://" style="flex:1">
      <button type="button" class="edit-url-remove" style="padding:0 12px;background:none;border:1.5px solid var(--gray-200);border-radius:8px;font-size:16px;color:var(--gray-400);cursor:pointer">✕</button>
    `;
    list.appendChild(row);
    attachRemoveListeners();
    if (list.querySelectorAll('.edit-url-row').length >= 5) {
      document.getElementById('btn-edit-add-url').style.display = 'none';
    }
  });

  document.getElementById('btn-edit-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-edit-save').addEventListener('click', async () => {
    const saveBtn = document.getElementById('btn-edit-save');
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';
    try {
      const websiteUrls = [...document.querySelectorAll('.edit-url-input')]
        .map(el => el.value.trim()).filter(Boolean);

      // 사진 업로드 (선택 시에만)
      let photoUrl = b.logo_url || b.brand_photo_url || '';
      const photoFile = document.getElementById('edit-brand-photo').files[0];
      if (photoFile) {
        try {
          const photoRef = ref(storage, `brands/${brandId}/photo_${Date.now()}_${photoFile.name}`);
          await uploadBytes(photoRef, photoFile);
          photoUrl = await getDownloadURL(photoRef);
        } catch (_) { /* 사진 실패해도 나머지 저장 계속 */ }
      }

      const updates = {
        brand_desc:   document.getElementById('edit-desc').value.trim(),
        website_urls: websiteUrls,
        updated_at:   serverTimestamp(),
      };
      if (photoUrl) updates.logo_url = photoUrl;

      await updateDoc(doc(db, 'brands', brandId), updates);
      closeModal();
      window._gotoPage?.('brand-info');
    } catch (e) {
      document.getElementById('edit-error').textContent = '저장 중 오류가 발생했습니다.';
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  });
}

// ── 정산 정보 수정 모달 ──
async function openEditSettlementModal({ brandId, brand: b, showModal, closeModal, container, userDoc }) {
  const si = b.settlement_info || {};
  const brandType = b.brand_type || '';

  // 기존 암호화된 값 복호화 (실패시 빈값)
  let existingAccountNumber = '';
  let existingResidentNumber = '';
  try {
    if (si.account_number) existingAccountNumber = await decryptValue(si.account_number);
    if (si.resident_number) existingResidentNumber = await decryptValue(si.resident_number);
  } catch (_) { /* 키 없으면 빈값으로 */ }

  const isBiz = si.business_type === 'business';
  const isInd = si.business_type === 'individual';

  const isFirstInput = !si.bank_name;

  showModal(`
    <div class="modal-title">${isFirstInput ? '계약 및 정산 정보 입력' : '계약 및 정산 정보 수정'}</div>
    <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px">
      입점 계약 체결 및 정산 연결을 위해 필요한 정보를 요청합니다. 민감한 정보는 암호화 저장됩니다.
    </p>

    <div class="form-group">
      <label class="form-label">사업자 여부 <span style="color:var(--danger)">*</span></label>
      <div style="display:flex;gap:12px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
          <input type="radio" name="edit-biz-type" value="business" id="edit-biz-business"${isBiz ? ' checked' : ''}> 사업자
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
          <input type="radio" name="edit-biz-type" value="individual" id="edit-biz-individual"${isInd ? ' checked' : ''}> 개인(사업자없음)
        </label>
      </div>
    </div>

    <!-- 사업자 섹션 -->
    <div id="edit-business-fields" style="display:${isBiz ? 'block' : 'none'}">
      <div class="form-group">
        <label class="form-label">사업자등록번호 <span style="color:var(--danger)">*</span></label>
        <div style="display:flex;gap:8px">
          <input id="edit-biz-reg-number" class="form-input" type="text" placeholder="000-00-00000" value="${si.business_reg_number || ''}" style="flex:1">
          <button type="button" id="btn-edit-verify-biz"
            style="white-space:nowrap;padding:0 14px;background:var(--gray-100);border:1.5px solid var(--gray-200);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;color:var(--gray-700)">
            사업자 확인
          </button>
        </div>
        <div id="edit-biz-hint" style="font-size:12px;margin-top:5px;min-height:18px"></div>
      </div>
      <div class="form-group">
        <label class="form-label">과세 유형 <span style="color:var(--danger)">*</span></label>
        <select id="edit-taxation-type" class="form-input form-select">
          <option value="">선택하세요</option>
          <option value="일반"${si.taxation_type === '일반' ? ' selected' : ''}>일반과세</option>
          <option value="간이"${si.taxation_type === '간이' ? ' selected' : ''}>간이과세</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">상호 <span style="color:var(--danger)">*</span></label>
          <input id="edit-corp-name" class="form-input" type="text" placeholder="사업자등록증상 상호명" value="${esc(si.corp_name || '')}">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">대표자명 <span style="color:var(--danger)">*</span></label>
          <input id="edit-representative-name" class="form-input" type="text" placeholder="예: 홍길동" value="${esc(si.representative_name || '')}">
        </div>
      </div>
      <div class="form-group" style="margin-top:12px">
        <label class="form-label">사업자등록일 <span style="color:var(--danger)">*</span></label>
        <input id="edit-business-start-date" class="form-input" type="text" inputmode="numeric" maxlength="8"
          placeholder="YYYYMMDD (예: 20200115)" value="${esc(si.business_start_date || '')}">
      </div>
      <div class="form-group">
        <label class="form-label" id="edit-address-biz-label">사업장 주소 <span style="color:var(--danger)">*</span></label>
        <input id="edit-address-biz" class="form-input" type="text" placeholder="사업장 주소" value="${esc(si.address || '')}">
      </div>
      <div id="edit-vat-notice" style="display:${si.taxation_type ? 'block' : 'none'};margin-bottom:16px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;line-height:1.6">
        ⚠️ 세금계산서 발행을 위해 사업자 이메일이 필요할 수 있습니다. 운영자가 별도 안내드립니다.
      </div>
    </div>

    <!-- 개인 섹션 -->
    <div id="edit-individual-fields" style="display:${isInd ? 'block' : 'none'}">
      <div class="form-group">
        <label class="form-label">주민등록번호 <span style="color:var(--danger)">*</span></label>
        <input id="edit-resident-number" class="form-input" type="password"
          placeholder="000000-0000000" maxlength="14" autocomplete="off" value="${existingResidentNumber}">
        <div id="edit-resident-hint" style="font-size:12px;margin-top:5px;min-height:18px"></div>
        <p style="margin-top:6px;font-size:11px;color:var(--gray-500);line-height:1.5;background:var(--gray-50);padding:8px 10px;border-radius:6px">
          주민등록번호는 소득세법 제127조에 따른 원천징수 신고 목적으로만 수집됩니다.<br>
          AES-256 암호화 저장, 세무법정 보관 기간(5년) 이후 파기됩니다.
        </p>
      </div>
      <div class="form-group">
        <label class="form-label">주소 <span style="color:var(--danger)">*</span></label>
        <input id="edit-address-ind" class="form-input" type="text" placeholder="거주지 주소" value="${esc(si.address || '')}">
      </div>
    </div>

    <!-- 공통: 통장 정보 -->
    <div class="form-group">
      <label class="form-label">은행명 <span style="color:var(--danger)">*</span></label>
      <input id="edit-bank-name" class="form-input" type="text" placeholder="국민은행" value="${si.bank_name || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">예금주명 <span style="color:var(--danger)">*</span></label>
      <input id="edit-account-holder" class="form-input" type="text" placeholder="홍길동" value="${si.account_holder || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">계좌번호 <span style="color:var(--danger)">*</span></label>
      <input id="edit-account-number" class="form-input" type="text" placeholder="000000-00-000000" value="${existingAccountNumber}">
    </div>

    ${brandType === '위탁' ? `
    <div class="form-group">
      <label class="form-label">위탁판매대행수수료 (%)</label>
      <input id="edit-commission-rate" class="form-input" type="number" min="0" max="100" step="0.1"
        value="${b.fee_info?.commission_rate ?? ''}" placeholder="운영자 확정 전 표시 안 됨" readonly
        style="background:var(--gray-50);color:var(--gray-400)">
      <p style="font-size:12px;color:var(--gray-400);margin-top:4px">수수료율은 운영자에서 확정합니다.</p>
    </div>` : ''}

    <div id="edit-settlement-error" class="form-error"></div>
    <div class="modal-footer" style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-settlement-cancel" style="flex:1">취소</button>
      <button class="btn btn-primary" id="btn-settlement-save" style="flex:2">저장</button>
    </div>
  `);

  // 사업자/개인 토글
  document.querySelectorAll('input[name="edit-biz-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isBusiness = document.getElementById('edit-biz-business').checked;
      document.getElementById('edit-business-fields').style.display = isBusiness ? 'block' : 'none';
      document.getElementById('edit-individual-fields').style.display = isBusiness ? 'none' : 'block';
    });
  });

  // 과세유형 선택 시 부가세 안내 문구 토글
  document.getElementById('edit-taxation-type').addEventListener('change', () => {
    const val = document.getElementById('edit-taxation-type').value;
    document.getElementById('edit-vat-notice').style.display = val ? 'block' : 'none';
  });

  // 사업자등록번호 자동 포맷 + 형식 힌트
  document.getElementById('edit-biz-reg-number').addEventListener('input', () => {
    const el = document.getElementById('edit-biz-reg-number');
    el.value = formatBizRegNumber(el.value);
    const hint = document.getElementById('edit-biz-hint');
    const digits = el.value.replace(/-/g, '');
    if (digits.length === 10) {
      if (validateBizRegNumber(digits)) {
        hint.style.color = 'var(--success, #16a34a)';
        hint.textContent = '형식 확인됨 — "사업자 확인" 버튼으로 실제 조회하세요.';
      } else {
        hint.style.color = 'var(--danger)';
        hint.textContent = '올바르지 않은 사업자등록번호입니다.';
      }
    } else {
      hint.textContent = '';
    }
  });

  // 사업자 확인 버튼 (국세청 API)
  document.getElementById('btn-edit-verify-biz').addEventListener('click', async () => {
    const el = document.getElementById('edit-biz-reg-number');
    const hint = document.getElementById('edit-biz-hint');
    const digits = (el.value || '').replace(/-/g, '');
    if (digits.length !== 10 || !validateBizRegNumber(digits)) {
      hint.style.color = 'var(--danger)';
      hint.textContent = '사업자등록번호를 먼저 올바르게 입력하세요.';
      return;
    }
    document.getElementById('btn-edit-verify-biz').disabled = true;
    hint.style.color = 'var(--gray-500)';
    hint.textContent = '조회 중...';
    try {
      const r = await verifyBizNumber(digits);
      const colors = { active: 'var(--success, #16a34a)', dormant: 'var(--warning, #b45309)', closed: 'var(--danger)' };
      const icons  = { active: '✓', dormant: '⚠', closed: '✗' };
      hint.style.color = colors[r.status] || 'var(--gray-600)';
      hint.textContent = (icons[r.status] || '?') + ' ' + r.label;
      // 계속사업자일 때 과세유형 자동 선택
      if (r.status === 'active' && r.rawItem) {
        const taxEl = document.getElementById('edit-taxation-type');
        const taxType = r.rawItem.tax_type || '';
        if (taxEl && taxType) {
          if (taxType.includes('일반'))      taxEl.value = '일반';
          else if (taxType.includes('간이')) taxEl.value = '간이';
          taxEl.dispatchEvent(new Event('change'));
        }
      }
    } catch (e) {
      hint.style.color = 'var(--danger)';
      hint.textContent = '조회 오류: ' + e.message;
    } finally {
      document.getElementById('btn-edit-verify-biz').disabled = false;
    }
  });

  // 주민등록번호 자동 하이픈 + 실시간 검증
  document.getElementById('edit-resident-number').addEventListener('input', () => {
    const el = document.getElementById('edit-resident-number');
    el.value = formatResidentNumber(el.value);
    const hint = document.getElementById('edit-resident-hint');
    const digits = el.value.replace(/-/g, '');
    if (digits.length === 13) {
      const r = validateResidentNumber(el.value);
      hint.style.color = r.ok ? 'var(--success, #16a34a)' : 'var(--danger)';
      hint.textContent = r.ok ? '✓ 형식이 올바릅니다.' : '✗ ' + r.msg;
    } else {
      hint.textContent = '';
    }
  });

  document.getElementById('btn-settlement-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-settlement-save').addEventListener('click', async () => {
    const saveBtn = document.getElementById('btn-settlement-save');
    const errEl = document.getElementById('edit-settlement-error');
    const bizType = document.querySelector('input[name="edit-biz-type"]:checked')?.value;

    if (!bizType) { errEl.textContent = '사업자 여부를 선택해 주세요.'; return; }
    if (bizType === 'business') {
      if (!document.getElementById('edit-biz-reg-number').value.trim())        { errEl.textContent = '사업자등록번호를 입력해주세요.'; document.getElementById('edit-biz-reg-number').focus(); return; }
      if (!document.getElementById('edit-taxation-type').value)                { errEl.textContent = '과세 유형을 선택해주세요.'; document.getElementById('edit-taxation-type').focus(); return; }
      if (!document.getElementById('edit-corp-name').value.trim())             { errEl.textContent = '상호를 입력해주세요.'; document.getElementById('edit-corp-name').focus(); return; }
      if (!document.getElementById('edit-representative-name').value.trim())   { errEl.textContent = '대표자명을 입력해주세요.'; document.getElementById('edit-representative-name').focus(); return; }
      if (!document.getElementById('edit-business-start-date').value.trim())   { errEl.textContent = '사업자등록일을 입력해주세요.'; document.getElementById('edit-business-start-date').focus(); return; }
      if (!document.getElementById('edit-address-biz').value.trim())           { errEl.textContent = '사업장 주소를 입력해주세요.'; document.getElementById('edit-address-biz').focus(); return; }
    } else {
      if (!document.getElementById('edit-resident-number').value.trim())       { errEl.textContent = '주민등록번호를 입력해주세요.'; document.getElementById('edit-resident-number').focus(); return; }
      if (!document.getElementById('edit-address-ind').value.trim())           { errEl.textContent = '주소를 입력해주세요.'; document.getElementById('edit-address-ind').focus(); return; }
    }
    if (!document.getElementById('edit-bank-name').value.trim())      { errEl.textContent = '은행을 입력해주세요.'; return; }
    if (!document.getElementById('edit-account-holder').value.trim()) { errEl.textContent = '예금주명을 입력해주세요.'; return; }
    if (!document.getElementById('edit-account-number').value.trim()) { errEl.textContent = '계좌번호를 입력해주세요.'; return; }
    const validationErrors = validateSettlementForm({
      bizType,
      bizNumber:      document.getElementById('edit-biz-reg-number')?.value || '',
      residentNumber: document.getElementById('edit-resident-number')?.value || '',
    });
    if (validationErrors.length) { errEl.textContent = validationErrors[0]; return; }

    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';

    try {
      const isBusiness = bizType === 'business';
      const accountNumberRaw = document.getElementById('edit-account-number').value.trim();
      const residentNumberRaw = !isBusiness ? (document.getElementById('edit-resident-number')?.value.trim() || '') : '';

      const [accountNumberEnc, residentNumberEnc] = await Promise.all([
        encryptValue(accountNumberRaw),
        encryptValue(residentNumberRaw),
      ]);

      const updatedSettlement = {
        ...(si || {}),
        business_type:   bizType,
        address:         isBusiness
          ? document.getElementById('edit-address-biz').value.trim()
          : document.getElementById('edit-address-ind').value.trim(),
        bank_name:       document.getElementById('edit-bank-name').value.trim(),
        account_holder:  document.getElementById('edit-account-holder').value.trim(),
        account_number:  accountNumberEnc,
        // 서류 URL(id_card_url 등)은 운영자 전용 — 덮어쓰지 않음
        ...(isBusiness ? {
          business_reg_number: document.getElementById('edit-biz-reg-number').value.trim(),
          taxation_type:       document.getElementById('edit-taxation-type').value,
          corp_name:           document.getElementById('edit-corp-name').value.trim(),
          representative_name: document.getElementById('edit-representative-name').value.trim(),
          business_start_date: document.getElementById('edit-business-start-date').value.trim(),
          resident_number:     null,
        } : {
          resident_number:     residentNumberEnc,
          business_reg_number: null,
          taxation_type:       null,
          corp_name:           '',
          representative_name: '',
          business_start_date: '',
        }),
      };

      // 운영자 업로드 URL은 null로 삭제되지 않도록 undefined/null 키 제거
      Object.keys(updatedSettlement).forEach(k => {
        if (updatedSettlement[k] === null) delete updatedSettlement[k];
      });
      // 기존 서류 URL은 유지
      if (si.id_card_url)  updatedSettlement.id_card_url  = si.id_card_url;
      if (si.bank_book_url) updatedSettlement.bank_book_url = si.bank_book_url;
      if (si.biz_reg_url)  updatedSettlement.biz_reg_url  = si.biz_reg_url;

      const brandSnap = await getDoc(doc(db, 'brands', brandId));
      const currentStatus = brandSnap.data()?.onboarding_status;
      const statusUpdate = currentStatus === '계약 정보 입력 필요' ? { onboarding_status: '계약 전' } : {};

      await updateDoc(doc(db, 'brands', brandId), {
        settlement_info: updatedSettlement,
        ...statusUpdate,
        updated_at: serverTimestamp(),
      });

      closeModal();
      window._gotoPage?.('brand-info');
    } catch (e) {
      errEl.textContent = '저장 중 오류가 발생했습니다. 다시 시도해 주세요.';
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  });
}
