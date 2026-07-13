import os
from pathlib import Path
from urllib.parse import urlparse

CACHE_ROOT = Path(__file__).resolve().parent / ".cache"
HF_CACHE_DIR = CACHE_ROOT / "huggingface"
TORCH_CACHE_DIR = CACHE_ROOT / "torch"
for cache_dir in (CACHE_ROOT, HF_CACHE_DIR, TORCH_CACHE_DIR):
    cache_dir.mkdir(parents=True, exist_ok=True)

os.environ.setdefault("HF_HOME", str(HF_CACHE_DIR))
os.environ.setdefault("HF_HUB_CACHE", str(HF_CACHE_DIR / "hub"))
os.environ.setdefault("TORCH_HOME", str(TORCH_CACHE_DIR))
os.environ.setdefault("TRANSFORMERS_CACHE", str(HF_CACHE_DIR / "transformers"))
os.environ.setdefault("XDG_CACHE_HOME", str(CACHE_ROOT))

from docling.document_converter import DocumentConverter

source = "https://arxiv.org/pdf/2503.22238v1"
converter = DocumentConverter()
doc = converter.convert(source).document
markdown = doc.export_to_markdown()

parsed_source = urlparse(source)
out_name = f"{Path(parsed_source.path).stem}.md"
out_path = Path("output") / out_name
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(markdown, encoding="utf-8")

print(f"Using cache directory: {CACHE_ROOT}")
print(f"Saved markdown to {out_path}")
