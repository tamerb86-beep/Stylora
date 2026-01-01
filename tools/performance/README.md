# Performance Tools

This directory contains scripts and utilities for analyzing and optimizing application performance.

## Available Tools

### Performance Analysis

- `analyze_performance.mjs` - Comprehensive performance analysis of the codebase
- `analyze_performance.js` - JavaScript version of performance analyzer
- `measure_improvements.sh` - Shell script to measure performance improvements
- `measure_load_times.sh` - Measure page load times

### Optimization

- `optimize-images.mjs` - Node.js script to optimize image assets
- `optimize_images.py` - Python script for image optimization

## Usage

### Running Performance Analysis

```bash
# Analyze codebase performance metrics
node tools/performance/analyze_performance.mjs
```

### Image Optimization

```bash
# Using Node.js version
node tools/performance/optimize-images.mjs

# Using Python version (requires PIL/Pillow)
python3 tools/performance/optimize_images.py
```

### Measuring Load Times

```bash
# Measure current load times
bash tools/performance/measure_load_times.sh

# Compare before/after improvements
bash tools/performance/measure_improvements.sh
```

## Requirements

- **Node.js scripts**: Node.js 18+ with required dependencies installed
- **Python scripts**: Python 3.8+ with PIL/Pillow installed
- **Shell scripts**: Bash shell with `curl` available

## Output

Most tools will generate reports or logs showing:
- Bundle sizes
- Load times
- Memory usage
- Optimization opportunities
- Before/after comparisons

## Tips

- Run analysis regularly to track performance trends
- Optimize images before committing them to the repository
- Use load time measurements to validate performance improvements
- Keep an eye on bundle sizes as dependencies are added
