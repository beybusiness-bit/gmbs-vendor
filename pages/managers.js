import {
  db, collection, getDocs, query, where, doc, addDoc, updateDoc, deleteDoc, getDoc, setDoc, serverTimestamp,
} from '../firebase-init.js';

// 조정 가능한 권한 목록 (주관리자가 부관리자별로 설정)
const ADJUSTABLE_PERMISSIONS = [
  { key: 'brand-info.view',          label: '브랜드 정보 보기',    group: '브랜드' },
  { key: 'brand-info.edit',          label: '브랜드 정보 수정',    group: '브랜드' },
  { key: 'settlement-info.view',     label: '정산 정보 보기',      group: '브랜드' },
  { key: 'settlement-info.edit',     label: '정산 정보 수정',      group: '브랜드' },
  { key: 'contracts.view',           label: '입점 계약 관리',      group: '브랜드' },
  { key: 'products.view',            label: '상품 목록 보기',      group: '상품·정산' },
  { key: 'products.create',          label: '상품 등록 신청',      group: '상품·정산' },
  { key: 'products.edit',            label: '상품 수정 요청',      group: '상품·정산' },
  { key: 'inventory.view',           label: '재고·판매 조회',      group: '상품·정산' },
  { key: 'settlements.view',         label: '정산 내역 조회',      group: '상품·정산' },
  { key: 'customer-inquiries.view',  label: '고객 문의 보기',      group: '고객 지원' },
  { key: 'customer-inquiries.reply', label: '고객 문의 답변',      group: '고객 지원' },
  { key: 'inquiries.view',           label: '1:1 문의 보기',       group: '안내' },
  { key: 'inquiries.create',         label: '1:1 문의 작성',       group: '안내' },
];

// 브랜드의 주관리자 존재 여부를 brand_public_meta에 동기화
async function syncBrandPublicMeta(brandId) {
  try {
    const snap = await getDocs(query(
      collection(db, 'brands', brandId, 'managers'),
      where('role', '==', '주관리자'),
    ));
    const hasMain = snap.docs.some(d => d.data().active !== false);
    await setDoc(doc(db, 'brand_public_meta', brandId), {
      has_main_manager: hasMain,
      updated_at: serverTimestamp(),
    }, { merge: true });
  } catch (_) { /* 동기화 실패 무시 */ }
}

export async function renderManagers({ userDoc, user, container, showModal, closeModal }) {
  const brandId = userDoc?.brand_id;
  if (!brandId) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>연결된 브랜드가 없습니다</h2></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  const [subSnap, joinSnap] = await Promise.all([
    getDocs(collection(db, 'brands', brandId, 'managers')),
    getDocs(query(
      collection(db, 'brand_join_requests'),
      where('target_brand_id', '==', brandId),
      where('status', '==', '제출됨'),
    )).catch(() => null),
  ]);

  const managers = subSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const pendingJoins = joinSnap ? joinSnap.docs.map(d => ({ id: d.id, ...d.data() })) : [];
  const myEmail = (user.email || '').toLowerCase().trim();

  // 현재 로그인 계정이 managers 서브컬렉션에 없으면 자동 추가
  const alreadyIn = managers.some(m => (m.login_google_email || '').toLowerCase() === myEmail);
  if (!alreadyIn) {
    try {
      const hasMain = managers.some(m => m.role === '주관리자' && m.active !== false);
      const newData = {
        name:               user.displayName || userDoc?.name || '',
        role:               hasMain ? '부관리자' : '주관리자',
        phone:              userDoc?.phone || '',
        contact_email:      userDoc?.contact_email || user.email || '',
        login_google_email: myEmail,
        active:             true,
        created_at:         serverTimestamp(),
        updated_at:         serverTimestamp(),
      };
      const newRef = await addDoc(collection(db, 'brands', brandId, 'managers'), newData);
      managers.unshift({ id: newRef.id, ...newData });
    } catch (_) { /* 추가 실패 시 목록만 표시 */ }
  }

  // 내 역할 파악
  const myRecord = managers.find(m => (m.login_google_email || '').toLowerCase() === myEmail);
  const isMain = myRecord?.role === '주관리자';

  function rerender() {
    renderManagers({ userDoc, user, container, showModal, closeModal });
  }

  container.innerHTML = `
    <div style="max-width:720px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="font-size:18px;font-weight:700">담당자 목록</h2>
          <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
            브랜드 담당자를 관리합니다.
          </p>
        </div>
        ${isMain ? `<button class="btn btn-primary" id="btn-add-manager" style="width:auto;padding:10px 18px">+ 담당자 추가</button>` : ''}
      </div>
      ${!isMain ? `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#1d4ed8">
          부관리자는 자신의 정보만 수정할 수 있습니다.
        </div>` : ''}
      ${managers.length === 0
        ? `<div class="card" style="text-align:center;padding:40px;color:var(--gray-400)">
             담당자가 없습니다. 추가 버튼을 눌러 등록하세요.
           </div>`
        : managers.map(m => managerCard(m, myEmail)).join('')
      }

      ${pendingJoins.length > 0 ? `
        <div style="margin-top:32px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
            <h3 style="font-size:16px;font-weight:700;margin:0">합류 신청 대기</h3>
            <span style="background:#f59e0b;color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px">${pendingJoins.length}</span>
          </div>
          ${!isMain ? `
            <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:13px;color:#92400e;margin-bottom:12px">
              합류 신청 승인은 주관리자만 처리할 수 있습니다.
            </div>` : ''}
          ${pendingJoins.map(j => joinRequestCard(j, isMain)).join('')}
        </div>` : ''}
    </div>
  `;

  document.getElementById('btn-add-manager')?.addEventListener('click', () => {
    openManagerModal({ brandId, manager: null, showModal, closeModal, container, userDoc, user });
  });

  // 카드 클릭 → 담당자 상세 모달
  container.querySelectorAll('.manager-card').forEach(card => {
    const id = card.dataset.managerId;
    const manager = managers.find(m => m.id === id);
    card.addEventListener('click', () => {
      openManagerDetailModal({ brandId, manager, managers, isMain, showModal, closeModal, container, userDoc, user });
    });
  });

  if (isMain) {
    container.querySelectorAll('.btn-approve-join').forEach(btn => {
      const id = btn.dataset.id;
      const joinReq = pendingJoins.find(j => j.id === id);
      btn.addEventListener('click', () => {
        openApproveConfirm({ brandId, joinReq, managers, user, showModal, closeModal, rerender });
      });
    });

    container.querySelectorAll('.btn-reject-join').forEach(btn => {
      const id = btn.dataset.id;
      const joinReq = pendingJoins.find(j => j.id === id);
      btn.addEventListener('click', () => {
        openRejectConfirm({ joinReq, user, showModal, closeModal, rerender });
      });
    });
  }
}

