#!/usr/bin/env python3
"""Map our workout library to Everkinetic exercise illustrations (CC BY-SA 4.0) and build the WebP assets.

Run (from anywhere):
  python3 -I scripts/ex-img/map_exercises.py --ek <path-to-everkinetic-clone> --fdb <path-to-free-exercise-db-clone> [--no-images]

Second source (fallback): free-exercise-db (https://github.com/yuhonas/free-exercise-db, public domain / Unlicense).
Used ONLY for exercises with no acceptable Everkinetic drawing (FDB_CURATED below, each pair checked by eye on a
contact sheet: same movement only). Photos <fdb>/exercises/<Id>/0.jpg (start) and 1.jpg (end) become
public/ex-img/fdb-<slug>-a.webp / -b.webp: grayscale, gentle contrast (autocontrast + lifted blacks so they sit
next to the line drawings), fit inside 360x360 (never upscaled), WebP q65 (lower if > 14 KB).

What it does
  1. Parses src/features/workout/exercises.js (LIBRARY rows) + the PLANNED additions below.
  2. Reads every <ek>/src/exercises/NNNN/NNNN.json (title, equipment, primary).
  3. Applies the CURATED table (each pair checked by eye against both drawings: same movement only).
     A token/equipment/muscle score is computed for every row as a cross-check and written to the CSV
     (auto_best = what pure text matching would have picked; it is NOT used for the decision).
  4. Writes scripts/ex-img/mapping.csv (reviewable) and rewrites the generated block in
     src/features/workout/exercise-images.js.
  5. Converts both positions of each mapped exercise to public/ex-img/<ekid>-a.webp (relaxation/start)
     and -b.webp (tension/end): fit inside a 360x360 box (never upscaled), grayscale, WebP q70 (falls back to lower q if > 12 KB).
"""
import argparse, csv, json, os, re, subprocess, sys

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
EX_JS = os.path.join(APP, 'src/features/workout/exercises.js')
IMG_JS = os.path.join(APP, 'src/features/workout/exercise-images.js')
OUT_DIR = os.path.join(APP, 'public/ex-img')
CSV_OUT = os.path.join(APP, 'scripts/ex-img/mapping.csv')
MAX_BYTES = 12 * 1024

# Planned additions that are not yet in LIBRARY: (id, ar, en, eq).
PLANNED = []  # all planned additions now live in LIBRARY (see PLANNED_EXISTING)
# The planned list as it now exists in LIBRARY:
PLANNED_EXISTING = {
    'Bayesian Cable Curl': 'exBAY', 'Hip Adduction Machine': 'exADD', 'Pallof Press': 'exPAL',
    'Cable Woodchop': 'exWC', 'Reverse Pec-Deck': 'exRPD', 'Seated Leg Curl': 'ex48', 'Hack Squat': 'ex45b',
    'Cable Lateral Raise': 'ex27', 'Overhead Cable Triceps Extension': 'exOCT', 'Incline DB Curl': 'ex31',
    'Chest-Supported T-Bar Row': 'exCSTB', 'Bulgarian Split Squat': 'ex42', 'Hip Thrust': 'ex46',
    'Hanging Leg Raise': 'ex65', 'Cable Crunch': 'ex62', 'Ab Wheel': 'ex64', 'Standing Calf Raise': 'ex51',
    'Seated Calf Raise': 'ex52', 'Wrist Curl': 'ex81', 'Face Pull': 'ex24', 'Rope Pushdown': 'ex36',
}

