"""
Dataset export service — COCO JSON / YOLO / Pascal VOC
Each format includes a build_manifest.json in the ZIP.
"""
import json
import os
import zipfile
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models import Image, Annotation, Class, Dataset
from app.core.config import get_settings
from app.services.file_handler import resolve_filepath

settings = get_settings()


# ---------------------------------------------------------------------------
# Manifest builder
# ---------------------------------------------------------------------------

async def _build_manifest(
    db: AsyncSession,
    dataset: Dataset,
    classes: list,
    images: list,
    export_format: str,
) -> dict:
    """
    Build a build_manifest.json dict from the current dataset state.

    Fields derived from DB:
      dataset_name, export_format, exported_at,
      canonical_classes, statistics (image/annotation counts per class)

    Fields not tracked by this pipeline (kept for schema compatibility):
      source_datasets, sampling_policy, splits
    """
    # Annotation counts per class
    rows = (
        await db.execute(
            select(Annotation.class_id, func.count(Annotation.id))
            .join(Image, Annotation.image_id == Image.id)
            .where(Image.dataset_id == dataset.id)
            .group_by(Annotation.class_id)
        )
    ).all()

    class_id_to_name = {cls.id: cls.name for cls in classes}
    annotation_counts_by_class = {
        class_id_to_name[r[0]]: r[1]
        for r in rows
        if r[0] in class_id_to_name
    }
    total_annotations = sum(annotation_counts_by_class.values())

    return {
        "dataset_name": dataset.name,
        "export_format": export_format,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "canonical_classes": sorted(cls.name for cls in classes),
        "statistics": {
            "num_images": len(images),
            "num_annotations": total_annotations,
            "annotation_counts_by_class": annotation_counts_by_class,
        },
        # Fields below are not tracked by this pipeline.
        # Populate manually or via an external build process if needed.
        "source_datasets": [],
        "sampling_policy": None,
        "splits": {},
    }


# ---------------------------------------------------------------------------
# Export functions
# ---------------------------------------------------------------------------

async def export_coco(db: AsyncSession, dataset_id: int) -> str:
    """Export as COCO JSON format -> returns ZIP file path."""
    dataset = await db.get(Dataset, dataset_id)
    images = (await db.execute(select(Image).where(Image.dataset_id == dataset_id))).scalars().all()
    classes = (await db.execute(select(Class).where(Class.dataset_id == dataset_id))).scalars().all()

    coco = {
        "info": {
            "description": dataset.name,
            "version": "1.0",
            "year": datetime.now().year,
            "date_created": datetime.now().isoformat(),
        },
        "categories": [
            {"id": cls.id, "name": cls.name, "supercategory": "object"}
            for cls in classes
        ],
        "images": [],
        "annotations": [],
    }

    ann_id = 1
    for img in images:
        coco["images"].append({
            "id": img.id,
            "file_name": img.filename,
            "width": img.width or 0,
            "height": img.height or 0,
        })
        anns = (
            await db.execute(select(Annotation).where(Annotation.image_id == img.id))
        ).scalars().all()
        for ann in anns:
            if ann.bbox_w is None:
                continue
            w_px = ann.bbox_w * (img.width or 1)
            h_px = ann.bbox_h * (img.height or 1)
            x_px = ann.bbox_x * (img.width or 1)
            y_px = ann.bbox_y * (img.height or 1)
            coco["annotations"].append({
                "id": ann_id,
                "image_id": img.id,
                "category_id": ann.class_id,
                "bbox": [round(x_px, 2), round(y_px, 2), round(w_px, 2), round(h_px, 2)],
                "area": round(w_px * h_px, 2),
                "iscrowd": 0,
            })
            ann_id += 1

    manifest = await _build_manifest(db, dataset, list(classes), list(images), "coco")

    return _make_zip(
        dataset_id,
        "coco",
        {
            "annotations.json": json.dumps(coco, ensure_ascii=False, indent=2),
            "build_manifest.json": json.dumps(manifest, ensure_ascii=False, indent=2),
        },
        images,
    )


