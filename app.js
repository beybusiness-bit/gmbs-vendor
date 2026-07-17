import {
  auth, db, storage, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs, serverTimestamp,
  ref, uploadBytes, getDownloadURL,
} from './firebase-init.js';
import { encryptValue } from './utils/encryption.js';
import { esc, safeUrl } from './utils/sanitize.js';
import {
  validateBizRegNumber, formatBizRegNumber,
  validateResidentNumber, formatResidentNumber,
  verifyBizNumber, validateSettlementForm,
} from './utils/validation.js';
import { renderBrandInfo }    from './pages/brand-info.js';
import { renderPersons }      from './pages/persons.js';
import { renderContracts }    from './pages/contracts.js';
import { renderProducts }     from './pages/products.js';
import { renderInventory }    from './pages/inventory.js';
import { renderSettlements }  from './pages/settlements.js';
import { renderNotices }      from './pages/notices.js';
import { renderInquiries }        from './pages/inquiries.js';
import { renderCustomerInquiries } from './pages/customer-inquiries.js';
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
function showLogin()  {
  loginScreen.style.display = 'block';
  appScreen.style.display = 'none';
  showLoading(false);
  renderPublicLanding();
}
function showApp()    { loginScreen.style.display = 'none'; appScreen.style.display = 'block'; showLoading(false); }

// ── 현재 사용자 상태 ──
let currentUser    = null;
let currentUserDoc = null;
let activeBrandId  = null; // 현재 활성 브랜드 (다중 브랜드 지원)

// 사용자 문서에서 소속 브랜드 ID 목록 반환 (brand_ids 배열 우선, brand_id 단일값 폴백)
function getUserBrandIds(userDoc) {
  if (!userDoc) return [];
  if (Array.isArray(userDoc.brand_ids) && userDoc.brand_ids.length) return userDoc.brand_ids;
  if (userDoc.brand_id) return [userDoc.brand_id];
  return [];
}

function setActiveBrand(brandId) {
  activeBrandId = brandId;
  if (currentUserDoc) currentUserDoc.brand_id = brandId; // 기존 코드 호환
}

// ── 사이드바 배지 ──
// localStorage 키: gmbs_read_{scope}_{uid}
// notices  → timestamp (마지막 방문 이후 새 공지 카운트)
// others   → JSON 배열 of IDs (결과를 확인한 문서 IDs)

function _badgeKey(scope) {
  return `gmbs_read_${scope}_${currentUser?.uid}`;
}
function _getReadIds(scope) {
  try { return new Set(JSON.parse(localStorage.getItem(_badgeKey(scope)) || '[]')); }
  catch { return new Set(); }
}
function _saveReadIds(scope, set) {
  try { localStorage.setItem(_badgeKey(scope), JSON.stringify([...set])); } catch {}
}
function _getReadTs(scope) {
  return parseInt(localStorage.getItem(_badgeKey(scope)) || '0', 10);
}
function _saveReadTs(scope, ts) {
  try { localStorage.setItem(_badgeKey(scope), String(ts)); } catch {}
}

// 페이지 방문 시 해당 항목을 읽음 처리
async function markBadgeRead(page) {
  if (!currentUser) return;
  const uid = currentUser.uid;
  const brandId = activeBrandId;

  if (page === 'notices') {
    // 현재 시각을 마지막 방문 타임스탬프로 저장
    _saveReadTs('notices', Date.now());

  } else if (page === 'pending') {
    const [appsSnap, joinSnap] = await Promise.all([
      getDocs(query(collection(db, 'brand_applications'),  where('applicant_uid', '==', uid))),
      getDocs(query(collection(db, 'brand_join_requests'), where('applicant_uid', '==', uid))),
    ]);
    const seen = _getReadIds('pending');
    [...appsSnap.docs, ...joinSnap.docs].forEach(d => {
      const s = d.data().status;
      if (s === STATUS.APPROVED || s === STATUS.REJECTED) seen.add(d.id);
    });
    _saveReadIds('pending', seen);

  } else if (page === 'inquiries' && brandId) {
    const snap = await getDocs(query(collection(db, 'inquiries'), where('brand_id', '==', brandId)));
    const seen = _getReadIds('inquiries');
    snap.docs.forEach(d => { if (d.data().answer) seen.add(d.id); });
    _saveReadIds('inquiries', seen);

  } else if (page === 'products' && brandId) {
    const snap = await getDocs(query(collection(db, 'products'), where('brand_id', '==', brandId)));
    const seen = _getReadIds('products');
    snap.docs.forEach(d => {
      const s = d.data().status;
      if (s === '승인' || s === '거절') seen.add(d.id);
    });
    _saveReadIds('products', seen);

  } else if (page === 'customer-inquiries' && brandId) {
    // 페이지 방문 시 배지는 실제 미답변 건수로 유지 (리얼타임 배지이므로 별도 읽음 처리 없음)
  }
}

// 각 메뉴의 배지 카운트 계산 (비동기, 배경 실행)
async function computeBadges() {
  if (!currentUser) return {};
  const uid = currentUser.uid;
  const isBrand = currentUserDoc?.member_status === STATUS.BRAND;
  const brandId = activeBrandId;
  const badges = {};

  try {
    // 공지사항: 마지막 방문 이후 새로 등록된 공지 수
    const lastNoticeTs = _getReadTs('notices');
    const noticeSnap = await getDocs(query(collection(db, 'notices'), orderBy('created_at', 'desc'), limit(50)));
    badges.notices = noticeSnap.docs.filter(d => {
      const ts = d.data().created_at?.toMillis?.() || 0;
      return ts > lastNoticeTs;
    }).length;

    if (isBrand && brandId) {
      // 문의하기: 답변완료 중 아직 안 본 것
      const seenInq = _getReadIds('inquiries');
      const inqSnap = await getDocs(query(collection(db, 'inquiries'), where('brand_id', '==', brandId)));
      badges.inquiries = inqSnap.docs.filter(d => d.data().answer && !seenInq.has(d.id)).length;

      // 상품관리: 승인/거절 결과 중 아직 안 본 것
      const seenProd = _getReadIds('products');
      const prodSnap = await getDocs(query(collection(db, 'products'), where('brand_id', '==', brandId)));
      badges.products = prodSnap.docs.filter(d => {
        const s = d.data().status;
        return (s === '승인' || s === '거절') && !seenProd.has(d.id);
      }).length;

      // 고객 문의: 답변대기 + 재응답 필요 건수
      const csSnap = await getDocs(query(collection(db, 'customer_inquiries'), where('brand_id', '==', brandId)));
      badges['customer-inquiries'] = csSnap.docs.filter(d => {
        const s = d.data().status;
        return s === '답변대기' || s === '재응답 필요';
      }).length;

    } else if (!isBrand) {
      // 신청현황: 승인/거절 결과 중 아직 안 본 것
      const seenApps = _getReadIds('pending');
      const [appsSnap, joinSnap] = await Promise.all([
        getDocs(query(collection(db, 'brand_applications'),  where('applicant_uid', '==', uid))),
        getDocs(query(collection(db, 'brand_join_requests'), where('applicant_uid', '==', uid))),
      ]);
      badges.pending = [...appsSnap.docs, ...joinSnap.docs].filter(d => {
        const s = d.data().status;
        return (s === STATUS.APPROVED || s === STATUS.REJECTED) && !seenApps.has(d.id);
      }).length;
    }
  } catch (_) { /* 배지 계산 실패는 조용히 무시 */ }

  return badges;
}

