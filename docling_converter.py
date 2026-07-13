import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from docling.backend.docling_parse_backend import ThreadedDoclingParseDocumentBackend
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, FormatOption
from docling.pipeline.standard_pdf_pipeline import StandardPdfPipeline
from docling_core.types.doc.base import ImageRefMode
from docling_core.types.doc.items.picture.picture import PictureItem

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

DEFAULT_SOURCE = "https://arxiv.org/pdf/2503.22238v1"
source = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE

pipeline_options = PdfPipelineOptions(generate_picture_images=True, generate_page_images=True)
pipeline_options.images_scale = 2.0

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
paper_id = Path(parsed_source.path).stem or Path(parsed_source.path).name
out_dir = Path("output") / paper_id
images_dir = out_dir / "images"
images_dir.mkdir(parents=True, exist_ok=True)
out_path = out_dir / f"{paper_id}.md"

picture_items = [item for item, _ in doc.iterate_items() if isinstance(item, PictureItem)]
for index, picture in enumerate(picture_items, start=1):
    try:
        image = picture.get_image(doc)
    except Exception as exc:
        print(f"Skipping picture {index}: {exc}")
        continue

    image_path = images_dir / f"picture_{index}.png"
    image.save(image_path, format="PNG")

markdown = doc.export_to_markdown(
    image_mode=ImageRefMode.PLACEHOLDER,
    traverse_pictures=True,
)

for index, _picture in enumerate(picture_items, start=1):
    image_path = images_dir / f"picture_{index}.png"
    rel_image_path = image_path.relative_to(out_dir).as_posix()
    markdown = markdown.replace(
        "<!-- image -->",
        f"![Figure {index}]({rel_image_path})",
        1,
    )

out_path.write_text(markdown, encoding="utf-8")

print(f"Using cache directory: {CACHE_ROOT}")
print(f"Extracted {len(picture_items)} picture(s) to {images_dir}")
print(f"Saved markdown to {out_path}")
