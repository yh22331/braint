// /js/supabase-client.js
// 브레인티 공통 Supabase 클라이언트 (ESM)
// 사용: import { supabase } from '/js/supabase-client.js'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
