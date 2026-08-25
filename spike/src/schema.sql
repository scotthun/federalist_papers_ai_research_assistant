CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS papers (
  id SERIAL PRIMARY KEY,
  paper_number INT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  authors TEXT[] NOT NULL,
  source_url TEXT NOT NULL,
  full_text TEXT NOT NULL
);

-- Verified live against the Gemini API 2026-08-24: gemini-embedding-001 defaults to 3072 dimensions.
-- No ANN index (HNSW/IVFFlat) needed at this dataset size -- a sequential scan over a few dozen
-- rows is instant; the real Epic 1 schema will revisit this once there are 85 papers' worth of chunks.
CREATE TABLE IF NOT EXISTS chunks (
  id SERIAL PRIMARY KEY,
  paper_id INT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(3072) NOT NULL
);
