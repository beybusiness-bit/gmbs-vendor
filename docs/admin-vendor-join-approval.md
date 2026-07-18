# 브랜드 담당자 합류 신청 — 벤더 측 승인 기능 명세

## 개요

기존에는 `brand_join_requests` 문서의 승인/거절을 어드민만 처리할 수 있었습니다.
이제 해당 브랜드의 **주관리자(벤더 포털 사용자)** 도 합류 신청을 승인하거나 거절할 수 있습니다.
승인 주체를 구분할 수 있도록 `approved_by_type` / `rejected_by_type` 필드가 추가되었습니다.

---

## brand_join_requests 문서 필드 변경

### 승인 시 추가되는 필드

| 필드명 | 타입 | 설명 |
|---|---|---|
| `status` | string | `'승인'` |
| `approved_by` | string | 승인자 이름 |
| `approved_by_email` | string | 승인자 이메일 |
| `approved_by_type` | string | `'vendor'` 또는 `'admin'` |
| `approved_at` | timestamp | 승인 일시 |
| `updated_at` | timestamp | 수정 일시 |

### 거절 시 추가되는 필드

| 필드명 | 타입 | 설명 |
|---|---|---|
| `status` | string | `'거절'` |
| `rejection_reason` | string | 거절 사유 (선택) |
| `rejected_by` | string | 거절 처리자 이름 |
| `rejected_by_email` | string | 거절 처리자 이메일 |
| `rejected_by_type` | string | `'vendor'` 또는 `'admin'` |
| `rejected_at` | timestamp | 거절 일시 |
| `updated_at` | timestamp | 수정 일시 |

---

## 벤더 승인 시 자동 처리되는 내용

벤더 측에서 승인하면 벤더 포털이 다음을 자동으로 처리합니다:

1. `brand_join_requests/{docId}` → status `'승인'` + 승인자 정보 기록
2. `brands/{brandId}/managers` 서브컬렉션에 신규 담당자 문서 추가
3. `managers/{email}` 최상위 문서 생성 또는 업데이트
   - `brand_ids` 배열에 brandId 추가
   - `roles` 맵에 `{brandId: role}` 추가
   - 기존 문서가 없으면 `status: '초대됨'`으로 신규 생성

---

## 어드민 대시보드 대응 요청 사항

### 1. 합류 신청 목록에서 처리자 구분 표시

`brand_join_requests` 목록에서 `status === '승인'` 또는 `status === '거절'` 문서에
`approved_by_type` / `rejected_by_type` 필드가 있을 수 있습니다.

**표시 예시:**

| 상태 | 처리자 | 표시 방식 |
|---|---|---|
| 승인 | `approved_by_type === 'admin'` | "어드민 승인 · 홍길동" |
| 승인 | `approved_by_type === 'vendor'` | "브랜드 승인 · 홍길동 (brand@example.com)" |
| 거절 | `rejected_by_type === 'admin'` | "어드민 거절 · 홍길동" |
| 거절 | `rejected_by_type === 'vendor'` | "브랜드 거절 · 홍길동 (brand@example.com)" |

### 2. 어드민 알람 해소 처리

어드민에서 `brand_join_requests` 문서의 `status === '제출됨'` 건을 알람으로 표시하고 있다면,
`status !== '제출됨'` 이 되는 시점에 알람이 해소된 것으로 처리하면 됩니다.
**벤더가 먼저 처리한 경우에도 status가 변경되므로 동일하게 동작합니다.**

### 3. 어드민에서 이미 처리된 건 중복 처리 방지

어드민에서 합류 신청을 처리하려 할 때 `status !== '제출됨'` 이면
"이미 처리된 신청입니다 (처리자: {approved_by} / {approved_by_type})" 형태로 안내하고
수정을 막는 것을 권장합니다.

### 4. brands/{brandId}/managers 서브컬렉션 동기화 확인

벤더 승인 시 어드민이 별도로 서브컬렉션에 담당자를 추가할 필요가 없습니다.
벤더 포털이 자동으로 처리합니다. 다만 어드민 담당자 목록 뷰에서는
`join_request_id` 필드(있을 경우)를 통해 원본 신청 문서와 연결할 수 있습니다.

---

## Firestore 보안 규칙 변경 사항

`brand_join_requests` 컬렉션에 다음 규칙이 추가되었습니다:

```
// 해당 브랜드 담당자는 읽기 가능
allow read: if isBrandMember(resource.data.target_brand_id);

// 브랜드 담당자가 상태 및 처리자 정보만 업데이트 가능
allow update: if isBrandMember(resource.data.target_brand_id)
  && 변경 가능 필드: [status, approved_by, approved_by_email, approved_by_type,
                      approved_at, rejected_by, rejected_by_email, rejected_by_type,
                      rejected_at, rejection_reason, updated_at];
```

어드민 측은 Admin SDK(서버 측)를 사용하므로 이 규칙의 영향을 받지 않습니다.

---

## 업데이트 배포 일자

2026-07-18
