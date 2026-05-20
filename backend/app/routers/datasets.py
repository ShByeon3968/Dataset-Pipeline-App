"""
데이터셋 CRUD 라우터
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from app.database import get_db
from app.models import Dataset, Image, Annotation, Class
from app.schemas.dataset import DatasetCreate, DatasetUpdate, DatasetRead, DatasetList
from app.sharding.router import shard_router

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.get("", response_model=DatasetList)
async def list_datasets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Dataset).order_by(Dataset.created_at.desc()))
    datasets = result.scalars().all()

    items = []
    for ds in datasets:
        img_count = await db.scalar(
            select(func.count()).select_from(Image).where(Image.dataset_id == ds.id)
        ) or 0
        ann_count = await db.scalar(
            select(func.count())
            .select_from(Annotation)
            .join(Image)
            .where(Image.dataset_id == ds.id)
        ) or 0
        cls_count = await db.scalar(
            select(func.count()).select_from(Class).where(Class.dataset_id == ds.id)
        ) or 0
        items.append(DatasetRead(
            id=ds.id, name=ds.name, description=ds.description,
            source=ds.source, created_at=ds.created_at, updated_at=ds.updated_at,
            image_count=img_count, annotation_count=ann_count, class_count=cls_count,
        ))

    return DatasetList(items=items, total=len(items))


@router.post("", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
async def create_dataset(payload: DatasetCreate, db: AsyncSession = Depends(get_db)):
    ds = Dataset(**payload.model_dump())
    db.add(ds)
    await db.flush()
    await db.refresh(ds)
    # 샤드 배정 (dataset_id 확정 후)
    shard_id = await shard_router.assign_dataset(ds.id)
    return DatasetRead(
        id=ds.id, name=ds.name, description=ds.description,
        source=ds.source, created_at=ds.created_at, updated_at=ds.updated_at,
        shard_id=shard_id,
    )


@router.get("/{dataset_id}", response_model=DatasetRead)
async def get_dataset(dataset_id: int, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="데이터셋을 찾을 수 없습니다.")
    img_count = await db.scalar(
        select(func.count()).select_from(Image).where(Image.dataset_id == dataset_id)
    ) or 0
    ann_count = await db.scalar(
        select(func.count())
        .select_from(Annotation)
        .join(Image)
        .where(Image.dataset_id == dataset_id)
    ) or 0
    cls_count = await db.scalar(
        select(func.count()).select_from(Class).where(Class.dataset_id == dataset_id)
    ) or 0
    return DatasetRead(
        id=ds.id, name=ds.name, description=ds.description,
        source=ds.source, created_at=ds.created_at, updated_at=ds.updated_at,
        image_count=img_count, annotation_count=ann_count, class_count=cls_count,
    )


@router.patch("/{dataset_id}", response_model=DatasetRead)
async def update_dataset(
    dataset_id: int, payload: DatasetUpdate, db: AsyncSession = Depends(get_db)
):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="데이터셋을 찾을 수 없습니다.")
    for field, val in payload.model_dump(exclude_none=True).items():
        setattr(ds, field, val)
    await db.flush()
    await db.refresh(ds)
    return DatasetRead(
        id=ds.id, name=ds.name, description=ds.description,
        source=ds.source, created_at=ds.created_at, updated_at=ds.updated_at,
    )


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(dataset_id: int, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="데이터셋을 찾을 수 없습니다.")
    # DB 레코드 삭제 (cascade → Image, Annotation, Class 모두 삭제)
    await db.delete(ds)
    # 샤드 매핑 레코드 제거 — 고아 레코드 방지
    await shard_router.remove_dataset(dataset_id)
