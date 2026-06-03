c=open('index.html','r',encoding='utf-8').read()
old=c[c.find('function buildMsg'):c.find('function buildMsg')+300]
print(repr(old[:100]))
