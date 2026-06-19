import os
import torch
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image
import sys

class ImageDirectoryDataset(Dataset):
    def __init__(self, dir_path, transform=None):
        self.dir_path = dir_path
        self.transform = transform
        
        if not os.path.exists(dir_path):
            raise FileNotFoundError(f"Directory not found: {dir_path}")
            
        valid_extensions = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
        self.filenames = sorted([
            f for f in os.listdir(dir_path) 
            if f.lower().endswith(valid_extensions)
        ])
        
    def __len__(self):
        return len(self.filenames)
        
    def __getitem__(self, idx):
        img_path = os.path.join(self.dir_path, self.filenames[idx])
        try:
            img = Image.open(img_path).convert("RGB")
            if self.transform:
                img = self.transform(img)
            return img
        except Exception as e:
            print(f"Warning: {img_path} ({e})")
            return torch.zeros((3, 299, 299))

def run_domain_gap_eval(real_dir: str, syn_dir: str, batch_size: int, use_gpu: bool, queue):
    class QueueWriter:
        def write(self, msg):
            if msg.strip():
                queue.put(msg.strip())
        def flush(self):
            pass
    sys.stdout = QueueWriter()
    sys.stderr = QueueWriter()

    try:
        from piq import FID, KID
    except ImportError:
        print("Error: 'piq' package is not installed.")
        return

    try:
        device = torch.device("cuda" if use_gpu and torch.cuda.is_available() else "cpu")
        print(f"Device: {device}")
        
        transform = transforms.Compose([
            transforms.Resize((299, 299)),
            transforms.ToTensor(),
        ])
        
        print(f"Loading Real Data: {real_dir}")
        real_dataset = ImageDirectoryDataset(real_dir, transform=transform)
        if len(real_dataset) == 0:
            print("No valid images in Real Data directory.")
            return
            
        real_loader = DataLoader(real_dataset, batch_size=batch_size, shuffle=False, num_workers=2)
        
        print(f"Loading Synthetic Data: {syn_dir}")
        syn_dataset = ImageDirectoryDataset(syn_dir, transform=transform)
        if len(syn_dataset) == 0:
            print("No valid images in Synthetic Data directory.")
            return
            
        syn_loader = DataLoader(syn_dataset, batch_size=batch_size, shuffle=False, num_workers=2)
        
        print(f"Real: {len(real_dataset)} images, Synthetic: {len(syn_dataset)} images")
        
        fid_metric = FID().to(device)
        kid_metric = KID().to(device)
        
        print("\n[1/2] Extracting Real features...")
        real_feats = fid_metric.compute_feats(real_loader, device=str(device))
        
        print("[2/2] Extracting Synthetic features...")
        syn_feats = fid_metric.compute_feats(syn_loader, device=str(device))
        
        print("\nComputing Domain Gap...")
        fid_score = fid_metric(real_feats, syn_feats)
        kid_score = kid_metric(real_feats, syn_feats)
        
        print("=" * 65)
        print("                Domain Gap Evaluation Results")
        print("=" * 65)
        print(f"Fréchet Inception Distance (FID): {fid_score.item():.4f}")
        print(f"Kernel Inception Distance (KID):  {kid_score.item():.4f}")
        print("=" * 65)
    except Exception as e:
        print(f"Error in Domain Gap Eval: {e}")
