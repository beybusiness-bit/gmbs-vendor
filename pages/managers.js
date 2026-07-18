import {
  db, collection, getDocs, query, where, doc, addDoc, updateDoc, deleteDoc, getDoc, setDoc, serverTimestamp,
} from '../firebase-init.js';

export async function renderManagers({ userDoc, user, container, showModal, closeModal }) {
  const brandId = userDoc?.brand_id;
  if (!brandId) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>연결된 브랜드가 없습니다</h2></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  const snap = await getDocs(collection(db, 'brands', brandId, 'managers'));
  const managers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

  container.innerHTML = `
    <div style="max-width:720px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="font-size:18px;font-weight:700">담당자 목록</h2>
          <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
            브랜드 담당자를 관리합니다.
          </p>
        </div>
        <button class="btn btn-primary" id="btn-add-manager" style="width:auto;padding:10px 18px">
          + 담당자 추가
        </button>
      </div>
      ${managers.length === 0
        ? `<div class="card" style="text-align:center;padding:40px;color:var(--gray-400)">
             담당자가 없습니다. 추가 버튼을 눌러 등록하세요.
           </div>`
        : managers.map(m => managerCard(m, myEmail)).join('')
      }
    </div>
  `;

  document.getElementById('btn-add-manager').addEventListener('click', () => {
    openManagerModal({ brandId, manager: null, showModal, closeModal, container, userDoc, user });
  });

  container.querySelectorAll('.btn-edit-manager').forEach(btn => {
    const id = btn.dataset.id;
    const manager = managers.find(m => m.id === id);
    btn.addEventListener('click', () => {
      openManagerModal({ brandId, manager, showModal, closeModal, container, userDoc, user });
    });
  });

  container.querySelectorAll('.btn-delete-manager').forEach(btn => {
    const id = btn.dataset.id;
    const manager = managers.find(m => m.id === id);
    btn.addEventListener('click', () => {
      openDeleteConfirm({ brandId, manager, showModal, closeModal, container, userDoc, user });
    });
  });
}

function managerCard(m, myEmail) {
  const isMe = (m.login_google_email || '').toLowerCase() === myEmail;
  return `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
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
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-outline btn-edit-manager" data-id="${m.id}"
            style="width:auto;padding:6px 12px;font-size:13px">수정</button>
          ${!isMe ? `<button class="btn btn-delete-manager" data-id="${m.id}"
            style="width:auto;padding:6px 12px;font-size:13px;background:#fff;color:var(--danger);border:1.5px solid var(--danger);border-radius:8px;cursor:pointer">삭제</button>` : ''}
        </div>
      </div>
    </div>`;
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
    <div style="display:flex;gap:10px">
      <button class="btn btn-outline" id="btn-del-cancel" style="flex:1">취소</button>
      <button class="btn" id="btn-del-confirm"
        style="flex:1;background:var(--danger);color:#fff;border:none;border-radius:10px;height:48px;font-weight:700;cursor:pointer">
        삭제
      </button>
    </div>
  `);

  document.getElementById('btn-del-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-del-confirm').addEventListener('click', async () => {
    const errEl = document.getElementById('del-error');
    const btn   = document.getElementById('btn-del-confirm');
    btn.disabled = true;
    btn.textContent = '삭제 중...';
    try {
      // 브랜드 서브컬렉션에서 삭제
      await deleteDoc(doc(db, 'brands', brandId, 'managers', manager.id));

      // managers 최상위 문서에서 해당 brandId 제거
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
          if (updatedBrandIds.length === 0) {
            updates.status = '비활성';
          }
          await updateDoc(mgrRef, updates).catch(() => {});
        }
      }

      closeModal();
      await renderManagers({ userDoc, user, container, showModal, closeModal });
    } catch (e) {
      errEl.textContent = '삭제 중 오류가 발생했습니다.';
      btn.disabled = false;
      btn.textContent = '삭제';
    }
  });
}

async function openManagerModal({ brandId, manager, showModal, closeModal, container, userDoc, user }) {
  const isEdit = !!manager;
  showModal(`
    <div class="modal-title">${isEdit ? '담당자 정보 수정' : '담당자 추가'}</div>
    <div class="form-group">
      <label class="form-label">이름 <span style="color:var(--danger)">*</span></label>
      <input id="m-name" class="form-input" type="text" value="${isEdit ? (manager.name||'') : ''}">
    </div>
    <div class="form-group">
      <label class="form-label">역할 <span style="color:var(--danger)">*</span></label>
      <select id="m-role" class="form-input form-select">
        <option value="">역할 선택</option>
        ${['주관리자', '부관리자'].map(r =>
          `<option value="${r}"${(isEdit ? manager.role : '') === r ? ' selected' : ''}>${r}</option>`
        ).join('')}
      </select>
      <div class="form-hint">주관리자는 브랜드당 1명만 설정할 수 있습니다.</div>
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
    <div style="display:flex;gap:10px;margin-top:8px">
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

    const role = document.getElementById('m-role').value;
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

        // managers 최상위 문서의 roles 업데이트
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

        // 브랜드 서브컬렉션에 추가
        await addDoc(collection(db, 'brands', brandId, 'managers'), subData);

        // managers 최상위 문서: 이미 있으면 brand_ids에 추가, 없으면 신규 생성
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
      await renderManagers({ userDoc, user, container, showModal, closeModal });
    } catch (e) {
      errEl.textContent = '저장 중 오류가 발생했습니다.';
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? '저장' : '추가';
    }
  });
}
