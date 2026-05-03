# Mosh Architecture

## Purpose

Mosh is a desktop-first decentralized messenger. The initial architecture targets a Tauri v2 desktop application with a React and TypeScript frontend, a Rust native shell, dynamic Moss shared-library integration, and OpenMLS-oriented private messaging.

## System Boundaries

```mermaid
flowchart LR
    User[User]
    UI[React TypeScript UI]
    Protocol[TypeScript Protocol Facade]
    Tauri[Tauri Command Boundary]
    Native[Rust Native Adapters]
    Moss[Moss Shared Library]
    OpenMLS[OpenMLS Engine]
    Keychain[OS Secure Storage]
    Store[Local Metadata Store]
    Trackers[Default/Public Moss Trackers]

    User --> UI
    UI --> Protocol
    Protocol --> Tauri
    Tauri --> Native
    Native --> Moss
    Native --> OpenMLS
    Native --> Keychain
    Protocol --> Store
    Moss --> Trackers
```

## Repository Boundaries

```mermaid
flowchart TB
    MoshRepo[mosh repo]
    Docs[docs]
    Frontend[src]
    TauriSrc[src-tauri]
    Design[../mosh-design read-only]
    MossCore[../moss shared runtime]

    MoshRepo --> Docs
    MoshRepo --> Frontend
    MoshRepo --> TauriSrc
    Frontend -. reads visual direction .-> Design
    TauriSrc -. links dynamic library .-> MossCore
```

Mosh tasks may read `../mosh-design` and `../moss`, but must not modify sibling repositories unless the user explicitly expands scope.

## Private DM Slice

```mermaid
sequenceDiagram
    participant Alice as Alice UI
    participant AliceNative as Alice Tauri/Rust
    participant MossA as Alice Moss Node
    participant Tracker as Public Tracker
    participant MossB as Bob Moss Node
    participant BobNative as Bob Tauri/Rust
    participant Bob as Bob UI

    Alice->>Alice: Create invite URI
    Alice->>AliceNative: Request identity and key package
    AliceNative->>AliceNative: Load secrets from OS keychain
    AliceNative->>MossA: Start Moss with tracker config
    MossA->>Tracker: Announce mesh/session
    Bob->>Bob: Paste invite URI
    Bob->>BobNative: Confirm fingerprint and accept invite
    BobNative->>MossB: Start Moss with tracker config
    MossB->>Tracker: Discover peers
    AliceNative->>AliceNative: Create MLS welcome for Bob
    AliceNative->>MossA: Publish MLS control message
    MossA->>MossB: Deliver over Moss pubsub
    BobNative->>BobNative: Join MLS group
    Bob->>BobNative: Send private message
    BobNative->>BobNative: Encrypt as MLS application message
    BobNative->>MossB: Publish ciphertext
    MossB->>MossA: Deliver ciphertext
    AliceNative->>AliceNative: Decrypt through MLS group state
    AliceNative->>Alice: Emit decrypted UI event
```

## Interface Contracts

```mermaid
classDiagram
    class PrivateDmProtocol {
      +createInvite() InviteUri
      +acceptInvite(invite) FingerprintChallenge
      +confirmFingerprint(challenge) ConversationId
      +sendMessage(conversationId, text) SendResult
    }

    class NativeMessagingGateway {
      +getDiagnostics() DiagnosticsSnapshot
      +createIdentityBundle() IdentityBundle
      +openPrivateSession(invite) NativeSessionResult
      +encryptAndPublish(request) SendResult
    }

    class MossAdapter {
      +start(config) NodeHandle
      +subscribe(channel) Result
      +publish(channel, payload) Result
      +stop(handle) Result
    }

    class MlsAdapter {
      +createKeyPackage() KeyPackage
      +createWelcome(peerPackage) WelcomeMessage
      +protectMessage(groupId, plaintext) Ciphertext
      +unprotectMessage(groupId, ciphertext) Plaintext
    }

    class SecureStorageAdapter {
      +loadSecret(key) SecretBytes
      +saveSecret(key, value) Result
      +deleteSecret(key) Result
    }

    PrivateDmProtocol --> NativeMessagingGateway
    NativeMessagingGateway --> MossAdapter
    NativeMessagingGateway --> MlsAdapter
    NativeMessagingGateway --> SecureStorageAdapter
```

## State Ownership

- Server or network state belongs behind Tauri commands and future query hooks.
- Ephemeral UI state belongs in feature-local React state unless it needs cross-screen access.
- If global UI state becomes necessary, use granular Zustand stores with selectors.
- Do not use `useEffect` plus `useState` for asynchronous data fetching once TanStack Query is configured.
- Private secret material stays in native secure storage, not browser storage.
- Private message history stores ciphertext plus minimal metadata.

## Crypto And Privacy Model

- Moss provides P2P delivery, peer discovery, and encrypted transport sessions.
- OpenMLS provides private DM message-layer E2EE.
- Public/default trackers are used for v1 discovery, so metadata privacy is limited.
- The UI must say private messages are content-encrypted, not anonymous.
- Public chats are planned as signed/authenticated but non-confidential messages.

## Build And Dependency Model

- Moss is dynamically linked in v1.
- Production and CI builds use a pinned Moss release version.
- Development tooling may fetch the latest Moss release and update the pin explicitly.
- Local shared-library binaries are build artifacts and must not be committed.

## First Vertical Slice

The first slice contains:

- onboarding
- invite URI creation and paste
- fingerprint confirmation
- one private DM screen
- diagnostics panel
- adapter contracts for Moss, OpenMLS, and secure storage

Full public rooms, contacts, calls, file transfer, and mobile clients are later slices.
