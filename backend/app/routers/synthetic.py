import os
import uuid
import shutil
import asyncio
import threading
import multiprocessing as mp
from datetime import datetime
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, List
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.sharding.router import shard_router
from app.models import Image
from app.services.file_handler import resolve_filepath
from app.core.config import get_settings

from app.services.synthetic.generator_flux import run_flux_generation
from app.services.synthetic.generator_qwen import run_qwen_generation
from app.services.synthetic.evaluator_domain import run_domain_gap_eval
from app.services.synthetic.evaluator_lpips import run_lpips_eval
from app.services.synthetic.evaluator_quality import run_quality_eval

router = APIRouter(prefix="/synthetic", tags=["synthetic"])
settings = get_settings()

_task_store = {}

class GenerateRequest(BaseModel):
    dataset_id: int
    batch_id: Optional[str] = None
    model_type: str 
    prompt: str
    gpus: Optional[List[int]] = [0]
    strength: Optional[float] = 0.75
    guidance_scale: Optional[float] = 7.5
    inference_steps: Optional[int] = 50
    seed: Optional[int] = 42

class EvaluateRequest(BaseModel):
    dataset_id: int
    real_batch_id: Optional[str] = None
    synthetic_batch_id: str
    eval_type: str

@router.get("/status/{task_id}")
async def get_task_status(task_id: str):
    info = _task_store.get(task_id)
    if not info:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    return info

def _queue_reader(queue, task_id, store, total_images=None):
    completed = 0
    while True:
        msg = queue.get()
        if msg is None: # Sentinel value to stop
            break
            
        if isinstance(msg, dict) and "__METRICS__" in msg:
            store[task_id]["result"]["metrics"] = msg["__METRICS__"]
            continue
            
        if isinstance(msg, str):
            if "__IMAGE_DONE__" in msg:
                completed += 1
                if total_images:
                    progress = min(100, int((completed / total_images) * 100))
                    store[task_id]["result"]["progress"] = progress
                continue
                
            store[task_id]["last_log"] = msg
            if "logs" not in store[task_id]["result"]:
                store[task_id]["result"]["logs"] = []
            store[task_id]["result"]["logs"].append(msg)
            # keep only last 100 logs
            store[task_id]["result"]["logs"] = store[task_id]["result"]["logs"][-100:]

async def _run_generation(task_id: str, req: GenerateRequest):
    queue = mp.Queue()
    _task_store[task_id]["result"] = {"logs": []}
    
    # Start queue reader thread
    total_images = 0
    # we'll restart reader_thread later when total_images is known, 
    # or just initialize it after getting images?
    # Wait, we can't get total_images until DB query.
    # Let's move reader_thread.start() after we know len(images).

    try:
        _task_store[task_id]["status"] = "preparing"
        
        db = await shard_router.get_session_for_dataset(req.dataset_id)
        try:
            query = select(Image).where(Image.dataset_id == req.dataset_id)
            if req.batch_id:
                query = query.where(Image.upload_batch_id == req.batch_id)
                
            result = await db.execute(query)
            images = result.scalars().all()
        finally:
            await db.close()
        
        if not images:
            raise Exception("선택된 데이터셋/배치에 이미지가 없습니다.")
            
        total_images = len(images)
        reader_thread = threading.Thread(target=_queue_reader, args=(queue, task_id, _task_store, total_images))
        reader_thread.start()
        
        base_dir = os.path.abspath(os.path.join("data", "synthetic", task_id))
        input_dir = os.path.join(base_dir, "input")
        output_dir = os.path.join(base_dir, "output")
        os.makedirs(input_dir, exist_ok=True)
        os.makedirs(output_dir, exist_ok=True)
        
        for img in images:
            src_path = resolve_filepath(img.filepath)
            if os.path.exists(src_path):
                dst_path = os.path.join(input_dir, img.filename)
                shutil.copy2(src_path, dst_path)
                
        _task_store[task_id]["status"] = "running"
        
        # Run generation in a separate thread to not block asyncio event loop
        # The underlying generators will spawn their own Processes for GPUs
        if req.model_type == 'flux':
            await asyncio.to_thread(
                run_flux_generation,
                input_dir, output_dir, req.prompt, req.gpus, req.strength, 
                req.guidance_scale, req.inference_steps, req.seed, False, queue
            )
        elif req.model_type == 'qwen':
            await asyncio.to_thread(
                run_qwen_generation,
                input_dir, output_dir, req.prompt, req.gpus, False, queue
            )
        else:
            raise Exception("지원하지 않는 모델 타입입니다.")
            
        # Ingest synthetic images into DB
        from app.services.file_handler import (
            calculate_md5_bytes, calculate_phash, get_image_dimensions,
            get_file_format, save_image_to_storage
        )
        
        batch_id = f"synthetic_{req.model_type}_{task_id}"
        db = await shard_router.get_session_for_dataset(req.dataset_id)
        try:
            existing = await db.execute(
                select(Image.file_hash).where(Image.dataset_id == req.dataset_id)
            )
            existing_hashes = {row[0] for row in existing if row[0]}
            
            for fname in os.listdir(output_dir):
                fpath = os.path.join(output_dir, fname)
                if not os.path.isfile(fpath): continue
                
                with open(fpath, "rb") as f:
                    data = f.read()
                    
                md5 = calculate_md5_bytes(data)
                if md5 in existing_hashes: continue
                
                abs_path, key = save_image_to_storage(data, fname, req.dataset_id)
                w, h = get_image_dimensions(abs_path)
                phash = calculate_phash(abs_path)
                fmt = get_file_format(abs_path)
                
                img = Image(
                    dataset_id=req.dataset_id,
                    filename=Path(abs_path).name,
                    filepath=key,
                    width=w, height=h, format=fmt,
                    file_hash=md5, phash=phash,
                    upload_batch_id=batch_id,
                )
                db.add(img)
                existing_hashes.add(md5)
                
            await db.commit()
        finally:
            await db.close()
            
        # Delete input directory to save space
        shutil.rmtree(input_dir, ignore_errors=True)

        _task_store[task_id]["status"] = "done"
        _task_store[task_id]["result"]["output_dir"] = output_dir
        _task_store[task_id]["result"]["input_dir"] = input_dir
        _task_store[task_id]["result"]["progress"] = 100
        _task_store[task_id]["result"]["batch_id"] = batch_id
            
    except Exception as e:
        _task_store[task_id]["status"] = "error"
        _task_store[task_id]["error"] = str(e)
    finally:
        queue.put(None) # stop reader
        reader_thread.join()

