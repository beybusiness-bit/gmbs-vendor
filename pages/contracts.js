import {
  db, collection, getDocs, query, doc, updateDoc, getDoc, serverTimestamp,
} from '../firebase-init.js';

function noPerm(label) {
  return `<div style="max-width:480px;margin:80px auto;text-align:center;padding:40px">
    <div style="font-size:48px;margin-bottom:16px">🔒</div>
    <h3 style="font-size:17px;font-weight:700;margin-bottom:8px">접근 권한이 없습니다</h3>
    <p style="font-size:14px;color:var(--gray-500);line-height:1.6">[${label}] 메뉴에 대한 접근 권한이 없습니다.<br>주관리자에게 권한 부여를 요청하세요.</p>
  </div>`;
}

function fmt(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
}

// contract_status 값 → 표시 메타 (구 status 값도 하위 호환)
const STATUS_META = {
  // 신규 값
  '계약정보입력':     { badge: 'badge-orange', icon: '🟡', label: '계약 정보 입력 필요', msg: '담당자가 정보를 입력해 주세요.' },
  '계약발송전':       { badge: 'badge-blue',   icon: '🔵', label: '계약 발송 대기',      msg: '관리자가 계약서를 발송할 예정입니다.' },
  '전자계약발송전':   { badge: 'badge-blue',   icon: '🔵', label: '계약 발송 대기',      msg: '관리자가 계약서를 발송할 예정입니다.' },
  '서명진행중':       { badge: 'badge-yellow', icon: '✍️', label: '서명 진행 중',         msg: '이메일로 받은 계약서에 서명해 주세요.' },
  '계약완료':         { badge: 'badge-green',  icon: '✅', label: '계약 완료',            msg: '' },
  '계약기간만료':     { badge: 'badge-gray',   icon: '⬜', label: '계약 만료',            msg: '계약이 만료되었습니다.' },
  '계약해지':         { badge: 'badge-red',    icon: '❌', label: '계약 해지',            msg: '' },
  '발송실패':         { badge: 'badge-red',    icon: '⚠️', label: '발송 실패',            msg: '계약서 발송에 실패했습니다. 관리자에게 문의해 주세요.' },
  // 구 값 (하위 호환)
  '발송대기':   { badge: 'badge-gray',   icon: '⏳', label: '발송 대기',   msg: '아직 계약서가 발송되지 않았습니다.' },
  '발송됨':     { badge: 'badge-blue',   icon: '📨', label: '발송됨',      msg: '계약서가 발송되었습니다. 카카오톡 또는 이메일로 온 서명 요청을 확인해 주세요.' },
  '체결완료':   { badge: 'badge-green',  icon: '✅', label: '체결 완료',   msg: '계약이 체결되었습니다.' },
  '취소됨':     { badge: 'badge-red',    icon: '❌', label: '취소됨',      msg: '계약 요청이 취소되었습니다. 관리자에게 문의해 주세요.' },
};

// settlement_info 그룹 키 → 완료 여부 체크 및 표시 정보
const FIELD_GROUP = {
  business_type: {
    label: '사업자 여부',
    check: (si) => !!si.business_type,
  },
  id_number: {
    label: (si) => si.business_type === 'business' ? '사업자등록번호' : '주민등록번호',
    check: (si) => si.business_type === 'business' ? !!si.business_reg_number : !!si.resident_number,
  },
  corp_name: {
    label: '상호',
    check: (si) => !!si.corp_name,
  },
  representative_name: {
    label: '대표자명',
    check: (si) => !!si.representative_name,
  },
  business_start_date: {
    label: '사업자등록일',
    check: (si) => !!si.business_start_date,
  },
  taxation_type: {
    label: '과세 유형',
    check: (si) => !!si.taxation_type,
  },
  address: {
    label: '주소',
    check: (si) => !!si.address,
  },
  bank_account: {
    label: '계좌 정보',
    check: (si) => !!si.bank_name && !!si.account_holder && !!si.account_number,
  },
};

