import json
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func
from app.database import get_db
from app.models import Dataset, Image, Annotation, Class
from app.models.auto_label_run import AutoLabelRun
from app.core.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auto-label", tags=["auto-label"])


class AutoLabelRequest(BaseModel):
    text_prompts: list[str] = Field(
        default=["person", "car", "animal"],
        min_length=1,
        description="Text prompts for YOLO-World open-vocabulary detection",
    )
    confidence_threshold: float = Field(default=0.25, ge=0.01, le=1.0)
    overwrite: bool = Field(default=False, description="Delete existing auto-labels before running")


class AutoLabelRunRead(BaseModel):
    id: int
    dataset_id: int
    model_name: str
    confidence_threshold: float
    iou_threshold: float
    text_prompts: str | None = None
    status: str
    total_images: int
    processed_images: int
    total_annotations: int
    error_message: str | None = None

    model_config = {"from_attributes": True}


class AutoLabelRunList(BaseModel):
    items: list[AutoLabelRunRead]
    total: int


async def _run_auto_label(
    run_id: int,
    dataset_id: int,
    text_prompts: list[str],
    confidence_threshold: float,
    overwrite: bool,
):
    """Background task: run YOLO-World inference on all images in dataset."""
    from app.services.auto_label_service import predict_image
    from app.services.file_handler import resolve_filepath
    from app.sharding.router import shard_router

    meta_session = shard_router.get_meta_session()
    shard_session = await shard_router.get_session_for_dataset(dataset_id)

    try:
        # Mark run as running (only if still pending)
        async with meta_session:
            db_run = await meta_session.get(AutoLabelRun, run_id)
            if not db_run or db_run.status != "pending":
                logger.info(
                    "Auto-label run %s is not pending (status: %s). Aborting startup.",
                    run_id,
                    db_run.status if db_run else "None",
                )
                return

            db_run.status = "running"
            await meta_session.commit()

        async with shard_session:
            # Load all images
            img_result = await shard_session.execute(
                select(Image).where(Image.dataset_id == dataset_id)
            )
            images = img_result.scalars().all()

            # Load existing class map {name: Class}
            cls_result = await shard_session.execute(
                select(Class).where(Class.dataset_id == dataset_id)
            )
            class_map = {c.name: c for c in cls_result.scalars().all()}

            # Optionally wipe existing auto-labels
            if overwrite:
                auto_ids_result = await shard_session.execute(
                    select(Annotation.id)
                    .join(Image, Annotation.image_id == Image.id)
                    .where(
                        Image.dataset_id == dataset_id,
                        Annotation.is_auto_generated == True,
                    )
                )
                ids_to_delete = [r[0] for r in auto_ids_result.all()]
                if ids_to_delete:
                    await shard_session.execute(
                        delete(Annotation).where(Annotation.id.in_(ids_to_delete))
                    )
                await shard_session.commit()

            total = len(images)
            processed = 0
            total_anns = 0

            for img in images:
                # Check if cancelled/stopped by user
                ms_check = shard_router.get_meta_session()
                async with ms_check:
                    db_run = await ms_check.get(AutoLabelRun, run_id)
                    if db_run and db_run.status != "running":
                        logger.info(
                            "Auto-label run %s has status '%s' (not 'running'). Stopping.",
                            run_id,
                            db_run.status,
                        )
                        return

                try:
                    abs_path = resolve_filepath(img.filepath)
                    detections = predict_image(abs_path, text_prompts, confidence_threshold)

                    for det in detections:
                        cname = det["class_name"]

                        # Get or create class
                        if cname not in class_map:
                            new_cls = Class(dataset_id=dataset_id, name=cname)
                            shard_session.add(new_cls)
                            await shard_session.flush()
                            class_map[cname] = new_cls

                        # Serialize polygon (None for YOLO-World)
                        seg_json = None
                        if det.get("segmentation"):
                            seg_json = json.dumps(det["segmentation"])

                        ann = Annotation(
                            image_id=img.id,
                            class_id=class_map[cname].id,
                            bbox_x=det["bbox"]["x"],
                            bbox_y=det["bbox"]["y"],
                            bbox_w=det["bbox"]["w"],
                            bbox_h=det["bbox"]["h"],
                            segmentation=seg_json,
                            annotation_type="bbox",
                            is_auto_generated=True,
                            confidence=det["confidence"],
                            source_prompt=json.dumps(text_prompts),
                            auto_label_run_id=run_id,
                        )
                        shard_session.add(ann)
                        total_anns += 1

                    await shard_session.commit()

                except FileNotFoundError:
                    logger.warning("Image file not found: %s", img.filepath)
                except Exception as e:
                    logger.error("Error on image %s: %s", img.id, e)
                finally:
                    processed += 1

                # Update progress every 10 images
                if processed % 10 == 0 or processed == total:
                    ms = shard_router.get_meta_session()
                    async with ms:
                        await ms.execute(
                            update(AutoLabelRun)
                            .where(AutoLabelRun.id == run_id)
                            .values(processed_images=processed, total_annotations=total_anns)
                        )
                        await ms.commit()

        # Mark completed
        ms2 = shard_router.get_meta_session()
        async with ms2:
            await ms2.execute(
                update(AutoLabelRun)
                .where(AutoLabelRun.id == run_id)
                .values(status="completed", processed_images=total, total_annotations=total_anns)
            )
            await ms2.commit()

    except Exception as e:
        logger.error("Auto-label run %s failed: %s", run_id, e)
        ms3 = shard_router.get_meta_session()
        async with ms3:
            await ms3.execute(
                update(AutoLabelRun)
                .where(AutoLabelRun.id == run_id)
                .values(status="failed", error_message=str(e)[:1000])
            )
            await ms3.commit()


