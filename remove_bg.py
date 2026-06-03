"""
把切图的白色/浅灰背景变成透明，保留猫头内容。
使用"白色背景去除"算法：对每个像素，根据其与白色的距离计算alpha值。
"""
from PIL import Image
import os

def remove_white_bg(img, threshold=230, feather=20):
    """
    threshold: 高于此值的像素视为背景（白色/浅灰）
    feather: 边缘羽化范围，让猫头边缘平滑
    """
    img = img.convert('RGBA')
    w, h = img.size
    pixels = img.load()
    result = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out = result.load()
    
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            # 计算与白色的距离（越接近白色越透明）
            # 白色 = (255,255,255)，背景是接近白色的浅灰
            # 用最小通道值来判断（背景的最小通道也很高）
            min_channel = min(r, g, b)
            
            if min_channel >= threshold:
                # 完全背景色，设为透明
                out[x, y] = (r, g, b, 0)
            elif min_channel >= threshold - feather:
                # 边缘区域，渐变透明
                alpha_ratio = (threshold - min_channel) / feather
                new_alpha = int(255 * alpha_ratio)
                out[x, y] = (r, g, b, new_alpha)
            else:
                # 猫头内容，保持原样
                out[x, y] = (r, g, b, a)
    
    return result

assets_dir = 'assets'
files = [f for f in os.listdir(assets_dir) if f.startswith('stone-') and f.endswith('.png')]

for fname in sorted(files):
    src_path = os.path.join(assets_dir, fname)
    img = Image.open(src_path)
    print(f'Processing {fname} (mode={img.mode}, size={img.size})')
    
    result = remove_white_bg(img, threshold=230, feather=25)
    result.save(src_path)
    print(f'  -> saved with transparent background')

print('\nDone!')
