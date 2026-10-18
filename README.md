# shopping-list-app

의존성 없는 단일 HTML 파일로 만든 쇼핑 리스트 앱. 목록은 Supabase에 저장되므로 브라우저나 기기를 바꿔도 같은 내용이 보입니다.

## 기능

- **추가** — 입력 후 `추가` 버튼 또는 Enter. 빈 값과 공백만 입력한 값은 무시하고, 앞뒤 공백은 잘라서 저장합니다.
- **체크** — 체크박스 또는 품목 이름을 클릭해 토글. 완료 항목은 취소선 처리됩니다.
- **삭제** — 각 항목 오른쪽 `×` 버튼.
- **체크한 항목 비우기** — 완료된 항목만 한 번에 정리합니다.
- 모든 변경은 즉시 Supabase에 반영되고, 실패하면 목록 위에 오류 메시지가 뜹니다.
- 이전 버전이 `localStorage`에 남긴 목록이 있으면 첫 실행 때 한 번 DB로 옮기고 그 키를 지웁니다.
- 다크 모드와 모바일 화면 폭을 지원합니다.

## 실행

`index.html`을 브라우저로 열면 됩니다. 빌드 단계는 없고, Supabase 클라이언트만 CDN에서 불러옵니다.

## 데이터베이스

테이블 `public.shopping_items`

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid | 기본키, `gen_random_uuid()` |
| `name` | text | 공백만 있는 값 금지 |
| `done` | boolean | 기본값 `false` |
| `created_at` | timestamptz | 기본값 `now()`, 목록 정렬 기준 |

RLS가 켜져 있고 `anon`·`authenticated` 역할에 select/insert/update/delete를 허용합니다.

> **접근 범위에 관한 주의**
> 이 앱에는 로그인 기능이 없습니다. 페이지에 들어 있는 URL과 publishable 키는 공개 값이고 RLS 정책도 전체 허용이므로,
> **주소를 아는 사람은 누구나 목록을 읽고 고칠 수 있습니다.** 개인적인 장보기 메모 용도로는 충분하지만
> 민감한 내용을 넣지 마세요. 사용자별로 분리하려면 Supabase Auth를 붙이고 `user_id` 컬럼 기준으로 정책을 좁혀야 합니다.

## 테스트

```
npm install
npm test
```

jsdom 위에 실제 `index.html`을 올리고 Supabase 클라이언트를 메모리 테이블로 대체해 22개 테스트를 실행합니다.
추가·삭제·체크와 카운터, 비우기 버튼 상태, 각 DB 호출 실패 시 오류 처리, localStorage 데이터 이전을 검증합니다.

## 개발 설정

헤더의 `last updated` 날짜는 pre-commit 훅이 자동으로 갱신합니다. 저장소를 처음 클론했다면 한 번만 실행해 주세요.

```
git config core.hooksPath .githooks
```

이후 `index.html`이 포함된 커밋마다 날짜가 커밋 당일로 맞춰집니다.

## 구조

```
index.html           앱 전체 (HTML + CSS + JS)
test/app.test.mjs    테스트 스위트
.githooks/pre-commit 날짜 자동 갱신 훅
```
