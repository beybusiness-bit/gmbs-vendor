# 담당자 데이터 모델 변경 — 어드민 전달 사항

## 변경 배경

기존 구조에서는 `vendor_accounts/{email}` 문서에 `brand_id` 필드가 하나뿐이어서
한 담당자가 두 번째 브랜드를 담당하게 될 경우 첫 번째 브랜드 정보가 덮어쓰여졌습니다.
그 결과 2개 브랜드를 담당하는 계정에서 브랜드가 1개만 표시되는 버그가 발생했습니다.

---

## 새 데이터 모델

### 핵심 변경: `managers` 컬렉션 신설

| 컬렉션 경로 | 역할 | 상태 |
|---|---|---|
| `managers/{email}` | 담당자 단일 소스 (멀티 브랜드 지원) | **신규** |
| `brands/{brandId}/managers` | 브랜드별 담당자 서브컬렉션 | **신규** (persons 대체) |
| `vendor_accounts/{email}` | 레거시 — 신규 쓰기 없음 | 한시 유지 |
| `persons/{personId}` 최상위 | 레거시 — 신규 쓰기 없음 | 한시 유지 |
| `brands/{brandId}/persons` | 레거시 — 신규 쓰기 없음 | 한시 유지 |

---

## `managers/{email}` 문서 구조

문서 ID는 **소문자로 정규화된 구글 이메일**입니다.

```
{
  uid:                string | null,   // Firebase Auth UID (첫 로그인 후 설정)
  name:               string,
  phone:              string,
  contact_email:      string,
  login_google_email: string,          // = 문서 ID와 동일
  brand_ids:          string[],        // 담당 브랜드 ID 목록 (핵심 필드)
  roles:              { [brandId]: string },  // 브랜드별 역할 ('주관리자'|'부관리자')
  status:             '초대됨' | '연결됨' | '비활성',
  active:             boolean,
  created_at:         Timestamp,
  updated_at:         Timestamp,
  linked_at:          Timestamp | null,
}
```

---

## `brands/{brandId}/managers/{docId}` 서브컬렉션 구조

기존 `brands/{brandId}/persons`와 동일한 필드 구조입니다.

```
{
  login_google_email: string,
  name:               string,
  role:               string,
  phone:              string,
  contact_email:      string,
  active:             boolean,
  created_at:         Timestamp,
  updated_at:         Timestamp,
}
```

---

## 어드민 앱에서 해야 할 작업

### 1. 기존 담당자 데이터 마이그레이션 (1회성)

`vendor_accounts` + `brands/{brandId}/persons` 데이터를 읽어
`managers/{email}` 문서를 생성해야 합니다.

**마이그레이션 스크립트 로직 (pseudo-code):**

```
// 1. vendor_accounts 전체 순회
for each doc in vendor_accounts:
  email = doc.id
  brand_id = doc.brand_id
  status = doc.status  // '초대됨' | '연결됨'

  // 2. 해당 브랜드의 persons 서브컬렉션에서 역할 조회
  role = brands/{brand_id}/persons 에서 login_google_email == email 인 문서의 role

  // 3. managers/{email} 문서 생성 또는 업데이트
  if managers/{email} exists:
    managers/{email}.brand_ids 배열에 brand_id 추가
    managers/{email}.roles[brand_id] = role
  else:
    managers/{email} = {
      uid:    doc.uid,
      name:   brands/{brand_id}/persons 에서 조회한 name,
      brand_ids: [brand_id],
      roles:  { [brand_id]: role },
      status: doc.status,
      linked_at: doc.linked_at,
      ...
    }
```

> **Vendor Portal은 로그인 시 `vendor_accounts`를 폴백으로 자동 마이그레이션합니다.**
> 담당자가 한 번 로그인하면 자동으로 `managers/{email}` 문서가 생성됩니다.
> 따라서 위 스크립트는 "로그인을 기다릴 수 없는" 케이스(예: 신규 초대 즉시 반영 필요)에만 필요합니다.

### 2. 신규 담당자 초대 방법 변경

**기존:** `vendor_accounts/{email}` 문서 생성 (`brand_id` 단일값)

**신규:** `managers/{email}` 문서 생성 또는 업데이트

```javascript
// 신규 담당자 초대
setDoc(doc(db, 'managers', email), {
  uid:                null,
  name:               '홍길동',
  phone:              '010-0000-0000',
  contact_email:      email,
  login_google_email: email,
  brand_ids:          [brandId],
  roles:              { [brandId]: '부관리자' },
  status:             '초대됨',
  active:             true,
  created_at:         serverTimestamp(),
  updated_at:         serverTimestamp(),
  linked_at:          null,
});

// 기존 담당자에 새 브랜드 추가
updateDoc(doc(db, 'managers', email), {
  brand_ids: arrayUnion(brandId),
  roles:     { ...existingRoles, [brandId]: '부관리자' },
  updated_at: serverTimestamp(),
});
```

> `brand_ids`는 배열이므로 `arrayUnion`을 사용하면 중복 없이 추가됩니다.

### 3. `brands/{brandId}/managers` 서브컬렉션도 함께 생성

담당자 초대 시 해당 브랜드의 서브컬렉션에도 문서를 추가해야
Vendor Portal의 "담당자 관리" 화면에 표시됩니다.

```javascript
addDoc(collection(db, 'brands', brandId, 'managers'), {
  login_google_email: email,
  name:               '홍길동',
  role:               '부관리자',
  phone:              '010-0000-0000',
  contact_email:      email,
  active:             true,
  created_at:         serverTimestamp(),
  updated_at:         serverTimestamp(),
});
```

---

## 보안 규칙 요약

- `managers/{email}`: 본인 이메일 문서만 read, 제한된 필드만 update
- `brands/{brandId}/managers`: 해당 브랜드 담당자만 CRUD
- `brands/{brandId}/persons`: 레거시, read만 허용 (write 불가)
- `vendor_accounts`: 레거시, 본인 문서 read + 제한 update만 허용

---

## 레거시 컬렉션 보존 기간

`vendor_accounts`, `brands/{brandId}/persons`, 최상위 `persons` 컬렉션은
**모든 담당자의 로그인이 확인된 후** (또는 마이그레이션 스크립트 실행 완료 후)
삭제해도 됩니다. 현재는 읽기만 허용되어 있습니다.
