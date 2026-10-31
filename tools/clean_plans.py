"""Puhastab TUBE põhiplaanid veebi jaoks.

- Peidab PDF-i kihid: mõõtmed, lõikemärgid, teljestik, annotatsioonid, sisemised mõõdukettad.
- Eemaldab kogu PDF-i teksti (ukse-/akna tähised, mõõdud, kirjanurk) ja joonistab ruumide nimed
  eesti keeles ja pindalad uuesti.
- Lisab ainult gabariitmõõdud (seinte välismõõt) ja üldpinna.
Väljund: tube-assets/plans/tube-0M-SIZE.webp + plans.json
"""
import json, re, subprocess, sys, tempfile, os
from pathlib import Path
import pikepdf, pdfplumber
from PIL import Image, ImageDraw, ImageFont

SRC = Path(sys.argv[1]); OUT = Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
DPI = 220
HIDE = ('Dimensioning', 'Marker', 'Structural - Grid', 'Annotation', 'Interior - Partition', '2D Drafting')
ET = {'Bathroom': 'Vannituba', 'Living room': 'Elutuba', 'Tech. r': 'Tehnoruum', 'Kitchen': 'Köök', 'Wardrobe': 'Garderoob',
      'Vestibule': 'Esik', 'Hallway': 'Koridor', 'Wc': 'WC', 'Wc 1': 'WC', 'Laundry/Storage': 'Pesuruum'}
SIZES = ['89,7', '109,7', '123,4']
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
for cand in ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf']:
    if os.path.exists(cand): FONT_B = cand; FONT = cand.replace('-Bold', '-Regular')

def et_name(n):
    if n in ET: return ET[n]
    m = re.match(r'(Bedroom|Terrace) (\d)', n)
    if m: return ('Magamistuba ' if m[1] == 'Bedroom' else 'Terrass ') + m[2]
    return n

def strip_text(content: bytes) -> bytes:
    """Eemalda kõik BT…ET plokid sisuvoost."""
    return re.sub(rb'\bBT\b.*?\bET\b', b'', content, flags=re.S)

def prepare(src, dst, hide):
    pdf = pikepdf.open(src)
    oc = pdf.Root.OCProperties
    off = [o for o in oc.OCGs if any(str(o.Name).strip().startswith(h) for h in hide)]
    oc.D.OFF = pikepdf.Array(off)
    if '/ON' in oc.D: del oc.D['/ON']
    page = pdf.pages[0]
    data = page.obj.Contents.read_bytes() if not isinstance(page.obj.Contents, pikepdf.Array) else b'\n'.join(c.read_bytes() for c in page.obj.Contents)
    page.obj.Contents = pdf.make_stream(strip_text(data))
    for name, xo in (page.Resources.get('/XObject') or {}).items():
        if xo.get('/Subtype') == '/Form': xo.write(strip_text(xo.read_bytes()))
    pdf.save(dst)

def render(pdf, dpi):
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(['pdftoppm', '-r', str(dpi), '-png', '-singlefile', pdf, f'{d}/p'], check=True)
        return Image.open(f'{d}/p.png').convert('RGB')

def bbox_dark(img, region, thr=90, color_ok=None):
    """Tumedate pikslite piirid (px) antud regioonis."""
    x0, y0, x1, y1 = region
    g = img.crop(region).convert('L').point(lambda v: 255 if v < thr else 0)
    b = g.getbbox()
    return (b[0] + x0, b[1] + y0, b[2] + x0, b[3] + y0) if b else None

def fmt_mm(v): return f'{v / 1000:.2f} m'.replace('.', ',')

