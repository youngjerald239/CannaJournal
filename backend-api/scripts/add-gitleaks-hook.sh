#!/usr/bin/env bash
set -euo pipefail
HOOK_FILE=".git/hooks/pre-commit"
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks not installed. Install from https://github.com/gitleaks/gitleaks/releases" >&2
  exit 1
fi
cat > "$HOOK_FILE" <<'EOF'
#!/usr/bin/env bash
# Pre-commit secret scan
if command -v gitleaks >/dev/null 2>&1; then
  echo "[gitleaks] scanning for secrets..." >&2
  gitleaks detect --staged --no-git -q
  status=$?
  if [ $status -ne 0 ]; then
    echo "[gitleaks] potential secrets found. Commit aborted." >&2
    exit 1
  fi
fi
EOF
chmod +x "$HOOK_FILE"
echo "Pre-commit hook installed."