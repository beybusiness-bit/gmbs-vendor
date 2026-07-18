import {
  db, collection, query, where, getDocs, addDoc, updateDoc, doc,
} from '../firebase-init.js';

function noPerm(label) {
  return `<div style="max-width:480px;margin:80px auto;text-align:center;padding:40px">
    <div style="font-size:48px;margin-bottom:16px">🔒</div>
    <h3 style="font-size:17px;font-weight:700;margin-bottom:8px">접근 권한이 없습니다</h3>
    <p style="font-size:14px;color:var(--gray-500);line-height:1.6">[${label}] 메뉴에 대한 접근 권한이 없습니다.<br>주관리자에게 권한 부여를 요청하세요.</p>
  </div>`;
}

const STATUS_META = {
  '답변대기':   { badge: 'badge-yellow', label: '답변 필요',   icon: '🟡' },
  '재응답 필요': { badge: 'badge-red',    label: '재응답 요청됨', icon: '🔴' },
  '답변완료':   { badge: 'badge-blue',   label: '답변 완료',   icon: '🔵' },
  '처리완료':   { badge: 'badge-green',  label: '처리 완료',   icon: '🟢' },
};

const TYPE_LABELS = { '상품': '상품', '재입고': '재입고', '불량/고장': '불량/고장', '기타': '기타' };

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

export async function renderCustomerInquiries({ userDoc, user, container, showModal, closeModal, permissions }) {
  if (permissions && permissions['customer-inquiries.view'] === false) {
    container.innerHTML = noPerm('고객 문의'); return;
  }
  const brandId = userDoc?.brand_id;
  if (!brandId) {
    container.innerHTML = `<div class="pending-wrap"><div class="pending-icon">⚠️</div>
      <h2>연결된 브랜드가 없습니다</h2></div>`;
    return;
  }

  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  let inquiries = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'customer_inquiries'),
      where('brand_id', '==', brandId)
    ));
    inquiries = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  } catch (e) {
    container.innerHTML = `<div class="card" style="color:var(--danger);padding:24px">데이터를 불러오지 못했습니다.</div>`;
    return;
  }

  let activeFilter = '전체';

  function renderList(list) {
    if (list.length === 0) {
      return `<div style="text-align:center;padding:48px;color:var(--gray-400)">
        <div style="font-size:36px;margin-bottom:12px">📭</div>
        <p>해당하는 문의가 없습니다.</p>
      </div>`;
    }
    return list.map(inq => {
      const meta = STATUS_META[inq.status] || { badge: 'badge-gray', label: inq.status, icon: '❓' };
      return `
        <div class="card cs-row" data-id="${inq.id}"
          style="margin-bottom:8px;cursor:pointer;transition:background .12s"
          onmouseover="this.style.background='var(--gray-50)'"
          onmouseout="this.style.background=''">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span class="badge ${meta.badge}" style="flex-shrink:0">${meta.label}</span>
            ${inq.type ? `<span style="font-size:12px;padding:2px 8px;border-radius:12px;background:var(--gray-100);color:var(--gray-600);font-weight:600">${inq.type}</span>` : ''}
            <span style="font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${inq.title || '(제목 없음)'}</span>
            <span style="font-size:12px;color:var(--gray-400);flex-shrink:0">${inq.created_at || '-'}</span>
          </div>
          ${inq.product_name ? `<div style="font-size:12px;color:var(--gray-500);margin-top:4px">📦 ${inq.product_name}</div>` : ''}
        </div>`;
    }).join('');
  }

  const FILTERS = ['전체', '답변대기', '재응답 필요', '답변완료', '처리완료'];

  function renderPage() {
    const filtered = activeFilter === '전체' ? inquiries : inquiries.filter(i => i.status === activeFilter);
    const urgentCount = inquiries.filter(i => i.status === '답변대기' || i.status === '재응답 필요').length;

    container.innerHTML = `
      <div style="max-width:800px">
        <div style="margin-bottom:20px">
          <h2 style="font-size:18px;font-weight:700">고객 문의</h2>
          <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
            오프라인 매장에서 접수된 고객 문의를 확인하고 응답하세요.
            ${urgentCount > 0 ? `<span style="color:var(--danger);font-weight:600">&nbsp;(미답변 ${urgentCount}건)</span>` : ''}
          </p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
          ${FILTERS.map(f => `
            <button class="cs-filter-btn${f === activeFilter ? ' active' : ''}" data-filter="${f}"
              style="padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;
                border:1.5px solid ${f === activeFilter ? 'var(--primary)' : 'var(--gray-200)'};
                background:${f === activeFilter ? 'var(--primary)' : '#fff'};
                color:${f === activeFilter ? '#fff' : 'var(--gray-700)'}">
              ${f}
            </button>`).join('')}
        </div>
        <div id="cs-list">${renderList(filtered)}</div>
      </div>`;

    container.querySelectorAll('.cs-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        renderPage();
      });
    });

    container.querySelectorAll('.cs-row').forEach(row => {
      const inq = inquiries.find(i => i.id === row.dataset.id);
      row.addEventListener('click', () => openDetail({ inq, user, userDoc, showModal, closeModal, onRefresh: async () => {
        const snap2 = await getDocs(query(collection(db, 'customer_inquiries'), where('brand_id', '==', brandId)));
        inquiries = snap2.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        renderPage();
      }}));
    });
  }

  renderPage();
}

