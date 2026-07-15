# Security Policy

## Supported Versions

Sleepless is currently pre-release software. Security fixes are handled on the latest release line only.

## Reporting A Vulnerability

If you find a vulnerability, please open a private GitHub security advisory when available, or contact the maintainer through the repository owner account.

Please do not include passwords, tokens, private keys, or other secrets in public issues.

## Privileged Helper Model

Sleepless uses a small privileged helper for one macOS power-management operation:

- Enable closed-lid awake behavior on AC power with `/usr/bin/pmset -c disablesleep 1`.
- Disable that behavior with `/usr/bin/pmset -c disablesleep 0`.

The helper accepts only `enable`, `disable`, and `--version` arguments. It uses absolute system command paths and does not accept arbitrary shell commands.

The helper is installed at:

```text
/Library/PrivilegedHelperTools/app.mac.sleepless.pmset-helper
```

To recover the normal closed-lid sleep behavior manually:

```bash
sudo pmset -c disablesleep 0
```

To remove the helper:

```bash
sudo rm -f /Library/PrivilegedHelperTools/app.mac.sleepless.pmset-helper
```

Older test builds used this previous helper path:

```bash
sudo rm -f /Library/PrivilegedHelperTools/app.mac.acawake.pmset-helper
```

## Release Integrity

Public releases should include a SHA-256 checksum for the DMG. Unsigned or unnotarized builds should be labeled as pre-release builds.
