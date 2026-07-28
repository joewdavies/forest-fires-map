import os
from PIL import Image, ImageOps

def generate_assets():
    logo_path = "public/logo.png"
    if not os.path.exists(logo_path):
        logo_path = "logo.png"
    if not os.path.exists(logo_path):
        print(f"Error: logo.png not found in public/ or root.")
        return

    # Load original logo
    img = Image.open(logo_path)
    print(f"Loaded logo: size={img.size}, mode={img.mode}")

    # Ensure output directories
    os.makedirs("public", exist_ok=True)

    # 1. Generate Favicons
    # 16x16 PNG
    fav_16 = img.resize((16, 16), Image.Resampling.LANCZOS)
    fav_16.save("public/favicon-16x16.png", "PNG")
    print("Generated favicon-16x16.png")

    # 32x32 PNG
    fav_32 = img.resize((32, 32), Image.Resampling.LANCZOS)
    fav_32.save("public/favicon-32x32.png", "PNG")
    print("Generated favicon-32x32.png")

    # Apple Touch Icon (180x180)
    apple_icon = img.resize((180, 180), Image.Resampling.LANCZOS)
    apple_icon.save("public/apple-touch-icon.png", "PNG")
    print("Generated apple-touch-icon.png")

    # SVG Favicon: Copy public/logo.svg if present, otherwise generate from PNG
    svg_source = "public/logo.svg"
    if os.path.exists(svg_source):
        import shutil
        shutil.copy(svg_source, "public/favicon.svg")
        print("Copied logo.svg to favicon.svg")
    else:
        # SVG Favicon fallback (embed 128x128 PNG as base64 data URL)
        fav_128 = img.resize((128, 128), Image.Resampling.LANCZOS)
        import io
        import base64
        buffer = io.BytesIO()
        fav_128.save(buffer, format="PNG")
        b64_data = base64.b64encode(buffer.getvalue()).decode("utf-8")
        svg_content = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><image href="data:image/png;base64,{b64_data}" x="0" y="0" width="128" height="128"/></svg>\n'
        with open("public/favicon.svg", "w") as f:
            f.write(svg_content)
        print("Generated favicon.svg (embedded PNG)")

    # 2. Generate SEO OG Image (1200x630)
    # We will center the logo on a dark background (#1b1b1b) matching the app's header
    og_width = 1200
    og_height = 630
    og_bg = Image.new("RGBA", (og_width, og_height), (27, 27, 27, 255)) # #1b1b1b

    # Resize logo to fit nicely in the OG image (max height of 400px or width of 800px)
    max_logo_w = 800
    max_logo_h = 400
    
    img_ratio = img.width / img.height
    target_ratio = max_logo_w / max_logo_h
    
    if img_ratio > target_ratio:
        # Width limited
        new_w = max_logo_w
        new_h = int(max_logo_w / img_ratio)
    else:
        # Height limited
        new_h = max_logo_h
        new_w = int(max_logo_h * img_ratio)
        
    logo_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Calculate offset to center the logo
    x_offset = (og_width - new_w) // 2
    y_offset = (og_height - new_h) // 2
    
    # Paste logo (use mask if transparent)
    if logo_resized.mode in ("RGBA", "LA") or (logo_resized.mode == "P" and "transparency" in logo_resized.info):
        og_bg.paste(logo_resized, (x_offset, y_offset), logo_resized)
    else:
        og_bg.paste(logo_resized, (x_offset, y_offset))
        
    # Convert to RGB and save as PNG
    og_final = og_bg.convert("RGB")
    og_final.save("public/og-image.png", "PNG")
    print("Generated og-image.png")

if __name__ == "__main__":
    generate_assets()
