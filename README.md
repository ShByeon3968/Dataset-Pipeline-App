# 객체 탐지 데이터셋 관리 솔루션 — FastAPI + React 리팩토링

Streamlit 버전을 **FastAPI (백엔드) + React/TypeScript (프론트엔드) + PostgreSQL** 스택으로 리팩토링한 버전입니다.

---

## 기술 스택

| 역할 | 기술 |
|------|------|
| 백엔드 API | FastAPI + asyncpg (비동기) |
| ORM | SQLAlchemy 2.0 (async) |
| DB 마이그레이션 | Alembic |
| 데이터베이스 | PostgreSQL 16 |
| 프론트엔드 | React 18 + TypeScript + Vite |
| 라우팅 | React Router v6 |
| 상태 관리 | Zustand + TanStack Query |
| UI | Tailwind CSS |
| 차트 | Recharts |
| 레이블링 캔버스 | React-Konva |
| 파일 업로드 | react-dropzone |
| 컨테이너 | Docker + Docker Compose |

---

## 프로젝트 구조

```
Dataset Pipeline FastAPI App/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 진입점
│   │   ├── database.py          # 비동기 SQLAlchemy 세션
│   │   ├── core/config.py       # pydantic-settings 설정
│   │   ├── models/              # SQLAlchemy ORM 모델
│   │   ├── schemas/             # Pydantic 요청/응답 스키마
│   │   ├── routers/             # API 라우터 (8개)
│   │   └── services/            # 비즈니스 로직
│   ├── alembic/                 # DB 마이그레이션
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # 라우팅
│   │   ├── api/                 # Axios API 클라이언트
│   │   ├── components/          # 공통 컴포넌트
│   │   ├── pages/               # 6개 기능 페이지
│   │   ├── store/               # Zustand 전역 상태
│   │   └── types/               # TypeScript 타입 정의
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 빠른 시작

### 1. Docker Compose (권장)

```bash
# .env 파일 설정
cp .env.example .env
cp backend/.env.example backend/.env
# backend/.env에서 DB 비밀번호 등 수정

# 전체 실행
docker-compose up --build

# 앱 접속: http://localhost:3000
# API 문서: http://localhost:8000/api/docs
```

### 2. 로컬 개발

#### 백엔드

```bash
cd backend

# 가상환경 생성 & 의존성 설치
python -m venv .venv
.venv\Scripts\activate      # Windows
source .venv/bin/activate   # macOS/Linux

pip install -r requirements.txt

# .env 설정 (PostgreSQL 연결 정보)
cp .env.example .env

# DB 마이그레이션
alembic upgrade head

# 서버 실행
uvicorn app.main:app --reload
# → http://localhost:8000
```

#### 프론트엔드

```bash
cd frontend

# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
# → http://localhost:5173
```

---

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /api/v1/datasets | 데이터셋 목록 |
| POST | /api/v1/datasets | 데이터셋 생성 |
| GET | /api/v1/datasets/{id} | 데이터셋 상세 |
| POST | /api/v1/datasets/{id}/images/upload | 이미지 업로드 |
| POST | /api/v1/datasets/{id}/images/upload-zip | ZIP 업로드 |
| GET | /api/v1/datasets/{id}/analysis/summary | 데이터셋 통계 |
| GET | /api/v1/datasets/{id}/analysis/class-distribution | 클래스 분포 |
| GET | /api/v1/datasets/{id}/analysis/bbox-stats | BBox 통계 |
| GET | /api/v1/datasets/{id}/refinement/duplicates | 중복 탐지 |
| POST | /api/v1/datasets/{id}/refinement/filter-bbox | BBox 필터링 |
| POST | /api/v1/datasets/{id}/ontology/map | 클래스 매핑 |
| GET | /api/v1/datasets/{id}/export/{format} | 내보내기 (coco/yolo/voc) |

전체 API 문서: http://localhost:8000/api/docs

---

## Streamlit → FastAPI+React 주요 변경사항

| 항목 | Streamlit | FastAPI + React |
|------|-----------|-----------------|
| 아키텍처 | 모놀리식 (서버사이드 렌더링) | API 서버 + SPA 분리 |
| 데이터베이스 | SQLite (동기) | PostgreSQL (비동기) |
| 상태 관리 | st.session_state | Zustand + TanStack Query |
| 차트 | Plotly | Recharts |
| 레이블링 캔버스 | streamlit-drawable-canvas | React-Konva |
| 파일 업로드 | st.file_uploader | react-dropzone + multipart |
| API | 없음 (직접 DB 접근) | RESTful API (/api/v1) |
| 배포 | streamlit run | Docker Compose |