meta = {}
for f in sorted(SRC.glob('m*-s*.pdf')):
    m, s = re.match(r'm(\d)-s(\d)', f.stem).groups()
    m, s = int(m), int(s)
    pl = pdfplumber.open(f).pages[0]
    W, H = float(pl.width), float(pl.height)
    k = DPI / 72
    words = pl.extract_words(extra_attrs=['fontname', 'size', 'non_stroking_color'], keep_blank_chars=True, x_tolerance=1.5)
    red = [w for w in words if w['x0'] < 930 and str(w['non_stroking_color']).startswith('(0.50196')]
    rooms = []
    for w in red:
        if not re.search('[A-Za-z]{2}', w['text']): continue
        below = [a for a in red if re.match(r'^\d+,\d', a['text']) and 0 < a['top'] - w['top'] < 14 and abs((a['x0'] + a['x1']) / 2 - (w['x0'] + w['x1']) / 2) < 40]
        below.sort(key=lambda a: abs((a['x0'] + a['x1']) / 2 - (w['x0'] + w['x1']) / 2) + abs(a['top'] - w['top'] - 8))
        area = below[0]['text'].split()[0] if below else ''
        rooms.append({'name': w['text'], 'et': et_name(w['text']), 'area': area, 'cx': (w['x0'] + w['x1']) / 2, 'top': w['top']})
    # Dimension values (horizontal) for snapping overall size
    dimnums = set()
    for w in words:
        t = w['text'].replace(' ', '')
        if re.fullmatch(r'\d{4,5}', t): dimnums.add(int(t))
    # vertical rotated numbers: join chars by column
    cols = {}
    for c in pl.chars:
        if not c.get('upright', True) and c['text'].strip():
            cols.setdefault(round(c['x0']), []).append(c)
    for x, cs in cols.items():
        cs.sort(key=lambda c: -c['top'])
        s_ = ''.join(c['text'] for c in cs).replace(' ', '')
        for mm in re.findall(r'\d{4,5}', s_): dimnums.add(int(mm))
        cs.sort(key=lambda c: c['top'])
        s_ = ''.join(c['text'] for c in cs).replace(' ', '')
        for mm in re.findall(r'\d{4,5}', s_): dimnums.add(int(mm))

    with tempfile.TemporaryDirectory() as d:
        clean = f'{d}/clean.pdf'; walls = f'{d}/walls.pdf'
        prepare(f, clean, HIDE)
        prepare(f, walls, HIDE + ('Model Unit', 'Interior', 'Structural - Grid'))
        img = render(clean, DPI)
        wimg = render(walls, DPI)
    region = (int(62 * k), int(36 * k), int(925 * k), int(805 * k))
    draw_bb = bbox_dark(img, region, thr=200)
    # Seinad: välisseina pinnad on read/veerud, kus tume joon katab suurema osa hoone ulatusest.
    import numpy as np
    from PIL import ImageFilter
    ga = np.array(wimg.crop(region).convert('L').filter(ImageFilter.MinFilter(9))) < 120
    ys_, xs_ = np.nonzero(ga)
    bx0, bx1, by0, by1 = xs_.min(), xs_.max(), ys_.min(), ys_.max()
    rowcov = ga[:, bx0:bx1 + 1].mean(axis=1)
    rows = np.nonzero(rowcov > 0.8)[0]
    Y0w, Y1w = rows.min(), rows.max()
    colcov = ga[Y0w:Y1w + 1, :].mean(axis=0)
    cols_ = np.nonzero(colcov > 0.8)[0]
    X0w, X1w = cols_.min(), cols_.max()
    d4 = 4  # MinFilter(9) laiendab tumedat 4 px igas suunas
    wb = (X0w + d4 + region[0], Y0w + d4 + region[1], X1w - d4 + region[0], Y1w - d4 + region[1])
    mm_per_px = 25.4 / DPI * 100  # 1:100
    raw_w = (wb[2] - wb[0]) * mm_per_px; raw_h = (wb[3] - wb[1]) * mm_per_px
    def snap(v):
        c = [n for n in dimnums if abs(n - v) <= 80]
        return min(c, key=lambda n: abs(n - v)) if c else int(round(v / 10) * 10)
    gw, gh = snap(raw_w), snap(raw_h)
    heated = [r for r in rooms if not r['name'].startswith('Terrace') and r['area']]
    total = sum(float(r['area'].replace(',', '.')) for r in heated)
    terr = sum(float(r['area'].replace(',', '.')) for r in rooms if r['name'].startswith('Terrace') and r['area'])

    # Crop with margin for our dimension lines
    pad = int(70 * k / 3.0 * 1.3)
    cx0, cy0, cx1, cy1 = draw_bb[0] - pad, draw_bb[1] - pad, draw_bb[2] + int(pad * 1.6), draw_bb[3] + int(pad * 1.9)
    out = img.crop((cx0, cy0, cx1, cy1))
    dr = ImageDraw.Draw(out)
    fb = ImageFont.truetype(FONT_B, int(6.6 * k)); fa = ImageFont.truetype(FONT, int(6.3 * k)); fd = ImageFont.truetype(FONT_B, int(8.5 * k))
    ink = (34, 33, 31); red_c = (128, 64, 64)
    boxes = []
    for r in rooms:
        x = (r['cx']) * k - cx0; y = r['top'] * k - cy0
        tw = dr.textlength(r['et'], font=fb); at = (r['area'] + ' m²') if r['area'] else ''
        aw = dr.textlength(at, font=fa)
        bw = max(tw, aw) + 8; bh = (fb.size + fa.size) * 1.22
        boxes.append((x, y, tw, aw, bw, bh, r, at))
    for x, y, tw, aw, bw, bh, r, at in boxes:
        dr.rectangle((x - bw / 2, y - 2, x + bw / 2, y + bh), fill=(255, 255, 255))
    for x, y, tw, aw, bw, bh, r, at in boxes:
        dr.text((x - tw / 2, y), r['et'], font=fb, fill=red_c)
        if at: dr.text((x - aw / 2, y + fb.size * 1.22), at, font=fa, fill=ink)
    # Gabariitmõõdud: all (laius) ja paremal (sügavus)
    X0, Y0, X1, Y1 = wb[0] - cx0, wb[1] - cy0, wb[2] - cx0, wb[3] - cy0
    by = (draw_bb[3] - cy0) + int(pad * 0.9)
    rx = (draw_bb[2] - cx0) + int(pad * 0.9)
    lw = max(2, int(k * 0.6)); t = int(k * 2.2)
    dr.line((X0, by, X1, by), fill=ink, width=lw)
    for xx in (X0, X1):
        dr.line((xx, by - t * 2, xx, by + t * 2), fill=ink, width=lw)
        dr.line((xx - t, by + t, xx + t, by - t), fill=ink, width=lw * 2)
        dr.line((xx, Y1 + t * 2, xx, by + t * 2), fill=(150, 150, 150), width=max(1, lw // 2))
    txt = fmt_mm(gw); tw = dr.textlength(txt, font=fd)
    dr.text(((X0 + X1) / 2 - tw / 2, by - fd.size * 1.5), txt, font=fd, fill=ink)
    dr.line((rx, Y0, rx, Y1), fill=ink, width=lw)
    for yy in (Y0, Y1):
        dr.line((rx - t * 2, yy, rx + t * 2, yy), fill=ink, width=lw)
        dr.line((rx - t, yy + t, rx + t, yy - t), fill=ink, width=lw * 2)
        dr.line((X1 + t * 2, yy, rx + t * 2, yy), fill=(150, 150, 150), width=max(1, lw // 2))
    txt = fmt_mm(gh); tw = dr.textlength(txt, font=fd)
    timg = Image.new('RGBA', (int(tw) + 8, int(fd.size * 1.4)), (255, 255, 255, 0))
    ImageDraw.Draw(timg).text((4, 0), txt, font=fd, fill=ink)
    timg = timg.rotate(90, expand=True)
    out.paste(timg, (int(rx + t * 2), int((Y0 + Y1) / 2 - timg.height / 2)), timg)
    # Üldpind
    lab = f'Üldpind {SIZES[s - 1]} m²'
    dr.text((int(pad * 0.4), out.height - int(fd.size * 2.0)), lab, font=fd, fill=ink)
    out.thumbnail((2000, 2000), Image.LANCZOS)
    name = f'tube-0{m}-{SIZES[s-1].replace(",", "-")}'
    out.save(OUT / f'{name}.webp', 'WEBP', quality=88, method=6)
    meta[name] = {'model': m, 'size': SIZES[s - 1], 'gabarit_mm': [gw, gh], 'raw_mm': [round(raw_w), round(raw_h)],
                  'heated_sum': round(total, 1), 'terraces': round(terr, 1), 'rooms': [(r['et'], r['area']) for r in rooms],
                  'snapped': [gw in dimnums, gh in dimnums]}
    print(name, meta[name]['gabarit_mm'], meta[name]['raw_mm'], meta[name]['snapped'], 'sum', meta[name]['heated_sum'], 'terr', meta[name]['terraces'])
json.dump(meta, open(OUT / 'plans-report.json', 'w'), ensure_ascii=False, indent=1)
