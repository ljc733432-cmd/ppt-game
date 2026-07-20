"""
使用Pillow生成Q版泡泡堂角色立绘
生成4个不同颜色主题的角色，含透明背景
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def create_q_character(primary_color, secondary_color, hair_color, name, output_path):
    """绘制一个Q版角色"""
    size = 512
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    center = size // 2
    
    # === 身体 ===
    body_w, body_h = 120, 100
    body_x = center - body_w // 2
    body_y = center + 30
    draw.ellipse([body_x, body_y, body_x + body_w, body_y + body_h], fill=primary_color)
    # 身体高光
    draw.ellipse([body_x + 20, body_y + 10, body_x + 50, body_y + 35], fill=secondary_color)
    
    # === 手臂 ===
    arm_color = primary_color
    # 左臂
    draw.ellipse([body_x - 30, body_y + 20, body_x + 20, body_y + 60], fill=arm_color)
    # 右臂
    draw.ellipse([body_x + body_w - 20, body_y + 20, body_x + body_w + 30, body_y + 60], fill=arm_color)
    # 手套
    draw.ellipse([body_x - 40, body_y + 35, body_x - 10, body_y + 65], fill=(255, 220, 180, 255))
    draw.ellipse([body_x + body_w + 10, body_y + 35, body_x + body_w + 40, body_y + 65], fill=(255, 220, 180, 255))
    
    # === 腿 ===
    leg_color = (60, 40, 30, 255)  # 深色裤子/鞋子
    draw.ellipse([body_x + 20, body_y + body_h - 20, body_x + 55, body_y + body_h + 30], fill=leg_color)
    draw.ellipse([body_x + body_w - 55, body_y + body_h - 20, body_x + body_w - 20, body_y + body_h + 30], fill=leg_color)
    
    # === 大头 ===
    head_r = 130
    head_x = center - head_r
    head_y = center - head_r - 30
    
    # 头部阴影
    draw.ellipse([head_x + 5, head_y + 5, head_x + head_r * 2 + 5, head_y + head_r * 2 + 5], fill=(0, 0, 0, 50))
    # 头部主体
    draw.ellipse([head_x, head_y, head_x + head_r * 2, head_y + head_r * 2], fill=(255, 220, 180, 255))
    # 头部高光
    draw.ellipse([head_x + 30, head_y + 20, head_x + 80, head_y + 70], fill=(255, 240, 220, 200))
    
    # === 头发 ===
    hair_r = head_r + 15
    hair_points = []
    for i in range(12):
        angle = (i / 12) * 2 * math.pi - math.pi / 2
        r = hair_r + (10 if i % 2 == 0 else -5)
        x = center + math.cos(angle) * r
        y = center - 30 + math.sin(angle) * r
        hair_points.append((x, y))
    
    # 头发主体
    draw.polygon(hair_points, fill=hair_color)
    # 头发高光
    draw.arc([center - 80, head_y - 20, center + 40, head_y + 40], 0, 180, fill=secondary_color, width=15)
    
    # 刘海
    for i in range(5):
        x = center - 60 + i * 30
        y = head_y + 40
        draw.ellipse([x - 10, y - 5, x + 10, y + 15], fill=hair_color)
    
    # === 眼睛 ===
    eye_y = center - 20
    left_eye_x = center - 40
    right_eye_x = center + 40
    
    # 眼白
    draw.ellipse([left_eye_x - 25, eye_y - 20, left_eye_x + 25, eye_y + 30], fill=(255, 255, 255, 255))
    draw.ellipse([right_eye_x - 25, eye_y - 20, right_eye_x + 25, eye_y + 30], fill=(255, 255, 255, 255))
    
    # 瞳孔
    draw.ellipse([left_eye_x - 15, eye_y - 5, left_eye_x + 15, eye_y + 25], fill=(50, 30, 20, 255))
    draw.ellipse([right_eye_x - 15, eye_y - 5, right_eye_x + 15, eye_y + 25], fill=(50, 30, 20, 255))
    
    # 高光
    draw.ellipse([left_eye_x - 8, eye_y - 2, left_eye_x + 5, eye_y + 10], fill=(255, 255, 255, 255))
    draw.ellipse([right_eye_x - 8, eye_y - 2, right_eye_x + 5, eye_y + 10], fill=(255, 255, 255, 255))
    
    # 小星星高光
    draw.polygon([
        (left_eye_x + 10, eye_y - 8),
        (left_eye_x + 13, eye_y - 2),
        (left_eye_x + 19, eye_y - 2),
        (left_eye_x + 14, eye_y + 2),
        (left_eye_x + 16, eye_y + 8),
        (left_eye_x + 10, eye_y + 4),
        (left_eye_x + 4, eye_y + 8),
        (left_eye_x + 6, eye_y + 2),
        (left_eye_x + 1, eye_y - 2),
        (left_eye_x + 7, eye_y - 2)
    ], fill=(255, 255, 255, 255))
    
    # === 眉毛 ===
    draw.arc([left_eye_x - 20, eye_y - 45, left_eye_x + 20, eye_y - 15], 200, 340, fill=hair_color, width=4)
    draw.arc([right_eye_x - 20, eye_y - 45, right_eye_x + 20, eye_y - 15], 200, 340, fill=hair_color, width=4)
    
    # === 腮红 ===
    blush_color = (255, 150, 150, 100)
    draw.ellipse([left_eye_x - 40, eye_y + 20, left_eye_x - 10, eye_y + 50], fill=blush_color)
    draw.ellipse([right_eye_x + 10, eye_y + 20, right_eye_x + 40, eye_y + 50], fill=blush_color)
    
    # === 嘴巴 ===
    mouth_y = center + 50
    draw.arc([center - 20, mouth_y - 15, center + 20, mouth_y + 15], 0, 180, fill=(200, 80, 80, 255), width=3)
    
    # === 装饰 ===
    # 在角色旁边加一个小道具图标
    prop_x = body_x + body_w + 10
    prop_y = body_y - 10
    draw.ellipse([prop_x, prop_y, prop_x + 30, prop_y + 30], fill=primary_color)
    draw.ellipse([prop_x + 8, prop_y - 8, prop_x + 22, prop_y + 8], fill=(255, 200, 0, 255))
    
    # 保存
    img.save(output_path, 'PNG')
    print(f"Generated: {output_path}")
    return img

# 生成4个角色
characters = [
    {
        "primary": (220, 60, 60, 255),      # 红色
        "secondary": (255, 120, 80, 255),   # 橙色
        "hair": (255, 100, 50, 255),         # 橙红色头发
        "name": "火焰小子",
        "path": os.path.join(BASE_DIR, "public/assets/characters/red_boy.png")
    },
    {
        "primary": (60, 120, 220, 255),      # 蓝色
        "secondary": (100, 200, 255, 255),   # 浅蓝色
        "hair": (80, 160, 240, 255),         # 蓝色头发
        "name": "水之少女",
        "path": os.path.join(BASE_DIR, "public/assets/characters/blue_girl.png")
    },
    {
        "primary": (60, 180, 80, 255),       # 绿色
        "secondary": (120, 255, 120, 255),   # 浅绿色
        "hair": (80, 200, 100, 255),         # 绿色头发
        "name": "森林精灵",
        "path": os.path.join(BASE_DIR, "public/assets/characters/green_elf.png")
    },
    {
        "primary": (220, 180, 40, 255),      # 黄色
        "secondary": (255, 230, 100, 255),   # 浅黄色
        "hair": (255, 200, 60, 255),         # 金色头发
        "name": "闪电少年",
        "path": os.path.join(BASE_DIR, "public/assets/characters/yellow_bolt.png")
    }
]

for c in characters:
    create_q_character(c["primary"], c["secondary"], c["hair"], c["name"], c["path"])

print("All characters generated!")
