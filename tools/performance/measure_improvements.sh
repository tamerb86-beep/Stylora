#!/bin/bash

echo "📊 Performance Measurement - After Image Optimization"
echo "======================================================"
echo ""

BASE_URL="https://3000-ih3of2pbfrb0woplorgjj-875f370d.manusvm.computer"

echo "⏱️  Page Load Times:"
echo ""

for page in "/" "/about" "/testimonials" "/book"; do
  echo "📄 $page"
  result=$(curl -o /dev/null -s -w "   TTFB: %{time_starttransfer}s | Total: %{time_total}s | Size: %{size_download} bytes\n" "${BASE_URL}${page}")
  echo "$result"
done

echo ""
echo "📦 WebP Images Size Check:"
echo ""

cd client/public
for img in *.webp; do
  if [ -f "$img" ]; then
    size=$(du -h "$img" | cut -f1)
    echo "   $img: $size"
  fi
done

echo ""
echo "✅ Measurement complete!"
