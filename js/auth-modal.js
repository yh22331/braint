// /js/auth-modal.js
// 브레인티 로그인 모달 (ESM, JS로 동적 DOM 생성)
// 사용: import { openAuthModal, closeAuthModal } from '/js/auth-modal.js'
// 주의: 이 모듈을 쓰는 페이지는 <script type="module"> 필요

import { loginWithKakao } from '/js/auth.js';

// 닫기 정리에 필요한 참조를 모듈 스코프에 보관
let escHandler = null;   // document에 건 keydown 핸들러 (누수 방지용 참조)
let prevActive = null;   // 모달 열기 직전 포커스 요소 (닫을 때 복귀)

const SVG_NS = 'http://www.w3.org/2000/svg';

// 작은 DOM 헬퍼 (innerHTML 미사용 → XSS 위험 원천 차단)
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

// 카카오 말풍선 심볼: 공식 path, 형태/비율/색상(#000) 유지
function kakaoSymbol() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'braint-auth-symbol');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', '#000');
  path.setAttribute('d', 'M9 1C4.0294 1 0 4.13256 0 7.99756C0 10.4047 1.56522 12.5251 3.95139 13.7847L2.94757 17.4626C2.85879 17.7866 3.23085 18.0451 3.51461 17.857L7.92214 14.9462C8.27448 14.9802 8.63421 14.9988 9 14.9988C13.9706 14.9988 18 11.8662 18 8.00122C18 4.13622 13.9706 1 9 1Z');
  svg.appendChild(path);
  return svg;
}

// 스타일 1회 주입 (중복 가드)
function injectStyle() {
  if (document.getElementById('braint-auth-style')) return;
  const style = document.createElement('style');
  style.id = 'braint-auth-style';
  style.textContent = `
.braint-auth-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);padding:20px;box-sizing:border-box;}
.braint-auth-card{position:relative;width:100%;max-width:360px;background:#fff;border-radius:16px;padding:32px 24px 24px;box-shadow:0 10px 40px rgba(0,0,0,.2);box-sizing:border-box;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;}
.braint-auth-close{position:absolute;top:12px;right:12px;width:32px;height:32px;border:0;background:transparent;font-size:24px;line-height:1;color:#888;cursor:pointer;border-radius:8px;}
.braint-auth-close:hover{background:#f2f2f2;}
.braint-auth-title{margin:0 0 6px;font-size:20px;font-weight:700;color:#191919;}
.braint-auth-desc{margin:0 0 24px;font-size:14px;color:#888;}
.braint-auth-kakao{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;border:0;border-radius:12px;background:#FEE500;color:rgba(0,0,0,.85);font-size:16px;font-weight:600;cursor:pointer;}
.braint-auth-kakao:disabled{opacity:.6;cursor:default;}
.braint-auth-symbol{flex:none;}
.braint-auth-error{display:none;margin:12px 0 0;font-size:13px;color:#e03131;}
`;
  document.head.appendChild(style);
}

// 모달 열기
export function openAuthModal() {
  if (document.getElementById('braint-auth-modal')) return; // 중복 생성 방지
  injectStyle();
  prevActive = document.activeElement;

  const closeBtn = el('button', { type: 'button', class: 'braint-auth-close', 'aria-label': '닫기', text: '×' });
  const title = el('h2', { id: 'braint-auth-title', class: 'braint-auth-title', text: '로그인' });
  const desc = el('p', { class: 'braint-auth-desc', text: '간편하게 카카오로 시작하세요' });
  const kakaoLabel = el('span', { class: 'braint-auth-kakao-label', text: '카카오 로그인' });
  const kakaoBtn = el('button', { type: 'button', class: 'braint-auth-kakao' }, [kakaoSymbol(), kakaoLabel]);
  const errEl = el('p', { class: 'braint-auth-error', role: 'alert' });
  const card = el('div', { class: 'braint-auth-card' }, [closeBtn, title, desc, kakaoBtn, errEl]);
  const overlay = el('div', {
    id: 'braint-auth-modal', class: 'braint-auth-overlay',
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'braint-auth-title',
  }, [card]);
  document.body.appendChild(overlay);

  // 닫기: X 버튼 / 배경(오버레이 자체) 클릭
  closeBtn.addEventListener('click', closeAuthModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAuthModal(); });

  // 카카오 로그인: 클릭 즉시 로딩 표시, 실패 시 복구 + 에러
  kakaoBtn.addEventListener('click', async () => {
    kakaoBtn.disabled = true;
    kakaoLabel.textContent = '카카오로 이동 중...';
    errEl.style.display = 'none';
    const p = location.pathname;
    localStorage.setItem('braint-next', (p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\')) ? p : '/');
    const { error } = await loginWithKakao(); // 정상 흐름이면 곧 페이지 이탈
    if (error) {
      kakaoBtn.disabled = false;
      kakaoLabel.textContent = '카카오 로그인';
      errEl.textContent = '로그인을 시작하지 못했어요. 잠시 후 다시 시도해주세요.';
      errEl.style.display = 'block';
    }
  });

  // ESC로 닫기 (핸들러 참조 보관 → close 시 제거)
  escHandler = (e) => { if (e.key === 'Escape') closeAuthModal(); };
  document.addEventListener('keydown', escHandler);

  kakaoBtn.focus(); // 열 때 포커스 이동
}

// 모달 닫기 (노드 제거 + ESC 리스너 해제 + 포커스 복귀)
export function closeAuthModal() {
  const overlay = document.getElementById('braint-auth-modal');
  if (overlay) overlay.remove();
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
  if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
  prevActive = null;
}
