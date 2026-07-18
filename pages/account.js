import {
  db, storage, doc, updateDoc, getDoc, getDocs, collection, query, where, serverTimestamp,
  ref, uploadBytes, getDownloadURL,
} from '../firebase-init.js';

const MEMBER_LABEL = {
  '브랜드회원': '브랜드 담당자',
  '일반회원':   '브랜드 담당자 없음',
};

export async function renderAccount({ userDoc, user, container, onSave }) {
  const ud = userDoc || {};

  function photoHtml(photoUrl) {
    return photoUrl
      ? `<img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : `<span style="font-size:24px;font-weight:700">${(user.displayName || user.email || '?')[0].toUpperCase()}</span>`;
  }

  const currentPhoto = ud.photo_url || user.photoURL || '';
  const memberLabel = MEMBER_LABEL[ud.member_status] || ud.member_status || '-';

  container.innerHTML = `
    <div style="max-width:520px">
      <div class="card">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px">
          <div style="position:relative;flex-shrink:0">
            <div id="acc-avatar" style="width:64px;height:64px;border-radius:50%;background:var(--primary);
              display:flex;align-items:center;justify-content:center;color:#fff;overflow:hidden">
              ${photoHtml(currentPhoto)}
            </div>
            <label for="acc-photo-input" title="프로필 사진 변경"
              style="position:absolute;bottom:0;right:0;width:22px;height:22px;border-radius:50%;
                background:#fff;border:1.5px solid var(--gray-200);cursor:pointer;
                display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.12)">
              ✏️
            </label>
            <input id="acc-photo-input" type="file" accept="image/*" style="display:none">
          </div>
          <div>
            <div id="acc-display-name" style="font-size:18px;font-weight:700">${ud.name || user.displayName || '-'}</div>
            <div style="font-size:13px;color:var(--gray-400)">${user.email || ''}</div>
            <div style="margin-top:4px">
              <span class="badge badge-blue">${memberLabel}</span>
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

  // 프로필 사진 변경
  document.getElementById('acc-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const msgEl = document.getElementById('acc-msg');
    msgEl.style.color = 'var(--gray-400)';
    msgEl.textContent = '사진 업로드 중...';
    try {
      const storageRef = ref(storage, `profile_photos/${user.uid}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      await updateDoc(doc(db, 'users', user.uid), { photo_url: url, updated_at: serverTimestamp() });
      ud.photo_url = url;

      // 담당자 서브컬렉션 docs 업데이트 (모든 담당 브랜드)
      const brandId = ud.brand_id;
      if (brandId) {
        try {
          const snap = await getDocs(query(
            collection(db, 'brands', brandId, 'managers'),
            where('login_google_email', '==', (user.email || '').toLowerCase().trim()),
          ));
          await Promise.all(snap.docs.map(d => updateDoc(d.ref, { photo_url: url, updated_at: serverTimestamp() })));
        } catch (_) {}
      }

      document.getElementById('acc-avatar').innerHTML = photoHtml(url);
      msgEl.style.color = 'var(--success)';
      msgEl.textContent = '✅ 사진이 변경되었습니다.';
      if (onSave) onSave({ photo_url: url });
    } catch (err) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = '사진 업로드 중 오류가 발생했습니다.';
    }
  });

  document.getElementById('btn-acc-save').addEventListener('click', async () => {
    const name         = document.getElementById('acc-name').value.trim();
    const phone        = document.getElementById('acc-phone').value.trim();
    const contactEmail = document.getElementById('acc-contact-email').value.trim();
    const msgEl  = document.getElementById('acc-msg');
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
      ud.name = name;
      ud.phone = phone;
      ud.contact_email = contactEmail;
      document.getElementById('acc-display-name').textContent = name || user.displayName || '-';
      msgEl.style.color = 'var(--success)';
      msgEl.textContent = '✅ 저장되었습니다.';
      if (onSave) onSave({ name, phone, contact_email: contactEmail });
    } catch (e) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = '저장 중 오류가 발생했습니다.';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  });
}
