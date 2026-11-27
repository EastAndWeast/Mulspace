# Code Signing Policy / 代码签名政策

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## Scope of Signed Artifacts

This policy covers official Windows release binaries (`.exe` NSIS installer and `.zip` portable archive) built from the public source repository:
- Repository: `https://github.com/EastAndWeast/Mulspace`
- License: `GNU General Public License v3.0` (`GPL-3.0-only`, see [LICENSE](./LICENSE))

## Build & Signing Process

1. All release binaries are built exclusively in a clean, reproducible **GitHub Actions** CI/CD environment defined in [.github/workflows/release.yml](./.github/workflows/release.yml) when a version tag (`v*`) is pushed or a release workflow is manually dispatched by a maintainer.
2. Unsigned build artifacts are submitted directly from GitHub Actions to SignPath.io for signing via SignPath's managed Hardware Security Module (HSM).
3. Local developer builds are never signed with the SignPath Foundation certificate.

## Team Roles

- **Committers & Reviewers**: `EastAndWeast` (repository maintainer)
- **Signing Approvers**: `EastAndWeast` (repository maintainer)

## Privacy Policy

Please see [PRIVACY.md](./PRIVACY.md).

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

## Key Security & Incident Response

Signing private keys are generated, stored, and used strictly within SignPath's HSM infrastructure and are never accessible to maintainers or stored in source control. If a vulnerability, compromised build, or suspicious release binary is discovered, please report it immediately via [GitHub Issues](https://github.com/EastAndWeast/Mulspace/issues) or GitHub Security Advisories so the affected release can be revoked and replaced.

---

## 中文说明

- Windows 官方发布包由 **SignPath.io** 提供免费开源代码签名，证书由 **SignPath Foundation** 签发。
- 所有发布包均通过 GitHub Actions 公开工作流自动构建并直接送交 SignPath HSM 签名，源码仓库与构建过程全程公开可审计。