@router.post("/generate", status_code=202)
async def generate_synthetic_data(
    req: GenerateRequest,
    background_tasks: BackgroundTasks
):
    task_id = str(uuid.uuid4())
    _task_store[task_id] = {
        "status": "pending", 
        "result": {"progress": 0}, 
        "error": None,
        "last_log": "",
        "req": req.model_dump()
    }
    
    background_tasks.add_task(_run_generation, task_id, req)
    return {"task_id": task_id, "status": "pending"}


async def _run_evaluation(eval_task_id: str, req: EvaluateRequest):
    queue = mp.Queue()
    _task_store[eval_task_id]["result"] = {"logs": []}
    
    reader_thread = threading.Thread(target=_queue_reader, args=(queue, eval_task_id, _task_store, None))
    reader_thread.start()

    base_dir = os.path.abspath(os.path.join("data", "evaluation", eval_task_id))
    real_dir = os.path.join(base_dir, "real")
    syn_dir = os.path.join(base_dir, "synthetic")
    
    try:
        _task_store[eval_task_id]["status"] = "running"
        
        # 1. Query synthetic images
        db = await shard_router.get_session_for_dataset(req.dataset_id)
        try:
            query = select(Image).where(Image.dataset_id == req.dataset_id, Image.upload_batch_id == req.synthetic_batch_id)
            result = await db.execute(query)
            syn_images = result.scalars().all()
        finally:
            await db.close()
            
        if not syn_images:
            raise Exception("평가 대상 합성 배치에 이미지가 없습니다.")

        # 2. Process copying for evaluation
        if req.eval_type in ["domain_gap", "lpips"]:
            os.makedirs(real_dir, exist_ok=True)
            os.makedirs(syn_dir, exist_ok=True)
            
            db = await shard_router.get_session_for_dataset(req.dataset_id)
            try:
                query = select(Image).where(Image.dataset_id == req.dataset_id)
                if req.real_batch_id:
                    query = query.where(Image.upload_batch_id == req.real_batch_id)
                else:
                    # If real_batch_id is not specified, get all images that are NOT synthetic
                    query = query.where(
                        (Image.upload_batch_id == None) | (~Image.upload_batch_id.like("synthetic_%"))
                    )
                result = await db.execute(query)
                real_images = result.scalars().all()
            finally:
                await db.close()
                
            if not real_images:
                raise Exception("비교 대상 원본 배치에 이미지가 없습니다.")
                
            # Helper to clean filename for comparison
            def clean_name(name):
                if len(name) > 9 and name[8] == '_':
                    name = name[9:]
                if name.startswith("syn_"):
                    name = name[4:]
                elif name.startswith("syn"):
                    name = name[3:]
                return name

            # Match and copy pairs
            copied_count = 0
            for syn_img in syn_images:
                matched_real = None
                
                # A. Try finding a real image where syn_img.filename ends with f"_syn_{real_img.filename}"
                for r_img in real_images:
                    if syn_img.filename.endswith(f"_syn_{r_img.filename}"):
                        matched_real = r_img
                        break
                
                # B. Try finding a real image by splitting by _syn_ and taking the last part
                if not matched_real and "_syn_" in syn_img.filename:
                    suffix = syn_img.filename.split("_syn_")[-1]
                    for r_img in real_images:
                        if r_img.filename == suffix:
                            matched_real = r_img
                            break
                            
                # C. Try slicing first 9 chars (hex prefix)
                if not matched_real and len(syn_img.filename) > 9:
                    stripped = syn_img.filename[9:]
                    for r_img in real_images:
                        if stripped == f"syn_{r_img.filename}" or stripped == r_img.filename:
                            matched_real = r_img
                            break
                            
                # D. Fallback to cleaned name comparison
                if not matched_real:
                    clean_syn = clean_name(syn_img.filename)
                    for r_img in real_images:
                        if clean_name(r_img.filename) == clean_syn:
                            matched_real = r_img
                            break
                
                if matched_real:
                    real_src = resolve_filepath(matched_real.filepath)
                    syn_src = resolve_filepath(syn_img.filepath)
                    
                    if os.path.exists(real_src) and os.path.exists(syn_src):
                        shutil.copy2(real_src, os.path.join(real_dir, matched_real.filename))
                        # LPIPS evaluation expects files in syn_dir to be named f"syn_{real_filename}" or matching real_filename
                        shutil.copy2(syn_src, os.path.join(syn_dir, f"syn_{matched_real.filename}"))
                        copied_count += 1
                        
            if copied_count == 0:
                # Fallback to copy all as is
                for syn_img in syn_images:
                    src_path = resolve_filepath(syn_img.filepath)
                    if os.path.exists(src_path):
                        shutil.copy2(src_path, os.path.join(syn_dir, syn_img.filename))
                for r_img in real_images:
                    src_path = resolve_filepath(r_img.filepath)
                    if os.path.exists(src_path):
                        shutil.copy2(src_path, os.path.join(real_dir, r_img.filename))
        else:
            # Quality evaluation only needs synthetic images
            os.makedirs(syn_dir, exist_ok=True)
            for img in syn_images:
                src_path = resolve_filepath(img.filepath)
                if os.path.exists(src_path):
                    shutil.copy2(src_path, os.path.join(syn_dir, img.filename))
        
        # 3. Run evaluation in separate process
        ctx = mp.get_context('spawn')
        
        if req.eval_type == "domain_gap":
            p = ctx.Process(target=run_domain_gap_eval, args=(real_dir, syn_dir, 32, True, queue))
        elif req.eval_type == "lpips":
            p = ctx.Process(target=run_lpips_eval, args=(real_dir, syn_dir, 'alex', True, queue))
        elif req.eval_type == "quality":
            p = ctx.Process(target=run_quality_eval, args=(syn_dir, True, queue))
        else:
            raise Exception("지원하지 않는 평가 타입입니다.")
            
        p.start()
        
        # Poll process in a thread so we don't block asyncio
        await asyncio.to_thread(p.join)
        
        if p.exitcode == 0:
            _task_store[eval_task_id]["status"] = "done"
        else:
            _task_store[eval_task_id]["status"] = "error"
            _task_store[eval_task_id]["error"] = "프로세스 비정상 종료"
            
    except Exception as e:
        _task_store[eval_task_id]["status"] = "error"
        _task_store[eval_task_id]["error"] = str(e)
    finally:
        shutil.rmtree(base_dir, ignore_errors=True)
        queue.put(None)
        reader_thread.join()

@router.post("/evaluate", status_code=202)
async def evaluate_synthetic_data(
    req: EvaluateRequest,
    background_tasks: BackgroundTasks
):
    eval_task_id = str(uuid.uuid4())
    _task_store[eval_task_id] = {
        "status": "pending", 
        "result": {}, 
        "error": None,
        "last_log": "",
        "eval_type": req.eval_type,
        "req": req.model_dump()
    }
    
    background_tasks.add_task(_run_evaluation, eval_task_id, req)
    return {"task_id": eval_task_id, "status": "pending"}
