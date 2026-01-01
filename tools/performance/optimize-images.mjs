import sharp from 'sharp';
import { readdir } from 'fs/promises';
import { join } from 'path';

const imagesDir = './client/public/images/real-photos';

async function optimizeImages() {
  try {
    const files = await readdir(imagesDir);
    
    for (const file of files) {
      // Skip already converted webp files
      if (file.endsWith('.webp')) continue;
      
      // Only process jpg, jpeg, png files
      if (!/\.(jpg|jpeg|png)$/i.test(file)) continue;
      
      const inputPath = join(imagesDir, file);
      const outputPath = join(imagesDir, file.replace(/\.(jpg|jpeg|png)$/i, '.webp'));
      
      console.log(`Converting ${file} to WebP...`);
      
      await sharp(inputPath)
        .webp({ quality: 85 })
        .toFile(outputPath);
      
      console.log(`✓ Created ${outputPath}`);
    }
    
    console.log('\n✅ All images optimized successfully!');
  } catch (error) {
    console.error('Error optimizing images:', error);
    process.exit(1);
  }
}

optimizeImages();
