"""Lisab TUBE renderitele päris inimeste väljalõiked (skalgubbar.se). Maja piksleid ei muudeta,
inimene + vari laotakse peale. Koordinaadid on 1600x900 eelvaate ruumis, arvutus täisresolutsioonis."""
import sys, os
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw

SP = sys.argv[1]
SRC = f'{SP}/dlandrea/all'
SK = f'{SP}/skal'
OUT = f'{SP}/people-out'
os.makedirs(OUT, exist_ok=True)
K = 2.4            # eelvaade -> täisresolutsioon (3840/1600)
HORIZON = 495      # eelvaate ruumis
CAM_H = 1.9        # kaamera kõrgus meetrites (kontrollitud ukse kõrgustega)

CUT = {
    'grill': 'skalgubbar_338_e_grilling_kebab_and_tomatoes-1.png',
    'flowers': 'skalgubbar_335_c_has_graduated.png',
    'couple': '358_S_and_L_on_picnic_with_baguette_hat_and_a_spoon.png',
    'dog': 'skalgubbar_181_k_walking_the_dog.png',
    'walker': 'skalgubbar_359_c_walking_to_buy_eclair_au_chocolat.png',
}
# (render, [(cutout, x_center, feet_y, height_m, flip, shadow_dir)])
SCENES = []
_PEOPLE = {
    '01': [('grill', 590, 702, 1.80, False, 1), ('walker', 1490, 850, 1.66, False, 1)],
    '02': [('couple', 300, 800, 1.80, False, 1)],
    '03': [('flowers', 1010, 832, 1.68, False, 1)],
    '04': [('dog', 330, 822, 1.82, False, 1)],
}
for _m, _ppl in _PEOPLE.items():
    for _s in ('89-7', '109-7', '123-4'):
        SCENES.append((f'tube-{_m}-{_s}-garden', _ppl))


def load_cut(name):
    im = Image.open(f'{SK}/{CUT[name]}').convert('RGBA')
    return im.crop(im.getchannel('A').point(lambda a: 255 if a > 20 else 0).getbbox())


def shadow_layer(person, direction):
    """Maapinnale langev vari: siluett lapikuks, kallutatud päikesest eemale, pehme."""
    w, h = person.size
    a = person.getchannel('A').transpose(Image.FLIP_TOP_BOTTOM)
    sh_h = max(2, int(h * 0.28))
    a = a.resize((w, sh_h))
    shear = 0.9 * direction
    pad = int(abs(shear) * sh_h) + 4
    a = a.transform((w + pad, sh_h), Image.AFFINE,
                    (1, shear, -pad if shear > 0 else 0, 0, 1, 0), resample=Image.BICUBIC)
    # vari on kõige tumedam jalgade juures (alumine serv)
    grad = Image.linear_gradient('L').resize((w + pad, sh_h))
    a = Image.composite(a, Image.new('L', a.size, 0), grad)
    return a.filter(ImageFilter.GaussianBlur(max(2, w // 60))).point(lambda v: int(v * 0.58)), pad if shear > 0 else 0


def compose(render, people):
    base = Image.open(f'{SRC}/{render}.jpg').convert('RGBA')
    for name, xc, fy, hm, flip, sdir in people:
        p = load_cut(name)
        if flip:
            p = p.transpose(Image.FLIP_LEFT_RIGHT)
        target_h = int((fy - HORIZON) * hm / CAM_H * K)
        p = p.resize((int(p.width * target_h / p.height), target_h), Image.LANCZOS)
        # foto -> render: veidi pehmem ja sobitatud kontrast, et ei "hüppaks" välja
        rgb = ImageEnhance.Color(p.convert('RGB')).enhance(0.92)
        rgb = ImageEnhance.Contrast(rgb).enhance(0.95).filter(ImageFilter.GaussianBlur(0.6))
        p = Image.merge('RGBA', (*rgb.split(), p.getchannel('A')))
        x = int(xc * K - p.width / 2)
        y = int(fy * K - p.height)
        # kontaktvari jalgade all
        cw, ch = int(p.width * 0.7), max(6, int(p.height * 0.035))
        cont = Image.new('L', (cw, ch), 0)
        ImageDraw.Draw(cont).ellipse((0, 0, cw - 1, ch - 1), fill=110)
        cont = cont.filter(ImageFilter.GaussianBlur(ch / 2.5))
        base.paste((0, 0, 0, 255), (int(xc * K - cw / 2), int(fy * K - ch / 2)), cont)
        sh, off = shadow_layer(p, sdir)
        base.paste((10, 20, 5, 255), (x - off + (0 if sdir > 0 else 0), int(fy * K) - sh.height), sh)
        base.alpha_composite(p, (x, y))
    out = base.convert('RGB')
    out.save(f'{OUT}/{render}.jpg', quality=92)
    prev = out.copy(); prev.thumbnail((1600, 1600), Image.LANCZOS)
    prev.save(f'{OUT}/{render}.webp', 'WEBP', quality=78, method=6)


for r, ppl in SCENES:
    compose(r, ppl)
print('ok')
