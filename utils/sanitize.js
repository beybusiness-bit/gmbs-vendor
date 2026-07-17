/** HTML 이스케이프 — innerHTML 주입 전 반드시 사용 */
export function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** URL이 http/https 스킴인지 검증. 아니면 빈 문자열 반환 */
export function safeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return url;
  } catch {
    return '';
  }
}
