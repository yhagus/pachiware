// Providers report prompt-cache hits under different names; 0 means "none reported".
export function cachedTokensOf(usage: any): number {
  if (!usage) return 0;
  const n = usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens ?? usage.cached_tokens ?? 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
