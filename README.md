# Dataset Pipeline — 개발 가이드라인

> **대상:** 이 레포를 처음 접하는 동료 개발자, 그리고 코드를 자동으로 수정하는 LLM Agent  
> **목적:** 반복 발생한 빌드·DB 오류 패턴을 문서화하고, 일관된 코드 수정 방법을 정의한다.

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [디렉터리 구조](#2-디렉터리-구조)
3. [기술 스택 & 버전](#3-기술-스택--버전)
4. [실행 방법](#4-실행-방법)
5. [데이터베이스 아키텍처 (샤딩)](#5-데이터베이스-아키텍처-샤딩)
6. [SQLAlchemy 비동기 규칙](#6-sqlalchemy-비동기-규칙)
7. [파일 경로 정책](#7-파일-경로-정책)
8. [백엔드 코드 수정 규칙](#8-백엔드-코드-수정-규칙)
9. [프론트엔드 코드 수정 규칙](#9-프론트엔드-코드-수정-규칙)
10. [Docker 수정 규칙](#10-docker-수정-규칙)
11. [AI 자동 레이블링 (SAM3)](#11-ai-자동-레이블링-sam3)
12. [LLM Agent 전용 주의사항](#12-llm-agent-전용-주의사항)
13. [자주 발생하는 오류와 해결법](#13-자주-발생하는-오류와-해결법)

---

## 1. 프로젝트 개요

ML 엔지니어용 데이터셋 관리 파이프라인.  
이미지 업로드 → 어노테이션 관리 → 분석/정제 → 버저닝 → AI 자동 레이블링 → 내보내기까지 하나의 웹앱에서 처리한다.

```
[Browser] → [Nginx:8080] → [FastAPI:8000] → [PostgreSQL:5432]
                                           → [data/ volume]
```

---

## 2. 디렉터리 구조

```
Dataset Pipeline FastAPI App/
├── docker-compose.yml          # 단일 DB 운영 (기본)
├── docker-compose.sharded.yml  # 멀티 DB 샤딩 운영 (Phase 2)
├── .env                        # docker-compose용 루트 환경변수
├── backend/
│   ├── Dockerfile
│   ├── .env                    # 백엔드 전용 환경변수 (DB 접속 정보 등)
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/env.py
│   └── app/
│       ├── main.py             # FastAPI 앱 진입점, 라우터 등록, lifespan
│       ├── core/config.py      # pydantic-settings 기반 설정
│       ├── database.py         # 메타 DB 엔진 & 세션 (AsyncSession)
│       ├── models/             # SQLAlchemy ORM 모델
│       ├── schemas/            # Pydantic 요청/응답 스키마
│       ├── routers/            # FastAPI 라우터 (API 엔드포인트)
│       ├── services/           # 비즈니스 로직
│       └── sharding/           # DB 샤딩 레이어
│           ├── config.py       # 샤드 설정 빌더
│           ├── registry.py     # shard_map 테이블 관리
│           └── router.py       # ShardRouter, get_sharded_db, get_meta_db
└── frontend/
    ├── Dockerfile              # 2단계 빌드: node builder → nginx
    ├── nginx.conf
    ├── vite.config.ts
    └── src/
        ├── api/                # axios API 클라이언트 함수
        ├── pages/              # React 페이지 컴포넌트
        ├── components/         # 공통 레이아웃 컴포넌트
        ├── store/index.ts      # Zustand 전역 상태 (selectedDataset)
        └── types/index.ts      # 공통 TypeScript 타입
```

---

## 3. 기술 스택 & 버전

| 영역 | 기술 | 버전 |
|------|------|------|
| 백엔드 | Python | 3.12 |
| 백엔드 | FastAPI | >=0.111 |
| 백엔드 | SQLAlchemy | >=2.0.31 (async 전용) |
| 백엔드 | asyncpg | >=0.29 |
| 백엔드 | Alembic | >=1.13 |
| 백엔드 | ultralytics (SAM3) | >=8.3.0 |
| 프론트엔드 | React | 18 |
| 프론트엔드 | TanStack Query | v5 |
| 프론트엔드 | Zustand | persist 미들웨어 사용 |
| 프론트엔드 | Vite | 5 |
| DB | PostgreSQL | 16-alpine |
| 컨테이너 | Docker Compose | v3.9 |

---

## 4. 실행 방법

### 개발 환경 (Docker)

```bash
# 처음 실행 또는 Dockerfile 변경 후
docker compose up --build

# 재시작 (코드만 변경)
docker compose up

# 중지 (데이터 보존)
docker compose stop

# 완전 초기화 (데이터 삭제 주의!)
docker compose down -v
```

> **주의:** `docker compose down` 만으로는 named volume `postgres_data`가 삭제되지 않는다.  
> `-v` 플래그를 붙여야 볼륨까지 삭제된다. 데이터를 유지하려면 절대 `-v`를 붙이지 말 것.

### 접속 URL

| 서비스 | URL |
|--------|-----|
| 프론트엔드 | http://localhost:8080 |
| API 문서 (Swagger) | http://localhost:8000/api/docs |
| 헬스체크 | http://localhost:8000/api/health |

### 로컬 개발 (Docker 없이)

```bash
# 백엔드
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 프론트엔드
cd frontend
npm install
npm run dev  # http://localhost:5173
```

---

## 5. 데이터베이스 아키텍처 (샤딩)

### 개념

이 앱은 **두 종류의 DB 세션**을 사용한다. 라우터에서 올바른 세션을 선택하는 것이 핵심이다.

| 세션 종류 | 저장 데이터 | Depends 함수 |
|-----------|------------|-------------|
| **메타 DB** (shard_0) | `datasets`, `versions`, `model_versions`, `auto_label_runs`, `shard_map` | `get_db()` |
| **샤드 DB** | `images`, `annotations`, `classes` | `get_sharded_db(dataset_id)` |

> **Phase 1 (현재):** `SHARD_COUNT=1`로 메타 DB와 샤드 DB가 동일한 PostgreSQL 인스턴스를 사용한다.  
> **Phase 2 (확장):** `SHARD_0_DB_HOST`, `SHARD_1_DB_HOST`, ... 환경변수로 별도 DB 서버 지정 가능.

### 라우터에서 세션 선택 규칙

```python
# datasets 테이블 조회 → 메타 DB
async def some_endpoint(db: AsyncSession = Depends(get_db)):
    ...

# images/annotations/classes 조회 → 샤드 DB
async def some_endpoint(dataset_id: int, db: AsyncSession = Depends(get_sharded_db)):
    ...

# 둘 다 필요한 경우 (auto_label.py 패턴)
from app.sharding.router import shard_router
meta_session = shard_router.get_meta_session()
shard_session = await shard_router.get_session_for_dataset(dataset_id)
```

### 데이터셋 생성 / 삭제 시 반드시 할 일

```python
# 생성: shard_map에 배정 등록
await shard_router.assign_dataset(dataset_id)

# 삭제: shard_map에서 제거
await shard_router.remove_dataset(dataset_id)
```

> 이 두 호출을 빠뜨리면 데이터셋이 DB에서 사라지거나 라우팅이 깨진다.

### 스키마 마이그레이션 정책

Alembic은 메타 DB 테이블(datasets 등)만 관리한다.  
샤드 DB 테이블 컬럼 추가는 `backend/app/sharding/router.py`의 `_ANNOTATION_MIGRATIONS` / `_RUN_MIGRATIONS` 리스트에 **idempotent ALTER TABLE** 구문을 추가한다.

```python
# sharding/router.py
_ANNOTATION_MIGRATIONS = [
    "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS my_new_col TEXT",
]
```

이 구문은 앱 시작 시 모든 샤드에 자동 적용된다.

---

## 6. SQLAlchemy 비동기 규칙

### ⚠️ 규칙 1: 모든 relationship에 `lazy="noload"` 필수

```python
# 올바른 패턴
image = relationship("Image", back_populates="annotations", lazy="noload")

# 잘못된 패턴 (MissingGreenlet 에러 발생)
image = relationship("Image", back_populates="annotations")
```

`lazy="noload"`가 없으면 SQLAlchemy가 관계 객체에 접근할 때 동기 DB 로드를 시도하고,  
비동기 컨텍스트에서 `MissingGreenlet` 예외가 발생한다.

**현재 모든 모델의 relationship에 `lazy="noload"`가 적용되어 있다. 새 relationship 추가 시 반드시 포함할 것.**

### ⚠️ 규칙 2: relationship을 통한 데이터 접근 금지, 직접 쿼리 사용

```python
# 잘못된 패턴 — lazy="noload"이므로 항상 빈 리스트 반환
count = len(dataset.images)  # 항상 0

# 올바른 패턴 — 직접 COUNT 쿼리
count = await db.scalar(
    select(func.count(Image.id)).where(Image.dataset_id == dataset_id)
)
```

### ⚠️ 규칙 3: back_populates는 양측이 정확히 일치해야 한다

```python
# dataset.py
images = relationship("Image", back_populates="dataset", ...)

# image.py
dataset = relationship("Dataset", back_populates="images", ...)
# back_populates 값이 반드시 상대 모델의 attribute 이름과 동일해야 한다
```

현재 사용 중인 back_populates 매핑:

| 모델 A | 속성 | 모델 B | 속성 |
|--------|------|--------|------|
| Dataset | `images` | Image | `dataset` |
| Dataset | `classes` | Class | `dataset` |
| Dataset | `ontology_histories` | OntologyHistory | `dataset` |
| Image | `annotations` | Annotation | `image` |
| Class | `annotations` | Annotation | `cls` |

> **Annotation 모델에서 Class 관계의 속성명은 `cls`이다 (`class_`나 `class_obj`가 아님).**  
> 이 이름을 바꾸면 `Mapper has no property` 에러가 발생한다.

---

## 7. 파일 경로 정책

DB의 `Image.filepath` 컬럼에는 **uploads_dir 기준 상대경로**를 저장한다.

```
DB 저장값:  "3/a1b2c3d4_photo.jpg"
실제 경로:  /app/data/uploads/3/a1b2c3d4_photo.jpg
```

파일에 접근할 때는 반드시 `resolve_filepath()`를 사용한다:

```python
from app.services.file_handler import resolve_filepath

abs_path = resolve_filepath(image.filepath)
```

> **하위 호환:** 과거에 절대경로(`/app/data/...`)로 저장된 레코드는 `resolve_filepath()`가 그대로 반환한다.

볼륨 마운트:
```yaml
# docker-compose.yml
volumes:
  - ./backend/data:/app/data
```

컨테이너 내부 경로 `/app/data/uploads`가 호스트의 `./backend/data/uploads`에 매핑된다.

---

## 8. 백엔드 코드 수정 규칙

### 새 모델 추가

1. `backend/app/models/` 에 파일 생성
2. `backend/app/models/__init__.py`에 import 추가 (순환참조 주의)
3. 모든 relationship에 `lazy="noload"` 추가
4. `back_populates` 양측 일치 확인
5. 메타 DB 테이블이면 `alembic revision --autogenerate` 후 `alembic upgrade head`
6. 샤드 DB 테이블이면 `sharding/router.py`의 migration 리스트에 ADD COLUMN 추가

### 새 라우터 추가

1. `backend/app/routers/` 에 파일 생성
2. `backend/app/main.py`에 import 후 `app.include_router(...)` 등록
3. API prefix는 반드시 `/api/v1` (예: `prefix=API_PREFIX`)

### 어떤 세션을 Depends로 받을지

- 데이터셋 메타정보 → `Depends(get_db)` (메타 DB)
- 이미지/어노테이션/클래스 → `Depends(get_sharded_db)` (샤드 DB)
- 둘 다 필요 → `shard_router.get_meta_session()` / `shard_router.get_session_for_dataset(dataset_id)` 직접 호출

---

## 9. 프론트엔드 코드 수정 규칙

### API 클라이언트 패턴

`frontend/src/api/client.ts`의 axios 인스턴스를 공유한다. 새 API 파일은 이 client를 import한다:

```typescript
import client from './client'

export const myApi = {
  getData: (id: number) => client.get<MyType>(`/my-endpoint/${id}`),
}
```

### TanStack Query v5 패턴

```typescript
// 조회
const { data } = useQuery({
  queryKey: ['myData', id],
  queryFn: () => myApi.getData(id),
  enabled: !!id,
  select: (r) => r.data,
})

// 변경 (mutation)
const mut = useMutation({
  mutationFn: (payload: MyPayload) => myApi.update(id, payload),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['myData'] }),
})
```

> TanStack Query v5에서 `onError`는 `useMutation` 옵션에서 제거됐다. 에러는 `mut.error`로 읽는다.

### 전역 상태 (Zustand)

현재 전역 상태는 `selectedDataset` 하나다. `useAppStore()`로 접근:

```typescript
const { selectedDataset, setSelectedDataset } = useAppStore()
```

`persist` 미들웨어로 localStorage에 저장된다. 새 전역 상태가 필요하면 `store/index.ts`에 추가한다.  
단, localStorage에는 민감 정보나 대용량 데이터를 저장하지 말 것.

### 새 페이지 추가

1. `frontend/src/pages/`에 컴포넌트 생성
2. `frontend/src/App.tsx`에 Route 추가
3. `frontend/src/components/Layout/Sidebar.tsx`에 메뉴 항목 추가

---

## 10. Docker 수정 규칙

### docker-compose.yml 필수 항목

```yaml
volumes:
  postgres_data:   # ← 반드시 최상단 volumes 섹션에 선언해야 named volume으로 동작
                   # 선언 없으면 anonymous volume → docker compose down 시 데이터 삭제
```

### backend/Dockerfile 필수 apt 패키지

```dockerfile
RUN apt-get update && apt-get install -y \
    libpq-dev gcc libglib2.0-0 libgomp1 postgresql-client \
    libgl1 libglib2.0-dev \    # OpenCV (SAM3) 필수
    && rm -rf /var/lib/apt/lists/*
```

`libgl1`과 `libglib2.0-dev`가 없으면 OpenCV import 시 `libGL.so.1: cannot open shared object file` 오류 발생.

### CMD는 완전한 JSON 배열이어야 한다

```dockerfile
# 올바름
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# 잘못됨 (파일이 잘린 경우) — 컨테이너 시작 실패
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0",
```

### 백엔드 컨테이너 시작 명령 (docker-compose.yml)

```yaml
command: >
  sh -c "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
```

`alembic upgrade head`가 선행되어야 메타 DB 테이블이 생성된다.

---

## 11. AI 자동 레이블링 (SAM3)

### 동작 흐름

```
POST /api/v1/auto-label/datasets/{id}/runs
  → AutoLabelRun 레코드 생성 (status=pending)
  → BackgroundTask: _run_auto_label()
      → SAM3SemanticPredictor.predict_image(path, text_prompts)
      → mask → bbox (np.where)
      → mask → polygon (cv2.findContours)
      → Annotation 레코드 저장
  → status=completed / failed
```

### 모델 파일 경로

SAM3 모델(`sam3.pt`)은 첫 실행 시 ultralytics가 자동 다운로드한다.  
다운로드 후 `data/models/sam3.pt`로 이동 저장된다 (볼륨 마운트 경로 → 컨테이너 재시작 후에도 유지).

모델 캐시 경로: `/app/data/models/sam3.pt` (컨테이너 내부)

### text_prompts 직렬화

`AutoLabelRun.text_prompts` 컬럼은 `TEXT` 타입으로, 프롬프트 배열을 JSON 문자열로 저장한다:

```python
# 저장
run.text_prompts = json.dumps(["person", "car"])

# 읽기
prompts = json.loads(run.text_prompts)
```

프론트엔드에서는 `parseTextPrompts(raw)` 함수로 파싱한다.

### iou_threshold

SAM3는 IoU threshold를 사용하지 않는다. `AutoLabelRun.iou_threshold` 컬럼은 0.0으로 저장되며, 레거시 호환을 위해 스키마에 남겨둔다.

---

## 12. LLM Agent 전용 주의사항

이 섹션은 Claude, GPT 등 LLM Agent가 이 코드베이스를 수정할 때 반드시 읽어야 하는 항목이다.

---

### ⛔ 경고 1: 한국어가 포함된 파일은 Write/Edit 툴로 직접 쓰면 잘린다

**증상:** 파일 중간이나 끝이 갑자기 잘리고, Python/YAML/Dockerfile 파일이 문법 오류 상태가 된다.

**원인:** 한국어(UTF-8 멀티바이트) 문자가 포함된 파일을 Write/Edit 툴로 작성하면 내용이 truncate된다.

**해결:** 항상 bash heredoc으로 파일을 작성한다:

```bash
cat > /path/to/file.py << 'PYEOF'
# 파일 내용 (한국어 포함 가능)
PYEOF
```

**확인:** 파일 수정 후 반드시 문법 검사:

```bash
python -c "import ast; ast.parse(open('backend/app/some_file.py').read()); print('OK')"
```

---

### ⛔ 경고 2: relationship 추가 시 lazy="noload" 누락 금지

새 `relationship()`을 추가할 때 `lazy="noload"` 없이 작성하면, 해당 관계에 접근하는 모든 API가 `MissingGreenlet` 에러로 500 응답을 반환한다.

```python
# 반드시 이렇게
new_rel = relationship("OtherModel", back_populates="...", lazy="noload")
```

---

### ⛔ 경고 3: back_populates 이름 변경 금지

`Annotation.cls`, `Image.dataset`, `Dataset.images` 등 기존 back_populates 속성 이름을 바꾸면 앱 시작 시 `Mapper has no property 'xxx'` 오류가 발생한다.  
**특히 `cls`는 Python 예약어처럼 보이지만 실제로 예약어가 아니며, 이 프로젝트에서 Class 관계의 이름으로 사용된다. `class_obj`로 바꾸지 말 것.**

---

### ⛔ 경고 4: docker-compose.yml의 named volume 선언 삭제 금지

```yaml
volumes:
  postgres_data:   # ← 이 선언을 절대 삭제하지 말 것
```

이 선언이 없으면 postgres_data가 anonymous volume으로 처리되어, `docker compose down` 시 PostgreSQL 데이터가 전부 사라진다.

---

### ⛔ 경고 5: Dockerfile CMD 수정 시 완전한 JSON 배열 확인

Dockerfile의 마지막 CMD 라인은 완전한 JSON 배열이어야 한다. 파일 작성 후 반드시 확인:

```bash
tail -5 backend/Dockerfile
# CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
# 위처럼 닫히는 ] 가 있어야 한다
```

---

### ⛔ 경고 6: 샤드 DB 테이블 컬럼 추가는 Alembic이 아닌 migration 리스트로

`images`, `annotations`, `classes` 테이블의 컬럼을 추가하거나 수정할 때 Alembic migration을 만들면 안 된다. Alembic은 메타 DB만 관리하기 때문에 샤드 DB에는 적용되지 않는다.

**올바른 방법:**

```python
# backend/app/sharding/router.py
_ANNOTATION_MIGRATIONS = [
    "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS new_col TEXT",
    # ← 기존 항목을 지우지 말고, 새 항목을 추가
]
```

기존 마이그레이션 항목을 삭제하면 앱을 처음 배포하는 환경에서 컬럼이 누락된다.

---

### ⛔ 경고 7: 새 라우터를 main.py에 반드시 등록

라우터 파일만 만들고 `main.py`에 `include_router`를 빠뜨리면 API가 전혀 노출되지 않는다.

```python
# backend/app/main.py
from app.routers.my_new_router import router as my_router
app.include_router(my_router, prefix=API_PREFIX)
```

---

### ✅ 수정 전 체크리스트

파일을 수정하기 전에 다음을 확인한다:

- [ ] 한국어가 포함되는가? → bash heredoc 사용
- [ ] relationship을 추가/수정하는가? → `lazy="noload"` 및 `back_populates` 양측 일치 확인
- [ ] 새 DB 컬럼을 추가하는가? → 메타/샤드 여부에 따라 Alembic 또는 migration 리스트
- [ ] 새 라우터를 만드는가? → `main.py`에 등록 여부 확인
- [ ] docker-compose.yml을 수정하는가? → `volumes: postgres_data:` 선언 보존 확인
- [ ] Dockerfile을 수정하는가? → CMD 줄 완결성 확인
- [ ] 수정 완료 후 → Python 파일은 `ast.parse` 문법 검사

---

## 13. 자주 발생하는 오류와 해결법

### `MissingGreenlet` / `greenlet_spawn` 에러

**원인:** SQLAlchemy relationship에 `lazy="noload"` 누락  
**해결:** 해당 모델의 relationship에 `lazy="noload"` 추가

```python
some_rel = relationship("OtherModel", back_populates="xxx", lazy="noload")
```

---

### `Mapper has no property 'xxx'`

**원인:** `back_populates`에 지정한 이름이 상대 모델에 없음  
**해결:** 양측 모델에서 `back_populates` 문자열이 서로의 attribute 이름과 일치하는지 확인

---

### `docker compose down` 후 데이터 사라짐

**원인:** `docker compose down -v` 실행 또는 `volumes: postgres_data:` 선언 누락  
**해결:** 
- `docker-compose.yml` 최하단에 `volumes:\n  postgres_data:` 선언 존재 여부 확인
- 앞으로는 `docker compose stop` / `docker compose down` (v 없이) 사용

---

### `502 Bad Gateway`

**원인 1:** 백엔드 컨테이너가 아직 시작 중 (alembic upgrade 실행 중)  
→ `docker compose logs backend` 로 확인 후 완료 대기

**원인 2:** 백엔드가 DB 연결 실패로 crash  
→ `docker compose logs db`로 PostgreSQL 상태 확인

**원인 3:** nginx proxy_read_timeout 초과 (무거운 AI 작업)  
→ `frontend/nginx.conf`의 `proxy_read_timeout` 값 확인

---

### `libGL.so.1: cannot open shared object file`

**원인:** backend Dockerfile에 `libgl1` apt 패키지 누락  
**해결:** Dockerfile RUN apt-get 블록에 `libgl1 libglib2.0-dev` 추가 후 `docker compose up --build`

---

### 프론트엔드 데이터셋 무한 로딩

**원인 1:** 백엔드 API 응답이 `{ items: [], total: 0 }` 형식이 아님 (형식 불일치)  
**원인 2:** 프론트엔드가 `selectedDataset`을 localStorage에서 복원했으나 백엔드 DB에 해당 ID가 없음  
**해결:** Zustand store의 `selectedDataset`을 null로 초기화 후 재선택

---

### SAM3 첫 실행 시 타임아웃

**원인:** `sam3.pt` 모델 파일 자동 다운로드 중 (수 GB)  
**해결:** 첫 실행은 타임아웃이 길어질 수 있다. 백엔드 로그로 다운로드 진행상황 확인:

```bash
docker compose logs -f backend
```

다운로드 완료 후 모델은 `./backend/data/models/sam3.pt`에 캐싱된다.

---

*최종 업데이트: 2026-05-21*
