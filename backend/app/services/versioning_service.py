"""
버저닝 서비스
- 버전 생성: 샤드 DB에서 통계 조회 → 메타 DB에 DatasetVersion 저장
             + 이미지/어노테이션 전체를 JSON 스냅샷으로 저장 (롤백 지원)
- 버전 조회/리스트/삭제
- 롤백: 스냅샷 JSON으로 Images + Annotations 복구 (물리 파일 보존 정책 활용)
- GC:   uploads 디렉토리에서 DB에 없는 고아 파일 일괄 삭제
- 리니지 그래프 구성
"""
from __future__ import annotations
import hashlib
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from sqlalchemy import select, func as F, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.version import DatasetVersion, ModelVersion, ModelDatasetLink
from app.models.image import Image
from app.models.annotation import Annotation
from app.models.class_ import Class
from app.schemas.version import (
    DatasetVersionCreate, DatasetVersionRead,
    ModelVersionCreate, ModelVersionRead,
    ModelDatasetLinkCreate, ModelDatasetLinkRead,
    LineageGraph, LineageNode, LineageEdge,
)

settings = get_settings()


def _snapshot_dir() -> str:
    """스냅샷 저장 디렉토리. uploads_dir 옆에 snapshots/ 폴더 생성."""
    base = Path(settings.uploads_dir).parent / "snapshots"
    base.mkdir(parents=True, exist_ok=True)
    return str(base)


# ─────────────────────────────────────────────────────────────
# 내부 헬퍼: 샤드 DB에서 스냅샷 통계 수집
# ─────────────────────────────────────────────────────────────

async def _collect_snapshot_stats(
    shard_db: AsyncSession, dataset_id: int
) -> dict:
    """샤드 DB에서 현재 데이터셋 상태를 집계."""

    # 이미지 수
    img_count_row = await shard_db.execute(
        select(F.count(Image.id)).where(Image.dataset_id == dataset_id)
    )
    image_count = img_count_row.scalar_one() or 0

    # 어노테이션 수
    ann_count_row = await shard_db.execute(
        select(F.count(Annotation.id))
        .join(Image, Annotation.image_id == Image.id)
        .where(Image.dataset_id == dataset_id)
    )
    annotation_count = ann_count_row.scalar_one() or 0

    # 클래스 수 + 분포
    class_dist_rows = await shard_db.execute(
        select(Class.name, F.count(Annotation.id).label("cnt"))
        .join(Annotation, Annotation.class_id == Class.id, isouter=True)
        .join(Image, Annotation.image_id == Image.id, isouter=True)
        .where(Class.dataset_id == dataset_id)
        .group_by(Class.id, Class.name)
        .order_by(F.count(Annotation.id).desc())
    )
    class_rows = class_dist_rows.all()
    class_count = len(class_rows)
    class_distribution = [{"name": r.name, "count": r.cnt or 0} for r in class_rows]

    # 이미지 ID 해시 (무결성 체크용)
    img_ids_row = await shard_db.execute(
        select(Image.id)
        .where(Image.dataset_id == dataset_id)
        .order_by(Image.id)
    )
    img_ids = [str(r[0]) for r in img_ids_row.all()]
    image_ids_hash = hashlib.md5(",".join(img_ids).encode()).hexdigest()

    return {
        "image_count": image_count,
        "annotation_count": annotation_count,
        "class_count": class_count,
        "class_distribution": class_distribution,
        "image_ids_hash": image_ids_hash,
    }


async def _calc_diff(
    meta_db: AsyncSession,
    dataset_id: int,
    parent_version_id: int | None,
    current_stats: dict,
) -> dict:
    """부모 버전과의 차이 계산."""
    if parent_version_id is None:
        return {"added_images": current_stats["image_count"],
                "deleted_images": 0, "modified_labels": 0}

    parent = await meta_db.get(DatasetVersion, parent_version_id)
    if parent is None:
        return {"added_images": 0, "deleted_images": 0, "modified_labels": 0}

    added = max(0, current_stats["image_count"] - parent.image_count)
    deleted = max(0, parent.image_count - current_stats["image_count"])
    modified = abs(current_stats["annotation_count"] - parent.annotation_count)

    return {"added_images": added, "deleted_images": deleted, "modified_labels": modified}


