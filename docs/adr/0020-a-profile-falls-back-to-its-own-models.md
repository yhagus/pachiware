# A Profile falls back to its own models, not to another Profile

A Profile could name a fallback Profile of the same tenant, which might sit with another provider, key and address; fallbacks chained, up to three Profiles a request. Decided with the user on 2026-10-21: a Profile lists up to three models of its own provider instead, asked in order with the same key and address, and the fallback Profile is gone for now. The same change fixes the address of every provider but BYOK: an OpenAI, Anthropic or DeepSeek Profile no longer takes a base URL, and a server of one's own is a BYOK Profile.

## Consequences

- An outage of the provider, a revoked key or an exhausted balance fails every model of the Profile, so nothing answers in its place. Only the failure of one model, such as a model withdrawn or overloaded, is covered.
- On upgrade, a Profile's link to its fallback Profile is dropped, not turned into fallback models, because the two may differ in key and address. An OpenAI or Anthropic Profile that named another server became a BYOK Profile in the format it spoke there; one that named the provider's own address just lost it.
- One Profile's usage rows can now name several models; the audit row `model_fallback` says which model answered in place of which.
