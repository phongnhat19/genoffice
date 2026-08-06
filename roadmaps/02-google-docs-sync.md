# Google Docs OAuth and Sync Roadmap

## Outcome

Connect GenOffice Docs to a user-selected Google Doc through OAuth, with
explicit pull and push actions, safe conflict handling, and a documented
fidelity boundary. Start with Docs only. Do not imply that Sheets, Slides, or
PDF are included in this feature.

Google Docs OAuth is feasible. Native Google Docs synchronization is the harder
part because GenOffice Docs is a high-fidelity `.docx` editor while Google Docs
uses a separate structured document model.

## Product scope

### First release

- Connect one Google account in the GenOffice shell.
- Choose or paste the link to a Google Doc the user explicitly authorizes.
- Open a Google Doc into GenOffice Docs.
- Show connection state, document title, last synchronized time, and remote
  revision state.
- Offer explicit **Pull updates** and **Push changes** actions.
- Block conflicting pushes and guide the user to compare or reload.
- Support a documented subset: body text, paragraphs, headings, lists, tables,
  links, and basic character/paragraph formatting.

### Explicit non-goals for the first release

- Background polling or automatic overwrite.
- Whole-Drive browsing, indexing, or backup.
- Real-time collaborative editing.
- Pixel-perfect preservation of arbitrary Word OOXML.
- Full parity for comments, tracked changes, complex headers/footers, embedded
  objects, equations, content controls, or advanced page layout.

## Current implementation

GenOffice Docs currently opens, edits, and saves `.docx` files. Its key design
is narrow OOXML patching: untouched blocks retain their original XML and other
archive entries are preserved. See the repository's [architecture overview](../README.md)
and the Docs save workflow in
[`apps/docs/src/renderer/file-actions.ts`](../apps/docs/src/renderer/file-actions.ts).

Relevant integration surfaces:

- [`apps/docs/src/main/docs-main.ts`](../apps/docs/src/main/docs-main.ts)
  already owns privileged file and AI IPC operations.
- [`apps/docs/src/preload/index.ts`](../apps/docs/src/preload/index.ts)
  exposes a narrow renderer bridge.
- [`apps/docs/src/renderer/file-actions.ts`](../apps/docs/src/renderer/file-actions.ts)
  controls open, save, reparse, and dirty-state behavior.
- [`packages/docx-engine`](../packages/docx-engine) is the `.docx` parser and
  OOXML serializer.

There is no existing generic OAuth service, Google API client, Drive metadata
store, Google Docs parser, or Google Docs serializer.

## OAuth design

### Authorization flow

Use OAuth authorization code flow with PKCE:

1. Generate `state`, `code_verifier`, and S256 `code_challenge` in the main
   process.
2. Start a loopback listener on `127.0.0.1` using a random available port.
3. Open the system browser with the Google authorization URL.
4. Validate the returned `state`, exchange the authorization code, and close
   the listener.
5. Store the refresh token in OS-backed secure storage.
6. Refresh short-lived access tokens only in the main process.

