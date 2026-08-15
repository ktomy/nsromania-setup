#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

python3 -m unittest "$SCRIPT_DIR/tests/test_validate_artifact.py"
"$SCRIPT_DIR/tests/test-shell-helpers.sh"
