// ── EmailJS 설정 ──
// EmailJS 콘솔(https://www.emailjs.com/)에서 아래 값을 확인해서 채워주세요.
// Email Services → 서비스 ID 확인
// Email Templates → 각 템플릿 ID 확인
// Account → Public Key 확인

const EMAILJS_CONFIG = {
  publicKey:  'YOUR_EMAILJS_PUBLIC_KEY',    // EmailJS > Account > Public Key
  serviceId:  'YOUR_EMAILJS_SERVICE_ID',    // EmailJS > Email Services > Service ID
  templates: {
    applicationReceived: 'YOUR_TEMPLATE_APP_RECEIVED',  // 신청 접수 확인 메일
    joinReceived:        'YOUR_TEMPLATE_JOIN_RECEIVED', // 합류 신청 접수 확인 메일
  },
};

let _initialized = false;

function init() {
  if (_initialized) return;
  if (!window.emailjs) {
    console.warn('[EmailJS] 라이브러리가 로드되지 않았습니다. index.html에 CDN 스크립트가 있는지 확인하세요.');
    return;
  }
  window.emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
  _initialized = true;
}

// 새 브랜드 등록 신청 접수 확인 메일
export async function sendApplicationReceivedEmail({ toEmail, toName, brandName }) {
  init();
  if (!window.emailjs) return;
  if (EMAILJS_CONFIG.publicKey === 'YOUR_EMAILJS_PUBLIC_KEY') {
    console.warn('[EmailJS] 설정값이 아직 채워지지 않았습니다. emailjs-config.js를 확인하세요.');
    return;
  }
  try {
    await window.emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templates.applicationReceived, {
      to_email: toEmail,
      to_name:  toName,
      brand_name: brandName,
      reply_to: 'noreply@gmbs.kr',
    });
    console.log('[EmailJS] 신청 접수 확인 메일 발송 완료');
  } catch (err) {
    console.error('[EmailJS] 메일 발송 실패:', err);
  }
}

// 기존 브랜드 합류 신청 접수 확인 메일
export async function sendJoinReceivedEmail({ toEmail, toName, brandName }) {
  init();
  if (!window.emailjs) return;
  if (EMAILJS_CONFIG.publicKey === 'YOUR_EMAILJS_PUBLIC_KEY') {
    console.warn('[EmailJS] 설정값이 아직 채워지지 않았습니다. emailjs-config.js를 확인하세요.');
    return;
  }
  try {
    await window.emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templates.joinReceived, {
      to_email:   toEmail,
      to_name:    toName,
      brand_name: brandName,
      reply_to:   'noreply@gmbs.kr',
    });
    console.log('[EmailJS] 합류 신청 접수 확인 메일 발송 완료');
  } catch (err) {
    console.error('[EmailJS] 메일 발송 실패:', err);
  }
}
