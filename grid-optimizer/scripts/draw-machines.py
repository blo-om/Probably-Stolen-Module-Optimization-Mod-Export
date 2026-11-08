"""The machine icons in public/machines/ and the Hydroponic harvest icons in public/harvest/: original pixel art drawn for this site, at half the size of the game's item
sprites, in their spirit (same machines, layout and palette) but not copied from them. Needs Pillow only for Canvas.image()."""
import math
import os

F = '#292234'  # outline, shared by every machine


class Canvas:
    def __init__(self, w, h, pal):
        self.w, self.h = w, h
        self.g = [['.'] * w for _ in range(h)]
        self.pal = {'f': F, **pal}

    def rect(self, x, y, w, h, ch):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if 0 <= xx < self.w and 0 <= yy < self.h:
                    self.g[yy][xx] = ch

    def box(self, x, y, w, h, fill, round_=True, edge='f'):
        """Outlined box; round_ trims the four outline corners"""
        self.rect(x, y, w, h, edge)
        self.rect(x + 1, y + 1, w - 2, h - 2, fill)
        if round_:
            for cx, cy in ((x, y), (x + w - 1, y), (x, y + h - 1), (x + w - 1, y + h - 1)):
                self.g[cy][cx] = '.'

    def put(self, x, y, s):
        for i, ch in enumerate(s):
            if ch != ' ' and 0 <= x + i < self.w:
                self.g[y][x + i] = ch

    def rows(self, x, y, lines):
        for i, s in enumerate(lines):
            self.put(x, y + i, s)

    def hline(self, x, y, w, ch):
        self.rect(x, y, w, 1, ch)

    def vline(self, x, y, h, ch):
        self.rect(x, y, 1, h, ch)

    def image(self):
        from PIL import Image
        im = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0))
        for y, row in enumerate(self.g):
            for x, ch in enumerate(row):
                if ch in self.pal:
                    c = self.pal[ch]
                    im.putpixel((x, y), tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
        return im

    def svg(self):
        # One rect per horizontal run of a colour, so the file stays small
        out = []
        for y, row in enumerate(self.g):
            x = 0
            while x < self.w:
                ch = row[x]
                if ch not in self.pal:
                    x += 1
                    continue
                run = 1
                while x + run < self.w and row[x + run] == ch:
                    run += 1
                out.append(f'<rect x="{x}" y="{y}" width="{run}" height="1" fill="{self.pal[ch]}"/>')
                x += run
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
                f'shape-rendering="crispEdges">{"".join(out)}</svg>')


def moisture_farm():
    c = Canvas(24, 24, {'b': '#A8AEA5', 'c': '#C9C8B4', 'e': '#7B807A', 'a': '#8A968C', 'h': '#2F3940', 'l': '#8CC4BF',
                        'j': '#355271', 'J': '#6F93C8', 'k': '#3D823F', 'K': '#7BC67E'})
    hood = lambda inner: '.f' + inner + 'f.'
    body = lambda inner: '.fe' + inner + 'ef.'
    vents = 'bbb' + 'eebeebeebeebee' + 'bbb'
    c.rows(0, 0, [
        '...' + 'f' * 18 + '...', '..f' + 'b' * 18 + 'f..',
        hood('b' * 20), hood(vents), hood('b' * 20), hood(vents), hood('b' * 20), hood(vents),
        hood('c' * 20),
        body('a' * 18),
        body('accacc' + 'hhhhhh' + 'ccacca'),
        body('accacc' + 'hllllh' + 'ccacca'),
        body('aaaaaa' + 'ahhhha' + 'aaaaaa'),
        body('a' * 18),
        body('aaeeeeeeeeeeeeeeaa'),
        body('aeaaaaaaaaaaaaaaea'),
        body('aeajjjaaaaaakkkaea'),
        body('aeajJjaaaaaakKkaea'),
        body('aeaaaaaaaaaaaaaaea'),
        body('aeaaaaaeeeeaaaaaea'),
        body('aeaaaaeaaaaeaaaaea'),
        body('aeaaaeaaaaaaeaaaea'),
        '.feeeeefaaaaaaaafeeeeef.',
        '..fffff.ffffffff.fffff..',
    ])
    return c


