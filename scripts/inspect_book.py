import fitz,json,pathlib
p=next(pathlib.Path('E:/Downloads/ASUS/LANDrop').glob('[[]OCR]*Handbook of Auricular Treatment*.pdf'))
doc=fitz.open(p)
pages=[page.get_text(sort=True) for page in doc]
pathlib.Path('private/book-pages.json').write_text(json.dumps(pages,ensure_ascii=False),encoding='utf-8')
pathlib.Path('private/source-path.txt').write_text(str(p),encoding='utf-8')
print('Pages',len(pages))
for i,t in enumerate(pages[:18]): print('\nPDF PAGE',i+1,'\n',t[:5500])
for i in [0,5,8]: doc[i].get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(f'verification/book-{i+1}.png')
