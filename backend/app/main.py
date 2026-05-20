"""
객체 탐지 데이터셋 관리 솔루션 — FastAPI 메인 진입점
실행: uvicorn app.main:app --reload
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os

from app.core.config import get_settings
from app.database import create_tables
from app.services.file_handler import ensure_dirs
from app.sharding.router import shard_router

# 라우터 import
from app.routers import (
    datasets as datasets_router,
    images as images_router,
    annotations as annotations_router,
    classes as classes_router,
    analysis as analysis_router,
    refinement as refinement_router,
    ontology as ontology_router,
    export as export_router,
)
from app.routers.ontology import rules_router
from app.routers.analysis import analysis_router as coco_analysis_router
from app.routers import sharding as sharding_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 시 실행"""
    ensure_dirs()
    await create_tables()          # 기본 DB 테이블 생성
    await shard_router.initialize()  # 샤드 라우터 초기화
    yield
    await shard_router.close()     # 샤드 엔진 풀 정리


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="ML 엔지니어를 위한 원스톱 데이터셋 구축·분석·정제 API",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 업로드 크기 초과 시 명확한 에러 반환
@app.exception_handler(413)
async def request_entity_too_large(_: Request, __: Exception):
    return JSONResponse(
        status_code=413,
        content={"detail": "파일 크기가 너무 큽니다. 500MB 이하의 파일만 업로드 가능합니다."},
    )

# API 라우터 등록
API_PREFIX = "/api/v1"
app.include_router(datasets_router.router, prefix=API_PREFIX)
app.include_router(images_router.router, prefix=API_PREFIX)
app.include_router(annotations_router.router, prefix=API_PREFIX)
app.include_router(classes_router.router, prefix=API_PREFIX)
app.include_router(analysis_router.router, prefix=API_PREFIX)
app.include_router(coco_analysis_router, prefix=API_PREFIX)
app.include_router(refinement_router.router, prefix=API_PREFIX)
app.include_router(ontology_router.router, prefix=API_PREFIX)
app.include_router(rules_router, prefix=API_PREFIX)
app.include_router(export_router.router, prefix=API_PREFIX)
app.include_router(sharding_router.router, prefix=API_PREFIX)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": settings.app_version}
