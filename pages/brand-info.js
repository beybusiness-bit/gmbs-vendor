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
    '미계약':   'badge-gray',
    '심사중':   'badge-yellow',
    '계약완료': 'badge-yellow',
    '승인':     'badge-green',
    '입점확정': 'badge-green',
    '거절':     'badge-red',
    '종료':     'badge-red',
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status || '-'}</span>`;
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

  // 정산 정보 (어드민 확정값: 읽기 전용)
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

  // 정산 정보 (벤더 입력 — 마스킹 처리)
  const settlementHtml = (() => {
    if (!si || (!si.bank_name && !si.account_holder)) return '';
    const bizLabel = si.business_type === 'business' ? '사업자' : si.business_type === 'individual' ? '개인(사업자없음)' : '';
    const rows = [];
    if (bizLabel) rows.push(infoRow('사업자 여부', bizLabel));
    if (si.business_type === 'business') {
      if (si.business_reg_number) rows.push(infoRow('사업자등록번호', si.business_reg_number));
      if (si.taxation_type) rows.push(infoRow('과세유형', si.taxation_type));
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
            ${b.brand_photo_url
              ? `<img src="${esc(b.brand_photo_url)}" alt="${esc(b.brand_name || '')}"
                   style="width:72px;height:72px;border-radius:12px;object-fit:cover;border:1px solid var(--gray-200);flex-shrink:0">`
              : `<div style="width:72px;height:72px;border-radius:12px;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;flex-shrink:0">
                   ${(b.brand_name || '?')[0].toUpperCase()}
                 </div>`}
            <div>
              <h2 style="font-size:22px;font-weight:800">${esc(b.brand_name) || '-'}</h2>
              <div style="margin-top:6px">${statusBadge(onboardingStatus)}</div>
            </div>
          </div>
          <button class="btn btn-outline" id="btn-edit-brand" style="width:auto;padding:10px 20px;flex-shrink:0">
            ✏️ 정보 수정
          </button>
        </div>

        <div class="info-grid">
          ${adminConfirmedHtml}
          ${infoRow('입점일', fmt(b.created_at))}
          ${websiteUrlsHtml}
        </div>

        ${b.brand_desc || b.description ? `
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--gray-100)">
            <div style="font-size:12px;font-weight:600;color:var(--gray-500);margin-bottom:6px">브랜드 소개</div>
            <p style="color:var(--gray-600);font-size:14px;line-height:1.7">${esc(b.brand_desc || b.description)}</p>
          </div>` : ''}
      </div>

      ${hasSettlement ? `
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-weight:700">정산 정보</div>
          <button class="btn btn-outline" id="btn-edit-settlement" style="width:auto;padding:8px 16px;font-size:13px">
            ✏️ 수정
          </button>
        </div>
        <p style="font-size:12px;color:var(--gray-400);margin-bottom:12px">계좌번호·주민등록번호는 암호화 저장됩니다.</p>
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
        </div>
      </div>` : `
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-weight:700">정산 정보</div>
          <button class="btn btn-outline" id="btn-edit-settlement" style="width:auto;padding:8px 16px;font-size:13px">
            + 입력
          </button>
        </div>
        <p style="font-size:13px;color:var(--gray-400)">아직 정산 정보가 입력되지 않았습니다.</p>
      </div>`}
    </div>
  `;

  document.getElementById('btn-edit-brand').addEventListener('click', () => {
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
        ${b.brand_photo_url
          ? `<img id="edit-photo-preview-img" src="${esc(b.brand_photo_url)}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid var(--gray-200)">`
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
    <div style="display:flex;gap:10px;margin-top:8px">
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
      let photoUrl = b.brand_photo_url || '';
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
      if (photoUrl) updates.brand_photo_url = photoUrl;

      await updateDoc(doc(db, 'brands', brandId), updates);
      closeModal();
      await renderBrandInfo({ userDoc, container, showModal, closeModal });
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

  showModal(`
    <div class="modal-title">정산 정보 수정</div>
    <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px">
      계좌번호·주민등록번호는 AES-256 암호화되어 저장됩니다.
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

    <div id="edit-business-fields" style="display:${isBiz ? 'block' : 'none'}">
      <div class="form-group">
        <label class="form-label">사업자등록번호</label>
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
        <label class="form-label">과세 유형</label>
        <select id="edit-taxation-type" class="form-input form-select">
          <option value="">선택하세요</option>
          <option value="일반"${si.taxation_type === '일반' ? ' selected' : ''}>일반과세</option>
          <option value="간이"${si.taxation_type === '간이' ? ' selected' : ''}>간이과세</option>
        </select>
      </div>
    </div>

    <div id="edit-individual-fields" style="display:${isInd ? 'block' : 'none'}">
      <div class="form-group">
        <label class="form-label">주민등록번호</label>
        <input id="edit-resident-number" class="form-input" type="password"
          placeholder="000000-0000000" maxlength="14" autocomplete="off" value="${existingResidentNumber}">
        <div id="edit-resident-hint" style="font-size:12px;margin-top:5px;min-height:18px"></div>
        <p style="margin-top:6px;font-size:11px;color:var(--gray-500);line-height:1.5;background:var(--gray-50);padding:8px 10px;border-radius:6px">
          주민등록번호는 소득세법 제127조에 따른 원천징수 신고 목적으로만 수집됩니다.<br>
          AES-256 암호화 저장, 세무법정 보관 기간(5년) 이후 파기됩니다.
        </p>
      </div>
    </div>

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
        value="${b.fee_info?.commission_rate ?? ''}" placeholder="어드민 확정 전 표시 안 됨" readonly
        style="background:var(--gray-50);color:var(--gray-400)">
      <p style="font-size:12px;color:var(--gray-400);margin-top:4px">수수료율은 어드민에서 확정합니다.</p>
    </div>` : ''}

    <div id="edit-settlement-error" class="form-error"></div>
    <div style="display:flex;gap:10px;margin-top:8px">
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

    if (!bizType)                                         { errEl.textContent = '사업자 여부를 선택해 주세요.'; return; }
    if (!document.getElementById('edit-bank-name').value.trim())      { errEl.textContent = '은행명을 입력해 주세요.'; return; }
    if (!document.getElementById('edit-account-holder').value.trim()) { errEl.textContent = '예금주명을 입력해 주세요.'; return; }
    if (!document.getElementById('edit-account-number').value.trim()) { errEl.textContent = '계좌번호를 입력해 주세요.'; return; }
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
        bank_name:       document.getElementById('edit-bank-name').value.trim(),
        account_holder:  document.getElementById('edit-account-holder').value.trim(),
        account_number:  accountNumberEnc,
        // 서류 URL(id_card_url 등)은 어드민 전용 — 덮어쓰지 않음
        ...(isBusiness ? {
          business_reg_number: document.getElementById('edit-biz-reg-number').value.trim(),
          taxation_type:       document.getElementById('edit-taxation-type').value,
          resident_number:     null,
        } : {
          resident_number:     residentNumberEnc,
          business_reg_number: null,
          taxation_type:       null,
        }),
      };

      // 어드민 업로드 URL은 null로 삭제되지 않도록 undefined/null 키 제거
      Object.keys(updatedSettlement).forEach(k => {
        if (updatedSettlement[k] === null) delete updatedSettlement[k];
      });
      // 기존 서류 URL은 유지
      if (si.id_card_url)  updatedSettlement.id_card_url  = si.id_card_url;
      if (si.bank_book_url) updatedSettlement.bank_book_url = si.bank_book_url;
      if (si.biz_reg_url)  updatedSettlement.biz_reg_url  = si.biz_reg_url;

      await updateDoc(doc(db, 'brands', brandId), {
        settlement_info: updatedSettlement,
        updated_at: serverTimestamp(),
      });

      closeModal();
      await renderBrandInfo({ userDoc, container, showModal, closeModal });
    } catch (e) {
      errEl.textContent = '저장 중 오류가 발생했습니다. 다시 시도해 주세요.';
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  });
}