@router.post("/datasets/{dataset_id}/runs", response_model=AutoLabelRunRead, status_code=202)
async def start_auto_label(
    dataset_id: int,
    req: AutoLabelRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    ds = await db.get(Dataset, dataset_id)
    if ds is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if not req.text_prompts:
        raise HTTPException(status_code=422, detail="text_prompts must not be empty")

    # Block if a run is already active
    running = await db.scalar(
        select(AutoLabelRun).where(
            AutoLabelRun.dataset_id == dataset_id,
            AutoLabelRun.status.in_(["pending", "running"]),
        )
    )
    if running:
        raise HTTPException(status_code=409, detail="Auto-label job already running for this dataset")

    total_images = await db.scalar(
        select(func.count(Image.id)).where(Image.dataset_id == dataset_id)
    ) or 0

    run = AutoLabelRun(
        dataset_id=dataset_id,
        model_name="yolo-world",
        confidence_threshold=req.confidence_threshold,
        iou_threshold=0.0,
        text_prompts=json.dumps(req.text_prompts),
        status="pending",
        total_images=total_images,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    background_tasks.add_task(
        _run_auto_label,
        run_id=run.id,
        dataset_id=dataset_id,
        text_prompts=req.text_prompts,
        confidence_threshold=req.confidence_threshold,
        overwrite=req.overwrite,
    )
    return run


@router.get("/datasets/{dataset_id}/runs", response_model=AutoLabelRunList)
async def list_runs(dataset_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AutoLabelRun)
        .where(AutoLabelRun.dataset_id == dataset_id)
        .order_by(AutoLabelRun.created_at.desc())
    )
    runs = result.scalars().all()
    return AutoLabelRunList(items=list(runs), total=len(runs))


@router.get("/datasets/{dataset_id}/runs/{run_id}", response_model=AutoLabelRunRead)
async def get_run(dataset_id: int, run_id: int, db: AsyncSession = Depends(get_db)):
    run = await db.scalar(
        select(AutoLabelRun).where(
            AutoLabelRun.id == run_id,
            AutoLabelRun.dataset_id == dataset_id,
        )
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.delete("/datasets/{dataset_id}/runs/{run_id}/annotations", status_code=204)
async def delete_auto_annotations(dataset_id: int, run_id: int):
    from app.sharding.router import shard_router
    shard_session = await shard_router.get_session_for_dataset(dataset_id)
    async with shard_session:
        ids_result = await shard_session.execute(
            select(Annotation.id)
            .join(Image, Annotation.image_id == Image.id)
            .where(
                Image.dataset_id == dataset_id,
                Annotation.auto_label_run_id == run_id,
            )
        )
        ids = [r[0] for r in ids_result.all()]
        if ids:
            await shard_session.execute(delete(Annotation).where(Annotation.id.in_(ids)))
            await shard_session.commit()


@router.post("/datasets/{dataset_id}/runs/{run_id}/cancel", response_model=AutoLabelRunRead)
async def cancel_auto_label(
    dataset_id: int,
    run_id: int,
    db: AsyncSession = Depends(get_db),
):
    run = await db.scalar(
        select(AutoLabelRun).where(
            AutoLabelRun.id == run_id,
            AutoLabelRun.dataset_id == dataset_id,
        )
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    if run.status not in ["pending", "running"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel a run that is already {run.status}",
        )

    run.status = "failed"
    run.error_message = "Stopped by user"
    await db.commit()
    await db.refresh(run)
    return run
