/**
 * Performance Analysis Script for Stylora
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Stylora Performance Analysis\n');
console.log('=' .repeat(60));

// 1. Analyze package.json dependencies
console.log('\n📦 DEPENDENCY ANALYSIS\n');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const dependencies = Object.keys(packageJson.dependencies || {});
const devDependencies = Object.keys(packageJson.devDependencies || {});

console.log(`Production Dependencies: ${dependencies.length}`);
console.log(`Dev Dependencies: ${devDependencies.length}`);

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
      // Skip
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
const pageSizes = [];
pageFiles.forEach(page => {
  const size = getFileSizeInKB(path.join(pagesDir, page));
  pageSizes.push({ name: page, size: parseFloat(size) });
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
  
  const largestComponents = componentFiles.sort((a, b) => b.size - a.size).slice(0, 5);
  console.log('\n🔝 Top 5 Largest Components:');
  largestComponents.forEach((file, i) => {
    const relativePath = file.path.replace(process.cwd() + '/', '');
    console.log(`  ${i + 1}. ${relativePath} - ${(file.size / 1024).toFixed(2)} KB`);
  });
} catch (e) {
  console.log('Could not analyze components directory');
}

// 5. Check images
console.log('\n\n🖼️  IMAGE ANALYSIS\n');

const recommendations = [];

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

// Check for large pages
const largePages = pageSizes.filter(p => p.size > 50);
if (largePages.length > 0) {
  console.log('\n⚠️  Large Pages Detected:');
  largePages.forEach(p => {
    console.log(`  - ${p.name}: ${p.size.toFixed(2)} KB`);
  });
  recommendations.push(`📦 ${largePages.length} large page(s) - Consider code splitting`);
}

// 6. Recommendations
console.log('\n\n💡 OPTIMIZATION RECOMMENDATIONS\n');

if (recommendations.length === 0) {
  console.log('✅ No major optimization issues detected!');
} else {
  recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. ${rec}`);
  });
}

console.log('\n\n📊 PERFORMANCE TIPS\n');
console.log('✅ React lazy loading for route-based code splitting');
console.log('✅ Image optimization (WebP format, compression)');
console.log('✅ Minimize bundle size (tree shaking, remove unused deps)');
console.log('✅ Use CDN for static assets');
console.log('✅ Implement caching strategies');
console.log('✅ Lazy load images below the fold');

console.log('\n' + '='.repeat(60));
console.log('✅ Analysis Complete!\n');