def agewell():
    # Wine rack: pale lid, blue-grey frame, three shelves of bottles behind it
    c = Canvas(24, 24, {'b': '#B4B8AE', 'c': '#D6D2B7', 'g': '#80929B', 'G': '#6C7D86', 'd': '#3E2A34',
                        'p': '#6B5269', 'q': '#8C6E89', 'm': '#777081', 'r': '#5A3D4C'})
    c.box(1, 0, 22, 24, 'g')
    c.rect(2, 1, 20, 4, 'b')
    c.hline(2, 5, 20, 'c')
    c.rect(4, 7, 16, 14, 'f')
    c.rect(5, 8, 14, 12, 'd')
    for top in (8, 12, 16):
        c.put(5, top, ' q q q q q q q ')
        c.put(5, top + 1, ' p p p p p p p ')
        c.put(5, top + 2, ' p p p p p p p ')
        if top < 16:
            c.hline(5, top + 3, 14, 'm')
    c.vline(2, 10, 5, 'r')
    c.vline(21, 6, 16, 'G')
    c.hline(2, 21, 20, 'G')
    c.hline(2, 22, 20, 'c')
    return c


def alarm_system():
    # Dark box: keypad unit on the left (teal shield, keys), sensor eye on the right
    c = Canvas(24, 24, {'a': '#44464C', 'l': '#5F6868', 's': '#2B2836', 't': '#45918B', 'T': '#275654', 'k': '#6E7878'})
    c.box(1, 1, 22, 22, 'a')
    c.hline(2, 2, 20, 'l')
    c.vline(12, 3, 19, 's')
    c.box(3, 4, 8, 16, 's')
    c.rows(4, 6, ['tttttt', ' tttt ', '  tt  '])
    c.rows(4, 11, ['k k k ', '      ', 'k k k ', '      ', 'k k k '])
    c.hline(13, 8, 9, 's')
    c.box(15, 12, 6, 5, 's')
    c.put(16, 13, 'TttT')
    c.put(16, 14, ' TT ')
    c.hline(2, 21, 20, 's')
    return c


def deal_maker():
    # Rounded frame with side grips around a dark screen
    c = Canvas(24, 16, {'a': '#5F6868', 'A': '#44464C', 's': '#2B2836', 'h': '#3A3746'})
    c.box(1, 1, 22, 14, 'a')
    c.box(3, 3, 18, 10, 's', round_=False)
    c.rows(4, 4, ['hhh', 'hh', 'h'])
    c.rect(0, 5, 2, 6, 'f')
    c.rect(1, 6, 1, 4, 'A')
    c.rect(22, 5, 2, 6, 'f')
    c.rect(22, 6, 1, 4, 'A')
    c.hline(2, 13, 20, 'A')
    return c


def desequencer():
    # Dark core with a green terminal, four brown pads at the corners, side vents, orange status light
    c = Canvas(24, 24, {'a': '#44464C', 'l': '#5F6868', 's': '#2B2836', 'g': '#2F6B33', 'G': '#84A251',
                        'p': '#645355', 'P': '#453943', 'o': '#C0704F'})
    pad = ['  f  ', ' fpf ', 'fpPpf', ' fpf ', '  f  ']
    for x, y in ((0, 1), (19, 1), (0, 18), (19, 18)):
        c.rows(x, y, pad)
    c.box(9, 0, 6, 3, 'l')
    c.box(4, 2, 16, 20, 'a')
    c.hline(5, 3, 14, 'l')
    c.box(6, 5, 12, 10, 'g', round_=False)
    c.put(8, 7, 'GGGGGG')
    c.put(8, 9, 'GGG GG')
    c.put(8, 11, 'GG GGG')
    c.box(9, 16, 6, 3, 's', round_=False)
    c.put(10, 17, 'GG')
    c.box(1, 9, 4, 6, 's')
    c.vline(2, 10, 4, 'G')
    c.box(19, 9, 4, 6, 's')
    c.vline(21, 10, 4, 'G')
    c.box(10, 21, 4, 3, 'o')
    return c


