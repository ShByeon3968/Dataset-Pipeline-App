"""
버저닝 라우터
/api/v1/datasets/{dataset_id}/versions/*
/api/v1/datasets/{dataset_id}/gc
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.sharding.router import get_sharded_db, get_meta_db
from app.schemas.version import (
    DatasetVersionCreate, DatasetVersionRead, DatasetVersionList,
)
import app.services.versioning_service as svc

router = APIRouter(
    prefix="/datasets/{dataset_id}/versions",
    tags=["versions"],
)

gc_router = APIRouter(tags=["versions"])


@router.post("", response_model=DatasetVersionRead, status_code=status.HTTP_201_CREATED)
async def create_version(
    dataset_id: int,
    payload: DatasetVersionCreate,
    meta_db: AsyncSession = Depends(get_meta_db),
    shard_db: AsyncSession = Depends(get_sharded_db),
):
    """현재 데이터셋 상태 스냅샷을 찍어 새 버전으로 저장 (물리 JSON 스냅샷 포함)."""
    return await svc.create_dataset_version(meta_db, shard_db, dataset_id, payload)


@router.get("", response_model=DatasetVersionList)
async def list_versions(
    dataset_id: int,
    branch: str | None = Query(None, description="브랜치 필터"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    meta_db: AsyncSession = Depends(get_meta_db),
):
    items, total = await svc.list_dataset_versions(meta_db, dataset_id, branch, skip, limit)
    return DatasetVersionList(items=items, total=total)


@router.get("/{version_id}", response_model=DatasetVersionRead)
async def get_version(
    dataset_id: int,
    version_id: int,
    meta_db: AsyncSession = Depends(get_meta_db),
):
    ver = await svc.get_dataset_version(meta_db, version_id)
    if ver is None or ver.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="버전을 찾을 수 없습니다.")
    return ver


@router.delete("/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_version(
    dataset_id: int,
    version_id: int,
    meta_db: AsyncSession = Depends(get_meta_db),
):
    ver = await svc.get_dataset_version(meta_db, version_id)
    if ver is None or ver.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="버전을 찾을 수 없습니다.")
    await svc.delete_dataset_version(meta_db, version_id)


@router.post("/{version_id}/rollback", status_code=status.HTTP_200_OK)
async def rollback_version(
    dataset_id: int,
    version_id: int,
    meta_db: AsyncSession = Depends(get_meta_db),
    shard_db: AsyncSession = Depends(get_sharded_db),
):
    """
    지정된 버전의 스냅샷으로 데이터셋을 복구합니다.
    - DB 레코드(Images + Annotations)를 해당 시점으로 복원
    - 물리 파일은 디스크에 그대로 보존되어 있으므로 완전 복구 가능
    - 물리 파일이 없는 이미지는 missing_physical_files 목록에 반환
    """
    try:
        result = await svc.rollback_dataset_version(meta_db, shard_db, dataset_id, version_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


# ─── GC 라우터 (prefix 별도) ───────────────────────────────────
@gc_router.post(
    "/datasets/{dataset_id}/gc",
    status_code=status.HTTP_200_OK,
    tags=["versions"],
)
async def run_garbage_collect(
    dataset_id: int,
    shard_db: AsyncSession = Depends(get_sharded_db),
):
    """
    uploads/{dataset_id}/ 디렉토리에서 DB에 없는 고아 이미지 파일을 일괄 삭제합니다.
    롤백 이후 또는 정기적으로 실행하여 디스크 공간을 확보합니다.
    """
    result = await svc.garbage_collect_uploads(shard_db, dataset_id)
    return result
