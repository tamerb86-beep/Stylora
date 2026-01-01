/**
 * Performance Analysis Script for Stylora
 * Analyzes bundle sizes, dependencies, and potential optimizations
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Stylora Performance Analysis\n');
console.log('=' .repeat(60));

// 1. Analyze package.json dependencies
console.log('\n📦 DEPENDENCY ANALYSIS\n');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const dependencies = Object.keys(packageJson.dependencies || {});
const devDependencies = Object.keys(packageJson.devDependencies || {});

console.log(`Production Dependencies: ${dependencies.length}`);
console.log(`Dev Dependencies: ${devDependencies.length}`);

console.log('\n📚 Key Production Dependencies:');
dependencies.forEach(dep => {
  console.log(`  - ${dep}: ${packageJson.dependencies[dep]}`);
});

// 2. Analyze client source files
console.log('\n\n📁 CLIENT SOURCE FILES ANALYSIS\n');

function getFileSizeInKB(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return (stats.size / 1024).toFixed(2);
  } catch (e) {
    return 'N/A';
  }
}

function analyzeDirectory(dir, extensions = ['.tsx', '.ts', '.jsx', '.js']) {
  let files = [];
  
  function walk(currentPath) {
    try {
      const items = fs.readdirSync(currentPath);
      items.forEach(item => {
        const fullPath = path.join(currentPath, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !item.includes('node_modules') && !item.includes('.git')) {
          walk(fullPath);
        } else if (stat.isFile() && extensions.some(ext => item.endsWith(ext))) {
          files.push({
            path: fullPath,
            size: stat.size,
            name: item
          });
        }
      });
    } catch (e) {
      // Skip directories we can't read
    }
  }
  
  walk(dir);
  return files;
}

const clientFiles = analyzeDirectory('client/src');
const totalClientSize = clientFiles.reduce((sum, f) => sum + f.size, 0);

console.log(`Total Client Files: ${clientFiles.length}`);
console.log(`Total Source Size: ${(totalClientSize / 1024).toFixed(2)} KB`);

// Find largest files
const largestFiles = clientFiles.sort((a, b) => b.size - a.size).slice(0, 10);
console.log('\n🔝 Top 10 Largest Source Files:');
largestFiles.forEach((file, i) => {
  const relativePath = file.path.replace(process.cwd() + '/', '');
  console.log(`  ${i + 1}. ${relativePath} - ${(file.size / 1024).toFixed(2)} KB`);
});

// 3. Analyze pages
console.log('\n\n📄 PAGE COMPONENTS ANALYSIS\n');

const pagesDir = 'client/src/pages';
const pageFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.tsx'));

console.log(`Total Page Components: ${pageFiles.length}`);
pageFiles.forEach(page => {
  const size = getFileSizeInKB(path.join(pagesDir, page));
  console.log(`  - ${page}: ${size} KB`);
});

// 4. Analyze components
console.log('\n\n🧩 REUSABLE COMPONENTS ANALYSIS\n');

const componentsDir = 'client/src/components';
try {
  const componentFiles = analyzeDirectory(componentsDir);
  const totalComponentsSize = componentFiles.reduce((sum, f) => sum + f.size, 0);
  
  console.log(`Total Component Files: ${componentFiles.length}`);
  console.log(`Total Components Size: ${(totalComponentsSize / 1024).toFixed(2)} KB`);
  
  // Find largest components
  const largestComponents = componentFiles.sort((a, b) => b.size - a.size).slice(0, 5);
  console.log('\n🔝 Top 5 Largest Components:');
  largestComponents.forEach((file, i) => {
    const relativePath = file.path.replace(process.cwd() + '/', '');
    console.log(`  ${i + 1}. ${relativePath} - ${(file.size / 1024).toFixed(2)} KB`);
  });
} catch (e) {
  console.log('Could not analyze components directory');
}

// 5. Check for potential optimizations
console.log('\n\n⚡ OPTIMIZATION OPPORTUNITIES\n');

const recommendations = [];

// Check if images are optimized
const publicDir = 'client/public';
try {
  const publicFiles = fs.readdirSync(publicDir);
  const imageFiles = publicFiles.filter(f => 
    f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.svg')
  );
  
  console.log(`Images in public folder: ${imageFiles.length}`);
  imageFiles.forEach(img => {
    const size = getFileSizeInKB(path.join(publicDir, img));
    console.log(`  - ${img}: ${size} KB`);
    if (parseFloat(size) > 100) {
      recommendations.push(`⚠️  Large image: ${img} (${size} KB) - Consider optimization`);
    }
  });
} catch (e) {
  console.log('Could not analyze public directory');
}

// Check for code splitting opportunities
const largePages = largestFiles.filter(f => f.path.includes('/pages/') && f.size > 50 * 1024);
if (largePages.length > 0) {
  recommendations.push(`📦 ${largePages.length} large page(s) detected - Consider code splitting`);
}

// 6. Print recommendations
console.log('\n\n💡 RECOMMENDATIONS\n');

if (recommendations.length === 0) {
  console.log('✅ No major optimization issues detected!');
} else {
  recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. ${rec}`);
  });
}

// 7. Build size estimation
console.log('\n\n📊 ESTIMATED BUILD SIZES\n');

console.log('Note: These are source file sizes. Actual build will be:');
console.log('  - Minified (typically 40-60% smaller)');
console.log('  - Gzipped (typically 70-80% smaller than minified)');
console.log('  - Code-split into multiple chunks');

console.log('\n' + '='.repeat(60));
console.log('✅ Analysis Complete!\n');

