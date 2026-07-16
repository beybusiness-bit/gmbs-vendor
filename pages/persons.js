import { db, collection, getDocs, doc, addDoc, updateDoc, setDoc, serverTimestamp } from '../firebase-init.js';

export async function renderPersons({ userDoc, user, container, showModal, closeModal }) {
  const brandId = userDoc?.brand_id;
  if (!brandId) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>연결된 브랜드가 없습니다</h2></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  const snap = await getDocs(collection(db, 'brands', brandId, 'persons'));
  const persons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const myEmail = (user.email || '').toLowerCase().trim();

  container.innerHTML = `
    <div style="max-width:720px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="font-size:18px;font-weight:700">담당자 목록</h2>
          <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
            본인 정보는 직접 수정할 수 있습니다.
          </p>
        </div>
        <button class="btn btn-primary" id="btn-add-person" style="width:auto;padding:10px 18px">
          + 담당자 추가
        </button>
      </div>
      ${persons.length === 0
        ? `<div class="card" style="text-align:center;padding:40px;color:var(--gray-400)">
             담당자가 없습니다. 추가 버튼을 눌러 등록하세요.
           </div>`
        : persons.map(p => personCard(p, myEmail, userDoc?.person_id)).join('')
      }
    </div>
  `;

  document.getElementById('btn-add-person').addEventListener('click', () => {
    openPersonModal({ brandId, person: null, showModal, closeModal, container, userDoc, user });
  });

  container.querySelectorAll('.btn-edit-person').forEach(btn => {
    const personId = btn.dataset.id;
    const person   = persons.find(p => p.id === personId);
    btn.addEventListener('click', () => {
      openPersonModal({ brandId, person, showModal, closeModal, container, userDoc, user });
    });
  });
}

function personCard(p, myEmail, myPersonId) {
  const isMe = p.login_google_email === myEmail || p.id === myPersonId;
  return `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:16px;font-weight:700">${p.name || '-'}</span>
            ${isMe ? '<span class="badge badge-blue">나</span>' : ''}
            ${p.role ? `<span class="badge badge-gray">${p.role}</span>` : ''}
          </div>
          <div style="font-size:13px;color:var(--gray-600);display:grid;gap:3px">
            ${p.phone ? `<span>📞 ${p.phone}</span>` : ''}
            ${p.contact_email ? `<span>✉️ ${p.contact_email}</span>` : ''}
          </div>
        </div>
        ${isMe ? `<button class="btn btn-outline btn-edit-person" data-id="${p.id}"
          style="width:auto;padding:8px 14px;font-size:13px">수정</button>` : ''}
      </div>
    </div>`;
}

async function openPersonModal({ brandId, person, showModal, closeModal, container, userDoc, user }) {
  const isEdit = !!person;
  showModal(`
    <div class="modal-title">${isEdit ? '담당자 정보 수정' : '담당자 추가'}</div>
    <div class="form-group">
      <label class="form-label">이름 <span style="color:var(--danger)">*</span></label>
      <input id="p-name" class="form-input" type="text" value="${isEdit ? (person.name||'') : ''}">
    </div>
    <div class="form-group">
      <label class="form-label">역할/직책</label>
      <select id="p-role" class="form-input form-select">
        <option value="">선택하세요</option>
        ${['대표', '운영 담당자', 'MD', '마케팅 담당자', '영업 담당자', '기타'].map(r =>
          `<option value="${r}"${(isEdit ? person.role : '') === r ? ' selected' : ''}>${r}</option>`
        ).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">연락처</label>
      <input id="p-phone" class="form-input" type="tel" value="${isEdit ? (person.phone||'') : ''}">
    </div>
    <div class="form-group">
      <label class="form-label">연락용 이메일</label>
      <input id="p-contact-email" class="form-input" type="email"
        value="${isEdit ? (person.contact_email||'') : ''}">
    </div>
    ${!isEdit ? `
    <div class="form-group">
      <label class="form-label">Vendor 로그인용 구글 이메일
        <span style="color:var(--danger)">*</span></label>
      <input id="p-login-email" class="form-input" type="email" placeholder="google 계정 이메일">
      <div class="form-hint">이 이메일로 로그인해야 브랜드 포털에 접근할 수 있습니다.</div>
    </div>
    <div class="form-group">
      <label class="form-label">구글 이메일 확인 (다시 입력)</label>
      <input id="p-login-email2" class="form-input" type="email" placeholder="동일한 이메일 재입력">
    </div>` : ''}
    <div id="p-error" class="form-error"></div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn btn-outline" id="btn-p-cancel" style="flex:1">취소</button>
      <button class="btn btn-primary" id="btn-p-save" style="flex:2">${isEdit ? '저장' : '추가'}</button>
    </div>
  `);

  document.getElementById('btn-p-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-p-save').addEventListener('click', async () => {
    const name  = document.getElementById('p-name').value.trim();
    const errEl = document.getElementById('p-error');
    const saveBtn = document.getElementById('btn-p-save');
    errEl.textContent = '';

    if (!name) { errEl.textContent = '이름을 입력해 주세요.'; return; }

    if (!isEdit) {
      const loginEmail  = (document.getElementById('p-login-email').value || '').toLowerCase().trim();
      const loginEmail2 = (document.getElementById('p-login-email2').value || '').toLowerCase().trim();
      if (!loginEmail) { errEl.textContent = '로그인용 구글 이메일을 입력해 주세요.'; return; }
      if (loginEmail !== loginEmail2) { errEl.textContent = '이메일이 일치하지 않습니다.'; return; }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = isEdit ? '저장 중...' : '추가 중...';

    try {
      const data = {
        name,
        role:          document.getElementById('p-role').value.trim(),
        phone:         document.getElementById('p-phone').value.trim(),
        contact_email: document.getElementById('p-contact-email').value.trim(),
        updated_at:    serverTimestamp(),
      };

      if (isEdit) {
        await updateDoc(doc(db, 'brands', brandId, 'persons', person.id), data);
      } else {
        const loginEmail = (document.getElementById('p-login-email').value || '').toLowerCase().trim();
        data.login_google_email = loginEmail;
        data.created_at = serverTimestamp();
        // vendor_accounts에 "초대됨" 상태로 생성
        await Promise.all([
          addDoc(collection(db, 'brands', brandId, 'persons'), data),
          setDoc(doc(db, 'vendor_accounts', loginEmail), {
            uid:       null,
            brand_id:  brandId,
            person_id: null, // 추가 후 ID를 알 수 없으므로 나중에 연결
            status:    '초대됨',
            created_at: serverTimestamp(),
          }),
        ]);
      }

      closeModal();
      await renderPersons({ userDoc, user, container, showModal, closeModal });
    } catch (e) {
      errEl.textContent = '저장 중 오류가 발생했습니다.';
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? '저장' : '추가';
    }
  });
}
