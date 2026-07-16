import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, addDoc, collection, query, where, orderBy, limit, getDocs, serverTimestamp,
} from './firebase-init.js';
import { renderBrandInfo }    from './pages/brand-info.js';
import { renderPersons }      from './pages/persons.js';
import { renderContracts }    from './pages/contracts.js';
import { renderProducts }     from './pages/products.js';
import { renderInventory }    from './pages/inventory.js';
import { renderSettlements }  from './pages/settlements.js';
import { renderNotices }      from './pages/notices.js';
import { renderInquiries }    from './pages/inquiries.js';
import { renderAccount }      from './pages/account.js';
import {
  sendApplicationReceivedEmail,
  sendJoinReceivedEmail,
} from './emailjs-config.js';

// ── 상태 상수 ──
const STATUS = {
  GENERAL:   '일반회원',
  BRAND:     '브랜드회원',
  INVITED:   '초대됨',
  LINKED:    '연결됨',
  SUBMITTED: '제출됨',
  APPROVED:  '승인',
  REJECTED:  '거절',
};

const normalizeEmail = e => (e || '').toLowerCase().trim();

// ── DOM 참조 ──
const $ = id => document.getElementById(id);
const loadingScreen = $('loading-screen');
const loginScreen   = $('login-screen');
const appScreen     = $('app-screen');

// ── 화면 전환 ──
function showLoading(on) { loadingScreen.style.display = on ? 'flex' : 'none'; }
function showLogin()  { loginScreen.style.display = 'flex'; appScreen.style.display = 'none'; showLoading(false); }
function showApp()    { loginScreen.style.display = 'none'; appScreen.style.display = 'block'; showLoading(false); }

// ── 현재 사용자 상태 ──
let currentUser    = null;
let currentUserDoc = null;

// ── 구글 로그인 ──
async function handleGoogleSignIn() {
  $('login-error').textContent = '';
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      $('login-error').textContent = '로그인 중 오류가 발생했습니다. 다시 시도해 주세요.';
    }
    return null;
  }
}

$('btn-login').addEventListener('click',    () => handleGoogleSignIn());
$('btn-register').addEventListener('click', () => handleGoogleSignIn());
$('btn-signout').addEventListener('click',  () => signOut(auth));

// ── 인증 상태 감지 ──
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    currentUserDoc = null;
    showLogin();
    return;
  }

  showLoading(true);
  currentUser = user;

  const email   = normalizeEmail(user.email);
  const uid     = user.uid;
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    const vendorRef  = doc(db, 'vendor_accounts', email);
    const vendorSnap = await getDoc(vendorRef);

    if (vendorSnap.exists() && vendorSnap.data().status === STATUS.INVITED) {
      const vd = vendorSnap.data();
      await setDoc(userRef, {
        email,
        name:          user.displayName || '',
        phone:         '',
        member_status: STATUS.BRAND,
        brand_id:      vd.brand_id  || null,
        person_id:     vd.person_id || null,
        created_at:    serverTimestamp(),
        updated_at:    serverTimestamp(),
      });
      await setDoc(vendorRef, { status: STATUS.LINKED, uid, linked_at: serverTimestamp() }, { merge: true });
      currentUserDoc = (await getDoc(userRef)).data();
      renderApp(STATUS.BRAND, true);
    } else {
      await setDoc(userRef, {
        email,
        name:          user.displayName || '',
        phone:         '',
        member_status: STATUS.GENERAL,
        brand_id:      null,
        person_id:     null,
        created_at:    serverTimestamp(),
        updated_at:    serverTimestamp(),
      });
      currentUserDoc = (await getDoc(userRef)).data();
      renderApp(STATUS.GENERAL);
    }
  } else {
    currentUserDoc = userSnap.data();
    renderApp(currentUserDoc.member_status || STATUS.GENERAL);
  }
});

// ── 앱 렌더링 ──
function renderApp(memberStatus, isNewLink = false) {
  updateSidebarUser(memberStatus);
  if (isNewLink) {
    renderPage('welcome');
  } else if (memberStatus === STATUS.BRAND) {
    renderPage('dashboard');
  } else {
    checkApplicationStatus();
  }
  showApp();
}

