import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, serverTimestamp,
} from './firebase-init.js';

// ── 상태 상수 ──
const STATUS = {
  GENERAL: '일반회원',
  BRAND:   '브랜드회원',
  INVITED: '초대됨',
  LINKED:  '연결됨',
  SUBMITTED: '제출됨',
  APPROVED: '승인',
  REJECTED: '거절',
};

// ── 이메일 소문자 정규화 ──
const normalizeEmail = e => (e || '').toLowerCase().trim();

// ── 로컬 날짜 (toISOString UTC 방식 금지) ──
const today = () => {
  const d = new Date();
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
};

// ── DOM 참조 ──
const $ = id => document.getElementById(id);
const loadingScreen = $('loading-screen');
const loginScreen   = $('login-screen');
const appScreen     = $('app-screen');

// ── 화면 전환 헬퍼 ──
function showLoading(on) { loadingScreen.style.display = on ? 'flex' : 'none'; }
function showLogin()  { loginScreen.style.display = 'flex'; appScreen.style.display = 'none'; showLoading(false); }
function showApp()    { loginScreen.style.display = 'none'; appScreen.style.display = 'block'; showLoading(false); }

// ── 현재 사용자 상태 ──
let currentUser = null;
let currentUserDoc = null;

// ── 구글 로그인 공통 처리 ──
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

// ── 로그인 버튼 ──
$('btn-login').addEventListener('click', async () => {
  const user = await handleGoogleSignIn();
  if (!user) return;
  // onAuthStateChanged가 이어서 처리
});

// ── 계정 만들기(신규 가입) 버튼 ──
$('btn-register').addEventListener('click', async () => {
  const user = await handleGoogleSignIn();
  if (!user) return;
  // onAuthStateChanged가 이어서 처리
});

// ── 로그아웃 ──
$('btn-signout').addEventListener('click', async () => {
  await signOut(auth);
});

