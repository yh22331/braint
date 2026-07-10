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
