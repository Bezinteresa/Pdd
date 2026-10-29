"""Counts listing.md fields and writes the lengths into the (N/limit) marks. Run: python count.py"""
import re, pathlib
p = pathlib.Path(__file__).with_name('listing.md'); s = p.read_text(encoding='utf-8')
limits = {'NAME': (1, 50), 'SEO': (50, 160), 'SHORT': (1, 70), 'ABOUT': (100, 1000), 'HOW': (100, 1000), 'KW': (1, 100), 'DEV': (1, 2048)}
def block(label):  # text after the "**Label** (...):" line up to the next "**" heading or "## "
    m = re.search(r'\*\*' + label + r'\*\* \(\(?(\w+|\d+)\)?/[^)]*\):\s*\n?\n?(.*?)(?=\n\n\*\*|\n\n## |\Z)', s, re.S); return m
for label, key in [('Название', 'NAME'), ('Описание для SEO', 'SEO'), ('Короткое описание', 'SHORT'), ('Об игре', 'ABOUT'), ('Как играть', 'HOW'), ('Комментарий разработчика', 'DEV')]:
    m = block(label); text = m.group(2).strip(); n = len(text); lo, hi = limits[key]
    s = s[:m.start(1)] + str(n) + s[m.end(1):].replace(')', ')', 1); print(f'{label}: {n} ({lo}–{hi})', 'OK' if lo <= n <= hi else 'ВНЕ ЛИМИТА')
m = re.search(r'\*\*Ключевые слова\*\* \(\(?(\w+)\)?/100\): `([^`]*)`', s); n = len(m.group(2)); s = s[:m.start(1)] + str(n) + s[m.end(1):]
print('Ключевые слова:', n, '(≤100)', 'OK' if n <= 100 and m.group(2) == m.group(2).lower() else 'ОШИБКА')
s = re.sub(r'\(\((\d+)\)/', r'(\1/', s)
p.write_text(s, encoding='utf-8')
