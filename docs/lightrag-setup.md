# LightRAG Knowledge Base — Setup

Actovia's knowledge base is **optional** and powered by a **self-hosted
[LightRAG](https://github.com/HKUDS/LightRAG) server that you run**. Actovia is a
client only: it pushes your documents into LightRAG and asks it for relevant
context at query time. It never runs, upgrades, or manages LightRAG, and never
creates its storage or schema.

When no server URL is configured, the knowledge base is completely inert — no
tool, no behavior change.

## 1. Run the LightRAG server

Minimal `docker-compose.yml`:

```yaml
services:
  lightrag:
    image: ghcr.io/HKUDS/LightRAG:latest # pin a specific tag in production
    ports: ['9621:9621']
    volumes:
      - ./data/rag_storage:/app/data/rag_storage # graph + vectors + KV store
      - ./data/inputs:/app/data/inputs # uploaded source files
    env_file: .env
```

Create `.env` next to it:

```bash
PORT=9621
LIGHTRAG_API_KEY=change-me-to-a-long-secret   # Actovia sends this as X-API-Key
SUMMARY_LANGUAGE=English                        # language for entity summaries

# LLM used for entity/relationship extraction during ingestion
LLM_BINDING=openai                             # openai | ollama | azure | lollms
LLM_MODEL=gpt-4o-mini
LLM_BINDING_HOST=https://api.openai.com/v1
LLM_BINDING_API_KEY=sk-...

# Embedding model
EMBEDDING_BINDING=openai                        # openai | ollama | lollms
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIM=3072
```

Then:

```bash
docker compose up -d
curl -H "X-API-Key: $LIGHTRAG_API_KEY" http://localhost:9621/health
```

> **⚠️ The embedding model and `EMBEDDING_DIM` are locked once you ingest the
> first document.** Changing either later requires wiping `./data/rag_storage`
> and re-adding every document. Pick a model you'll keep.

Ingestion costs LLM tokens on your `LLM_BINDING_API_KEY` (LightRAG runs entity
extraction over each document), and runs in the background — expect seconds to
minutes per document.

## 2. Point Actovia at it

In Actovia open **Settings → Knowledge Base**:

1. **Server URL** — `http://localhost:9621`
2. **API Key** — the `LIGHTRAG_API_KEY` from your `.env`
3. Click **Test Connection** — it reports the LLM model, embedding model, and
   current document count.
4. **Query mode** — leave on `mix` (graph + vector, best quality) unless you
   have a reason to change it.

## 3. Add documents

Under **Documents**, use **Add document** (title + text). Each document shows an
index-status badge:

| Badge         | Meaning                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------- |
| Pending       | Queued for sync to LightRAG                                                              |
| Indexing…     | LightRAG is processing it                                                                |
| Indexed       | Ready — retrieval will use it                                                            |
| Failed        | Sync or processing failed; hover for the error, then edit/re-save or use **Reindex all** |
| Needs reindex | Content changed but the sync stalled; use **Reindex all**                                |

Editing a document re-indexes it (LightRAG documents are immutable, so Actovia
deletes and re-inserts). Deleting removes it from LightRAG too.

**Reindex all** re-pushes every document — use it after first configuring the
server, or after wiping `rag_storage`.

## 4. How the AI uses it

Retrieval is a tool the model calls when a question looks like the knowledge
base might cover it (`searchKnowledgeBase`, toggleable under Settings → Built-in
Tools). LightRAG returns the retrieved context; **Actovia's own chat model
writes the answer.** It's available in both the main chat and Philharmonic
Groups. If LightRAG is unreachable, the tool reports that and the conversation
continues normally.