export async function renderContracts({ userDoc, container, permissions, showModal, closeModal }) {
  if (permissions && permissions['contracts.view'] === false) {
    container.innerHTML = noPerm('입점 계약 관리'); return;
  }
  const brandId = userDoc?.brand_id;
  if (!brandId) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>연결된 브랜드가 없습니다</h2></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  const [contractSnap, brandSnap, rulesSnap] = await Promise.all([
    getDocs(query(collection(db, 'brands', brandId, 'contracts'))),
    getDoc(doc(db, 'brands', brandId)),
    getDoc(doc(db, 'settings', 'contract_field_rules')).catch(() => null),
  ]);

  const contracts = contractSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.created_at?.toMillis?.() || 0) - (a.created_at?.toMillis?.() || 0));

  const brand = brandSnap.data() || {};
  const brandTypes = brand.brand_types || (brand.brand_type ? [brand.brand_type] : []);
  const si = brand.settlement_info || {};
  const fieldRules = rulesSnap?.data() || {};

  function rerender() {
    renderContracts({ userDoc, container, permissions, showModal, closeModal });
  }

  container.innerHTML = `
    <div style="max-width:720px">
      <div style="margin-bottom:24px">
        <h2 style="font-size:18px;font-weight:700">입점 계약 관리</h2>
        <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
          계약 현황을 확인할 수 있습니다. 서명은 전자계약 발송 후 이메일 알림을 통해 진행됩니다.
        </p>
      </div>
      ${contracts.length === 0
        ? `<div class="card" style="text-align:center;padding:48px;color:var(--gray-400)">
             <div style="font-size:40px;margin-bottom:12px">📄</div>
             <p style="font-size:15px;font-weight:600;margin-bottom:6px">등록된 계약서가 없습니다.</p>
             <p style="font-size:13px">계약서 발송은 운영자가 처리합니다.</p>
           </div>`
        : contracts.map(c => contractCard(c)).join('')
      }
    </div>`;

  // 계약정보 입력 필요 계약 → 클릭 핸들러
  container.querySelectorAll('.btn-fill-contract').forEach(btn => {
    const cId = btn.dataset.id;
    const contract = contracts.find(c => c.id === cId);
    btn.addEventListener('click', () => {
      openFillContractModal({ brandId, contract, brand, brandTypes, si, fieldRules, showModal, closeModal, rerender });
    });
  });
}

function contractCard(c) {
  const statusKey = c.contract_status || c.status || '발송대기';
  const meta = STATUS_META[statusKey] || { badge: 'badge-gray', icon: '❓', label: statusKey, msg: '' };

  const dateRow = (() => {
    const parts = [];
    if (c.period_months) parts.push(`계약 기간: ${c.period_months}개월`);
    if (c.sent_at)       parts.push(`발송일: ${fmt(c.sent_at)}`);
    if (c.completed_at)  parts.push(`체결일: ${fmt(c.completed_at)}`);
    if (c.canceled_at)   parts.push(`취소일: ${fmt(c.canceled_at)}`);
    if (c.created_at)    parts.push(`등록일: ${fmt(c.created_at)}`);
    return parts.join(' &nbsp;|&nbsp; ');
  })();

  const alertStyle = statusKey === '계약발송전' || statusKey === '전자계약발송전' || statusKey === '발송됨'
    ? 'background:#eff6ff;border-left:3px solid var(--primary);'
    : statusKey === '계약완료' || statusKey === '체결완료'
    ? 'background:#f0fdf4;border-left:3px solid var(--success);'
    : statusKey === '계약해지' || statusKey === '취소됨'
    ? 'background:#fef2f2;border-left:3px solid var(--danger);'
    : statusKey === '계약정보입력'
    ? 'background:#fffbeb;border-left:3px solid #f59e0b;'
    : 'background:var(--gray-50);border-left:3px solid var(--gray-300);';

  // termination_request 배너
  const tr = c.termination_request;
  const terminationBanner = tr ? `
    <div style="margin-top:12px;padding:12px 14px;border-radius:8px;font-size:13px;line-height:1.6;background:#fffbeb;border-left:3px solid #f59e0b">
      <div style="font-weight:600;margin-bottom:4px">⚠️ 계약 해지 요청이 접수되었습니다.</div>
      ${tr.scheduled_date ? `<div>해지 예정일: <strong>${tr.scheduled_date}</strong></div>` : ''}
      ${tr.requester ? `<div>요청자: ${tr.requester === 'brand' ? '브랜드' : tr.requester}${tr.reason ? ` / 사유: ${tr.reason}` : ''}</div>` : ''}
      ${tr.memo ? `<div style="color:var(--gray-600);margin-top:4px">${tr.memo}</div>` : ''}
    </div>` : '';

  // 계약정보 입력 필요 시 입력 버튼
  const fillBtn = statusKey === '계약정보입력' ? `
    <div style="margin-top:12px">
      <button class="btn btn-primary btn-fill-contract" data-id="${c.id}"
        style="width:auto;padding:8px 20px;font-size:13px">
        📝 계약 정보 입력하기
      </button>
    </div>` : '';

  // no_contract 레거시: 계약완료이지만 서명 관련 필드가 모두 없는 경우
  const isNoContract = (statusKey === '계약완료' || statusKey === '체결완료')
    && !c.signed_at && !c.ucansign_document_id && !c.file_url && !c.signed_pdf_url;

  const contractDocSection = (statusKey === '계약완료' || statusKey === '체결완료') ? `
    <div style="margin-top:12px">
      ${isNoContract
        ? `<p style="font-size:13px;color:var(--gray-500)">📋 별도 서면으로 체결된 계약입니다.</p>`
        : (c.signed_pdf_url || c.file_url)
          ? `<a href="${c.signed_pdf_url || c.file_url}" target="_blank" rel="noopener"
              class="btn btn-outline"
              style="width:auto;padding:8px 16px;font-size:13px;display:inline-flex;align-items:center;gap:6px;text-decoration:none">
              📄 계약서 PDF 다운로드
             </a>`
          : `<p style="font-size:13px;color:var(--gray-500)">📧 계약서는 이메일로 발송되었습니다.</p>`
      }
    </div>` : '';

  return `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-weight:700;font-size:15px;margin-bottom:6px">
            ${meta.icon} ${c.title || '계약서'}
          </div>
          <div style="font-size:12px;color:var(--gray-400)">${dateRow || '-'}</div>
        </div>
        <span class="badge ${meta.badge}" style="flex-shrink:0;font-size:13px;padding:5px 12px">${meta.label}</span>
      </div>
      ${meta.msg ? `
        <div style="padding:12px 14px;border-radius:8px;font-size:13px;line-height:1.6;${alertStyle}">
          ${meta.msg}
        </div>` : ''}
      ${contractDocSection}
      ${fillBtn}
      ${terminationBanner}
    </div>`;
}

