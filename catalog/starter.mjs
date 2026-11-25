// The order matches the locally generated flat-lay contact sheets.
const pieces = [
  ['navy-harrington','藏青哈灵顿夹克','外套','春秋','#2b3447','短款棉质立领，肩线自然','短下摆能露出裤腰线',['米白圆领T配灰西裤','蓝条纹衬衫配深牛仔']],
  ['olive-chore','橄榄绿工装夹克','外套','春秋','#656647','短款斜纹，多贴袋','一件就能带出工装层次',['米色针织配靛蓝牛仔','白T配沙色直筒裤']],
  ['charcoal-blazer','炭灰软肩西装','外套','春秋','#393a40','哑光软肩两粒扣，无明显垫肩','提高正式度，日常也好搭',['蓝衬衫配黑西裤','白T配浅色牛仔']],
  ['brown-suede','棕色翻领短夹克','外套','春秋','#724934','短款麂皮质感，简洁翻领','用一点粗糙纹理衬出细针织',['奶油圆领针织配黑裤','浅蓝条纹衬衫配沙色裤'],'seasonal'],
  ['stone-mac','石灰短风衣','外套','春秋','#898885','臀线以上，翻领，防风面料','取风衣的挡风能力，保留清楚的比例',['炭灰开衫配深蓝牛仔','灰卫衣配浅色球鞋'],'seasonal'],
  ['indigo-trucker','深靛牛仔夹克','外套','春秋','#343d57','短款直身，醒明车线','靛蓝和奶油色容易配出干净的层次',['白T配沙色斜纹裤','灰卫衣配浅牛仔']],
  ['black-quilt','黑色轻绗缝夹克','外套','冬','#303032','短身轻绗缝，薄夹层','叠穿保暖且不把上身撑得太厚',['黑针织配灰抽绳裤','米白针织配橄榄绿工装裤'],'seasonal'],
  ['camel-coat','驼色单排扣大衣','外套','冬','#a97c54','及膝窄驳领，自然肩羊毛质感','内搭同色系针织时层次清楚',['黑圆领配黑西裤','灰开衫配米白牛仔']],
  ['white-tee','白色圆领T恤','上装','四季','#f1eee8','中等克重棉质，直身短袖','领口露白能分开深外套和脸部',['工装外套配深牛仔','藏青夹克配灰西裤']],
  ['ivory-oxford','米白牛津纺衬衫','上装','四季','#e9e0ca','自然肩，衣身略宽，扣领','单穿整洁，开两颗扣也能作轻外搭',['炭灰开衫配米白牛仔','石灰风衣配深蓝牛仔']],
  ['blue-stripe-shirt','浅蓝细条纹衬衫','上装','四季','#a5b8ca','宽松棉质细条纹，袖口可卷','细条纹让简单深色下装多一点层次',['藏青夹克配黑西裤','棕短夹克配沙色裤']],
  ['cream-merino','奶油白细针织','上装','冬','#eee5d4','细针织圆领，罗纹收口','低饱和浅色提亮深夹克的内搭',['棕短夹克配黑裤','绗缝外套配工装裤']],
  ['coal-cardigan','深灰V领开衫','上装','春秋','#4b4a4d','细针织，短衣长，V领排扣','领口留白清楚，解开也能显层次',['白衬衫配浅色牛仔','白T配灰西裤']],
  ['chocolate-polo','巧克力棕针织Polo','上装','春秋','#654230','短门襟小翻领，细针织','低饱和棕色有变化，也容易配灰色',['中灰裤配黑乐福鞋','浅色牛仔配棕麂皮鞋'],'seasonal'],
  ['steel-oxford','灰蓝磨毛衬衫','上装','春秋','#697c8f','软挺磨毛棉，普通翻领','灰蓝适合镜头，单穿也有立体感',['深灰西装配黑西裤','白T里面叠穿配深牛仔']],
  ['black-merino','黑色圆领细针织','上装','冬','#292a2d','精纺羊毛质感，长袖直身','和深色同穿时依靠织物纹理区分层次',['搭驼大衣配黑裤','搭绗缝夹克配灰裤']],
  ['breton-top','米白藏青条纹衫','上装','春秋','#d9d3c3','水平细条纹，长袖微宽松','作为一身穿搭里唯一图案更耐看',['浅牛仔配帆布鞋','藏青短夹克配沙色裤']],
  ['gray-sweatshirt','灰色圆领卫衣','上装','四季','#8d8d93','中等厚度，罗纹下摆','适合轻叠穿，肩部线条自然',['牛仔夹克配浅牛仔','石灰风衣配直筒裤']],
  ['charcoal-pleats','深灰单褶直筒裤','下装','四季','#55555c','中高腰，单褶，裤脚接鞋面','有西裤的垂感，搭夹克和乐福鞋都自然',['白T加藏青夹克','针织Polo加黑乐福']],
  ['indigo-jeans','原色直筒牛仔裤','下装','四季','#313f57','中高腰深靛丹宁，干净直筒','保留牛仔质地，也适合略正式的搭配',['灰西装配白帆布鞋','白衬衫配深灰开衫']],
  ['sand-chinos','沙色斜纹直筒裤','下装','四季','#ae997b','直筒棉斜纹，裤脚不过长','能接住深色上衣，春秋尤其顺手',['橄榄工装配白T','浅蓝衬衫配棕夹克']],
  ['olive-utility','橄榄绿直筒工装裤','下装','春秋','#66654c','直筒，扁贴工装口袋','用扁口袋保留工装感，避免横向鼓出',['白T配橄榄步行鞋','奶油细针织配黑绗缝夹克']],
  ['slate-drawstring','冷灰直筒抽绳裤','下装','四季','#6e7379','轻薄直筒，抽绳腰','腰部舒服，裤脚依然利落',['黑针织配轻绗缝夹克','灰卫衣配白灰球鞋']],
  ['ecru-jeans','米白直筒牛仔裤','下装','春秋','#e2d8bc','挺括丹宁，落脚利落','用浅裤色放大深色夹克的层次',['深靛牛仔夹克配白帆布鞋','深灰开衫配米白衬衫']],
  ['black-trousers','黑色垂坠西裤','下装','四季','#2b2b30','中高腰平前片，直筒线条','用处从出镜到正式场合，搭纯色上衣稳妥',['炭灰西装配黑德比','巧克力针织配棕麂皮鞋']],
  ['sand-shorts','沙色单褶短裤','下装','夏','#a69377','膝上，一道褶，宽松裤口','短裤有垂感，搭衬衫可以比运动短裤更整洁',['白牛津纺配深蓝帽','条纹衫配帆布鞋'],'seasonal'],
  ['cream-canvas','米白低帮帆布鞋','鞋履','四季','#e7decd','低帮帆布，鞋底薄','适合让休闲穿搭看起来清爽',['沙色裤配白T','深蓝牛仔配藏青夹克']],
  ['navy-runner','藏青麂皮复古跑鞋','鞋履','四季','#3c4860','窄楦低帮，麂皮拼织物','轮廓比厚底轻，能搭直筒裤',['沙色斜纹裤配白T','冷灰抽绳裤配针织']],
  ['black-penny','黑色便士乐福鞋','鞋履','四季','#292828','低跟圆头，简洁皮面','给斜纹裤和西裤都加一点正式感',['棕针织配灰西裤','灰西装配浅蓝衬衫']],
  ['brown-derby','深棕麂皮德比鞋','鞋履','四季','#524039','软面圆头，鞋底不过厚','棕麂皮能接住针织的质感',['翻领针织配黑裤','浅蓝衬衫配米白牛仔']],
  ['black-derby','黑色素面德比鞋','鞋履','四季','#242528','素面系带，圆头薄底','适合搭正式裤装，近镜头也耐看',['软肩西装配黑裤','驼大衣配灰直筒裤']],
  ['tan-chukka','茶棕麂皮短靴','鞋履','冬','#9b7452','两孔系带，低筒麂皮','裤脚到鞋帮时长度感清楚',['橄榄绿工装裤配黑绗缝夹克','深牛仔配驼大衣'],'seasonal'],
  ['gray-cupsole','白灰低帮板鞋','鞋履','四季','#ddd9d5','低帮皮面，简洁鞋头','比跑鞋更简练，适合浅深裤色过渡',['浅牛仔配灰卫衣','冷灰裤配夹克']],
  ['olive-trail','深橄榄越野鞋','鞋履','四季','#535743','低帮越野鞋，鞋底抓地纹','适合行走多的日子，深灰和卡其都好接',['橄榄工装裤配白T','灰抽绳裤配黑夹克'],'seasonal'],
  ['tortoise-frames','玳瑁窄方光学镜','配饰','四季','#594234','微圆角窄方形，棕色板材','给中性色搭配一点暖色焦点',['灰蓝衬衫配深灰裤','棕夹克配米白针织']],
  ['black-sunglasses','哑黑细框墨镜','配饰','四季','#232427','细金属方框，深灰镜片','边缘轻，搭低饱和短夹克更利落',['白T配冷灰抽绳裤','藏青夹克配靛蓝牛仔']],
  ['brown-belt','深棕细皮带','配饰','四季','#4d372e','细哑光皮带，小方扣','接住暖调鞋，不抢上衣注意力',['沙色裤配蓝衬衫','灰直筒裤配棕德比']],
  ['cream-tote','奶白挺括帆布包','配饰','四季','#e4d8bf','硬挺帆布方包，无外露标识','把简单的夹克和牛仔搭出一点明暗',['橄榄工装夹克配深牛仔','浅蓝衬衫配沙色短裤']],
  ['charcoal-scarf','炭灰羊毛围巾','配饰','冬','#48484c','纤细羊毛感织物，短流苏','暗色低对比，对深外套和驼外套都好配',['驼大衣配黑针织','黑绗缝配米白针织'],'seasonal'],
  ['navy-cap','洗水藏青棒球帽','配饰','四季','#434d64','低帽冠，弧帽檐，水洗帆布','呼应靛蓝牛仔或藏青夹克',['条纹衫配浅牛仔','白T配灰抽绳裤']],
];

