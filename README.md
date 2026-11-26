# ㈜와이드가드 — 공식 홈페이지

빌드 과정 없이 폴더를 그대로 올리면 동작하는 정적 홈페이지입니다.
상담 폼으로 접수된 내용은 **Vercel 서버리스 함수(`/api/inquiry`)가 대표이사·사내이사 두 사람에게 문자(SMS/LMS)로 알림**을 보냅니다.

> 견적 매칭 플랫폼(`/platform`, `/admin`, `/demo`)은 이번 배포에서 **제외**했습니다.
> 원본은 `work/wideguard-platform-backup/`에 그대로 보관되어 있으며, 정관·통신판매업 신고 등 확인 후 재개할 수 있습니다.

## 구조

```
wideguard-site/
├── index.html                 홈페이지 (히어로 → 지표 → 회사소개 → 6대 사업영역·법령 안내 → 주요실적(탭) → 현장기록 → 핵심역량/프로세스 → FAQ → 상담/문의 → 푸터)
├── styles.css                 홈페이지 스타일 (화이트·라이트 그레이 + 네이비·골드 포인트)
├── app.js                     헤더 스크롤 · 모바일 메뉴 · 카운트업 · 상담 폼(접수 → 알림 문자)
├── consult.html               간편상담 전용 페이지 (인스타·스레드 프로필 링크용 /consult)
├── consult.js                 간편상담 폼 (업무 분야 칩 · 연락처 · 지역/현장 · 내용 → /api/inquiry)
├── privacy.html               개인정보처리방침 (초안)
├── terms.html                 홈페이지 이용약관 (초안)
├── 404.html                   없는 주소 안내
├── robots.txt                 검색 로봇 설정 (/api 제외)
├── vercel.json                호스팅 설정 (api 함수 시간 제한·캐시 헤더)
├── package.json               함수 런타임 설정 · 테스트 스크립트
├── .env.example               Vercel에 넣을 환경변수 이름 예시
├── api/
│   └── inquiry.js             POST /api/inquiry — 상담 접수 검증 + 담당자 2인 문자 알림
├── test/
│   └── inquiry.test.js        검증·발송 로직 테스트 (node --test)
└── assets/
    ├── fonts/                 Pretendard 가변폰트 (서브셋)
    └── images/                로고 · 현장 사진 · 파비콘 · portfolio/(회사소개서 실적 사진)
```

## 미리보기 (로컬)

```bash
cd wideguard-site
python3 -m http.server 8000
# http://localhost:8000/
```

로컬 정적 서버에는 `/api/inquiry`가 없으므로, 상담 폼을 제출하면
**“자동 접수에 연결하지 못했습니다” 안내와 함께 메일·전화 대체 버튼**이 표시됩니다(정상 동작).
API까지 함께 확인하려면 Vercel CLI로 실행하세요.

```bash
npm i -g vercel
vercel dev      # http://localhost:3000  (함수 포함)
```

## 간편상담 페이지 — `/consult`

인스타·스레드 릴스를 보고 모바일로 들어오는 고객이 **30초 안에 문의**할 수 있도록 만든 단문 페이지입니다.
`vercel.json`의 rewrite(`/consult` → `/consult.html`)로 열리며, `/consult.html`도 함께 동작합니다.

- 상단: 공식 로고 + `경기도남부경찰청 허가 제2442호 정식 경비법인` 배지
- CTA 2개: `📞 24시간 바로 전화 031-945-2001` · `🌐 공식 홈페이지 전체 보기`
- 간편상담 폼: 업무 분야(칩) · 성함(선택) · 연락처 · 지역/현장 · 간단한 내용 → `POST /api/inquiry`
  (지역/현장은 본문 앞에 `[지역/현장] …`으로 붙여 담당자 문자에 함께 전달)
- 접수 실패 시 홈페이지와 동일하게 **두 담당자 메일(mailto) + 전화** 대체 버튼
- 모바일 하단에 전화 고정 바

미리보기: `python3 -m http.server 8000` → `http://localhost:8000/consult.html`
(로컬에는 `/consult` rewrite가 없으므로 `.html`로 확인)

## 상담 알림 문자 활성화 (Vercel 설정)

문자를 보내려면 **문자 서비스 1곳**을 정하고 아래 환경변수를 Vercel에 넣은 뒤 재배포합니다.
키가 없으면 사이트는 정상 동작하되 문자만 발송하지 않고(`sms: "skipped"`), 화면에는 전화·메일 안내가 나옵니다.

**Vercel → 프로젝트 → Settings → Environment Variables** (Production·Preview·Development 모두 체크)

| 변수 | 값 | 설명 |
|---|---|---|
| `NOTIFY_PHONES` | `01088585559,01093287814` | 알림 받을 번호. 비우면 기본값(대표이사 김정환·사내이사 김종연) |
| `SMS_PROVIDER` | `solapi` 또는 `aligo` | 비우면 설정된 키를 보고 자동 선택 |

### (A) 솔라피 Solapi — `SMS_PROVIDER=solapi`

1. https://solapi.com 가입 → **API Key / API Secret** 발급 (콘솔 → 개발 → API Key)
2. **발신번호 사전등록**: 콘솔 → 발신번호 관리에서 회사 대표전화(`031-945-2001`) 등록 후 통신사 승인 확인
   (사전등록·승인되지 않은 번호로는 발송되지 않습니다)