async def _save_snapshot(shard_db: AsyncSession, dataset_id: int) -> str:
    """
    현재 데이터셋의 Images + Annotations 전체를 JSON 파일로 저장.
    Returns: 저장된 파일의 절대 경로
    """
    # Images 직렬화
    img_rows = (await shard_db.execute(
        select(Image).where(Image.dataset_id == dataset_id).order_by(Image.id)
    )).scalars().all()

    images_data = []
    for img in img_rows:
        images_data.append({
            "id": img.id,
            "dataset_id": img.dataset_id,
            "filename": img.filename,
            "filepath": img.filepath,
            "width": img.width,
            "height": img.height,
            "format": img.format,
            "file_hash": img.file_hash,
            "phash": img.phash,
            "split": img.split,
            "upload_batch_id": img.upload_batch_id,
            "created_at": img.created_at.isoformat() if img.created_at else None,
        })

    # Annotations 직렬화 (해당 데이터셋의 이미지에 속한 것만)
    image_ids = [img.id for img in img_rows]
    ann_data = []
    if image_ids:
        ann_rows = (await shard_db.execute(
            select(Annotation).where(Annotation.image_id.in_(image_ids)).order_by(Annotation.id)
        )).scalars().all()
        for ann in ann_rows:
            ann_data.append({
                "id": ann.id,
                "image_id": ann.image_id,
                "class_id": ann.class_id,
                "bbox_x": ann.bbox_x,
                "bbox_y": ann.bbox_y,
                "bbox_w": ann.bbox_w,
                "bbox_h": ann.bbox_h,
                "segmentation": ann.segmentation,
                "annotation_type": ann.annotation_type,
                "is_auto_generated": ann.is_auto_generated,
                "confidence": ann.confidence,
                "source_prompt": ann.source_prompt,
                "auto_label_run_id": ann.auto_label_run_id,
                "quality_flag": ann.quality_flag,
                "created_at": ann.created_at.isoformat() if ann.created_at else None,
            })

    snapshot = {
        "dataset_id": dataset_id,
        "created_at": datetime.utcnow().isoformat(),
        "images": images_data,
        "annotations": ann_data,
    }

    snap_dir = _snapshot_dir()
    filename = f"dataset_{dataset_id}_{uuid.uuid4().hex}.json"
    filepath = os.path.join(snap_dir, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)

    return filepath


# ─────────────────────────────────────────────────────────────
# DatasetVersion CRUD
# ─────────────────────────────────────────────────────────────

async def create_dataset_version(
    meta_db: AsyncSession,
    shard_db: AsyncSession,
    dataset_id: int,
    payload: DatasetVersionCreate,
) -> DatasetVersionRead:
    stats = await _collect_snapshot_stats(shard_db, dataset_id)
    diff = await _calc_diff(meta_db, dataset_id, payload.parent_version_id, stats)

    # 물리 스냅샷 저장
    snapshot_path = await _save_snapshot(shard_db, dataset_id)

    ver = DatasetVersion(
        dataset_id=dataset_id,
        version_name=payload.version_name,
        description=payload.description,
        created_by=payload.created_by,
        branch_name=payload.branch_name,
        parent_version_id=payload.parent_version_id,
        tags=payload.tags,
        image_count=stats["image_count"],
        annotation_count=stats["annotation_count"],
        class_count=stats["class_count"],
        class_distribution=json.dumps(stats["class_distribution"], ensure_ascii=False),
        image_ids_hash=stats["image_ids_hash"],
        snapshot_path=snapshot_path,
        **diff,
    )
    meta_db.add(ver)
    await meta_db.flush()
    await meta_db.refresh(ver)
    return DatasetVersionRead.from_orm_model(ver)


