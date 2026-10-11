# Image input across OpenAI, Anthropic, and compatible proxies

Research for issue #17 (map #16), feeding the grilling ticket #27 "Profile input capabilities and image handling".
Sources were read on 2026-10-11. Each claim cites the page or file it came from.

## Question

How do OpenAI Chat Completions, the Anthropic Messages API, and OpenAI-compatible proxies accept image input? What content-part shape do they use, do they take URLs or base64, and what size, count, and format limits apply? How is a mixed text+image message ordered? Can you reliably learn whether a model accepts images? How do tool-calling messages coexist with image parts?

## Where pachiware stands today

- `ChatMessage.content` is `string | null` (`apps/agent/src/llm/types.ts`). Nothing in the type can carry an image part yet.
- `apps/agent/src/llm/router.ts` has three raw-`fetch` adapters. `callOpenAI` posts to `{base}/chat/completions`. `callAnthropic` posts to `{base}/messages`, folds `system` messages into the top-level `system` field, and builds assistant `text`/`tool_use` blocks. `callCustomOpenAI` posts to `{customBaseUrl}/chat/completions` and defaults the base to `https://api.9router.com/v1`. Each adapter maps `content` straight through as a string.
- `testOpenAI` and `testCustom` call `GET {base}/models` but only count the models.

## OpenAI Chat Completions

**Part shape.** A user message's `content` can be an array of parts. An image part is `{ "type": "image_url", "image_url": { "url": "...", "detail": "auto" | "low" | "high" | "original" } }`. `url` is "Either a URL of the image or the base64 encoded image data", meaning a `data:image/png;base64,...` data URL. [Chat API reference](https://developers.openai.com/api/reference/resources/chat)

