"""Genera los logos del ticket (1 bit, 384 puntos de ancho máximo = papel de 58 mm a 203 dpi) a partir de los originales.
Uso: python3 scripts/generar-logos-ticket.py <logo-duo> <logo-london>
Escribe src/app/publico/ticket-duo.png, ticket-london.png y src/logos-ticket.ts (bitmap para ESC/POS, GS v 0)."""
import base64, sys
from pathlib import Path
from PIL import Image, ImageOps

raiz = Path(__file__).resolve().parent.parent

def recortar(img, fondo_claro):
    g = img.convert('L')
    m = g.point(lambda v: 255 if (v < 235 if fondo_claro else v > 20) else 0)
    caja = m.getbbox()
    pad = 12
    return img.crop((max(0, caja[0] - pad), max(0, caja[1] - pad), min(img.width, caja[2] + pad), min(img.height, caja[3] + pad)))

def a_1bit(img, ancho, tramado):
    g = img.convert('L')
    alto = round(g.height * ancho / g.width)
    g = g.resize((ancho, alto), Image.LANCZOS)
    return g.convert('1', dither=Image.FLOYDSTEINBERG if tramado else Image.NONE) if tramado else g.point(lambda v: 255 if v > 140 else 0).convert('1')

duo = Image.open(sys.argv[1]).convert('RGB')
duo = recortar(duo, fondo_claro=False)          # texto blanco sobre negro
duo = ImageOps.invert(duo.convert('L'))        # en papel: texto negro sobre blanco (menos tinta)
lon = recortar(Image.open(sys.argv[2]).convert('RGB'), fondo_claro=True)

logos = {'DUO': a_1bit(duo, 300, False), 'LON': a_1bit(lon, 230, True)}
nombres = {'DUO': 'ticket-duo.png', 'LON': 'ticket-london.png'}
ts = ['// GENERADO por scripts/generar-logos-ticket.py: logos del ticket en 1 bit para ESC/POS (GS v 0). No editar a mano.',
      'export interface LogoRaster { ancho: number; alto: number; /** base64, filas de ceil(ancho/8) bytes, bit 1 = punto negro */ datos: string }',
      'export const LOGOS_TICKET: Record<string, LogoRaster> = {']
for t, im in logos.items():
    im.convert('L').save(raiz / 'src/app/publico' / nombres[t], optimize=True)
    w, h = im.size
    bpr = (w + 7) // 8
    datos = bytearray()
    px = im.load()
    for y in range(h):
        for bx in range(bpr):
            byte = 0
            for k in range(8):
                x = bx * 8 + k
                negro = x < w and px[x, y] == 0
                byte |= (1 << (7 - k)) if negro else 0
            datos.append(byte)
    ts.append(f"  {t}: {{ ancho: {w}, alto: {h}, datos: '{base64.b64encode(bytes(datos)).decode()}' }},")
ts.append('};')
(raiz / 'src/logos-ticket.ts').write_text('\n'.join(ts) + '\n')
print({t: im.size for t, im in logos.items()})
