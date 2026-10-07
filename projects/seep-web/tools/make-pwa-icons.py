"""Draws Seep's Home Screen icons (a spade playing card on the felt) into public/. Optional: only needed to REGENERATE them.
To use a designed icon instead, just replace the four PNGs in public/ keeping the same names and sizes."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'   # any font with the spade symbol (U+2660)
OUT = os.path.join(os.path.dirname(__file__), '..', 'public')
FELT, FELT_MID, GOLD, CREAM, INK = '#0a3d20', '#0d5a2e', '#d4af37', '#fef9f0', '#18181b'

def draw(size: int, scale: float) -> Image.Image:
    """scale 1.0 = the card fills the central half of the icon; a smaller scale keeps everything inside a circle (for 'maskable')."""
    S = 1024
    im = Image.new('RGB', (S, S), FELT)
    glow = Image.new('L', (S, S), 0); ImageDraw.Draw(glow).ellipse((S * .1, S * .1, S * .9, S * .9), fill=255)
    im.paste(Image.new('RGB', (S, S), FELT_MID), (0, 0), glow.filter(ImageFilter.GaussianBlur(S * .18)))
    cw, ch = int(S * .50 * scale), int(S * .68 * scale); x0, y0 = (S - cw) // 2, (S - ch) // 2
    r = int(S * .045 * scale)
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((x0 + 10, y0 + 24, x0 + cw + 10, y0 + ch + 24), radius=r, fill=(0, 0, 0, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(S * .02)); im.paste(sh, (0, 0), sh)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x0, y0, x0 + cw, y0 + ch), radius=r, fill=CREAM, outline=GOLD, width=max(2, int(S * .012 * scale)))
    d.text((S / 2, S / 2 + S * .02 * scale), '\u2660', font=ImageFont.truetype(FONT, int(S * .44 * scale)), fill=INK, anchor='mm')
    fs = ImageFont.truetype(FONT, int(S * .085 * scale))
    d.text((x0 + cw * .15, y0 + ch * .085), 'S', font=fs, fill=INK, anchor='mm'); d.text((x0 + cw * .15, y0 + ch * .165), '\u2660', font=fs, fill=INK, anchor='mm')
    corner = Image.new('RGBA', (int(cw * .3), int(ch * .2)), (0, 0, 0, 0)); cd = ImageDraw.Draw(corner)
    cd.text((corner.width * .5, corner.height * .3), 'S', font=fs, fill=INK, anchor='mm'); cd.text((corner.width * .5, corner.height * .75), '\u2660', font=fs, fill=INK, anchor='mm')
    corner = corner.rotate(180); im.paste(corner, (int(x0 + cw * .85 - corner.width / 2), int(y0 + ch * .915 - corner.height * .7)), corner)
    return im.resize((size, size), Image.LANCZOS)

for name, size, scale in (('apple-touch-icon.png', 180, 1.0), ('icon-192.png', 192, 1.0), ('icon-512.png', 512, 1.0), ('icon-maskable-512.png', 512, 0.84)):
    draw(size, scale).save(os.path.join(OUT, name), optimize=True)   # opaque, no transparency: iOS fills transparent icons with black
    print('wrote', name, size)
