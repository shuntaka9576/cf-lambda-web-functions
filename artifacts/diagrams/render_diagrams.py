from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math

OUT = Path(__file__).parent
S = 2
INK = '#172B43'
MUTED = '#56677D'
BLUE = '#2463A6'
TEAL = '#087F78'
ORANGE = '#B95B18'
RED = '#B83E32'
PALE_BLUE = '#E8F1FC'
PALE_GREEN = '#E3F5F0'
PALE_ORANGE = '#FFF0DB'
GRAY = '#E5EAF0'
FONTS = {}

def font(n, bold=False):
    k = (n, bold)
    if k not in FONTS:
        FONTS[k] = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W%s.ttc' % ('6' if bold else '3'), int(n*S))
    return FONTS[k]

def canvas(w,h):
    global im,d
    im = Image.new('RGB',(w*S,h*S),'white')
    d = ImageDraw.Draw(im)

def box(x,y,w,h,fill='white',outline=None,r=18,width=2):
    d.rounded_rectangle((x*S,y*S,(x+w)*S,(y+h)*S),radius=r*S,fill=fill,outline=outline,width=width*S)

def text(x,y,t,n=26,color=INK,bold=False,anchor='lt'):
    d.text((x*S,y*S),t,font=font(n,bold),fill=color,anchor=anchor,spacing=10*S)

def line(points,c=GRAY,w=2):
    d.line([(x*S,y*S) for x,y in points],fill=c,width=w*S)

def arrow(x1,y1,x2,y2,c=BLUE,w=3):
    line([(x1,y1),(x2,y2)],c,w)
    a=math.atan2(y2-y1,x2-x1)
    pts=[(x2,y2),(x2-13*math.cos(a-.5),y2-13*math.sin(a-.5)),(x2-13*math.cos(a+.5),y2-13*math.sin(a+.5))]
    d.polygon([(x*S,y*S) for x,y in pts],fill=c)

def pill(x,y,w,t,fill,c,n=24):
    box(x,y,w,43,fill,r=12)
    text(x+w/2,y+22,t,n,c,True,'mm')

def card(x,y,w,h,title,subtitle,c=BLUE,fill='white',third=None):
    box(x,y,w,h,fill,c,14)
    text(x+w/2,y+31,title,28,c,True,'mm')
    text(x+w/2,y+73,subtitle,23,INK,False,'mm')
    if third: text(x+w/2,y+110,third,21,MUTED,False,'mm')

def save(name,w,h):
    im.resize((w,h),Image.Resampling.LANCZOS).save(OUT/name)

def signing():
    canvas(1920,1080)
    text(72,48,'POST の署名は、どこまで必要？',47,INK,True)
    text(75,116,'CloudFront + OAC で比較する Lambda の 2 つの入口',26,MUTED)
    box(60,177,1800,376,'#FFF9F3',r=24)
    pill(86,196,90,'従来',PALE_ORANGE,ORANGE)
    text(195,200,'Function URL + OAC',34,INK,True)
    pill(1293,197,535,'x-amz-content-sha256 必須',PALE_ORANGE,ORANGE)
    box(409,266,882,213,'#FFF3E5','#E8B989',18)
    text(437,278,'CloudFront',23,ORANGE,True)
    card(94,328,222,121,'ブラウザ','POST + body',ORANGE)
    card(445,323,366,137,'Lambda@Edge','body → SHA256',ORANGE,third='origin request')
    card(894,323,356,137,'OAC','渡されたハッシュで署名',ORANGE,third='CloudFront は計算しない')
    card(1450,328,350,121,'Function URL','署名と body を検証',ORANGE)
    arrow(316,388,444,388,ORANGE)
    arrow(812,388,893,388,ORANGE)
    arrow(1292,388,1449,388,ORANGE)
    text(1370,349,'SigV4',22,ORANGE,True,'mm')
    text(449,495,'参照できる body は最大 1 MB',23,ORANGE,True)
    text(1320,495,'UNSIGNED-PAYLOAD 不可',22,RED,True)

    box(60,580,1800,411,'#F3FAFC',r=24)
    pill(86,601,90,'新',PALE_GREEN,TEAL)
    text(195,605,'Web Functions + OAC',34,INK,True)
    pill(1478,602,350,'Lambda@Edge 不要',PALE_GREEN,TEAL)
    card(94,713,222,124,'ブラウザ','POST + body',TEAL)
    card(704,694,509,169,'CloudFront + OAC','UNSIGNED-PAYLOAD',TEAL,third='always-amz-auth')
    card(1450,713,350,124,'Web Function','endpoint',TEAL)
    arrow(317,775,703,775,TEAL)
    text(510,707,'x-amz-content-sha256',21,TEAL,True,'mm')
    text(510,739,'不要',24,TEAL,True,'mm')
    arrow(1214,775,1449,775,TEAL)
    text(1332,725,'SigV4 / HTTPS',20,TEAL,True,'mm')
    text(1332,816,'body は署名対象外',18,MUTED,False,'mm')
    text(91,889,'署名対象',22,TEAL,True)
    text(215,889,'メソッド・パス・クエリ・配信元識別ヘッダー',23,INK)
    text(91,936,'Authorization は保持',23,TEAL,True)
    text(425,936,'閲覧者のヘッダーを関数へ転送 ※',23,INK)
    text(73,1013,'※ 転送には cache policy への Authorization 追加が必要。図は regional endpoint（SigV4）の例。',19,MUTED)
    text(73,1044,'出典: AWS CloudFront Developer Guide — Lambda function URL / Lambda Web Function / Lambda@Edge restrictions',16,MUTED)
    save('cloudfront-oac-post-signing.png',1920,1080)