def dna_manipulator():
    # Cream cabinet with purple trim, a dark screen and keypad; a glass vial stand on the right
    c = Canvas(24, 24, {'c': '#D5D2B8', 'C': '#C4C4B0', 'a': '#88948A', 'p': '#A272AC', 'P': '#743D70',
                        's': '#392E3C', 'k': '#5F6868', 'd': '#44464C', 'o': '#C98A4B', 'v': '#A8AEA5', 'V': '#E3E3D6'})
    c.box(1, 0, 15, 23, 'C')
    c.rect(2, 1, 13, 6, 'c')
    c.rows(2, 1, ['PP', 'pP', ' p'])
    c.rows(12, 1, ['PP', 'Pp', 'p '])
    c.box(3, 7, 11, 6, 's', round_=False)
    c.put(4, 14, 'k k k k k')
    c.box(3, 16, 11, 6, 'd', round_=False)
    c.put(4, 18, 'kk  kk')
    c.rows(10, 17, [' oo', 'o  o', ' oo'])
    c.box(16, 5, 7, 6, 'v')
    c.rect(18, 6, 3, 4, 'V')
    c.box(15, 11, 9, 12, 'C')
    c.box(17, 13, 5, 6, 'v', round_=False)
    c.vline(18, 14, 4, 'V')
    return c


def evaporator():
    # Dark heater: panelled top, a red coil behind the window, vent slots and feet
    c = Canvas(24, 24, {'a': '#44464C', 'l': '#5F6868', 's': '#2B2836', 'w': '#373248', 'r': '#8A4652', 'R': '#5E3340'})
    c.box(0, 1, 24, 21, 'a')
    c.rect(1, 2, 22, 4, 'l')
    c.vline(8, 2, 4, 'a')
    c.vline(16, 2, 4, 'a')
    c.box(2, 7, 20, 9, 'w', round_=False)
    c.put(4, 9, 'rrrrrrrrrrrrrrr')
    c.put(4, 10, '              r')
    c.put(4, 11, 'rrrrrrrrrrrrrrr')
    c.put(4, 12, 'r              ')
    c.put(4, 13, 'rrrrrrrrrrrrrrr')
    c.put(3, 17, 's s s s s s s s s')
    c.rect(2, 19, 4, 2, 's')
    c.rect(8, 19, 3, 2, 's')
    c.rect(13, 19, 3, 2, 's')
    c.put(18, 19, 's s')
    c.rect(2, 22, 4, 2, 'f')
    c.rect(18, 22, 4, 2, 'f')
    return c


def furnace():
    # Cream control top across the full width, blue-grey body around a dark mouth with a teal grate,
    # thin purple-grey side posts, ash door bottom left
    c = Canvas(24, 24, {'c': '#D5D2B8', 'C': '#C4C4B0', 'm': '#777081', 'M': '#8E8898', 'b': '#80929B',
                        'B': '#93A4AC', 'h': '#303A41', 'H': '#232B31', 't': '#2F6B66', 'q': '#6B5269',
                        'r': '#7A3A44', 'd': '#2B2230'})
    c.box(0, 0, 24, 24, 'b')
    c.rect(1, 1, 22, 8, 'c')
    c.rect(5, 1, 14, 2, 'C')
    c.hline(5, 3, 14, 'B')
    c.put(5, 5, 'qq qq qq')
    c.rect(15, 5, 3, 2, 'H')
    c.rect(1, 9, 2, 14, 'm')
    c.rect(21, 9, 2, 14, 'm')
    for y in (11, 15, 19):
        c.put(1, y, 'M')
        c.put(22, y, 'M')
    c.hline(3, 9, 18, 'B')
    c.rect(4, 10, 16, 10, 'h')
    c.rect(6, 11, 12, 2, 'H')
    for y in (14, 16, 18):
        c.put(4, y, 'tt tt tt tt tt t')
    c.rect(2, 16, 5, 7, 'd')
    c.hline(2, 16, 5, 'C')
    c.put(3, 18, 'r r')
    c.put(3, 20, 'r r')
    c.hline(7, 21, 13, 'C')
    # Rounder corners
    for x, y, dx, dy in ((0, 0, 1, 1), (23, 0, -1, 1), (0, 23, 1, -1), (23, 23, -1, -1)):
        c.put(x + dx, y, '.') if False else None
        c.g[y][x + dx] = '.'
        c.g[y + dy][x] = '.'
        c.g[y + dy][x + dx] = 'f'
    return c


