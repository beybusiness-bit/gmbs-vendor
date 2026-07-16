## GMBS 입점 브랜드 포털 (vendor.gmbs.kr) — CLAUDE.md

### 앱 기본 정보

```javascript
const AUTH = {
  // 이 앱은 admin과 달리 고정 이메일 목록(ALLOWED_EMAILS)을 쓰지 않는다.
  // 로그인 가능 여부는 Firestore의 vendor_accounts 컬렉션(브랜드회원) 또는
  // 자체 회원가입(일반회원)으로 동적으로 결정된다. 상세 로직은
  // "개발 기획 내용 누적 > 로그인·계정 생성 로직" 참고.
  FIREBASE_CONFIG: {
    apiKey: 'TBD',        // admin과 동일한 Firebase 프로젝트 사용 — gmbs-admin CLAUDE.md에 실제 값이 있으면 그대로 복사
    authDomain: 'TBD',
    projectId: 'TBD',
    storageBucket: 'TBD',
    messagingSenderId: 'TBD',
    appId: 'TBD',
  },
};
const REPO = {
  GITHUB_URL: 'https://github.com/beybusiness-bit/gmbs-vendor',
  LOCAL_PATH: '~/projects/gmbs-vendor',
  DEPLOY_METHOD: 'vercel',
  LIVE_URL: 'https://vendor.gmbs.kr',
};
```

### 앱 아키텍처 요약
- **앱 성격**: GMBS에 입점한(또는 입점 신청 중인) 브랜드가 자기 브랜드 정보·상품·계약·정산을 직접 관리하는 포털. gmbs-admin, 향후 gmbs-functions와 같은 Firebase 프로젝트를 공유하는 3개 프로젝트 중 하나.
- **UI 구조**: 사이드바 메뉴, 로그인 상태에 따라 메뉴 구성이 다름 — 일반회원(입점 신청만 가능) / 브랜드회원(전체 관리 메뉴)
- **로그인**: 필수. Google OAuth + 동적 인증(vendor_accounts 컬렉션 매핑). 고정 이메일 목록 없음.
- **사용자 역할**: 일반회원 / 브랜드회원 (관리자는 이 앱이 아니라 gmbs-admin에서 별도 로그인)
- **외부 연동**: EmailJS (알림 메일 발송, FCM 대신 채택)
- **PWA**: 미적용
- **FCM 알림**: 미적용 (EmailJS 이메일 알림으로 대체)
- **기존 도구 마이그레이션**: 없음 — 신규 구축
- **⚠️ 공유 설정 주의**: 이 앱은 gmbs-admin과 같은 Firebase(=Google Cloud) 프로젝트를 쓴다. 이 프로젝트의 **OAuth 동의 화면을 반드시 "프로덕션(게시됨)" 상태로 전환**해야 한다. "테스트" 상태로 두면 사전에 등록한 테스트 사용자만 로그인 가능해서, 일반 입점 신청자가 구글 로그인을 못 하는 문제가 생긴다. (Google Cloud Console → API 및 서비스 → OAuth 동의 화면 → 게시 상태 확인)

---

### ⚠️ 비전문가 사용자 안내 원칙

이 앱의 주 사용자는 개발·코딩 배경이 없는 비전문가다. Claude Code는 아래 원칙을 항상 지킨다:

1. **모든 작업에 자세한 설명 동반**: 코드를 수정했으면 "무엇을 왜 바꿨는지"를 평이한 말로 함께 설명한다. 전문 용어는 괄호 안에 간단한 풀이를 덧붙인다.
2. **단계별 안내**: 사용자가 직접 해야 할 일(파일 복사, 설정 입력 등)은 번호를 매긴 단계로 안내한다.
3. **오류 발생 시**: 에러 메시지를 그대로 던지지 말고 "무슨 문제인지, 어떻게 해결하면 되는지"를 풀어서 설명한다.
4. **확인 요청**: 사용자가 직접 조작해야 하는 단계가 있으면, 완료 여부를 확인 후 다음으로 넘어간다.

---

### 🔁 세션 과부하 감지 및 전환 권유

아래 상황 중 하나라도 해당되면 사용자에게 **세션 변경을 먼저 권유**한다:

- 현재 세션에서 주고받은 메시지가 많아져 맥락을 정확히 추적하기 어려울 때
- 같은 오류가 3회 이상 반복되어 해결이 안 될 때
- 여러 기능을 동시에 수정하다가 흐름이 얽혔을 때
- 세션 응답이 느려지거나 이전 내용을 잘못 참조하는 패턴이 보일 때

권유 멘트 예시:
> "지금 세션이 꽤 길어져서 맥락이 뒤섞일 수 있어요. 세션을 새로 시작하는 게 더 빠르고 정확할 것 같습니다.
> 아래 내용을 복사해서 새 세션에 붙여넣으면 바로 이어서 작업할 수 있어요:
> ---
> [다음 세션 시작 프롬프트 출력]
> ---"

---

### 세션 운영 원칙

- **기본 단위**: 개발 단계 하나 = Claude Code 세션 하나
- **세션 전환 기준**: 코드 300줄 초과로 수정이 복잡해질 때 / 새로운 기능 영역 진입 시 / 오류 반복으로 맥락이 꼬였을 때 → `/exit` 후 같은 폴더에서 `claude` 재실행
- **CLAUDE.md 갱신**: 매 세션 마무리 시 Claude Code가 이 파일을 직접 수정한다. 별도 복붙 불필요.
- **Vercel 배포 횟수 절약**: 아래 "Step 3" 및 "수정 후 배포" 섹션의 Vercel 규칙을 반드시 지킨다.

---

### 🔄 즉시 갱신 원칙

CLAUDE.md 갱신은 세션 마무리 시점만 기다리지 않는다. 아래 경우에는 **그 순간 바로** CLAUDE.md를 수정하고 커밋한다(push는 Vercel 규칙에 따라 세션 마무리 시 1번, 아래 참고).

