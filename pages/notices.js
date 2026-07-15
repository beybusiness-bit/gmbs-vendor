import { db, collection, query, orderBy, limit, getDocs, doc, getDoc } from '../firebase-init.js';

function fmtTs(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' +
    String(d.getDate()).padStart(2,'0');
}

export async function renderNotices({ container, showModal, closeModal }) {
  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  const q    = query(collection(db, 'notices'), orderBy('created_at', 'desc'), limit(50));
  const snap = await getDocs(q);
  const notices = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  container.innerHTML = `
    <div style="max-width:720px">
      <div style="margin-bottom:20px">
        <h2 style="font-size:18px;font-weight:700">공지사항</h2>
      </div>
      ${notices.length === 0
        ? `<div class="card" style="text-align:center;padding:40px;color:var(--gray-400)">
             공지사항이 없습니다.
           </div>`
        : notices.map(n => noticeRow(n)).join('')
      }
    </div>
  `;

  container.querySelectorAll('.notice-row').forEach(el => {
    const nId = el.dataset.id;
    const notice = notices.find(n => n.id === nId);
    el.addEventListener('click', () => openNoticeDetail({ notice, showModal, closeModal }));
  });
}

function noticeRow(n) {
  return `
    <div class="card notice-row" data-id="${n.id}"
      style="margin-bottom:8px;cursor:pointer;transition:background .12s"
      onmouseover="this.style.background='var(--gray-50)'"
      onmouseout="this.style.background=''"
    >
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          ${n.is_pinned ? '<span class="badge badge-blue" style="margin-right:8px">📌 중요</span>' : ''}
          <span style="font-weight:600">${n.title || '(제목 없음)'}</span>
        </div>
        <span style="font-size:12px;color:var(--gray-400);white-space:nowrap;margin-left:12px">
          ${fmtTs(n.created_at)}
        </span>
      </div>
    </div>`;
}

function openNoticeDetail({ notice: n, showModal, closeModal }) {
  showModal(`
    <div style="font-size:12px;color:var(--gray-400);margin-bottom:8px">${fmtTs(n.created_at)}</div>
    <div class="modal-title" style="font-size:18px">${n.title || '(제목 없음)'}</div>
    <div style="line-height:1.8;font-size:14px;color:var(--gray-700);white-space:pre-wrap;margin-bottom:24px">${n.content || ''}</div>
    <button class="btn btn-outline" id="btn-notice-close">닫기</button>
  `);
  document.getElementById('btn-notice-close').addEventListener('click', closeModal);
}