def hydroponic():
    # Grow tray on top, a stacked grey column, and a cream base with a water strip and an orange read-out
    c = Canvas(24, 32, {'b': '#A8AEA5', 'c': '#D5D2B8', 'y': '#E0C27A', 'g': '#5F6868', 'G': '#4B5353',
                        't': '#45918B', 'T': '#2E6A66', 'o': '#C4683A', 'u': '#6F93C8', 'k': '#88948A'})
    c.box(0, 0, 24, 4, 'b')
    c.hline(1, 1, 22, 'c')
    c.hline(5, 4, 14, 'y')
    c.box(5, 4, 14, 18, 'g')
    c.hline(6, 4, 12, 'y')
    for y in (8, 12, 16, 20):
        c.hline(6, y, 12, 'G')
    c.box(1, 21, 22, 11, 'c')
    c.box(3, 22, 18, 4, 't', round_=False)
    c.hline(4, 24, 16, 'T')
    c.put(6, 23, 'TT    TT')
    c.hline(2, 26, 20, 'b')
    c.box(3, 27, 6, 3, 'o', round_=False)
    c.rect(13, 28, 2, 1, 'k')
    c.rect(16, 28, 2, 1, 'k')
    c.vline(20, 27, 3, 'u')
    return c


def mirage_projector():
    # Hexagonal housing: a pale centre column between two cream side faces up top, and a darker grey front plate filling
    # the lower half of the hexagon (its top edge a chevron widening out to the sides) with vents and the lens
    c = Canvas(24, 24, {'c': '#D5D2B8', 'd': '#C4C4B0', 'e': '#88948A', 'g': '#A8AEA5', 'p': '#955699',
                        'j': '#53585B', 'k': '#79746E', 'i': '#373541', 'h': '#3D823F'})
    # Outline: short flat top and bottom, 2-pixel diagonal steps, straight sides
    span = {3: (6, 17), 4: (4, 19), 5: (2, 21), 18: (2, 21), 19: (4, 19), 20: (6, 17)}
    for y in range(6, 18):
        span[y] = (1, 22)
    c.hline(8, 2, 8, 'f')
    c.hline(8, 21, 8, 'f')
    for y, (l, r) in span.items():
        w = 2 if y in (3, 4, 5, 18, 19, 20) else 1
        c.rect(l, y, w, 1, 'f')
        c.rect(r - w + 1, y, w, 1, 'f')
        c.rect(l + w, y, r - l - 2 * w + 1, 1, 'd')
    # Pale centre column down the upper half
    c.rect(8, 3, 8, 10, 'c')
    # Side-face panel lines
    c.put(5, 6, 'e')
    c.put(4, 7, 'e')
    c.put(3, 8, 'e')
    c.vline(5, 7, 5, 'e')
    c.put(18, 6, 'e')
    c.put(19, 7, 'e')
    c.put(20, 8, 'e')
    c.vline(18, 7, 5, 'e')
    # Emblem: a ring with a bar to each side
    c.rows(10, 6, [' pp ', 'p  p', ' pp '])
    c.put(8, 7, 'p')
    c.put(15, 7, 'p')
    # Darker front plate: a chevron top edge, filling the bottom of the hexagon
    plate = {13: (8, 15), 14: (6, 17), 15: (4, 19), 16: (2, 21), 17: (2, 21), 18: (4, 19), 19: (6, 17), 20: (8, 15)}
    for y, (l, r) in plate.items():
        c.rect(l, y, r - l + 1, 1, 'g')
    c.put(4, 12, 'ee')
    c.put(18, 12, 'ee')
    c.put(2, 13, 'ee')
    c.put(20, 13, 'ee')
    # Vents either side, the lens in the middle, a green light
    for x, top in ((3, 16), (5, 15), (18, 15), (20, 16)):
        c.vline(x, top, 18 - top + 1, 'j')
    c.vline(7, 15, 4, 'j')
    c.vline(16, 15, 4, 'j')
    c.rows(8, 14, ['  dddd  ', ' djjjjd ', 'djiiiijd', 'djikiijd', 'djiiiijd', ' dkkkkd ', '  dddd  '])
    c.put(15, 13, 'h')
    return c