- 사용자와 새로운 기획·설계 결정이 확정될 때 (스키마 변경, 화면 흐름 변경, 기능 범위 변경 등)
- 기존에 합의했던 내용을 뒤집는 결정이 나올 때 — 이전 내용은 취소선으로 남기고 `[변경: 이유]` 주석 추가
- admin 쪽에 추가 개발이 필요한 사항을 발견했을 때 (아래 "🔗 admin 연계 필요사항" 섹션에 즉시 기록)
- 세션이 언제 어떻게 끝날지 예측할 수 없으므로, "나중에 한꺼번에 정리하자"고 미루지 않는다

이 갱신은 "개발 기획 내용 누적", "DB 구조", "🔗 admin 연계 필요사항" 섹션에 즉시 반영하며, 별도 커밋(`docs: 기획 변경사항 반영`)으로 남긴다.

---

### 🔗 admin 연계 필요사항 관리 원칙

vendor 개발 중 "이 기능이 되려면 admin 쪽에도 필드·화면이 추가되어야 한다"는 게 발견되면:

1. 즉시 아래 "admin 확장 요청 목록"에 항목을 추가한다 (무엇이 필요한지, 왜 필요한지, 관련 Firestore 필드·컬렉션까지 구체적으로 적는다).
2. 사용자에게 "이건 admin 쪽 개발이 필요한 부분이라 목록에 적어뒀습니다"라고 짧게 알린다. 지금 당장 gmbs-admin 저장소를 건드리지 않는다 (이 세션은 gmbs-admin 코드에 접근하지 않는다).
3. 사용자가 "admin 요청사항 정리해줘" 등을 요청하면, 그 시점까지 쌓인 목록을 하나의 독립된 마크다운 파일로 정리해서 출력한다. 이 파일은 사용자가 복사해서 gmbs-admin Claude Code 세션에 붙여넣을 수 있는 형태로 작성한다(배경 설명 + 필요한 스키마 변경 + 필요한 화면·워크플로우 변경을 구체적으로).
4. 정리해서 넘긴 항목은 "요청 전달됨"으로 표시해두고 목록에서 지우지 않는다 (실제 admin 쪽 반영 여부를 나중에 추적할 수 있게).

**현재까지의 admin 확장 요청 목록** (상태 표기: 미전달 / 전달됨):

1. [미전달] admin에 "입점 신청함 / 합류 신청함" 화면 추가 — `brand_applications`(신규 브랜드 등록 신청)와 `brand_join_requests`(기존 브랜드 합류 신청) 두 컬렉션을 조회하는 심사 화면. 승인 시 각각 다음을 자동 생성:
   - `brand_applications` 승인 → `brands` 문서 + `brands/{brandId}/persons/{personId}` 문서 + `vendor_accounts/{login_google_email}`(status=연결됨, uid는 신청자 uid로 즉시 채움) 생성
   - `brand_join_requests` 승인 → 기존 `brands/{target_brand_id}/persons/{personId}` 문서 추가 + `vendor_accounts/{login_google_email}`(연결됨) 생성
   - 거절 시 상태(거절) + 사유 기록
   - 심사 화면에서 `applicant_contact_email` 필드도 표시 (이번 세션에서 신청 데이터에 추가됨)
2. [미전달] 담당자(Person) 등록 폼에 "연락용 이메일(contact_email)"과 "vendor 로그인용 구글 이메일(login_google_email)"을 별도 필드로 분리해서 입력받고, `login_google_email` 값 기준으로 `vendor_accounts` 문서를 생성·갱신하도록 admin 로직 수정
3. [미전달] admin의 승인/거절 처리 버튼에 EmailJS 발송 로직 추가 (신청자에게 결과 통보 메일). EmailJS 설정은 admin.gmbs.kr → 이메일 설정 메뉴에서 관리.
4. [미전달] 담당자 등록 시 이메일(특히 로그인용 구글 이메일) 오타 방지를 위한 확인 입력(더블 체크) 절차 권장
5. [완료됨] Google Cloud OAuth 동의 화면을 "프로덕션(게시됨)" 상태로 전환 — 완료
6. [미전달] Firestore 보안 규칙에 `email_configs` 컬렉션 write 권한 추가 필요 (현재 admin 이메일 중 baekeun0@gmail.com만 catch-all로 접근 가능, itsbeybusiness@gmail.com는 접근 불가) — admin 콘솔 Firestore 규칙에 반영 필요

---

### 🟢 세션 시작 시 자동 수행

첫 메시지를 받으면 사용자 요청 처리 전에 **자동으로** 아래를 수행한다.

#### Step 1. 실행 환경 판별 → 적절한 분기

```
현재 위치가 /home/user 같은 임시 클라우드 경로인가? (Remote 세션 특징: 매번 깨끗한 VM에서 시작, 레포는 이미 clone된 상태)
  ├─ 예 (Remote 세션) → Step 1-R
  └─ 아니오 (Local 세션: 내 컴퓨터) → Step 1-L
```

#### Step 1-R. Remote 세션 (데스크톱 앱의 ☁️ 환경) — 이 프로젝트의 주 사용 환경

- 시스템이 자동으로 `claude/...` feature 브랜치를 만들고 그 브랜치 위에서 작업을 시작한다. `git checkout main`으로 이동하지 않는다.
- **🔑 PAT 확인 (필수):**
  ```bash
  git remote -v
  ```
  출력된 origin URL에 `ghp_` 또는 `github_pat_`로 시작하는 토큰이 포함되어 있으면 OK.
  토큰이 없다면 → 아래 "🔑 PAT 설정 프로토콜" 섹션을 먼저 수행한다.
- **origin/main 동기화** (세션 시작 시점에 아직 아무 작업도 안 했으면):
  ```bash
  git fetch origin main
  git log HEAD..origin/main --oneline   # 결과 있으면 → 리셋
  git reset --hard origin/main
  ```
- ⚠️ 이 세션 안에서 생긴 변경은 **push 전까지 VM 안에만 존재**. 세션 종료 시 VM이 사라지면 증발. 중간 커밋과 종료 시 push를 엄격히 지킨다.

