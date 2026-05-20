"""
데이터셋 통계 및 시각화 데이터 계산 서비스
"""
import json
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models import Image, Annotation, Class


async def get_class_distribution(db: AsyncSession, dataset_id: int) -> list[dict]:
    """클래스별 주석 수 집계"""
    stmt = (
        select(Class.name, Class.color, func.count(Annotation.id).label("count"))
        .join(Annotation, Annotation.class_id == Class.id, isouter=True)
        .join(Image, Annotation.image_id == Image.id, isouter=True)
        .where(Class.dataset_id == dataset_id)
        .group_by(Class.id, Class.name, Class.color)
        .order_by(func.count(Annotation.id).desc())
    )
    result = await db.execute(stmt)
    return [{"name": row.name, "color": row.color, "count": row.count} for row in result]


async def get_bbox_stats(db: AsyncSession, dataset_id: int) -> dict:
    from sqlalchemy import func as F

    stmt = (
        select(
            F.count(Annotation.id).label("cnt"),
            F.min(Annotation.bbox_w).label("w_min"),
            F.max(Annotation.bbox_w).label("w_max"),
            F.avg(Annotation.bbox_w).label("w_avg"),
            F.stddev(Annotation.bbox_w).label("w_std"),
            F.percentile_cont(0.5).within_group(Annotation.bbox_w).label("w_med"),
            F.min(Annotation.bbox_h).label("h_min"),
            F.max(Annotation.bbox_h).label("h_max"),
            F.avg(Annotation.bbox_h).label("h_avg"),
            F.stddev(Annotation.bbox_h).label("h_std"),
            F.percentile_cont(0.5).within_group(Annotation.bbox_h).label("h_med"),
            F.min(Annotation.bbox_w * Annotation.bbox_h).label("a_min"),
            F.max(Annotation.bbox_w * Annotation.bbox_h).label("a_max"),
            F.avg(Annotation.bbox_w * Annotation.bbox_h).label("a_avg"),
            F.stddev(Annotation.bbox_w * Annotation.bbox_h).label("a_std"),
            F.percentile_cont(0.5).within_group(
                Annotation.bbox_w * Annotation.bbox_h
            ).label("a_med"),
        )
        .join(Image, Annotation.image_id == Image.id)
        .where(
            Image.dataset_id == dataset_id,
            Annotation.annotation_type == "bbox",
            Annotation.bbox_w.isnot(None),
            Annotation.bbox_h.isnot(None),
        )
    )
    row = (await db.execute(stmt)).one()

    if not row.cnt:
        return {"count": 0, "width_stats": {}, "height_stats": {}, "area_stats": {}}

    def _fmt(v):
        return round(float(v), 2) if v is not None else 0.0

    return {
        "count": row.cnt,
        "width_stats":  {"min": _fmt(row.w_min), "max": _fmt(row.w_max), "mean": _fmt(row.w_avg), "median": _fmt(row.w_med), "std": _fmt(row.w_std)},
        "height_stats": {"min": _fmt(row.h_min), "max": _fmt(row.h_max), "mean": _fmt(row.h_avg), "median": _fmt(row.h_med), "std": _fmt(row.h_std)},
        "area_stats":   {"min": _fmt(row.a_min), "max": _fmt(row.a_max), "mean": _fmt(row.a_avg), "median": _fmt(row.a_med), "std": _fmt(row.a_std)},
    }