// 사이드바 nav-item에 배지 DOM 업데이트
function applyNavBadges(badges) {
  Object.entries(badges).forEach(([page, count]) => {
    const navItem = document.querySelector(`#sidebar-nav .nav-item[data-page="${page}"]`);
    if (!navItem) return;
    navItem.querySelectorAll('.nav-badge').forEach(el => el.remove());
    if (count > 0) {
      const span = document.createElement('span');
      span.className = 'nav-badge';
      span.textContent = count > 9 ? '9+' : String(count);
      navItem.appendChild(span);
    }
  });
}

async function refreshBadges() {
  const badges = await computeBadges();
  applyNavBadges(badges);
}

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

$('btn-signout').addEventListener('click',  () => signOut(auth));
$('btn-account').addEventListener('click',  () => renderPage('account'));

// ── 사이드바 접기/펼치기 ──
(function initSidebarToggle() {
  const sidebar  = document.getElementById('sidebar');
  const mainWrap = document.getElementById('main-wrap');
  const toggle   = document.getElementById('sidebar-toggle');
  const COLLAPSED_KEY = 'gmbs_sidebar_collapsed';

  function applyCollapsed(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    mainWrap.classList.toggle('sidebar-collapsed', collapsed);
    toggle.title = collapsed ? '사이드바 펼치기' : '사이드바 접기';
  }

  const saved = localStorage.getItem(COLLAPSED_KEY) === '1';
  applyCollapsed(saved);

  toggle.addEventListener('click', () => {
    const next = !sidebar.classList.contains('collapsed');
    applyCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
  });
})();

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

  try {
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
        syncPersonDoc(user, currentUserDoc); // 비동기 실행, 완료 대기 안 함
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
        syncPersonDoc(user, currentUserDoc); // 비동기 실행, 완료 대기 안 함
        renderApp(STATUS.GENERAL);
      }
    } else {
      currentUserDoc = userSnap.data();

      // 기존 사용자도 새 초대(vendor_accounts)가 있으면 브랜드 추가 처리
      try {
        const vendorRef  = doc(db, 'vendor_accounts', email);
        const vendorSnap = await getDoc(vendorRef);
        if (vendorSnap.exists() && vendorSnap.data().status === STATUS.INVITED) {
          const vd = vendorSnap.data();
          const newBrandId = vd.brand_id;
          if (newBrandId) {
            const existingIds = getUserBrandIds(currentUserDoc);
            if (!existingIds.includes(newBrandId)) {
              const updatedIds = existingIds.length ? [...existingIds, newBrandId] : [newBrandId];
              await setDoc(userRef, {
                member_status: STATUS.BRAND,
                brand_id:  newBrandId,
                brand_ids: updatedIds,
                updated_at: serverTimestamp(),
              }, { merge: true });
            }
            await setDoc(vendorRef, { status: STATUS.LINKED, uid, linked_at: serverTimestamp() }, { merge: true });
            currentUserDoc = (await getDoc(userRef)).data();
          }
        }
      } catch (_) { /* 초대 확인 실패는 무시 */ }

      // 브랜드 담당자인데 brand_id가 null인 경우 안내 화면 표시
      // (브랜드 문서 존재 여부는 각 페이지에서 처리 — 로그인 지연 방지)
      if (currentUserDoc.member_status === STATUS.BRAND && !currentUserDoc.brand_id) {
        showNoBrandState();
        return;
      }

      syncPersonDoc(user, currentUserDoc); // 비동기 실행, 완료 대기 안 함
      renderApp(currentUserDoc.member_status || STATUS.GENERAL);
    }
  } catch (e) {
    // 예외 발생 시 로딩 화면이 고정되지 않도록 보장
    console.error('앱 초기화 오류:', e);
    if (currentUserDoc) {
      renderApp(currentUserDoc.member_status || STATUS.GENERAL);
    } else {
      showLogin();
    }
  }
});

