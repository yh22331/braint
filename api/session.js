// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// /api/session.js - Vercel Edge Function
// 커플 세션 관리 (Supabase 직접 접근)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key (서버에서만)

// ── 세션코드: CSPRNG 12자, 혼동 문자(0/O/1/l/I) 제외 57자 문자셋 ≈ 70비트
//    Edge 런타임에는 Node crypto 모듈이 없어 Web Crypto(crypto.getRandomValues) 사용
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const CODE_LEN = 12;
const CODE_RE = /^[A-Za-z0-9]{6,12}$/; // 6자리 = 기존 발급 코드 호환
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateCode() {
  const out = [];
  while (out.length < CODE_LEN) {
    const buf = new Uint8Array(CODE_LEN * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (out.length >= CODE_LEN) break;
      if (b < 228) out.push(CODE_CHARS[b % CODE_CHARS.length]); // 228 = 57×4, modulo bias 제거
    }
  }
  return out.join('');
}

function isExpired(row) {
  return row.expires_at && new Date(row.expires_at) < new Date();
}

async function supabase(path, options={}) {
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
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null, { headers: corsHeaders() });

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    // ── 세션 생성 (POST /api/session?action=create)
    if(req.method==='POST' && action==='create') {
      const { hostData } = await req.json();
      // 코드 충돌(unique 위반) 시 새 코드로 재시도, 최대 3회
      let row, code, lastErr;
      for(let attempt = 0; attempt < 3 && !row; attempt++) {
        code = generateCode();
        try {
          [row] = await supabase('/couple_sessions', {
            method: 'POST',
            body: JSON.stringify({
              session_code: code,
              host_data: hostData,
              status: 'waiting',
              expires_at: new Date(Date.now() + 24*60*60*1000).toISOString(),
            }),
          });
        } catch(e) {
          lastErr = e;
          if(!/duplicate|23505/i.test(e.message)) throw e; // 충돌 외 오류는 즉시 전파
        }
      }
      if(!row) throw lastErr || new Error('세션 생성 실패');
      return json({ sessionId: row.id, code, sessionCode: code });
    }

    // ── 세션 조회 (GET /api/session?action=get&code=XXXX)
    if(req.method==='GET' && action==='get') {
      const code = url.searchParams.get('code');
      if(!code || !CODE_RE.test(code)) return json({ error: '잘못된 code' }, 400); // 영숫자 6~12자만
      const [row] = await supabase(
        `/couple_sessions?session_code=eq.${code}&select=*`,
        { method: 'GET', prefer: '' }
      );
      if(!row) return json({ error: '세션 없음' }, 404);
      if(isExpired(row)) return json({ error: '세션 만료' }, 410);
      return json(row);
    }

    // ── 짝꿍 데이터 저장 (PATCH /api/session?action=join&id=UUID)
    if(req.method==='PATCH' && action==='join') {
      const id = url.searchParams.get('id');
      if(!id || !UUID_RE.test(id)) return json({ error: '잘못된 id' }, 400);
      const { guestData } = await req.json();
      const [row] = await supabase(
        `/couple_sessions?id=eq.${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ guest_data: guestData, status: 'joined' }),
        }
      );
      return json(row);
    }

    // ── 폴링: 짝꿍 입력 여부 확인 (GET /api/session?action=poll&id=UUID)
    if(req.method==='GET' && action==='poll') {
      const id = url.searchParams.get('id');
      if(!id || !UUID_RE.test(id)) return json({ error: '잘못된 id' }, 400);
      const [row] = await supabase(
        `/couple_sessions?id=eq.${id}&select=status,guest_data,expires_at`,
        { method: 'GET', prefer: '' }
      );
      if(!row) return json({ error: '세션 없음' }, 404);
      if(isExpired(row)) return json({ error: '세션 만료' }, 410);
      return json({ status: row.status, hasGuest: row.status==='joined', guestData: row.guest_data });
    }

    return json({ error: '알 수 없는 action' }, 400);
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}
function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}
