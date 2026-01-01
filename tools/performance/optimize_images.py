#!/usr/bin/env python3
"""
Image Optimization Script for Stylora
Converts images to WebP and optimizes them
"""

from PIL import Image
import os
import sys

def optimize_image(input_path, output_path, quality=85, max_width=None):
    """
    Convert and optimize an image to WebP format
    
    Args:
        input_path: Path to input image
        output_path: Path to output WebP image
        quality: WebP quality (0-100, default 85)
        max_width: Maximum width to resize to (optional)
    """
    try:
        # Open image
        img = Image.open(input_path)
        
        # Convert RGBA to RGB if necessary
        if img.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
            img = background
        
        # Resize if max_width specified
        if max_width and img.width > max_width:
            ratio = max_width / img.width
            new_height = int(img.height * ratio)
            img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)
        
        # Save as WebP
        img.save(output_path, 'WEBP', quality=quality, method=6)
        
        # Get file sizes
        original_size = os.path.getsize(input_path)
        new_size = os.path.getsize(output_path)
        savings = ((original_size - new_size) / original_size) * 100
        
        print(f"✅ {os.path.basename(input_path)}")
        print(f"   Original: {original_size / 1024:.1f} KB")
        print(f"   Optimized: {new_size / 1024:.1f} KB")
        print(f"   Savings: {savings:.1f}%")
        print()
        
        return True
        
    except Exception as e:
        print(f"❌ Error processing {input_path}: {e}")
        return False

def main():
    public_dir = 'client/public'
    
    # Define optimization settings for different image types
    optimizations = [
        # Salon interior images - high quality, resize to 1920px
        ('salon-interior-1.jpg', 'salon-interior-1.webp', 85, 1920),
        ('salon-interior-2.jpg', 'salon-interior-2.webp', 85, 1920),
        
        # Testimonial images - medium quality, resize to 400px (small portraits)
        ('testimonial-hassan.jpg', 'testimonial-hassan.webp', 80, 400),
        ('testimonial-linda.jpg', 'testimonial-linda.webp', 80, 400),
        ('testimonial-maria.jpg', 'testimonial-maria.webp', 80, 400),
        
        # Video thumbnail - high quality, resize to 1280px
        ('video-thumbnail.jpg', 'video-thumbnail.webp', 85, 1280),
        
        # Screenshots - good quality, resize to 1600px
        ('screenshot-analytics.png', 'screenshot-analytics.webp', 85, 1600),
        ('screenshot-booking.png', 'screenshot-booking.webp', 85, 1600),
        ('screenshot-calendar.png', 'screenshot-calendar.webp', 85, 1600),
        ('screenshot-customers.png', 'screenshot-customers.webp', 85, 1600),
        
        # Logo - high quality, resize to 512px
        ('stylora-logo.png', 'stylora-logo.webp', 90, 512),
    ]
    
    print("🖼️  Starting Image Optimization\n")
    print("=" * 60)
    print()
    
    total_original = 0
    total_optimized = 0
    success_count = 0
    
    for input_file, output_file, quality, max_width in optimizations:
        input_path = os.path.join(public_dir, input_file)
        output_path = os.path.join(public_dir, output_file)
        
        if not os.path.exists(input_path):
            print(f"⚠️  Skipping {input_file} (not found)")
            continue
        
        original_size = os.path.getsize(input_path)
        total_original += original_size
        
        if optimize_image(input_path, output_path, quality, max_width):
            new_size = os.path.getsize(output_path)
            total_optimized += new_size
            success_count += 1
    
    print("=" * 60)
    print("\n📊 OPTIMIZATION SUMMARY\n")
    print(f"Images processed: {success_count}/{len(optimizations)}")
    print(f"Total original size: {total_original / (1024 * 1024):.2f} MB")
    print(f"Total optimized size: {total_optimized / (1024 * 1024):.2f} MB")
    print(f"Total savings: {((total_original - total_optimized) / total_original) * 100:.1f}%")
    print(f"Space saved: {(total_original - total_optimized) / (1024 * 1024):.2f} MB")
    print()
    print("✅ Image optimization complete!")

if __name__ == '__main__':
    main()
