import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageStat

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

for old_file in images_dir.glob("*"):
    if old_file.is_file():
        old_file.unlink(missing_ok=True)


def choose_image_format(image) -> tuple[str, str]:
    if image.mode in {"RGBA", "LA", "P"}:
        return "PNG", "png"

    if getattr(image, "format", None) == "SVG":
        return "SVG", "svg"

    if image.mode == "RGB":
        return "JPEG", "jpg"

    return "PNG", "png"


def should_upscale(image) -> bool:
    width, height = image.size
    if width < 800 or height < 600:
        return True

    sample = image.convert("L").resize((200, 200))
    stat = ImageStat.Stat(sample)
    variance = stat.var[0] if stat.var else 0
    return variance > 2500


def prepare_image(image) -> Image.Image:
    if not should_upscale(image):
        return image

    scale = 2
    return image.resize(
        (image.width * scale, image.height * scale),
        resample=Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS,
    )


def save_image(image, target_path: Path) -> tuple[Path, str, int, int, bool]:
    output_image = prepare_image(image)
    image_format, extension = choose_image_format(output_image)
    target_path = target_path.with_suffix(f".{extension}")
    target_path.parent.mkdir(parents=True, exist_ok=True)

    for sibling in target_path.parent.glob(f"{target_path.stem}.*"):
        if sibling != target_path:
            sibling.unlink(missing_ok=True)

    if image_format == "SVG":
        svg_content = output_image.tobytes().decode("utf-8", errors="ignore")
        target_path.write_text(svg_content, encoding="utf-8")
        return target_path, extension, output_image.width, output_image.height, True

    if image_format == "JPEG":
        output_image.save(target_path, format="JPEG")
        return target_path, extension, output_image.width, output_image.height, True

    output_image.save(target_path, format="PNG")
    return target_path, extension, output_image.width, output_image.height, True


picture_items = [item for item, _ in doc.iterate_items() if isinstance(item, PictureItem)]
image_manifest = []
for index, picture in enumerate(picture_items, start=1):
    try:
        image = picture.get_image(doc)
    except Exception as exc:
        print(f"Skipping picture {index}: {exc}")
        continue

    image_path = images_dir / f"picture_{index}"
    saved_path, extension, width, height, upscaled = save_image(image, image_path)
    provenance = getattr(picture, "prov", None)
    page_no = None
    if provenance:
        first_item = provenance[0] if isinstance(provenance, list) else provenance
        page_no = getattr(first_item, "page_no", None)

    image_manifest.append(
        {
            "index": index,
            "filename": saved_path.name,
            "path": saved_path.relative_to(out_dir).as_posix(),
            "format": extension,
            "width": width,
            "height": height,
            "upscaled": upscaled,
            "page": page_no,
        }
    )

markdown = doc.export_to_markdown(
    image_mode=ImageRefMode.PLACEHOLDER,
    traverse_pictures=True,
)

for index, _picture in enumerate(picture_items, start=1):
    image_path = images_dir / f"picture_{index}."  # placeholder for extension resolution

    matched_files = sorted(images_dir.glob(f"picture_{index}.*"))
    if matched_files:
        image_path = matched_files[0]
        rel_image_path = image_path.relative_to(out_dir).as_posix()
        markdown = markdown.replace(
            "<!-- image -->",
            f"![Figure {index}]({rel_image_path})",
            1,
        )

manifest_path = out_dir / "images_manifest.json"
manifest_path.write_text(json.dumps(image_manifest, indent=2, ensure_ascii=False), encoding="utf-8")
out_path.write_text(markdown, encoding="utf-8")

print(f"Using cache directory: {CACHE_ROOT}")
print(f"Extracted {len(picture_items)} picture(s) to {images_dir}")
print(f"Saved markdown to {out_path}")
print(f"Saved image manifest to {manifest_path}")
