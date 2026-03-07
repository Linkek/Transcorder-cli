#!/usr/bin/env bash
set -e

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║         TranscoRder Setup            ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed."; exit 1; }
command -v npm >/dev/null 2>&1  || { echo "❌ npm is required but not installed."; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || echo "⚠️  ffmpeg not found — you'll need it before running the daemon."

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "⚠️  Node.js v24+ recommended (you have v$(node -v))"
fi

# Install backend dependencies
echo "📦 Installing backend dependencies..."
npm install

# Install and build web UI
echo "📦 Installing web UI dependencies..."
cd web && npm install

echo "🔨 Building web UI..."
npm run build
cd ..

# Create config from example if it doesn't exist
if [ ! -f config/profiles.json ]; then
  cp config/profiles.example.json config/profiles.json
  echo "📝 Created config/profiles.json — edit it with your source folders and settings."
else
  echo "✅ config/profiles.json already exists."
fi

echo ""
echo "  ✅ Setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Edit config/profiles.json with your media folders"
echo "    2. Run:  npm run daemon"
echo "    3. Open: http://localhost:9800"
echo ""