3. 환경변수 입력

| 변수 | 설명 |
|---|---|
| `SOLAPI_API_KEY` | API Key |
| `SOLAPI_API_SECRET` | API Secret |
| `SOLAPI_SENDER` | 사전등록된 발신번호 (예: `0319452001`) |

발송 방식: `POST https://api.solapi.com/messages/v4/send-many/detail`
헤더 `Authorization: HMAC-SHA256 apiKey=…, date=…, salt=…, signature=…` (signature = HMAC-SHA256(secret, date+salt))
두 번호를 한 번의 요청(`messages` 배열)으로 보냅니다.

### (B) 알리고 Aligo — `SMS_PROVIDER=aligo`

1. https://smartsms.aligo.in 가입 → **API 키** 확인 (환경설정 → API 연동)
2. **발신번호 사전등록**: 알리고 → 발신번호 등록 후 승인
3. 환경변수 입력

| 변수 | 설명 |
|---|---|
| `ALIGO_API_KEY` | API 키 |
| `ALIGO_USER_ID` | 알리고 아이디 |
| `ALIGO_SENDER` | 사전등록된 발신번호 |
| `ALIGO_TESTMODE` | (선택) `y`이면 모의 발송으로 확인 |

발송 방식: `POST https://apis.aligo.in/send/` (`key`, `user_id`, `sender`, `receiver`(콤마 구분), `msg`, `msg_type`)

> 문자 본문이 90바이트를 넘으면 자동으로 LMS로 발송됩니다(알림 문구는 보통 LMS).
> 문자 발송은 건당 요금이 발생합니다(솔라피·알리고 요금표 참고).

### 배포

```bash
vercel            # 최초 배포 (프로젝트 연결)
vercel --prod     # 운영 배포
```

Vercel 프로젝트 설정: **Framework Preset = Other**, Build Command 없음, Output Directory = `.` (이 폴더 루트).
환경변수를 바꾼 뒤에는 **Redeploy** 해야 반영됩니다.

## API 계약 — `POST /api/inquiry`

요청 (JSON):

```json
{ "name": "홍길동", "tel": "010-1234-5678", "type": "시설경비",
  "msg": "현장 위치·기간·필요 인원 등", "agree": true, "website": "" }
```

| 필드 | 필수 | 규칙 |
|---|---|---|
| `name` | O | 2~30자 |
| `tel` | O | 휴대폰 번호 (`01[016789]` + 7~8자리, 하이픈 무관) |
| `type` | O | 시설경비 / 신변보호 / 혼잡·교통유도경비 / 이주관리·범죄예방 / 행정대집행지원 / 청소대행 / 기타 / 견적문의 |
| `msg` | O | 5~2000자 |
| `agree` | O | 개인정보 수집·이용 동의 |
| `website` | X | 스팸 방지용 숨김 필드 — 값이 있으면 조용히 무시 |

응답:

| 상황 | 코드 | 본문 |
|---|---|---|
| 발송 성공 | 200 | `{ ok: true, id, sms: "sent", delivered: 2 }` |
| 일부만 성공 | 200 | `{ ok: true, id, sms: "partial", delivered: 1 }` |
| 문자 키 미설정 | 200 | `{ ok: true, id, sms: "skipped", delivered: 0 }` |
| 입력 오류 | 400 | `{ ok: false, message: "…" }` |
| 반복 접수(같은 IP 10분 5회 초과) | 429 | `{ ok: false, message: "…" }` |
| 문자 발송 실패 | 502 | `{ ok: false, message: "…전화·이메일로 문의…" }` |

접수 내역은 서버 로그(`vercel logs`)에 마스킹된 연락처로 남습니다. 문자 발송에 실패하면 화면에서
전화·메일 대체 수단을 안내하므로, 문의를 놓치지 않도록 **Vercel 로그 알림**을 켜 두는 것을 권합니다.

## 테스트

```bash
npm test        # node --test test/  (Node 18 이상)
```

검증 규칙, 솔라피 HMAC 요청 형식, 알리고 폼 전송, 두 번호 수신, 키 미설정·발송 실패·반복 접수 처리 등 17개 케이스를 확인합니다.
외부로 실제 문자는 보내지 않습니다(`fetch` 모의).

## 운영 전에 해야 할 일

1. **도메인 연결**: Vercel → Settings → Domains 에서 도메인 추가 후, `index.html`의 `og:image`·`og:url` 주석을 풀고 실제 주소 입력
2. **문자 발신번호 사전등록**: 솔라피 또는 알리고에서 `031-945-2001` 승인 완료 여부 확인 (미승인 시 발송 실패)
3. **Vercel 환경변수 등록 후 재배포**, 실제 상담 1건으로 두 번호 수신 확인
4. **문서 검토**: `privacy.html`, `terms.html`은 초안입니다. 법률 검토 후 시행일 확정 (문자 발송 위탁사 상호 확정 후 개인정보처리방침 4항 보완)
5. **검색 등록**: 네이버 서치어드바이저·구글 서치콘솔에 사이트맵/도메인 등록 (당근 비즈프로필·네이버 플레이스와 함께 진행)

## 폰트

Pretendard 가변폰트에서 KS X 1001 한글 + 사이트에서 쓰는 문자만 남긴 서브셋입니다.
새 문구에 드문 한자를 쓰면 그 글자만 시스템 폰트로 대체될 수 있습니다.
