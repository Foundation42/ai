#!/bin/bash
# AI CLI Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Foundation42/ai/main/install.sh | bash

set -e

REPO="Foundation42/ai"
INSTALL_DIR="${AI_INSTALL_DIR:-$HOME/.local/bin}"

# Detect OS and architecture
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Linux)
    case "$ARCH" in
      x86_64)  BINARY="ai-linux-x64" ;;
      aarch64) BINARY="ai-linux-arm64" ;;
      arm64)   BINARY="ai-linux-arm64" ;;
      *)
        echo "Unsupported Linux architecture: $ARCH"
        exit 1
        ;;
    esac
    ;;
  Darwin)
    case "$ARCH" in
      x86_64) BINARY="ai-macos-x64" ;;
      arm64)  BINARY="ai-macos-arm64" ;;
      *)
        echo "Unsupported macOS architecture: $ARCH"
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS"
    echo "For Windows, download from: https://github.com/$REPO/releases"
    exit 1
    ;;
esac

echo "Installing AI CLI..."
echo ""

# Create install directory if needed
mkdir -p "$INSTALL_DIR"

# Download latest release
LATEST_URL="https://github.com/$REPO/releases/latest/download/$BINARY"
echo "Downloading from: $LATEST_URL"

if command -v curl &> /dev/null; then
  curl -fsSL "$LATEST_URL" -o "$INSTALL_DIR/ai"
elif command -v wget &> /dev/null; then
  wget -q "$LATEST_URL" -O "$INSTALL_DIR/ai"
else
  echo "Error: curl or wget required"
  exit 1
fi

chmod +x "$INSTALL_DIR/ai"

echo ""
echo "Installed to: $INSTALL_DIR/ai"

# Check if in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo ""
  echo "Add to your PATH by running:"
  echo ""
  echo "  echo 'export PATH=\"\$PATH:$INSTALL_DIR\"' >> ~/.bashrc"
  echo "  source ~/.bashrc"
  echo ""
fi

echo "Run 'ai' to get started!"
echo ""
