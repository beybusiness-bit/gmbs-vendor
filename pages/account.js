import { db, doc, updateDoc, serverTimestamp } from '../firebase-init.js';

export async function renderAccount({ userDoc, user, container }) {
  const ud = userDoc || {};
  container.innerHTML = `
    <div style="max-width:520px">
      <div class="card">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px">
          <div style="width:64px;height:64px;border-radius:50%;background:var(--primary);
            display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;
            font-weight:700;overflow:hidden;flex-shrink:0">
            ${user.photoURL
              ? `<img src="${user.photoURL}" style="width:100%;height:100%;object-fit:cover">`
              : (user.displayName || user.email || '?')[0].toUpperCase()}
          </div>
          <div>
            <div style="font-size:18px;font-weight:700">${user.displayName || '-'}</div>
            <div style="font-size:13px;color:var(--gray-400)">${user.email || ''}</div>
            <div style="margin-top:4px">
              <span class="badge ${ud.member_status === '브랜드회원' ? 'badge-blue' : 'badge-gray'}">
                ${ud.member_status || '-'}
              </span>
            </div>
          </div>
        </div>

        <div style="border-top:1px solid var(--gray-100);padding-top:24px">
          <div style="font-weight:700;margin-bottom:16px">내 정보 수정</div>
          <div class="form-group">
            <label class="form-label">이름</label>
            <input id="acc-name" class="form-input" type="text" value="${ud.name || user.displayName || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">연락처</label>
            <input id="acc-phone" class="form-input" type="tel" value="${ud.phone || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">연락용 이메일</label>
            <input id="acc-contact-email" class="form-input" type="email" placeholder="업무용 이메일 주소" value="${ud.contact_email || ''}">
            <div class="form-hint">신청·등록 양식에 자동으로 불러와집니다.</div>
          </div>
          <div class="form-group">
            <label class="form-label">구글 계정 이메일 (변경 불가)</label>
            <input class="form-input" type="email" value="${user.email || ''}" disabled
              style="background:var(--gray-100);color:var(--gray-400)">
            <div class="form-hint">구글 계정 이메일은 Google에서만 변경할 수 있습니다.</div>
          </div>
          <div id="acc-msg" style="font-size:13px;min-height:20px;margin-bottom:8px"></div>
          <button class="btn btn-primary" id="btn-acc-save">저장</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-acc-save').addEventListener('click', async () => {
    const name         = document.getElementById('acc-name').value.trim();
    const phone        = document.getElementById('acc-phone').value.trim();
    const contactEmail = document.getElementById('acc-contact-email').value.trim();
    const msgEl = document.getElementById('acc-msg');
    const saveBtn = document.getElementById('btn-acc-save');

    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';
    msgEl.style.color = 'var(--gray-400)';
    msgEl.textContent = '';

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        name,
        phone,
        contact_email: contactEmail,
        updated_at: serverTimestamp(),
      });
      msgEl.style.color = 'var(--success)';
      msgEl.textContent = '✅ 저장되었습니다.';
    } catch (e) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = '저장 중 오류가 발생했습니다.';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  });
}
