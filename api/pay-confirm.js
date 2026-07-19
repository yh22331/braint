// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// /api/pay-confirm.js - Vercel Edge Function
// 토스페이먼츠 결제 승인 + report_purchases/reports 기록 (Phase B-1)
// POST { paymentKey, orderId, amount, analysisPayload, survey }
// 응답: { reportId } (중복 승인 시 기존 reportId 재반환)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const config = { runtime: 'edge' };

import { generateReport } from './report.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key (서버에서만)
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY;   // 토스 시크릿 키 (서버에서만, 하드코딩 금지)

const PRICE = 990; // 서버 확정 금액 — 클라이언트 amount는 대조용으로만 사용
const ORDER_ID_RE = /^report_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // 'report_'+UUID (프론트 생성 규칙)
const PAYMENT_KEY_RE = /^[A-Za-z0-9_\-]{10,200}$/;

// ── session.js와 동일한 Supabase REST 헬퍼
async function supabase(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── 사용자 JWT 검증 → user 객체 (유효하지 않으면 null)
async function getUserFromJWT(token) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  } catch (e) { return null; }
}

// ── 보고서 생성 (Mock — report.js generateReport 재사용). payload 불량이어도 구매 기록은 지키도록 방어
function safeGenerateReport(payload) {
  try { return generateReport(payload || {}); }
  catch (e) { return { hooks: [], sections: [], _mock: true, _error: 'REPORT_GEN_FAILED' }; }
}

// ── reports 행 생성 (구매 기록 이후 단계 공용)
async function insertReport(purchaseId, userId, payload) {
  const [report] = await supabase('/reports', {
    method: 'POST',
    body: JSON.stringify({ purchase_id: purchaseId, user_id: userId, report_json: safeGenerateReport(payload) }),
  });
  return report;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!TOSS_SECRET_KEY) return json({ error: 'CONFIG', message: 'TOSS_SECRET_KEY 미설정' }, 500);

  try {
    const { paymentKey, orderId, amount, analysisPayload, survey } = await req.json();

    // 1. 입력 검증 — amount는 서버 상수와 대조 (클라이언트 값 신뢰 X)
    if (typeof paymentKey !== 'string' || !PAYMENT_KEY_RE.test(paymentKey)) return json({ error: 'BAD_PAYMENT_KEY' }, 400);
    if (typeof orderId !== 'string' || !ORDER_ID_RE.test(orderId)) return json({ error: 'BAD_ORDER_ID' }, 400);
    if (amount !== PRICE) return json({ error: 'BAD_AMOUNT', message: '결제 금액이 올바르지 않아요' }, 400);

    // 2. 사용자 인증 — Supabase JWT를 auth/v1/user로 검증해 user_id 추출
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'UNAUTHORIZED', message: '로그인이 필요해요' }, 401);
    const user = await getUserFromJWT(token);
    if (!user) return json({ error: 'UNAUTHORIZED', message: '로그인이 필요해요' }, 401);

    // 5. 멱등성 — 같은 orderId가 이미 처리됐으면 기존 reportId 반환 (새로고침 이중 승인 방지)
    const merged = { ...(analysisPayload || {}), survey: survey ?? null };
    const [existing] = await supabase(
      `/report_purchases?order_id=eq.${encodeURIComponent(orderId)}&select=id,user_id,analysis_payload`,
      { method: 'GET', prefer: '' }
    );
    if (existing) {
      if (existing.user_id !== user.id) return json({ error: 'FORBIDDEN' }, 403);
      const [rep] = await supabase(`/reports?purchase_id=eq.${existing.id}&select=id`, { method: 'GET', prefer: '' });
      if (rep) return json({ reportId: rep.id, duplicated: true });
      // 구매만 기록되고 보고서 생성이 누락된 재시도 케이스 → 여기서 생성해 자가 복구
      const report = await insertReport(existing.id, existing.user_id, existing.analysis_payload || merged);
      return json({ reportId: report.id, duplicated: true });
    }

    // 3. 토스 승인 API — 실패 시 아무것도 저장하지 않고 토스 에러 그대로 4xx 반환
    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TOSS_SECRET_KEY}:`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount: PRICE }),
    });
    const tossData = await tossRes.json();
    if (!tossRes.ok) {
      const status = tossRes.status >= 400 && tossRes.status < 500 ? tossRes.status : 400;
      return json({ error: tossData.code || 'TOSS_CONFIRM_FAILED', message: tossData.message || '결제 승인에 실패했어요' }, status);
    }

    // 4a. 구매 기록 (동시 이중 요청의 unique 충돌은 멱등 재조회로 처리)
    let purchase;
    try {
      [purchase] = await supabase('/report_purchases', {
        method: 'POST',
        body: JSON.stringify({
          user_id: user.id,
          analysis_payload: merged,
          order_id: orderId,
          payment_key: paymentKey,
          amount: PRICE,
          status: 'paid',
        }),
      });
    } catch (e) {
      if (!/duplicate|23505/i.test(e.message)) throw e;
      const [row] = await supabase(`/report_purchases?order_id=eq.${encodeURIComponent(orderId)}&select=id`, { method: 'GET', prefer: '' });
      const [rep] = row ? await supabase(`/reports?purchase_id=eq.${row.id}&select=id`, { method: 'GET', prefer: '' }) : [null];
      return json({ reportId: rep?.id ?? null, duplicated: true });
    }

    // 4b+4c. Mock 보고서 생성 → reports 기록
    const report = await insertReport(purchase.id, user.id, merged);

    // 4d
    return json({ reportId: report.id });
  } catch (e) {
    console.error('[PAY-CONFIRM]', e.message);
    return json({ error: 'SERVER_ERROR', message: '잠시 후 다시 시도해주세요' }, 500);
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}
