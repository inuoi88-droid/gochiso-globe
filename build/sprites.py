# Cut the 2x2 sticker sheet into four transparent sprites (background flood fill,
# keep only the character's connected component, soft edge on the outline)
import sys, collections
from PIL import Image, ImageFilter
src, outdir = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
W, H = im.size
BG = (224, 227, 230)
def dist(p): return max(abs(p[0]-BG[0]), abs(p[1]-BG[1]), abs(p[2]-BG[2]))
names = ['point', 'jaki', 'douzo', 'good']   # ここだ / ジャキーン / どうぞ / thumbs-up
# the どうぞ pose holds its globe across the middle line, so its box is wider; pieces of the
# neighbour that fall inside are separate components and get dropped. The tip of that globe
# touches the thumbs-up pose's parrot, so that box starts just right of it.
boxes = [(0, 0, W//2, H//2), (W//2, 0, W, H//2), (0, H//2, 310, H), (W//2 + 25, H//2, W, H)]
for name, box in zip(names, boxes):
    q = im.crop(box); w, h = q.size; p = q.load()
    T = 9
    bg = [[False]*h for _ in range(w)]
    dq = collections.deque()
    for x in range(w):
        for y in (0, h-1): dq.append((x, y))
    for y in range(h):
        for x in (0, w-1): dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or bg[x][y] or dist(p[x, y]) > T: continue
        bg[x][y] = True
        dq.extend(((x+1, y), (x-1, y), (x, y+1), (x, y-1)))
    # grey pockets enclosed by the white sticker outline (e.g. between the head and the parrot):
    # bg-coloured regions not reached from the border whose rim is mostly the white outline
    seen = [[False]*h for _ in range(w)]
    pockets = 0
    for sx in range(w):
        for sy in range(h):
            if bg[sx][sy] or seen[sx][sy] or dist(p[sx, sy]) > T: continue
            reg = []; rim = 0; white = 0; dq.append((sx, sy)); seen[sx][sy] = True
            while dq:
                x, y = dq.popleft(); reg.append((x, y))
                for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
                    if not (0 <= nx < w and 0 <= ny < h): continue
                    if dist(p[nx, ny]) <= T:
                        if not seen[nx][ny] and not bg[nx][ny]: seen[nx][ny] = True; dq.append((nx, ny))
                    else:
                        rim += 1
                        if min(p[nx, ny]) >= 236: white += 1
            if len(reg) >= 40 and rim and white / rim > 0.55:
                pockets += 1
                for x, y in reg: bg[x][y] = True
    print(name, 'pockets cleared', pockets)
    # connected components of the foreground: keep the biggest (the character)
    comp = [[-1]*h for _ in range(w)]; sizes = []
    for sx in range(w):
        for sy in range(h):
            if bg[sx][sy] or comp[sx][sy] >= 0: continue
            cid = len(sizes); n = 0; dq.append((sx, sy)); comp[sx][sy] = cid
            while dq:
                x, y = dq.popleft(); n += 1
                for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
                    if 0 <= nx < w and 0 <= ny < h and not bg[nx][ny] and comp[nx][ny] < 0:
                        comp[nx][ny] = cid; dq.append((nx, ny))
            sizes.append(n)
    keep = max(range(len(sizes)), key=lambda i: sizes[i])
    print(name, 'components', len(sizes), 'biggest', sizes[keep], 'others >200px', sorted([s for i, s in enumerate(sizes) if i != keep and s > 200], reverse=True)[:6])
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0)); o = out.load()
    for x in range(w):
        for y in range(h):
            if comp[x][y] == keep:
                r, g, b = p[x, y]
                # soften the outermost pixels of the white outline against the old grey
                edge = any(0 <= nx < w and 0 <= ny < h and bg[nx][ny] for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)))
                a = 255 if not edge else max(90, min(255, int(dist((r, g, b)) * 14)))
                o[x, y] = (r, g, b, a)
    bb = out.getbbox(); out = out.crop((max(0, bb[0]-4), max(0, bb[1]-4), min(w, bb[2]+4), min(h, bb[3]+4)))
    out.save(f'{outdir}/lag-{name}.webp', 'WEBP', quality=88, method=6)
    out.save(f'{outdir}/lag-{name}-check.png')
    print(name, out.size)
