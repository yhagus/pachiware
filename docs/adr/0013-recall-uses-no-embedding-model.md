# Recall uses no embedding model

Finding Kept material that says the same thing in other words ("normalisasi audio" against "audio normalization") is done with the tenant's own chat model and plain text, not with an embedding model or a vector index. When something is kept, the model writes topics and keywords in Indonesian and English at the top of the file; when someone asks, the model turns the question into several variants, the Workspace files are scored by how many of the words they hold, and the model picks the best of the top matches. Tenants bring one chat model (often one with no embedding API, such as DeepSeek), and every Database engine must work the same way.

## Considered options

- **An embedding model, local or through an API, with sqlite-vec, pgvector or MongoDB vector search.** Rejected: a second model to run or pay for, vectors to recompute whenever it changes, and a MongoDB Community setup that needs an extra process.
- **Each Database engine's full-text index.** Rejected for now: Kept material lives in Workspace files (ADR 0003), so the index would be a second copy to keep in step, while a channel's files stay few enough to score in code.
