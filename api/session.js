// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// /api/session.js - Vercel Edge Function
// 커플 세션 관리 (Supabase 직접 접근)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key (서버에서만)

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
      const code = Math.random().toString(36).substring(2,8).toUpperCase();
      const [row] = await supabase('/couple_sessions', {
        method: 'POST',
        body: JSON.stringify({
          session_code: code,
          host_data: hostData,
          status: 'waiting',
          expires_at: new Date(Date.now() + 24*60*60*1000).toISOString(),
        }),
      });
      return json({ sessionId: row.id, code, sessionCode: code });
    }

    // ── 세션 조회 (GET /api/session?action=get&code=XXXX)
    if(req.method==='GET' && action==='get') {
      const code = url.searchParams.get('code');
      if(!code) return json({ error: 'code 필요' }, 400);
      const [row] = await supabase(
        `/couple_sessions?session_code=eq.${code}&select=*`,
        { method: 'GET', prefer: '' }
      );
      if(!row) return json({ error: '세션 없음' }, 404);
      return json(row);
    }

    // ── 짝꿍 데이터 저장 (PATCH /api/session?action=join&id=UUID)
    if(req.method==='PATCH' && action==='join') {
      const id = url.searchParams.get('id');
      if(!id) return json({ error: 'id 필요' }, 400);
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
      if(!id) return json({ error: 'id 필요' }, 400);
      const [row] = await supabase(
        `/couple_sessions?id=eq.${id}&select=status,guest_data`,
        { method: 'GET', prefer: '' }
      );
      if(!row) return json({ error: '세션 없음' }, 404);
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