#### Step 1-L. Local 세션 (내 컴퓨터의 터미널 또는 앱 Local 환경)

```
LOCAL_PATH 폴더가 존재하는가?
  ├─ 없음 (이 기기에서 처음) → 클론
  │     cd ~/projects
  │     git clone https://github.com/beybusiness-bit/gmbs-vendor
  │     cd gmbs-vendor
  │     → "이 기기에 처음 세팅했습니다. 클론 완료." 안내
  │
  └─ 있음 (기존 폴더) → pull
        cd ~/projects/gmbs-vendor
        git pull origin main
        충돌 발생 시: 사용자가 직접 마커(<<<<<<) 손대지 않게 안내하고
        Claude가 직접 분석·해결.
```

#### Step 2. 현황 요약 보고

```
📋 현재 상황 요약
- 환경: [Remote ☁️ / Local 💻]
- 완료: [완료된 단계 목록 ✅]
- 진행중: [현재 단계 🔄] — [어디까지 됐는지]
- 남은 것: [예정 단계 목록 🔲]
- 이번 세션 시작점: [다음 할 작업]
```

단, 세션이 이미 진행 중이고 사용자가 단순 작업 요청만 하는 경우엔 매번 pull·보고 반복하지 않음.

#### Step 3. 배포 방식: Vercel — 배포 횟수 절약 필수

> 🔴 Vercel Free 플랜은 **하루 배포 100회 한도**가 있다.
> feature 브랜치 push 1회 + PR 머지 1회 = 최소 2회 소모.
> 세션 중 push를 잘게 나누면 금방 소진된다.
> **한 세션 = 커밋 여러 개 + push 1번 + PR 1개** 원칙을 반드시 지킨다.

**Remote(☁️) 세션에서:**
- 시스템이 자동으로 `claude/...` feature 브랜치를 만들고, 그 브랜치 위에서 작업한다.
- `git push origin main`은 HTTP 403으로 차단된다 — 절대 시도하지 않는다.
- **세션 중에는 커밋만** 쌓는다. push하지 않는다.
- **세션 마무리 시 딱 1번**: push → PR 생성 → 머지 순서로 진행한다.

**Local(💻) 세션에서:**
- PAT 인증이 있으면 main 직접 push가 가능할 수 있다.
- 단, Vercel 배포 횟수를 절약하려면 **작업을 묶어서 한 번에 push**한다.
- 안 되면 Remote와 동일하게 PR 머지 방식으로 진행한다.

| 시점 | 할 것 | Vercel 배포 소모 |
|------|-------|----------------|
| 세션 중 | `git commit` (push ❌) | 0회 |
| 세션 마무리 | `git push -u origin <feature브랜치>` | 1회 (Preview) |
| 세션 마무리 | `mcp__github__create_pull_request` + `mcp__github__merge_pull_request` | 1회 (Production) |
| **합계** | | **2회/세션** |

**⚠️ 절대 하지 말 것:**
- `git checkout main && git push origin main` → 403 거부됨
- 세션 중간에 PR 머지 → Vercel 배포 한도 소진 주범
- 사용자가 "확인해봐", "라이브로 보고 싶어"라고 해도 → "세션 끝에 push+머지할게요"라고 안내

**제한 초과 시 대처:**
- 오늘 안에 꼭 배포해야 한다면: Vercel 대시보드에서 Pro 업그레이드(월 $20) → Promote to Production → 필요 없으면 다시 Free로 다운그레이드
- 급하지 않다면: 24시간 기다리면 자동 리셋 → Vercel 대시보드에서 최신 Preview 배포의 "Promote to Production" 클릭

---

### 📌 세션 시작 방법 (사용자 참고용)

**방법 A. Claude 데스크톱 앱 Code 탭 — Remote(☁️) 환경 (권장, 이 프로젝트의 주 사용 방식)** ⭐
1. 앱 좌측 사이드바에서 Code 탭 열기
2. `+ 새 세션` 클릭
3. 환경 드롭다운에서 **Remote(☁️)** 선택
4. `+ 레포 선택` 클릭 → `beybusiness-bit/gmbs-vendor` 저장소 선택
5. 작업 내용 입력하고 시작

**방법 B. Claude 데스크톱 앱 Code 탭 — Local(💻) 환경**
1. Code 탭 → `+ 새 세션`
2. 환경: **Local(💻)** 선택
3. 프로젝트 폴더 선택 (`~/projects/gmbs-vendor`) — 없으면 터미널에서 `cd ~/projects && git clone https://github.com/beybusiness-bit/gmbs-vendor` 먼저 실행

**방법 C. 터미널 (전통 방식)**
```bash
cd ~/projects/gmbs-vendor
claude
```

---

### 🔴 세션 종료 시 자동 수행

사용자가 "끝났어" / "마무리할게" / "다른 기기 갈게" / "세션 끝내자" 등을 말하면:

1. `git status` — 변경된 파일 목록 확인
2. 변경 목록 + 제안 커밋 메시지를 사용자에게 보여주고 승인 받기
3. 승인 후 (Remote ☁️ 세션):
   ```bash
   git add [변경 파일 명시] && git commit -m "..."
   git push -u origin <현재 feature 브랜치>   # 세션 마무리 시 처음이자 마지막 push
   ```
   그 다음:
   ```
   mcp__github__create_pull_request  (head: 현재 브랜치, base: main)
   ```
   → 사용자에게 PR URL 보여주고 확인
   ```
   mcp__github__merge_pull_request  (PR 번호, method: merge)
   git fetch origin main && git reset --hard origin/main  (로컬 동기화)
   ```
   - 완료 후: "✅ push + PR 머지 완료. Vercel 배포 2회 소모. 반영까지 ~1분. Cmd+Shift+R 해주세요."
   - ⚠️ PR 머지는 세션당 딱 1번, 이 시점에만 한다.

   **Local(💻) 세션**: main 직접 push 시도. 403이면 feature 브랜치 push 후 위와 동일하게 PR 머지.

   - ⚠️ 어느 방식이든 `git add .` / `git add -A` 금지 — 변경 파일을 명시적으로 지정
   - ⚠️ push 성공 여부 반드시 확인. "아마 됐을 거예요" 식으로 얼버무리지 말 것
   - **403 오류가 나면** → "🔑 PAT 설정 프로토콜" 섹션으로 이동
