"""
분석 & 시각화 라우터
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.sharding.router import get_sharded_db
from app.models import Dataset
from app.services.analysis import (
    get_class_distribution, get_bbox_stats,
    get_dataset_summary, parse_coco_json,
)

router = APIRouter(prefix="/datasets/{dataset_id}/analysis", tags=["analysis"])


@router.get("/summary")
async def dataset_summary(dataset_id: int, db: AsyncSession = Depends(get_sharded_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="데이터셋을 찾을 수 없습니다.")
    return await get_dataset_summary(db, dataset_id)


@router.get("/class-distribution")
async def class_distribution(dataset_id: int, db: AsyncSession = Depends(get_sharded_db)):
    return await get_class_distribution(db, dataset_id)


@router.get("/bbox-stats")
async def bbox_stats(dataset_id: int, db: AsyncSession = Depends(get_sharded_db)):
    return await get_bbox_stats(db, dataset_id)


# 별도 엔드포인트: COCO JSON 직접 분석
from fastapi import UploadFile, File
import json

analysis_router = APIRouter(prefix="/analysis", tags=["analysis"])


@analysis_router.post("/coco-json")
async def analyze_coco_json(file: UploadFile = File(...)):
    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="유효한 JSON 파일이 아닙니다.")
    return parse_coco_json(data)


@router.get("/embeddings")
async def annotation_embeddings(dataset_id: int, db: AsyncSession = Depends(get_sharded_db)):
    """bbox 피처 PCA 2D 투영 — 임베딩 시각화용"""
    from app.services.analysis import get_annotation_embeddings
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="데이터셋을 찾을 수 없습니다.")
    return await get_annotation_embeddings(db, dataset_id)