def bar(x1,x2,y,t,fill,c):
    box(x1,y,x2-x1,51,fill,r=7)
    text((x1+x2)/2,y+26,t,25,c,True,'mm')

def timeline():
    canvas(2400,1600)
    text(70,43,'2 段キャッシュで、届く内容の古さが変わる',49,INK,True)
    text(73,113,'CloudFront + Lambda Web Functions  /  Next.js 16.4 App Router ISR',28,MUTED)
    box(65,166,2270,124,'#F2F6FB',r=19)
    text(91,188,'設定',25,BLUE,True)
    text(175,188,'revalidate = 10 秒   /   expireTime = 20 秒',28,INK,True)
    text(1050,190,'Cache-Control: s-maxage=10, stale-while-revalidate=10',26,INK)
    text(91,242,'基準: オリジンは「描画から」、CloudFront は「取得から」',23,MUTED)
    pill(1120,232,215,'0〜10 秒: HIT',PALE_BLUE,BLUE,21)
    pill(1360,232,265,'10〜20 秒: STALE',PALE_ORANGE,ORANGE,21)
    pill(1650,232,650,'20 秒超: オリジンは描画 / CloudFront は取得',PALE_GREEN,TEAL,21)
    x0=460
    scale=55
    X=lambda t:x0+scale*t
    box(65,312,2270,520,'#FFFBF6',r=22)
    text(93,336,'ケース 1  |  expire の直前に当たる',34,INK,True)
    pill(1770,332,521,'この例の古さ 29.9 秒',PALE_ORANGE,ORANGE,30)
    for t,label in [(0,'08:43:17.2'),(10,'08:43:27.2'),(19.9,'08:43:37.1'),(29.9,'08:43:47.1')]:
        text(X(t),405,label,24,MUTED,False,'mm')
        line([(X(t),428),(X(t),647)],'#DDD9D0')
    text(97,475,'オリジン',27,INK,True)
    text(97,515,'5c4972dd',25,MUTED)
    bar(X(0),X(10),464,'X: HIT',PALE_BLUE,BLUE)
    bar(X(10),X(19.9),464,'X: STALE',PALE_ORANGE,ORANGE)
    text(X(19.9)+32,477,'Y を裏で再生成',26,TEAL,True)
    pill(X(0)-3,534,218,'X を描画',PALE_GREEN,TEAL)
    text(97,604,'CloudFront',27,INK,True)
    bar(X(19.9),X(29.9),590,'X を取得 → HIT',PALE_BLUE,BLUE)
    bar(X(29.9),X(32.6),590,'STALE',PALE_ORANGE,ORANGE)
    arrow(X(19.9),516,X(19.9),588,ORANGE)
    text(X(19.9)-22,552,'19.9 秒の X を返す',23,ORANGE,True,'rm')
    arrow(X(29.9),644,X(29.9),685,ORANGE)
    box(1430,687,835,101,PALE_ORANGE,r=16)
    text(1460,707,'ブラウザへ X を返し、裏で取り直し',27,ORANGE,True)
    text(1460,748,'19.9 秒 + 10.0 秒 = 29.9 秒',31,ORANGE,True)
    text(98,698,'取り直し先も同じ実行環境。',26,INK,True)
    text(98,744,'内容 X の描画時刻は古いまま、CloudFront の TTL が始まる。',24,MUTED)

    box(65,859,2270,529,'#F6FBFC',r=22)
    text(93,883,'ケース 2  |  キャッシュなし / expire 超えに当たる',34,INK,True)
    pill(1770,879,521,'観測した最大 約 10 秒',PALE_GREEN,TEAL,29)
    for t,label in [(0,'08:47:37.0'),(10.1,'08:47:47 ごろ'),(20.3,'08:47:57.3'),(30,'08:48:07.0')]:
        text(X(t),952,label,24,MUTED,False,'mm')
        line([(X(t),972),(X(t),1262)],'#D8E5E8')
    text(97,995,'オリジン',24,INK,True)
    text(97,1030,'5c4972dd',25,MUTED)
    text(X(0)+18,972,'A をその場で描画',18,TEAL,True)
    bar(X(0),X(10),996,'A: HIT',PALE_BLUE,BLUE)
    bar(X(10),X(20),996,'A: STALE',PALE_ORANGE,ORANGE)
    bar(X(20.3),X(30),996,'C をその場で描画 → HIT',PALE_GREEN,TEAL)
    text(97,1111,'509a785c',25,MUTED)
    bar(X(0),X(10.1),1088,'キャッシュなし',GRAY,MUTED)
    bar(X(10.1),X(20.1),1088,'B をその場で描画 → HIT',PALE_GREEN,TEAL)
    text(X(20.1)+25,1101,'別環境の A は更新されない',24,MUTED)
    text(97,1208,'CloudFront',27,INK,True)
    bar(X(0),X(10.1),1198,'A: HIT',PALE_BLUE,BLUE)
    bar(X(10.1),X(20.3),1198,'B: HIT → STALE',PALE_BLUE,BLUE)
    bar(X(20.3),X(30),1198,'C: HIT',PALE_BLUE,BLUE)
    box(X(10),1198,X(10.1)-X(10),51,PALE_ORANGE,r=0)
    box(X(20.1),1198,X(20.3)-X(20.1),51,PALE_ORANGE,r=0)
    arrow(X(10.1),1195,X(10.1),1140,TEAL)
    arrow(X(20.3),1195,X(20.3),1049,TEAL)
    text(X(20.3)+20,1160,'A は 20.3 秒 → expire 超え',22,TEAL,True)
    text(97,1278,'ブラウザ',25,INK,True)
    for t in (4.9,15.1,25.1):
        arrow(X(t),1252,X(t),1273,BLUE,2)
    text(X(0),1278,'A を受信: 2.5 → 9.0 秒',24,BLUE,True)
    text(X(10.1),1278,'B を受信: 0.3 → 9.9 秒',24,BLUE,True)
    text(X(20.3),1278,'C を受信: 0.2 → 4.9 秒',24,BLUE,True)
    text(97,1338,'0.3 秒おきにリロードした録画。08:47:57.3 には B（10.2 秒）を一度返し、取り直し後に C へ切り替わる。',24,MUTED)

    box(65,1412,2270,102,'#18384F',r=19)
    text(98,1434,'取り直し先の「実行環境」と「そのキャッシュの経過秒数」で変わる',33,'white',True)
    text(98,1480,'expire 手前 → 古さが重なって約 30 秒   /   キャッシュなし・expire 超え → その場で描画し、約 10 秒で更新',25,'#DEEBF4')
    text(75,1538,'※ 実行環境ごとのメモリキャッシュは共有されない前提。約 10〜30 秒は提示された連続アクセスの例であり、一般的な保証上限ではない。',21,MUTED)
    save('cloudfront-isr-two-level-cache.png',2400,1600)

signing()
timeline()
print(OUT/'cloudfront-oac-post-signing.png')
print(OUT/'cloudfront-isr-two-level-cache.png')
