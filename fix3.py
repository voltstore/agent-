import re
c=open('index.html','r',encoding='utf-8').read()
old_pattern=r"t\.replace\(/\\{[^}]+\\}/g,l\.name\|''\)\.replace\(/\\{[^}]+\\}/g,l\.city\|''\)\.replace\(/\\{[^}]+\\}/g,l\.category\|''\)"
new_code="t.replace(/{" + r"\u0627\u0633\u0645_\u0627\u0644\u0634\u0631\u0643\u0629" + "}/g,l.name||'').replace(/{" + r"\u0627\u0644\u0645\u062f\u064a\u0646\u0629" + "}/g,l.city||'').replace(/{" + r"\u0627\u0644\u0646\u0634\u0627\u0637" + "}/g,l.category||'').replace(/{" + r"\u0627\u0644\u062a\u0642\u064a\u064a\u0645" + "}/g,l.rating||'')"
c=re.sub(r't\.replace\(/\\{[^/]+/g,l\.name[^)]+\)\.replace\(/\\{[^/]+/g,l\.city[^)]+\)\.replace\(/\\{[^/]+/g,l\.category[^)]+\)',new_code,c)
open('index.html','w',encoding='utf-8').write(c)
print('done')
