import os
from pathlib import Path
from urllib.parse import urlparse

from docling.backend.docling_parse_backend import ThreadedDoclingParseDocumentBackend
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, FormatOption
from docling.pipeline.standard_pdf_pipeline import StandardPdfPipeline
from docling_core.types.doc.base import ImageRefMode

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

source = "https://arxiv.org/pdf/2503.22238v1"
pipeline_options = PdfPipelineOptions(generate_picture_images=True, generate_page_images=True)
format_options = {
    InputFormat.PDF: FormatOption(
        pipeline_options=pipeline_options,
        backend=ThreadedDoclingParseDocumentBackend,
        pipeline_cls=StandardPdfPipeline,
    )
}
converter = DocumentConverter(format_options=format_options)
doc = converter.convert(source).document

parsed_source = urlparse(source)
out_name = f"{Path(parsed_source.path).stem}.md"
out_dir = Path("output") / Path(parsed_source.path).stem
out_dir.mkdir(parents=True, exist_ok=True)
out_path = out_dir / out_name

# Export markdown with embedded images, and write each referenced image to disk.
markdown = doc.export_to_markdown(
    image_mode=ImageRefMode.EMBEDDED,
    traverse_pictures=True,
)

# If the embedded export produces base64 data, write the markdown as-is.
# The generated markdown will contain embedded image data when supported.
out_path.write_text(markdown, encoding="utf-8")

print(f"Using cache directory: {CACHE_ROOT}")
print(f"Saved markdown to {out_path}")
