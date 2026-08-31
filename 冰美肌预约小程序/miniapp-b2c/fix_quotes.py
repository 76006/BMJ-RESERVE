with open('C:/Users/15436/WorkBuddy/20260318155749/anti-aging-website/miniapp-b2c/gen_product_doc.js', 'r', encoding='utf-8') as f:
    content = f.read()

count = 0
# Replace Chinese left/right double quotes with corner brackets
for old, new in [('\u201c', '\u300c'), ('\u201d', '\u300d')]:
    c = content.count(old)
    if c > 0:
        content = content.replace(old, new)
        count += c
        print(f'Replaced {c} occurrences of U+{ord(old):04X} with U+{ord(new):04X}')

with open('C:/Users/15436/WorkBuddy/20260318155749/anti-aging-website/miniapp-b2c/gen_product_doc.js', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'Total replacements: {count}')
