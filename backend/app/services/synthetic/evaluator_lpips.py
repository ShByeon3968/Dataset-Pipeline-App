import os
import torch
import torchvision.transforms as transforms
from PIL import Image
import numpy as np
import sys

def load_image(path):
    img = Image.open(path).convert('RGB')
    transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize((0.5, 0.5, 0.5), (0.5, 0.5, 0.5))
    ])
    return transform(img).unsqueeze(0)

def run_lpips_eval(input_dir: str, output_dir: str, net: str, use_gpu: bool, queue):
    class QueueWriter:
        def write(self, msg):
            if msg.strip():
                queue.put(msg.strip())
        def flush(self):
            pass
    sys.stdout = QueueWriter()
    sys.stderr = QueueWriter()

    try:
        import lpips
    except ImportError:
        print("Error: 'lpips' package is not installed.")
        return

    try:
        device = torch.device("cuda" if use_gpu and torch.cuda.is_available() else "cpu")
        print(f"Initializing LPIPS model with net='{net}' on device: {device}...")
        loss_fn = lpips.LPIPS(net=net).to(device)
        
        valid_extensions = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
        image_files = sorted([f for f in os.listdir(input_dir) if f.lower().endswith(valid_extensions)])
        
        print(f"Found {len(image_files)} potential images in '{input_dir}' directory.")
        
        scores = []
        for filename in image_files:
            orig_path = os.path.join(input_dir, filename)
            gen_filename = f"syn_{filename}"
            gen_path = os.path.join(output_dir, gen_filename)
            
            if not os.path.exists(gen_path):
                if os.path.exists(os.path.join(output_dir, filename)):
                    gen_path = os.path.join(output_dir, filename)
                else:
                    continue
                    
            try:
                im_orig = load_image(orig_path).to(device)
                im_gen = load_image(gen_path).to(device)
                
                if im_orig.shape != im_gen.shape:
                    h, w = im_orig.shape[2], im_orig.shape[3]
                    im_gen = torch.nn.functional.interpolate(im_gen, size=(h, w), mode='bilinear', align_corners=False)
                
                with torch.no_grad():
                    dist = loss_fn(im_orig, im_gen).item()
                    
                scores.append(dist)
                print(f"Image: {filename} | LPIPS Score: {dist:.4f}")
                
            except Exception as e:
                print(f"Error evaluating pair for {filename}: {e}")
                
        if not scores:
            print("No matching generated images found in the output directory to evaluate.")
            return
            
        avg_score = np.mean(scores)
        std_score = np.std(scores)
        
        print("\n" + "="*50)
        print(" LPIPS Evaluation Results")
        print("="*50)
        print(f"Total Evaluated Pairs: {len(scores)}")
        print(f"Average LPIPS Distance: {avg_score:.4f}")
        print(f"Standard Deviation: {std_score:.4f}")
        print("="*50)
    except Exception as e:
        print(f"Error in LPIPS Eval: {e}")
