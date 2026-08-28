#!/bin/bash
#
# OpenHamClock - Compatibility shim for setup-linux.sh -> setup.sh
#

echo "Notice: scripts/setup-linux.sh has been renamed to scripts/setup.sh" >&2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/setup.sh" ]; then
    exec "$SCRIPT_DIR/setup.sh" "$@"
elif [ -f "./scripts/setup.sh" ]; then
    exec "./scripts/setup.sh" "$@"
elif [ -f "./setup.sh" ]; then
    exec "./setup.sh" "$@"
else
    # Fallback for piped execution (e.g., curl .../setup-linux.sh | bash)
    if command -v curl >/dev/null 2>&1; then
        exec bash -c "$(curl -fsSL https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup.sh)" bash "$@"
    elif command -v wget >/dev/null 2>&1; then
        exec bash -c "$(wget -qO- https://raw.githubusercontent.com/accius/openhamclock/main/scripts/setup.sh)" bash "$@"
    else
        echo "Error: setup.sh not found and neither curl nor wget is available." >&2
        exit 1
    fi
fi
