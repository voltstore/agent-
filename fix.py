import re
c=open('index.html','r',encoding='utf-8').read()
c=re.sub(r'STATUSES=\{[^}]+\}','STATUSES={' + "new:'new',sent:'sent',reply:'reply',client:'client'" + '}',c)
open('index.html','w',encoding='utf-8').write(c)
print('done')
