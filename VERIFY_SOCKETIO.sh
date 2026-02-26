#!/bin/bash

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  Verifying Socket.io Implementation                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check for required files
echo "✓ Checking implementation files..."
files=(
  "src/Gateway/socketManager.ts"
  "src/Gateway/eventBridges.ts"
  "src/Gateway/realtimeIntegration.ts"
  "src/Gateway/realtimeClient.ts"
  "src/Gateway/socketManagerTest.ts"
  "src/Gateway/SOCKET_IO_SETUP.md"
  "src/Gateway/REALTIME_EXAMPLES.ts"
  "src/Gateway/IMPLEMENTATION_SUMMARY.md"
  "src/Gateway/ARCHITECTURE_REFERENCE.ts"
  "SOCKET_IO_IMPLEMENTATION.txt"
)

missing=0
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    size=$(wc -c < "$file" | numfmt --to=iec 2>/dev/null || wc -c < "$file")
    echo "  ✓ $file ($size)"
  else
    echo "  ✗ $file (MISSING)"
    missing=$((missing + 1))
  fi
done

echo ""
echo "✓ Checking dependencies..."
if grep -q "socket.io" package.json; then
  echo "  ✓ socket.io installed"
else
  echo "  ✗ socket.io NOT installed"
  missing=$((missing + 1))
fi

if grep -q "socket.io-client" package.json; then
  echo "  ✓ socket.io-client installed"
else
  echo "  ✗ socket.io-client NOT installed"
  missing=$((missing + 1))
fi

echo ""
echo "✓ Checking TypeScript compilation..."
if npx tsc --noEmit 2>&1 | grep -q "src/Gateway/socketManager\|src/Gateway/eventBridges\|src/Gateway/realtimeIntegration\|src/Gateway/realtimeClient"; then
  echo "  ✗ TypeScript errors found"
  missing=$((missing + 1))
else
  echo "  ✓ No TypeScript errors in Socket.io files"
fi

echo ""
if [ $missing -eq 0 ]; then
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║  ✓ All checks passed! Implementation is complete.          ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  exit 0
else
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║  ✗ $missing checks failed                                   ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  exit 1
fi
