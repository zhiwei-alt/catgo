"""测量所有切图的猫头边界，输出JS常量"""
from PIL import Image
import os

assets_dir = 'assets'
files = [f for f in os.listdir(assets_dir) if f.startswith('stone-') and f.endswith('.png')]

print('// 切图猫头内容边界（在1024x1024画布中的像素坐标）')
print('// 用于 drawImage 时精确定位和缩放')
print('const SPRITE_META = {')

for fname in sorted(files):
    key = fname.replace('stone-', '').replace('.png', '')
    src_path = os.path.join(assets_dir, fname)
    img = Image.open(src_path).convert('RGBA')
    w, h = img.size
    pixels = img.load()
    
    min_x, max_x, min_y, max_y = w, 0, h, 0
    found = False
    for y in range(h):
        for x in range(w):
            r,g,b,a = pixels[x,y]
            if a > 30:  # 去背后用alpha判断
                found = True
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
    
    if not found:
        print(f'  // {key}: no content found')
        continue
    
    cw = max_x - min_x
    ch = max_y - min_y
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2
    
    print(f'  \'{key}\': {{ cw:{cw}, ch:{ch}, cx:{cx:.0f}, cy:{cy:.0f} }},  // {cw/1024*100:.0f}%x{ch/1024*100:.0f}%')

print('};')
