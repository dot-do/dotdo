#!/bin/bash
# Initialize git submodules for dotdo
#
# This script initializes all git submodules, including:
# - primitives/ - AI primitives from primitives.org.ai
#
# Usage: ./scripts/submodule-init.sh
#        npm run submodule:init

set -e

echo "Initializing git submodules..."

# Initialize and update all submodules recursively
git submodule update --init --recursive

echo "Submodules initialized successfully!"
echo ""
echo "Current submodule status:"
git submodule status
