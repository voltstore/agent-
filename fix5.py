c=open('index.html','r',encoding='utf-8').read()
start=c.find('function buildMsg')
end=c.find('function waLink')
old=c[start:end]
new_func='''function buildMsg(l){
  const t=S.messageTemplate||defT();
  return t.split('{اسم_الشركة}').join(l.name||'')
          .split('{المدينة}').join(l.city||'')
          .split('{النشاط}').join(l.category||'')
          .split('{التقييم}').join(l.rating||'');
}
'''
c=c[:start]+new_func+c[end:]
open('index.html','w',encoding='utf-8').write(c)
print('done')