async def list_dataset_versions(
    meta_db: AsyncSession,
    dataset_id: int,
    branch: str | None = None,
    skip: int = 0,
    limit: int = 50,
) -> tuple[list[DatasetVersionRead], int]:
    q = select(DatasetVersion).where(DatasetVersion.dataset_id == dataset_id)
    if branch:
        q = q.where(DatasetVersion.branch_name == branch)

    total_row = await meta_db.execute(
        select(F.count()).select_from(q.subquery())
    )
    total = total_row.scalar_one() or 0

    q = q.order_by(DatasetVersion.created_at.desc()).offset(skip).limit(limit)
    rows = (await meta_db.execute(q)).scalars().all()
    return [DatasetVersionRead.from_orm_model(r) for r in rows], total


async def get_dataset_version(
    meta_db: AsyncSession, version_id: int
) -> DatasetVersionRead | None:
    ver = await meta_db.get(DatasetVersion, version_id)
    if ver is None:
        return None
    return DatasetVersionRead.from_orm_model(ver)


async def delete_dataset_version(meta_db: AsyncSession, version_id: int) -> bool:
    ver = await meta_db.get(DatasetVersion, version_id)
    if ver is None:
        return False
    # 스냅샷 파일도 함께 삭제
    if ver.snapshot_path and os.path.exists(ver.snapshot_path):
        try:
            os.remove(ver.snapshot_path)
        except Exception:
            pass
    await meta_db.delete(ver)
    return True


# ─────────────────────────────────────────────────────────────
# 롤백 (Rollback)
# ─────────────────────────────────────────────────────────────

async def rollback_dataset_version(
    meta_db: AsyncSession,
    shard_db: AsyncSession,
    dataset_id: int,
    version_id: int,
) -> dict:
    """
    특정 버전의 스냅샷 JSON으로 데이터셋 복구.
    - 현재 Images + Annotations 를 모두 삭제 (Soft Delete: 물리 파일은 보존)
    - 스냅샷 JSON에서 Image + Annotation 레코드 재삽입
    - 물리 파일이 없으면 해당 이미지를 경고에 추가
    """
    ver = await meta_db.get(DatasetVersion, version_id)
    if ver is None or ver.dataset_id != dataset_id:
        raise ValueError("버전을 찾을 수 없습니다.")
    if not ver.snapshot_path or not os.path.exists(ver.snapshot_path):
        raise ValueError("이 버전의 스냅샷 파일이 존재하지 않습니다. 롤백할 수 없습니다.")

    with open(ver.snapshot_path, "r", encoding="utf-8") as f:
        snapshot = json.load(f)

    from app.services.file_handler import resolve_filepath

    # 1) 현재 Annotations 삭제 (DB만, 물리 파일 없음)
    current_images = (await shard_db.execute(
        select(Image.id).where(Image.dataset_id == dataset_id)
    )).scalars().all()
    if current_images:
        await shard_db.execute(
            delete(Annotation).where(Annotation.image_id.in_(current_images))
        )
    # 2) 현재 Images 삭제 (DB만, 물리 파일 보존!)
    await shard_db.execute(
        delete(Image).where(Image.dataset_id == dataset_id)
    )
    await shard_db.flush()

    # 3) Images 재삽입
    missing_files: list[str] = []
    restored_images = 0
    for img_data in snapshot["images"]:
        abs_path = resolve_filepath(img_data["filepath"])
        if not os.path.exists(abs_path):
            missing_files.append(img_data["filename"])
            continue  # 물리 파일이 없으면 스킵
        img = Image(
            id=img_data["id"],
            dataset_id=dataset_id,
            filename=img_data["filename"],
            filepath=img_data["filepath"],
            width=img_data.get("width"),
            height=img_data.get("height"),
            format=img_data.get("format"),
            file_hash=img_data.get("file_hash"),
            phash=img_data.get("phash"),
            split=img_data.get("split"),
            upload_batch_id=img_data.get("upload_batch_id"),
        )
        shard_db.add(img)
        restored_images += 1

    await shard_db.flush()

    # 4) Annotations 재삽입 (복구된 이미지에 속한 것만)
    restored_image_ids = {img_data["id"] for img_data in snapshot["images"]
                          if img_data["filename"] not in missing_files}
    restored_annotations = 0
    for ann_data in snapshot["annotations"]:
        if ann_data["image_id"] not in restored_image_ids:
            continue
        ann = Annotation(
            id=ann_data["id"],
            image_id=ann_data["image_id"],
            class_id=ann_data.get("class_id"),
            bbox_x=ann_data.get("bbox_x"),
            bbox_y=ann_data.get("bbox_y"),
            bbox_w=ann_data.get("bbox_w"),
            bbox_h=ann_data.get("bbox_h"),
            segmentation=ann_data.get("segmentation"),
            annotation_type=ann_data.get("annotation_type", "bbox"),
            is_auto_generated=ann_data.get("is_auto_generated", False),
            confidence=ann_data.get("confidence"),
            source_prompt=ann_data.get("source_prompt"),
            auto_label_run_id=ann_data.get("auto_label_run_id"),
            quality_flag=ann_data.get("quality_flag"),
        )
        shard_db.add(ann)
        restored_annotations += 1

    await shard_db.flush()

    return {
        "version_id": version_id,
        "version_name": ver.version_name,
        "restored_images": restored_images,
        "restored_annotations": restored_annotations,
        "missing_physical_files": missing_files,
    }


