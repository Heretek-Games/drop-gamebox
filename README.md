# drop-gamebox

Shared Game Metadata and Hash Database ("GameBox") plugin for the [Drop](https://github.com/Heretek-Games/drop) game distribution platform.

Maintained by [Heretek Games](https://github.com/Heretek-Games/drop-gamebox).

## Overview

Inspired by the Stash-box architecture for community identification, GameBox enables Drop instances to:
1. **Fingerprint**: Calculate SHA-256 binary digests and relative folder structural hashes for games.
2. **Identify**: Query federated GameBox indices to resolve game title, release group, executable launch configs, and save file directories automatically.
3. **Contribute**: Submit verified game configurations and save mappings back to community mirrors.

Built on the `@droposs/plugin-sdk`.
