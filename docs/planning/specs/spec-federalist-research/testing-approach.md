# Testing Approach

Testing is a first-class requirement, not an afterthought — retrieval quality matters more than merely demonstrating an LLM can answer questions.

## Coverage required

Unit/integration tests for: document parsing, chunking, duplicate-safe ingestion, vector retrieval, citation validation, RAG answer generation where practical, API endpoints, important UI behavior.

## Retrieval evaluation dataset

A small, hand-built dataset of question → expected paper(s), used to measure whether the right paper appears in the top-K retrieved chunks (feeds CAP-2 and CAP-3's success criteria, and calibrates the confidence thresholds in `decisions.md`). Example shape:

```json
[
  {
    "question": "What does Federalist No. 10 say about factions?",
    "expectedPapers": [10]
  },
  {
    "question": "What arguments are made for a single executive?",
    "expectedPapers": [67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77]
  }
]
```

Build a simple evaluation script that reports whether an expected paper appears in the top-K retrieved chunks. This dataset is also the mechanism for empirically choosing `confidentThreshold`/`clarifyThreshold` (see `decisions.md`, "Confidence tiering") — sweep candidate threshold values against it rather than guessing.