# our id -> (ek id, confidence, note).  high = same movement, same implement and posture.
# medium = same movement, minor difference (implement or grip/support detail) noted.
CURATED = {
    'ex1': ('0042', 'high', ''), 'ex2': ('0061', 'high', ''), 'ex3': ('0051', 'high', ''),
    'exFDP': ('0055', 'high', ''), 'exMDP': ('0085', 'high', 'decline chest press machine'),
    'ex4': ('0048', 'high', ''), 'ex5': ('0056', 'high', ''), 'ex6': ('0077', 'high', ''), 'ex7': ('0054', 'high', ''),
    'ex11': ('0099', 'high', ''), 'ex12': ('0087', 'high', ''),
    'exWPU': ('0087', 'medium', 'same pull-up; drawing has no added weight'),
    'ex15': ('0025', 'high', ''), 'ex16': ('0029', 'high', 'standing T-bar row'),
    'ex17': ('0024', 'medium', 'EK title says rear-delt row but drawing/steps are the 1-arm bench-supported DB row'),
    'ex18': ('0092', 'high', ''), 'ex20': ('0103', 'high', ''),
    'ex23': ('0018', 'high', ''), 'ex28': ('0014', 'high', ''),
    'ex25': ('0032', 'medium', 'bent-over rear-delt raise, head supported on bench'),
    'ex29': ('0211', 'high', ''), 'ex34b': ('0226', 'high', ''), 'ex30': ('0227', 'high', ''),
    'ex31': ('0214', 'high', 'alternating arms'), 'ex32': ('0236', 'high', 'machine preacher'),
    'ex33': ('0212', 'high', ''), 'ex34': ('0220', 'high', ''), 'exSPC': ('0225', 'high', 'prone incline DB curl = spider curl'),
    'ex35': ('0049', 'high', ''), 'ex36': ('0206', 'high', ''), 'ex40': ('0205', 'high', ''),
    'ex37': ('0198', 'high', 'standing two-hand DB'), 'ex38': ('0183', 'high', 'lying barbell triceps press'),
    'exOCT': ('0177', 'medium', 'kneeling overhead cable extension (elbows on bench)'),
    'ex39': ('0172', 'high', ''),
    'ex82': ('0257', 'medium', 'reverse curl shown with dumbbells (ours: bar)'),
    'ex71': ('0030', 'high', ''), 'ex72': ('0005', 'high', ''),
    'ex41': ('0122', 'high', ''), 'ex41b': ('0138', 'high', ''), 'ex45b': ('0123', 'high', ''), 'ex43': ('0127', 'high', ''),
    'ex42': ('0147', 'medium', 'rear-foot-elevated split squat with barbell (ours: DB)'),
    'ex44': ('0142', 'high', ''), 'ex47': ('0118', 'high', ''), 'ex45': ('0117', 'high', ''), 'ex48': ('0119', 'high', ''),
    'ex46b': ('0112', 'high', ''),
    'ex51': ('0282', 'high', ''), 'ex52': ('0279', 'high', ''),
    'ex62': ('0288', 'medium', 'seated (not kneeling) rope cable crunch'),
    'ex63': ('0021', 'high', 'lying leg raise'),
    'ex64': ('0286', 'medium', 'kneeling rollout with a barbell instead of a wheel'),
    'exADD': ('0157', 'high', 'thigh adductor machine'),
    'exLID': ('0061', 'medium', 'incline DB press; drawing is a steeper incline than our 15° low incline'),
}
# Eccentric-first lifts: the movement STARTS in the contracted ("tension") drawing, so -a.webp (start) is built
# from tension and -b.webp (end) from relaxation. Everything else starts at relaxation.
SWAP = {'ex1', 'ex2', 'exLID', 'ex3', 'exFDP', 'ex35', 'ex5', 'ex6', 'ex7', 'ex39', 'ex38', 'ex37',
        'ex41', 'ex41b', 'ex45b', 'ex43', 'ex42', 'ex47'}
# Checked and rejected (closest EK candidate shows a different movement or has no drawing).
REJECTED = {
    'ex8': '0047 butterfly machine has no drawing in the repo',
    'ex9': 'no landmine press', 'ex13': '0298 has no drawing; 0026 is reverse (underhand) grip',
    'ex14': '0097 wide-grip pulldown has no drawing; 0093/0095 are underhand close grip',
    'exCSTB': '0029 is standing, not chest-supported', 'ex21': '0004 is seated, ours is standing',
    'ex22': '0012 has no drawing; 0038 is one-arm standing', 'ex26': '0006 has no drawing',
    'ex27': '0017 is a bent-over rear-delt cable raise', 'ex24': 'no face pull', 'exRPD': 'no reverse pec-deck',
    'ex81': 'no wrist curl', 'exFW': 'no farmers walk', 'ex49': 'no nordic curl', 'ex50': 'no glute-ham raise',
    'ex46': '0109 is a floor glute bridge, not a bench hip thrust', 'ex46c': 'no sumo deadlift',
    'ex46d': '0111 is a standing leg kick, not quadruped', 'ex53': 'no single-leg standing calf raise',
    'ex61': 'only side plank (0113)', 'exWPL': 'only side plank (0113)', 'ex65': 'no hanging leg raise',
    'ex66': 'no russian twist', 'exWC': 'no woodchop',
    'exBAY': '0247 faces the stack (not behind-body Bayesian)', 'exPAL': 'no pallof press',
    'exWCH': 'no woodchop', 'exRWC': 'no reverse wrist curl', 'exMHT': '0109 is a floor glute bridge',
    'exNECK': '0001 is an isometric hand-resisted hold, ours is a loaded dynamic movement',
}

