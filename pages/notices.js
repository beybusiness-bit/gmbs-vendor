import { db, collection, query, where, orderBy, limit, startAfter, getDocs } from '../firebase-init.js';

const PAGE_SIZE = 15;

function fmtTs(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' +
    String(d.getDate()).padStart(2,'0');
}

export async function renderNotices({ container }) {
  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  let notices = [];
  let lastDoc = null;
  let hasMore = false;

  async function loadMore() {
    const q = lastDoc
      ? query(collection(db, 'notices'), orderBy('created_at', 'desc'), limit(PAGE_SIZE + 1), startAfter(lastDoc))
      : query(collection(db, 'notices'), orderBy('created_at', 'desc'), limit(PAGE_SIZE + 1));
    const snap = await getDocs(q);
    const docs = snap.docs;
    hasMore = docs.length > PAGE_SIZE;
    const page = hasMore ? docs.slice(0, PAGE_SIZE) : docs;
    lastDoc = page[page.length - 1] || lastDoc;
    return page.map(d => ({ id: d.id, ...d.data() }));
  }

  try {
    notices = await loadMore();
  } catch (_) {}

  render();

  function render() {
    container.innerHTML = `
      <div style="max-width:720px">
        <div style="margin-bottom:20px">
          <h2 style="font-size:18px;font-weight:700">공지사항</h2>
        </div>
        <div id="notices-list">
          ${notices.length === 0
            ? `<div class="card" style="text-align:center;padding:40px;color:var(--gray-400)">공지사항이 없습니다.</div>`
            : notices.map(n => accordionRow(n)).join('')}
        </div>
        ${hasMore ? `<div style="text-align:center;margin-top:16px">
          <button class="btn btn-outline" id="btn-load-more" style="width:auto;padding:10px 28px">더보기</button>
        </div>` : ''}
      </div>`;

    attachAccordion(container.querySelector('#notices-list'));

    container.querySelector('#btn-load-more')?.addEventListener('click', async () => {
      const btn = container.querySelector('#btn-load-more');
      btn.disabled = true; btn.textContent = '불러오는 중...';
      try {
        const more = await loadMore();
        notices = notices.concat(more);
      } catch (_) {}
      render();
    });
  }
}

function accordionRow(n) {
  return `
    <div class="accordion-item card" data-id="${n.id}" style="margin-bottom:8px">
      <button class="accordion-header">
        <span class="accordion-arrow">▼</span>
        <div style="flex:1;text-align:left">
          ${n.is_pinned ? '<span class="badge badge-blue" style="margin-right:8px">📌 중요</span>' : ''}
          <span style="font-weight:600">${n.title || '(제목 없음)'}</span>
        </div>
        <span style="font-size:12px;color:var(--gray-400);white-space:nowrap;margin-left:12px">${fmtTs(n.created_at)}</span>
      </button>
      <div class="accordion-body">
        <div style="line-height:1.8;font-size:14px;color:var(--gray-700);white-space:pre-wrap">${n.content || ''}</div>
      </div>
    </div>`;
}

function attachAccordion(listEl) {
  if (!listEl) return;
  listEl.querySelectorAll('.accordion-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.accordion-item');
      const isOpen = item.classList.contains('open');
      item.classList.toggle('open', !isOpen);
      btn.querySelector('.accordion-arrow').textContent = isOpen ? '▼' : '▲';
    });
  });
}
