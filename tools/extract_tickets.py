"""Exam tickets ABM: questions, answers, correct answer, images, and the PDD points/signs referenced in the
book's comment for each answer. The commentary text itself is not exported (publisher's copyright)."""
import glob, json, os, re, sys
import pymupdf

src = sorted(glob.glob('D:/Razbor/Torrent/Новая папка/Правила дорожного движения РФ/*.pdf'))[2]
out_json, out_img = sys.argv[1], sys.argv[2]
os.makedirs(out_img, exist_ok=True)
doc = pymupdf.open(src)

def clean(t):
    t = t.replace('\u00ad', '').replace('\xa0', ' ')
    t = re.sub(r'-\s*\n\s*(?=[а-яё])', '', t)
    t = re.sub(r'\s+', ' ', t)
    return t.strip()

def split_answers(t):
    # «1. ... 2. ... 3. ...» — numbered options in order.
    parts, n, pos = [], 1, 0
    idx = []
    for m in re.finditer(r'(?:(?<=\s)|^)(\d)\.\s', t):
        if int(m.group(1)) == n:
            idx.append((m.start(), m.end())); n += 1
    for i, (s, e) in enumerate(idx):
        end = idx[i + 1][0] if i + 1 < len(idx) else len(t)
        parts.append(t[e:end].strip())
    return parts

questions, answers, refs = {}, {}, {}
ticket = None
for pno in range(doc.page_count):
    page = doc[pno]
    text = page.get_text()
    m = re.search(r'БИЛЕТ\s+(\d+)', text)
    if not m:
        continue
    ticket = int(m.group(1))
    if 'Ответы с комментариями' in text or 'Правильный ответ' in text:
        # Answers: «N Правильный ответ — K» then a comment until the next one.
        body = text
        items = list(re.finditer(r'(?m)^\s*(\d{1,2})\s+Правильный ответ\s*[—-]\s*(\d)', body))
        for i, it in enumerate(items):
            n, k = int(it.group(1)), int(it.group(2))
            comment = body[it.end(): items[i + 1].start() if i + 1 < len(items) else len(body)]
            answers[(ticket, n)] = k
            pts = set(re.findall(r'п(?:\.|ункт[а-я]*)\s*(\d{1,2}\.\d{1,2}(?:\(\d\))?)', comment))
            pts |= set(re.findall(r'пункт(?:ом|а|е|у)?\s+(\d{1,2}\.\d{1,2})', comment))
            sg = set(re.findall(r'знак[а-я]*\s+(\d\.\d{1,2}(?:\.\d{1,2})?)', comment))
            mk = set(re.findall(r'разметк[а-я]*\s+(1\.\d{1,2}(?:\.\d)?)', comment))
            prev = refs.get((ticket, n), {'points': set(), 'signs': set(), 'marks': set()})
            prev['points'] |= pts; prev['signs'] |= sg; prev['marks'] |= mk
            refs[(ticket, n)] = prev
        continue
    # Question page: five slots, each ending at a question number label at the right edge.
    blocks = page.get_text('blocks')
    labels = sorted([(b[1], int(b[4].strip())) for b in blocks if re.fullmatch(r'\s*\d{1,2}\s*', b[4]) and b[0] > 480], key=lambda x: x[0])
    # Number labels sit at the bottom right of each slot; a label printed twice counts once.
    seen = set(); labels = [l for l in labels if 1 <= l[1] <= 20 and not (l[1] in seen or seen.add(l[1]))]
    images = []
    for img in page.get_images(full=True):
        for r in page.get_image_rects(img[0]):
            images.append((r, img[0]))
    top = 40
    for y, n in labels:
        lo, hi = top, y + 14
        top = y + 14
        slot = [b for b in blocks if lo <= b[1] < hi and not re.fullmatch(r'\s*\d{1,2}\s*', b[4]) and b[1] > 40]  # the running header sits above y = 40
        slot.sort(key=lambda b: (b[1], b[0]))
        raw = clean(' '.join(b[4] for b in slot))
        first = re.search(r'(?:(?<=\s)|^)1\.\s', raw)
        q = raw[:first.start()].strip() if first else raw
        opts = split_answers(raw[first.start():]) if first else []
        img_file = None
        for r, xref in images:
            cy = (r.y0 + r.y1) / 2
            if lo <= cy < hi:
                pix = pymupdf.Pixmap(doc, xref)
                if pix.n - pix.alpha >= 4: pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                img_file = f'{ticket}-{n}.jpg'
                with open(os.path.join(out_img, img_file), 'wb') as fh: fh.write(pix.tobytes('jpeg', jpg_quality=72))
                break
        questions[(ticket, n)] = {'text': q, 'answers': opts, 'image': img_file}

data = []
problems = []
for t in range(1, 41):
    for n in range(1, 21):
        q = questions.get((t, n)); a = answers.get((t, n)); r = refs.get((t, n), {'points': set(), 'signs': set(), 'marks': set()})
        if not q or not a or not (2 <= len(q['answers']) <= 5) or a > len(q['answers']):
            problems.append((t, n, bool(q), a, len(q['answers']) if q else 0, (q or {}).get('text', '')[:60]))
        data.append({'id': f'{t}-{n}', 'ticket': t, 'number': n, 'question': q['text'] if q else '', 'answers': q['answers'] if q else [], 'correct': (a or 1) - 1,
                     'image': q['image'] if q else None, 'points': sorted(r['points'], key=lambda s: [int(x) for x in re.findall(r'\d+', s)]), 'signs': sorted(r['signs']), 'marks': sorted(r['marks'])})
json.dump({'source': 'Экзаменационные билеты категорий A, B, M, подкатегорий A1, B1 (2024)', 'questions': data}, open(out_json, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('questions', len(questions), 'answers', len(answers), 'images', sum(1 for q in questions.values() if q['image']), 'problems', len(problems))
for p in problems[:30]: print('  ', p)
