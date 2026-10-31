# LLM Internal Knowledge Attribution — PoC

This small research PoC demonstrates two separate capabilities:

1. Build a Circuit Tracer attribution graph for a next-token prediction.
2. Capture a selected layer activation and next-token logits with NNsight.

These are research scripts, not a production service. They do not claim that a feature is the unique storage location of a fact.

## 1. Circuit Tracer

The example follows the public Circuit Tracer API and official Gemma 2 2B tutorial.

### Prerequisites

- Python 3.10 or newer.
- A CUDA GPU and sufficient GPU/host memory for the selected model and feature budget.
- Hugging Face access to the Gemma 2 2B weights, subject to the model's access and licence terms.
- A matching Circuit Tracer transcoder set.

Use an isolated environment:

~~~bash
git clone https://github.com/decoderesearch/circuit-tracer.git
cd circuit-tracer
python -m venv .venv
source .venv/bin/activate
pip install -e .
~~~

Copy `trace_gemma.py` from this directory into the environment, or run it by adding this directory to `PYTHONPATH`.

### Run

~~~bash
python trace_gemma.py \
  --prompt "The capital of state containing Dallas is" \
  --output ./artifacts/dallas-austin \
  --serve
~~~

Open `http://localhost:8046/index.html`.

Start small. If the process runs out of memory, reduce `--max-feature-nodes` and `--batch-size`, or use an offload strategy supported by the current Circuit Tracer release.

The default `transformerlens` backend is preferred when the model is supported. The project's `nnsight` backend is experimental and may be slower or less memory efficient.

## 2. NNsight activation capture

The second script uses GPT-2 as a minimal example:

~~~bash
pip install nnsight torch
python capture_with_nnsight.py
~~~

It captures the final-position hidden state from a selected GPT-2 block and the next-token logits. Other model families need model-specific module paths and output handling. Inspect the model tree before changing the path.

## 3. Evidence discipline

For every experiment, record:

- immutable model and tokenizer revisions;
- model chat template and exact input token IDs;
- the exact prefix used to predict the target token;
- transcoder / SAE checkpoint revision;
- library versions and runtime backend;
- target logits and graph artifact;
- interventions, controls, and replications.

An attribution graph is an approximate computational explanation. Feature labels are hypotheses. Validate important interpretations with counterexamples and controlled interventions. Do not treat this PoC as a general training-data provenance tool or a factuality detector.