# ─────────────────────────────────────────────────────────────
# Garbage Collection (고아 파일 정리)
# ─────────────────────────────────────────────────────────────

async def garbage_collect_uploads(
    shard_db: AsyncSession,
    dataset_id: int,
) -> dict:
    """
    uploads/{dataset_id}/ 디렉토리에서 DB에 등록되지 않은 고아 파일을 삭제.
    Returns: {'deleted': [...], 'kept': int, 'freed_bytes': int}
    """
    from app.services.file_handler import resolve_filepath

    # DB에 있는 파일 경로 목록
    db_filepaths = set(
        (await shard_db.execute(
            select(Image.filepath).where(Image.dataset_id == dataset_id)
        )).scalars().all()
    )

    # uploads/{dataset_id}/ 디렉토리 스캔
    dataset_upload_dir = os.path.join(settings.uploads_dir, str(dataset_id))
    if not os.path.isdir(dataset_upload_dir):
        return {"deleted": [], "kept": 0, "freed_bytes": 0}

    deleted_files: list[str] = []
    freed_bytes = 0
    kept = 0
    SUPPORTED = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tiff", ".tif", ".webp"}

    for fname in os.listdir(dataset_upload_dir):
        fpath = os.path.join(dataset_upload_dir, fname)
        if not os.path.isfile(fpath):
            continue
        if Path(fpath).suffix.lower() not in SUPPORTED:
            continue
        # 상대경로로 변환 후 DB와 비교
        rel_path = os.path.relpath(fpath, settings.uploads_dir)
        if rel_path not in db_filepaths:
            file_size = os.path.getsize(fpath)
            try:
                os.remove(fpath)
                deleted_files.append(fname)
                freed_bytes += file_size
            except Exception:
                pass
        else:
            kept += 1

    return {
        "deleted": deleted_files,
        "deleted_count": len(deleted_files),
        "kept": kept,
        "freed_bytes": freed_bytes,
        "freed_mb": round(freed_bytes / (1024 * 1024), 2),
    }


# ─────────────────────────────────────────────────────────────
# ModelVersion CRUD
# ─────────────────────────────────────────────────────────────

async def create_model_version(
    meta_db: AsyncSession, payload: ModelVersionCreate
) -> ModelVersionRead:
    mv = ModelVersion(**payload.model_dump())
    meta_db.add(mv)
    await meta_db.flush()
    await meta_db.refresh(mv)
    return ModelVersionRead.model_validate(mv)


async def list_model_versions(
    meta_db: AsyncSession, skip: int = 0, limit: int = 50
) -> tuple[list[ModelVersionRead], int]:
    total = (await meta_db.execute(select(F.count(ModelVersion.id)))).scalar_one() or 0
    rows = (await meta_db.execute(
        select(ModelVersion).order_by(ModelVersion.created_at.desc()).offset(skip).limit(limit)
    )).scalars().all()
    return [ModelVersionRead.model_validate(r) for r in rows], total