def printer():
    # Dark printer: a print head on its rail up top, a big glass window below, three status lights
    c = Canvas(24, 24, {'a': '#5F6868', 'A': '#4B5B5D', 'k': '#21282B', 'm': '#88948A', 'o': '#C27A3E',
                        'w': '#3F4A52', 'r': '#56676A', 'c': '#D5D2B8', 'R': '#C94F4F', 'G': '#4CAF50', 'B': '#6F93C8'})
    c.box(0, 0, 24, 24, 'a')
    c.box(2, 2, 20, 7, 'k', round_=False)
    c.hline(4, 5, 16, 'm')
    c.put(3, 5, 'o')
    c.put(20, 5, 'o')
    c.box(9, 3, 5, 5, 'm')
    c.rect(10, 5, 3, 1, 'A')
    c.box(2, 10, 20, 11, 'w')
    c.rows(4, 11, ['   r', '  r   r', ' r   r', 'r   r', '   r'])
    c.hline(3, 19, 18, 'A')
    c.put(16, 22, 'RGB')
    c.put(3, 22, 'cccccccc')
    return c


def water_purifier():
    # Purple frame with tabs at the top corners: a filter tube across the top, a blue-grey control band with a gauge,
    # three teal cartridges tapering to nozzles over a dark back, a blue-grey base
    c = Canvas(24, 32, {'d': '#6B5269', 'e': '#4A2F38', 'c': '#80929B', 'h': '#D5D2B8', 'F': '#A8AEA5',
                        'w': '#E8E6DA', 'j': '#2F2B3A', 'n': '#C4C4B0', 'm': '#853737', 'o': '#303A41',
                        'q': '#45918B', 'k': '#8ABFBB', 'p': '#275654', 'r': '#5A3D4C', 'l': '#777081'})
    # Silhouette: tabs at the corners, the top edge dipped between them
    c.hline(1, 0, 5, 'f')
    c.hline(18, 0, 5, 'f')
    c.rect(1, 1, 22, 31, 'f')
    c.rect(2, 1, 3, 1, 'c')
    c.rect(19, 1, 3, 1, 'c')
    c.rect(2, 2, 20, 28, 'd')
    # Filter tube
    c.box(3, 2, 18, 7, 'h')
    for x, y in ((3, 2), (20, 2), (3, 8), (20, 8)):
        c.g[y][x] = 'f'
    c.hline(4, 3, 16, 'w')
    c.hline(4, 7, 16, 'F')
    c.rect(4, 3, 2, 5, 'c')
    c.rect(18, 3, 2, 5, 'c')
    c.vline(8, 3, 5, 'F')
    c.vline(15, 3, 5, 'F')
    # Control band: dark slot, gauge on the left, a box on the right
    c.rect(2, 9, 20, 4, 'c')
    c.rect(7, 10, 10, 2, 'j')
    c.hline(7, 12, 10, 'o')
    c.rows(2, 11, ['fnnf', 'nnmn', 'fnnf'])
    c.box(18, 10, 4, 4, 'o', round_=False)
    # Cartridges over a dark back with a crossbar
    c.rect(2, 13, 20, 16, 'e')
    c.rect(3, 20, 18, 2, 'r')
    c.rect(2, 13, 1, 16, 'l')
    c.rect(21, 13, 1, 16, 'l')
    for x in (4, 10, 16):
        c.rect(x, 14, 4, 13, 'q')
        c.vline(x, 14, 13, 'k')
        c.vline(x + 3, 14, 13, 'p')
        c.hline(x, 14, 4, 'k')
        c.hline(x, 26, 4, 'p')
        c.put(x + 1, 27, 'qp')
    # Base
    c.rect(2, 29, 20, 1, 'c')
    c.rect(2, 30, 20, 1, 'l')
    return c


MACHINES = {
    'moisture_farm': moisture_farm, 'agewell': agewell, 'alarm_system': alarm_system, 'deal_maker': deal_maker,
    'desequencer': desequencer, 'dna_manipulator': dna_manipulator, 'evaporator': evaporator, 'furnace': furnace,
    'hydroponic': hydroponic, 'mirage_projector': mirage_projector, 'printer': printer, 'water_purifier': water_purifier,
}

# ---- Harvest icons for the Hydroponic System card (public/harvest/): 24x24, each following its item's own silhouette

def ellipse(c, cx, cy, rx, ry, ch, outline=True):
    """Filled ellipse centred on (cx, cy) (half-pixel centres allowed), with a one-pixel outline around it"""
    inside = lambda x, y, ex, ey: ((x + 0.5 - cx) / ex) ** 2 + ((y + 0.5 - cy) / ey) ** 2 <= 1
    for y in range(c.h):
        for x in range(c.w):
            if outline and inside(x, y, rx + 1, ry + 1) and not inside(x, y, rx, ry):
                c.g[y][x] = 'f'
    for y in range(c.h):
        for x in range(c.w):
            if inside(x, y, rx, ry):
                c.g[y][x] = ch