function openFillContractModal({ brandId, contract, brand, brandTypes, si, fieldRules, showModal, closeModal, rerender }) {
  const contractType = contract.contract_type || '';
  const requiredGroups = fieldRules[contractType] || [];

  // 정산 정보 필드별 완료 여부 체크
  const fieldChecks = requiredGroups.map(groupKey => {
    const group = FIELD_GROUP[groupKey];
    if (!group) return null;
    const label = typeof group.label === 'function' ? group.label(si) : group.label;
    const ok = group.check(si);
    return { groupKey, label, ok };
  }).filter(Boolean);

  const allSettlementOk = fieldChecks.every(f => f.ok);

  const settlementCheckHtml = (() => {
    if (requiredGroups.length === 0) {
      // rules 없음 — 기존 방식으로 표시
      if (si.business_type === 'business') {
        return `<div style="font-size:13px;color:var(--gray-700);line-height:1.8">
          사업자: <strong>${si.corp_name || '-'}</strong><br>
          은행: ${si.bank_name || '-'} · 예금주: ${si.account_holder || '-'}
        </div>`;
      } else if (si.business_type === 'individual') {
        return `<div style="font-size:13px;color:var(--gray-700);line-height:1.8">
          개인(비사업자)<br>
          은행: ${si.bank_name || '-'} · 예금주: ${si.account_holder || '-'}
        </div>`;
      }
      return `<div style="font-size:13px;color:var(--danger)">⚠️ 정산 정보가 입력되지 않았습니다. 브랜드 정보 페이지에서 먼저 입력해 주세요.</div>`;
    }

    const rows = fieldChecks.map(f => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--gray-100)">
        <span style="font-size:15px">${f.ok ? '✅' : '❌'}</span>
        <span style="font-size:13px;color:${f.ok ? 'var(--gray-700)' : 'var(--danger)'};">${f.label}</span>
        ${!f.ok ? `<span style="font-size:12px;color:var(--gray-400);margin-left:auto">미입력</span>` : ''}
      </div>
    `).join('');

    return `
      <div style="border-radius:8px;overflow:hidden">
        ${rows}
      </div>
      ${!allSettlementOk ? `
        <div style="margin-top:10px;font-size:13px;color:var(--danger);line-height:1.6">
          ❌ 표시된 항목을 <strong>브랜드 정보 &gt; 정산 정보</strong>에서 먼저 입력해 주세요.<br>
          입력 완료 후 이 페이지로 돌아와 다시 시도하세요.
        </div>` : ''}
    `;
  })();

  showModal(`
    <div class="modal-title">계약 정보 입력</div>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin-bottom:20px;font-size:13px;color:#92400e">
      계약 유형: <strong>${contractType || '-'}</strong><br>
      정보를 입력하고 제출하면 운영자에게 전자계약 발송 요청이 전송됩니다.
    </div>

    <div class="form-group">
      <label class="form-label">계약 희망 기간 <span style="color:var(--danger)">*</span></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <div style="font-size:12px;color:var(--gray-500);margin-bottom:4px">시작일</div>
          <input id="fill-start-date" class="form-input" type="text" placeholder="YYYY-MM-DD"
            value="${contract.desired_start_date || ''}">
        </div>
        <div>
          <div style="font-size:12px;color:var(--gray-500);margin-bottom:4px">종료일</div>
          <input id="fill-end-date" class="form-input" type="text" placeholder="YYYY-MM-DD"
            value="${contract.desired_end_date || ''}">
        </div>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">자동 연장</label>
      <div style="display:flex;gap:20px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
          <input type="radio" name="fill-auto-renew" value="true"
            ${contract.auto_renew === true ? 'checked' : ''}>
          동의 (자동 연장)
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
          <input type="radio" name="fill-auto-renew" value="false"
            ${contract.auto_renew === false ? 'checked' : ''}>
          미동의
        </label>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">정산 정보 확인</label>
      <div style="background:var(--gray-50);border-radius:8px;padding:12px 14px">
        ${settlementCheckHtml}
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">기타 특이사항</label>
      <textarea id="fill-memo" class="form-input" rows="3" style="resize:vertical"
        placeholder="계약 관련 특이사항이 있으면 입력해 주세요 (선택)">${contract.vendor_memo || ''}</textarea>
    </div>

    <div id="fill-error" class="form-error"></div>
    <div class="modal-footer" style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-fill-cancel" style="flex:1">취소</button>
      <button class="btn btn-primary" id="btn-fill-submit" style="flex:2"
        ${!allSettlementOk && requiredGroups.length > 0 ? 'disabled' : ''}>제출하기</button>
    </div>
  `);

  document.getElementById('btn-fill-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-fill-submit').addEventListener('click', async () => {
    const startDate = document.getElementById('fill-start-date').value.trim();
    const endDate   = document.getElementById('fill-end-date').value.trim();
    const autoRenew = document.querySelector('input[name="fill-auto-renew"]:checked')?.value;
    const memo      = document.getElementById('fill-memo').value.trim();
    const errEl     = document.getElementById('fill-error');
    const submitBtn = document.getElementById('btn-fill-submit');
    errEl.textContent = '';

    if (!startDate || !endDate) { errEl.textContent = '계약 희망 기간(시작일, 종료일)을 입력해 주세요.'; return; }

    // 동적 정산 정보 검증
    if (requiredGroups.length > 0 && !allSettlementOk) {
      errEl.textContent = '정산 정보 미입력 항목이 있습니다. 브랜드 정보 페이지에서 먼저 입력해 주세요.';
      return;
    }
    // rules 없을 때 기존 fallback 검증
    if (requiredGroups.length === 0 && !si.business_type) {
      errEl.textContent = '정산 정보를 먼저 브랜드 정보 페이지에서 입력해 주세요.';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '제출 중...';

    try {
      await updateDoc(doc(db, 'brands', brandId, 'contracts', contract.id), {
        contract_status:     '계약발송전',
        desired_start_date:  startDate,
        desired_end_date:    endDate,
        auto_renew:          autoRenew === 'true',
        vendor_memo:         memo,
        vendor_submitted_at: serverTimestamp(),
        updated_at:          serverTimestamp(),
      });
      closeModal();
      rerender();
    } catch (e) {
      errEl.textContent = '제출 중 오류가 발생했습니다. 다시 시도해 주세요.';
      submitBtn.disabled = false;
      submitBtn.textContent = '제출하기';
    }
  });
}
