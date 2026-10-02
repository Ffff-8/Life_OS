#!/usr/bin/env python3
"""
LifeOS — generatore delle icone PWA (nessuna libreria esterna richiesta oltre
a Pillow). Produce:
  icons/favicon.png              32x32
  icons/icon-192.png             192x192
  icons/icon-512.png             512x512
  icons/icon-maskable-192.png    192x192 (safe area per il ritaglio adattivo)
  icons/icon-maskable-512.png    512x512
  icons/apple-touch-icon.png     180x180

Il disegno è un quadrato con gradiente viola/blu, una "O" luminosa e un
piccolo punto che rappresenta il nucleo dell'app. Solo grafica generata
localmente: nessun asset di terze parti.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
os.makedirs(OUT, exist_ok=True)

TOP = (124, 92, 240)      # viola
BOTTOM = (79, 109, 245)   # blu


def gradient(size):
    """Gradiente verticale diagonale."""
    img = Image.new("RGB", (size, size), BOTTOM)
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / max(1, (size - 1))
            px[x, y] = (
                int(TOP[0] + (BOTTOM[0] - TOP[0]) * t),
                int(TOP[1] + (BOTTOM[1] - TOP[1]) * t),
                int(TOP[2] + (BOTTOM[2] - TOP[2]) * t),
            )
    return img


def draw_mark(img, scale=1.0, maskable=False):
    """Disegna il simbolo LifeOS sopra il gradiente."""
    size = img.size[0]
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # se maskable, il contenuto sta dentro la safe area (80%)
    inset = size * (0.22 if maskable else 0.16)
    box = [inset, inset, size - inset, size - inset]
    w = max(4, int(size * (0.055 if maskable else 0.07)))

    # "O" luminosa (anello)
    d.ellipse(box, outline=(255, 255, 255, 245), width=w)

    # nucleo: piccolo cerchio pieno sfalsato (il "secondo cervello")
    r = (box[2] - box[0]) * 0.17
    cx = box[0] + (box[2] - box[0]) * 0.72
    cy = box[1] + (box[3] - box[1]) * 0.30
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))

    # alone morbido attorno al nucleo per un tocco di profondità
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gr = r * 2.4
    gd.ellipse([cx - gr, cy - gr, cx + gr, cy + gr], fill=(255, 255, 255, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(2, size * 0.03)))

    out = img.convert("RGBA")
    out = Image.alpha_composite(out, glow)
    out = Image.alpha_composite(out, layer)
    return out


def rounded(img, radius_ratio=0.22):
    """Ritaglia l'immagine in un quadrato con angoli arrotondati."""
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def build(size, maskable=False, rounded_corners=True):
    base = gradient(size)
    marked = draw_mark(base, maskable=maskable)
    if maskable:
        # per le maskable il ritaglio lo fa il sistema: fondo pieno
        return marked
    return rounded(marked) if rounded_corners else marked


def main():
    build(32, rounded_corners=False).save(os.path.join(OUT, "favicon.png"))
    build(180).save(os.path.join(OUT, "apple-touch-icon.png"))
    build(192).save(os.path.join(OUT, "icon-192.png"))
    build(512).save(os.path.join(OUT, "icon-512.png"))
    build(192, maskable=True).save(os.path.join(OUT, "icon-maskable-192.png"))
    build(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
    print("Icone generate in", OUT)
    for f in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, f)
        print(" -", f, os.path.getsize(p), "byte")


if __name__ == "__main__":
    main()