def shade(c, cx, cy, rx, ry, ch, dx, dy):
    """Recolour the part of an ellipse that a copy shifted by (dx, dy) does not cover: a crescent of shadow or light"""
    inside = lambda x, y, ox, oy: ((x + 0.5 - ox) / rx) ** 2 + ((y + 0.5 - oy) / ry) ** 2 <= 1
    for y in range(c.h):
        for x in range(c.w):
            if inside(x, y, cx, cy) and not inside(x, y, cx + dx, cy + dy):
                c.g[y][x] = ch


def outline_all(c):
    """A one-pixel outline around everything drawn so far"""
    filled = {(x, y) for y in range(c.h) for x in range(c.w) if c.g[y][x] != '.'}
    for y in range(c.h):
        for x in range(c.w):
            if c.g[y][x] == '.' and any((x + dx, y + dy) in filled for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                c.g[y][x] = 'f'


def rellipse(c, cx, cy, rx, ry, deg, ch, only=None):
    """Filled ellipse turned by deg degrees (no outline); `only` limits it to pixels already holding those letters"""
    a = math.radians(deg)
    for y in range(c.h):
        for x in range(c.w):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            u = dx * math.cos(a) + dy * math.sin(a)
            v = -dx * math.sin(a) + dy * math.cos(a)
            if (u / rx) ** 2 + (v / ry) ** 2 <= 1 and (only is None or c.g[y][x] in only):
                c.g[y][x] = ch


def nutrifruit():
    # Two oval potatoes: a whole purple one lying tilted on the left, a halved one on the right showing its pink flesh
    c = Canvas(24, 24, {'b': '#A272AC', 'c': '#777081', 'd': '#6B5269', 'e': '#88948A', 'x': '#4A2F38',
                        'g': '#BB9165', 'h': '#C0A0A4'})
    rellipse(c, 9.5, 12, 9, 6, -28, 'b')
    rellipse(c, 8.5, 14.5, 9, 5, -28, 'd', only='b')
    rellipse(c, 9.8, 11.2, 9, 5.6, -28, 'b', only='d')
    for x, y in ((9, 8), (10, 8), (9, 9), (6, 11), (7, 11), (12, 6)):
        c.put(x, y, 'e')
    c.put(3, 15, 'cc')
    c.put(5, 16, 'c')
    # The halved potato: skin first, then the cut face
    rellipse(c, 17, 16, 6.2, 6.4, -10, 'x')
    rellipse(c, 17, 16, 5.4, 5.6, -10, 'd')
    rellipse(c, 18.3, 15.4, 4.4, 5, -10, 'g')
    rellipse(c, 18.5, 15.2, 3.5, 4.2, -10, 'h')
    for x, y in ((17, 13), (18, 13), (19, 14), (17, 15), (18, 16), (20, 17), (19, 17)):
        c.put(x, y, 'g')
    outline_all(c)
    return c


def kotton():
    # A tall thin stalk: one cotton boll at the top left, another off to the right halfway down
    c = Canvas(24, 24, {'w': '#D5D2B8', 'W': '#D59F75', 'o': '#D59F75', 's': '#645355'})
    c.rows(6, 1, [
        '   fff      ',
        '  fwwwf     ',
        ' fwwowwf    ',
        'fwwwwowf    ',
        'fwowwwwf    ',
        'fWwwwwWf    ',
        ' fWWWWf     ',
        '   fsf      ',
        '   fsf      ',
        '   fsf  fff ',
        '   fsf fwwwf',
        '   fsffwowwf',
        '   fsfwwwwof',
        '   fsffWwWf ',
        '   fsf fff  ',
        '   fsf      ',
        '   fsf      ',
        '   fssf     ',
        '    fsf     ',
        '    fsf     ',
        '    fsf     ',
        '     f      ',
    ])
    return c


def kotton_fabric():
    # A long, flat bolt of pale cloth on a grey roll
    c = Canvas(24, 24, {'w': '#D5D2B8', 'W': '#C4C4B0', 'g': '#A8AEA5', 'e': '#88948A', 'd': '#44464C'})
    c.box(1, 8, 22, 8, 'w')
    c.vline(2, 9, 5, 'g')
    for x in range(5, 21, 3):
        c.vline(x, 9, 4, 'W')
    c.vline(20, 9, 5, 'g')
    c.hline(2, 13, 20, 'e')
    c.hline(2, 14, 20, 'd')
    return c


def _cap(pal):
    # A small pointed cap tilted on a tall, bent stem that splits at the foot
    c = Canvas(24, 24, pal)
    c.rows(6, 1, [
        '      fff   ',
        '     fhcf   ',
        '    fdhccf  ',
        '  ffddcccdf ',
        'ffdddddcdddf',
        'fcceddddddf ',
        ' feccddddddf',
        '  fcccccccf ',
        '   feeeffff ',
        '   fsSf     ',
        '   fssf     ',
        '   fssf     ',
        '    fssf    ',
        '    fsSf    ',
        '     fssf   ',
        '     fssf   ',
        '     fsSf   ',
        '    fsssf   ',
        '    fsSsf   ',
        '   fssbssf  ',
        '  fssfsssf  ',
        '  fff  ff   ',
    ])
    return c


def dream_cap():
    return _cap({'c': '#A4715D', 'd': '#7D4F4A', 'h': '#C5AC96', 'e': '#64343B', 's': '#A4715D', 'S': '#8F6B5A', 'b': '#B68B74'})


def meal_cap():
    return _cap({'c': '#BB8A65', 'd': '#955C4B', 'h': '#D5D2B8', 'e': '#A96847', 's': '#BB8A65', 'S': '#8F6B5A', 'b': '#BE9D86'})


def nightmare_cap():
    return _cap({'c': '#9C3738', 'd': '#64343B', 'h': '#B26B4E', 'e': '#9C3738', 's': '#A8AEA5', 'S': '#79746E', 'b': '#D5D2B8'})


def coffee_bean():
    # A tight heap of roasted beans, each with a dark crease
    c = Canvas(24, 24, {'b': '#7D4F4A', 'B': '#64343B', 'l': '#A96847'})
    beans = [(7.5, 6), (15.5, 5.5), (4.5, 12), (11.5, 11.5), (18.5, 12), (8, 17.5), (15, 18)]
    for cx, cy in beans:
        ellipse(c, cx, cy, 3.4, 2.7, 'b', outline=False)
        shade(c, cx, cy, 3.4, 2.7, 'B', -1, -1)
    for cx, cy in beans:
        x0, y0 = int(cx - 2), int(cy)
        c.put(x0, y0 - 1, 'l')
        c.put(x0 + 1, y0, 'ff')
        c.put(x0 + 3, y0 - 1, 'f')
    # Dark gaps between neighbouring beans
    for cx, cy in beans:
        for ox, oy in beans:
            if (cx, cy) < (ox, oy) and abs(cx - ox) < 8 and abs(cy - oy) < 7:
                mx, my = int((cx + ox) / 2), int((cy + oy) / 2)
                if c.g[my][mx] != '.':
                    c.g[my][mx] = 'f'
    outline_all(c)
    return c


def fillerweed():
    # A tall, narrow head: ruffled green leaves on top, pale ribbed stalks below
    c = Canvas(24, 24, {'g': '#5C6F46', 'G': '#41603F', 'y': '#848552', 'p': '#AAA982', 'P': '#848552', 'w': '#D5D2B8'})
    leaf = lambda vein: 'fG' + vein + 'w' + vein[::-1] + 'gf'
    c.rows(6, 0, [
        ' ff   ff    ',
        'fggf fggf f ',
        'fGggffggGfgf',
        leaf('ggyg')[:12],
        leaf('gygg')[:12],
        leaf('yggg')[:12],
        leaf('ggyg')[:12],
        leaf('gygg')[:12],
        leaf('yggg')[:12],
        'fGgPpwppPggf',
        'fGPpwppwpPgf',
        'fgPwpwwpwpPf',
        'fPpwpwwpwppf',
        'fPpwpwwpwpPf',
        'fPpwpwwpwpPf',
        'fPpwpwwpwpPf',
        ' fpwpwwpwpf ',
        ' fpwpwwpwpf ',
        ' fPwpwwpwPf ',
        '  fpwwwwpf  ',
        '  fPpwwpPf  ',
        '   fppppf   ',
        '    ffff    ',
    ])
    return c


def bloomberry():
    # A bunch of round berries hanging down to the left, the stem rising to the upper right
    c = Canvas(24, 24, {'e': '#743D70', 'd': '#563168', 'h': '#A272AC', 's': '#8A5C54'})
    berry = [' dd ', 'dhed', 'deed', ' dd ']
    spots = [(10, 4), (14, 4), (17, 6), (7, 7), (11, 7), (14, 8), (5, 10), (9, 10), (13, 11), (16, 10),
             (4, 14), (8, 14), (12, 14), (5, 17), (9, 17), (4, 20)]
    for x, y in spots:
        c.rows(x, y, berry)
    c.rows(16, 0, ['     s', '    s ', '   s  ', ' ss   ', 's      '])
    outline_all(c)
    return c


def hydroreed_seed():
    # A seed packet like a little scroll: wider cream and teal bars top and bottom, a teal-framed panel with a sprout
    c = Canvas(24, 24, {'w': '#D5D2B8', 'c': '#C5AC96', 'd': '#275654', 'e': '#67AAA5', 't': '#45918B', 'g': '#8ABFBB',
                        'G': '#3D823F', 'D': '#275654'})
    body = lambda inner: '   f' + inner + 'f   '
    c.rows(0, 3, [
        '  ' + 'f' * 20 + '  ',
        '  f' + 'wcwcwcwcwcwwwwwwww' + 'f  ',
        '  f' + 'dddddddeeeeddddddd' + 'f  ',
        body('dewwwwwwwwwwwwed'),
        body('ewwwwwwwwwwwwwwe'),
        body('gw' + 'wwwwwwtwwwww' + 'wg'),
        body('gw' + 'wwttttttGwww' + 'wg'),
        body('gw' + 'wwwtDDDwwwww' + 'wg'),
        body('gw' + 'wwDDwwDwwwww' + 'wg'),
        body('gw' + 'wwwwwwDGwwww' + 'wg'),
        body('gw' + 'wwwwwwDGwwww' + 'wg'),
        body('gw' + 'wwwwwwDwwwww' + 'wg'),
        body('ewwwwwwwwwwwwwwe'),
        body('dddddddddddddddd'),
        '  f' + 'd' + 'e' * 16 + 'd' + 'f  ',
        '  ' + 'f' * 20 + '  ',
    ])
    return c


def hydroreed_filter():
    # A tall bundle of teal reeds with a grey cap and two brown ties
    c = Canvas(24, 24, {'t': '#275654', 'T': '#273456', 'L': '#2F756F', 'g': '#79746E', 'G': '#88948A', 'n': '#273456',
                        'b': '#8F6B5A', 'B': '#B68B74'})
    reeds = 'fLtTttTttTf'
    c.rows(6, 0, [
        '  ffffffff  ',
        ' fGgngngngf ',
        'fGgggggggggf',
        ' ' + reeds,
        ' ' + reeds,
        'fBBBBBBBBBBf',
        'fbbbbbbbbbbf',
        ' ' + reeds,
        ' ' + reeds,
        ' ' + reeds,
        ' ' + reeds,
        ' ' + reeds,
        ' ' + reeds,
        'fBBBBBBBBBBf',
        'fbbbbbbbbbbf',
        ' ' + reeds,
        ' ' + reeds,
        ' ' + reeds,
        ' ' + reeds,
        ' ' + reeds,
        '  fLtTttTf  ',
        '   ffffff   ',
    ])
    return c


HARVEST = {
    'nutrifruit': nutrifruit, 'kotton': kotton, 'kotton_fabric': kotton_fabric, 'dream_cap': dream_cap,
    'meal_cap': meal_cap, 'nightmare_cap': nightmare_cap, 'coffee_bean': coffee_bean, 'fillerweed': fillerweed,
    'bloomberry': bloomberry, 'hydroreed_seed': hydroreed_seed, 'hydroreed_filter': hydroreed_filter,
}


if __name__ == '__main__':
    # Writes public/machines/<name>.svg and public/harvest/<name>.svg. Run from grid-optimizer/: python scripts/draw-machines.py
    public = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
    for folder, icons in (('machines', MACHINES), ('harvest', HARVEST)):
        out_dir = os.path.join(public, folder)
        os.makedirs(out_dir, exist_ok=True)
        for name, draw in icons.items():
            with open(os.path.join(out_dir, name + '.svg'), 'w') as f:
                f.write(draw().svg())
        print(f'wrote {len(icons)} icons to {os.path.normpath(out_dir)}')