4. CLAUDE.md 직접 갱신:
   - 완료된 단계 ✅ 표시
   - 다음 세션 시작점 업데이트
   - DB 구조 변경 사항 반영 (있을 경우)
   - **기획·구현 내용 누적 보존**: 이번 세션에서 합의한 기획·구현 결정 사항을 "개발 기획 내용 누적"에 추가. 기존 내용은 절대 삭제·축약하지 않음.
   - **admin 연계 필요사항이 새로 생겼다면 "🔗 admin 연계 필요사항" 목록에 추가**
   - 가이드 문서 참고 내용 누적에 이번 세션 내용 추가
5. CLAUDE.md 갱신분도 함께 커밋 (별도 커밋 권장: `docs: CLAUDE.md 진행 상황 갱신`), 위 push+PR 절차에 포함해서 반영
6. **🧪 테스트 체크리스트 출력** — 이번 세션에서 변경한 기능별로 사용자가 직접 확인할 항목을 번호 목록으로 출력한다.
7. **GitHub PAT 출력**: `git remote -v` 출력에서 `ghp_...` 토큰 부분을 그대로 복사해서 안내한다 (설정 안 돼있으면 생략).
8. 다음 세션 시작 프롬프트 출력:

```
환경 확인: Remote(☁️)인지 Local(💻)인지 먼저 판별해줘.
배포 방식: vercel — Remote라면 시스템이 자동 생성한 feature 브랜치(claude/...)에서 작업하고,
배포 시점에 mcp__github__create_pull_request + mcp__github__merge_pull_request 로 main에 머지하는 방식이야.
git push origin main 직접 시도는 403으로 거부되니까 절대 시도하지 말아줘.

PAT: [현재 PAT, 없으면 생략]

이번 세션 작업: [N단계] [기능명] — [어디서부터 시작할지 구체적으로]
이전 세션에서 [완료 내용]까지 완성했고, 이번엔 [다음 작업]을 구현하면 돼.
```

---

### 🔑 PAT(Personal Access Token) 설정 프로토콜

**왜 필요한가:**
Claude Code Remote(☁️) 환경에서는 로컬 프록시가 git 요청을 중계하는데, 이 프록시는 **쓰기 권한이 없어 push를 차단**한다. 그래서 토큰 없이 `git push`를 시도하면 항상 403 오류가 난다.

**실패 시점(push 403) 또는 세션 시작 시점(Step 1-R)에 PAT이 설정돼 있지 않으면 아래를 수행한다:**

1. 사용자에게 토큰 요청:
   > "Remote 환경에서 GitHub push를 하려면 Personal Access Token이 필요합니다.
   >  GitHub → Settings → Developer settings → Personal access tokens (classic)
   >  → Generate new token → Scope: **`repo` 하나만** 체크 → 토큰 생성
   >  → `ghp_…`로 시작하는 토큰을 붙여넣어 주세요."
   (gmbs-admin에서 이미 발급받은 토큰이 있다면 같은 계정이므로 재사용 가능)

2. 토큰을 받으면 remote URL 재설정:
   ```bash
   git remote set-url origin https://ghp_TOKEN@github.com/beybusiness-bit/gmbs-vendor.git
   ```

3. 동작 확인:
   ```bash
   git remote -v
   ```

4. 성공 시 안내:
   > "✅ PAT 설정 완료. 이후 모든 세션에서 별도 설정 없이 push 가능합니다."

**⚠️ PAT 관련 보안 수칙:**
- 토큰은 **절대 CLAUDE.md, 코드, 커밋 메시지**에 남기지 않는다.
- `.git/config`에 들어가는 것은 허용(해당 파일은 `.git/` 안에 있어 .gitignore로 제외됨).
- 세션 종료 시 PAT 출력은 **사용자 편의용**으로만 사용. 코드나 커밋에는 절대 포함 금지.

---

### ⚠️ Vercel + Remote 세션 조합 시 추가 주의사항

- **브랜치**: 시스템이 자동으로 `claude/...` feature 브랜치를 생성한다. 이 브랜치에서만 작업한다. `git checkout main`으로 이동하지 않는다.
- **origin/main 동기화**: 세션 시작 시점에 아직 아무 작업도 안 했으면 위 "Step 1-R" 절차로 리셋한다.
- **mid-session 머지 금지**: 세션 중간에 PR을 만들고 머지하면 Vercel 배포 한도가 빠르게 소진된다. 머지는 세션 마무리 시 딱 1번만.

---

### 🔵 수정 후 배포 — 세션 중 커밋만, 마무리 시 push + PR 머지

> 🔴 세션 중 push를 하면 Vercel Preview 배포 1회가 소모된다.
> 세션 마무리 전까지는 **절대 push하지 않는다.** 커밋만 쌓는다.

- 수정 요청 → 코드 수정 → `git add [파일] && git commit -m "..."` (push는 나중에)
- 사용자가 "라이브로 보고 싶어", "확인해봐" 등을 말해도 → "세션 마무리 시에 push+머지할게요. 그때 Vercel에 반영됩니다."라고 안내
- 세션 마무리 시 → 위 "🔴 세션 종료 시 자동 수행" 절차를 따름

---

### 🟡 작업 중간에 기기 이동 또는 환경 전환할 때

사용자가 "덜 끝났는데 다른 기기 가야 돼", "세션 잠깐 끊고 다른 데서 이어서" 등을 말하면:

1. 현재 변경사항 확인 → WIP 커밋 생성 후 **현재 feature 브랜치**에 push (main에 push하지 않음):
   ```bash
   git commit -am "WIP: [간단 설명]"
   git push -u origin <현재 feature 브랜치>
   ```
