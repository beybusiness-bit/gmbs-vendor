import { db, doc, getDoc, getDocs, collection } from './firebase-init.js';

// 이메일 설정을 Firestore email_configs 컬렉션에서 읽어 캐시
let _cache = null;

async function getEmailConfig() {
  if (_cache) return _cache;
  try {
    const [settingsSnap, configsSnap] = await Promise.all([
      getDoc(doc(db, 'email_configs', '_settings')),
      getDocs(collection(db, 'email_configs')),
    ]);
    const settings = settingsSnap.exists() ? settingsSnap.data() : {};
    const triggers = {};
    configsSnap.docs.forEach(d => {
      if (d.id !== '_settings') triggers[d.id] = d.data();
    });
    _cache = { settings, triggers };
  } catch (e) {
    console.warn('[EmailJS] 설정 로드 실패:', e);
    _cache = { settings: {}, triggers: {} };
  }
  return _cache;
}

let _initialized = false;

function initEmailJS(publicKey) {
  if (_initialized) return;
  if (!window.emailjs) {
    console.warn('[EmailJS] 라이브러리가 로드되지 않았습니다. index.html에 CDN 스크립트가 있는지 확인하세요.');
    return;
  }
  window.emailjs.init({ publicKey });
  _initialized = true;
}

// 공통 발송 함수: admin.gmbs.kr 이메일 설정에 따라 동적으로 발송
export async function sendEmail(triggerEvent, { toEmail, toName, brandName } = {}) {
  const { settings, triggers } = await getEmailConfig();

  if (!settings.public_key || !settings.service_id) {
    console.warn('[EmailJS] admin.gmbs.kr → 이메일 설정에서 Public Key와 Service ID를 먼저 입력하세요.');
    return;
  }

  const trigger = triggers[triggerEvent];
  if (!trigger || !trigger.enabled || !trigger.template_id) {
    console.log('[EmailJS] 트리거 비활성화 또는 미설정 — 발송 건너뜀:', triggerEvent);
    return;
  }

  initEmailJS(settings.public_key);
  if (!window.emailjs) return;

  try {
    await window.emailjs.send(settings.service_id, trigger.template_id, {
      to_email:   toEmail,
      to_name:    toName,
      brand_name: brandName,
      reply_to:   'noreply@gmbs.kr',
    });
    console.log('[EmailJS] 메일 발송 완료:', triggerEvent, '->', toEmail);
  } catch (err) {
    console.error('[EmailJS] 메일 발송 실패:', err);
  }
}

// 하위 호환 — 기존 호출부 그대로 사용 가능
export async function sendApplicationReceivedEmail(params) {
  return sendEmail('application_received', params);
}

export async function sendJoinReceivedEmail(params) {
  return sendEmail('join_received', params);
}
