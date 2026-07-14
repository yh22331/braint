# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project shape

Braint (braint.net) is a Korean-language collection of personal-finance simulators. It is **not** a Node project — there is no `package.json`, no build step, no test framework, and no linter. The repo is deployed on Vercel as:

- Static HTML pages at the repo root (`index.html`, `bf-home/`, `housecheck/`, `couple/`, `bf-new/`, `admin/`). Each service is a single self-contained `index.html` (CSS + JS inlined). All UI text is Korean.
- Vercel Edge Functions in `api/` (`export const config = { runtime: 'edge' }`). These are reached as `/api/<filename-without-.js>`.

There is nothing to install, build, or run locally beyond `vercel dev` (or any static server for the HTML pages — the `/api/*` routes only work under Vercel). Don't add a `package.json`, bundler, or framework unless explicitly asked.

## Architecture: how a service is wired

Each service follows the same three-layer pattern:

1. **HTML page** (e.g. `housecheck/index.html`) — collects inputs, draws charts via Chart.js (CDN), handles share/Kakao SDK, and talks to two backends directly from the browser.
2. **Edge function for the simulation** — heavy math lives server-side so it can be tweaked without redeploying the HTML. The mapping is by service:
   - `bf-home/` → `POST /api/simulate-bf`
   - `housecheck/` → `POST /api/simulate-housecheck`
   - `couple/` → `POST /api/simulate` (single-person) and `POST /api/simulate-couple` (joint), plus `/api/session` for the host/guest pairing flow