2. "⚠️ WIP 상태로 feature 브랜치에 push 완료. 아직 main에 머지된 건 아니라 Vercel 프로덕션에는 반영 안 됐지만, 다음 세션에서 이어서 작업 가능합니다" 안내
   (이 push는 Preview 배포 1회를 소모하지만, main 머지 전까지는 프로덕션에 영향 없음)

---

### Phase 2: 개발 진행 프로토콜

#### 코드 작업 원칙

```javascript
// ① today() — 반드시 로컬 날짜 기준 (toISOString() UTC 방식 금지)
const today = () => {
  const d = new Date();
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
};
// ② 이메일은 소문자로 정규화 후 vendor_accounts 문서 ID로 사용 (대소문자 불일치로 매칭 실패 방지)
// ③ 모든 신청·승인 관련 상태값은 문자열 상수로 관리 (오타 방지를 위해 코드 상단에 상수 선언)
```

**절대 금지:** script 안 백틱 중첩 / script 안 `&` `<` `>` `"` 직접 삽입 / `innerHTML` null 체크 생략 / `toISOString()` UTC 날짜

**매 작업 후 필수:** 문법 오류 확인 → 파일 저장

**수정 방식:** 300줄 미만 전체 재작성 / 이상은 부분 수정

**코드 패턴 참고** (필요 시 claude.ai에서 로드):
- CSS·레이아웃·컴포넌트: `webapp-builder` 스킬 `references/app-structure.md`
- Firebase 헬퍼: `webapp-builder` 스킬 `references/firebase-integration.md`

**이 프로젝트 전용 라이브러리 (CDN):**
- 이메일 발송: EmailJS (신청 접수·승인·거절 통보 메일 — 클라이언트에서 직접 호출, 백엔드 불필요)
- 필요 시 바코드 표시: JsBarcode (Product 상태조회 화면에서 바코드를 보여줘야 할 경우, 선택적)

#### 단계별 진행 원칙
- 각 단계 완료 후 사용자 확인 받고 다음 단계 시작
- 단계 완료 또는 세션 마무리 시 → 위 "🔴 세션 종료 시 자동 수행" 절차 따름

#### 기획 내용 유실 방지 원칙
- CLAUDE.md를 갱신할 때 **기존 기획 내용, 구현 결정 사항은 절대 삭제·축약·생략하지 않는다.**
- 사용자가 의사를 바꿔 기획 내용이 변경된 경우에는, 변경된 항목 옆에 `[변경: 이유 요약]` 형태로 주석을 달고 이전 내용도 취소선 등으로 남긴다.
- "간략화", "요약", "정리" 등을 이유로 기존 기획 내용을 줄이지 않는다.

---

### Phase 3: 배포 프로토콜

1. Vercel 프로젝트(이미 생성·GitHub 연동 완료)에 `vendor.gmbs.kr` 커스텀 도메인 연결 확인 (Vercel 대시보드 → Settings → Domains)
2. Firebase 콘솔 → Authentication → 승인된 도메인에 `vendor.gmbs.kr` 추가
3. **Google Cloud Console → OAuth 동의 화면 → 게시 상태를 "프로덕션"으로 전환** (테스트 상태면 일반 사용자 로그인 불가 — 위 아키텍처 요약의 "⚠️ 공유 설정 주의" 참고)
4. Firestore 보안 규칙 확인 — `vendor_accounts`를 통한 브랜드 스코프 접근 제어, `users`는 본인 문서만 read/write, `brand_applications`/`brand_join_requests`는 본인이 작성한 것만 read, admin만 전체 read/승인 write 가능하도록 설정
5. EmailJS 콘솔에서 발신 도메인 화이트리스트 설정 (vendor.gmbs.kr만 허용, 남용 방지)

Firebase 첫 설정이라면: `webapp-builder` 스킬 `references/firebase-setup.md` 참고

---

### Phase 4: 가이드 문서 작성 프로토콜

배포 완료 후 요청 시, 아래 프롬프트를 완성해서 출력한다.

```
지금까지 이 프로젝트에서 개발한 앱의 사용 가이드를 노션에 작성해줘.
노션 MCP로 바로 작성. 작성할 노션 페이지 URL: [URL]

앱 이름: GMBS 입점 브랜드 포털
접속 URL: https://vendor.gmbs.kr
로그인: Google OAuth (동적 인증 — 일반회원/브랜드회원)
데이터 저장: Firebase Firestore (admin과 공유 프로젝트, Project: [projectId])

주요 기능 (사이드바 순서): [구현된 메뉴 전체]
주요 워크플로우: [반복 업무 흐름 — 입점 신청, 상품 등록/수정요청 등]

개발 과정에서 수집된 가이드 참고 내용:
[아래 "가이드 문서 참고 내용 누적" 항목 전체 삽입]

문서 요건:
- 대상: 기술 배경 없는 처음 사용자 (입점 브랜드 담당자)
- 구성: 시작하기(가입·로그인) → 입점 신청 방법 → 메뉴별 기능 → 주요 워크플로우 → 주의사항·FAQ
- 각 섹션에 "📸 이미지 추가 위치: [캡처할 화면]" 안내 포함
```

---

### 개발 단계 현황

