#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================="
echo "  topindex update"
echo "========================================="
echo ""

echo "[1/5] Updating hackernews data..."
echo "-----------------------------------------"
bash ~/Projects/hackernews_top/update.sh
echo ""

echo "[2/5] Updating lobsters data..."
echo "-----------------------------------------"
bash /Volumes/Samsung-4TB-APFS/Projects/lobsters_top/update.sh
echo ""

echo "[3/5] Building topindex site..."
echo "-----------------------------------------"
cd "$SCRIPT_DIR"
python3 build.py
echo ""

echo "[4/5] Committing changes..."
echo "-----------------------------------------"
cd "$SCRIPT_DIR"
git add -A
git commit -m "Sync changes ($(date +%Y-%m-%d))" || echo "Nothing to commit"
echo ""

echo "[5/5] Pushing to remote..."
echo "-----------------------------------------"
TOKEN=$(awk 'NR==2{print $NF}' "$SCRIPT_DIR/deploy.txt")
git push "https://topindex:${TOKEN}@github.com/topindex/topindex.github.io.git" main
echo ""

echo "========================================="
echo "  All done!"
echo "========================================="