**Inputs accepted.** A fully qualified URL, a base64 data URL, or a Files API file ID. Omitting `detail` gives `auto`. [Images and vision guide](https://developers.openai.com/api/docs/guides/images-vision)

**Formats.** PNG, JPEG, WEBP, and non-animated GIF. [Images and vision guide](https://developers.openai.com/api/docs/guides/images-vision)

**Limits.** "Up to 512 MB total payload per request" and "Up to 1,500 images per request". An image may use up to 30,000 patches after resizing, and "Images that exceed the 30,000-patch limit after processing are rejected, not automatically resized to meet it." The guide gives no separate per-image byte limit. [Images and vision guide](https://developers.openai.com/api/docs/guides/images-vision)

**Cost.** Patch-based models cost `ceil(w/32) × ceil(h/32)` patches times a per-model multiplier (1.2 for gpt-5.5, gpt-5.4, gpt-5.2, gpt-6-astra). Tile-based models (gpt-4o, gpt-4.1, gpt-5.1) charge base tokens plus per-tile tokens, and `low` costs the base only. What `detail` does differs by model family. [Images and vision guide](https://developers.openai.com/api/docs/guides/images-vision)

**Ordering.** Parts are processed in array order. The guide gives no recommended order. [Images and vision guide](https://developers.openai.com/api/docs/guides/images-vision)

**Which roles may carry images.** Only `user`. The reference says tool messages take "only type `text`", system messages take "only type `text`", and assistant messages take "one or more of type `text`, or exactly one of type `refusal`". [Chat API reference](https://developers.openai.com/api/reference/resources/chat)

**Tool calling plus images.** A `tool` message cannot return an image. To show the model an image a tool produced, add a separate `user` message with an `image_url` part after the `tool` messages. (This is inferred from the role restriction above. OpenAI does not document it as a pattern.)

**Detecting capability.**
- `GET /v1/models` returns only `id`, `created`, `object`, `owned_by`, and `shutdown_date`, with no modality field. [Models list reference](https://developers.openai.com/api/reference/resources/models/methods/list)
- Per-model doc pages list modalities, for example gpt-4.1-mini shows "Input modalities: text, image". That is documentation for humans, not an API. [gpt-4.1-mini model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- In practice you find out on use: a non-vision model returns HTTP 400 "Invalid content type. image_url is only supported by certain models." This appears only in community reports, not in an official error catalog. [OpenAI community thread](https://community.openai.com/t/image-url-is-only-supported-by-certain-models/966851)

## Anthropic Messages API

**Block shape.** `{ "type": "image", "source": { ... } }`, where `source` takes one of three forms:
- `{ "type": "base64", "media_type": "image/jpeg", "data": "<base64>" }` (plain base64, no `data:` prefix, with `media_type` separate)
- `{ "type": "url", "url": "https://..." }`
- `{ "type": "file", "file_id": "..." }` (Files API)

On Amazon Bedrock and Google Cloud, only base64 works. [Vision guide](https://platform.claude.com/docs/en/build-with-claude/vision)

**Formats.** `image/jpeg`, `image/png`, `image/gif`, `image/webp`. For animations, only the first frame is used. [Vision guide](https://platform.claude.com/docs/en/build-with-claude/vision)

**Limits.** [Vision guide](https://platform.claude.com/docs/en/build-with-claude/vision)
- Per image: 10 MB base64-encoded on the direct API, 5 MB on Bedrock/Vertex. Maximum 8000×8000 px.
- Per request: 100 images for models with a 200k context window, 600 for all others. The 32 MB request-size limit is often hit first.
- If a request holds more than 20 images, a stricter per-image dimension limit applies, and images over it are rejected with `invalid_request_error`. That count includes resent history and images inside `tool_result`. Keeping each side at 2000 px or less avoids it.
- Oversized images are downscaled: on Claude 4.7+ the long edge to 2576 px and 4784 visual tokens, on other models to 1568 px and 1568 tokens. Cost is `ceil(w/28) × ceil(h/28)` visual tokens.

**Ordering.** "Claude works best when images come before text." Interleaving still works. For several images, label each one (`Image 1:` and so on). [Vision guide](https://platform.claude.com/docs/en/build-with-claude/vision)

**History.** Each request resends every earlier image. With base64 the bytes go out again on every turn, so the guide recommends the Files API for long conversations. [Vision guide](https://platform.claude.com/docs/en/build-with-claude/vision)

**Tool calling plus images.** A `tool_result` block's `content` may contain `text`, `image`, `document`, or `search_result` blocks, so images can come back inside tool results. In the user message carrying results, "the tool_result blocks must come FIRST in the content array. Any text must come AFTER all tool results", and violating that returns a 400. A user turn that answers a tool call can therefore hold `[tool_result..., image, text]`, never an image or text first. [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)

**Detecting capability.** `GET /v1/models` returns `capabilities.image_input.supported` (and `pdf_input`) per model, documented as "Whether the model accepts image content blocks." This is a first-party, machine-readable signal. [List Models reference](https://platform.claude.com/docs/en/api/models/list)

## OpenAI-compatible proxies

- OpenAI-compatible proxies (LiteLLM, OpenRouter) use `image_url`. Capability flags, if any, are proxy-specific (`supports_vision` in LiteLLM model_info, for example). There is no shared standard. [LiteLLM vision docs](https://docs.litellm.ai/docs/completion/vision)

## Discord attachments: URL vs base64

- Attachment CDN URLs are signed with `ex` (expiry), `is` (issued), and `hm` (signature) query parameters and have "a preset expiry time", whose length is not documented. Discord refreshes URLs that appear in its own clients. Re-fetching the message returns a fresh URL. [Discord reference: signed attachment CDN URLs](https://docs.discord.com/developers/reference#signed-attachment-cdn-urls)
- The attachment object gives `content_type`, `size` (bytes), `width`, `height`, `url`, and `proxy_url`, so type, size, and dimension checks can run before any download. [Discord attachment object](https://docs.discord.com/developers/resources/message#attachment-object)
- For pachiware, this means:
  - Passing the Discord URL straight to a provider works only while the signature is valid. Chat history replayed later, such as on a thread resume, will hold expired URLs, and the provider fetch will fail.
  - The Discord CDN is a public host, so OpenAI and Anthropic can fetch it while the URL is fresh.
  - Downloading the attachment and sending base64 is the portable choice. It is the only form Bedrock and Vertex accept, and it removes dependence on expiry. The cost is request size, because history replays resend the bytes. Anthropic's Files API (`file_id`) avoids that but only works on Anthropic.
  - Base64 needs a per-provider encoding: OpenAI and OpenAI-compatible endpoints take a `data:<mime>;base64,` URL, while Anthropic takes a bare base64 string with a separate `media_type`.

## Comparison

| | OpenAI Chat Completions | Anthropic Messages | OpenAI-compatible proxy |
|---|---|---|---|
| Part shape | `image_url` `{url, detail}` | `image` `{source}` | `image_url` (OpenAI shape) |
| URL | yes | yes (`source.type:"url"`) | usually; depends on the proxy and upstream |
| Base64 | `data:` URL in `url` | `source.type:"base64"` + `media_type` | `data:` URL |
| File reference | Files API ID | Files API `file_id` | n/a |
| Formats | png, jpeg, webp, static gif | jpeg, png, gif, webp | depends on upstream |
| Per-image size | not stated; 30k-patch cap | 10 MB b64 (5 MB Bedrock/Vertex), 8000 px | depends on upstream |
| Per-request | 512 MB, 1,500 images | 32 MB; 100 or 600 images; >20 images tightens dims | depends on upstream |
| Image inside tool result | no (tool content is text-only) | yes (`tool_result.content` may hold `image`) | as translated |
| Capability signal | none in API; doc pages only; 400 on use | `capabilities.image_input.supported` | proxy-specific, if any |

## Open points (not answered by primary sources)

- Discord's CDN URL lifetime is undocumented.
- OpenAI's exact error text for images sent to non-vision models is not in an official error catalog.
