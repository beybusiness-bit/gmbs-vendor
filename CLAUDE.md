# 개발 가이드라인

## 모달 구성 규칙

모든 모달의 액션 버튼(닫기, 저장, 취소, 확인 등)은 반드시 **스크롤 없이 항상 보여야** 합니다.

### 필수 패턴

모달 하단 버튼 영역은 반드시 `modal-footer` 클래스를 사용합니다:

```html
<!-- 단일 버튼 -->
<div class="modal-footer">
  <button class="btn btn-outline" id="btn-close" style="width:100%">닫기</button>
</div>

<!-- 취소 + 확인 버튼 -->
<div class="modal-footer" style="display:flex;gap:10px">
  <button class="btn btn-outline" id="btn-cancel" style="flex:1">취소</button>
  <button class="btn btn-primary" id="btn-save" style="flex:2">저장</button>
</div>
```

`.modal-footer`는 `position: sticky; bottom: 0`으로 스크롤에 무관하게 항상 화면 하단에 고정됩니다. (`style.css` 참조)

### 버튼 크기 규칙

- 모달 내부 버튼: `.btn` 클래스 사용, `flex:1` / `flex:2` 로 비율 지정
- `.btn-outline`, `.btn-primary`, `.btn-danger` 변형 클래스 사용
- 인라인 `height`, `font-size`, `padding` 오버라이드 금지 (전역 `.btn` 기본값 유지)
- 소형 인라인 버튼(목록 카드 내부)만 `style="width:auto;padding:6px 12px;font-size:13px"` 허용

---

## 계약 해지 요청 기능 (미구현 — 설계 예정)

> **상태**: 입점 계약 관리 페이지(`pages/contracts.js`) 개편 시 함께 구현 예정.
> 아래는 데이터 구조 및 UX 설계 초안이며, 실제 구현 전 확정 필요.

### 배경 및 요구사항

브랜드(벤더)가 직접 계약 해지를 요청할 수 있는 기능이 필요하다.
현재는 어드민이 일방적으로 계약 상태를 변경하는 구조이며, 벤더 포털에는 해지 요청 UI가 없다.

### Firestore 데이터 구조 (확정 예정)

어드민과 협의된 구조이며, 벤더 측 구현 시 이 구조를 그대로 사용한다.

#### `brands/{brandId}/contracts/{contractId}` 에 추가될 필드

```js
termination_request: {
  requester:      'brand',              // 벤더가 요청하는 경우 항상 'brand'
  reason:         string,               // 해지 사유 (선택지 또는 자유 입력 — 추후 확정)
  scheduled_date: 'YYYY-MM-DD',         // 해지 희망일
  memo:           string | null,        // 추가 메모 (선택)
  requested_at:   Timestamp,            // 요청 시각 (serverTimestamp)
} | null                                // null이면 해지 요청 없음
```

#### `brands/{brandId}` 에 추가될 필드

```js
contract_state: '계약전' | '발송됨' | '서명진행중' | '체결완료'
              | '해지진행중' | '해지됨' | '계약만료'
// 어드민이 상태 전환 시마다 업데이트. 벤더는 읽기 전용.
```

### 벤더 포털 구현 계획 (미정 사항 포함)

**미결 사항 (입점 계약 관리 페이지 개편 시 확정 필요)**

1. 계약 목록 구조 — 단건 계약인지 이력 목록인지 (현재 `pages/contracts.js` 구조 검토 필요)
2. 해지 요청 가능 조건 — `contract_state === '체결완료'`일 때만? 해지 진행 중 재요청 가능 여부?
3. 해지 사유 선택지 목록 확정 — 자유 입력 or 드롭다운 or 복합?
4. 해지 요청 후 취소 가능 여부

**확정된 방향**

- 해지 요청은 새 모달로 진행 (`openTerminationRequestModal`)
- `termination_request` 필드를 `updateDoc`으로 기록 (`requester: 'brand'` 고정)
- 요청 이후 계약 상세 화면에 "해지 요청됨" 배너 표시 (어드민 검토 대기 안내)
- `contract_state === '해지진행중'`이면 노란 배너, `'해지됨'`이면 빨간 배너 표시
- `termination_request.scheduled_date`가 있으면 "해지 예정일" 노출
- 해지 요청 취소 기능: `termination_request: null`로 업데이트 (어드민 처리 전 한정)

### 어드민 반영 포인트 (어드민팀 전달 완료)

- `termination_request.requester === 'brand'`인 경우 어드민에서 알림 발송 필요
- 어드민이 해지 수락 시 `contract_state = '해지됨'`, 거절 시 `termination_request = null`로 초기화
- `contract_state` 변경은 어드민 전용 write 권한 필요 (벤더 Firestore rules에서 read-only 처리)