Google documents custom URI and loopback redirect options for desktop OAuth;
the random loopback listener is a suitable Electron desktop choice. Use PKCE
and validate `state` for every authorization attempt. See
[Google's desktop OAuth guide](https://developers.google.com/identity/protocols/oauth2/native-app).

### Scope policy

Request the narrowest practical permission:

```text
https://www.googleapis.com/auth/drive.file
```

`drive.file` permits access to files the user opens with or shares with the app,
and it is accepted by the Docs `batchUpdate` endpoint. It avoids broad Drive
read access and the additional verification burden associated with restricted
Drive scopes. See [Google's Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
and [Docs batchUpdate authorization](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate).

Do not request `drive` or `drive.readonly` for the first release. If a future
product needs a full Drive browser or background synchronization, treat the
broader scopes, public OAuth verification, and security review as a separate
product decision.

### Credential storage

Persist only non-secret connection metadata in the app data directory:

```ts
interface GoogleDocLink {
  documentId: string
  displayName: string
  lastSyncedAt?: string
  lastRemoteRevisionId?: string
  localBaselineHash?: string
}
```

Access and refresh tokens remain in secure storage and never enter the renderer
or a document's sidecar file. The user must be able to disconnect Google and
remove all stored token material.

## Synchronization architecture

```text
Google Docs document
        │ documents.get / Drive files.export
        ▼
Google adapter ── normalized document model ── GenOffice Docs editor
        ▲                                      │
        └──── documents.batchUpdate ───────────┘
```

Do not make a native Google Doc a disguised `.docx` file. A Google Workspace
document cannot be downloaded as a normal file; it is exported to a selected
format such as DOCX. Google supports DOCX export, and Drive can import a Word
file into a Google Doc, but an import/update replacement replaces the document
contents. See [Google Docs export formats](https://developers.google.com/workspace/drive/api/guides/ref-export-formats)
and [upload conversion behavior](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

### Recommended implementation path

#### Milestone A: account and import/export

Implement OAuth, document selection, `files.export` to DOCX, and creation of a
new Google Doc from a GenOffice DOCX export. This gives users a useful transfer
workflow while making the conversion boundary visible.

Exported Google Docs content has a 10 MB limit through `files.export`; show a
clear error before opening an oversized export. See the
[Google Drive download and export guide](https://developers.google.com/workspace/drive/api/guides/manage-downloads).

#### Milestone B: explicit supported-subset push

Create a Google Docs adapter that maps the editor's supported subset to Docs
API requests. Build requests in an order that keeps document indices stable,
typically deleting or replacing affected ranges from the end of the document
and then applying formatting.

Use `documents.get` for the remote snapshot and `documents.batchUpdate` for
atomic mutations. The Docs API creates, retrieves, and batch-updates native
documents; see the [Google Docs API overview](https://developers.google.com/workspace/docs/api/how-tos/overview).

#### Milestone C: conflict-safe connected sync

Store the remote `revisionId` obtained with the read. Push with
`requiredRevisionId`, not an unconditional write. If collaborators changed the
file, Google returns a conflict rather than allowing GenOffice to overwrite
their work. Present:

- **Pull remote changes**: replace local content after confirmation.
- **Save a local copy**: preserve local work as a `.docx` file.
- **Compare**: show a best-effort text/block diff before selecting a side.

Google also provides `targetRevisionId`, which can act like another
collaborator, but it lets the server resolve conflicts. Do not use it as the
default until conflict semantics are proven for every supported document
operation. See [Google's write-control documentation](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate).

## Delivery plan

### Phase 0: product and platform setup

- Create a Google Cloud project and desktop OAuth client.
- Configure the consent screen, test users, support email, privacy policy, and
  `drive.file` scope.
- Decide whether document selection starts with pasted Google Doc URLs, a
  minimal in-app list, or a hosted Google Picker flow.
- Define the supported document subset and the exact user-facing fidelity note.

### Phase 1: shared Google connection service

- Add main-process OAuth, token refresh, disconnect, and secure storage.
- Add validated preload and IPC APIs for connection status only.
- Add a suite-level account/settings surface.
- Test cancellation, browser-close, invalid state, expired consent, and token
  refresh errors.

### Phase 2: Docs import/export

- Parse Google Doc URL to a document ID.
- Fetch Drive metadata and validate MIME type and editor capability.
- Export Google Docs to DOCX and reuse the current open pipeline.
- Export the current DOCX as a newly created Google Doc.
- Store the connected-document metadata independently from the local file path.

### Phase 3: connected manual sync

- Introduce a normalized model shared by the Tiptap editor bridge and the
  Google Docs adapter.
- Implement the supported-subset read and write transforms.
- Capture baseline hash and remote revision after every successful pull/push.
- Add `requiredRevisionId` conflict detection, conflict UI, and local-copy
  escape hatch.

### Phase 4: quality and expansion

- Expand formatting support only with round-trip fixtures.
- Measure conversion loss on representative customer documents.
- Evaluate per-document change notifications before considering background
  synchronization.

## Expected file and module boundaries

| New boundary | Responsibility |
| --- | --- |
| `packages/google-workspace` | OAuth-independent Drive/Docs REST client and DTOs |
| `apps/shell/src/main/google-auth.ts` | Desktop OAuth, secure token storage, account lifecycle |
| `apps/docs/src/main/google-docs-ipc.ts` | Validated Docs-only IPC and stream-free network commands |
| `apps/docs/src/renderer/google-sync/*` | Link state, pull/push UX, conflict presentation |
| `apps/docs/src/renderer/google-sync/adapter.ts` | Editor subset to/from Google Docs API model |

Keep network requests and credentials in Electron main-process code. The renderer
must never receive a Google access token or perform direct Google API fetches.

## Test plan

### Unit tests

- Google Doc URL and ID parsing.
- OAuth state and PKCE verifier validation.
- Token storage abstraction, refresh, and disconnect behavior.
- Drive file metadata capability checks.
- DOCX export/import failure paths, including export-size errors.
- Google Docs model conversions for each supported element.
- Batch request ordering and index calculations.
- Revision conflict handling using `requiredRevisionId`.

### Integration tests

Use a dedicated Google test account and isolated documents. Verify:

1. Connect, restart, refresh the token, and disconnect.
2. Pull a simple Google Doc to GenOffice Docs.
3. Push supported edits and inspect the result in Google Docs.
4. Modify the remote document between pull and push; confirm the push is
   blocked and local work can be saved.
5. Open a view-only/shared-drive document and verify UI actions respect Drive
   capabilities.

### Fidelity fixture set

Include plain paragraphs, mixed styles, headings, lists, tables, links, images,
comments, tracked changes, equations, and multi-section headers. The first
release must explicitly mark fixtures outside its supported subset as expected
loss or unsupported behavior.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Collaborative edits overwritten | Revision-gated pushes, explicit pull/push, local-copy escape hatch |
| DOCX and Google Docs formatting differs | Supported subset contract plus fixture-based round-trip tests |
| Broad Drive access alarms users or blocks launch | `drive.file`, user-selected documents, no background scan |
| Refresh token compromise | OS secure storage, main-process-only access, disconnect/remove control |
| API quota or transient errors | Batched writes, retry only idempotent reads, exponential backoff where Google requires it |
| Users expect real-time collaboration | Label the feature as manual connected sync until live collaboration exists |

## Definition of done

The first connected-sync release is done when a user can securely authorize
Google, select one Google Doc, pull it into GenOffice Docs, make edits within
the supported subset, push them only when the remote revision is unchanged, and
recover local work safely when it is not.
