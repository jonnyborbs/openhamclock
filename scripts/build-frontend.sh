#!/usr/bin/env bash
#
# Shared frontend-build step for setup.sh / setup-pi.sh / update.sh.
#
# Vite's production build peaks near 1 GB of V8 heap. Node sizes its default
# heap from system memory, so on small boxes (Pi, LXC/Proxmox containers)
# the cap lands around 256 MB and the build dies with "FATAL ERROR: Reached
# heap limit Allocation failed" (#1167). Asking for 1 GB explicitly is safe
# even where RAM is tighter — the OS commits pages lazily and swap can cover
# the peak — and on failure we say what the machine actually needs instead
# of dumping a V8 stack trace on the operator.
#
# Respects a caller-provided NODE_OPTIONS (appended, so an explicit
# --max-old-space-size from the environment wins — last flag takes effect).

set -e

if ! NODE_OPTIONS="--max-old-space-size=1024 ${NODE_OPTIONS:-}" npm run build; then
    echo ""
    echo "❌ Frontend build failed."
    MEM_AVAIL_KB=$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null || true)
    if [ -n "$MEM_AVAIL_KB" ] && [ "$MEM_AVAIL_KB" -lt 1048576 ]; then
        echo ""
        echo "   This machine has less than 1 GB of memory available and the build"
        echo "   needs about that much. Two ways forward:"
        echo ""
        echo "   1) Add a 1 GB swap file and re-run:"
        echo "        sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile"
        echo "        sudo mkswap /swapfile && sudo swapon /swapfile"
        echo ""
        echo "   2) Build on a bigger machine and copy the dist/ folder here."
    fi
    exit 1
fi