function managerCard(m, myEmail) {
  const isMe = (m.login_google_email || '').toLowerCase() === myEmail;
  return `
    <div class="card manager-card" data-manager-id="${m.id}" style="margin-bottom:12px;cursor:pointer" title="클릭하여 상세 정보 보기">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-size:16px;font-weight:700">${m.name || '-'}</span>
          ${isMe ? '<span class="badge badge-blue">나</span>' : ''}
          ${m.role === '주관리자'
            ? `<span style="background:#8c52ff;color:#fff;font-weight:700;padding:2px 10px;border-radius:12px;font-size:12px">주관리자</span>`
            : m.role === '부관리자'
            ? `<span style="background:#eff6ff;color:#2563eb;font-weight:600;padding:2px 10px;border-radius:12px;font-size:12px">부관리자</span>`
            : m.role ? `<span class="badge badge-gray">${m.role}</span>` : ''}
        </div>
        <div style="font-size:13px;color:var(--gray-600);display:grid;gap:3px">
          ${m.phone ? `<span>📞 ${m.phone}</span>` : ''}
          ${m.contact_email ? `<span>✉️ ${m.contact_email}</span>` : ''}
          ${m.login_google_email ? `<span style="color:var(--gray-400);font-size:12px">🔑 ${m.login_google_email}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function joinRequestCard(j, isMain) {
  const fmt = ts => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
  };
  return `
    <div class="card" style="margin-bottom:10px;border-left:3px solid #f59e0b">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span style="font-size:15px;font-weight:700">${j.applicant_name || '-'}</span>
            ${j.applicant_role ? `<span style="background:#f59e0b20;color:#92400e;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600">${j.applicant_role} 신청</span>` : ''}
          </div>
          <div style="font-size:13px;color:var(--gray-600);display:grid;gap:2px">
            ${j.applicant_phone ? `<span>📞 ${j.applicant_phone}</span>` : ''}
            ${j.applicant_contact_email ? `<span>✉️ ${j.applicant_contact_email}</span>` : ''}
            ${j.applicant_email ? `<span style="color:var(--gray-400);font-size:12px">🔑 ${j.applicant_email}</span>` : ''}
            ${j.submitted_at ? `<span style="color:var(--gray-400);font-size:12px">신청일: ${fmt(j.submitted_at)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;margin-left:12px">
          ${isMain
            ? `<button class="btn-approve-join" data-id="${j.id}"
                style="width:auto;padding:6px 14px;font-size:13px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">승인</button>
               <button class="btn-reject-join" data-id="${j.id}"
                style="width:auto;padding:6px 14px;font-size:13px;background:#fff;color:var(--danger);border:1.5px solid var(--danger);border-radius:8px;cursor:pointer">거절</button>`
            : `<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:8px;font-size:12px;font-weight:600">대기 중</span>`}
        </div>
      </div>
    </div>`;
}

function openApproveConfirm({ brandId, joinReq, managers, user, showModal, closeModal, rerender }) {
  const brandHasMain = managers.some(m => m.role === '주관리자' && m.active !== false);
  const requestedRole = joinReq.applicant_role || '부관리자';
  const willBeMain = requestedRole === '주관리자';
  const roleConflict = willBeMain && brandHasMain;

  showModal(`
    <div class="modal-title">합류 신청 승인</div>
    <p style="margin-bottom:16px;color:var(--gray-700);font-size:14px;line-height:1.6">
      <strong>${joinReq.applicant_name || joinReq.applicant_email}</strong>님의
      <strong>${requestedRole}</strong> 합류 신청을 승인하시겠습니까?
    </p>
    ${roleConflict ? `
      <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;color:#b91c1c">
        ⚠️ 이미 주관리자가 있습니다. 역할을 <strong>부관리자</strong>로 변경하여 승인합니다.
      </div>` : ''}
    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label">부여할 역할</label>
      <select id="approve-role" class="form-input form-select">
        ${['주관리자', '부관리자'].map(r =>
          `<option value="${r}"${(roleConflict ? '부관리자' : requestedRole) === r ? ' selected' : ''}>${r}</option>`
        ).join('')}
      </select>
    </div>
    <div id="approve-error" class="form-error"></div>
    <div class="modal-footer" style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-approve-cancel" style="flex:1">취소</button>
      <button class="btn btn-primary" id="btn-approve-confirm" style="flex:2">승인하기</button>
    </div>
  `);

  document.getElementById('btn-approve-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-approve-confirm').addEventListener('click', async () => {
    const errEl  = document.getElementById('approve-error');
    const btn    = document.getElementById('btn-approve-confirm');
    const role   = document.getElementById('approve-role').value;
    errEl.textContent = '';

    if (role === '주관리자' && brandHasMain) {
      errEl.textContent = '이미 주관리자가 있습니다. 부관리자로 변경하세요.';
      return;
    }

    btn.disabled = true;
    btn.textContent = '처리 중...';

    try {
      const loginEmail = (joinReq.applicant_email || '').toLowerCase().trim();
      const approverName  = user.displayName || user.email || '';
      const approverEmail = (user.email || '').toLowerCase();
      const now = serverTimestamp();

      // 1. brand_join_requests 업데이트
      await updateDoc(doc(db, 'brand_join_requests', joinReq.id), {
        status:            '승인',
        approved_by:       approverName,
        approved_by_email: approverEmail,
        approved_by_type:  'vendor',
        approved_at:       now,
        updated_at:        now,
      });

      // 2. brands/{brandId}/managers 서브컬렉션에 추가
      const subData = {
        name:               joinReq.applicant_name || '',
        role,
        phone:              joinReq.applicant_phone || '',
        contact_email:      joinReq.applicant_contact_email || loginEmail,
        login_google_email: loginEmail,
        active:             true,
        join_request_id:    joinReq.id,
        created_at:         now,
        updated_at:         now,
      };
      await addDoc(collection(db, 'brands', brandId, 'managers'), subData);

      // 3. managers/{email} 최상위 문서 생성 또는 업데이트
      if (loginEmail) {
        const mgrRef  = doc(db, 'managers', loginEmail);
        const mgrSnap = await getDoc(mgrRef);
        if (mgrSnap.exists()) {
          const existing = mgrSnap.data();
          const updatedBrandIds = [...new Set([...(existing.brand_ids || []), brandId])];
          await updateDoc(mgrRef, {
            brand_ids:  updatedBrandIds,
            roles:      { ...(existing.roles || {}), [brandId]: role },
            status:     existing.status === '비활성' ? '초대됨' : existing.status,
            updated_at: now,
          });
        } else {
          await setDoc(mgrRef, {
            uid:                null,
            name:               joinReq.applicant_name || '',
            phone:              joinReq.applicant_phone || '',
            contact_email:      joinReq.applicant_contact_email || loginEmail,
            login_google_email: loginEmail,
            brand_ids:          [brandId],
            roles:              { [brandId]: role },
            status:             '초대됨',
            active:             true,
            created_at:         now,
            updated_at:         now,
            linked_at:          null,
          });
        }
      }

      closeModal();
      // brand_public_meta 동기화 (주관리자 추가 시 has_main_manager = true)
      if (role === '주관리자') syncBrandPublicMeta(brandId);
      await rerender();
    } catch (e) {
      errEl.textContent = '처리 중 오류가 발생했습니다.';
      btn.disabled = false;
      btn.textContent = '승인하기';
    }
  });
}

function openRejectConfirm({ joinReq, user, showModal, closeModal, rerender }) {
  showModal(`
    <div class="modal-title">합류 신청 거절</div>
    <p style="margin-bottom:14px;color:var(--gray-700);font-size:14px;line-height:1.6">
      <strong>${joinReq.applicant_name || joinReq.applicant_email}</strong>님의 합류 신청을 거절하시겠습니까?
    </p>
    <div class="form-group">
      <label class="form-label">거절 사유 <span style="color:var(--gray-400);font-weight:400">(선택)</span></label>
      <textarea id="reject-reason" class="form-input" rows="3" placeholder="신청자에게 전달할 거절 사유를 입력하세요" style="resize:vertical"></textarea>
    </div>
    <div id="reject-error" class="form-error"></div>
    <div class="modal-footer" style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-reject-cancel" style="flex:1">취소</button>
      <button class="btn btn-danger" id="btn-reject-confirm" style="flex:2">거절하기</button>
    </div>
  `);

  document.getElementById('btn-reject-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-reject-confirm').addEventListener('click', async () => {
    const errEl  = document.getElementById('reject-error');
    const btn    = document.getElementById('btn-reject-confirm');
    const reason = document.getElementById('reject-reason').value.trim();
    btn.disabled = true;
    btn.textContent = '처리 중...';

    try {
      const now = serverTimestamp();
      await updateDoc(doc(db, 'brand_join_requests', joinReq.id), {
        status:             '거절',
        rejection_reason:   reason || '',
        rejected_by:        user.displayName || user.email || '',
        rejected_by_email:  (user.email || '').toLowerCase(),
        rejected_by_type:   'vendor',
        rejected_at:        now,
        updated_at:         now,
      });

      closeModal();
      await rerender();
    } catch (e) {
      errEl.textContent = '처리 중 오류가 발생했습니다.';
      btn.disabled = false;
      btn.textContent = '거절하기';
    }
  });
}

function openDeleteConfirm({ brandId, manager, showModal, closeModal, container, userDoc, user }) {
  showModal(`
    <div class="modal-title">담당자 삭제</div>
    <p style="margin-bottom:20px;color:var(--gray-600)">
      <strong>${manager.name}</strong> 담당자를 삭제하시겠습니까?<br>
      <span style="font-size:13px;color:var(--danger);margin-top:6px;display:block">
        삭제 후에는 해당 담당자가 이 브랜드에 접근할 수 없게 됩니다.
      </span>
    </p>
    <div id="del-error" class="form-error"></div>
    <div class="modal-footer" style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-del-cancel" style="flex:1">취소</button>
      <button class="btn btn-danger" id="btn-del-confirm" style="flex:1">삭제</button>
    </div>
  `);

  document.getElementById('btn-del-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-del-confirm').addEventListener('click', async () => {
    const errEl = document.getElementById('del-error');
    const btn   = document.getElementById('btn-del-confirm');
    btn.disabled = true;
    btn.textContent = '삭제 중...';
    try {
      await deleteDoc(doc(db, 'brands', brandId, 'managers', manager.id));

      const loginEmail = (manager.login_google_email || '').toLowerCase().trim();
      if (loginEmail) {
        const mgrRef = doc(db, 'managers', loginEmail);
        const mgrSnap = await getDoc(mgrRef);
        if (mgrSnap.exists()) {
          const mgrData = mgrSnap.data();
          const updatedBrandIds = (mgrData.brand_ids || []).filter(id => id !== brandId);
          const updatedRoles = { ...(mgrData.roles || {}) };
          delete updatedRoles[brandId];
          const updates = {
            brand_ids:  updatedBrandIds,
            roles:      updatedRoles,
            updated_at: serverTimestamp(),
          };
          if (updatedBrandIds.length === 0) updates.status = '비활성';
          await updateDoc(mgrRef, updates).catch(() => {});
        }
      }

      closeModal();
      syncBrandPublicMeta(brandId); // 주관리자 삭제 시 메타 갱신
      await renderManagers({ userDoc, user, container, showModal, closeModal });
    } catch (e) {
      errEl.textContent = '삭제 중 오류가 발생했습니다.';
      btn.disabled = false;
      btn.textContent = '삭제';
    }
  });
}

async function openManagerModal({ brandId, manager, showModal, closeModal, container, userDoc, user, selfOnly = false }) {
  const isEdit = !!manager;
  showModal(`
    <div class="modal-title">${isEdit ? '담당자 정보 수정' : '담당자 추가'}</div>
    <div class="form-group">
      <label class="form-label">이름 <span style="color:var(--danger)">*</span></label>
      <input id="m-name" class="form-input" type="text" value="${isEdit ? (manager.name||'') : ''}">
    </div>
    <div class="form-group">
      <label class="form-label">역할 <span style="color:var(--danger)">*</span></label>
      ${selfOnly
        ? `<input class="form-input" type="text" value="${manager?.role || ''}" disabled style="background:var(--gray-50);color:var(--gray-500)">
           <div class="form-hint">부관리자는 역할을 변경할 수 없습니다.</div>`
        : `<select id="m-role" class="form-input form-select">
             <option value="">역할 선택</option>
             ${['주관리자', '부관리자'].map(r =>
               `<option value="${r}"${(isEdit ? manager.role : '') === r ? ' selected' : ''}>${r}</option>`
             ).join('')}
           </select>
           <div class="form-hint">주관리자는 브랜드당 1명만 설정할 수 있습니다.</div>`
      }
    </div>
    <div class="form-group">
      <label class="form-label">연락처</label>
      <input id="m-phone" class="form-input" type="tel" value="${isEdit ? (manager.phone||'') : ''}">
    </div>
    <div class="form-group">
      <label class="form-label">연락용 이메일</label>
      <input id="m-contact-email" class="form-input" type="email"
        value="${isEdit ? (manager.contact_email||'') : ''}">
    </div>
    ${!isEdit ? `
    <div class="form-group">
      <label class="form-label">Vendor 로그인용 구글 이메일
        <span style="color:var(--danger)">*</span></label>
      <input id="m-login-email" class="form-input" type="email" placeholder="google 계정 이메일">
      <div class="form-hint">이 이메일로 로그인해야 브랜드 포털에 접근할 수 있습니다.</div>
    </div>
    <div class="form-group">
      <label class="form-label">구글 이메일 확인 (다시 입력)</label>
      <input id="m-login-email2" class="form-input" type="email" placeholder="동일한 이메일 재입력">
    </div>` : ''}
    <div id="m-error" class="form-error"></div>
    <div class="modal-footer" style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-m-cancel" style="flex:1">취소</button>
      <button class="btn btn-primary" id="btn-m-save" style="flex:2">${isEdit ? '저장' : '추가'}</button>
    </div>
  `);

  document.getElementById('btn-m-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-m-save').addEventListener('click', async () => {
    const name    = document.getElementById('m-name').value.trim();
    const errEl   = document.getElementById('m-error');
    const saveBtn = document.getElementById('btn-m-save');
    errEl.textContent = '';

    if (!name) { errEl.textContent = '이름을 입력해 주세요.'; return; }

    let role;
    if (selfOnly) {
      role = manager?.role || '';
    } else {
      role = document.getElementById('m-role').value;
      if (!role) { errEl.textContent = '역할을 선택해 주세요.'; return; }

      if (role === '주관리자') {
        try {
          const mainSnap = await getDocs(query(
            collection(db, 'brands', brandId, 'managers'),
            where('role', '==', '주관리자'),
          ));
          const others = mainSnap.docs.filter(d => d.data().active !== false && (!isEdit || d.id !== manager.id));
          if (others.length > 0) {
            errEl.textContent = '이미 주관리자가 있습니다. 기존 주관리자를 부관리자로 변경한 후 다시 시도하세요.';
            return;
          }
        } catch (e) {
          errEl.textContent = '역할 확인 중 오류가 발생했습니다.';
          return;
        }
      }
    }

    let loginEmail = '';
    if (!isEdit) {
      loginEmail  = (document.getElementById('m-login-email').value || '').toLowerCase().trim();
      const loginEmail2 = (document.getElementById('m-login-email2').value || '').toLowerCase().trim();
      if (!loginEmail) { errEl.textContent = '로그인용 구글 이메일을 입력해 주세요.'; return; }
      if (loginEmail !== loginEmail2) { errEl.textContent = '이메일이 일치하지 않습니다.'; return; }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = isEdit ? '저장 중...' : '추가 중...';

    try {
      const phone        = document.getElementById('m-phone').value.trim();
      const contactEmail = document.getElementById('m-contact-email').value.trim();

      const subData = {
        name,
        role,
        phone,
        contact_email: contactEmail,
        updated_at:    serverTimestamp(),
      };

      if (isEdit) {
        await updateDoc(doc(db, 'brands', brandId, 'managers', manager.id), subData);

        const mgEmail = (manager.login_google_email || '').toLowerCase().trim();
        if (mgEmail) {
          const mgrRef = doc(db, 'managers', mgEmail);
          const mgrSnap = await getDoc(mgrRef);
          if (mgrSnap.exists()) {
            const existingRoles = mgrSnap.data().roles || {};
            await updateDoc(mgrRef, {
              roles:      { ...existingRoles, [brandId]: role },
              updated_at: serverTimestamp(),
            }).catch(() => {});
          }
        }
      } else {
        subData.login_google_email = loginEmail;
        subData.active = true;
        subData.created_at = serverTimestamp();

        await addDoc(collection(db, 'brands', brandId, 'managers'), subData);

        const mgrRef = doc(db, 'managers', loginEmail);
        const mgrSnap = await getDoc(mgrRef);
        if (mgrSnap.exists()) {
          const existing = mgrSnap.data();
          const updatedBrandIds = [...new Set([...(existing.brand_ids || []), brandId])];
          const updatedRoles = { ...(existing.roles || {}), [brandId]: role };
          await updateDoc(mgrRef, {
            brand_ids:  updatedBrandIds,
            roles:      updatedRoles,
            status:     existing.status === '비활성' ? '초대됨' : existing.status,
            updated_at: serverTimestamp(),
          });
        } else {
          await setDoc(mgrRef, {
            uid:                null,
            name,
            phone,
            contact_email:      contactEmail,
            login_google_email: loginEmail,
            brand_ids:          [brandId],
            roles:              { [brandId]: role },
            status:             '초대됨',
            active:             true,
            created_at:         serverTimestamp(),
            updated_at:         serverTimestamp(),
            linked_at:          null,
          });
        }
      }

      closeModal();
      // brand_public_meta 동기화 (주관리자 추가/역할 변경 시)
      syncBrandPublicMeta(brandId);
      await renderManagers({ userDoc, user, container, showModal, closeModal });
    } catch (e) {
      errEl.textContent = '저장 중 오류가 발생했습니다.';
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? '저장' : '추가';
    }
  });
}

// 보기 권한 → 쓰기 권한 의존 맵
const VIEW_WRITE_DEPS = {
  'brand-info.view':         ['brand-info.edit'],
  'settlement-info.view':    ['settlement-info.edit'],
  'products.view':           ['products.create', 'products.edit'],
  'customer-inquiries.view': ['customer-inquiries.reply'],
  'inquiries.view':          ['inquiries.create'],
};
const WRITE_KEYS = new Set(Object.values(VIEW_WRITE_DEPS).flat());

// ── 담당자 상세 / 권한 편집 모달 ──
async function openManagerDetailModal({ brandId, manager: initialManager, managers, isMain, showModal, closeModal, container, userDoc, user }) {
  let manager = { ...initialManager };
  const myEmail = (user.email || '').toLowerCase();
  const isMe = (manager.login_google_email || '').toLowerCase() === myEmail;
  const isSubjectMain = manager.role === '주관리자';
  const perm = manager.permissions || {};
  const canDelete = isMain && !isMe;
  const canEditPerms = isMain && !isSubjectMain;
  const canEdit = isMain || isMe;

  function viewGrantedFor(writeKey) {
    const viewKey = Object.keys(VIEW_WRITE_DEPS).find(vk => VIEW_WRITE_DEPS[vk].includes(writeKey));
    return viewKey ? perm[viewKey] !== false : true;
  }

  const groups = [...new Set(ADJUSTABLE_PERMISSIONS.map(p => p.group))];
  const permRows = isSubjectMain
    ? `<div style="color:var(--gray-500);font-size:13px;padding:12px 0">주관리자는 모든 권한을 가집니다.</div>`
    : groups.map(g => {
        const items = ADJUSTABLE_PERMISSIONS.filter(p => p.group === g);
        return `
          <div style="margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:var(--gray-500);letter-spacing:.05em;margin-bottom:8px">${g.toUpperCase()}</div>
            ${items.map(p => {
              const isWriteKey = WRITE_KEYS.has(p.key);
              const viewOk = isWriteKey ? viewGrantedFor(p.key) : true;
              const forcedOff = isWriteKey && !viewOk;
              const granted = forcedOff ? false : perm[p.key] !== false;
              const disabled = !canEditPerms || forcedOff;
              const trackColor = forcedOff ? 'var(--gray-200)' : granted ? 'var(--primary)' : 'var(--gray-300)';
              const knobColor = forcedOff ? 'var(--gray-300)' : '#fff';
              const knobLeft = granted && !forcedOff ? '21px' : '3px';
              return `
                <div class="perm-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--gray-100)" data-perm-row="${p.key}">
                  <span class="perm-label" style="font-size:13px${forcedOff ? ';color:var(--gray-300)' : ''}">${p.label}</span>
                  <label class="perm-toggle" style="position:relative;display:inline-block;width:40px;height:22px;cursor:${disabled ? 'default' : 'pointer'}">
                    <input type="checkbox" data-perm-key="${p.key}" ${granted ? 'checked' : ''} ${disabled ? 'disabled' : ''}
                      style="opacity:0;width:0;height:0;position:absolute">
                    <span style="position:absolute;top:0;left:0;right:0;bottom:0;background:${trackColor};border-radius:22px;transition:background .2s">
                      <span style="position:absolute;width:16px;height:16px;background:${knobColor};border-radius:50%;top:3px;left:${knobLeft};transition:left .2s"></span>
                    </span>
                  </label>
                </div>`;
            }).join('')}
          </div>`;
      }).join('');

  const footerHtml = isMain ? `
    <div id="perm-save-error" class="form-error"></div>
    <div class="modal-footer" style="display:flex;gap:10px;align-items:center">
      ${canDelete ? `<button class="btn btn-danger" id="btn-perm-delete" style="flex:1">삭제</button>` : ''}
      <button class="btn btn-outline" id="btn-perm-cancel" style="flex:1">닫기</button>
      ${canEditPerms ? `<button class="btn btn-primary" id="btn-perm-save" style="flex:2">권한 저장</button>` : ''}
    </div>` : `
    <div class="modal-footer">
      <button class="btn btn-outline" id="btn-perm-cancel" style="width:100%">닫기</button>
    </div>`;

  function infoViewHtml(m) {
    return `
      <div id="manager-info-view" style="display:flex;align-items:flex-start;gap:10px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--gray-100)">
        <div style="width:44px;height:44px;border-radius:50%;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:var(--primary);flex-shrink:0">
          ${(m.name || '?')[0].toUpperCase()}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:16px;font-weight:700">${m.name || '-'}${isMe ? ' <span style="font-size:12px;background:#eff6ff;color:var(--primary);padding:2px 6px;border-radius:6px">나</span>' : ''}</div>
          <div style="font-size:13px;color:var(--gray-500);margin-top:2px">
            ${m.role === '주관리자'
              ? '<span style="color:#8c52ff;font-weight:700">주관리자</span>'
              : '<span style="color:#2563eb">부관리자</span>'}
            ${m.phone ? ` · ${m.phone}` : ''}
          </div>
          ${m.contact_email ? `<div style="font-size:12px;color:var(--gray-400)">✉️ ${m.contact_email}</div>` : ''}
          ${m.login_google_email ? `<div style="font-size:12px;color:var(--gray-400)">🔑 ${m.login_google_email}</div>` : ''}
        </div>
        ${canEdit ? `<button id="btn-open-edit-info" style="width:auto;padding:6px 12px;font-size:13px;background:var(--gray-100);border:1px solid var(--gray-200);border-radius:8px;cursor:pointer;color:var(--gray-700);font-weight:600;flex-shrink:0">✏️ 수정</button>` : ''}
      </div>
      <div id="manager-info-edit" style="display:none;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--gray-100)">
        <div class="form-group">
          <label class="form-label">이름 <span style="color:var(--danger)">*</span></label>
          <input id="edit-mgr-name" class="form-input" type="text" value="${m.name || ''}">
        </div>
        ${isMain && !isMe ? `
        <div class="form-group">
          <label class="form-label">역할</label>
          <select id="edit-mgr-role" class="form-input form-select">
            <option value="주관리자"${m.role === '주관리자' ? ' selected' : ''}>주관리자</option>
            <option value="부관리자"${m.role !== '주관리자' ? ' selected' : ''}>부관리자</option>
          </select>
        </div>` : `
        <div class="form-group">
          <label class="form-label">역할</label>
          <input class="form-input" type="text" value="${m.role || ''}" disabled style="background:var(--gray-50);color:var(--gray-400)">
        </div>`}
        <div class="form-group">
          <label class="form-label">연락처</label>
          <input id="edit-mgr-phone" class="form-input" type="text" value="${m.phone || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">이메일</label>
          <input id="edit-mgr-email" class="form-input" type="email" value="${m.contact_email || ''}">
        </div>
        <div id="edit-mgr-error" class="form-error"></div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn btn-outline" id="btn-cancel-edit-info" style="flex:1">취소</button>
          <button class="btn btn-primary" id="btn-save-edit-info" style="flex:2">저장</button>
        </div>
      </div>`;
  }

  showModal(`
    <div class="modal-title">담당자 상세</div>
    ${infoViewHtml(manager)}
    <div style="margin-bottom:8px">
      <div style="font-size:14px;font-weight:700;margin-bottom:12px">메뉴 접근 권한</div>
      ${!isMain && !isSubjectMain ? '<div style="background:#fef3c7;border-radius:8px;padding:8px 12px;font-size:12px;color:#92400e;margin-bottom:10px">권한 수정은 주관리자만 가능합니다.</div>' : ''}
      ${permRows}
    </div>
    ${footerHtml}
  `);

  function applyToggleStyle(input, checked, disabled) {
    const span = input.nextElementSibling;
    const knob = span.querySelector('span');
    if (disabled) {
      span.style.background = 'var(--gray-200)';
      knob.style.background = 'var(--gray-300)';
      knob.style.left = '3px';
    } else if (checked) {
      span.style.background = 'var(--primary)';
      knob.style.background = '#fff';
      knob.style.left = '21px';
    } else {
      span.style.background = 'var(--gray-300)';
      knob.style.background = '#fff';
      knob.style.left = '3px';
    }
  }

  function wireEditInfoButtons() {
    document.getElementById('btn-open-edit-info')?.addEventListener('click', () => {
      document.getElementById('manager-info-view').style.display = 'none';
      document.getElementById('manager-info-edit').style.display = 'block';
    });

    document.getElementById('btn-cancel-edit-info')?.addEventListener('click', () => {
      document.getElementById('manager-info-edit').style.display = 'none';
      document.getElementById('manager-info-view').style.display = 'flex';
    });

    document.getElementById('btn-save-edit-info')?.addEventListener('click', async () => {
      const name = document.getElementById('edit-mgr-name').value.trim();
      const role = isMain && !isMe
        ? document.getElementById('edit-mgr-role').value
        : manager.role;
      const phone = document.getElementById('edit-mgr-phone').value.trim();
      const contact_email = document.getElementById('edit-mgr-email').value.trim();
      const errEl = document.getElementById('edit-mgr-error');
      const saveBtn = document.getElementById('btn-save-edit-info');
      errEl.textContent = '';

      if (!name) { errEl.textContent = '이름을 입력해 주세요.'; return; }

      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중...';

      try {
        const updates = { name, role, phone, contact_email, updated_at: serverTimestamp() };
        await updateDoc(doc(db, 'brands', brandId, 'managers', manager.id), updates);

        const topLevelEmail = (manager.login_google_email || '').toLowerCase();
        if (topLevelEmail) {
          try {
            await updateDoc(doc(db, 'managers', topLevelEmail), { name, phone, contact_email, updated_at: serverTimestamp() });
          } catch (_) {}
        }

        const updatedManager = { ...manager, name, role, phone, contact_email };
        closeModal();
        openManagerDetailModal({ brandId, manager: updatedManager, managers, isMain, showModal, closeModal, container, userDoc, user });
      } catch (e) {
        const err = document.getElementById('edit-mgr-error');
        if (err) err.textContent = '저장 중 오류가 발생했습니다.';
        saveBtn.disabled = false;
        saveBtn.textContent = '저장';
      }
    });
  }

  wireEditInfoButtons();

  if (canEditPerms) {
    document.querySelectorAll('.perm-toggle input[data-perm-key]').forEach(input => {
      input.addEventListener('change', () => {
        applyToggleStyle(input, input.checked, false);

        const key = input.dataset.permKey;
        const deps = VIEW_WRITE_DEPS[key];
        if (!deps) return;

        deps.forEach(writeKey => {
          const writeInput = document.querySelector(`.perm-toggle input[data-perm-key="${writeKey}"]`);
          if (!writeInput) return;
          const row = writeInput.closest('.perm-row');
          const label = row?.querySelector('.perm-label');
          if (!input.checked) {
            writeInput.checked = false;
            writeInput.disabled = true;
            if (label) label.style.color = 'var(--gray-300)';
            applyToggleStyle(writeInput, false, true);
          } else {
            writeInput.disabled = false;
            if (label) label.style.color = '';
            applyToggleStyle(writeInput, writeInput.checked, false);
          }
        });
      });
    });
  }

  if (canDelete) {
    document.getElementById('btn-perm-delete').addEventListener('click', () => {
      closeModal();
      openDeleteConfirm({ brandId, manager, showModal, closeModal, container, userDoc, user });
    });
  }

  document.getElementById('btn-perm-cancel').addEventListener('click', closeModal);

  const saveBtn = document.getElementById('btn-perm-save');
  if (!saveBtn) return;

  saveBtn.addEventListener('click', async () => {
    const errEl = document.getElementById('perm-save-error');
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';

    const newPerms = {};
    document.querySelectorAll('.perm-toggle input[data-perm-key]').forEach(input => {
      newPerms[input.dataset.permKey] = input.checked;
    });

    try {
      await updateDoc(doc(db, 'brands', brandId, 'managers', manager.id), {
        permissions: newPerms,
        updated_at:  serverTimestamp(),
      });
      closeModal();
      await renderManagers({ userDoc, user, container, showModal, closeModal });
    } catch (e) {
      errEl.textContent = '저장 중 오류가 발생했습니다.';
      saveBtn.disabled = false;
      saveBtn.textContent = '권한 저장';
    }
  });
}