async function openDetail({ inq, user, userDoc, showModal, closeModal, onRefresh }) {
  // 응답 이력 로드
  let responses = [];
  try {
    const snap = await getDocs(collection(db, 'customer_inquiries', inq.id, 'responses'));
    responses = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  } catch (_) {}

  const meta = STATUS_META[inq.status] || { badge: 'badge-gray', label: inq.status };
  const canRespond = inq.status !== '처리완료';

  const responsesHtml = responses.length === 0
    ? `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px">아직 응답이 없습니다.</div>`
    : responses.map(r => {
        const isVendor = r.author_type === 'vendor';
        const bg = isVendor ? '#eff6ff' : 'var(--gray-50)';
        const borderColor = isVendor ? 'var(--primary)' : 'var(--gray-200)';
        const label = isVendor ? '담당자' : '관리자';
        return `
          <div style="padding:12px 14px;border-radius:8px;background:${bg};border-left:3px solid ${borderColor};margin-bottom:10px">
            <div style="font-size:12px;color:var(--gray-400);margin-bottom:6px">
              ${label} · ${r.author_name || r.author_email || ''} · ${r.created_at || '-'}
            </div>
            <p style="font-size:14px;line-height:1.7;white-space:pre-wrap">${r.content || ''}</p>
          </div>`;
      }).join('');

  showModal(`
    <div style="font-size:12px;color:var(--gray-400);margin-bottom:8px">
      ${inq.created_at || '-'} &nbsp;|&nbsp;
      <span class="badge ${meta.badge}">${meta.label}</span>
      ${inq.type ? `&nbsp;|&nbsp; ${inq.type}` : ''}
    </div>
    <div class="modal-title" style="font-size:18px;margin-bottom:12px">${inq.title || '(제목 없음)'}</div>

    ${inq.product_name ? `<div style="font-size:13px;color:var(--gray-600);margin-bottom:12px">📦 ${inq.product_name}${inq.sku_id ? ` · SKU: ${inq.sku_id}` : ''}</div>` : ''}

    <div style="background:var(--gray-50);border-radius:8px;padding:14px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--gray-500);margin-bottom:8px">문의 내용</div>
      <p style="font-size:14px;line-height:1.7;white-space:pre-wrap">${inq.content || ''}</p>
    </div>

    ${inq.status === '재응답 필요' && inq.re_response_note ? `
    <div style="background:#fffbeb;border-left:3px solid var(--warn);border-radius:8px;padding:12px 14px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:var(--warn);margin-bottom:6px">⚠️ 관리자가 추가 응답을 요청했습니다.</div>
      <p style="font-size:13px;line-height:1.6;white-space:pre-wrap">${inq.re_response_note}</p>
    </div>` : ''}

    <div style="font-size:13px;font-weight:700;color:var(--gray-700);margin-bottom:10px">응답 이력</div>
    <div id="cs-responses" style="margin-bottom:16px">${responsesHtml}</div>

    ${canRespond ? `
    <div style="border-top:1px solid var(--gray-100);padding-top:16px">
      <div style="font-size:13px;font-weight:700;color:var(--gray-700);margin-bottom:8px">응답 작성</div>
      <textarea id="cs-resp-input" class="form-input" rows="4" style="resize:vertical"
        placeholder="응답 내용을 입력하세요"></textarea>
      <div id="cs-resp-error" class="form-error"></div>
      <div style="display:flex;gap:10px;margin-top:10px">
        <button class="btn btn-outline" id="btn-cs-close" style="flex:1">닫기</button>
        <button class="btn btn-primary" id="btn-cs-submit" style="flex:2">응답 저장</button>
      </div>
    </div>` : `
    <div style="text-align:center;padding:12px;color:var(--gray-400);font-size:13px;background:var(--gray-50);border-radius:8px;margin-bottom:12px">
      처리 완료된 문의입니다.
    </div>
    <button class="btn btn-outline" id="btn-cs-close" style="width:100%">닫기</button>`}
  `);

  document.getElementById('btn-cs-close').addEventListener('click', closeModal);

  if (!canRespond) return;

  document.getElementById('btn-cs-submit').addEventListener('click', async () => {
    const content = (document.getElementById('cs-resp-input').value || '').trim();
    const errEl   = document.getElementById('cs-resp-error');
    const saveBtn = document.getElementById('btn-cs-submit');
    errEl.textContent = '';

    if (!content) { errEl.textContent = '응답 내용을 입력해 주세요.'; return; }

    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';

    try {
      const authorName = userDoc?.name || user.displayName || user.email || '';
      await addDoc(collection(db, 'customer_inquiries', inq.id, 'responses'), {
        content,
        author_type:  'vendor',
        author_email: (user.email || '').toLowerCase().trim(),
        author_name:  authorName,
        created_at:   today(),
      });
      await updateDoc(doc(db, 'customer_inquiries', inq.id), {
        status:     '답변완료',
        updated_at: today(),
      });
      closeModal();
      await onRefresh();
    } catch (e) {
      errEl.textContent = '저장 중 오류가 발생했습니다.';
      saveBtn.disabled = false;
      saveBtn.textContent = '응답 저장';
    }
  });
}
