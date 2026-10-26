# TV game recognition research prototype

This folder accompanies the analysis of why a smart-TV application might use an AlexNet-like TensorFlow Lite/LiteRT model instead of running PyTorch directly. It includes an analysis report and an offline PyTorch baseline for visual feature extraction and nearest-neighbour retrieval.

## Files

- `analysis_report.md`: feasibility analysis, architecture, dataset strategy, validation plan, quantization considerations, and evidence boundaries.
- `alexnet_game_embedding.py`: generic ImageNet-pretrained AlexNet embedding baseline; builds a feature gallery, matches explicitly supplied offline images, and optionally attempts float LiteRT export.
- `requirements.txt`: Python dependencies.

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create a gallery from images you are authorized to use, with one directory per game:

```text
gallery/
  game_a/frame_001.jpg
  game_a/frame_002.jpg
  game_b/frame_001.jpg
```

Build the gallery and search with an offline query image:

```bash
python alexnet_game_embedding.py build-gallery ./gallery ./gallery.npz
python alexnet_game_embedding.py match ./query.jpg ./gallery.npz --top-k 5
```

The optional `export-litert` command attempts to export a floating-point `.tflite` model:

```bash
python alexnet_game_embedding.py export-litert ./alexnet_game_embedding.tflite
```

## Important limitations

The baseline uses generic ImageNet features; it is **not trained or validated as a game recognizer**. Similarity scores are not probabilities. Calibrate any acceptance thresholds on a separate validation set, including unknown games. The LiteRT export path and its operators must be tested against the specific target runtime; this project does not include a verified INT8 conversion or TV-device benchmark.

The prototype processes only image files explicitly provided by the researcher. It does not capture TV screens, poll devices, track users, persist viewing history, or upload images/results.