1단계 프로젝트 셋업(Firebase 연결 — admin과 동일 프로젝트, Google 로그인 연동, 레이아웃 골격) — ✅ 완료 (index.html + style.css + app.js + firebase-init.js)
2단계 로그인·계정 생성 로직(로그인/계정만들기 버튼 분리 UX, `users` 자동 생성, `vendor_accounts` 자동 연결 로직) — ✅ 완료 (1단계와 통합 구현)
3단계 브랜드 연결 갈래(신규 일반회원 대상 "기존 브랜드 담당자로 연결" vs "새 브랜드 등록" 선택 화면, `brand_join_requests`/`brand_applications` 제출, 본인 신청 현황 조회) — ✅ 완료 (1단계와 통합 구현)
4단계 브랜드 정보 조회/수정(브랜드회원) — ✅ 완료 (pages/brand-info.js — 연락처/이메일/주소/소개 수정 가능, 사업자번호 등 admin 전용 필드는 읽기전용)
5단계 담당자(Person) 관리(본인 브랜드 범위) — ✅ 완료 (pages/persons.js — 목록 조회, 본인 수정, 신규 추가 + vendor_accounts 초대됨 자동 생성, 이중 이메일 입력)
6단계 계약 다운로드 — ✅ 완료 (pages/contracts.js — 목록 + 파일 URL 다운로드)
7단계 상품 등록/수정요청/상태조회 — ✅ 완료 (pages/products.js — 신규 등록 신청, 수정 요청, 거절 사유 표시, 공급가·수수료율 읽기전용)
8단계 재고/판매 조회(읽기전용, gmbs-functions 완성 전까지 "준비중" 처리) — ✅ 완료 (pages/inventory.js — 데이터 있으면 테이블, 없으면 준비중 안내)
9단계 정산 조회(읽기전용) — ✅ 완료 (pages/settlements.js — 데이터 있으면 연도별 합계+테이블, 없으면 준비중)
10단계 공지사항·문의 — ✅ 완료 (pages/notices.js + pages/inquiries.js — 공지 상세 모달, 문의 등록·답변 확인)
11단계 EmailJS 이메일 연동(신청 접수·처리 알림 등) — ✅ 완료 (emailjs-config.js — 설정값만 채우면 동작, 미설정 시 콘솔 경고만 출력)

추가 구현 (계획에 없었으나 이번에 포함):
- pages/account.js — 계정 설정 페이지 (이름/연락처/연락용 이메일 수정)
- firestore.rules — Firestore 보안 규칙 전체 작성 (컬렉션별 read/write 권한)
- vercel.json — SPA 라우팅 설정
- 대시보드 통계 카드 — 상품 수·승인 대기·미답변 문의 수 실시간 표시
- emailjs-config.js — EmailJS 설정을 Firestore `email_configs` 컬렉션에서 동적으로 읽어오도록 전면 개편 (admin.gmbs.kr 이메일 설정 UI와 연동)
- 브랜드 합류 신청 모달 — 브랜드 목록 드롭다운 → 브랜드명 검색 UI로 변경
- 신청 모달 (합류·신규 모두) — `applicant_contact_email` 필드 추가, 계정 설정의 연락용 이메일 자동 불러오기
- 역할/직책 필드 — 주관식 input → `<select>` 드롭다운으로 변경 (app.js·persons.js 모두, 선택지: 대표/운영 담당자/MD/마케팅 담당자/영업 담당자/기타)
- inventory.js — gmbs-functions 연동 스펙으로 전면 개편: 재고(inventory_transactions 집계) + 판매(sales 컬렉션) 탭 UI
- settlements.js — status=확정 필터, 새 필드명(period_start, total_supply_amount 등) 적용
- firestore.rules — email_configs, inventory_transactions, sales 컬렉션 규칙 추가

---

### DB 구조 (Firestore 컬렉션 구성)

**이 프로젝트에서 새로 추가하는 컬렉션**
```
users/{uid}
  email, name, phone, member_status(일반회원|브랜드회원),
  brand_id, person_id, created_at, updated_at
  // 구글 계정 생성 직후 즉시 생성, 추가 정보 요구 없음

vendor_accounts/{login_google_email}   // 문서ID = 로그인용 구글 이메일(소문자 정규화)
  uid(연결 전 null), brand_id, person_id,
  status(초대됨|연결됨), created_at, linked_at

brand_applications/{id}      // 새 브랜드 등록 신청
  applicant_uid, applicant_email, applicant_name, applicant_phone, applicant_role,
  brand_name, 사업자정보,
  status(제출됨|승인|거절), submitted_at, reviewed_at, reviewer_email, rejection_reason

brand_join_requests/{id}     // 기존 브랜드 합류 신청
  applicant_uid, applicant_email, applicant_name, applicant_phone, applicant_role,
  target_brand_id,
  status(제출됨|승인|거절), submitted_at, reviewed_at, reviewer_email, rejection_reason
```

**gmbs-admin과 공유해서 읽고/쓰는 기존 컬렉션** (스키마 정의는 gmbs-admin CLAUDE.md가 원본, 여기서는 이 앱이 어떻게 접근하는지만 기록)
```
brands/{brandId}                              — 브랜드회원: 자기 브랜드만 read, 일부 필드 write
brands/{brandId}/persons/{personId}           — 브랜드회원: 자기 브랜드 범위 read/write
brands/{brandId}/contracts/{contractId}       — 브랜드회원: read only (다운로드)
products/{productId}                          — 브랜드회원: 자기 브랜드 상품 read, 신규등록/수정요청 write(승인전 필드만)
settlements/{settlementId}                    — 브랜드회원: 자기 브랜드분 read only
notices/{noticeId}                            — 전체 브랜드회원: read only
inquiries/{inquiryId}                         — 브랜드회원: 본인 작성분 read/write(title/content만), answer는 admin 전용
```

**항목별 작성/열람 주체 정리** (gmbs-admin CLAUDE.md의 표와 동일 — 이 앱에서도 그대로 유지)

| 항목 | 작성 주체 | 열람 주체 |
|---|---|---|
| Brand 기본정보 | admin | admin, vendor(자기 브랜드만) |
| Brand 입점 상태 | admin | admin, vendor(읽기전용) |
| Person(담당자) | admin, vendor(자기 브랜드만) | admin, vendor |
| Contract | admin | admin, vendor(다운로드만) |
| Product 신규등록/수정요청 | vendor | admin(승인대기 목록), vendor(자기 요청) |
| Product 승인/거절/공급가격/수수료율 | admin | admin, vendor(승인 결과만) |
| Inventory/Sales | (추후) functions | admin, vendor(읽기전용) |
| Settlement | (추후) functions, admin | admin, vendor(읽기전용) |
| Activity Log | admin | admin만 |
| Notice | admin | admin, vendor |
| Inquiry 질문/답변 | vendor(질문)/admin(답변) | admin, vendor(자기 것만) |
| users, vendor_accounts, brand_applications, brand_join_requests | vendor(본인), admin(승인) | vendor(본인), admin(전체) |

