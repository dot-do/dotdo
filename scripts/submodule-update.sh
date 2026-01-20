#!/bin/bash
# Update git submodules for dotdo
#
# This script updates all git submodules to their latest commits:
# - primitives/ - AI primitives from primitives.org.ai
#
# Usage: ./scripts/submodule-update.sh
#        npm run submodule:update

set -e

echo "Updating git submodules to latest commits..."

# Update all submodules to their latest remote commits
git submodule update --remote --merge

echo ""
echo "Submodules updated successfully!"
echo ""
echo "Current submodule status:"
git submodule status

echo ""
echo "Note: If you want to commit the submodule updates, run:"
echo "  git add primitives"
echo "  git commit -m 'chore: update primitives submodule'"
