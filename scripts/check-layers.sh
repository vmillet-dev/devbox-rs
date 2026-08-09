#!/usr/bin/env bash
# Direction des dépendances entre les couches Rust : commands/ → domain/ ← storage/.
#
# Le backend tient en un seul crate, donc rien dans le langage n'impose ce sens :
# ce script est le garde. Appelé par la CI, et exécutable en local avant de
# pousser — `bash scripts/check-layers.sh`.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
status=0

# Les chemins absents sont ignorés : `domain/` s'écrit `domain.rs` + `domain/`,
# et l'un des deux peut manquer selon le découpage.
check() {
  local label="$1" pattern="$2"
  shift 2

  local targets=()
  for path in "$@"; do
    [ -e "$root/$path" ] && targets+=("$root/$path")
  done

  if [ ${#targets[@]} -eq 0 ]; then
    echo "✗ $label — aucun des chemins surveillés n'existe : $*"
    status=1
    return
  fi

  local found
  if found=$(grep -rn "$pattern" "${targets[@]}"); then
    echo "✗ $label"
    echo "$found" | sed 's|^|    |'
    status=1
  else
    echo "✓ $label"
  fi
}

check "domain/ ne connaît ni Diesel ni Tauri" \
  'diesel\|tauri::' \
  src-tauri/src/domain.rs src-tauri/src/domain

check "storage/ ne remonte pas vers commands/" \
  'use crate::commands' \
  src-tauri/src/storage.rs src-tauri/src/storage

exit $status
