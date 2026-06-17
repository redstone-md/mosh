# Code signing policy

Windows release binaries for Mosh are signed through the
[SignPath Foundation](https://signpath.org), which provides free code-signing
certificates to open-source projects. The certificate is issued to and held by
the SignPath Foundation; Mosh is authorized to sign its releases with it.

Code signing is provided free of charge by [SignPath.io](https://signpath.io),
certificate by the SignPath Foundation.

## What is signed

- Windows installers and executables attached to a tagged GitHub release
  (`Mosh_<version>_x64-setup.exe`, `Mosh_<version>_x64_en-US.msi`).

macOS builds are **not** signed by SignPath; they are signed/notarized
separately with an Apple Developer ID (or distributed unsigned). This document
covers the Windows signing pipeline only.

## Team roles

- **Authors** — contributors who write or modify source code. All code reaches
  `main` through pull requests in `github.com/redstone-md/mosh`.
- **Reviewers** — maintainers who review external contributions before merge.
- **Approvers** — the project maintainer(s) who approve each signing request in
  SignPath before a build is signed. Approvers are a subset of trusted
  maintainers with two-factor authentication enabled.

The project is maintained by two co-owners of the repository —
`@ForeverInLaw` and `@rxflex` (`redstone-md`) — who both act as Reviewers and
Approvers. External contributions are merged only after review by a maintainer.

## Signing process

1. A release is tagged and the `Release` GitHub Actions workflow builds the
   Windows installers in a clean-room runner (no secrets injected into the
   build itself).
2. The unsigned artifacts are submitted to SignPath as a signing request.
3. An Approver reviews the request (commit, build, and artifact provenance) and
   approves it.
4. SignPath signs the artifacts with the SignPath Foundation certificate and
   returns them; the signed artifacts are attached to the GitHub release.

Signing requests are bound to this repository's release workflow, so only
artifacts built from reviewed source on a tagged commit can be signed.

## Account security

All maintainers with SignPath access and source-repository write access use
multi-factor authentication, as required by the SignPath Foundation.

## Privacy

SignPath processes the build artifacts submitted for signing and the metadata
of each signing request (repository, commit, workflow run, requester). No
end-user data is involved. See the
[SignPath privacy policy](https://about.signpath.io/privacy) for details.

## Verifying a signature

On Windows, right-click a downloaded installer → **Properties** → **Digital
Signatures**, or run:

```powershell
Get-AuthenticodeSignature .\Mosh_0.2.10_x64-setup.exe | Format-List
```

The signature should be **Valid** and the signer should reference the SignPath
Foundation certificate.
