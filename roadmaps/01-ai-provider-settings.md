# AI Provider Settings Roadmap

## Outcome

Let a user choose and configure an AI provider for GenOffice without exposing
credentials to renderer code or breaking the shared agent workflow. The supported
choices should be:

| Provider | Authentication | Status |
| --- | --- | --- |
| Genspark | Existing device login | Retain |
| OpenAI API | User-owned API key | Add as a supported setting |
| ChatGPT sign-in | OpenAI-provisioned OAuth identity | Approval-gated; not model authorization |
| Claude API | User-owned Anthropic API key | Add as a supported setting |
| OpenRouter | User-owned API key | Add as a first-class setting |

**Do not implement Claude.ai / Claude subscription OAuth.** Anthropic says that
third-party products must use an API key or a supported cloud provider and may
not offer Claude.ai login or route subscription credentials on a user's behalf.
See [Anthropic's authentication and credential policy](https://code.claude.com/docs/en/legal-and-compliance).

“OpenAI ChatGPT” has two distinct meanings in the product:

- **OpenAI API** is a model provider configured with a user-owned API key.
- **ChatGPT OAuth** (“Sign in with ChatGPT”) is an optional account-identity
  connection, subject to OpenAI making that integration available to GenOffice.

A ChatGPT subscription is not an API credential. OpenAI API requests use bearer
API keys; see the [OpenAI authentication reference](https://developers.openai.com/api/reference/overview#authentication).

## Current implementation

The shared provider layer is already a good base:

- [`packages/ai-provider/src/types.ts`](../packages/ai-provider/src/types.ts)
  defines provider IDs, per-provider configuration, and `AiSettings`.
- [`packages/ai-provider/src/providers.ts`](../packages/ai-provider/src/providers.ts)
  registers Genspark, Anthropic, Gemini, DeepSeek, OpenAI, and a generic
  OpenAI-compatible provider.
- [`packages/ai-provider/src/stream.ts`](../packages/ai-provider/src/stream.ts)
  preserves the agent's streaming and tool-call behavior through Anthropic,
  Gemini, and OpenAI-compatible protocols.
- [`packages/ai-provider/src/chat.ts`](../packages/ai-provider/src/chat.ts)
  supplies the corresponding one-shot chat route.
- [`apps/docs/src/main/docs-main.ts`](../apps/docs/src/main/docs-main.ts)
  owns the shared `ai:*` Electron IPC handlers used by the shell and editors.

There are two deliberate gaps to resolve:

1. `ai:get-settings` normalizes the selected provider back to `genspark`, so
   the existing direct-provider adapters are currently unreachable in normal
   use.
2. `ai-settings.json` currently stores the full configuration as JSON. That is
   not an acceptable store for API keys or OAuth refresh tokens.

The renderer currently receives `AiSettings` and sends it back in every stream
request. The final design must remove secrets from that renderer-visible shape.

## Design decisions

### Provider model

Keep provider selection global to the GenOffice suite for the first release.
All editors use the same agent transport and should therefore see the same
provider, model, and account state.

Use fixed provider IDs:

```ts
type SupportedProviderId = 'genspark' | 'openai' | 'anthropic' | 'openrouter'
```

Keep the current `custom` provider as an advanced, unsupported compatibility
option only if maintaining it is desired. It must not be the primary OpenRouter
experience.

### Credential boundary

The Electron main process owns all provider credentials. The renderer receives
only non-secret data:

```ts
interface ProviderSummary {
  id: SupportedProviderId
  configured: boolean
  model: string
  supportedModels: readonly string[]
}

interface AiSettingsView {
  selectedProvider: SupportedProviderId
  providers: ProviderSummary[]
}
```

New IPC commands should separate commands from data:

- `ai:get-settings` returns `AiSettingsView`, never keys.
- `ai:save-provider` accepts a provider ID, selected model, and a new key only
  when the user explicitly submits it.
- `ai:clear-provider-credential` removes one credential.
- `ai:stream` accepts the provider ID and request content, then resolves the
  credential and model in main-process code.

Store keys with Electron `safeStorage` or an OS keychain-backed implementation.
Store only an encrypted reference or encrypted blob in `userData`; never log
the key, request headers, raw settings object, or an error containing a key.
OpenAI's guidance is to keep API keys out of client-side apps, so GenOffice must
never ship a shared application key. A user-supplied BYOK key is still sensitive
local data and needs this protection.

### ChatGPT OAuth / “Sign in with ChatGPT”

Add this as a **separate optional account connection**, not as a provider
credential. OpenAI describes “Sign in with ChatGPT” as an identity integration:
it can share basic profile information with a supported external app, but it does
not independently grant access to ChatGPT conversations, memory, files, tokens,
billing, or other account data. As of this roadmap, OpenAI's public guidance says
the capability is rolling out first to OpenAI Academy and Codex Sites; GenOffice
must obtain eligibility and integration details from OpenAI before implementation.

Source: [OpenAI Help — Sign in with ChatGPT](https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt).

The product requirements are:

- Label the control **“Sign in with ChatGPT (optional)”** and keep it separate
  from **“Configure OpenAI API”**.
- Never label the connection “Use my ChatGPT subscription” and never send its
  OAuth access token to the OpenAI model API.
- Do not make model availability, quota, billing, or provider selection depend on
  this login. Model calls still require a separately configured supported
  credential, such as the OpenAI API key.
- Hide or disable the feature until GenOffice has an OpenAI-issued client
  registration, permitted redirect URI(s), documented scopes, and production
  approval. The settings view should state that the integration is unavailable
  rather than exposing a non-functional sign-in button.

If OpenAI approves the integration, implement it in the main process using the
authorization-code flow with PKCE:

1. Generate and retain `state`, `nonce` (when required), PKCE verifier, and a
   short expiry in a one-time local authorization transaction.
2. Open the system browser and receive the callback on a fixed registered
   loopback/custom-protocol redirect. Reject mismatched state, expired
   transactions, duplicate callbacks, and unexpected issuers.
3. Exchange the code only in the main process. Store refresh/access tokens, if
   issued, in the secret store—not in renderer state, IPC payloads, logs, or
   `ai-settings.json`.
4. Persist only a minimal identity record such as provider subject, verified
   email, display name, avatar URL, token expiry, and connection state. Encrypt
   or otherwise protect any persistent token material.
5. Offer disconnect, which revokes locally stored credentials immediately and
   calls the provider revocation endpoint if OpenAI's approved integration
   supports one.

Use a dedicated contract such as `ChatgptIdentityConnection`; do not add
ChatGPT OAuth fields to `AiSettings` or reuse the provider API-key path. The
renderer may request `getChatgptIdentityStatus`, `startChatgptSignIn`, and
`disconnectChatgpt`, but must never receive raw OAuth tokens.

### OpenRouter

OpenRouter is compatible with the existing Chat Completions transport:

- Base URL: `https://openrouter.ai/api/v1`
- Authentication: `Authorization: Bearer <API_KEY>`
- Model identifier: an OpenRouter model slug, for example
  `anthropic/claude-sonnet-4.5`

OpenRouter supports streaming and user-defined function tools, but support is
model-specific. The provider UI must show a model as agent-compatible only when
it supports the features GenOffice sends: streaming, images when applicable,
and tool calling. Refer to the [OpenRouter quickstart](https://openrouter.ai/docs/quickstart),
[streaming reference](https://openrouter.ai/docs/api/reference/streaming), and
[tool-calling guide](https://openrouter.ai/docs/guides/features/tool-calling).

Fetch the model catalog in main-process code, cache it with a short TTL, and
fall back to a curated list when offline. Never assume that every OpenRouter
model accepts every parameter in the existing OpenAI-compatible request.

## Delivery plan

### Phase 0: lock the public contract and external eligibility

- Adopt **OpenAI API**, **Claude API**, and **OpenRouter** labels.
- Record Claude OAuth as unsupported in UI copy and support documentation.
- Decide whether `custom` remains available as an advanced setting.
- Define the migration from existing `ai-settings.json` records.
- Keep ChatGPT OAuth separate from the OpenAI API provider. Obtain written
  confirmation that GenOffice can use “Sign in with ChatGPT”, plus client
  registration, redirect URI, scopes, token/revocation behavior, and production
  requirements. If this is unavailable, ship the API-key provider without the
  sign-in control.

Acceptance criteria:

- No feature or settings screen refers to Claude subscription OAuth.
- Existing Genspark sign-in still works without migration friction.

### Phase 1: secure settings service

- Create a main-process provider-settings service shared by all apps.
- Split non-secret metadata from secret credentials.
- Encrypt and persist credentials; add clear/disconnect behavior.
- Replace request-supplied `AiSettings` with a main-process lookup.
- Validate provider ID, model ID, base URL, and key size at the IPC boundary.
- Keep `ChatgptIdentityConnection` in a separate secure auth store. Do not
  conflate it with the OpenAI API connection or provider selection.

Acceptance criteria:

- Searching the renderer bundle and IPC payloads reveals no persisted provider
  key.
- A key can be set, used after restart, replaced, and removed.
- Corrupt or unavailable secure storage produces a recoverable settings error.

### Phase 2: provider adapters and model policy

- Re-enable the existing direct OpenAI and Anthropic routes after secure
  settings are available.
- Add an explicit `openrouter` route using the existing OpenAI-compatible
  streaming parser.
- Attach provider-specific attribution headers only where appropriate.
- Add capability checks before starting an agent run.
- Preserve the existing Genspark routes, credits errors, timeouts, cancellation,
  image input, and tool-call event handling.

Acceptance criteria:

- Each provider can complete a text-only agent turn.
- Each supported model can complete a tool-call turn.
- Unsupported OpenRouter models fail before a request with a localized,
  actionable message.

### Phase 3: settings experience

- Add one suite-level settings surface reachable from the shell.
- Provide provider selection, connect/update key, model picker, validation
  feedback, clear credential, and a connection test.
- Add a distinct **Account connections** section for ChatGPT OAuth only when
  OpenAI has approved the integration. Display the identity and Disconnect
  action there; do not imply that it supplies model access.
- State billing ownership clearly: requests are billed to the user's chosen
  provider account.
- Keep Genspark account status and provider-key status separate.

Acceptance criteria:

- A user can switch providers without restarting an editor.
- No key is displayed after the initial save.
- An unconfigured provider produces a clear setup action rather than a generic
  stream failure.

## Files expected to change

| Area | Likely files |
| --- | --- |
| Provider types and metadata | `packages/ai-provider/src/types.ts`, `providers.ts` |
| Transport and capability checks | `packages/ai-provider/src/stream.ts`, `chat.ts` |
| Secure persistence and IPC | `apps/docs/src/main/docs-main.ts` or a new shared main-process module |
| Preload contracts | `apps/*/src/preload/*`, shared IPC definitions |
| Settings UI | Shell renderer first, then editor integration points |
| Localized copy | Each app's i18n dictionaries |
| Tests | `packages/ai-provider/tests/*` and app IPC/UI tests |

## Test plan

Build on the existing settings migration tests in
[`packages/ai-provider/tests/providers.test.ts`](../packages/ai-provider/tests/providers.test.ts)
and stream tests in
[`packages/ai-provider/tests/stream.test.ts`](../packages/ai-provider/tests/stream.test.ts).

Add tests for:

- migration from the old settings schema without exposing secrets;
- a provider summary that reports configured/unconfigured state only;
- rejection of unknown provider IDs and invalid model/provider pairs;
- OpenRouter SSE text, tool calls, terminal errors, cancellation, and timeouts;
- credentials absent from serialized renderer-facing settings and log output;
- ChatGPT OAuth PKCE, state validation, expired and duplicate callbacks, token
  storage, disconnect, and renderer token non-disclosure when the approved
  integration is enabled;
- a regression proving a ChatGPT OAuth token is never passed to a model-provider
  request;
- switching providers while an editor is open;
- a regression that verifies Genspark remains the default for existing users.

Manual verification:

1. Configure one provider at a time with a disposable API key.
2. Run a text request, an image-capable request where relevant, and an agent
   tool-call request in Docs, Sheets, Slides, and PDF.
3. Restart the app and confirm the connection remains available without showing
   the secret.
4. Disconnect the provider and confirm all requests fail safely.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| API key leaked through IPC, logs, or JSON | Main-process-only credentials, secure storage, redaction tests |
| Model does not support tools or image input | Capability-gated model picker and preflight validation |
| Provider schema diverges from OpenAI-compatible API | Provider-specific adapters only where required; contract tests with recorded SSE fixtures |
| ChatGPT OAuth availability | The public sign-in program may not be available to GenOffice or its final OAuth details may differ | Treat it as an approval-gated integration; retain the API-key flow as the complete model-access path |
| User expectation | “ChatGPT OAuth” can be mistaken for use of a ChatGPT subscription for API calls | Separate account sign-in from provider setup in UI and state the limitation at consent and settings surfaces |
| Users confuse subscriptions with API billing | Explicit product labels and billing copy |
| Claude OAuth policy violation | Do not offer Claude.ai login; use Claude API keys only |

## Definition of done

The feature is complete when users can securely choose Genspark, OpenAI API,
Claude API, or OpenRouter; select a compatible model; run the same shared agent
workflow in every editor; and remove their credential. Claude OAuth must not be
implemented or advertised. If OpenAI makes the approved integration available to
GenOffice, users can additionally connect and disconnect a ChatGPT identity
without exposing OAuth tokens or implying that the connection authorizes model
requests.
