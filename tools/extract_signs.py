"""Official sign names (Appendix 1): «2.4 «Уступите дорогу»». Only number and name, no commentary."""
import glob, json, re, sys
import pymupdf

src = sorted(glob.glob('D:/Razbor/Torrent/Новая папка/Правила дорожного движения РФ/*.pdf'))[1]
doc = pymupdf.open(src)
text, on = '', False
for pno in range(doc.page_count):
    t = doc[pno].get_text()
    if 'ДОРОЖНЫЕ ЗНАКИ' in t: on = True
    if on and 'ДОРОЖНАЯ РАЗМЕТКА' in t:
        text += t[:t.index('ДОРОЖНАЯ РАЗМЕТКА')]; break
    if on: text += t + '\n'
text = text.replace('\u00ad', '').replace('\xa0', ' ')
text = re.sub(r'-\n(?=[а-яё])', '', text).replace('\n', ' ')
signs = {}
CODE = r'\d\.\d{1,2}(?:\.\d{1,2})?'
# One name may follow a list or range of codes: «1.11.1, 1.11.2 «Опасный поворот»», «2.3.2 - 2.3.7 «Примыкание…»».
for m in re.finditer(rf'(?<![\d.])((?:{CODE}\s*[,–-]\s*)*{CODE})\s+«([^»]{{3,80}})»', text):
    name = re.sub(r'\s+', ' ', m.group(2)).strip()
    found = re.findall(CODE, m.group(1))
    if len(found) == 2 and re.search(r'[–-]', m.group(1)):
        a, b = found; head = a.rsplit('.', 1)[0]
        if head == b.rsplit('.', 1)[0]: found = [f'{head}.{i}' for i in range(int(a.rsplit('.', 1)[1]), int(b.rsplit('.', 1)[1]) + 1)]
    for code in found:
        if code not in signs and code[0] in '12345678': signs[code] = name
groups = {'1': 'Предупреждающие знаки', '2': 'Знаки приоритета', '3': 'Запрещающие знаки', '4': 'Предписывающие знаки', '5': 'Знаки особых предписаний', '6': 'Информационные знаки', '7': 'Знаки сервиса', '8': 'Знаки дополнительной информации (таблички)'}
key = lambda c: [int(x) for x in c.split('.')]
out = {'groups': [{'id': g, 'title': title, 'signs': [{'code': c, 'name': signs[c]} for c in sorted(signs, key=key) if c.split('.')[0] == g]} for g, title in groups.items()]}
json.dump(out, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print({g['id']: len(g['signs']) for g in out['groups']})
print([s for g in out['groups'][:2] for s in g['signs']][:12])
