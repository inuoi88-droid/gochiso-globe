# Builds site/index.html from src/*, build/bundle.json and site/quiz.tsv
import json, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
p = lambda *a: os.path.join(ROOT, *a)
bundle = open(p('build', 'bundle.json'), encoding='utf-8').read()
quiz = open(p('site', 'quiz.tsv'), encoding='utf-8').read()
head = open(p('src', 'app_head.html'), encoding='utf-8').read()
body = open(p('src', 'app_body.html'), encoding='utf-8').read()
js = open(p('src', 'app.js'), encoding='utf-8').read()
body = body.replace('__DATA__', bundle).replace('__QUIZ__', json.dumps(quiz, ensure_ascii=False)).replace('__APP_JS__', js)
html = ('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        + head + '</head>\n<body>\n' + body + '</body>\n</html>\n')
open(p('site', 'index.html'), 'w', encoding='utf-8').write(html)
print('site/index.html', round(len(html.encode()) / 1024), 'KB')