**Firestore 보안 규칙 원칙**:
- `vendor_accounts/{email}` 조회로 로그인 사용자의 brand_id를 확인해 브랜드 스코프 데이터 접근 제어 (`get()` 사용)
- `users/{uid}`는 본인(uid 일치)만 read/write
- `brand_applications`, `brand_join_requests`는 본인이 작성한 문서만 read, 생성은 로그인 사용자 누구나 가능(단, applicant_uid는 자기 uid로 고정), status 필드는 admin만 수정 가능
- `contracts`, `notices`, `activity_log`: vendor는 read only (activity_log는 read도 불가), write는 admin/system 전용

---

### 개발 기획 내용 누적

**⚠️ 이 섹션은 절대 삭제·축약하지 않는다. 기획이 바뀌면 변경 주석을 추가할 뿐이다.**

#### 1. 프로젝트 성격 및 전체 구조 관계
- GMBS 시스템은 gmbs-admin(운영자용, 완료), gmbs-vendor(이 프로젝트, 입점 브랜드용), gmbs-functions(추후, Toss POS 연동·웹훅·정산 자동화 등 서버 로직 전용)로 나뉜다.
- 세 프로젝트는 각각 별도 GitHub 저장소 + 별도 Claude Code 세션(CLAUDE.md)을 쓰지만, **같은 Firebase 프로젝트를 공유**한다. Firestore 데이터가 공유되므로 항목마다 작성 주체가 다르고(위 "항목별 작성/열람 주체" 표 참고) 서로 다른 방향으로 양방향 관계다.
- gmbs-admin의 "1차 개발"(브랜드/상품/바코드)은 완료됐고, 이후 admin에도 챗지피티가 작성한 확장 명세서(Person/Contract/Product 승인/Settlement/Activity Log 등)를 반영하는 "admin 확장" 작업이 진행 중이다. vendor는 이 admin 확장이 만드는 데이터를 읽는 쪽이 많아서, admin 확장과 병행해서 개발한다.

#### 2. 로그인·계정 생성 로직 (상세, 매우 중요 — 절대 축약 금지)

**UX 원칙**: 로그인 화면에 "로그인" 버튼과 "구글로 시작하기(계정 만들기)" 버튼을 따로 보여준다. 둘 다 내부적으로는 같은 Google OAuth 팝업을 호출하지만, 인증 후 실제 상태(`users/{uid}` 존재 여부)로 정확한 분기를 결정해서, 사용자가 버튼을 잘못 눌러도 알맞은 화면으로 보정한다.

**신규 유저 흐름 (자체 구글 계정 생성)**
1. 구글 인증 성공 → 그 즉시 `users/{uid}`를 생성한다. **이 시점에는 추가 정보를 요구하지 않는다.** 이름은 구글 프로필에서, 이메일은 로그인 정보에서 그대로 가져온다. member_status는 "일반회원".
2. 이후 갈림길 화면을 보여준다: **[기존 브랜드 담당자로 연결]** vs **[새 브랜드 등록]**
   - **기존 브랜드 담당자로 연결** 선택 시: 소속될 브랜드를 목록에서 선택(검색 가능) + 담당자 추가정보(연락처, 역할) 입력 → `brand_join_requests` 문서 생성 (target_brand_id, applicant_uid, applicant_email, applicant_name, applicant_phone, applicant_role, status=제출됨)
   - **새 브랜드 등록** 선택 시: 브랜드 정보(브랜드명, 사업자정보 등) + 본인 담당자 정보(연락처, 역할) 입력 → `brand_applications` 문서 생성 (동일 구조 + brand_name, 사업자정보)
3. 어느 쪽이든 제출 후에는 "심사중" 상태 화면에 머무르며, 본인이 제출한 신청의 현재 상태(제출됨/승인/거절)를 조회할 수 있다.
4. admin이 승인하면:
   - `brand_applications` 승인 → 새 `brands` 문서 생성 + `brands/{brandId}/persons/{personId}` 문서 생성(login_google_email=applicant_email) + `vendor_accounts/{applicant_email}` 문서를 **상태=연결됨, uid=applicant_uid로 즉시** 생성(신청자가 이미 로그인되어 있어 uid를 알고 있으므로 "초대됨" 중간 상태를 거치지 않음) + `users/{uid}`를 브랜드회원으로 갱신(brand_id, person_id 채움)
   - `brand_join_requests` 승인 → 기존 `brands/{target_brand_id}`에 `persons` 문서 추가 + 위와 동일하게 `vendor_accounts` 즉시 연결됨 생성 + `users/{uid}` 갱신
   - 거절 시: 신청 문서에 status=거절 + rejection_reason 기록. 신청자는 여전히 일반회원 상태로 남고, 다시 신청 가능.

**관리자 직접등록 흐름 (admin에서 브랜드를 먼저 만드는 경우)**
1. admin이 브랜드와 담당자를 직접 등록할 때, 담당자의 "연락용 이메일(contact_email)"과는 별개로 **"vendor 로그인에 쓸 구글 이메일(login_google_email)"**을 반드시 함께 입력받는다. (두 이메일이 다를 수 있다는 전제)
2. 이 login_google_email로 즉시 `vendor_accounts/{login_google_email}` 문서를 **상태=초대됨, uid=null**로 생성해둔다. (아직 그 사람이 한 번도 로그인한 적이 없어 uid를 모르기 때문)
3. 나중에 그 담당자가 실제로 그 구글 계정으로 처음 로그인하면: `users/{uid}`가 없는 상태에서 로그인 이메일로 `vendor_accounts`를 조회했을 때 "초대됨" 상태의 문서가 매칭되면, **추가 정보 요청 없이** 이미 admin이 입력해둔 `persons` 문서의 이름·연락처 정보를 그대로 가져와 `users/{uid}`를 브랜드회원으로 자동 생성하고, `vendor_accounts`를 "연결됨"으로 갱신(uid 채움)한다. 사용자에게는 "환영합니다, OO브랜드 OO님으로 연결되었습니다"라는 확인 화면만 보여준다(원하면 정보 수정 가능).
4. **오타·계정 불일치 복구 경로**: 만약 그 담당자가 admin이 입력한 것과 다른 구글 계정으로 로그인하면 자동연결이 안 되고 일반회원으로 처리된다. 이 경우 두 가지 복구 방법이 있다: (a) 본인이 "기존 브랜드 담당자로 연결" 신청을 스스로 제출해서 admin이 승인, (b) admin이 `vendor_accounts`의 문서 키(이메일)를 직접 정정. 이 설계 덕분에 "기존 브랜드 담당자로 연결" 신청 경로가 오타 복구 수단도 겸한다.

