import os
import csv
import torch
import torchvision.transforms as transforms
from PIL import Image
import numpy as np
import sys

def load_image_tensor(path, device):
    img = Image.open(path).convert('RGB')
    transform = transforms.Compose([
        transforms.ToTensor()
    ])
    return transform(img).unsqueeze(0).to(device)

def compute_laplacian_variance(img_tensor):
    gray = 0.2989 * img_tensor[:, 0:1] + 0.5870 * img_tensor[:, 1:2] + 0.1140 * img_tensor[:, 2:3]
    kernel = torch.tensor([[0, 1, 0], 
                           [1, -4, 1], 
                           [0, 1, 0]], dtype=img_tensor.dtype, device=img_tensor.device)
    kernel = kernel.view(1, 1, 3, 3)
    laplacian = torch.nn.functional.conv2d(gray, kernel, padding=1)
    return torch.var(laplacian).item()

def run_quality_eval(target_dir: str, use_gpu: bool, queue):
    class QueueWriter:
        def write(self, msg):
            if msg.strip():
                queue.put(msg.strip())
        def flush(self):
            pass
    sys.stdout = QueueWriter()
    sys.stderr = QueueWriter()

    try:
        import piq
    except ImportError:
        print("Error: 'piq' (PyTorch Image Quality) package is not installed.")
        return

    try:
        device = torch.device("cuda" if use_gpu and torch.cuda.is_available() else "cpu")
        print(f"Initializing Quality Evaluation on device: {device}...")
        
        valid_extensions = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
        image_files = sorted([f for f in os.listdir(target_dir) if f.lower().endswith(valid_extensions)])
        
        if not image_files:
            print(f"No valid images found in directory '{target_dir}'.")
            return
            
        print(f"Found {len(image_files)} images in '{target_dir}'. Starting evaluation...")
        
        results = []
        brisque_scores = []
        sharpness_scores = []
        
        for idx, filename in enumerate(image_files, 1):
            img_path = os.path.join(target_dir, filename)
            try:
                img_tensor = load_image_tensor(img_path, device)
                with torch.no_grad():
                    brisque_val = piq.brisque(img_tensor, data_range=1.0).item()
                sharpness_val = compute_laplacian_variance(img_tensor)
                sharpness_val_scaled = sharpness_val * 1000
                
                brisque_scores.append(brisque_val)
                sharpness_scores.append(sharpness_val_scaled)
                results.append({
                    "Filename": filename,
                    "BRISQUE": round(brisque_val, 4),
                    "Sharpness": round(sharpness_val_scaled, 4)
                })
                
                print(f"[{idx}/{len(image_files)}] {filename} | BRISQUE: {brisque_val:.2f} | Sharpness: {sharpness_val_scaled:.2f}")
                
            except Exception as e:
                print(f"Error evaluating {filename}: {e}")
                
        if not results:
            print("No images were successfully evaluated.")
            return
            
        avg_brisque = np.mean(brisque_scores)
        avg_sharpness = np.mean(sharpness_scores)
        
        print("\n" + "="*60)
        print(" Quality Evaluation Summary")
        print("="*60)
        print(f"Total Evaluated Images: {len(results)}")
        print(f"Average BRISQUE Score : {avg_brisque:.4f}")
        print(f"Average Sharpness Score: {avg_sharpness:.4f}")
        print("="*60)

        metrics = {
            "avg_brisque": float(avg_brisque),
            "avg_sharpness": float(avg_sharpness),
            "total_images": len(results),
            "details": results
        }
        queue.put({"__METRICS__": metrics})
    except Exception as e:
        print(f"Error in Quality Eval: {e}")
