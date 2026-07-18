# 어드민 참조 문서: 벤더 포탈 권한 시스템

## 개요

벤더 포탈의 부관리자에게 메뉴별 보기/쓰기 권한을 설정할 수 있습니다.  
권한은 `brands/{brandId}/managers/{managerId}` 서브컬렉션 문서의 `permissions` 필드에 저장됩니다.

---

## 권한 저장 구조

### 주관리자
`permissions` 필드가 **null** 또는 **존재하지 않음** → 모든 메뉴 전체 허용

### 부관리자
`permissions` 필드가 **Map 객체**로 존재.  
- 키가 없거나 `true` → 허용 (기본값)
- 키가 `false` → 차단

```
permissions: {
  "brand-info.view":       true,   // 브랜드 정보 보기
  "brand-info.edit":       false,  // 브랜드 정보 수정 차단
  "settlement-info.view":  true,
  "settlement-info.edit":  false,
  "products.view":         true,
  "products.edit":         true,
  "inventory.view":        true,
  "inventory.edit":        true,
  "settlements.view":      true,
  "contracts.view":        true,
  "customer-inquiries.view": true,
  "customer-inquiries.edit": true,
  "inquiries.view":        true,
  "inquiries.edit":        true,
}
```

---

## 권한 키 목록

| 권한 키 | 메뉴 | 설명 |
|---|---|---|
| `brand-info.view` | 브랜드 정보 | 브랜드 기본 정보 열람 |
| `brand-info.edit` | 브랜드 정보 | 브랜드 기본 정보 수정 버튼 표시 여부 |
| `settlement-info.view` | 브랜드 정보 | 계약 및 정산 정보 카드 열람 |
| `settlement-info.edit` | 브랜드 정보 | 계약 및 정산 정보 수정/입력 버튼 표시 여부 |
| `products.view` | 상품 관리 | 상품 목록 열람 |
| `products.edit` | 상품 관리 | 상품 추가·수정·삭제 |
| `inventory.view` | 재고 관리 | 재고 열람 |
| `inventory.edit` | 재고 관리 | 재고 수정 |
| `settlements.view` | 정산 조회 | 정산 내역 열람 |
| `contracts.view` | 전자계약 | 계약 현황 열람 |
| `customer-inquiries.view` | 고객 문의 | 고객 문의 목록 열람 |
| `customer-inquiries.edit` | 고객 문의 | 고객 문의 응답 작성 |
| `inquiries.view` | 1:1 문의 | 운영자 문의 열람 |
| `inquiries.edit` | 1:1 문의 | 운영자 문의 작성 |

---

## 권한 체크 로직 (벤더 포탈 클라이언트)

```js
// null = 주관리자 → 모두 허용
// Map에 키가 없거나 true → 허용
// Map에 키가 false → 차단
if (permissions && permissions[key] === false) {
  // 접근 차단: "권한 없음" 화면 표시
}
```

사이드바 메뉴는 권한과 무관하게 항상 표시됩니다.  
권한이 없을 경우 메뉴 클릭 시 해당 메뉴 영역에 "접근 권한이 없습니다" 안내 화면이 표시됩니다.

---

## 어드민에서 관리해야 할 사항

### 1. 권한 조회 (읽기)

어드민에서 특정 브랜드 담당자의 권한을 확인하려면:

```
Firestore > brands/{brandId}/managers/{managerId}
→ permissions 필드 확인
```

### 2. 어드민에서 권한 직접 수정

어드민 대시보드에서 `brands/{brandId}/managers/{managerId}` 문서의 `permissions` 필드를 직접 수정할 수 있습니다.

**권장 처리 방식:**
- 특정 키를 `false`로 설정 → 해당 기능 차단
- 특정 키를 `true`로 설정 또는 키 삭제 → 기본 허용
- `permissions` 필드 전체를 `null`로 설정 → 주관리자 수준으로 초기화

### 3. 벤더 포탈에서의 권한 설정 UX

벤더 포탈 **주관리자**는 담당자 관리 메뉴에서 부관리자 카드를 클릭하면 권한 편집 화면이 열립니다.  
주관리자는 부관리자의 개별 기능 권한을 켜고 끌 수 있습니다.

주관리자 본인의 권한은 수정할 수 없습니다 (항상 전체 허용).

---

## Firestore 규칙 변경 사항

`brands/{brandId}/managers` 서브컬렉션 update 규칙에 `permissions` 필드가 추가되었습니다.

```js
// 허용 필드 목록에 추가됨
'permissions'
```
