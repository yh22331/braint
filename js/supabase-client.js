// /js/supabase-client.js
// 브레인티 공통 Supabase 클라이언트 (ESM)
// 사용: import { supabase } from '/js/supabase-client.js'

// jsdelivr +esm 사용 (기존 esm.sh가 일부 환경에서 pending으로 매달리는 문제 → 이 사이트가 이미 UMD 태그로 쓰고 있는 jsdelivr로 통일)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://zvgcekyknwoffffxgoib.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_WsT4YAIa6mGShxJH-OSAjg_MXV_pa3N';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'braint-auth',
    }
  }
);
