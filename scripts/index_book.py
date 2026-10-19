import pymupdf as fitz,pathlib,re,json
root=pathlib.Path('.')
p=pathlib.Path('private/source-path.txt').read_text(encoding='utf8'); doc=fitz.open(p)
entries=[]; section='General functions'; part='General functions'
for pdf in range(4,10):
 for side in (['right'] if pdf==4 else ['left','right']):
  t=pathlib.Path(f'private/toc-{pdf}-{side}.txt').read_text(encoding='utf8')
  current=None
  for line in t.splitlines():
   line=line.strip()
   if re.match(r'(Section|[IVX]+\.)',line):
    section=re.sub(r'\s+\d+.*$','',line)
    current=None
   m=re.match(r'^(\d+)\s*\.\s*(.*?)\s+(\d{1,3})(?:\s+(.+))?$',line)
   if m:
    title=m[2]+(' '+m[4] if m[4] else '')
    page=int(m[3]); page=5 if title=='Relieving Pain' else page
    current={'id':f'huang-{page:03d}','title':title,'printedPage':page,'pdfPage':page//2+10,'tocPdfPage':pdf,'category':section,'status':'pending-source-review','pointIds':[],'pointNames':[]}
    entries.append(current)
   elif current and line and not re.match(r'^(Part|[ivxIVX]+$|\d+$)',line):
    current['title']+=' '+line
# page 91 OCR absent in existing text layer, verified from rendered TOC
entries.append({'id':'huang-091','title':'Tracheitis','printedPage':91,'pdfPage':55,'tocPdfPage':6,'category':'Respiratory system','status':'pending-source-review','pointIds':[],'pointNames':[]})
entries.append({'id':'huang-121','title':'Disturbed Function of Autonomic Nerve','printedPage':121,'pdfPage':70,'tocPdfPage':6,'category':'Nervous & mental disorders','status':'pending-source-review','pointIds':[],'pointNames':[]})
# Standalone unnumbered TOC topics
for page,title in [(47,'Reducing Body Temperature'),(288,'Cosmetic Application of Auricular Therapy'),(292,'Resisting Senility and Health')]:
 entries.append({'id':f'huang-{page:03d}','title':title,'printedPage':page,'pdfPage':page//2+10,'tocPdfPage':5 if page==47 else 9,'category':'General functions' if page==47 else 'Other applications','status':'pending-source-review','pointIds':[],'pointNames':[]})
entries.sort(key=lambda e:e['printedPage'])
for e in entries:
 e['title']=re.sub(r'([a-z])([A-Z])',r'\1 \2',e['title']); e['title']=re.sub(r'([,])(?=\w)',r'\1 ',e['title']); e['title']=re.sub(r'\s+',' ',e['title'])
page_ranges=[(0,'General functions'),(70,'Digestive system'),(90,'Respiratory system'),(98,'Circulatory system'),(107,'Nervous & mental disorders'),(137,'Endocrine & metabolic'),(150,'Urinary system'),(155,'Surgical & musculoskeletal'),(208,'Five sense organs'),(242,'Gynaecological'),(257,'Dermatology'),(276,'Prevention & other applications')]
for e in entries:
 e['category']=next(name for page,name in reversed(page_ranges) if e['printedPage']>=page)
 e['source']={'book':'huang-2007','printedPage':e['printedPage'],'pdfPage':e['pdfPage'],'tocPdfPage':e['tocPdfPage']}
out={'source':{'id':'huang-2007','title':'Handbook of Auricular Treatment: Prescriptions & Formulae','authors':['Lichun Huang','William S. Huang'],'year':2007,'pdfPages':len(doc),'indexMethod':'English table of contents OCR with limited manual corrections; not a complete transcription of individual formula variants. Chinese OCR corrupt.','reviewStatus':'pending-source-review'},'prescriptions':entries}
pathlib.Path('public/data/prescriptions.json').write_text(json.dumps(out,indent=2,ensure_ascii=False),encoding='utf8')
print('Indexed',len(entries)); print('\n'.join(f"{e['printedPage']:3} {e['title']}" for e in entries))
ref=pathlib.Path('private/reference');ref.mkdir(exist_ok=True)
for i in range(9,len(doc)):
 page=doc[i];w=page.rect.width;h=page.rect.height
 for s in [0,1]:
  printed=(i-9)*2+s
  if printed<1:continue
  pix=page.get_pixmap(matrix=fitz.Matrix(1.5,1.5),clip=fitz.Rect(s*w/2,0,(s+1)*w/2,h))
  pix.save(str(ref/f'page-{printed}.jpg'))
print('Reference images rendered')