async def get_model_version(
    meta_db: AsyncSession, model_version_id: int
) -> ModelVersionRead | None:
    mv = await meta_db.get(ModelVersion, model_version_id)
    return ModelVersionRead.model_validate(mv) if mv else None


async def delete_model_version(meta_db: AsyncSession, model_version_id: int) -> bool:
    mv = await meta_db.get(ModelVersion, model_version_id)
    if mv is None:
        return False
    await meta_db.delete(mv)
    return True


# ─────────────────────────────────────────────────────────────
# ModelDatasetLink CRUD
# ─────────────────────────────────────────────────────────────

async def link_model_to_dataset_version(
    meta_db: AsyncSession,
    model_version_id: int,
    payload: ModelDatasetLinkCreate,
) -> ModelDatasetLinkRead:
    link = ModelDatasetLink(
        model_version_id=model_version_id,
        dataset_version_id=payload.dataset_version_id,
        dataset_id=payload.dataset_id,
        linked_by=payload.linked_by,
        note=payload.note,
        is_active=True,
    )
    meta_db.add(link)
    await meta_db.flush()
    await meta_db.refresh(link)
    return ModelDatasetLinkRead.model_validate(link)


async def list_model_links(
    meta_db: AsyncSession, model_version_id: int
) -> list[ModelDatasetLinkRead]:
    rows = (await meta_db.execute(
        select(ModelDatasetLink)
        .where(ModelDatasetLink.model_version_id == model_version_id,
               ModelDatasetLink.is_active == True)
        .order_by(ModelDatasetLink.linked_at.desc())
    )).scalars().all()
    return [ModelDatasetLinkRead.model_validate(r) for r in rows]


async def unlink_model_from_dataset_version(
    meta_db: AsyncSession, link_id: int
) -> bool:
    link = await meta_db.get(ModelDatasetLink, link_id)
    if link is None:
        return False
    link.is_active = False
    return True


# ─────────────────────────────────────────────────────────────
# Lineage graph (dataset 기준)
# ─────────────────────────────────────────────────────────────

async def build_lineage_graph(
    meta_db: AsyncSession, dataset_id: int
) -> LineageGraph:
    """특정 dataset_id에 연결된 모든 버전 + 모델 노드/엣지 반환."""

    # 데이터셋 버전 노드
    dv_rows = (await meta_db.execute(
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset_id)
        .order_by(DatasetVersion.created_at)
    )).scalars().all()

    nodes: list[LineageNode] = []
    edges: list[LineageEdge] = []

    for dv in dv_rows:
        nodes.append(LineageNode(
            id=dv.id,
            type="dataset_version",
            label=f"{dv.version_name} [{dv.branch_name}]",
            dataset_id=dv.dataset_id,
            version_name=dv.version_name,
            branch_name=dv.branch_name,
            created_at=dv.created_at,
        ))
        if dv.parent_version_id is not None:
            edges.append(LineageEdge(
                source=dv.parent_version_id,
                source_type="dataset_version",
                target=dv.id,
                target_type="dataset_version",
                label="parent",
            ))

    # 연결된 모델 버전
    dv_ids = [dv.id for dv in dv_rows]
    if dv_ids:
        link_rows = (await meta_db.execute(
            select(ModelDatasetLink)
            .where(
                ModelDatasetLink.dataset_version_id.in_(dv_ids),
                ModelDatasetLink.is_active == True,
            )
        )).scalars().all()

        mv_ids_seen: set[int] = set()
        for link in link_rows:
            if link.model_version_id not in mv_ids_seen:
                mv = await meta_db.get(ModelVersion, link.model_version_id)
                if mv:
                    nodes.append(LineageNode(
                        id=mv.id,
                        type="model_version",
                        label=f"{mv.name} ({mv.framework})" if mv.framework else mv.name,
                        framework=mv.framework,
                        created_at=mv.created_at,
                    ))
                    mv_ids_seen.add(mv.id)

            edges.append(LineageEdge(
                source=link.dataset_version_id,
                source_type="dataset_version",
                target=link.model_version_id,
                target_type="model_version",
                label=link.note or "학습에 사용",
            ))

    return LineageGraph(nodes=nodes, edges=edges)
