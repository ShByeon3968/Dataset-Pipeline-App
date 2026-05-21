from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.sharding.router import get_sharded_db, get_meta_db
from app.models import Dataset
from app.services.analysis import (
    get_class_distribution, get_bbox_stats,
    get_dataset_summary, parse_coco_json,
)

router = APIRouter(prefix="/datasets/{dataset_id}/analysis", tags=["analysis"])


async def _require_dataset(
    dataset_id: int,
    meta_db: AsyncSession = Depends(get_meta_db),
) -> Dataset:
    ds = await meta_db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return ds


@router.get("/summary")
async def dataset_summary(
    dataset_id: int,
    db: AsyncSession = Depends(get_sharded_db),
    _ds: Dataset = Depends(_require_dataset),
):
    return await get_dataset_summary(db, dataset_id)


@router.get("/class-distribution")
async def class_distribution(
    dataset_id: int,
    db: AsyncSession = Depends(get_sharded_db),
    _ds: Dataset = Depends(_require_dataset),
):
    return await get_class_distribution(db, dataset_id)


@router.get("/bbox-stats")
async def bbox_stats(
    dataset_id: int,
    db: AsyncSession = Depends(get_sharded_db),
    _ds: Dataset = Depends(_require_dataset),
):
    return await get_bbox_stats(db, dataset_id)


@router.get("/embeddings")
async def annotation_embeddings(
    dataset_id: int,
    db: AsyncSession = Depends(get_sharded_db),
    _ds: Dataset = Depends(_require_dataset),
):
    from app.services.analysis import get_annotation_embeddings
    return await get_annotation_embeddings(db, dataset_id)


@router.get("/split-stats")
async def split_stats(
    dataset_id: int,
    db: AsyncSession = Depends(get_sharded_db),
    _ds: Dataset = Depends(_require_dataset),
):
    """Return image counts grouped by split (train/val/test/unsplit)."""
    from sqlalchemy import select, func, case
    from app.models import Image
    result = await db.execute(
        select(
            Image.split,
            func.count(Image.id).label("count"),
        )
        .where(Image.dataset_id == dataset_id)
        .group_by(Image.split)
    )
    rows = result.all()
    counts = {"train": 0, "val": 0, "test": 0, "unsplit": 0}
    total = 0
    for split_val, cnt in rows:
        key = split_val if split_val in ("train", "val", "test") else "unsplit"
        counts[key] += cnt
        total += cnt
    return {**counts, "total": total}


# Standalone COCO JSON analyzer (no dataset required)
from fastapi import UploadFile, File
import json

analysis_router = APIRouter(prefix="/analysis", tags=["analysis"])


@analysis_router.post("/coco-json")
async def analyze_coco_json(file: UploadFile = File(...)):
    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")
    return parse_coco_json(data)