#### 3. Firestore 데이터 모델 상세
(위 "DB 구조" 섹션 참고 — users, vendor_accounts, brand_applications, brand_join_requests 및 admin과 공유하는 기존 컬렉션 전부 포함)

#### 4. 항목별 작성/열람 주체 정리
gmbs-admin CLAUDE.md의 "#18. 항목별 작성/열람 주체 정리" 표와 동일한 내용을 이 프로젝트에도 그대로 유지한다 (위 "DB 구조" 섹션의 표 참고). 두 프로젝트가 이 표를 기준으로 일관되게 개발되어야 한다.

#### 5. PWA·FCM 결정
- PWA는 적용하지 않는다 (사용자 확인, admin과 마찬가지로 모바일 설치 우선순위 낮음).
- FCM 백그라운드 알림도 적용하지 않는다. 대신 **EmailJS**로 이메일 알림을 구현한다 (입점신청 접수확인, 승인/거절 통보, 향후 정산 지급 알림 등). EmailJS는 무료 월 200통 한도이며 클라이언트에서 바로 호출 가능해 gmbs-functions 없이도 지금 구현 가능하다. 나중에 gmbs-functions가 생기면 더 안정적인 서버 발송(Resend/SendGrid 등)으로 옮기는 것을 고려한다.

#### 6. 3-프로젝트 구조에서의 Cloud Functions(gmbs-functions)와의 관계
- Toss POS 웹훅 수신, Toss Catalog/Order API 호출, 월별 정산 자동 생성, Activity Log 자동 기록(Firestore 트리거), 가격 변경 이력 자동 기록은 모두 gmbs-functions(추후 별도 프로젝트)의 책임이다.
- 이 프로젝트(vendor)는 그 결과 데이터(Inventory, Sales, Settlement)를 읽기 전용으로 보여주는 역할만 하며, gmbs-functions가 아직 없는 지금 단계에서는 해당 화면을 "준비중"으로 처리한다.

#### 7. OAuth 동의 화면 공유 설정
- gmbs-admin과 gmbs-vendor는 같은 Firebase(Google Cloud) 프로젝트를 쓰므로 OAuth 동의 화면 설정도 공유된다. vendor의 일반 사용자 가입을 위해 이 설정을 "프로덕션(게시됨)" 상태로 전환해야 하며, 이는 admin의 로그인 방식(ALLOWED_EMAILS 코드 레벨 체크)에는 영향을 주지 않는다.

---

### 가이드 문서 참고 내용 누적

**세션 1 (Firebase 초기화·전체 기능 구현)**
- 앱 전체가 ES Module + Firebase CDN(v10.12.2) + EmailJS CDN 기반으로 구성됨. 빌드 도구 없음.
- Google OAuth 팝업 → `users/{uid}` 자동 생성 → vendor_accounts 초대 여부 확인 → 분기
- 브랜드회원 전환은 admin 승인 후 자동 처리 (페이지 새로고침 필요)
- Firestore 보안 규칙: `isBrandMember()` 헬퍼 함수로 brand_id 스코프 접근 제어
- EmailJS: 신청 접수 확인 메일만 현재 구현. 승인/거절 통보 메일은 admin 쪽에서 처리
- `vercel.json`의 rewrites 설정이 있어야 Vercel에서 직접 URL 접근 시 404 안 남

---

### 다음 세션 시작점

**전체 구현 완료 (1~11단계 + 추가 기능 + gmbs-functions 연동).** 모든 설정 완료:

1. **EmailJS 설정** ✅ — admin.gmbs.kr 이메일 설정 메뉴에서 관리
2. **Firestore 보안 규칙** ✅ — Firebase 콘솔에 적용 완료 (email_configs, inventory_transactions, sales 포함)
3. **Firebase Authentication 승인 도메인** ✅ — vendor.gmbs.kr 추가 완료
4. **OAuth 동의 화면 프로덕션 전환** ✅ — 완료
5. **admin 연계 요청 목록 전달** ✅ — gmbs-admin 세션에 전달 완료
6. **gmbs-functions 연동 스펙 적용** ✅ — inventory_transactions/sales/settlements 모두 반영

파일 구조:
```
index.html          — HTML 골격 (EmailJS CDN 포함)
style.css           — 전체 UI 스타일
firebase-init.js    — Firebase 초기화 + Firestore 함수 export
app.js              — 인증·라우팅·사이드바·갈래선택·대시보드
emailjs-config.js   — EmailJS 설정 (설정값 입력 필요)
firestore.rules     — Firestore 보안 규칙
vercel.json         — SPA 라우팅
pages/
  brand-info.js     — 브랜드 정보 조회/수정
  persons.js        — 담당자 관리
  contracts.js      — 계약서 다운로드
  products.js       — 상품 등록/수정요청/상태조회
  inventory.js      — 재고·판매 조회 (준비중)
  settlements.js    — 정산 조회 (준비중)
  notices.js        — 공지사항
  inquiries.js      — 문의하기
  account.js        — 계정 설정
```

---

### ⚠️ 세션 종료 규칙 요약

위 "🔴 세션 종료 시 자동 수행" 절차를 따른다. 사용자가 명시적으로 종료 의사를 밝혀야 CLAUDE.md를 갱신한다. 작업 중간에 임의로 갱신하지 말 것. Vercel 배포이므로 push+PR 머지는 세션당 1번만 수행한다.
