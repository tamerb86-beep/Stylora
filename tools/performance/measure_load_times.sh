#!/bin/bash

echo "⏱️  Measuring Page Load Times"
echo "================================"
echo ""

BASE_URL="https://3000-ih3of2pbfrb0woplorgjj-875f370d.manusvm.computer"

measure_page() {
  local page=$1
  local url="${BASE_URL}${page}"
  
  echo "📄 Testing: $page"
  
  # Measure time to first byte and total time
  result=$(curl -o /dev/null -s -w "TTFB: %{time_starttransfer}s | Total: %{time_total}s | Size: %{size_download} bytes\n" "$url")
  
  echo "   $result"
  echo ""
}

# Test key pages
measure_page "/"
measure_page "/about"
measure_page "/contact"
measure_page "/book"
measure_page "/signup"

echo "✅ Load time measurement complete"
