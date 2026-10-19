import json,pathlib
p=pathlib.Path('public/data/prescriptions.json');d=json.loads(p.read_text(encoding='utf8'));e={'id':'huang-121','title':'Disturbed Function of Autonomic Nerve','printedPage':121,'pdfPage':70,'tocPdfPage':6,'category':'Nervous & mental disorders','status':'pending-source-review','pointIds':[],'pointNames':[],'source':{'book':'huang-2007','printedPage':121,'pdfPage':70,'tocPdfPage':6}}
if not any(x['id']==e['id'] for x in d['prescriptions']):d['prescriptions'].append(e)
d['prescriptions'].sort(key=lambda e:e['printedPage']);p.write_text(json.dumps(d,indent=2,ensure_ascii=False),encoding='utf8');print(len(d['prescriptions']))