# Fallback: our id -> (free-exercise-db id, confidence, note). Only ids with no acceptable EK drawing.
FDB_CURATED = {
    'ex8': ('Butterfly', 'high', 'pec-deck machine'),
    'ex13': ('Bent_Over_Barbell_Row', 'high', 'overhand bent-over barbell row'),
    'ex14': ('Wide-Grip_Lat_Pulldown', 'high', 'wide overhand grip to the front'),
    'exCSTB': ('Lying_T-Bar_Row', 'high', 'chest-supported T-bar machine'),
    'ex21': ('Standing_Military_Press', 'high', 'standing barbell press'),
    'ex22': ('Dumbbell_Shoulder_Press', 'high', 'seated DB press'),
    'ex26': ('Arnold_Dumbbell_Press', 'high', ''),
    'ex27': ('Lateral_Raise_-_With_Bands', 'medium', 'standing two-arm lateral raise with bands (ours: cable), same line of pull from below'),
    'ex24': ('Face_Pull', 'high', 'rope to the face, high pulley'),
    'exRPD': ('Reverse_Machine_Flyes', 'high', 'rear-delt machine fly'),
    'ex81': ('Seated_Palm-Up_Barbell_Wrist_Curl', 'high', 'seated, forearms on thighs'),
    'exRWC': ('Seated_Palms-Down_Barbell_Wrist_Curl', 'high', 'seated, forearms on thighs'),
    'exFW': ('Farmers_Walk', 'medium', 'farmer handles instead of dumbbells; start photo is the pick-up'),
    'ex49': ('Natural_Glute_Ham_Raise', 'high', 'nordic curl, ankles anchored under a pad'),
    'ex50': ('Glute_Ham_Raise', 'high', 'GHD machine, starts from the bottom'),
    'ex46': ('Barbell_Hip_Thrust', 'high', 'upper back on bench'),
    'exMHT': ('Barbell_Hip_Thrust', 'medium', 'free barbell instead of Smith/machine; same hip thrust'),
    'ex46c': ('Sumo_Deadlift', 'high', ''),
    'ex46d': ('Glute_Kickback', 'high', 'quadruped kickback on the floor'),
    'ex61': ('Plank', 'medium', 'start photo is the kneeling set-up, end is the plank hold'),
    'exWPL': ('Plank', 'medium', 'plain forearm plank (no plate shown)'),
    'ex65': ('Hanging_Leg_Raise', 'medium', 'photo shows bent-knee raise from a bar'),
    'ex66': ('Russian_Twist', 'high', 'with a plate'),
    'exWC': ('Standing_Cable_Wood_Chop', 'high', 'high-to-low chop'),
    'exWCH': ('Standing_Cable_Wood_Chop', 'high', 'high-to-low chop'),
    'exPAL': ('Pallof_Press', 'medium', 'end photo is a close-up of the press-out'),
    'exROE': ('Cable_Rope_Overhead_Triceps_Extension', 'high', 'standing, facing away from the low pulley, rope overhead'),
    'exNECK': ('Lying_Face_Up_Plate_Neck_Resistance', 'medium', 'plate-loaded neck flexion on a bench (extension is the face-down version)'),
}
# fedb photos whose order is reversed for our start/end (0.jpg shows the end position).
FDB_SWAP = {'Butterfly'}
# Checked in free-exercise-db too and still rejected.
FDB_REJECTED = {
    'ex9': 'fedb Landmine_Linear_Jammer is a squat-to-press jammer, not a landmine press',
    'ex53': 'fedb calf raises are two-legged (Calf_Raise_On_A_Dumbbell, Standing_Dumbbell_Calf_Raise)',
    'exBAY': 'fedb Standing_One-Arm_Cable_Curl faces the stack (not behind-body Bayesian)',
}
FDB_MAX_BYTES = 14 * 1024

EQ = {'بار': {'barbell', 'bar'}, 'دمبل': {'dumbbell', 'dumbbells'}, 'كابل': {'cable'}, 'جهاز': {'machine'},
      'وزن جسم': {'body'}, 'أداة': set()}
STOP = {'with', 'the', 'a', 'on', 'of', 'and', 'to', 'using', 'db', 'barbell', 'dumbbell', 'dumbbells', 'cable', 'machine'}


def toks(s):
    return {t for t in re.findall(r'[a-z]+', s.lower().replace('-', ' ')) if t not in STOP and len(t) > 1}


def parse_library():
    src = open(EX_JS, encoding='utf-8').read()
    rows = re.findall(r"\{ id: '([^']+)', ar: '([^']+)', en: '([^']+)', muscle: '([^']+)', kind: '[^']+', eq: '([^']+)' \}", src)
    return [dict(id=i, ar=a, en=e, eq=q) for i, a, e, m, q in rows]


