"""
데이터셋 내보내기 라우터
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.sharding.router import get_sharded_db
from app.models import Dataset
from app.services.exporter import export_coco, export_yolo, export_pascal_voc
import os

router = APIRouter(prefix="/datasets/{dataset_id}/export", tags=["export"])

FORMAT_MAP = {
    "coco": export_coco,
    "yolo": export_yolo,
    "voc": export_pascal_voc,
}


@router.get("/{format}")
async def export_dataset(
    dataset_id: int,
    format: str,
    db: AsyncSession = Depends(get_sharded_db),
):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="데이터셋을 찾을 수 없습니다.")

    exporter = FORMAT_MAP.get(format.lower())
    if not exporter:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 형식: {format}. 사용 가능: coco, yolo, voc",
        )

    try:
        zip_path = await exporter(db, dataset_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"내보내기 실패: {e}")

    if not os.path.exists(zip_path):
        raise HTTPException(status_code=500, detail="파일 생성 실패")

    filename = os.path.basename(zip_path)
    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