// ── 브랜드 없음 상태 표시 ──
function showNoBrandState() {
  showApp();
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('main-wrap').style.marginLeft = '0';
  $('main-content').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;text-align:center;padding:40px">
      <div style="font-size:48px;margin-bottom:20px">🏢</div>
      <h2 style="font-size:20px;font-weight:700;margin-bottom:12px">현재 연결된 브랜드가 없습니다.</h2>
      <p style="font-size:14px;color:var(--gray-500);line-height:1.7;margin-bottom:32px">
        담당자 재등록이 필요하면 GMBS에 문의해 주세요.
      </p>
      <button class="btn btn-outline" id="btn-no-brand-signout" style="width:auto;padding:12px 28px">로그아웃</button>
    </div>
  `;
  document.getElementById('btn-no-brand-signout').addEventListener('click', () => signOut(auth));
}

// ── persons 최상위 컬렉션 동기화 ──
async function syncPersonDoc(user, userData) {
  try {
    const personId = userData.person_id;
    if (personId) {
      await updateDoc(doc(db, 'persons', personId), {
        name:               user.displayName || userData.name || '',
        login_google_email: user.email,
        updated_at:         serverTimestamp(),
      }).catch(() => {});
    } else {
      const personRef = await addDoc(collection(db, 'persons'), {
        brand_id:           userData.brand_id || null,
        name:               user.displayName || '',
        login_google_email: user.email,
        contact_email:      user.email,
        role:               '',
        active:             true,
        created_at:         serverTimestamp(),
        updated_at:         serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', user.uid), {
        person_id:  personRef.id,
        updated_at: serverTimestamp(),
      });
      await updateDoc(doc(db, 'vendor_accounts', user.email.toLowerCase()), {
        person_id: personRef.id,
      }).catch(() => {});
      currentUserDoc = { ...currentUserDoc, person_id: personRef.id };
    }
  } catch (_) { /* persons 동기화 실패는 무시 */ }
}

// ── 앱 렌더링 ──
function renderApp(memberStatus, isNewLink = false) {
  if (memberStatus === STATUS.BRAND) {
    const ids = getUserBrandIds(currentUserDoc);
    setActiveBrand(ids[0] || null);
  }
  updateSidebarUser(memberStatus);
  if (isNewLink) {
    renderPage('welcome');
  } else if (memberStatus === STATUS.BRAND) {
    renderPage('dashboard');
  } else {
    checkApplicationStatus();
  }
  showApp();
  // 앱 진입 시 초기 배지 계산 (백그라운드)
  refreshBadges().catch(() => {});
}

async function checkApplicationStatus() {
  renderPage('brand-list');
}

// ── 브랜드 데이터 캐시 (이름 + 사진) ──
const _brandDataCache = {};
async function getBrandData(brandId) {
  if (_brandDataCache[brandId]) return _brandDataCache[brandId];
  try {
    const snap = await getDoc(doc(db, 'brands', brandId));
    const d = snap.data() || {};
    const data = { name: d.brand_name || brandId, photoUrl: d.brand_photo_url || null };
    _brandDataCache[brandId] = data;
    return data;
  } catch (_) { return { name: brandId, photoUrl: null }; }
}
async function getBrandName(brandId) {
  return (await getBrandData(brandId)).name;
}

const MEMBER_STATUS_LABEL = {
  [STATUS.BRAND]:   '브랜드 담당자',
  [STATUS.GENERAL]: '담당 브랜드 없음',
};

// ── 사이드바 ──
async function updateSidebarUser(memberStatus) {
  $('user-name-text').textContent = currentUser.displayName || currentUser.email;
  $('user-role-text').textContent = MEMBER_STATUS_LABEL[memberStatus] || memberStatus;

  const avatarEl = $('user-avatar');
  if (currentUser.photoURL) {
    avatarEl.innerHTML = `<img src="${currentUser.photoURL}" alt="프로필">`;
  } else {
    avatarEl.textContent = (currentUser.displayName || currentUser.email || '?')[0].toUpperCase();
  }
  await renderSidebar(memberStatus);
}

function _brandAvatarHtml(photoUrl, name, cls) {
  if (photoUrl) return `<img src="${photoUrl}" alt="${name}" class="${cls}">`;
  const initial = (name || '?')[0].toUpperCase();
  return `<div class="${cls} brand-avatar-placeholder">${initial}</div>`;
}

async function renderSidebar(memberStatus) {
  const nav = $('sidebar-nav');

  if (memberStatus === STATUS.BRAND) {
    const brandIds = getUserBrandIds(currentUserDoc);
    const dataList = await Promise.all(brandIds.map(id => getBrandData(id)));
    const dataMap  = Object.fromEntries(brandIds.map((id, i) => [id, dataList[i]]));
    const current  = dataMap[activeBrandId] || dataList[0] || { name: '', photoUrl: null };

    nav.innerHTML = `
      <div class="sidebar-brand-header" id="brand-header-btn" title="브랜드 전환">
        ${_brandAvatarHtml(current.photoUrl, current.name, 'brand-avatar-sm')}
        <span class="brand-header-name nav-label">${current.name}</span>
        <span class="brand-header-chevron nav-label" id="brand-chevron">▾</span>
      </div>

      <div class="nav-item" data-page="dashboard"><span class="icon">🏠</span><span class="nav-label">대시보드</span></div>
      <div class="nav-item" data-page="brand-info"><span class="icon">🏷️</span><span class="nav-label">브랜드 정보</span></div>
      <div class="nav-item" data-page="persons"><span class="icon">👥</span><span class="nav-label">담당자 관리</span></div>
      <div class="nav-item" data-page="contracts"><span class="icon">📄</span><span class="nav-label">계약서</span></div>
      <div class="nav-section-label">상품·정산</div>
      <div class="nav-item" data-page="products"><span class="icon">📦</span><span class="nav-label">상품 관리</span></div>
      <div class="nav-item" data-page="inventory"><span class="icon">📊</span><span class="nav-label">재고·판매 조회</span></div>
      <div class="nav-item" data-page="settlements"><span class="icon">💰</span><span class="nav-label">정산 조회</span></div>
      <div class="nav-section-label">고객 지원</div>
      <div class="nav-item" data-page="customer-inquiries"><span class="icon">🎯</span><span class="nav-label">고객 문의</span></div>
      <div class="nav-section-label">안내</div>
      <div class="nav-item" data-page="notices"><span class="icon">📢</span><span class="nav-label">공지사항</span></div>
      <div class="nav-item" data-page="faq-page"><span class="icon">❓</span><span class="nav-label">자주하는 질문</span></div>
      <div class="nav-item" data-page="inquiries"><span class="icon">💬</span><span class="nav-label">1:1 문의하기</span></div>
      <div class="nav-section-label">담당 브랜드 관리</div>
      <div class="nav-item" data-page="brand-list"><span class="icon">📋</span><span class="nav-label">담당 브랜드 목록</span></div>
      <div class="nav-item" data-page="member-onboarding"><span class="icon">➕</span><span class="nav-label">새 브랜드 담당 추가</span></div>
    `;

    // ── 브랜드 스위처 팝업 ──
    let existingPopup = document.getElementById('brand-switcher-popup');
    if (existingPopup) existingPopup.remove();

    const otherIds = brandIds.filter(id => id !== activeBrandId);
    const popup = document.createElement('div');
    popup.id = 'brand-switcher-popup';
    popup.className = 'brand-switcher-popup';
    popup.innerHTML = `
      <div class="bsp-section-label">현재 브랜드</div>
      <div class="bsp-item bsp-item-active">
        ${_brandAvatarHtml(current.photoUrl, current.name, 'bsp-avatar')}
        <span class="bsp-name">${current.name}</span>
        <span class="bsp-check">✓</span>
      </div>
      ${otherIds.length > 0 ? `
        <div class="bsp-section-label">다른 브랜드</div>
        ${otherIds.map(id => `
          <div class="bsp-item bsp-switch-item" data-id="${id}">
            ${_brandAvatarHtml(dataMap[id].photoUrl, dataMap[id].name, 'bsp-avatar')}
            <span class="bsp-name">${dataMap[id].name}</span>
          </div>`).join('')}
      ` : ''}
      <div class="bsp-divider"></div>
      <button class="bsp-action" id="bsp-btn-add">+ 새 브랜드 담당 추가</button>
      <button class="bsp-action" id="bsp-btn-list">담당 브랜드 전체 보기</button>
    `;
    document.body.appendChild(popup);

    const headerBtn = document.getElementById('brand-header-btn');
    const chevron   = document.getElementById('brand-chevron');

    function openPopup() {
      const rect = headerBtn.getBoundingClientRect();
      popup.style.top  = (rect.bottom + 6) + 'px';
      popup.style.left = rect.left + 'px';
      popup.style.width = Math.max(rect.width, 220) + 'px';
      popup.classList.add('open');
      chevron.textContent = '▴';
    }
    function closePopup() {
      popup.classList.remove('open');
      chevron.textContent = '▾';
    }

    headerBtn.addEventListener('click', e => {
      e.stopPropagation();
      popup.classList.contains('open') ? closePopup() : openPopup();
    });

    document.addEventListener('click', function onOutside(e) {
      if (!popup.contains(e.target) && e.target !== headerBtn) {
        closePopup();
        document.removeEventListener('click', onOutside);
      }
    });

    popup.querySelectorAll('.bsp-switch-item').forEach(el => {
      el.addEventListener('click', () => {
        setActiveBrand(el.dataset.id);
        closePopup();
        renderSidebar(STATUS.BRAND);
        renderPage('dashboard');
      });
    });

    document.getElementById('bsp-btn-add').addEventListener('click', () => {
      closePopup(); renderPage('member-onboarding');
    });
    document.getElementById('bsp-btn-list').addEventListener('click', () => {
      closePopup(); renderPage('brand-list');
    });

  } else {
    nav.innerHTML = `
      <div class="nav-item" data-page="brand-list"><span class="icon">🏷️</span><span class="nav-label">담당 브랜드 목록</span></div>
      <div class="nav-item" data-page="member-onboarding"><span class="icon">➕</span><span class="nav-label">새 브랜드 담당 합류/등록</span></div>
      <div class="nav-section-label">안내</div>
      <div class="nav-item" data-page="notices"><span class="icon">📢</span><span class="nav-label">공지사항</span></div>
      <div class="nav-item" data-page="faq-page"><span class="icon">❓</span><span class="nav-label">자주하는 질문</span></div>
      <div class="nav-item" data-page="inquiries"><span class="icon">💬</span><span class="nav-label">1:1 문의하기</span></div>
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
  dashboard:           '대시보드',
  'branch-select':     '새 브랜드 담당 합류/등록',
  'member-onboarding': '새 브랜드 담당 합류/등록',
  'brand-list':        '담당 브랜드 목록',
  pending:             '신청 현황',
  welcome:             '환영합니다',
  'brand-info':        '브랜드 정보',
  persons:             '담당자 관리',
  contracts:           '계약서',
  products:            '상품 관리',
  inventory:           '재고·판매 조회',
  settlements:         '정산 조회',
  notices:             '공지사항',
  'faq-page':               '자주하는 질문',
  inquiries:                '1:1 문의하기',
  'customer-inquiries':     '고객 문의',
  account:                  '계정 설정',
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
    case 'branch-select':     renderBranchSelect(container); break;
    case 'member-onboarding': await renderMemberOnboardingPage(container); break;
    case 'brand-list':        await renderBrandListPage(container); break;
    case 'faq-page':          await renderFaqPage(container); break;
    case 'pending':       await renderPendingFull(container); break;
    case 'welcome':       container.innerHTML = renderWelcome(); break;
    case 'brand-info':    await renderBrandInfo(ctx()); break;
    case 'persons':       await renderPersons(ctx()); break;
    case 'contracts':     await renderContracts(ctx()); break;
    case 'products':      await renderProducts(ctx()); break;
    case 'inventory':     await renderInventory(ctx()); break;
    case 'settlements':   await renderSettlements(ctx()); break;
    case 'notices':       await renderNotices(ctx()); break;
    case 'inquiries':             await renderInquiries(ctx()); break;
    case 'customer-inquiries':    await renderCustomerInquiries(ctx()); break;
    case 'account':               await renderAccount(ctx()); break;
    default:              container.innerHTML = '<p>페이지를 찾을 수 없습니다.</p>';
  }

  // 배지 갱신: 읽음 처리 후 카운트 재계산 (백그라운드, 오류 무시)
  markBadgeRead(page).then(() => refreshBadges()).catch(() => {});
}