async function checkApplicationStatus() {
  const uid  = currentUser.uid;
  const appsQ = query(collection(db, 'brand_applications'),  where('applicant_uid', '==', uid));
  const joinQ = query(collection(db, 'brand_join_requests'), where('applicant_uid', '==', uid));
  const [appsSnap, joinSnap] = await Promise.all([getDocs(appsQ), getDocs(joinQ)]);
  renderPage((!appsSnap.empty || !joinSnap.empty) ? 'pending' : 'branch-select');
}

// ── 사이드바 ──
function updateSidebarUser(memberStatus) {
  $('user-name-text').textContent = currentUser.displayName || currentUser.email;
  $('user-role-text').textContent = memberStatus;

  const avatarEl = $('user-avatar');
  if (currentUser.photoURL) {
    avatarEl.innerHTML = `<img src="${currentUser.photoURL}" alt="프로필">`;
  } else {
    avatarEl.textContent = (currentUser.displayName || currentUser.email || '?')[0].toUpperCase();
  }
  renderSidebar(memberStatus);
}

function renderSidebar(memberStatus) {
  const nav = $('sidebar-nav');
  if (memberStatus === STATUS.BRAND) {
    nav.innerHTML = `
      <div class="nav-section-label">브랜드 관리</div>
      <div class="nav-item" data-page="dashboard"><span class="icon">🏠</span> 대시보드</div>
      <div class="nav-item" data-page="brand-info"><span class="icon">🏷️</span> 브랜드 정보</div>
      <div class="nav-item" data-page="persons"><span class="icon">👥</span> 담당자 관리</div>
      <div class="nav-item" data-page="contracts"><span class="icon">📄</span> 계약서</div>
      <div class="nav-section-label">상품·정산</div>
      <div class="nav-item" data-page="products"><span class="icon">📦</span> 상품 관리</div>
      <div class="nav-item" data-page="inventory"><span class="icon">📊</span> 재고·판매 조회</div>
      <div class="nav-item" data-page="settlements"><span class="icon">💰</span> 정산 조회</div>
      <div class="nav-section-label">고객지원</div>
      <div class="nav-item" data-page="notices"><span class="icon">📢</span> 공지사항</div>
      <div class="nav-item" data-page="inquiries"><span class="icon">💬</span> 문의하기</div>
      <div class="nav-section-label">내 계정</div>
      <div class="nav-item" data-page="account"><span class="icon">⚙️</span> 계정 설정</div>
    `;
  } else {
    nav.innerHTML = `
      <div class="nav-section-label">신청 현황</div>
      <div class="nav-item" data-page="pending"><span class="icon">🔍</span> 신청 현황</div>
      <div class="nav-section-label">고객지원</div>
      <div class="nav-item" data-page="notices"><span class="icon">📢</span> 공지사항</div>
      <div class="nav-section-label">내 계정</div>
      <div class="nav-item" data-page="account"><span class="icon">⚙️</span> 계정 설정</div>
    `;
  }

  nav.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => {
      nav.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      el.classList.add('active');
      renderPage(el.dataset.page);
    });
  });
}

