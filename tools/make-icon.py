#!/usr/bin/env python3
"""
Ícone do ClaudeTV.

Por que existe: a versão anterior tinha o canto SUPERIOR ESQUERDO
opaco e os outros três transparentes — a máscara de canto
arredondado não cobria aquele. Aqui a máscara é uma só, desenhada
com `rounded_rectangle` em superamostragem 4x, então os quatro
cantos são necessariamente iguais.
"""
from PIL import Image, ImageDraw

ESC = 4                     # superamostragem: desenha grande, reduz depois
FUNDO_TOPO = (232, 132, 92)     # coral
FUNDO_BASE = (176, 74, 48)      # terracota

def icone(lado):
    L = lado * ESC
    # gradiente vertical
    base = Image.new("RGB", (L, L))
    d = ImageDraw.Draw(base)
    for y in range(L):
        t = y / max(1, L - 1)
        d.line([(0, y), (L, y)],
               fill=tuple(round(a + (b - a) * t) for a, b in zip(FUNDO_TOPO, FUNDO_BASE)))

    # máscara de canto arredondado — UMA só, os quatro cantos juntos
    mascara = Image.new("L", (L, L), 0)
    ImageDraw.Draw(mascara).rounded_rectangle(
        [0, 0, L - 1, L - 1], radius=int(L * 0.22), fill=255)

    im = Image.new("RGBA", (L, L), (0, 0, 0, 0))
    im.paste(base, (0, 0), mascara)

    g = ImageDraw.Draw(im)
    cx, cy = L * 0.44, L * 0.5
    r = L * 0.17

    # triângulo de play
    g.polygon([(cx - r * 0.75, cy - r), (cx - r * 0.75, cy + r), (cx + r * 0.85, cy)],
              fill=(255, 255, 255, 255))

    # duas ondas à direita, como você escolheu
    esp = max(2, int(L * 0.035))
    for i, (raio, alfa) in enumerate([(L * 0.16, 235), (L * 0.245, 150)]):
        cxo = L * 0.60
        caixa = [cxo - raio, cy - raio, cxo + raio, cy + raio]
        g.arc(caixa, start=-52, end=52, fill=(255, 255, 255, alfa), width=esp)

    return im.resize((lado, lado), Image.LANCZOS)

for nome, lado in [("icon.png", 80), ("largeIcon.png", 130)]:
    im = icone(lado)
    im.save("app/assets/" + nome)
    cantos = [im.getpixel(p)[3] for p in
              [(0, 0), (lado - 1, 0), (0, lado - 1), (lado - 1, lado - 1)]]
    print(nome, im.size, "alfa dos 4 cantos:", cantos)
    assert max(cantos) < 12, "canto opaco — a máscara falhou"
print("ok: os quatro cantos iguais")