window._gotoPage = page => renderPage(page);

// ── 대시보드 ──
async function renderDashboard() {
  const name    = currentUserDoc?.name || currentUser?.displayName || '';
  const brandId = currentUserDoc?.brand_id;
  const container = $('main-content');

  container.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <h2 style="font-size:20px;font-weight:700;margin-bottom:6px">안녕하세요, ${esc(name)}님 👋</h2>
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
      <input id="join-brand-search" type="text" placeholder="브랜드명을 입력하세요"
        style="display:block;width:100%;box-sizing:border-box;padding:11px 14px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:14px;outline:none;transition:border-color .15s"
        onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='var(--gray-200)'">
      <div id="join-brand-results" style="margin-top:6px"></div>
      <div id="join-brand-selected" style="display:none;margin-top:8px;padding:10px 12px;background:var(--primary-light,#eff6ff);border-radius:8px;font-size:13px;font-weight:600;color:var(--primary)"></div>
    </div>
    <div class="form-group">
      <label class="form-label">연락처 <span style="color:var(--danger)">*</span></label>
      <input id="join-phone" class="form-input" type="tel" placeholder="010-0000-0000" value="${ud.phone || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">연락용 이메일 <span style="color:var(--danger)">*</span></label>
      <input id="join-contact-email" class="form-input" type="email" placeholder="업무용 이메일" value="${ud.contact_email || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">역할/직책 <span style="color:var(--danger)">*</span></label>
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
  let isComposing = false;
  const searchInput = $('join-brand-search');
  searchInput.addEventListener('compositionstart', () => { isComposing = true; });
  searchInput.addEventListener('compositionend', () => {
    isComposing = false;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchBrands, 100);
  });
  searchInput.addEventListener('input', () => {
    if (isComposing) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchBrands, 300);
  });

  $('btn-join-submit').addEventListener('click', async () => {
    const phone        = $('join-phone').value.trim();
    const contactEmail = $('join-contact-email').value.trim();
    const role         = $('join-role').value;
    const errEl        = $('join-error');
    if (!selectedBrandId)  { errEl.textContent = '브랜드를 검색해서 선택해 주세요.'; return; }
    if (!phone)            { errEl.textContent = '연락처를 입력해 주세요.'; return; }
    if (!contactEmail)     { errEl.textContent = '연락용 이메일을 입력해 주세요.'; return; }
    if (!role)             { errEl.textContent = '역할/직책을 선택해 주세요.'; return; }

    $('btn-join-submit').disabled = true;
    $('btn-join-submit').textContent = '신청 중...';

    await addDoc(collection(db, 'brand_join_requests'), {
      applicant_uid:         currentUser.uid,
      applicant_email:       normalizeEmail(currentUser.email),
      applicant_name:        currentUser.displayName || '',
      applicant_phone:       phone,
      applicant_contact_email: contactEmail,
      applicant_role:        role,
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

  const sectionStyle = 'font-size:12px;font-weight:600;color:var(--gray-500);letter-spacing:.04em;margin:20px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--gray-100)';

  showModal(`
    <div class="modal-title">새 브랜드 입점 신청</div>

    <div style="${sectionStyle};margin-top:0">기본 정보</div>
    <div class="form-group">
      <label class="form-label">브랜드명 <span style="color:var(--danger)">*</span></label>
      <input id="app-brand-name" class="form-input" type="text" placeholder="브랜드 이름을 입력하세요">
    </div>
    <div class="form-group">
      <label class="form-label">브랜드 대표 사진 <span style="color:var(--gray-400);font-weight:400">(정사각형 500×500px 권장, JPG/PNG)</span></label>
      <input id="app-brand-photo" type="file" accept="image/jpeg,image/png"
        style="display:block;width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:13px;cursor:pointer">
      <div id="app-photo-preview" style="display:none;margin-top:8px">
        <img id="app-photo-img" style="max-width:120px;max-height:120px;border-radius:8px;object-fit:cover;border:1px solid var(--gray-200)">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">브랜드 간단 소개</label>
      <textarea id="app-brand-desc" class="form-input" placeholder="브랜드를 한 줄로 소개해 주세요" rows="2" style="resize:vertical"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">관련 사이트 <span style="color:var(--gray-400);font-weight:400">(최대 5개)</span></label>
      <div id="app-url-list"></div>
      <button type="button" id="btn-add-url"
        style="margin-top:6px;padding:7px 14px;background:none;border:1.5px dashed var(--gray-300);border-radius:8px;font-size:13px;color:var(--gray-500);cursor:pointer;width:100%">
        + URL 추가
      </button>
    </div>

    <div style="${sectionStyle}">담당자 정보</div>
    <div class="form-group">
      <label class="form-label">연락처 <span style="color:var(--danger)">*</span></label>
      <input id="app-phone" class="form-input" type="tel" placeholder="010-0000-0000" value="${ud.phone || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">연락용 이메일 <span style="color:var(--danger)">*</span></label>
      <input id="app-contact-email" class="form-input" type="email" placeholder="업무용 이메일" value="${ud.contact_email || ''}">
    </div>
    <div class="form-group">
      <label class="form-label">역할/직책 <span style="color:var(--danger)">*</span></label>
      ${roleSelectHTML('app-role')}
    </div>

    <div id="settlement-section">
      <div style="${sectionStyle}">정산 정보</div>

      <div class="form-group">
        <label class="form-label">사업자 여부 <span style="color:var(--danger)">*</span></label>
        <div style="display:flex;gap:12px;margin-top:6px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
            <input type="radio" name="app-biz-type" value="business" id="app-biz-business"> 사업자
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
            <input type="radio" name="app-biz-type" value="individual" id="app-biz-individual"> 개인(사업자없음)
          </label>
        </div>
      </div>

      <div id="business-fields" style="display:none">
        <div class="form-group">
          <label class="form-label">사업자등록번호</label>
          <div style="display:flex;gap:8px">
            <input id="app-biz-reg-number" class="form-input" type="text" placeholder="000-00-00000" style="flex:1">
            <button type="button" id="btn-verify-biz"
              style="white-space:nowrap;padding:0 14px;background:var(--gray-100);border:1.5px solid var(--gray-200);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;color:var(--gray-700)">
              사업자 확인
            </button>
          </div>
          <div id="app-biz-hint" style="font-size:12px;margin-top:5px;min-height:18px"></div>
        </div>
        <div class="form-group">
          <label class="form-label">과세 유형</label>
          <select id="app-taxation-type" class="form-input form-select">
            <option value="">선택하세요</option>
            <option value="일반">일반과세</option>
            <option value="간이">간이과세</option>
          </select>
        </div>
      </div>

      <div id="individual-fields" style="display:none">
        <div class="form-group">
          <label class="form-label">주민등록번호</label>
          <input id="app-resident-number" class="form-input" type="password"
            placeholder="000000-0000000" maxlength="14" autocomplete="off">
          <div id="app-resident-hint" style="font-size:12px;margin-top:5px;min-height:18px"></div>
          <p style="margin-top:6px;font-size:11px;color:var(--gray-500);line-height:1.5;background:var(--gray-50);padding:8px 10px;border-radius:6px">
            주민등록번호는 소득세법 제127조에 따른 원천징수 신고 목적으로만 수집됩니다.<br>
            AES-256 암호화 저장, 세무법정 보관 기간(5년) 이후 파기됩니다.
          </p>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">은행명 <span style="color:var(--danger)">*</span></label>
        <input id="app-bank-name" class="form-input" type="text" placeholder="국민은행">
      </div>
      <div class="form-group">
        <label class="form-label">예금주명 <span style="color:var(--danger)">*</span></label>
        <input id="app-account-holder" class="form-input" type="text" placeholder="홍길동">
      </div>
      <div class="form-group">
        <label class="form-label">계좌번호 <span style="color:var(--danger)">*</span></label>
        <input id="app-account-number" class="form-input" type="text" placeholder="000000-00-000000">
      </div>
    </div>

    <div id="app-error" class="form-error"></div>
    <button class="btn btn-primary" id="btn-app-submit" style="margin-top:8px">신청하기</button>
  `);

  // URL 행 추가 함수
  function addUrlRow(value = '') {
    const list = $('app-url-list');
    if (list.querySelectorAll('.app-url-row').length >= 5) return;
    const row = document.createElement('div');
    row.className = 'app-url-row';
    row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
    row.innerHTML = `
      <input class="form-input app-url-input" type="url" placeholder="홈페이지, SNS 주소 등 (https://...)" value="${value}" style="flex:1">
      <button type="button" class="app-url-remove" style="padding:0 12px;background:none;border:1.5px solid var(--gray-200);border-radius:8px;font-size:16px;color:var(--gray-400);cursor:pointer">✕</button>
    `;
    row.querySelector('.app-url-remove').addEventListener('click', () => {
      row.remove();
      $('btn-add-url').style.display = list.querySelectorAll('.app-url-row').length >= 5 ? 'none' : 'block';
    });
    list.appendChild(row);
    if (list.querySelectorAll('.app-url-row').length >= 5) {
      $('btn-add-url').style.display = 'none';
    }
  }
  addUrlRow(); // 첫 번째 행 기본 추가
  $('btn-add-url').addEventListener('click', () => addUrlRow());

  // 사진 미리보기
  $('app-brand-photo').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      $('app-photo-img').src = ev.target.result;
      $('app-photo-preview').style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  // 사업자 여부 변경 → 사업자/개인 필드 토글
  document.querySelectorAll('input[name="app-biz-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isBiz = document.getElementById('app-biz-business').checked;
      $('business-fields').style.display = isBiz ? 'block' : 'none';
      $('individual-fields').style.display = isBiz ? 'none' : 'block';
    });
  });

  // 사업자등록번호 자동 포맷 + 형식 힌트
  $('app-biz-reg-number').addEventListener('input', () => {
    const el = $('app-biz-reg-number');
    el.value = formatBizRegNumber(el.value);
    const hint = $('app-biz-hint');
    const digits = el.value.replace(/-/g, '');
    if (digits.length === 10) {
      if (validateBizRegNumber(digits)) {
        hint.style.color = 'var(--success, #16a34a)';
        hint.textContent = '형식 확인됨 — "사업자 확인" 버튼으로 실제 조회하세요.';
      } else {
        hint.style.color = 'var(--danger)';
        hint.textContent = '올바르지 않은 사업자등록번호입니다.';
      }
    } else {
      hint.textContent = '';
    }
  });

  // 사업자 확인 버튼 (국세청 API)
  $('btn-verify-biz').addEventListener('click', async () => {
    const el = $('app-biz-reg-number');
    const hint = $('app-biz-hint');
    const digits = (el.value || '').replace(/-/g, '');
    if (digits.length !== 10 || !validateBizRegNumber(digits)) {
      hint.style.color = 'var(--danger)';
      hint.textContent = '사업자등록번호를 먼저 올바르게 입력하세요.';
      return;
    }
    $('btn-verify-biz').disabled = true;
    hint.style.color = 'var(--gray-500)';
    hint.textContent = '조회 중...';
    try {
      const r = await verifyBizNumber(digits);
      const colors = { active: 'var(--success, #16a34a)', dormant: 'var(--warning, #b45309)', closed: 'var(--danger)' };
      const icons  = { active: '✓', dormant: '⚠', closed: '✗' };
      hint.style.color = colors[r.status] || 'var(--gray-600)';
      hint.textContent = (icons[r.status] || '?') + ' ' + r.label;
    } catch (e) {
      hint.style.color = 'var(--danger)';
      hint.textContent = '조회 오류: ' + e.message;
    } finally {
      $('btn-verify-biz').disabled = false;
    }
  });

  // 주민등록번호 자동 하이픈 + 실시간 검증
  $('app-resident-number').addEventListener('input', () => {
    const el = $('app-resident-number');
    el.value = formatResidentNumber(el.value);
    const hint = $('app-resident-hint');
    const digits = el.value.replace(/-/g, '');
    if (digits.length === 13) {
      const r = validateResidentNumber(el.value);
      hint.style.color = r.ok ? 'var(--success, #16a34a)' : 'var(--danger)';
      hint.textContent = r.ok ? '✓ 형식이 올바릅니다.' : '✗ ' + r.msg;
    } else {
      hint.textContent = '';
    }
  });

  $('btn-app-submit').addEventListener('click', async () => {
    const brandName    = $('app-brand-name').value.trim();
    const phone        = $('app-phone').value.trim();
    const contactEmail = $('app-contact-email').value.trim();
    const role         = $('app-role').value;
    const errEl        = $('app-error');

    if (!brandName)    { errEl.textContent = '브랜드명을 입력해 주세요.'; return; }
    if (!phone)        { errEl.textContent = '연락처를 입력해 주세요.'; return; }
    if (!contactEmail) { errEl.textContent = '연락용 이메일을 입력해 주세요.'; return; }
    if (!role)         { errEl.textContent = '역할/직책을 선택해 주세요.'; return; }

    const bizType = document.querySelector('input[name="app-biz-type"]:checked')?.value;
    if (!bizType) { errEl.textContent = '사업자 여부를 선택해 주세요.'; return; }
    if (!$('app-bank-name').value.trim())      { errEl.textContent = '은행명을 입력해 주세요.'; return; }
    if (!$('app-account-holder').value.trim()) { errEl.textContent = '예금주명을 입력해 주세요.'; return; }
    if (!$('app-account-number').value.trim()) { errEl.textContent = '계좌번호를 입력해 주세요.'; return; }
    const validationErrors = validateSettlementForm({
      bizType,
      bizNumber:      $('app-biz-reg-number')?.value || '',
      residentNumber: $('app-resident-number')?.value || '',
    });
    if (validationErrors.length) { errEl.textContent = validationErrors[0]; return; }

    $('btn-app-submit').disabled = true;
    $('btn-app-submit').textContent = '신청 중...';

    try {
      // 사진 업로드
      let photoUrl = '';
      const photoFile = $('app-brand-photo').files[0];
      if (photoFile) {
        try {
          const photoRef = ref(storage, `brand_applications/${currentUser.uid}_${Date.now()}_${photoFile.name}`);
          await uploadBytes(photoRef, photoFile);
          photoUrl = await getDownloadURL(photoRef);
        } catch (_) { /* 사진 실패해도 계속 */ }
      }

      // URL 수집
      const websiteUrls = [...document.querySelectorAll('.app-url-input')]
        .map(el => el.value.trim()).filter(Boolean);

      // 정산 정보 구성
      const isBiz = bizType === 'business';
      const accountNumberRaw = $('app-account-number').value.trim();
      const residentNumberRaw = !isBiz ? ($('app-resident-number').value.trim()) : '';

      const [accountNumberEnc, residentNumberEnc] = await Promise.all([
        encryptValue(accountNumberRaw),
        encryptValue(residentNumberRaw),
      ]);

      const settlementInfo = {
        business_type:  bizType,
        bank_name:      $('app-bank-name').value.trim(),
        account_holder: $('app-account-holder').value.trim(),
        account_number: accountNumberEnc,
        ...(isBiz ? {
          business_reg_number: $('app-biz-reg-number').value.trim(),
          taxation_type:       $('app-taxation-type').value,
        } : {
          resident_number: residentNumberEnc,
        }),
      };

      await addDoc(collection(db, 'brand_applications'), {
        applicant_uid:           currentUser.uid,
        applicant_email:         normalizeEmail(currentUser.email),
        applicant_name:          currentUser.displayName || '',
        applicant_phone:         phone,
        applicant_contact_email: contactEmail,
        applicant_role:          role,
        brand_name:              brandName,
        brand_description:       $('app-brand-desc').value.trim(),
        website_urls:            websiteUrls,
        brand_photo_url:         photoUrl,
        settlement_info:         settlementInfo,
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
    } catch (e) {
      errEl.textContent = '신청 중 오류가 발생했습니다. 다시 시도해 주세요.';
      $('btn-app-submit').disabled = false;
      $('btn-app-submit').textContent = '신청하기';
    }
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

  const wrap = document.createElement('div');
  wrap.style.maxWidth = '640px';
  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;gap:12px;flex-wrap:wrap">
      <div>
        <h2 style="font-size:18px;font-weight:700">신청 현황</h2>
        <p style="font-size:13px;color:var(--gray-600);margin-top:4px">
          승인되면 자동으로 브랜드 포털이 열립니다. 페이지를 새로고침해 주세요.
        </p>
      </div>
      <button id="btn-new-apply" style="white-space:nowrap;padding:9px 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0">
        + 새 신청하기
      </button>
    </div>
    <div id="pending-cards"></div>
    <div style="margin-top:16px;text-align:center">
      <button class="btn btn-outline" id="btn-pending-refresh" style="width:auto;padding:10px 24px">
        🔄 새로고침
      </button>
    </div>`;
  container.innerHTML = '';
  container.appendChild(wrap);
  document.getElementById('btn-pending-refresh').addEventListener('click', () => location.reload());
  document.getElementById('btn-new-apply').addEventListener('click', () => {
    showModal(`
      <div class="modal-title">새 신청 유형 선택</div>
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px">
        <button class="btn btn-primary" id="btn-modal-join" style="margin-top:0">기존 브랜드 담당자로 합류</button>
        <button class="btn btn-outline" id="btn-modal-apply" style="margin-top:0">새 브랜드 등록 신청</button>
      </div>
    `);
    document.getElementById('btn-modal-join').addEventListener('click', () => { closeModal(); openJoinModal(); });
    document.getElementById('btn-modal-apply').addEventListener('click', () => { closeModal(); openApplyModal(); });
  });

  const cardsEl = document.getElementById('pending-cards');

  function renderCards(items) {
    cardsEl.innerHTML = '';
    if (items.length === 0) { renderPage('branch-select'); return; }
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.marginBottom = '12px';

      const canCancel = item.status === STATUS.SUBMITTED;
      const brandLabel = item.brand_name || item.target_brand_name || item.target_brand_id || '-';

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              ${statusBadge(item.status)}
              <span class="badge badge-gray">${item.type === 'apply' ? '새 브랜드 등록' : '브랜드 합류'}</span>
            </div>
            <div style="font-weight:700;font-size:15px">${brandLabel}</div>
            <div style="font-size:12px;color:var(--gray-400);margin-top:4px">신청일: ${fmt(item.submitted_at)}</div>
            ${item.rejection_reason ? `<div style="margin-top:8px;font-size:13px;color:var(--danger)">거절 사유: ${esc(item.rejection_reason)}</div>` : ''}
          </div>
          ${canCancel ? `<button class="btn-cancel-join" style="margin-left:12px;flex-shrink:0;width:auto;padding:6px 14px;background:#fff;color:var(--danger);border:1.5px solid var(--danger);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">신청 취소</button>` : ''}
        </div>`;

      if (canCancel) {
        const collName = item.type === 'join' ? 'brand_join_requests' : 'brand_applications';
        card.querySelector('.btn-cancel-join').addEventListener('click', async () => {
          if (!confirm(`'${brandLabel}' 신청을 취소하시겠습니까?`)) return;
          await deleteDoc(doc(db, collName, item.id));
          all.splice(all.indexOf(item), 1);
          renderCards(all);
        });
      }
      cardsEl.appendChild(card);
    });
  }

  renderCards(all);
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

// ── 구글 로그인 버튼 SVG ──
const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
  <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
</svg>`;

// ── 공개 랜딩 페이지 ──
async function renderPublicLanding() {
  loginScreen.innerHTML = '';

  // 헤더 (로고만, 로그인 버튼은 본문 카드에만)
  const header = document.createElement('div');
  header.className = 'landing-header';
  header.innerHTML = `<div class="landing-logo">게을러서못열뻔한상점(GMBS)</div>`;
  loginScreen.appendChild(header);

  // 본문 영역
  const body = document.createElement('div');
  body.className = 'landing-body';
  loginScreen.appendChild(body);

  // 로딩 중 표시
  body.innerHTML = '<div style="text-align:center;padding:60px 0"><div class="spinner" style="margin:0 auto 12px"></div><p style="color:var(--gray-400);font-size:14px">안내 내용을 불러오는 중...</p></div>';

  // onboarding_cards(public) + faq_items 병렬 로드
  let cards = [], faqs = [];
  try {
    const [cardSnap, faqSnap] = await Promise.all([
      getDocs(query(collection(db, 'onboarding_cards'), where('audience', '==', 'public'), where('active', '==', true), orderBy('order'))),
      getDocs(query(collection(db, 'faq_items'), where('active', '==', true), orderBy('order'))),
    ]);
    cards = cardSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    faqs  = faqSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) {}

  body.innerHTML = '';

  if (cards.length > 0) {
    const wizEl = document.createElement('div');
    body.appendChild(wizEl);
    renderWizard(wizEl, cards, {
      isPublic: true,
      onLogin: () => handleGoogleSignIn(),
    });
  } else {
    // 카드 없으면 간단한 로그인 카드
    body.innerHTML = `
      <div class="login-card" style="margin-top:48px">
        <div class="login-logo">게을러서못열뻔한상점(GMBS)</div>
        <div class="login-sub">입점 브랜드 관리자</div>
        <button class="btn btn-primary" id="lnd-login2" style="margin-top:8px">${GOOGLE_SVG} 구글로 로그인 / 시작하기</button>
        <div id="login-error" style="color:var(--danger);font-size:13px;margin-top:14px;min-height:18px"></div>
      </div>`;
    body.querySelector('#lnd-login2').addEventListener('click', () => handleGoogleSignIn());
  }

  if (faqs.length > 0) {
    const faqSection = document.createElement('div');
    faqSection.style.cssText = 'margin-top:36px';
    faqSection.innerHTML = '<h2 style="font-size:18px;font-weight:800;margin-bottom:16px;color:var(--gray-900)">자주 묻는 질문</h2>';
    const faqWrap = document.createElement('div');
    faqWrap.className = 'card';
    faqSection.appendChild(faqWrap);
    body.appendChild(faqSection);
    renderFaqSection(faqWrap, faqs);
  }
}

// ── 위저드 렌더러 (공개/회원 공용) ──
function renderWizard(container, cards, { isPublic = false, onLogin = null, onComplete = null } = {}) {
  let idx = 0;

  const wrap = document.createElement('div');
  wrap.className = 'wizard-wrap';
  container.appendChild(wrap);

  function renderCard() {
    const card = cards[idx];
    const isLast = idx === cards.length - 1;
    const hasPrev = idx > 0;

    let ctaBtn = '';
    if (isLast) {
      if (isPublic) {
        ctaBtn = `<button class="btn-wiz-next" id="wiz-cta">지금 입점 신청하기</button>`;
      } else {
        ctaBtn = `<button class="btn-wiz-next" id="wiz-cta">계속하기</button>`;
      }
    } else {
      ctaBtn = `<button class="btn-wiz-next" id="wiz-next">다음 →</button>`;
    }

    wrap.innerHTML = `
      <div class="wizard-card active">
        ${safeUrl(card.image_url) ? `<img src="${safeUrl(card.image_url)}" alt="${esc(card.image_alt || '')}">` : ''}
        <div class="wizard-title">${esc(card.title || '')}</div>
        <div class="wizard-body">${card.body || ''}</div>
      </div>
      <div class="wizard-footer">
        <div class="wizard-dots">
          ${cards.map((_, i) => `<div class="wizard-dot${i === idx ? ' active' : ''}"></div>`).join('')}
        </div>
        <div class="wizard-nav">
          <button class="btn-wiz-skip" id="wiz-skip">건너뛰기</button>
          ${hasPrev ? `<button class="btn-wiz-prev" id="wiz-prev">← 이전</button>` : ''}
          ${ctaBtn}
        </div>
      </div>`;

    wrap.querySelector('#wiz-skip')?.addEventListener('click', () => {
      if (isPublic && onLogin) onLogin();
      else if (onComplete) onComplete();
    });
    wrap.querySelector('#wiz-prev')?.addEventListener('click', () => { idx--; renderCard(); });
    wrap.querySelector('#wiz-next')?.addEventListener('click', () => { idx++; renderCard(); });
    wrap.querySelector('#wiz-cta')?.addEventListener('click', () => {
      if (isPublic && onLogin) onLogin();
      else if (onComplete) onComplete();
    });
  }

  renderCard();
}

// ── FAQ 섹션 렌더러 ──
function renderFaqSection(container, faqs) {
  const cats = ['전체', ...new Set(faqs.map(f => f.category).filter(Boolean))];
  let activeCat = '전체';
  let searchTerm = '';

  function render() {
    const filtered = faqs.filter(f => {
      const catMatch = activeCat === '전체' || f.category === activeCat;
      const txtMatch = !searchTerm || (f.question + ' ' + f.answer).toLowerCase().includes(searchTerm);
      return catMatch && txtMatch;
    });

    container.innerHTML = `
      <div class="faq-search-wrap">
        <input class="faq-search" id="faq-search-inp" type="text" placeholder="질문 검색..." value="${searchTerm}">
      </div>
      <div class="faq-cats">
        ${cats.map(c => `<button class="faq-cat-btn${c === activeCat ? ' active' : ''}" data-cat="${c}">${c}</button>`).join('')}
      </div>
      ${filtered.length === 0
        ? '<div class="faq-empty">검색 결과가 없습니다.</div>'
        : filtered.map(f => `
          <div class="faq-item">
            <button class="faq-q"><span>${f.question}</span><span class="faq-arrow">▼</span></button>
            <div class="faq-a">${f.answer}</div>
          </div>`).join('')}`;

    container.querySelector('#faq-search-inp').addEventListener('input', e => {
      searchTerm = e.target.value.trim().toLowerCase();
      render();
    });
    container.querySelectorAll('.faq-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => { activeCat = btn.dataset.cat; render(); });
    });
    container.querySelectorAll('.faq-q').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.faq-item').classList.toggle('open'));
    });
  }

  render();
}

// ── 회원 온보딩 위저드 (새 브랜드 담당 합류/등록 진입 시마다) ──
async function renderMemberOnboardingPage(container) {
  container.innerHTML = '<div style="text-align:center;padding:60px 0"><div class="spinner" style="margin:0 auto"></div></div>';

  let cards = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'onboarding_cards'),
      where('audience', '==', 'member'),
      where('active', '==', true),
      orderBy('order'),
    ));
    cards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) {}

  container.innerHTML = '';

  if (cards.length === 0) {
    // 카드 없으면 갈림길로 바로 이동
    renderBranchSelect(container);
    return;
  }

  const wizEl = document.createElement('div');
  wizEl.style.cssText = 'max-width:640px;margin:0 auto';
  container.appendChild(wizEl);

  renderWizard(wizEl, cards, {
    isPublic: false,
    onComplete: () => renderBranchSelect(container),
  });
}

// ── 담당 브랜드 목록 (일반회원) ──
async function renderBrandListPage(container) {
  container.innerHTML = '<div class="card"><div class="spinner" style="margin:40px auto"></div></div>';
  const uid = currentUser.uid;
  const isBrandMember = currentUserDoc?.member_status === STATUS.BRAND;

  // 브랜드 회원: 실제 담당 브랜드 목록 표시
  if (isBrandMember) {
    try {
      const brandIds = getUserBrandIds(currentUserDoc);
      const brands = await Promise.all(brandIds.map(id => getBrandData(id).then(d => ({ id, ...d }))));

      let filtered = brands;

      function renderTable(list) {
        if (list.length === 0) {
          return `<div style="text-align:center;padding:40px;color:var(--gray-400)">검색 결과가 없습니다.</div>`;
        }
        return `
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:48px"></th>
                <th>브랜드명</th>
                <th style="width:100px;text-align:center">상태</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(b => `
                <tr class="brand-list-row" data-id="${b.id}" style="cursor:pointer">
                  <td>
                    ${b.photoUrl
                      ? `<img src="${b.photoUrl}" alt="${b.name}" style="width:36px;height:36px;border-radius:50%;object-fit:cover">`
                      : `<div style="width:36px;height:36px;border-radius:50%;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px">${(b.name||'?')[0].toUpperCase()}</div>`}
                  </td>
                  <td>
                    <span style="font-weight:600">${b.name}</span>
                    ${b.id === activeBrandId ? `<span class="badge badge-green" style="margin-left:8px;font-size:11px">현재</span>` : ''}
                  </td>
                  <td style="text-align:center">
                    <span class="badge badge-green">활성</span>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>`;
      }

      container.innerHTML = `
        <div style="max-width:800px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div>
              <h2 style="font-size:18px;font-weight:700">담당 브랜드 목록</h2>
              <p style="font-size:13px;color:var(--gray-600);margin-top:4px">담당하고 있는 브랜드를 확인하고 전환하세요.</p>
            </div>
            <button class="btn btn-primary" id="btn-add-brand" style="width:auto;padding:10px 16px">+ 새 브랜드 담당 추가</button>
          </div>
          <div class="card" style="margin-bottom:16px;padding:12px 16px">
            <input id="brand-search" class="form-input" type="text" placeholder="브랜드명 검색" style="margin:0;max-width:300px">
          </div>
          <div class="card" id="brand-table-wrap">${renderTable(brands)}</div>
        </div>`;

      document.getElementById('btn-add-brand').addEventListener('click', () => renderPage('member-onboarding'));

      document.getElementById('brand-search').addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        filtered = brands.filter(b => b.name.toLowerCase().includes(q));
        document.getElementById('brand-table-wrap').innerHTML = renderTable(filtered);
        bindRows();
      });

      function bindRows() {
        container.querySelectorAll('.brand-list-row').forEach(row => {
          row.addEventListener('click', () => {
            setActiveBrand(row.dataset.id);
            renderSidebar(STATUS.BRAND);
            renderPage('dashboard');
          });
        });
      }
      bindRows();

    } catch (e) {
      container.innerHTML = '<div class="card" style="color:var(--danger);padding:24px">데이터를 불러오지 못했습니다.</div>';
    }
    return;
  }

  // 일반 회원: 신청 현황 표시
  try {
    const [appsSnap, joinSnap] = await Promise.all([
      getDocs(query(collection(db, 'brand_applications'),  where('applicant_uid', '==', uid))),
      getDocs(query(collection(db, 'brand_join_requests'), where('applicant_uid', '==', uid))),
    ]);
    const apps  = appsSnap.docs.map(d => ({ id: d.id, type: 'new',  ...d.data() }));
    const joins = joinSnap.docs.map(d => ({ id: d.id, type: 'join', ...d.data() }));
    const all   = [...apps, ...joins].sort((a, b) => {
      const ta = a.submitted_at?.toMillis?.() || 0;
      const tb = b.submitted_at?.toMillis?.() || 0;
      return tb - ta;
    });

    const statusBadge = s => {
      const map = { '제출됨': ['badge-yellow','심사중'], '승인': ['badge-green','승인'], '거절': ['badge-red','거절'] };
      const [cls, label] = map[s] || ['badge-gray', s || '-'];
      return `<span class="badge ${cls}">${label}</span>`;
    };
    const fmtTs = ts => {
      if (!ts) return '-';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
    };

    container.innerHTML = `
      <div style="max-width:720px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <div>
            <h2 style="font-size:18px;font-weight:700">담당 브랜드 목록</h2>
            <p style="font-size:13px;color:var(--gray-600);margin-top:4px">신청 현황 및 담당 브랜드를 확인하세요.</p>
          </div>
          <button class="btn btn-primary" id="btn-add-brand" style="width:auto;padding:10px 16px">
            + 새 브랜드 담당 합류/등록
          </button>
        </div>
        ${all.length === 0
          ? `<div class="card" style="text-align:center;padding:48px;color:var(--gray-400)">
               <div style="font-size:40px;margin-bottom:12px">🏷️</div>
               <p style="font-size:15px;font-weight:600;margin-bottom:8px">아직 신청 내역이 없습니다.</p>
               <p style="font-size:13px">위 버튼을 눌러 브랜드 담당자로 합류하거나 새 브랜드를 등록하세요.</p>
             </div>`
          : all.map(item => `
              <div class="card" style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
                      <span style="font-size:12px;padding:2px 8px;border-radius:20px;background:var(--gray-100);color:var(--gray-600);font-weight:600">
                        ${item.type === 'new' ? '새 브랜드 등록' : '기존 브랜드 합류'}
                      </span>
                      ${statusBadge(item.status)}
                    </div>
                    <div style="font-size:15px;font-weight:700;margin-bottom:4px">
                      ${item.brand_name || item.target_brand_name || item.target_brand_id || '(브랜드명 없음)'}
                    </div>
                    <div style="font-size:12px;color:var(--gray-400)">신청일: ${fmtTs(item.submitted_at)}</div>
                    ${item.status === '거절' && item.reject_reason
                      ? `<div style="margin-top:8px;padding:8px 12px;background:#fee2e2;border-radius:6px;font-size:12px;color:#b91c1c">
                           거절 사유: ${item.reject_reason}
                         </div>` : ''}
                  </div>
                  ${item.status === '제출됨'
                    ? `<button class="btn-cancel-app" data-id="${item.id}" data-type="${item.type}"
                         style="flex-shrink:0;padding:6px 14px;background:#fff;color:var(--danger);border:1.5px solid var(--danger);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">
                         신청 취소
                       </button>` : ''}
                </div>
              </div>`).join('')}
      </div>`;

    document.getElementById('btn-add-brand').addEventListener('click', () => renderPage('member-onboarding'));

    container.querySelectorAll('.btn-cancel-app').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('신청을 취소하시겠습니까?')) return;
        const colName = btn.dataset.type === 'new' ? 'brand_applications' : 'brand_join_requests';
        try {
          await deleteDoc(doc(db, colName, btn.dataset.id));
          renderBrandListPage(container);
        } catch (_) { alert('취소 중 오류가 발생했습니다.'); }
      });
    });
  } catch (e) {
    container.innerHTML = '<div class="card" style="color:var(--danger);padding:24px">데이터를 불러오지 못했습니다.</div>';
  }
}

// ── 자주하는 질문 페이지 ──
async function renderFaqPage(container) {
  container.innerHTML = '<div class="card"><div class="spinner" style="margin:40px auto"></div></div>';
  let faqs = [];
  try {
    const snap = await getDocs(query(collection(db, 'faq_items'), where('active', '==', true), orderBy('order')));
    faqs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) {}

  container.innerHTML = '<div style="max-width:720px"><div id="faq-container" class="card"></div></div>';
  if (faqs.length === 0) {
    container.querySelector('#faq-container').innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-400)">등록된 FAQ가 없습니다.</div>';
  } else {
    renderFaqSection(container.querySelector('#faq-container'), faqs);
  }
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