async def export_yolo(db: AsyncSession, dataset_id: int) -> str:
    """Export as YOLO format -> returns ZIP file path."""
    classes = (await db.execute(select(Class).where(Class.dataset_id == dataset_id))).scalars().all()
    images = (await db.execute(select(Image).where(Image.dataset_id == dataset_id))).scalars().all()
    dataset = await db.get(Dataset, dataset_id)
    class_id_to_idx = {cls.id: i for i, cls in enumerate(classes)}

    label_files: dict[str, str] = {}
    label_files["classes.txt"] = "\n".join(cls.name for cls in classes)

    for img in images:
        anns = (
            await db.execute(select(Annotation).where(Annotation.image_id == img.id))
        ).scalars().all()
        lines = []
        for ann in anns:
            if ann.class_id is None or ann.bbox_w is None:
                continue
            idx = class_id_to_idx.get(ann.class_id, 0)
            cx = ann.bbox_x + ann.bbox_w / 2
            cy = ann.bbox_y + ann.bbox_h / 2
            lines.append(f"{idx} {cx:.6f} {cy:.6f} {ann.bbox_w:.6f} {ann.bbox_h:.6f}")
        label_files[f"labels/{Path(img.filename).stem}.txt"] = "\n".join(lines)

    manifest = await _build_manifest(db, dataset, list(classes), list(images), "yolo")
    label_files["build_manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2)

    return _make_zip(dataset_id, "yolo", label_files, images)


async def export_pascal_voc(db: AsyncSession, dataset_id: int) -> str:
    """Export as Pascal VOC XML format -> returns ZIP file path."""
    try:
        from lxml import etree
    except ImportError:
        import xml.etree.ElementTree as etree

    dataset = await db.get(Dataset, dataset_id)
    classes_result = (await db.execute(select(Class).where(Class.dataset_id == dataset_id))).scalars().all()
    classes = {cls.id: cls.name for cls in classes_result}
    images = (await db.execute(select(Image).where(Image.dataset_id == dataset_id))).scalars().all()

    xml_files: dict[str, str] = {}
    for img in images:
        anns = (
            await db.execute(select(Annotation).where(Annotation.image_id == img.id))
        ).scalars().all()

        root = etree.Element("annotation")
        etree.SubElement(root, "filename").text = img.filename
        size = etree.SubElement(root, "size")
        etree.SubElement(size, "width").text = str(img.width or 0)
        etree.SubElement(size, "height").text = str(img.height or 0)
        etree.SubElement(size, "depth").text = "3"

        for ann in anns:
            if ann.bbox_w is None:
                continue
            w = img.width or 1
            h = img.height or 1
            obj = etree.SubElement(root, "object")
            etree.SubElement(obj, "name").text = classes.get(ann.class_id, "Unknown")
            etree.SubElement(obj, "difficult").text = "0"
            bndbox = etree.SubElement(obj, "bndbox")
            etree.SubElement(bndbox, "xmin").text = str(int(ann.bbox_x * w))
            etree.SubElement(bndbox, "ymin").text = str(int(ann.bbox_y * h))
            etree.SubElement(bndbox, "xmax").text = str(int((ann.bbox_x + ann.bbox_w) * w))
            etree.SubElement(bndbox, "ymax").text = str(int((ann.bbox_y + ann.bbox_h) * h))

        xml_str = etree.tostring(root, pretty_print=True, encoding="unicode")
        xml_files[f"annotations/{Path(img.filename).stem}.xml"] = xml_str

    manifest = await _build_manifest(db, dataset, list(classes_result), list(images), "pascal_voc")
    xml_files["build_manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2)

    return _make_zip(dataset_id, "voc", xml_files, images)


# ---------------------------------------------------------------------------
# ZIP helper
# ---------------------------------------------------------------------------

def _make_zip(dataset_id: int, fmt: str, text_files: dict, images: list) -> str:
    """Bundle text files and images into a ZIP, return the ZIP path."""
    os.makedirs(settings.exports_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_path = os.path.join(settings.exports_dir, f"dataset_{dataset_id}_{fmt}_{timestamp}.zip")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in text_files.items():
            zf.writestr(name, content)
        for img in images:
            if img.filepath:
                abs_path = resolve_filepath(img.filepath)
                if os.path.exists(abs_path):
                    zf.write(abs_path, f"images/{img.filename}")

    return zip_path