3. **Supabase** — called directly from the browser using the anon key (hardcoded in each HTML, by design — it's the public anon key). Used for analytics counters, saving result rows, and (in the couple flow) the `couple_sessions` row that the host creates and the guest joins.

The Supabase **service-role** key is only used server-side in `api/session.js` via `process.env.SUPABASE_SERVICE_KEY` (with `SUPABASE_URL`). Never inline the service key into HTML, and never call the service-role REST endpoints from the browser.

### Supabase surface

Tables/RPCs the code expects to exist (verified by reading the code, not by inspecting the DB):

- `analyses` — one row per completed analysis (`service`, inputs, result). Inserted from the HTML pages and listed in `admin/`.
- `analytics` — daily counters per service. Bumped via `rpc('increment_analytics', { p_service, p_field })` where `p_field` is `total_analyses`, `total_shares`, or `total_payments`.
- `payments` — toss-payments rows; read by `admin/` and upserted from `bf-home/`.
- `couple_sessions` — host/guest pairing for the couple flow (`session_code`, `host_data`, `guest_data`, `status`, `expires_at`). Written by `api/session.js`.

The admin dashboard (`admin/index.html`) authenticates with Supabase Auth (`signInWithPassword`) and is purely a read view of those tables.

### Simulation math conventions (shared across `api/simulate-*.js`)

All money inputs are in **만원** (10,000 KRW). Several helpers are duplicated across files — keep them in sync if you change one:

- `calcTakehome(grossManwon)` — bracketed gross→net ratio, returns **monthly** net in 만원.
- `calcBabyTotal(initCostManwon)` — 26-year baby cost, 3% inflation, capped at 2,000만원/yr.
- The core month-by-month loop (`simulate` / `simulateBF` / `simCouple`) compounds assets at `(1 + investRate/100)^(1/12) - 1`, applies optional annual raise + a 10% promo bump every 5 years, subtracts living + loan + car-maintenance + baby-monthly, and stops when assets ≥ target.
- Region/size price table `PRICES` (`gangnam|seoul|gyeonggi|local` × `small|mid|big`) is duplicated in several files; if you change one, change all.

### Known stale file

`api/simulate-couple-v2.js` imports from `./_utils.js`, which does not exist in the repo. The active couple endpoint is `api/simulate-couple.js` (self-contained). Treat the `-v2` file as dead code unless the user asks to revive it (presumably by extracting `_utils.js`).

## Editing notes

- Each service HTML is large (60k–160k chars) with inlined CSS+JS. Use targeted edits rather than rewriting the file. Search by Korean section comments (`// ━━ ... ━━`) to locate regions quickly.
- When changing a simulation formula, update both the relevant `api/simulate-*.js` **and** any place in the HTML that displays a derived value (e.g. `monthlySave`, `savingRate`, `totalEventCost`) — the HTML often re-derives these for display.
- CORS headers are set per-handler (`Access-Control-Allow-Origin: *`). Preserve the `OPTIONS` short-circuit when adding a new edge route.
- Don't commit a `.env` file. The only server-side secrets are `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`, which must be set in the Vercel project, not in the repo.

## 작업 정책 (사용자 약속 — 반드시 준수)

### Git
- **자동 commit/push 절대 X** — 각 단계 사용자 OK 받고 실행
- `git add -A` 절대 X — 항상 파일명 콕 집어서 (`git add path/to/file`)
- git 명령어 묶어 실행 X — `git status`, `git add`, `git commit`를 `&&`로 연결하지 말 것
- 각 명령어 사용자 OK 받고 실행
- commit 메시지: 짧은 한국어 한 줄
- `Co-Authored-By: Claude` 라인 빼기
- push는 사용자가 직접 결정 (별도 터미널 또는 VSCode Source Control)

### 작업 단계
- 큰 작업은 Phase 분리 (Phase A-1, A-2, A-3...)
- 각 Phase 끝나면 멈춰서 보고
- 사용자 검증 후 다음 Phase
- 각 Phase 끝마다 commit 가능 (안전 지점)

### 분석 우선
- 코드 수정 전 항상 분석 단계
- 영향 범위 파악, 변경 라인 수 추정, 위험 평가
- 사용자 OK 후 코드 수정
- 추측으로 진행 절대 X

### 안 건드릴 것
- 현재 Phase 작업 대상 외 페이지/파일 수정 X
- 잘 작동하는 기능 무관한 리팩토링 X
- `api/` 폴더 함부로 수정 X (영향 큼)

### 보고 형식
- 변경 라인 수 + 핵심 변경 요약
- 검증 가이드 (구체적 체크리스트)
- "Phase N 완료, 다음 진행할까요?" 명시적 멈춤

### 사용자 컨디션
- 새 작업 시작 시 시간/컨디션 확인
- 한 번에 다 하려 욕심 부릴 때 단계 분리 권유
- 사고 위험 신호 시 멈춤 권유

## 다음 세션 할 일 (2026-07-11 작업 후)

### 최우선 — 대출 상환 시점 재검토
- 현재: 대출 상환이 집 구매 전부터 적용됨 (처음부터 받는 주식담보대출 모델)
- 확인 필요: "집 구매 후부터 상환 시작"이 사용자 직관에 더 맞는지 재검토
- 결정 사항: 대출 모델 자체(주식담보대출 vs 주택담보대출)를 어떤 걸로 할지부터 정할 것

### housecheck 반영 대기 목록 (작업 3 착수 시 일괄 반영)
- 대출 구간별 상한 (calcLoanAmount — 15억↓6억/25억↓4억/초과2억, 2026.7 규제)
- 육아비 신모델 (구간별 고정비: 0-5세 500만/6-11세 1000만/12-17세 2000만/18-21세 3000만)
  — housecheck는 구모델(3%복리·26년) 그대로 보존 중. `api/simulate-housecheck.js:62`가 자체 루프로
  `A.babyYears`(26) + `A.babyInflation` + `A.babyAnnualCapManwon`을 계속 참조하므로 이 상수들 삭제 금지
- 생활비 결혼 시 1.5배 + 연 2.5% 인플레이션 반영 (`calcLivingCost`)
- 인생이벤트 나이 오프셋 방식 (age+3/+5/+1)
- 차트 이벤트 마커 이모지 단순화
- 연도별 항목 breakdown 막대그래프 (슬라이더 연동)
- housecheck는 API를 안 쓰고 로컬 JS 자체 계산 (`housecheck/index.html`의 `simulateMonthly`) —
  `api/simulate-housecheck.js`는 아무도 fetch하지 않는 사실상 죽은 코드. 재디자인 시 API 통합도 함께 검토

### couple 화면 검증 필요
- `api/_utils.js` 공용 함수 중 **육아비 신모델**(`calcBabyTotal` / `getEventData`)이 couple에도 적용됨
  (`api/simulate.js`, `api/simulate-couple.js`가 이 함수들을 import). `simulate-couple.js:76`의
  월 육아비 평균은 `A.babyYearsNew`(22)로 나누도록 함께 수정함
- **`calcLivingCost`(결혼 1.5배 + 인플레)는 couple에 적용 안 됨** — bf-home 전용. couple/housecheck/simulate.js는
  기존 고정 생활비 유지 (의도된 분리)
- 실제 화면 열어서 정상 작동 확인 안 함, 다음 세션에 확인 필요

### 텍스트 수정 (가벼운 작업, 계속 밀림)
- 인스타스토리 공유화면 "Xalysis" → "BrainT", 상호명도 "브레인티(BrainT)"
- bf-home "내 연봉" → "남친 연봉" 표현 변경

### 완료된 것 (2026-07-11)
- DART 회사 목록 API + bf-home 연봉 자동입력 UI
- DART 평균연봉 남성 기준 + 기준연도 2025
- DART 임시 진단 로그([DBG]/[DART-DEBUG]) 제거
- 집 구매 후 자산 초기화 버그 수정 (`api/simulate-bf.js`에 `asset = 0` 누락돼 있던 것)
- 인생이벤트 나이 오프셋 변경 (`EVENT_AGES`를 절대나이 → 오프셋 의미로 통일, 참조 9곳 전부)
- 차트 이벤트 마커 이모지 단순화, 나이 라벨 중복 제거, 우측 축 타이틀 제거, 카드 패딩 축소
- 연도별 항목 breakdown 막대그래프 추가 (슬라이더 연동, `yearlyBreakdown` + `renderBreakdownChart`)
- 육아비 신모델 (구간별 고정비 + `startCost/500` 비율 스케일링) — 프론트/서버 동일 로직으로 통일
- 생활비 신모델 (결혼 1.5배 + 연 2.5% 인플레) — `calcLivingCost`, bf-home 전용

### 중복 로직 주의 (한쪽만 고치면 어긋남)
- 육아비: `api/_utils.js`의 `BABY_COST_BY_STAGE`/`babyAnnualByYear` ↔ `bf-home/index.html`의 `calcBabyByYear`
- 생활비: `api/_utils.js`의 `calcLivingCost` ↔ `bf-home/index.html`의 `calcLivingCost`
- bf-home은 API 실패 시 로컬 폴백(`simulateMonthly`)으로 계산하므로, 공식 변경 시 **API + 폴백 + `renderChart` 3곳** 모두 반영해야 함
- 월지출 차트/breakdown은 API 응답의 `monthlyExpense`를 쓰지 않고 `renderChart`가 항상 프론트에서 재계산함

## storageKey 불일치 버그 — 상태 업데이트 (2026-07-13)
- 원래 버그(홈 헤더 세션 미인식)는 인증이 js/auth.js + braint-auth 키로 일원화되면서
  코드 근거상 해소된 것으로 판단. 실제 브라우저 검증은 안 함(코드 분석만).
- 잔존 이슈(낮은 우선순위):
  - admin/index.html이 자체 인증 사용, 기본 키(sb-<ref>-auth-token)에 세션 저장 (일반 사용자와 무관)
  - bf-home/housecheck/admin/bf-new의 로컬 sb 클라이언트 4곳이 persistSession/detectSessionInUrl 옵션 미지정 (기본값 true) → 방어적으로 false 주는 게 안전
- 문제 재발 시(로그인했는데 헤더 인식 안 됨 등) 이 메모부터 확인할 것

## 다음 세션 — 커플계산기 개편 (2026-07-14 분석 완료)
- Phase 1 (최우선): 계산 로직 bf-home 동기화 — 대출(집값40%+구간상한+구매후상환), 생활비(결혼1.5x+인플레2.5%), 자산리셋, 육아비 확인. 서버(simulate-couple.js)+프론트 양쪽
- Phase 2: 보안 H-1(세션코드 crypto 고엔트로피화)·H-2(만료 검사) — 링크 공유 기능의 전제
- Phase 3: bf-home 보고서 구조 이식 (훅→설문→블러→990원), 커플 관점 문구로
- 잔여: bf-home 이모지 SVG 전체 확산 (보고서 카드 시범 스타일 확정 후)
