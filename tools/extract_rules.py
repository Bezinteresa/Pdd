"""Official PDD text (sections 1–27) from the rules book: only the 9.3–9.6 pt Pragmatica text is the rules;
8.5 pt text is the publisher's commentary and is skipped, as are figure captions (italic 8.5) and the appendices."""
import glob, json, re, sys
import pymupdf

src = sorted(glob.glob('D:/Razbor/Torrent/Новая папка/Правила дорожного движения РФ/*.pdf'))[1]
doc = pymupdf.open(src)
lines = []
for pno in range(doc.page_count):
    for block in doc[pno].get_text('dict')['blocks']:
        for line in block.get('lines', []):
            spans = [s for s in line['spans'] if s['text'].strip()]
            if not spans: continue
            # Official when most of the line is in the rules font; list bullets come in another font.
            is_rule = lambda s: s['font'].startswith('Pragmatica') and 'Cond' not in s['font'] and 9.2 <= s['size'] <= 9.6
            rule_chars = sum(len(s['text'].strip()) for s in spans if is_rule(s))
            total = sum(len(s['text'].strip()) for s in spans)
            main = max(spans, key=lambda s: len(s['text']))
            if rule_chars >= .6 * total:
                # A one-character span in a symbol font at the start is a list bullet.
                first = spans[0]
                text = ''.join(s['text'] for s in line['spans'])
                if not is_rule(first) and len(first['text'].strip()) == 1: text = '%' + text[text.index(first['text']) + len(first['text']):]
                lines.append((pno, text, 'Bold' in main['font'] and is_rule(main)))

sections, current, point = [], None, None
started = False
for pno, text, bold in lines:
    t = text.replace('\u00ad', '').replace('\xa0', ' ').rstrip()
    if bold and re.match(r'^\s*1\.\s+Общие положения', t): started = True
    if not started: continue
    if bold and re.match(r'^\s*(ПРИЛОЖЕНИЕ|Приложение|ОСНОВНЫЕ ПОЛОЖЕНИЯ|Основные положения по допуску)', t): break
    head = re.match(r'^\s*(\d{1,2})\.\s+([А-ЯЁ].*)$', t)
    pt = re.match(r'^\s*(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?(?:\(\d\))?)\.\s*(.*)$', t)
    if bold and head and not pt:
        # After section 27 the book prints other documents (КоАП, УК); their headings restart the numbering.
        if sections and int(head.group(1)) <= int(sections[-1]['id']): break
        current = {'id': head.group(1), 'title': head.group(2).strip(), 'points': [], 'intro': ''}
        sections.append(current); point = None; continue
    if bold and current and not pt and point is None and not current['intro'] and len(current['points']) == 0 and not t.strip().endswith('.') and len(t) < 60 and t.strip()[:1].islower():
        current['title'] += ' ' + t.strip(); continue
    if pt and current and pt.group(1).split('.')[0] == current['id']:
        point = {'id': pt.group(1), 'text': pt.group(2).strip()}
        current['points'].append(point); continue
    if current is None: continue
    target = point if point is not None else current
    key = 'text' if point is not None else 'intro'
    prev = target.get(key, '')
    # Join hyphenated line breaks; bullets printed as «%» become «•».
    line_text = t.strip()
    if line_text.startswith('%'): line_text = '• ' + line_text[1:].strip(); sep = '\n'
    else: sep = ' '
    if prev.endswith('-') and line_text[:1].islower(): target[key] = prev[:-1] + line_text
    elif prev: target[key] = prev + sep + line_text
    else: target[key] = line_text

for s in sections:
    for p in s['points']:
        p['text'] = re.sub(r'[ \t]+', ' ', p['text']).strip()
    s['intro'] = re.sub(r'[ \t]+', ' ', s['intro']).strip()
    s['title'] = re.sub(r'(\w)- (\w)', r'\1\2', s['title'])
json.dump({'edition': 'редакция на 01.04.2024', 'source': 'Постановление Правительства РФ от 23.10.1993 № 1090', 'sections': sections}, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('sections', len(sections), 'points', sum(len(s['points']) for s in sections))
for s in sections: print(s['id'], s['title'][:60], len(s['points']))
