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
