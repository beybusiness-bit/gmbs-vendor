import {
  db, collection, query, where, getDocs,
  addDoc, serverTimestamp,
} from '../firebase-init.js';

function noPerm(label) {
  return `<div style="max-width:480px;margin:80px auto;text-align:center;padding:40px">
    <div style="font-size:48px;margin-bottom:16px">🔒</div>
    <h3 style="font-size:17px;font-weight:700;margin-bottom:8px">접근 권한이 없습니다</h3>
    <p style="font-size:14px;color:var(--gray-500);line-height:1.6">[${label}] 메뉴에 대한 접근 권한이 없습니다.<br>주관리자에게 권한 부여를 요청하세요.</p>
  </div>`;
}

function fmtTs(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' +
    String(d.getDate()).padStart(2,'0');
}

function statusBadge(status) {
  const map = { '접수': 'badge-yellow', '답변완료': 'badge-green' };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status || '접수'}</span>`;
}

export async function renderInquiries({ userDoc, user, container, showModal, closeModal, permissions }) {
  if (permissions && permissions['inquiries.view'] === false) {
    container.innerHTML = noPerm('1:1 문의하기'); return;
  }
  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  // orderBy 없이 where만 → 복합 인덱스 불필요, 클라이언트에서 정렬
  const q = query(collection(db, 'inquiries'), where('author_uid', '==', user.uid));
  const snap = await getDocs(q);
  const inquiries = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.created_at?.toMillis?.() || 0) - (a.created_at?.toMillis?.() || 0));

  container.innerHTML = `
    <div style="max-width:720px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="font-size:18px;font-weight:700">문의하기</h2>
          <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
            운영자에게 문의를 남기면 이메일로 답변 드립니다.
          </p>
        </div>
        <button class="btn btn-primary" id="btn-new-inquiry" style="width:auto;padding:10px 18px">
          + 새 문의
        </button>
      </div>
      ${inquiries.length === 0
        ? `<div class="card" style="text-align:center;padding:40px;color:var(--gray-400)">
             아직 문의 내역이 없습니다.
           </div>`
        : inquiries.map(inq => inquiryRow(inq)).join('')
      }
    </div>
  `;

  document.getElementById('btn-new-inquiry').addEventListener('click', () => {
    openNewInquiry({ userDoc, user, showModal, closeModal, container });
  });

  container.querySelectorAll('.inquiry-row').forEach(el => {
    const inqId = el.dataset.id;
    const inq   = inquiries.find(i => i.id === inqId);
    el.addEventListener('click', () => openInquiryDetail({ inq, showModal, closeModal }));
  });
}

function inquiryRow(inq) {
  return `
    <div class="card inquiry-row" data-id="${inq.id}"
      style="margin-bottom:8px;cursor:pointer;transition:background .12s"
      onmouseover="this.style.background='var(--gray-50)'"
      onmouseout="this.style.background=''"
    >
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:10px">
          ${statusBadge(inq.status)}
          <span style="font-weight:600">${inq.title || '(제목 없음)'}</span>
        </div>
        <span style="font-size:12px;color:var(--gray-400);white-space:nowrap;margin-left:12px">
          ${fmtTs(inq.created_at)}
        </span>
      </div>
    </div>`;
}

function openInquiryDetail({ inq, showModal, closeModal }) {
  showModal(`
    <div style="font-size:12px;color:var(--gray-400);margin-bottom:8px">
      ${fmtTs(inq.created_at)} &nbsp;|&nbsp; ${statusBadge(inq.status)}
    </div>
    <div class="modal-title" style="font-size:18px">${inq.title || '(제목 없음)'}</div>

    <div style="background:var(--gray-50);border-radius:8px;padding:16px;margin-bottom:20px">
      <div style="font-size:13px;font-weight:600;color:var(--gray-600);margin-bottom:8px">문의 내용</div>
      <p style="font-size:14px;line-height:1.7;white-space:pre-wrap">${inq.content || ''}</p>
    </div>

    ${inq.answer ? `
    <div style="background:#eff6ff;border-radius:8px;padding:16px;margin-bottom:20px;border-left:3px solid var(--primary)">
      <div style="font-size:13px;font-weight:600;color:var(--primary);margin-bottom:8px">
        💬 운영자 답변 &nbsp;<span style="font-weight:400;color:var(--gray-400)">${fmtTs(inq.answered_at)}</span>
      </div>
      <p style="font-size:14px;line-height:1.7;white-space:pre-wrap">${inq.answer}</p>
    </div>` : `
    <div style="text-align:center;padding:16px;color:var(--gray-400);font-size:13px;margin-bottom:20px">
      아직 답변이 등록되지 않았습니다.
    </div>`}

    <button class="btn btn-outline" id="btn-inq-close">닫기</button>
  `);
  document.getElementById('btn-inq-close').addEventListener('click', closeModal);
}

function openNewInquiry({ userDoc, user, showModal, closeModal, container }) {
  showModal(`
    <div class="modal-title">새 문의</div>
    <div class="form-group">
      <label class="form-label">제목 <span style="color:var(--danger)">*</span></label>
      <input id="inq-title" class="form-input" type="text" placeholder="문의 제목을 입력하세요">
    </div>
    <div class="form-group">
      <label class="form-label">내용 <span style="color:var(--danger)">*</span></label>
      <textarea id="inq-content" class="form-input" rows="6" style="resize:vertical"
        placeholder="문의 내용을 상세히 적어주세요"></textarea>
    </div>
    <div id="inq-error" class="form-error"></div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn btn-outline" id="btn-inq-cancel" style="flex:1">취소</button>
      <button class="btn btn-primary" id="btn-inq-submit" style="flex:2">문의 등록</button>
    </div>
  `);

  document.getElementById('btn-inq-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-inq-submit').addEventListener('click', async () => {
    const title   = document.getElementById('inq-title').value.trim();
    const content = document.getElementById('inq-content').value.trim();
    const errEl   = document.getElementById('inq-error');
    const saveBtn = document.getElementById('btn-inq-submit');
    errEl.textContent = '';

    if (!title)   { errEl.textContent = '제목을 입력해 주세요.'; return; }
    if (!content) { errEl.textContent = '내용을 입력해 주세요.'; return; }

    saveBtn.disabled = true;
    saveBtn.textContent = '등록 중...';

    try {
      await addDoc(collection(db, 'inquiries'), {
        brand_id:    userDoc?.brand_id || null,
        author_uid:  user.uid,
        author_email: (user.email || '').toLowerCase().trim(),
        title,
        content,
        status:     '접수',
        answer:     null,
        created_at: serverTimestamp(),
      });
      closeModal();
      await renderInquiries({ userDoc, user, container, showModal, closeModal });
    } catch (e) {
      errEl.textContent = '등록 중 오류가 발생했습니다.';
      saveBtn.disabled = false;
      saveBtn.textContent = '문의 등록';
    }
  });
}
