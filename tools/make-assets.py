#!/usr/bin/env python3
"""
Gera os ícones e o splash do ClaudeTV a partir de código.

    python3 tools/make-assets.py            # opção A (padrão)
    python3 tools/make-assets.py b          # opção B

A marca é original: um triângulo de play com ondas de transmissão saindo
dele. Não usa o logotipo da Anthropic, que é marca registrada deles.
"""
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

OUT = "app/assets"
SS = 6  # supersampling: desenha grande e reduz, para as bordas ficarem lisas

# Paleta quente, no espírito do Claude, sem copiar a marca deles.
BG = (18, 14, 13)
A1 = (232, 138, 96)    # coral claro
A2 = (201, 92, 64)     # terracota
A3 = (240, 176, 130)   # areia, para o brilho


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def gradiente(size, c1, c2, diagonal=True):
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / max(w - 1, 1) * 0.5 + y / max(h - 1, 1) * 0.5) if diagonal \
                else (y / max(h - 1, 1))
            px[x, y] = lerp(c1, c2, min(1.0, t))
    return img


def mascara_arredondada(size, raio):
    big = (size[0] * SS, size[1] * SS)
    m = Image.new("L", big, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, big[0] - 1, big[1] - 1],
                                        radius=raio * SS, fill=255)
    return m.resize(size, Image.LANCZOS)


def marca_play_ondas(size, ondas=True):
    """Triângulo de play com ondas de transmissão saindo à direita."""
    big = size * SS
    m = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(m)

    cx, cy = big * 0.42, big * 0.5
    r = big * 0.21
    pts = []
    for k in range(3):
        ang = math.radians(k * 120)
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    d.polygon(pts, fill=255)

    if ondas:
        esp = big * 0.052
        for i, raio in enumerate([big * 0.30, big * 0.40, big * 0.50]):
            caixa = [cx - raio, cy - raio, cx + raio, cy + raio]
            d.arc(caixa, start=-42, end=42, fill=255, width=int(esp))

    # suaviza e volta a endurecer, para cantos levemente arredondados
    m = m.filter(ImageFilter.GaussianBlur(big * 0.008))
    m = m.point(lambda v: 255 if v > 120 else 0)
    return m.resize((size, size), Image.LANCZOS)


def marca_play_simples(size):
    return marca_play_ondas(size, ondas=False)


def icone(size, variante="a", raio_ratio=0.225):
    s = (size, size)
    fundo = gradiente(s, A1, A2)
    icon = Image.new("RGBA", s, (0, 0, 0, 0))
    icon.paste(fundo, (0, 0), mascara_arredondada(s, int(size * raio_ratio)))

    # brilho suave no canto superior esquerdo, dá volume sem custar nada
    brilho = Image.new("L", s, 0)
    ImageDraw.Draw(brilho).ellipse(
        [-size * 0.35, -size * 0.45, size * 0.75, size * 0.55], fill=90)
    brilho = brilho.filter(ImageFilter.GaussianBlur(size * 0.09))
    icon.paste(Image.new("RGBA", s, A3 + (255,)), (0, 0), brilho)

    marca = marca_play_ondas(size) if variante == "a" else marca_play_simples(size)

    sombra = marca.filter(ImageFilter.GaussianBlur(size * 0.028))
    sombra = sombra.point(lambda v: int(v * 0.32))
    icon.paste(Image.new("RGBA", s, (60, 20, 10, 255)), (0, int(size * 0.018)), sombra)
    icon.paste(Image.new("RGBA", s, (255, 252, 250, 255)), (0, 0), marca)
    return icon


def splash(variante="a", w=1920, h=1080):
    img = Image.new("RGB", (w, h), BG)
    glow = Image.new("L", (w // 4, h // 4), 0)
    ImageDraw.Draw(glow).ellipse(
        [w // 16, h // 16, w // 4 - w // 16, h // 4 - h // 16], fill=95)
    glow = glow.filter(ImageFilter.GaussianBlur(40)).resize((w, h), Image.LANCZOS)
    img.paste(Image.new("RGB", (w, h), A2), (0, 0), glow)

    marca = icone(320, variante, raio_ratio=0.24)
    img.paste(marca, ((w - 320) // 2, (h - 320) // 2 - 30), marca)
    return img


if __name__ == "__main__":
    v = (sys.argv[1] if len(sys.argv) > 1 else "a").lower()
    icone(80, v).save(f"{OUT}/icon.png")
    icone(130, v).save(f"{OUT}/largeIcon.png")
    splash(v).save(f"{OUT}/splash.png")
    print(f"ClaudeTV — ícones gerados em {OUT} (variante {v})")
