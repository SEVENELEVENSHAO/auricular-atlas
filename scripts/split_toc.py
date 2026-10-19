import pymupdf as fitz, pathlib
p=next(pathlib.Path('E:/Downloads/ASUS/LANDrop').glob('[[]OCR]*Handbook of Auricular Treatment*.pdf'))
d=fitz.open(p)
for i in range(3,9):
 page=d[i]; w=page.rect.width; h=page.rect.height
 for side,x in [('left',0),('right',w/2)]:
  t=page.get_text(clip=fitz.Rect(x,0,x+w/2,h),sort=True)
  pathlib.Path(f'private/toc-{i+1}-{side}.txt').write_text(t,encoding='utf-8')
print(pathlib.Path('private/toc-5-left.txt').read_text(encoding='utf-8'))
