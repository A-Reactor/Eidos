# Contributing and feedback

[简体中文](CONTRIBUTING.md)

For a regular bug, open an issue with the version or commit, operating system, expected result, and steps to reproduce it. Include your Node.js version if you ran Eidos from source. If an offline example reproduces the issue, include the command you used. Remove credentials and personal data before sharing logs or saves. [Private security reporting](SECURITY.en.md#report-a-security-issue)

The maintainer usually reviews issues, pull requests, and security reports once a week.

## Verify changes locally

```bash
cd eidos
npm ci
npm run lint
npm test
npm run build
npm run demo:engine-game
```

## Build release artifacts

From `eidos` in a clean Git checkout, run `npm run pack:open-source`. The script archives the current commit using the root `.gitattributes` and writes `eidos/build/open-source/eidos-source.tar.gz` and its SHA-256 checksum. Extract the archive into a separate directory to verify it.

Run `npm run pack:player` on the target platform to build a portable ZIP. Apple silicon builds require the Xcode command-line tools. Windows builds use the system `curl` and `tar`. The script builds the public source, verifies the bundled Node.js binary, then checks startup and media uploads from a fresh extraction. The ZIP and its checksum appear under `eidos/build/player/`.

The **Player bundles** GitHub Actions workflow also builds artifacts for release. Download and verify the artifacts before attaching them to a Release. The macOS preview uses ad hoc signing. Developer ID signing and notarization are available for public distribution. [English home](README.en.md)
