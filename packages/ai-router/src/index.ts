/// WebCraft AI router — provider abstraction.
///
/// Phase 0 scaffold: empty. Will expose a single `chat()` API that dispatches
/// to the configured provider:
///   - anthropic   (native SDK, BYO key from OS keychain)
///   - openai      (native SDK, BYO key)
///   - openrouter  (REST, BYO key)
///   - nha         (proxy to nothumanallowed.com for Liara free tier)
///
/// Tools (from @webcraft/ai-tools) are passed through transparently regardless of provider.

export {};