async def get_dataset_summary(db: AsyncSession, dataset_id: int) -> dict:
    """데이터셋 개요 통계"""
    image_count = await db.scalar(
        select(func.count()).select_from(Image).where(Image.dataset_id == dataset_id)
    ) or 0
    annotation_count = await db.scalar(
        select(func.count())
        .select_from(Annotation)
        .join(Image)
        .where(Image.dataset_id == dataset_id)
    ) or 0
    class_count = await db.scalar(
        select(func.count()).select_from(Class).where(Class.dataset_id == dataset_id)
    ) or 0
    unlabeled_count = await db.scalar(
        select(func.count())
        .select_from(Image)
        .outerjoin(Annotation, Annotation.image_id == Image.id)
        .where(Image.dataset_id == dataset_id, Annotation.id.is_(None))
    ) or 0
    return {
        "image_count": image_count,
        "annotation_count": annotation_count,
        "class_count": class_count,
        "unlabeled_count": unlabeled_count,
        "avg_annotations_per_image": (
            round(annotation_count / image_count, 2) if image_count > 0 else 0
        ),
    }


def parse_coco_json(coco_data: dict) -> dict:
    """COCO JSON 분석 — 통계 반환"""
    images = coco_data.get("images", [])
    annotations = coco_data.get("annotations", [])
    categories = coco_data.get("categories", [])

    cat_map = {c["id"]: c["name"] for c in categories}
    class_counts: dict[str, int] = {}
    areas = []
    for ann in annotations:
        cat_name = cat_map.get(ann.get("category_id"), "Unknown")
        class_counts[cat_name] = class_counts.get(cat_name, 0) + 1
        bbox = ann.get("bbox")
        if bbox and len(bbox) == 4:
            areas.append(bbox[2] * bbox[3])

    return {
        "image_count": len(images),
        "annotation_count": len(annotations),
        "class_count": len(categories),
        "class_distribution": [
            {"name": k, "count": v} for k, v in class_counts.items()
        ],
        "area_stats": {
            "min": min(areas) if areas else 0,
            "max": max(areas) if areas else 0,
            "mean": round(sum(areas) / len(areas), 2) if areas else 0,
        },
    }


async def get_annotation_embeddings(db: AsyncSession, dataset_id: int) -> dict:
    """
    어노테이션 피처(cx, cy, w, h) → PCA 2D 투영.
    클래스별 색상과 함께 산점도 데이터 반환.
    """
    import numpy as np

    stmt = (
        select(
            Annotation.id,
            Annotation.bbox_x,
            Annotation.bbox_y,
            Annotation.bbox_w,
            Annotation.bbox_h,
            Annotation.class_id,
            Class.name.label("class_name"),
            Class.color.label("class_color"),
        )
        .join(Image, Annotation.image_id == Image.id)
        .outerjoin(Class, Annotation.class_id == Class.id)
        .where(
            Image.dataset_id == dataset_id,
            Annotation.annotation_type == "bbox",
            Annotation.bbox_w.isnot(None),
            Annotation.bbox_h.isnot(None),
        )
    )
    result = await db.execute(stmt)
    rows = result.all()

    if len(rows) < 2:
        return {"points": [], "total": len(rows), "note": "데이터가 부족합니다 (최소 2개 필요)"}

    # Feature matrix: [cx, cy, w, h]
    features = np.array([
        [
            (r.bbox_x or 0) + (r.bbox_w or 0) / 2,   # cx
            (r.bbox_y or 0) + (r.bbox_h or 0) / 2,   # cy
            r.bbox_w or 0,
            r.bbox_h or 0,
        ]
        for r in rows
    ], dtype=float)

    # PCA 2D — 수동 구현 (numpy만 사용)
    mean = features.mean(axis=0)
    centered = features - mean
    cov = np.cov(centered.T)
    eigenvalues, eigenvectors = np.linalg.eigh(cov)
    # 가장 분산이 큰 2개 축 선택
    idx = np.argsort(eigenvalues)[::-1][:2]
    components = eigenvectors[:, idx]
    projected = centered @ components  # (N, 2)

    points = []
    for i, r in enumerate(rows):
        points.append({
            "x": round(float(projected[i, 0]), 5),
            "y": round(float(projected[i, 1]), 5),
            "annotation_id": r.id,
            "class_name": r.class_name or "미분류",
            "class_color": r.class_color or "#94a3b8",
        })

    return {"points": points, "total": len(points)}