function setActiveNav(page) {
  document.querySelectorAll('#sidebar-nav .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

// ── 페이지 라우터 ──
const PAGE_TITLES = {
  dashboard:    '대시보드',
  'branch-select': '입점 신청',
  pending:      '신청 현황',
  welcome:      '환영합니다',
  'brand-info': '브랜드 정보',
  persons:      '담당자 관리',
  contracts:    '계약서',
  products:     '상품 관리',
  inventory:    '재고·판매 조회',
  settlements:  '정산 조회',
  notices:      '공지사항',
  inquiries:    '문의하기',
  account:      '계정 설정',
};

function ctx() {
  return {
    userDoc: currentUserDoc,
    user:    currentUser,
    container: $('main-content'),
    showModal,
    closeModal,
  };
}

async function renderPage(page) {
  $('topbar-title').textContent = PAGE_TITLES[page] || page;
  setActiveNav(page);
  const container = $('main-content');

  switch (page) {
    case 'dashboard':     await renderDashboard(); break;
    case 'branch-select': renderBranchSelect(container); break;
    case 'pending':       await renderPendingFull(container); break;
    case 'welcome':       container.innerHTML = renderWelcome(); break;
    case 'brand-info':    await renderBrandInfo(ctx()); break;
    case 'persons':       await renderPersons(ctx()); break;
    case 'contracts':     await renderContracts(ctx()); break;
    case 'products':      await renderProducts(ctx()); break;
    case 'inventory':     await renderInventory(ctx()); break;
    case 'settlements':   await renderSettlements(ctx()); break;
    case 'notices':       await renderNotices(ctx()); break;
    case 'inquiries':     await renderInquiries(ctx()); break;
    case 'account':       await renderAccount(ctx()); break;
    default:              container.innerHTML = '<p>페이지를 찾을 수 없습니다.</p>';
  }
}

window._gotoPage = page => renderPage(page);

// ── 대시보드 ──
async function renderDashboard() {
  const name    = currentUserDoc?.name || currentUser?.displayName || '';
  const brandId = currentUserDoc?.brand_id;
  const container = $('main-content');

  container.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <h2 style="font-size:20px;font-weight:700;margin-bottom:6px">안녕하세요, ${name}님 👋</h2>
      <p style="color:var(--gray-600);font-size:14px">GMBS 입점 브랜드 포털에 오신 것을 환영합니다.</p>
    </div>
    <div id="dash-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px">
      <div class="card" style="text-align:center"><div class="spinner" style="margin:16px auto"></div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">
      ${dashCard('🏷️', '브랜드 정보', '브랜드 정보를 조회·수정하세요',   'brand-info')}
      ${dashCard('📦', '상품 관리',   '상품을 등록하고 현황을 확인하세요', 'products')}
      ${dashCard('📄', '계약서',      '계약서를 확인·다운로드하세요',      'contracts')}
      ${dashCard('💰', '정산 조회',   '정산 내역을 확인하세요',            'settlements')}
      ${dashCard('💬', '문의하기',    '운영자에게 문의하세요',             'inquiries')}
      ${dashCard('📢', '공지사항',    '운영 공지를 확인하세요',            'notices')}
    </div>`;

  // 통계 카드 비동기 로드
  if (brandId) {
    try {
      const [prodSnap, inqSnap, noticeSnap] = await Promise.all([
        getDocs(query(collection(db, 'products'), where('brand_id', '==', brandId))),
        getDocs(query(collection(db, 'inquiries'), where('brand_id', '==', brandId))),
        getDocs(query(collection(db, 'notices'), orderBy('created_at', 'desc'), limit(1))),
      ]);

      const totalProds    = prodSnap.size;
      const pendingProds  = prodSnap.docs.filter(d => d.data().status === '등록신청').length;
      const openInquiries = inqSnap.docs.filter(d => d.data().status === '접수').length;
      const hasNewNotice  = !noticeSnap.empty;

      const statsEl = document.getElementById('dash-stats');
      if (statsEl) {
        statsEl.innerHTML = `
          ${statCard('📦', '등록 상품', totalProds + '개', 'products')}
          ${statCard('⏳', '승인 대기', pendingProds + '개', 'products')}
          ${statCard('💬', '미답변 문의', openInquiries + '건', 'inquiries')}
          ${statCard('📢', '공지사항', hasNewNotice ? '최신 공지 있음' : '-', 'notices')}
        `;
      }
    } catch (_) {
      const statsEl = document.getElementById('dash-stats');
      if (statsEl) statsEl.innerHTML = '';
    }
  } else {
    const statsEl = document.getElementById('dash-stats');
    if (statsEl) statsEl.innerHTML = '';
  }
}

function statCard(icon, label, value, page) {
  return `
    <div class="card" style="text-align:center;cursor:pointer;padding:16px" onclick="window._gotoPage('${page}')">
      <div style="font-size:22px;margin-bottom:6px">${icon}</div>
      <div style="font-size:11px;color:var(--gray-400);margin-bottom:4px">${label}</div>
      <div style="font-size:18px;font-weight:800;color:var(--primary)">${value}</div>
    </div>`;
}

function dashCard(icon, title, desc, page) {
  return `<div class="card" style="cursor:pointer" onclick="window._gotoPage('${page}')">
    <div style="font-size:28px;margin-bottom:10px">${icon}</div>
    <div style="font-weight:700;margin-bottom:4px">${title}</div>
    <div style="font-size:13px;color:var(--gray-600)">${desc}</div>
  </div>`;
}

// ── 갈래 선택 화면 ──
function renderBranchSelect(container) {
  container.innerHTML = `
    <div style="max-width:640px;margin:0 auto">
      <h2 style="font-size:20px;font-weight:700;margin-bottom:8px">어떻게 시작하시겠어요?</h2>
      <p style="color:var(--gray-600);font-size:14px;margin-bottom:32px">아래 두 가지 방법 중 하나를 선택해 주세요.</p>
      <div class="branch-grid">
        <div class="branch-card" id="bc-join">
          <div class="bc-icon">🔗</div>
          <h3>기존 브랜드 담당자로 연결</h3>
          <p>이미 GMBS에 등록된 브랜드의 담당자로 합류 신청합니다.</p>
        </div>
        <div class="branch-card" id="bc-new">
          <div class="bc-icon">✨</div>
          <h3>새 브랜드 등록 신청</h3>
          <p>GMBS에 새 브랜드로 입점을 신청합니다.</p>
        </div>
      </div>
    </div>`;

  $('bc-join').addEventListener('click', openJoinModal);
  $('bc-new').addEventListener('click',  openApplyModal);
}

// ── 역할/직책 선택지 ──
const ROLE_OPTIONS = ['대표', '운영 담당자', 'MD', '마케팅 담당자', '영업 담당자', '기타'];
function roleSelectHTML(id, selected = '') {
  return `<select id="${id}" class="form-input form-select">
    <option value="">선택하세요</option>
    ${ROLE_OPTIONS.map(r => `<option value="${r}"${selected === r ? ' selected' : ''}>${r}</option>`).join('')}
  </select>`;
}

// ── 합류 신청 모달 ──
async function openJoinModal() {
  const ud = currentUserDoc || {};
  let selectedBrandId = '';
  let selectedBrandName = '';
  let allBrands = [];

  showModal(`
    <div class="modal-title">기존 브랜드 담당자로 합류 신청</div>
    <div class="form-group">
      <label class="form-label">브랜드명 검색 <span style="color:var(--danger)">*</span></label>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="join-brand-search" class="form-input" type="text" placeholder="브랜드명을 입력하세요" style="flex:1;min-width:0;width:auto">
        <button class="btn btn-outline" id="btn-brand-search" style="white-space:nowrap;flex-shrink:0;min-width:64px">검색</button>
      </div>
      <div id="join-brand-results" style="margin-top:6px"></div>
      <div id="join-brand-selected" style="display:none;margin-top:8px;padding:10px 12px;background:var(--primary-light,#eff6ff);border-radius:8px;font-size:13px;font-weight:600;color:var(--primary)"></div>
    </div>
    <div class="form-group">
      <label class="form-label">연락처 <span style="color:var(--danger)">*</span></label>
      <input id="join-phone" class="form-input" type="tel" placeholder="010-0000-0000" value="${ud.phone || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">연락용 이메일</label>
      <input id="join-contact-email" class="form-input" type="email" placeholder="업무용 이메일" value="${ud.contact_email || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">역할/직책</label>
      ${roleSelectHTML('join-role')}
    </div>
    <div id="join-error" class="form-error"></div>
    <button class="btn btn-primary" id="btn-join-submit" style="margin-top:8px">신청하기</button>
  `);

  // 브랜드 검색 로직
  let brandsLoaded = false;
  async function ensureBrands() {
    if (brandsLoaded) return;
    const snap = await getDocs(collection(db, 'brands'));
    allBrands = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    brandsLoaded = true;
  }

  function renderBrandResults(term) {
    if (!term) { $('join-brand-results').innerHTML = ''; return; }
    const matched = allBrands.filter(b => (b.brand_name || '').toLowerCase().includes(term));
    if (matched.length === 0) {
      $('join-brand-results').innerHTML = '<div style="font-size:13px;color:var(--gray-400);padding:8px 0">검색 결과가 없습니다.</div>';
      return;
    }
    const resultsContainer = $('join-brand-results');
    resultsContainer.innerHTML = '';
    matched.slice(0, 10).forEach(b => {
      const div = document.createElement('div');
      div.className = 'brand-search-item';
      div.dataset.id = b.id;
      div.dataset.name = b.brand_name || '';
      div.textContent = b.brand_name || b.id;
      div.style.cssText = 'padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:13px;font-weight:600;transition:background 0.1s';
      div.addEventListener('mouseover', () => div.style.background = 'var(--gray-100)');
      div.addEventListener('mouseout', () => div.style.background = '');
      div.addEventListener('click', () => {
        selectedBrandId   = div.dataset.id;
        selectedBrandName = div.dataset.name;
        $('join-brand-results').innerHTML = '';
        $('join-brand-search').value = selectedBrandName;
        const sel = $('join-brand-selected');
        sel.textContent = '✓ ' + selectedBrandName;
        sel.style.display = 'block';
      });
      resultsContainer.appendChild(div);
    });
  }

  async function searchBrands() {
    const term = ($('join-brand-search').value || '').trim().toLowerCase();
    const resultsEl = $('join-brand-results');
    if (!term) { resultsEl.innerHTML = ''; return; }
    try {
      resultsEl.innerHTML = '<div style="font-size:13px;color:var(--gray-400);padding:8px 0">검색 중...</div>';
      await ensureBrands();
      renderBrandResults(term);
    } catch (e) {
      resultsEl.innerHTML = '<div style="font-size:13px;color:var(--danger);padding:8px 0">검색 중 오류가 발생했습니다. 다시 시도해 주세요.</div>';
      brandsLoaded = false;
    }
  }

  let searchTimer;
  $('btn-brand-search').addEventListener('click', searchBrands);
  $('join-brand-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchBrands, 300);
  });
  $('join-brand-search').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchTimer); searchBrands(); } });

  $('btn-join-submit').addEventListener('click', async () => {
    const phone = $('join-phone').value.trim();
    const errEl = $('join-error');
    if (!selectedBrandId)  { errEl.textContent = '브랜드를 검색해서 선택해 주세요.'; return; }
    if (!phone)            { errEl.textContent = '연락처를 입력해 주세요.'; return; }

    $('btn-join-submit').disabled = true;
    $('btn-join-submit').textContent = '신청 중...';

    await addDoc(collection(db, 'brand_join_requests'), {
      applicant_uid:         currentUser.uid,
      applicant_email:       normalizeEmail(currentUser.email),
      applicant_name:        currentUser.displayName || '',
      applicant_phone:       phone,
      applicant_contact_email: $('join-contact-email').value.trim(),
      applicant_role:        $('join-role').value,
      target_brand_id:       selectedBrandId,
      target_brand_name:     selectedBrandName,
      status:                STATUS.SUBMITTED,
      submitted_at:          serverTimestamp(),
    });

    sendJoinReceivedEmail({
      toEmail:   normalizeEmail(currentUser.email),
      toName:    currentUser.displayName || '',
      brandName: selectedBrandName,
    });

    closeModal();
    renderPage('pending');
  });
}

// ── 새 브랜드 등록 신청 모달 ──
async function openApplyModal() {
  const ud = currentUserDoc || {};
  showModal(`
    <div class="modal-title">새 브랜드 입점 신청</div>
    <div class="form-group">
      <label class="form-label">브랜드명 <span style="color:var(--danger)">*</span></label>
      <input id="app-brand-name" class="form-input" type="text" placeholder="브랜드 이름을 입력하세요">
    </div>
    <div class="form-group">
      <label class="form-label">사업자 등록번호 <span style="color:var(--danger)">*</span></label>
      <input id="app-biz-no" class="form-input" type="text" placeholder="000-00-00000">
    </div>
    <div class="form-group">
      <label class="form-label">대표자명</label>
      <input id="app-ceo" class="form-input" type="text" placeholder="대표자 이름">
    </div>
    <div class="form-group">
      <label class="form-label">연락처 <span style="color:var(--danger)">*</span></label>
      <input id="app-phone" class="form-input" type="tel" placeholder="010-0000-0000" value="${ud.phone || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">연락용 이메일</label>
      <input id="app-contact-email" class="form-input" type="email" placeholder="업무용 이메일" value="${ud.contact_email || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">역할/직책</label>
      ${roleSelectHTML('app-role')}
    </div>
    <div id="app-error" class="form-error"></div>
    <button class="btn btn-primary" id="btn-app-submit" style="margin-top:8px">신청하기</button>
  `);

  $('btn-app-submit').addEventListener('click', async () => {
    const brandName = $('app-brand-name').value.trim();
    const bizNo     = $('app-biz-no').value.trim();
    const phone     = $('app-phone').value.trim();
    const errEl     = $('app-error');
    if (!brandName) { errEl.textContent = '브랜드명을 입력해 주세요.'; return; }
    if (!bizNo)     { errEl.textContent = '사업자 등록번호를 입력해 주세요.'; return; }
    if (!phone)     { errEl.textContent = '연락처를 입력해 주세요.'; return; }

    $('btn-app-submit').disabled = true;
    $('btn-app-submit').textContent = '신청 중...';

    await addDoc(collection(db, 'brand_applications'), {
      applicant_uid:           currentUser.uid,
      applicant_email:         normalizeEmail(currentUser.email),
      applicant_name:          currentUser.displayName || '',
      applicant_phone:         phone,
      applicant_contact_email: $('app-contact-email').value.trim(),
      applicant_role:          $('app-role').value,
      brand_name:              brandName,
      biz_no:                  bizNo,
      ceo_name:                $('app-ceo').value.trim(),
      status:                  STATUS.SUBMITTED,
      submitted_at:            serverTimestamp(),
    });

    sendApplicationReceivedEmail({
      toEmail:   normalizeEmail(currentUser.email),
      toName:    currentUser.displayName || '',
      brandName,
    });

    closeModal();
    renderPage('pending');
  });
}

// ── 심사중 화면 (내 신청 현황 표시) ──
async function renderPendingFull(container) {
  const uid = currentUser.uid;
  container.innerHTML = `<div class="card"><div class="spinner" style="margin:40px auto"></div></div>`;

  const appsQ = query(collection(db, 'brand_applications'),  where('applicant_uid', '==', uid));
  const joinQ = query(collection(db, 'brand_join_requests'), where('applicant_uid', '==', uid));
  const [appsSnap, joinSnap] = await Promise.all([getDocs(appsQ), getDocs(joinQ)]);

  const apps  = appsSnap.docs.map(d => ({ id: d.id, type: 'apply', ...d.data() }));
  const joins = joinSnap.docs.map(d => ({ id: d.id, type: 'join',  ...d.data() }));
  const all   = [...apps, ...joins].sort((a, b) => {
    const ta = a.submitted_at?.toMillis?.() || 0;
    const tb = b.submitted_at?.toMillis?.() || 0;
    return tb - ta;
  });

  if (all.length === 0) {
    renderPage('branch-select');
    return;
  }

  const statusBadge = s => {
    const map = { '제출됨': 'badge-yellow', '승인': 'badge-green', '거절': 'badge-red' };
    return `<span class="badge ${map[s] || 'badge-gray'}">${s || '-'}</span>`;
  };
  const fmt = ts => {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
  };

  container.innerHTML = `
    <div style="max-width:640px">
      <div style="margin-bottom:24px">
        <h2 style="font-size:18px;font-weight:700">신청 현황</h2>
        <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
          승인되면 자동으로 브랜드 포털이 열립니다. 페이지를 새로고침해 주세요.
        </p>
      </div>
      ${all.map(item => `
        <div class="card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                ${statusBadge(item.status)}
                <span class="badge badge-gray">${item.type === 'apply' ? '새 브랜드 등록' : '브랜드 합류'}</span>
              </div>
              <div style="font-weight:700;font-size:15px">
                ${item.brand_name || item.target_brand_name || item.target_brand_id || '-'}
              </div>
              <div style="font-size:12px;color:var(--gray-400);margin-top:4px">
                신청일: ${fmt(item.submitted_at)}
              </div>
              ${item.rejection_reason ? `<div style="margin-top:8px;font-size:13px;color:var(--danger)">
                거절 사유: ${item.rejection_reason}
              </div>` : ''}
            </div>
          </div>
        </div>`).join('')}
      <div style="margin-top:16px;text-align:center">
        <button class="btn btn-outline" onclick="location.reload()" style="width:auto;padding:10px 24px">
          🔄 새로고침
        </button>
      </div>
    </div>`;
}

// ── 환영(자동연결) 화면 ──
function renderWelcome() {
  const name    = currentUserDoc?.name || currentUser?.displayName || '';
  const brandId = currentUserDoc?.brand_id || '';
  return `
    <div class="pending-wrap">
      <div class="pending-icon">🎉</div>
      <h2>환영합니다, ${name}님!</h2>
      <p>브랜드 담당자로 자동 연결되었습니다.<br>
         이제 모든 관리 메뉴를 이용하실 수 있습니다.</p>
      <button class="btn btn-primary" style="max-width:200px;margin:28px auto 0"
        onclick="location.reload()">시작하기</button>
    </div>`;
}

// ── 모달 헬퍼 ──
function showModal(html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box">${html}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
}
function closeModal() {
  const el = $('modal-overlay');
  if (el) el.remove();
}
