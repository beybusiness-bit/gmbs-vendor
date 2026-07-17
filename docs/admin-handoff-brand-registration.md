# gmbs-admin 연계 요청사항 — 브랜드 등록 플로우

> 작성 기준: 2026-07-17  
> Vendor 앱 구현 완료 기준으로 어드민 측에서 필요한 작업 정리

---

## 1. Firestore 데이터 구조 변경 (brands/{brandId})

### 벤더 제출 → brand_applications에 추가된 필드

```
brand_type:              "PB" | "위탁" | "매입"   // 필수
website_urls:            string[]                  // 관련 사이트 URL 배열
requested_commission_rate: number                  // 위탁 신청 시 요청 수수료율(참고용)
settlement_info: {
  business_type:         "business" | "individual"
  business_reg_number?:  string                    // 사업자 선택 시
  taxation_type?:        "일반" | "간이"           // 사업자 선택 시
  resident_number?:      "ENC:..."                 // 개인 선택 시, AES-GCM 암호화
  bank_name:             string
  account_holder:        string
  account_number:        "ENC:..."                 // AES-GCM 암호화
}
```

### 어드민이 승인 시 brands 문서에 저장해야 할 필드

```
brand_type:       "PB" | "위탁" | "매입"    // 어드민 최종 확정
brand_code:       string                     // 영문대문자·숫자 2~10자, 중복불가
fee_info: {
  commission_rate: number                    // 위탁 브랜드만. 최종 합의 수수료율
}
onboarding_status: "미계약" | "심사중" | "계약완료" | "승인" | "거절" | "종료"
settlement_info:  <brand_applications의 settlement_info 복사>
website_urls:     <brand_applications의 website_urls 복사>
brand_desc:       <brand_applications의 brand_description 복사>
```

---

## 2. 암호화 키 공유

- Vendor 앱은 `app_configs/encryption` Firestore 문서의 `aes_key_b64` 필드에서 AES-GCM 키를 로드합니다.
- **어드민과 동일한 키**를 이 경로에 저장해야 vendor 앱에서 복호화 가능합니다.
- Firestore 보안 규칙: `app_configs/encryption` 문서는 인증된 사용자만 읽기 허용, 쓰기는 어드민만.

```
// 예시 Firestore 규칙
match /app_configs/{docId} {
  allow read: if request.auth != null;
  allow write: if false; // 어드민 콘솔 또는 서버에서만
}
```

---

## 3. 어드민에서 처리해야 할 항목

### 3-1. 브랜드 신청 심사 화면 (brand_applications)

새로 추가된 필드 표시 필요:
- `brand_type` (거래유형)
- `website_urls` (관련 사이트)
- `settlement_info` (정산 정보 — 암호화 필드는 어드민에서 복호화 표시)
- `requested_commission_rate` (참고용 요청 수수료율)

### 3-2. 승인 처리 시 brands 문서 생성

승인 시 아래 필드를 어드민이 직접 입력:
| 필드 | 설명 |
|------|------|
| `brand_code` | 영문대문자·숫자 2~10자, 중복 체크 필수 |
| `brand_type` | 벤더 신청값 확인 후 최종 확정 |
| `fee_info.commission_rate` | 위탁 브랜드만. 최종 합의 수수료율 |
| `onboarding_status` | 초기값 `"심사중"` → 승인 시 `"승인"` |

`settlement_info`와 `website_urls`, `brand_desc`는 brand_applications에서 복사.

### 3-3. 서류 업로드 (계약 완료 후)

어드민에서 아래 URL을 `brands/{brandId}/settlement_info` 하위에 업로드:
```
id_card_url:   string   // 신분증 사본 Firebase Storage URL
bank_book_url: string   // 통장 사본
biz_reg_url:   string   // 사업자등록증 사본 (사업자인 경우)
```

> vendor 앱에서는 이 URL 필드에 write 불가 (Firestore 보안 규칙으로 차단)

---

## 4. Firestore 보안 규칙 방향 (vendor 앱 기준)

```javascript
match /brands/{brandId} {
  // 본인 브랜드만 읽기
  allow read: if isBrandMember(brandId);

  // 벤더가 수정 가능한 필드만 허용
  allow update: if isBrandMember(brandId)
    && !request.resource.data.diff(resource.data).affectedKeys()
        .hasAny(['brand_code', 'fee_info', 'onboarding_status',
                 'brand_type', 'brand_name']);

  // settlement_info 내 서류 URL은 벤더 수정 불가
  // → 필드 레벨 규칙으로 추가 구현 필요
}
```

---

## 5. 벤더 포털 읽기 전용 표시 항목

다음 항목은 벤더 화면에서 **읽기 전용**으로 표시 (수정 버튼 없음):
- `brand_code`
- `brand_type` (어드민 확정 후)
- `fee_info.commission_rate`
- `onboarding_status`
- `settlement_info.id_card_url / bank_book_url / biz_reg_url`

---

## 6. onboarding_status 값 정의

| 값 | 의미 |
|----|------|
| `미계약` | 신청 전 |
| `심사중` | 어드민 검토 중 |
| `계약완료` | 전자계약 서명 완료 |
| `승인` | 입점 완료 |
| `거절` | 심사 거절 |
| `종료` | 입점 종료 |

> 기존 `brand_status`, `status` 필드는 vendor 앱에서 더 이상 사용하지 않음.  
> 어드민도 `onboarding_status`로 통일 권장.
