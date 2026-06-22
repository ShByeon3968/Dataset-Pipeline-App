import os
import torch
import math
import torch.multiprocessing as mp
from PIL import Image
import sys

def process_image_chunk(worker_id, gpu_id, image_files, input_dir, output_dir, prompt, use_compile, queue):
    class QueueWriter:
        def write(self, msg):
            if msg.strip():
                queue.put(msg.strip())
        def flush(self): pass
    sys.stdout = QueueWriter()
    sys.stderr = QueueWriter()
    
    try:
        from diffusers import QwenImageEditPlusPipeline
        
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

        device = f"cuda:{gpu_id}"
        print(f"[Worker {worker_id}] Loading Pipeline on {device}...")
        
        pipeline = QwenImageEditPlusPipeline.from_pretrained(
            "Qwen/Qwen-Image-Edit-2511", 
            torch_dtype=torch.bfloat16
        ).to(device)
        
        pipeline.set_progress_bar_config(disable=True)

        if use_compile:
            print(f"[Worker {worker_id}] Compiling (may take time)...")
            pipeline.transformer = torch.compile(
                pipeline.transformer, mode="reduce-overhead", fullgraph=False, dynamic=True 
            )

        is_warmed_up = False
        
        for idx, filename in enumerate(image_files, 1):
            img_path = os.path.join(input_dir, filename)
            try:
                image = Image.open(img_path).convert("RGB")
                
                inputs = {
                    "image": image,
                    "prompt": prompt,
                    "generator": torch.manual_seed(0),
                    "true_cfg_scale": 1.0,             
                    "negative_prompt": None,
                    "num_inference_steps": 30,         
                    "guidance_scale": 1.0,
                    "num_images_per_prompt": 1,
                }
                
                output = pipeline(**inputs)
                output_image = output.images[0]
                
                output_path = os.path.join(output_dir, f"syn_{filename}")
                output_image.save(output_path)
                
                print(f"[Worker {worker_id}] Progress: {idx}/{len(image_files)} ({filename})")
                print("__IMAGE_DONE__")
                is_warmed_up = True
            except Exception as e:
                print(f"[Worker {worker_id}] Error processing {filename}: {e}")

        print(f"[Worker {worker_id}] Done!")
    except Exception as e:
        print(f"[Worker {worker_id}] Fatal Error: {e}")
        sys.exit(1)


def run_qwen_generation(input_dir: str, output_dir: str, prompt: str, gpus: list, use_compile: bool, queue):
    class QueueWriter:
        def write(self, msg):
            if msg.strip():
                queue.put(msg.strip())
        def flush(self): pass
    sys.stdout = QueueWriter()
    sys.stderr = QueueWriter()

    try:
        os.makedirs(output_dir, exist_ok=True)
        valid_extensions = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
        image_files = sorted([f for f in os.listdir(input_dir) if f.lower().endswith(valid_extensions)])
        total_images = len(image_files)
        print(f"Total images: {total_images}")

        if total_images == 0:
            return

        NUM_WORKERS = len(gpus)
        chunk_size = math.ceil(total_images / NUM_WORKERS)
        chunks = [image_files[i:i + chunk_size] for i in range(0, total_images, chunk_size)]
        
        processes = []
        print(f"Starting {NUM_WORKERS} workers on GPUs: {gpus}...")
        
        ctx = mp.get_context('spawn')
        
        for i, chunk in enumerate(chunks):
            if not chunk: continue
            gpu_id = gpus[i]
            p = ctx.Process(
                target=process_image_chunk, 
                args=(i, gpu_id, chunk, input_dir, output_dir, prompt, use_compile, queue)
            )
            processes.append(p)
            p.start()

        for p in processes:
            p.join()
            if p.exitcode != 0:
                raise Exception(f"Worker process failed with exit code {p.exitcode}")
            
        print("All processes completed.")
    except Exception as e:
        print(f"Error in Qwen Generation: {e}")
        raise e