// ── 인증 상태 감지 — 앱의 핵심 진입점 ──
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    currentUserDoc = null;
    showLogin();
    return;
  }

  showLoading(true);
  currentUser = user;

  const email = normalizeEmail(user.email);
  const uid   = user.uid;

  // 1. users/{uid} 조회
  const userRef  = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    // 신규 유저: users 문서 생성 (추가 정보 요구 없음)
    const vendorRef  = doc(db, 'vendor_accounts', email);
    const vendorSnap = await getDoc(vendorRef);

    if (vendorSnap.exists() && vendorSnap.data().status === STATUS.INVITED) {
      // admin이 미리 등록해둔 초대 계정 → 브랜드회원으로 자동 연결
      const vd = vendorSnap.data();
      await setDoc(userRef, {
        email,
        name: user.displayName || '',
        phone: '',
        member_status: STATUS.BRAND,
        brand_id:  vd.brand_id  || null,
        person_id: vd.person_id || null,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      await setDoc(vendorRef, { status: STATUS.LINKED, uid, linked_at: serverTimestamp() }, { merge: true });
      currentUserDoc = (await getDoc(userRef)).data();
      renderApp(STATUS.BRAND, true /* isNewLink */);
    } else {
      // 완전 신규 → 일반회원 생성 후 갈래 선택 화면
      await setDoc(userRef, {
        email,
        name: user.displayName || '',
        phone: '',
        member_status: STATUS.GENERAL,
        brand_id:  null,
        person_id: null,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
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
    // 일반회원: 신청 현황 확인 후 분기
    checkApplicationStatus();
  }
  showApp();
}

// ── 일반회원 신청 현황 확인 ──
async function checkApplicationStatus() {
  const uid = currentUser.uid;

  // brand_applications 확인
  const { collection, query, where, getDocs } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
  );
  const appsQ = query(collection(db, 'brand_applications'), where('applicant_uid', '==', uid));
  const joinQ = query(collection(db, 'brand_join_requests'), where('applicant_uid', '==', uid));

  const [appsSnap, joinSnap] = await Promise.all([getDocs(appsQ), getDocs(joinQ)]);

  const hasApp  = !appsSnap.empty;
  const hasJoin = !joinSnap.empty;

  if (!hasApp && !hasJoin) {
    renderPage('branch-select');
  } else {
    renderPage('pending');
  }
}

// ── 사이드바 사용자 정보 ──
function updateSidebarUser(memberStatus) {
  const user = currentUser;
  $('user-name-text').textContent = user.displayName || user.email;
  $('user-role-text').textContent = memberStatus;

  const avatarEl = $('user-avatar');
  if (user.photoURL) {
    avatarEl.innerHTML = `<img src="${user.photoURL}" alt="프로필">`;
  } else {
    avatarEl.textContent = (user.displayName || user.email || '?')[0].toUpperCase();
  }

  // 사이드바 메뉴 구성
  renderSidebar(memberStatus);
}

// ── 사이드바 메뉴 ──
function renderSidebar(memberStatus) {
  const nav = $('sidebar-nav');

  if (memberStatus === STATUS.BRAND) {
    nav.innerHTML = `
      <div class="nav-section-label">브랜드 관리</div>
      <div class="nav-item active" data-page="dashboard"><span class="icon">🏠</span> 대시보드</div>
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
    `;
  } else {
    nav.innerHTML = `
      <div class="nav-section-label">신청 현황</div>
      <div class="nav-item active" data-page="pending"><span class="icon">🔍</span> 신청 현황</div>
      <div class="nav-section-label">고객지원</div>
      <div class="nav-item" data-page="notices"><span class="icon">📢</span> 공지사항</div>
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

// ── 페이지 렌더링 라우터 ──
function renderPage(page) {
  $('topbar-title').textContent = PAGE_TITLES[page] || page;
  const content = $('main-content');

  switch (page) {
    case 'dashboard':    content.innerHTML = renderDashboard(); break;
    case 'branch-select': renderBranchSelect(content); break;
    case 'pending':      content.innerHTML = renderPending(); break;
    case 'welcome':      content.innerHTML = renderWelcome(); break;
    case 'brand-info':   content.innerHTML = renderComingSoon('브랜드 정보', '2단계 이후 구현 예정'); break;
    case 'persons':      content.innerHTML = renderComingSoon('담당자 관리', '5단계 구현 예정'); break;
    case 'contracts':    content.innerHTML = renderComingSoon('계약서 다운로드', '6단계 구현 예정'); break;
    case 'products':     content.innerHTML = renderComingSoon('상품 관리', '7단계 구현 예정'); break;
    case 'inventory':    content.innerHTML = renderComingSoon('재고·판매 조회', '데이터 연동 준비중'); break;
    case 'settlements':  content.innerHTML = renderComingSoon('정산 조회', '데이터 연동 준비중'); break;
    case 'notices':      content.innerHTML = renderComingSoon('공지사항', '10단계 구현 예정'); break;
    case 'inquiries':    content.innerHTML = renderComingSoon('문의하기', '10단계 구현 예정'); break;
    default:             content.innerHTML = '<p>페이지를 찾을 수 없습니다.</p>';
  }
}

const PAGE_TITLES = {
  dashboard: '대시보드',
  'branch-select': '입점 신청',
  pending: '신청 현황',
  welcome: '환영합니다',
  'brand-info': '브랜드 정보',
  persons: '담당자 관리',
  contracts: '계약서',
  products: '상품 관리',
  inventory: '재고·판매 조회',
  settlements: '정산 조회',
  notices: '공지사항',
  inquiries: '문의하기',
};

// ── 대시보드 ──
function renderDashboard() {
  const name = currentUserDoc?.name || currentUser?.displayName || '';
  return `
    <div class="card" style="margin-bottom:20px">
      <h2 style="font-size:20px;font-weight:700;margin-bottom:6px">안녕하세요, ${name}님 👋</h2>
      <p style="color:var(--gray-600);font-size:14px">GMBS 입점 브랜드 포털에 오신 것을 환영합니다.</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">
      ${dashCard('📦', '상품 관리', '등록된 상품을 관리하세요', 'products')}
      ${dashCard('📄', '계약서', '계약서를 확인·다운로드하세요', 'contracts')}
      ${dashCard('💰', '정산 조회', '정산 내역을 확인하세요', 'settlements')}
      ${dashCard('💬', '문의하기', '운영자에게 문의하세요', 'inquiries')}
    </div>
  `;
}
function dashCard(icon, title, desc, page) {
  return `<div class="card" style="cursor:pointer" onclick="window._gotoPage('${page}')">
    <div style="font-size:28px;margin-bottom:10px">${icon}</div>
    <div style="font-weight:700;margin-bottom:4px">${title}</div>
    <div style="font-size:13px;color:var(--gray-600)">${desc}</div>
  </div>`;
}
window._gotoPage = page => renderPage(page);

// ── 갈래 선택 화면 ──
function renderBranchSelect(container) {
  $('topbar-title').textContent = '입점 신청';
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
    </div>
  `;

  $('bc-join').addEventListener('click', () => openJoinModal());
  $('bc-new').addEventListener('click',  () => openApplyModal());
}

// ── 합류 신청 모달 ──
async function openJoinModal() {
  const { collection, getDocs, addDoc, serverTimestamp: st } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
  );

  // 브랜드 목록 조회
  const brandsSnap = await getDocs(collection(db, 'brands'));
  const brandOptions = brandsSnap.docs.map(d =>
    `<option value="${d.id}">${d.data().brand_name || d.id}</option>`
  ).join('');

  showModal(`
    <div class="modal-title">기존 브랜드 담당자로 합류 신청</div>
    <div class="form-group">
      <label class="form-label">소속 브랜드 선택 <span style="color:var(--danger)">*</span></label>
      <select id="join-brand" class="form-input form-select">
        <option value="">브랜드를 선택하세요</option>
        ${brandOptions}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">연락처 <span style="color:var(--danger)">*</span></label>
      <input id="join-phone" class="form-input" type="tel" placeholder="010-0000-0000">
    </div>
    <div class="form-group">
      <label class="form-label">역할/직책</label>
      <input id="join-role" class="form-input" type="text" placeholder="예: 마케팅 담당자">
    </div>
    <div id="join-error" class="form-error"></div>
    <button class="btn btn-primary" id="btn-join-submit" style="margin-top:8px">신청하기</button>
  `);

  $('btn-join-submit').addEventListener('click', async () => {
    const brandId = $('join-brand').value;
    const phone   = $('join-phone').value.trim();
    if (!brandId) { $('join-error').textContent = '브랜드를 선택해 주세요.'; return; }
    if (!phone)   { $('join-error').textContent = '연락처를 입력해 주세요.'; return; }

    $('btn-join-submit').disabled = true;
    $('btn-join-submit').textContent = '신청 중...';

    await addDoc(collection(db, 'brand_join_requests'), {
      applicant_uid:   currentUser.uid,
      applicant_email: normalizeEmail(currentUser.email),
      applicant_name:  currentUser.displayName || '',
      applicant_phone: phone,
      applicant_role:  $('join-role').value.trim(),
      target_brand_id: brandId,
      status:          STATUS.SUBMITTED,
      submitted_at:    st(),
    });

    closeModal();
    renderPage('pending');
  });
}

// ── 새 브랜드 등록 신청 모달 ──
async function openApplyModal() {
  const { collection, addDoc, serverTimestamp: st } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
  );

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
      <input id="app-phone" class="form-input" type="tel" placeholder="010-0000-0000">
    </div>
    <div class="form-group">
      <label class="form-label">역할/직책</label>
      <input id="app-role" class="form-input" type="text" placeholder="예: 대표, MD 담당자">
    </div>
    <div id="app-error" class="form-error"></div>
    <button class="btn btn-primary" id="btn-app-submit" style="margin-top:8px">신청하기</button>
  `);

  $('btn-app-submit').addEventListener('click', async () => {
    const brandName = $('app-brand-name').value.trim();
    const bizNo     = $('app-biz-no').value.trim();
    const phone     = $('app-phone').value.trim();
    if (!brandName) { $('app-error').textContent = '브랜드명을 입력해 주세요.'; return; }
    if (!bizNo)     { $('app-error').textContent = '사업자 등록번호를 입력해 주세요.'; return; }
    if (!phone)     { $('app-error').textContent = '연락처를 입력해 주세요.'; return; }

    $('btn-app-submit').disabled = true;
    $('btn-app-submit').textContent = '신청 중...';

    await addDoc(collection(db, 'brand_applications'), {
      applicant_uid:   currentUser.uid,
      applicant_email: normalizeEmail(currentUser.email),
      applicant_name:  currentUser.displayName || '',
      applicant_phone: phone,
      applicant_role:  $('app-role').value.trim(),
      brand_name:      brandName,
      biz_no:          bizNo,
      ceo_name:        $('app-ceo').value.trim(),
      status:          STATUS.SUBMITTED,
      submitted_at:    st(),
    });

    closeModal();
    renderPage('pending');
  });
}

// ── 심사중 화면 ──
function renderPending() {
  return `
    <div class="pending-wrap">
      <div class="pending-icon">⏳</div>
      <h2>신청이 접수되었습니다</h2>
      <p>운영자가 신청 내용을 검토 중입니다.<br>
         승인 결과는 이메일로 안내드립니다.<br>
         보통 영업일 기준 1~3일 내로 처리됩니다.</p>
      <div style="margin-top:28px">
        <span class="badge badge-yellow">심사중</span>
      </div>
    </div>
  `;
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
         브랜드 ID: <strong>${brandId}</strong><br>
         이제 모든 관리 메뉴를 이용하실 수 있습니다.</p>
      <button class="btn btn-primary" style="max-width:200px;margin:28px auto 0"
        onclick="location.reload()">시작하기</button>
    </div>
  `;
}

// ── 준비중 화면 ──
function renderComingSoon(title, note) {
  return `
    <div class="pending-wrap">
      <div class="pending-icon">🔧</div>
      <h2>${title}</h2>
      <p>${note}</p>
    </div>
  `;
}

// ── 모달 헬퍼 ──
function showModal(html) {
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
