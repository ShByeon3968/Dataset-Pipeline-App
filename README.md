# Dataset Pipeline — 개발 가이드라인

> **대상:** 이 레포를 처음 접하는 동료 개발자, 그리고 코드를 자동으로 수정하는 LLM Agent  
> **목적:** 반복 발생한 빌드·DB 오류 패턴을 문서화하고, 일관된 코드 수정 방법을 정의한다.

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [디렉터리 구조](#2-디렉터리-구조)
3. [기술 스택 & 버전](#3-기술-스택--버전)
4. [실행 방법](#4-실행-방법)
5. [파이프라인 기능 목록](#5-파이프라인-기능-목록)
6. [데이터베이스 아키텍처 (샤딩)](#6-데이터베이스-아키텍처-샤딩)
7. [SQLAlchemy 비동기 규칙](#7-sqlalchemy-비동기-규칙)
8. [파일 경로 정책](#8-파일-경로-정책)
9. [버전 관리 & 롤백 정책](#9-버전-관리--롤백-정책)
10. [합성 데이터 생성 & 품질 평가](#10-합성-데이터-생성--품질-평가)
11. [백엔드 코드 수정 규칙](#11-백엔드-코드-수정-규칙)
12. [프론트엔드 코드 수정 규칙](#12-프론트엔드-코드-수정-규칙)
13. [Docker 수정 규칙](#13-docker-수정-규칙)
14. [AI 자동 레이블링](#14-ai-자동-레이블링)
15. [LLM Agent 전용 주의사항](#15-llm-agent-전용-주의사항)
16. [자주 발생하는 오류와 해결법](#16-자주-발생하는-오류와-해결법)

---

## 1. 프로젝트 개요

ML 엔지니어용 데이터셋 관리 파이프라인.  
이미지 업로드 → 합성 데이터 생성 및 품질 평가 → 어노테이션 → AI 자동 레이블링 → 분석/정제 → 버저닝 & 롤백 → 내보내기까지 하나의 웹앱에서 처리한다.

```
[Browser] → [Nginx:8085] → [FastAPI:8005] → [PostgreSQL:5433]
                                           → [data/uploads/ (이미지)]
                                           → [data/snapshots/ (버전 스냅샷 JSON)]
                                           → [data/synthetic/ (합성 데이터)]
                                           → [/models/ (AI 모델 캐시, HF_HOME)]
```

---

## 2. 디렉터리 구조

```
Dataset-Pipeline-App/
├── docker-compose.yml          # 단일 DB 운영 (현재 기본)
├── .env                        # docker-compose용 루트 환경변수 (DB_USER, UPLOADS_HOST_PATH 등)
├── data/
│   ├── uploads/                # 이미지 원본 (Soft Delete로 보존)
│   ├── exports/                # Export ZIP 결과물
│   └── synthetic/              # 합성 데이터 생성 결과
├── backend/
│   ├── Dockerfile
│   ├── .env                    # 백엔드 전용 환경변수 (DB 접속 정보 등)
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/env.py
│   ├── data/
│   │   ├── models/             # AI 모델 캐시 (/models 볼륨 마운트 대상)
│   │   ├── snapshots/          # 버전 롤백용 JSON 스냅샷 파일
│   │   └── evaluation/         # 품질 평가 임시 데이터
│   └── app/
│       ├── main.py             # FastAPI 앱 진입점, 라우터 등록, lifespan
│       ├── core/config.py      # pydantic-settings 기반 설정
│       ├── database.py         # 메타 DB 엔진 & 세션 (AsyncSession), idempotent migration
│       ├── models/             # SQLAlchemy ORM 모델
│       │   ├── image.py
│       │   ├── annotation.py
│       │   ├── class_.py
│       │   ├── dataset.py
│       │   ├── version.py      # DatasetVersion, ModelVersion, ModelDatasetLink
│       │   ├── auto_label_run.py
│       │   └── onnx_model.py
│       ├── schemas/            # Pydantic 요청/응답 스키마
│       ├── routers/            # FastAPI 라우터 (API 엔드포인트)
│       │   ├── datasets.py
│       │   ├── images.py       # Soft Delete 정책 적용 (물리 파일 보존)
│       │   ├── annotations.py
│       │   ├── classes.py
│       │   ├── versions.py     # 버전 CRUD + 롤백 + GC
│       │   ├── lineage.py      # 모델 버전 & 리니지 그래프
│       │   ├── synthetic.py    # 합성 데이터 생성 & 품질 평가
│       │   ├── auto_label.py   # AI 자동 레이블링 (YOLO-World)
│       │   ├── onnx_models.py  # 커스텀 ONNX 모델 추론
│       │   ├── analysis.py     # 데이터셋 분석 & 임베딩
│       │   ├── refinement.py   # 데이터 정제 (중복/노이즈 제거)
│       │   ├── ontology.py     # 클래스 온톨로지 관리
│       │   ├── export.py       # 데이터셋 내보내기
│       │   └── sharding.py     # 샤딩 상태 조회
│       ├── services/           # 비즈니스 로직
│       │   ├── versioning_service.py   # 스냅샷 저장, 롤백, GC
│       │   ├── synthetic/              # 합성 데이터 서비스
│       │   │   ├── generator_flux.py   # FLUX.2-klein 멀티 GPU 생성
│       │   │   ├── generator_qwen.py   # Qwen VLM 기반 프롬프트 생성
│       │   │   ├── evaluator_domain.py # FID/KID 도메인 갭 평가
│       │   │   ├── evaluator_lpips.py  # LPIPS 지각 유사도 평가
│       │   │   └── evaluator_quality.py # BRISQUE/Sharpness 품질 평가
│       │   ├── file_handler.py
│       │   ├── import_service.py       # COCO/YOLO ZIP 임포트
│       │   ├── analysis.py
│       │   ├── embedding_service.py
│       │   ├── exporter.py
│       │   └── ...
│       └── sharding/           # DB 샤딩 레이어
│           ├── config.py
│           ├── registry.py
│           └── router.py       # ShardRouter, idempotent migrations
└── frontend/
    ├── Dockerfile              # 2단계 빌드: node builder → nginx
    ├── nginx.conf
    ├── vite.config.ts
    ├── package.json
    └── src/
        ├── api/                # axios API 클라이언트
        │   ├── client.ts
        │   ├── versions.ts     # 버전, 롤백, GC, 리니지 API
        │   └── ...
        ├── pages/              # React 페이지 컴포넌트
        │   ├── Home.tsx
        │   ├── Upload.tsx
        │   ├── SyntheticData.tsx   # 합성 데이터 생성 & 품질 평가 (차트 포함)
        │   ├── Labeling.tsx
        │   ├── AutoLabel.tsx
        │   ├── Analysis.tsx
        │   ├── Refinement.tsx
        │   ├── Ontology.tsx
        │   ├── Export.tsx
        │   └── Versioning.tsx  # 버전 히스토리, 리니지 그래프, 롤백, GC
        ├── components/
        │   └── Layout/         # Sidebar, Layout
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
| 백엔드 | ultralytics (YOLO-World) | >=8.3.0 |
| 백엔드 | diffusers (FLUX.2) | git main |
| 백엔드 | transformers | >=4.45.0 |
| 백엔드 | lpips / piq | 합성 품질 평가 |
| 프론트엔드 | React | 18 |
| 프론트엔드 | TanStack Query | v5 |
| 프론트엔드 | Zustand | persist 미들웨어 |
| 프론트엔드 | Vite | 5 |
| 프론트엔드 | Recharts | ^2.12.7 (품질 평가 차트) |
| 프론트엔드 | ReactFlow | ^11 (리니지 그래프) |
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
| 프론트엔드 | http://localhost:8085 |
| API 문서 (Swagger) | http://localhost:8005/api/docs |
| 헬스체크 | http://localhost:8005/api/health |

> **포트 변경:** 기존 문서의 8080/8000 포트는 현재 8085/8005 로 변경되어 있다.

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

### 환경 변수 (.env 예시)

```bash
# 루트 .env
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=dataset_pipeline

# NAS 연동 시 설정 (없으면 로컬 ./data/uploads 사용)
# UPLOADS_HOST_PATH=/mnt/nas/dataset_pipeline/uploads
# EXPORTS_HOST_PATH=/mnt/nas/dataset_pipeline/exports

# 서버 IP CORS 허용
# CORS_ORIGINS_RAW=http://10.101.0.23:8085,http://localhost:8085
```

### GPU 설정

`docker-compose.yml`에 NVIDIA GPU 사용이 설정되어 있다:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

합성 데이터 생성(Flux)은 멀티 GPU를 지원한다. GPU 선택은 UI에서 GPU ID 배열로 지정.

---

## 5. 파이프라인 기능 목록

| 순서 | 메뉴 | 라우터 | 주요 기능 |
|------|------|--------|----------|
| 1 | 업로드 | `images.py` | 단일/ZIP/어노테이션 ZIP/Roboflow/비디오 업로드, 이미지 중복 해시 체크 |
| 2 | 합성데이터 생성 및 검증 | `synthetic.py` | FLUX.2-klein 멀티GPU 이미지 생성, Qwen 프롬프트 생성, FID/LPIPS/BRISQUE 품질 평가, 차트 시각화 |
| 3 | 레이블링 | `annotations.py` | 이미지별 바운딩박스/폴리곤 어노테이션, 배치 필터 |
| 4 | AI 자동 레이블링 | `auto_label.py` | YOLO-World 텍스트 프롬프트 기반 자동 검출, ONNX 커스텀 모델 추론 |
| 5 | 분석 | `analysis.py` | 클래스 분포, 임베딩 시각화(UMAP/PCA/t-SNE), COCO 통계 |
| 6 | 정제 | `refinement.py` | 중복 이미지 탐지, 노이즈 제거, 분할(train/val/test) |
| 7 | 온톨로지 | `ontology.py` | 클래스 계층 관리, 병합/매핑 규칙 |
| 8 | 내보내기 | `export.py` | COCO / YOLO / Pascal VOC 형식 ZIP 내보내기 |
| 9 | 버저닝 | `versions.py` / `lineage.py` | 스냅샷 생성, 버전 히스토리, 롤백, GC(고아 파일 정리), 모델 리니지 그래프 |

---

## 6. 데이터베이스 아키텍처 (샤딩)

### 개념

이 앱은 **두 종류의 DB 세션**을 사용한다. 라우터에서 올바른 세션을 선택하는 것이 핵심이다.

| 세션 종류 | 저장 데이터 | Depends 함수 |
|-----------|------------|-------------|
| **메타 DB** (shard_0) | `datasets`, `dataset_versions`, `model_versions`, `model_dataset_links`, `auto_label_runs`, `shard_map`, `onnx_models`, `ontology_*` | `get_meta_db()` |
| **샤드 DB** | `images`, `annotations`, `classes` | `get_sharded_db(dataset_id)` |

> **Phase 1 (현재):** `SHARD_COUNT=1`로 메타 DB와 샤드 DB가 동일한 PostgreSQL 인스턴스를 사용한다.  
> **Phase 2 (확장):** `SHARD_0_DB_HOST`, `SHARD_1_DB_HOST`, ... 환경변수로 별도 DB 서버 지정 가능.

### 라우터에서 세션 선택 규칙

```python
# datasets 테이블 조회 → 메타 DB
async def some_endpoint(meta_db: AsyncSession = Depends(get_meta_db)):
    ...

# images/annotations/classes 조회 → 샤드 DB
async def some_endpoint(dataset_id: int, db: AsyncSession = Depends(get_sharded_db)):
    ...

# 버저닝처럼 둘 다 필요한 경우
async def create_version(
    meta_db: AsyncSession = Depends(get_meta_db),
    shard_db: AsyncSession = Depends(get_sharded_db),
):
    ...
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

**메타 DB 테이블** (`dataset_versions`, `datasets` 등) 컬럼 추가:  
→ `backend/app/database.py`의 `create_tables()` 내 `_META_MIGRATIONS` 리스트에 idempotent ALTER TABLE 추가.

```python
# database.py
_META_MIGRATIONS = [
    "ALTER TABLE dataset_versions ADD COLUMN IF NOT EXISTS snapshot_path VARCHAR(500)",
]
```

**샤드 DB 테이블** (`images`, `annotations`, `classes`) 컬럼 추가:  
→ `backend/app/sharding/router.py`의 `_IMAGE_MIGRATIONS` / `_ANNOTATION_MIGRATIONS` 리스트에 추가.

```python
# sharding/router.py
_ANNOTATION_MIGRATIONS = [
    "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS my_new_col TEXT",
]
```

두 리스트 모두 앱 시작 시 자동 적용된다. **기존 항목을 삭제하지 말 것.**

---

## 7. SQLAlchemy 비동기 규칙

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

현재 사용 중인 back_populates 매핑:

| 모델 A | 속성 | 모델 B | 속성 |
|--------|------|--------|------|
| Dataset | `images` | Image | `dataset` |
| Dataset | `classes` | Class | `dataset` |
| Image | `annotations` | Annotation | `image` |
| Class | `annotations` | Annotation | `cls` |
| DatasetVersion | `model_links` | ModelDatasetLink | `dataset_version` |
| ModelVersion | `dataset_links` | ModelDatasetLink | `model_version` |

> **Annotation 모델에서 Class 관계의 속성명은 `cls`이다 (`class_`나 `class_obj`가 아님).**  
> 이 이름을 바꾸면 `Mapper has no property` 에러가 발생한다.

---

## 8. 파일 경로 정책

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
  - ${UPLOADS_HOST_PATH:-./data/uploads}:/app/data/uploads
  - ${EXPORTS_HOST_PATH:-./data/exports}:/app/data/exports
  - ./data/synthetic:/app/data/synthetic
  - ./backend/data/models:/models   # AI 모델 캐시 (HF_HOME=/models)
```

### ⚠️ Soft Delete 정책 (물리 파일 보존)

**이미지를 UI에서 삭제해도 물리 파일(`.jpg` 등)은 삭제하지 않는다.** DB 레코드만 삭제된다.  
이 정책은 롤백 시 물리 파일이 그대로 남아 있어 완전 복구가 가능하도록 하기 위함이다.

디스크 공간 확보가 필요할 때는 **버저닝 페이지 → "🗑️ 파일 정리 (GC)"** 버튼을 사용한다.

```python
# routers/images.py - DELETE /{image_id}
# Soft Delete: DB 레코드만 삭제, 물리 파일 보존
await db.execute(sa_delete(Annotation).where(Annotation.image_id == image_id))
await db.delete(img)
# delete_file() 호출 없음
```

---

## 9. 버전 관리 & 롤백 정책

### 버전 스냅샷 생성

"스냅샷 생성" 시 다음 두 가지가 동시에 저장된다:

1. **메타 DB:** `DatasetVersion` 레코드 (통계, diff, 브랜치 등)
2. **물리 스냅샷 파일:** `data/snapshots/dataset_{id}_{uuid}.json`
   - 해당 시점의 `Image` + `Annotation` 테이블 전체 덤프

스냅샷 파일 경로는 `DatasetVersion.snapshot_path` 컬럼에 저장되며, API 응답에는 존재 여부(`has_snapshot: bool`)만 노출된다.

### 롤백 (Rollback)

```
POST /api/v1/datasets/{id}/versions/{vid}/rollback
```

1. 현재 `images` / `annotations` DB 레코드를 전부 삭제 (물리 파일 보존!)
2. 스냅샷 JSON을 읽어 `Image` / `Annotation` 레코드 재삽입
3. 물리 파일이 없는 이미지는 `missing_physical_files` 목록으로 반환

> 롤백 버튼은 `has_snapshot=true`인 버전 카드에만 표시된다.

### 고아 파일 정리 (GC)

```
POST /api/v1/datasets/{id}/gc
```

`uploads/{dataset_id}/` 디렉토리를 스캔하여 DB에 없는 파일을 삭제한다.  
`freed_mb` 필드로 확보된 용량을 반환한다.

UI: 버저닝 페이지 헤더 → **"🗑️ 파일 정리 (GC)"** 버튼

### 리니지 그래프

```
GET /api/v1/datasets/{id}/lineage
```

데이터셋 버전(파란색 노드)과 이를 기반으로 학습된 모델 버전(초록색 노드)의 족보를 ReactFlow 기반 DAG로 시각화한다.

---

## 10. 합성 데이터 생성 & 품질 평가

### 생성 흐름

```
POST /api/v1/synthetic/{dataset_id}/generate
  → Qwen VLM으로 이미지 캡션/프롬프트 생성 (선택)
  → FLUX.2-klein-4B 멀티 GPU 워커로 이미지 생성 (멀티프로세싱)
  → 생성 완료 후 입력 이미지 폴더 자동 삭제 (디스크 절약)
  → 진행상황: SSE 스트리밍 또는 폴링 (GET /status/{task_id})
```

### 품질 평가 흐름

```
POST /api/v1/synthetic/{dataset_id}/evaluate
  → 평가 태스크 비동기 실행
  → evaluator_domain.py: FID / KID (도메인 갭)
  → evaluator_lpips.py:  LPIPS (지각 유사도)
  → evaluator_quality.py: BRISQUE / Sharpness (이미지 품질)
  → 각 evaluator가 멀티프로세싱 Queue로 {"__METRICS__": {...}} 전송
  → _queue_reader가 메트릭 수신 → _task_store에 저장
  → 프론트엔드가 /status/{task_id} 폴링으로 메트릭 수신 → Recharts 차트 렌더링
```

### 주요 파일

| 파일 | 역할 |
|------|------|
| `routers/synthetic.py` | 태스크 관리, SSE, 멀티프로세싱 Queue 리더 |
| `services/synthetic/generator_flux.py` | FLUX.2-klein-4B 멀티 GPU 이미지 생성 |
| `services/synthetic/generator_qwen.py` | Qwen2-VL 캡션 생성 |
| `services/synthetic/evaluator_domain.py` | piq 기반 FID/KID |
| `services/synthetic/evaluator_lpips.py` | lpips 기반 LPIPS |
| `services/synthetic/evaluator_quality.py` | BRISQUE/Laplacian Sharpness |

### 메트릭 데이터 포맷 (Queue 메시지)

```python
# evaluator → queue
{"__METRICS__": {
    "lpips": {"mean": 0.32, "min": 0.12, "max": 0.67, "std": 0.15},
    "domain": {"fid": 42.3, "kid_mean": 0.021},
    "quality": {"brisque_real_mean": 28.4, "sharpness_synthetic_mean": 210.5},
}}
```

---

## 11. 백엔드 코드 수정 규칙

### 새 모델 추가

1. `backend/app/models/` 에 파일 생성
2. `backend/app/models/__init__.py`에 import 추가 (순환참조 주의)
3. 모든 relationship에 `lazy="noload"` 추가
4. `back_populates` 양측 일치 확인
5. **메타 DB 테이블이면** `database.py`의 `_META_MIGRATIONS`에 `ADD COLUMN IF NOT EXISTS` 추가
6. **샤드 DB 테이블이면** `sharding/router.py`의 migration 리스트에 ADD COLUMN 추가

### 새 라우터 추가

1. `backend/app/routers/` 에 파일 생성
2. `backend/app/main.py`에 import 후 `app.include_router(...)` 등록
3. API prefix는 반드시 `/api/v1`

### 어떤 세션을 Depends로 받을지

- 데이터셋 메타정보, 버전, 모델 버전 → `Depends(get_meta_db)` (메타 DB)
- 이미지/어노테이션/클래스 → `Depends(get_sharded_db)` (샤드 DB)
- 버저닝처럼 둘 다 필요 → 두 Depends를 모두 받음

---

## 12. 프론트엔드 코드 수정 규칙

### API 클라이언트 패턴

`frontend/src/api/client.ts`의 axios 인스턴스를 공유한다.

```typescript
import client from './client'

export const myApi = {
  getData: (id: number) => client.get<MyType>(`/my-endpoint/${id}`).then(r => r.data),
}
```

### TanStack Query v5 패턴

```typescript
// 조회
const { data } = useQuery({
  queryKey: ['myData', id],
  queryFn: () => myApi.getData(id),
  enabled: !!id,
})

// 변경 (mutation)
const mut = useMutation({
  mutationFn: (payload: MyPayload) => myApi.update(id, payload),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['myData'] }),
  onError: (e: Error) => toast.error(e.message),  // v5: onError는 여기서 처리
})
```

### 전역 상태 (Zustand)

```typescript
const { selectedDataset, setSelectedDataset } = useAppStore()
```

`persist` 미들웨어로 localStorage에 저장된다. 민감 정보나 대용량 데이터는 저장 금지.

### 새 페이지 추가

1. `frontend/src/pages/`에 컴포넌트 생성
2. `frontend/src/App.tsx`에 Route 추가
3. `frontend/src/components/Layout/Sidebar.tsx`에 메뉴 항목 추가

---

## 13. Docker 수정 규칙

### docker-compose.yml 필수 항목

```yaml
volumes:
  postgres_data:        # ← 반드시 최상단 volumes 섹션에 선언 (named volume)
  backend_embeddings:   # ← 임베딩 캐시 볼륨
```

선언이 없으면 anonymous volume → `docker compose down` 시 데이터 삭제됨.

### backend/Dockerfile 필수 apt 패키지

```dockerfile
RUN apt-get update && apt-get install -y \
    libpq-dev gcc libglib2.0-0 libgomp1 postgresql-client \
    libgl1 libglib2.0-dev \
    && rm -rf /var/lib/apt/lists/*
```

`libgl1`과 `libglib2.0-dev`가 없으면 OpenCV import 시 `libGL.so.1: cannot open shared object file` 오류 발생.

### CMD는 완전한 JSON 배열이어야 한다

```dockerfile
# 올바름
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 백엔드 컨테이너 시작 명령 (docker-compose.yml)

```yaml
command: >
  sh -c "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
```

`alembic upgrade head`가 선행되어야 메타 DB 테이블이 생성된다.

---

## 14. AI 자동 레이블링

### 동작 흐름

```
POST /api/v1/auto-label/datasets/{id}/runs
  → AutoLabelRun 레코드 생성 (status=pending)
  → BackgroundTask: _run_auto_label()
      → YOLO-World: text_prompts 기반 open-vocabulary 객체 검출
      → mask → bbox (np.where) / polygon (cv2.findContours)
      → Annotation 레코드 저장
  → status=completed / failed
```

### 모델 파일 경로

YOLO-World / SAM 모델은 첫 실행 시 ultralytics / HuggingFace가 자동 다운로드한다.  
`HF_HOME=/models` 환경변수로 캐시 경로를 `/models` (볼륨 마운트)에 고정한다.  
→ 컨테이너 재시작 후에도 모델 재다운로드 없이 바로 실행된다.

### text_prompts 직렬화

`AutoLabelRun.text_prompts` 컬럼은 `TEXT` 타입으로, 프롬프트 배열을 JSON 문자열로 저장한다:

```python
# 저장
run.text_prompts = json.dumps(["person", "car"])

# 읽기
prompts = json.loads(run.text_prompts)
```

---

## 15. LLM Agent 전용 주의사항

이 섹션은 Claude, GPT 등 LLM Agent가 이 코드베이스를 수정할 때 반드시 읽어야 하는 항목이다.

---

### ⛔ 경고 1: 한국어가 포함된 파일은 Write/Edit 툴로 직접 쓰면 잘린다

**증상:** 파일 중간이나 끝이 갑자기 잘리고, Python/YAML/Dockerfile 파일이 문법 오류 상태가 된다.

**해결:** 항상 bash heredoc으로 파일을 작성한다:

```bash
cat > /path/to/file.py << 'PYEOF'
# 파일 내용 (한국어 포함 가능)
PYEOF
```

**확인:** 파일 수정 후 반드시 문법 검사:

```bash
python3 -c "import ast; ast.parse(open('backend/app/some_file.py').read()); print('OK')"
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
**특히 `cls`는 Python 예약어처럼 보이지만 실제로 예약어가 아니며, `class_obj`로 바꾸지 말 것.**

---

### ⛔ 경고 4: docker-compose.yml의 named volume 선언 삭제 금지

```yaml
volumes:
  postgres_data:   # ← 이 선언을 절대 삭제하지 말 것
  backend_embeddings:
```

---

### ⛔ 경고 5: Dockerfile CMD 수정 시 완전한 JSON 배열 확인

```bash
tail -5 backend/Dockerfile
# CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
# 위처럼 닫히는 ] 가 있어야 한다
```

---

### ⛔ 경고 6: 샤드/메타 DB 구분 마이그레이션

- `images`, `annotations`, `classes` 컬럼 → `sharding/router.py` migration 리스트
- `datasets`, `dataset_versions`, 기타 메타 테이블 컬럼 → `database.py` `_META_MIGRATIONS` 리스트
- Alembic은 **메타 DB 테이블만** 관리 (샤드 DB에는 적용되지 않음)

---

### ⛔ 경고 7: 새 라우터를 main.py에 반드시 등록

```python
# backend/app/main.py
from app.routers.my_new_router import router as my_router
app.include_router(my_router, prefix=API_PREFIX)
```

---

### ⛔ 경고 8: 이미지 삭제 시 물리 파일을 삭제하지 말 것 (Soft Delete)

`routers/images.py`의 DELETE 핸들러에서 `delete_file()`을 **호출하지 않는다.**  
물리 파일을 보존해야 롤백 시 완전 복구가 가능하다.  
파일 정리는 GC API(`POST /datasets/{id}/gc`)를 통해서만 수행한다.

---

### ⛔ 경고 9: 합성 데이터 생성기는 멀티프로세싱 사용 — CUDA context 주의

FLUX 생성기(`generator_flux.py`)는 `mp.get_context('spawn')`으로 워커 프로세스를 생성한다.  
워커 내에서만 `torch`, `diffusers`를 import해야 한다. 부모 프로세스에서 미리 import하면 CUDA context 충돌이 발생한다.

---

### ✅ 수정 전 체크리스트

파일을 수정하기 전에 다음을 확인한다:

- [ ] 한국어가 포함되는가? → bash heredoc 사용
- [ ] relationship을 추가/수정하는가? → `lazy="noload"` 및 `back_populates` 양측 일치 확인
- [ ] 새 DB 컬럼을 추가하는가? → 메타/샤드 여부에 따라 올바른 migration 리스트에 추가
- [ ] 새 라우터를 만드는가? → `main.py`에 등록 여부 확인
- [ ] docker-compose.yml을 수정하는가? → named volume 선언 보존 확인
- [ ] Dockerfile을 수정하는가? → CMD 줄 완결성 확인
- [ ] 이미지 삭제 로직을 수정하는가? → Soft Delete 정책 (물리 파일 보존) 유지 확인
- [ ] 수정 완료 후 → Python 파일은 `ast.parse` 문법 검사

---

## 16. 자주 발생하는 오류와 해결법

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

### 합성 데이터 생성 시 `Cannot access gated repo` 오류

**원인:** HuggingFace 모델(FLUX.2-klein)이 gated 상태로 접근 토큰 필요  
**해결:**  
1. HuggingFace 계정에서 해당 모델 접근 승인 요청
2. `HUGGING_FACE_HUB_TOKEN` 환경변수를 backend `.env`에 추가

```bash
# backend/.env
HUGGING_FACE_HUB_TOKEN=hf_xxxxxxxxxxxx
```

---

### 롤백 후 일부 이미지가 보이지 않음

**원인:** Soft Delete로 보존 중이던 물리 파일이 수동으로 삭제된 경우  
**해결:** 롤백 응답의 `missing_physical_files` 목록 확인. 해당 파일들은 복구 불가.  
→ 향후 GC 실행 전 반드시 최신 스냅샷 생성을 권장

---

### 품질 평가(FID/LPIPS)가 완료되지 않음 / 오류

**원인 1:** 평가 이미지 쌍이 7개 미만 (FID는 최소 샘플 수 필요)  
**원인 2:** `piq.compute_feats` DataLoader 포맷 오류 (`{"images": tensor}` 형식 필요)  
**해결:** `evaluator_domain.py`의 DataLoader `__getitem__` 반환 형식 확인

---

*최종 업데이트: 2026-06-22*