def load_ek(ek):
    out = {}
    base = os.path.join(ek, 'src/exercises')
    for d in sorted(os.listdir(base)):
        j = os.path.join(base, d, f'{d}.json')
        if not os.path.isfile(j):
            continue
        meta = json.load(open(j, encoding='utf-8'))
        png = all(os.path.isfile(os.path.join(base, d, f'{d}-{p}.png')) for p in ('relaxation', 'tension'))
        out[d] = dict(title=meta['title'].strip(), eq=set(meta.get('equipment', [])), png=png, dir=os.path.join(base, d))
    return out


def auto_best(ex, ek):
    t = toks(ex['en'])
    best, score = None, 0.0
    for k, m in ek.items():
        if not m['png']:
            continue
        mt = toks(m['title'])
        s = len(t & mt) / max(1, len(t | mt)) + (0.25 if EQ.get(ex['eq'], set()) & {e.split(':')[0] for e in m['eq']} else 0)
        if s > score:
            best, score = k, s
    return best, round(score, 2)


def encode(src, dst):
    for q in (70, 60, 50, 40):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vf', "scale='min(360,iw)':'min(360,ih)':force_original_aspect_ratio=decrease:flags=lanczos,format=gray",
                        '-c:v', 'libwebp', '-quality', str(q), '-compression_level', '6', '-metadata', 'comment=Everkinetic CC BY-SA 4.0', dst], check=True)
        if os.path.getsize(dst) <= MAX_BYTES:
            break
    return os.path.getsize(dst)


def fdb_slug(fid):
    return 'fdb-' + re.sub(r'[^a-z0-9]+', '-', fid.lower()).strip('-')


def load_fdb(fdb):
    out = {}
    for fid in {v[0] for v in FDB_CURATED.values()}:
        d = os.path.join(fdb, 'exercises', fid)
        meta = json.load(open(os.path.join(fdb, 'exercises', f'{fid}.json'), encoding='utf-8'))
        assert all(os.path.isfile(os.path.join(d, f'{i}.jpg')) for i in (0, 1)), f'{fid} has no 0/1.jpg'
        out[fid] = dict(title=meta['name'], dir=d)
    return out