const verifiedProducts = {
  'black-merino': {
    url: 'https://h.uniqlo.cn/product?pid=u0000000074502',
    brand: '优衣库', sku: '486058', name: '精纺美利奴羊毛圆领针织衫', color: '黑色', shape: '长袖',
    match: 'product',
  },
};
export const items = pieces.map(([id, name, category, season, color, shape, why, wears, kind = 'classic']) => {
  const purchase = verifiedProducts[id];
  return { id, name, category, season, color, shape, why, wears, kind, ...(purchase && {
    purchase, initialPurchase: { ...purchase, status: 'verified', checkedAt: Date.parse('2026-11-22T00:00:00+08:00') },
  }) };
});

const looks = [
  ['commute-harrington','藏青短衣灰裤','通勤','春秋','短夹克与单褶裤把上下比例定住。白T的领口留一点光。','navy-harrington white-tee charcoal-pleats black-penny'],
  ['commute-soft-blazer','软肩西装配牛仔','通勤','春秋','软肩外套加深色原牛，保留办公室里的整洁度。','charcoal-blazer ivory-oxford indigo-jeans brown-derby'],
  ['commute-knit-polo','棕针织与灰直筒','通勤','春秋','细针织领口稍显正式，暖棕和冷灰让颜色有深浅。','chocolate-polo charcoal-pleats black-penny brown-belt'],
  ['commute-winter-coat','驼色大衣通勤','通勤','冬','黑针织降掉驼色的大面积暖感，灰裤过渡到深鞋。','camel-coat black-merino charcoal-pleats black-derby'],
  ['weekend-green-chore','周末斜纹工装','周末','春秋','工装补层次，白T和深牛仔把颜色收住。','olive-chore white-tee indigo-jeans cream-canvas cream-tote'],
  ['weekend-ecru-denim','深浅丹宁','周末','春秋','深色丹宁和浅色丹宁有呼应，灰卫衣再加一层柔软质感。','indigo-trucker gray-sweatshirt ecru-jeans gray-cupsole'],
  ['weekend-breton','条纹衫与帆布鞋','周末','夏','条纹留在上半身，沙色短裤把整体从深色里提出来。','breton-top sand-shorts cream-canvas navy-cap'],
  ['weekend-layer','开衫松弛叠穿','周末','春秋','V领开衫里露出短领，抽绳长裤适合长时间坐走。','coal-cardigan white-tee slate-drawstring gray-cupsole'],
  ['date-suede','棕麂皮与奶油白','约会','春秋','麂皮和细针织的质感互补，黑西裤让色彩过渡克制。','brown-suede cream-merino black-trousers brown-derby'],
  ['date-oxford','米白衬衫叠灰针织','约会','春秋','同色衬衫和丹宁之间用深灰开衫压住层次。','coal-cardigan ivory-oxford ecru-jeans brown-derby'],
  ['date-camel','驼色大衣配深蓝','约会','冬','深蓝裤和炭灰围巾平衡大衣的暖色，深棕鞋接住整身。','camel-coat cream-merino indigo-jeans brown-derby charcoal-scarf'],
  ['date-polo','棕色针织配奶白裤','约会','春秋','小翻领有领型层次，奶白裤和棕色皮具把全身收在暖色系。','chocolate-polo ecru-jeans brown-derby brown-belt'],
  ['travel-chore','短工装轻出行','出行','春秋','短夹克方便活动，棉斜纹裤和抓地底适合走路。','olive-chore white-tee sand-chinos olive-trail cream-tote'],
  ['travel-drawstring','灰裤白T轻装','出行','夏','低对比白灰成套，藏青帽和鞋稳住颜色。','white-tee slate-drawstring navy-runner navy-cap black-sunglasses'],
  ['travel-short-mac','短风衣叠卫衣','出行','春秋','短衣身方便旅行坐下，卫衣和深牛仔都耐穿。','stone-mac gray-sweatshirt indigo-jeans navy-runner'],
  ['travel-quilt','轻绗缝叠穿','出行','冬','轻绗缝保暖，让亮色针织和橄榄工装裤保持微妙对比。','black-quilt cream-merino olive-utility tan-chukka'],
  ['camera-blue','灰蓝衬衫干净出镜','出镜','春秋','镜头里的灰蓝温和，深灰裤和小框眼镜把轮廓收住。','steel-oxford charcoal-pleats black-penny tortoise-frames'],
  ['camera-harrington','藏青夹克与细条纹','出镜','春秋','夹克领口利落，衬衫留少量条纹给近景。','navy-harrington blue-stripe-shirt sand-chinos brown-derby'],
  ['camera-charcoal','低对比深色出镜','出镜','冬','软肩和细针织的材质在镜头里各有层次，颜色保持安静。','charcoal-blazer black-merino charcoal-pleats black-derby'],
  ['camera-knits','浅针织与深丹宁','出镜','冬','奶油白靠近脸部，深牛仔为全身画面压住重心。','cream-merino indigo-jeans cream-canvas tortoise-frames'],
  ['formal-layer','软肩西装黑裤','正式','四季','炭灰和黑色近似，浅蓝细条纹使领口更清晰。','charcoal-blazer blue-stripe-shirt black-trousers black-derby'],
  ['formal-coat','驼大衣与白衬衫','正式','冬','大衣提供长线条，黑裤与德比让内搭保持整洁。','camel-coat ivory-oxford black-trousers black-derby charcoal-scarf'],
  ['formal-day','日间深浅层次','正式','春秋','自然肩外套下用灰蓝衬衫和沙色裤，适合日间活动。','charcoal-blazer steel-oxford sand-chinos brown-derby brown-belt'],
  ['formal-dinner','针织轻正装','正式','春秋','细针织翻领和洁净西裤适合着装稍放松的晚宴。','charcoal-blazer chocolate-polo black-trousers black-penny'],
];

export const outfits = looks.map(([id, name, occasion, season, why, ids]) => ({ id, name, occasion, season, why, itemIds: ids.split(' ') }));
