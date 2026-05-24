// /js/auth.js
// 브레인티 공통 인증 헬퍼 (ESM)
// 사용: import { loginWithKakao, logout, getCurrentUser, onAuthChange } from '/js/auth.js'

import { supabase } from '/js/supabase-client.js';

// 카카오 OAuth 로그인 시작 (성공 시 브라우저가 카카오로 이동)
export async function loginWithKakao() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: {
      redirectTo: window.location.origin + '/auth/callback',
    },
  });
  if (error) console.error('[auth] kakao login error:', error.message);
  return { error };
}

// 로그아웃
export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('[auth] logout error:', error.message);
  return { error };
}

// 현재 로그인 사용자 (서버 검증). 없으면 null
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// 인증 상태 변화 구독. 반환된 subscription으로 .unsubscribe() 가능
export function onAuthChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (event, session) => callback(event, session)
  );
  return subscription;
}