def encode_photo(src, dst):
    """Photo -> grayscale, gentle contrast, fit 360x360 (no upscale), WebP <= FDB_MAX_BYTES."""
    from PIL import Image, ImageOps  # only needed when building fedb images
    im = ImageOps.exif_transpose(Image.open(src)).convert('L')
    im = ImageOps.autocontrast(im, cutoff=1)
    im = im.point(lambda v: int(30 + v * 0.86))  # lift blacks a little, keep whites: softer next to line art
    im.thumbnail((360, 360), Image.LANCZOS)  # thumbnail never upscales
    for q in (65, 58, 50, 42, 35):
        im.save(dst, 'WEBP', quality=q, method=6)
        if os.path.getsize(dst) <= FDB_MAX_BYTES:
            break
    return os.path.getsize(dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ek', required=True)
    ap.add_argument('--fdb', required=True, help='free-exercise-db clone (fallback photos)')
    ap.add_argument('--no-images', action='store_true')
    a = ap.parse_args()
    lib = parse_library()
    n_rows = len(re.findall(r"^\s*\{ id: '", open(EX_JS, encoding='utf-8').read().split('export const LIBRARY')[1].split('];')[0], re.M))
    assert len(lib) == n_rows >= 77, f'parsed {len(lib)} of {n_rows} LIBRARY rows'
    for v in PLANNED_EXISTING.values():
        assert v in {r['id'] for r in lib}, f'planned id {v} missing'
    ek = load_ek(a.ek)
    rows_in = lib + [dict(id=i, ar=ar, en=en, eq=q) for i, ar, en, q in PLANNED]
    known = {r['id'] for r in rows_in}
    for k in list(CURATED) + list(REJECTED) + list(FDB_CURATED) + list(FDB_REJECTED):
        assert k in known, f'unknown id {k}'
    assert not set(CURATED) & set(FDB_CURATED), 'an id is mapped to both sources'
    fdb = load_fdb(a.fdb)
    out, unmapped, mapping = [], [], {}  # mapping: our id -> (source, image key)
    for ex in rows_in:
        ab, sc = auto_best(ex, ek)
        auto = [ab, ek[ab]['title'] if ab else '', sc]
        if ex['id'] in CURATED:
            eid, conf, note = CURATED[ex['id']]
            assert ek[eid]['png'], f'{eid} has no PNGs'
            mapping[ex['id']] = ('ek', eid + ('s' if ex['id'] in SWAP else ''))
            out.append([ex['id'], ex['ar'], ex['en'], 'everkinetic', eid, ek[eid]['title'], conf, 'tension' if ex['id'] in SWAP else 'relaxation', note] + auto)
        elif ex['id'] in FDB_CURATED:
            fid, conf, note = FDB_CURATED[ex['id']]
            mapping[ex['id']] = ('fdb', fdb_slug(fid))
            ek_why = REJECTED.get(ex['id'], 'no same-movement drawing')
            out.append([ex['id'], ex['ar'], ex['en'], 'free-exercise-db', fid, fdb[fid]['title'], conf, '1.jpg' if fid in FDB_SWAP else '0.jpg',
                        f'{note}{"; " if note else ""}EK rejected: {ek_why}'] + auto)
        else:
            reason = REJECTED.get(ex['id'], 'no same-movement drawing')
            if ex['id'] in FDB_REJECTED:
                reason += '; ' + FDB_REJECTED[ex['id']]
            unmapped.append((ex['id'], ex['en'], reason))
            out.append([ex['id'], ex['ar'], ex['en'], '', '', '', 'unmapped', '', reason] + auto)
    with open(CSV_OUT, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['our_id', 'our_ar', 'our_en', 'source', 'src_id', 'src_title', 'confidence', 'start_image', 'note', 'auto_best_ek', 'auto_best_title', 'auto_score'])
        w.writerows(out)

    # generated block in exercise-images.js
    js = open(IMG_JS, encoding='utf-8').read()
    body = ',\n'.join(f"  '{k}': ['{s}', '{v}']" for k, (s, v) in mapping.items())
    gen = ('// @generated by scripts/ex-img/map_exercises.py: our exercise id -> [source, image key]\n'
           "// source 'ek' = Everkinetic (CC BY-SA 4.0), 'fdb' = free-exercise-db (public domain)\n"
           f'const MAP = {{\n{body},\n}};\n')
    js2 = re.sub(r'// >>> ex-img map.*?// <<< ex-img map', f'// >>> ex-img map\n{gen}// <<< ex-img map', js, flags=re.S)
    assert js2 != js or gen in js, 'marker block not found in exercise-images.js'
    open(IMG_JS, 'w', encoding='utf-8').write(js2)

    total = {'ek': 0, 'fdb': 0}
    keys = sorted(set(mapping.values()))
    if not a.no_images:
        os.makedirs(OUT_DIR, exist_ok=True)
        fdb_by_slug = {fdb_slug(f): f for f, *_ in FDB_CURATED.values()}
        for src, key in keys:
            if src == 'ek':
                eid = key[:4]; d = ek[eid]['dir']
                first, second = ('tension', 'relaxation') if key.endswith('s') else ('relaxation', 'tension')
                total['ek'] += encode(os.path.join(d, f'{eid}-{first}.png'), os.path.join(OUT_DIR, f'{key}-a.webp'))
                total['ek'] += encode(os.path.join(d, f'{eid}-{second}.png'), os.path.join(OUT_DIR, f'{key}-b.webp'))
            else:
                fid = fdb_by_slug[key]; d = fdb[fid]['dir']
                first, second = ('1', '0') if fid in FDB_SWAP else ('0', '1')
                total['fdb'] += encode_photo(os.path.join(d, f'{first}.jpg'), os.path.join(OUT_DIR, f'{key}-a.webp'))
                total['fdb'] += encode_photo(os.path.join(d, f'{second}.jpg'), os.path.join(OUT_DIR, f'{key}-b.webp'))
        keep = {f'{k}-{p}.webp' for _, k in keys for p in 'ab'} | {'LICENSE.txt'}
        for f in os.listdir(OUT_DIR):
            if f not in keep:
                os.remove(os.path.join(OUT_DIR, f))
    n_ek = sum(1 for s, _ in keys if s == 'ek')
    print(f'library mapped {len(mapping)}/{len(rows_in)} '
          f'(ek {sum(1 for s, _ in mapping.values() if s == "ek")}, fdb {sum(1 for s, _ in mapping.values() if s == "fdb")}), '
          f'images ek {n_ek} x2 = {total["ek"]/1024:.1f} KB, fdb {len(keys) - n_ek} x2 = {total["fdb"]/1024:.1f} KB')
    print('unmapped:', ', '.join(f'{i} ({e})' for i, e, _ in unmapped))


if __name__ == '__main__':
    sys.exit(main())
