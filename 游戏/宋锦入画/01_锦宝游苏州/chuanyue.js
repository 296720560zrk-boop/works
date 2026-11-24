/* ==========================================================
   宋锦入画 · 穿越台
   ----------------------------------------------------------
   Xmax X2.1 实时视频模型。
   摄像头取帧 → 云端逐帧重绘（换衣冠、换场景）→ 流回来放大屏。
   延迟约 200ms，孩子的动作和表情当场就变。

   要点：
   · faceRestoration 打开时，模型只重绘衣裳和背景，五官仍是孩子本人。
   · 换场景 = 换 prompt，不重连、不断流。
   · 衣冠参考图上传一次就缓存，不重复消耗流量。
   ========================================================== */

import {
  XmaxClient, XmaxConfiguration, XmaxEnvironment,
  RealtimeModel, RealtimeConfiguration, RealtimeContext,
  RealtimeCameraPreset, CameraPosition,
} from './sdk/index.js';

/* ---------------- 十个落脚处 ---------------- */

const SCENES = [
  {
    id: 'shuchang', short: '评弹', name: '评弹书场', key: '1',
    onMap: '临河茶楼',
    place: '苏州 · 山塘街',
    intro: '临河茶楼，琵琶叮咚。小小听客穿上八达晕纹的宋锦，端坐桌前听一段吴侬软语，再呷一口甜甜的香茶。',
    acts: [
      '学茶客的样子，端起茶碗抿一口',
      '听一段评弹，跟着调子轻轻点头',
      '给说书的先生鼓鼓掌，说一句“真好听”',
    ],
    bg: '一间临河茶楼的二层，四周是木梁的屋顶和白墙，窗边摆着几排矮矮的方桌和长条凳，桌上摆着茶壶和茶碗，墙上挂着一块写着字的木招牌，楼里很安静宽敞',
    folk: '窗边摆着几盆绿植，木栏杆外能看到河',
    sky: '屋顶的木梁和垂下的几盏竹骨灯',
    map: [13.5, 44],
  },
  {
    id: 'kunqu', short: '水榭', name: '水榭听曲', key: '2',
    onMap: '园林水榭',
    place: '苏州 · 园林水榭',
    intro: '水榭四面来风，曲声像水一样慢慢流。穿团花纹宋锦的小戏迷凭栏而立，听一句昆曲，看一波涟漪。',
    acts: [
      '站在栏杆边，看看水里的荷叶',
      '学一句昆曲的拖腔：“啊——”',
      '对着水面，做一个兰花指的手势',
    ],
    bg: '一座伸进水池中央的临水木构水榭，四面通透、翘角飞檐，一条小曲桥从岸边弯弯地连进水榭，榭前是一池碧水、水面上浮着荷叶和一朵粉荷',
    folk: '水榭里摆着一张矮矮的小方桌和两个坐垫，栏杆边种着几盆花',
    sky: '水榭的翘角屋檐和垂下的几枝柳条',
    map: [34, 26],
  },
  {
    id: 'hupan', short: '园池', name: '园中水岸', key: '3',
    onMap: '月洞花墙',
    place: '苏州 · 拙政园',
    intro: '粉墙黛瓦，竹影摇摇。穿缠枝莲纹宋锦的小游客穿过圆圆的月洞门——莲花朵朵相连，好运也一路相连。',
    acts: [
      '穿过圆圆的月洞门，走一步再回头',
      '数一数，墙上有几扇花窗',
      '念一句：江南可采莲',
    ],
    bg: '苏州园林的一角，一堵白墙上开着一扇圆圆的月洞门，月洞门里透出后面的花木，墙上还开着一扇雕花的漏窗，墙前种着一株芭蕉和几丛细竹',
    folk: '月洞门前摆着一架小小的石桌石凳',
    sky: '淡蓝的天和几朵白云',
    map: [23, 19],
  },
  {
    id: 'jishi', short: '集市', name: '山塘集市', key: '4',
    onMap: '石板长街',
    place: '苏州 · 山塘集市',
    intro: '长街上招牌林立，叫卖声此起彼伏。穿龟背纹宋锦的小客人慢慢逛——龟甲般结实的纹样，护你一路稳稳当当。',
    acts: [
      '学小贩吆喝一声：“卖绸缎咯——”',
      '假装买一块糕点，闻一闻香不香',
      '用手指比出龟背纹的小格子',
    ],
    bg: '江南水乡临河的一条石板长街，街两边支着好几顶柿红和靛蓝的布棚小摊，一个摊堆着一匹匹叠好的绸缎、一个摊摆着一屉屉冒热气的糕点，檐下挂着布幌子',
    folk: '摊子后面堆着几只竹筐，一副扁担斜靠在墙边，蒸笼里冒着白气',
    sky: '晴天的天光和伸出来的屋檐、几盏红灯笼',
    map: [47, 36],
  },
  {
    id: 'zhifang', short: '织坊', name: '织坊观织', key: '5',
    onMap: '织造作坊',
    place: '苏州 · 织造坊',
    intro: '满屋彩线绕成小山。穿万字纹宋锦的小织童踮脚张望——你身上这身衣裳，就是从这里一寸一寸织出来的。',
    acts: [
      '假装两手在织布，一推一拉',
      '数一数，墙上的线团有几种颜色',
      '说一说：你的宋锦衣裳是什么花纹',
    ],
    bg: '一间苏州的织造作坊大堂，四周是白墙和粗木梁的屋顶，墙上挂着一排排五颜六色的线团做装饰，靠墙摆着一排矮矮的木柜和几个竹筐，大堂中间是空的、很宽敞',
    folk: '墙边放着一只染布的大染缸，地上铺着青石板',
    sky: '屋顶的粗木梁',
    map: [88, 61],
  },
  {
    id: 'denghui', short: '灯会', name: '山塘灯会', key: '6',
    onMap: '夜河灯影',
    place: '苏州 · 上元夜',
    intro: '夜幕垂，河灯明。提灯的小锦宝穿上团花灯影纹的宋锦，沿岸追一盏荷花灯——许个愿，看它漂向水中央。',
    acts: [
      '提一盏想象中的荷花灯，慢慢往前走',
      '双手合起来，许一个愿',
      '对着河灯说一句：“漂得远远的”',
    ],
    bg: '夜晚的山塘河，一座三拱石拱桥跨过河面，桥下泊着几艘带篷的小木船，沿河小楼的檐下挂满一串串圆圆的红灯笼，河面上飘着几盏荷花灯、映出一片灯影',
    folk: '河岸边种着一排柳树，树下摆着几张矮矮的石凳',
    sky: '深蓝的夜空、一轮圆月',
    map: [27, 77],
  },
  {
    id: 'jiazhi', short: '家织', name: '家中机杼', key: '7',
    onMap: '河畔人家',
    place: '苏州 · 河畔人家',
    intro: '一方小院，机杼声沙沙。穿菱格纹宋锦的小孙儿依在长辈身边——从前妈妈奶奶就在这里，一梭一梭织出全家的衣裳。',
    acts: [
      '学奶奶摇纺车，手腕转一转',
      '给身边的长辈捶捶肩，说“您辛苦啦”',
      '说一说：你最喜欢家里谁织的东西',
    ],
    bg: '苏州人家的小院，白墙黑瓦、墙角种着一株芭蕉，靠墙摆着一排矮矮的竹椅和一张小方桌，窗台上摆着一盆兰花，小院中间是空的、很宽敞',
    folk: '墙角放着一只竹编的笸箩，地上有只打盹的小花猫',
    sky: '屋檐下的木梁和一盏油灯',
    map: [73, 55],
  },
  {
    id: 'neishi', short: '内室', name: '点茶小食', key: '8',
    onMap: '临窗书房',
    place: '苏州 · 临窗书房',
    intro: '茶筅轻搅，茶沫如雪。穿冰裂纹宋锦的小主人安坐案前——点一盏茶，尝一块小点心，歇一歇脚。',
    acts: [
      '学点茶的样子，手腕画圈搅一搅',
      '捏一块想象中的小点心，小口尝一尝',
      '找找身上的冰裂纹，像不像冰面裂开的线',
    ],
    bg: '苏州人家的书房，窗下一张矮矮的方几、几上摆着茶壶和两碟点心，墙上挂着一幅字画，屋里摆着几张矮凳，整间屋子很安静',
    folk: '窗边摆着一只青瓷香炉，炉上飘着一缕细烟',
    sky: '屋顶的木梁和窗外探进来的几枝竹叶',
    map: [65, 69],
  },
  {
    id: 'qinshi', short: '琴室', name: '琴室听琴', key: '9',
    onMap: '临水厅堂',
    place: '苏州 · 临水厅堂',
    intro: '帘外无风，琴音袅袅。穿云纹回纹宋锦的小雅士正襟危坐——云一朵一朵，琴声一圈一圈，绕在梁上不肯散。',
    acts: [
      '静下来听三秒，什么声音都不出',
      '手指在空气里拨一下琴弦',
      '念一句诗：明月松间照',
    ],
    bg: '苏州人家的大厅堂，白墙和木梁的屋顶，墙上挂着一幅山水立轴，靠墙摆着一排矮矮的木椅和一张矮几，几上摆着香炉和茶壶，厅堂中间是空的、很宽敞明亮',
    folk: '墙角放着一盆兰花，地上铺着青石板',
    sky: '屋顶的木梁和一盏宫灯',
    map: [76, 79],
  },
  {
    id: 'xitai', short: '戏台', name: '粉墨登场', key: '0',
    onMap: '朱漆戏台',
    place: '苏州 · 古戏台',
    intro: '锣鼓一响，红台亮相。穿凤穿花纹宋锦戏服的小角儿莲步登台——凤绕着花，花衬着凤，今天你是台上最亮的角儿。',
    acts: [
      '摆一个亮相的姿势，定住三秒',
      '走两步台步，把袖子甩一甩',
      '大声说一句：“小角儿登场啦！”',
    ],
    bg: '一座朱漆古戏台之上，头顶是两层飞檐的歇山式屋顶和彩绘的藻井，台面是平整的红漆木板，台中央是空的、很开阔，台口围着一圈矮矮的木栏杆',
    folk: '台边摆着几个矮矮的木箱',
    sky: '两层飞檐的屋顶、彩绘的藻井',
    map: [67, 21],
    mask: true,
  },
];


/* 只有一种画风：Q版等距2.5D江南手游风，跟首页那张江南地图完全一致。
   封面是"等距2.5D俯视 + 纸片化块面平涂 + 细腻深色勾边 + 明快青绿色调 + 轻度Q版"。
   所以进场景后的背景要画成同一种笔触。
   人物：孩子是摄像头正脸拍的，必须平视面对镜头——
   所以人物是"正面平视的Q版手游角色"（头大身小、圆润可爱、细线勾边、扁平上色），
   背景等距、人物正面，这是《江南百景图》类手游的标准手法。 */
const STYLE = {
  /* 学豆包衣服提示词的写法：不堆美术术语，用"可视化、可执行"的话。
     一句话讲清"这是Q版儿童游戏画面"，再用具体特征收住。 */
  brief: 'Q版儿童游戏画风的古代江南场景，像幼儿绘本里的一幅画，'
    + '所有东西都圆润可爱、头大身小、没有尖锐棱角，'
    + '线条柔和、边缘清晰，颜色是干净明亮的青绿色调，'
    + '房子是白墙黑瓦、屋顶圆圆的翘角飞檐，画面里没有真人、没有照片质感，'
    + '背景是画出来的卡通场景',
};

/* 参考图 + 写进指令的衣冠描述。
   每个场景男女童各一套，共 20 件；进哪个场景就自动穿哪一件。
   衣服画法：Q版扁平、细细的深色勾边，但要有宋锦的纹样元素
   （八达晕、龟背、万字、缠枝莲、团花、冰裂、云纹、凤穿花等），
   实现"随场景变色换花纹"。 */
const OUTFITS = {
  /* 1 评弹书场 · 八达晕纹 */
  shuchang_girl: { file: 'assets/outfit/shuchang_girl.webp', label: '浅杏褙子', brief: '浅杏青绿淡粉的宋制褙子配素色长裙，褙子边缘裙腰肩部有梅花纹、缠枝纹、细格纹的宋锦' },
  shuchang_boy:  { file: 'assets/outfit/shuchang_boy.webp',  label: '茶褐长衫', brief: '茶褐黛青米白的宋式长衫配深色马甲，领口袖口腰间有回纹、莲纹、山茶纹的宋锦' },
  /* 2 水榭听曲（昆曲）· 团花折枝 */
  kunqu_girl: { file: 'assets/outfit/kunqu_girl.webp', label: '浅青大袖衫', brief: '浅青胭脂象牙白的宋制大袖衫配百迭裙，裙门披帛袖口有海棠纹、缠枝莲纹、云纹的宋锦' },
  kunqu_boy:  { file: 'assets/outfit/kunqu_boy.webp',  label: '月白长衫', brief: '月白黛青深绿的交领长衫配青灰披帛，袖口领缘腰部有曲水纹、莲纹、云鹤纹的宋锦' },
  /* 3 园中水岸 · 缠枝莲 */
  hupan_girl: { file: 'assets/outfit/hupan_girl.webp', label: '藕青褙子', brief: '藕青浅碧米白的宋制褙子配长裙，抹胸裙腰袖口有牡丹纹、如意云纹、细叶纹的宋锦' },
  hupan_boy:  { file: 'assets/outfit/hupan_boy.webp',  label: '黛青圆领袍', brief: '黛青石青圆领袍配窄袖外袍，米白内衬，衣缘腰封下摆有莲纹、卷草纹、云水纹的宋锦' },
  /* 4 山塘集市 · 龟背纹 */
  jishi_girl: { file: 'assets/outfit/jishi_girl.webp', label: '浅蓝窄袖衫', brief: '浅蓝淡粉米白的宋制窄袖衫配长裙，衫子边缘裙腰披帛有绣花纹、莲纹、细叶纹的宋锦' },
  jishi_boy:  { file: 'assets/outfit/jishi_boy.webp',  label: '靛蓝短袍', brief: '靛蓝赭石米白的宋式短袍配长裤，外搭青布围裙，肩部袖口腰封有格纹、莲纹、海水纹的宋锦' },
  /* 5 织坊观织 · 万字纹 */
  zhifang_girl: { file: 'assets/outfit/zhifang_girl.webp', label: '浅碧褙子', brief: '浅碧胭脂月白的宋制褙子配长裙，褙子前襟裙腰袖口有团花纹、缠枝纹、水波纹的宋锦，这件衣服只穿在孩子身上、是孩子身上唯一的一件，不会单独出现在画面别处' },
  zhifang_boy:  { file: 'assets/outfit/zhifang_boy.webp',  label: '墨青长衫', brief: '墨青赭石米白的宋式长衫配青灰外搭，领缘袖缘腰封有宝相花纹、回纹、云纹的宋锦，这件衣服只穿在孩子身上、是孩子身上唯一的一件，不会单独出现在画面别处' },
  /* 6 山塘灯会 · 团花灯影 */
  denghui_girl: { file: 'assets/outfit/denghui_girl.webp', label: '胭脂褙子', brief: '胭脂浅青月白的宋制褙子配长裙，褙子边缘裙门披帛有花灯纹、海棠纹、云气纹的宋锦，这件衣服只穿在孩子身上、是孩子身上唯一的一件，不会单独出现在画面别处' },
  denghui_boy:  { file: 'assets/outfit/denghui_boy.webp',  label: '墨绿圆领袍', brief: '墨绿绀紫金色的宋式圆领袍配深色外袍，袍缘腰封袖部有灯纹、莲纹、云纹的宋锦，这件衣服只穿在孩子身上、是孩子身上唯一的一件，不会单独出现在画面别处' },
  /* 7 家中机杼 · 菱格纹 */
  jiazhi_girl: { file: 'assets/outfit/jiazhi_girl.webp', label: '青绿窄袖衫', brief: '青绿象牙白淡粉的宋制窄袖衫配长裙，袖口裙腰肩部有织机纹、云纹、花卉纹的宋锦，这件衣服只穿在孩子身上、是孩子身上唯一的一件，不会单独出现在画面别处' },
  jiazhi_boy:  { file: 'assets/outfit/jiazhi_boy.webp',  label: '木褐短袍', brief: '木褐黛青米白的宋式短袍配布裤，外搭深色围裙，袖口腰封肩部有几何纹、回纹、莲纹的宋锦，这件衣服只穿在孩子身上、是孩子身上唯一的一件，不会单独出现在画面别处' },
  /* 8 点茶小食 · 冰裂纹 */
  neishi_girl: { file: 'assets/outfit/neishi_girl.webp', label: '浅杏窄袖衫', brief: '浅杏青绿淡粉的宋制窄袖衫配长裙，衫缘裙腰披帛有菊花纹、海棠纹、细格纹的宋锦' },
  neishi_boy:  { file: 'assets/outfit/neishi_boy.webp',  label: '茶褐圆领袍', brief: '茶褐黛青米白的宋式圆领袍配深色短褂，袍缘袖缘腰封有茶花纹、回纹、云纹的宋锦' },
  /* 9 琴室听琴 · 云纹回纹 */
  qinshi_girl: { file: 'assets/outfit/qinshi_girl.webp', label: '浅青褙子', brief: '浅青象牙白淡紫的宋制褙子配长裙，褙子边缘裙门披帛有兰花纹、云纹、水波纹的宋锦' },
  qinshi_boy:  { file: 'assets/outfit/qinshi_boy.webp',  label: '月白长衫', brief: '月白黛青墨绿的宋式长衫配深青外袍，袍缘袖缘腰封有云纹、莲纹、古琴纹的宋锦' },
  /* 10 粉墨登场（戏台）· 凤穿花团花 */
  xitai_girl: { file: 'assets/outfit/xitai_girl.webp', label: '水红戏服', brief: '水红银青白色的宋制褙子配长裙戏服，披帛裙腰袖口有凤凰纹、海棠纹、如意纹的宋锦，这件衣服只穿在孩子身上、是孩子身上唯一的一件，不会单独出现在画面别处' },
  xitai_boy:  { file: 'assets/outfit/xitai_boy.webp',  label: '朱砂圆领袍', brief: '朱砂墨黑金色的改良宋制戏服式圆领袍，肩袖腰封下摆有团花纹、牡丹纹、回纹边的宋锦，这件衣服只穿在孩子身上、是孩子身上唯一的一件，不会单独出现在画面别处' },
};

/* ---------------- 配置存取 ---------------- */

const LS = 'songjin.xmax.cfg.v1';

const DEFAULT_CFG = {
  key: '',
  env: 'china',
  model: 'x2.1',
  ratio: 'land',
  outfit: 'shuchang_girl',
  gender: 'girl',
  face: true,
  sound: true,
  mirror: false,
  // 留空 = 每个场景用自带的 3 条玩法提示（SCENES[i].acts）；填了则全部场景都用这里填的
  lines: '',
  promptAppend: '',
};

let cfg = { ...DEFAULT_CFG };
try {
  const raw = localStorage.getItem(LS);
  if (raw) cfg = { ...DEFAULT_CFG, ...JSON.parse(raw) };
} catch (e) {}
// 镜像方向强制走代码默认值，忽略本地缓存的旧值（曾因反复调整导致缓存了错误方向）
cfg.mirror = DEFAULT_CFG.mirror;
// 旧版把一份通用台词存在缓存里，会把新的场景自带提示盖掉；这条旧默认值当作“没填”处理
if (cfg.lines && cfg.lines.indexOf('给身边的人行个礼') === 0) cfg.lines = '';

function saveCfg() {
  try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) {}
}

/* ---------------- 运行态 ---------------- */

const S = {
  client: null,
  rt: null,
  local: null,
  remoteStream: null,
  refPath: null,          // 已上传的参考图路径
  refKey: null,           // 上传时用的 outfit key，用于判断是否需要重传
  refCache: {},           // { girl: path, boy: path }
  scene: 0,
  generating: false,
  starting: false,
  lastSwitch: 0,
  startedAt: 0,
  recorder: null,
  recChunks: [],
  recTimer: null,
  recStart: 0,
  lines: [],
  lineIdx: 0,
  frames: 0,
  lastFpsAt: 0,
  fps: 0,
  delayMs: null,
  stageReady: false,
};

/* ---------------- DOM ---------------- */

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const veil2 = $('veil2');
const hud = $('hud');
const dock = $('dock');
const dot = $('dot');
const statText = $('statText');
const statMeta = $('statMeta');
const sceneTag = $('sceneTag');
const taskCard = $('taskCard');
const gate = $('gate');
const gateNote = $('gateNote');
const setup = $('setup');
const scenesEl = $('scenes');
const recBar = $('recBar');
const recTime = $('recTime');
const btnBack = $('btnBack');

/* ---------------- 提示 ---------------- */

function setStat(kind, text, meta) {
  dot.className = kind || '';
  statText.textContent = text;
  statMeta.textContent = meta || '';
}

let tagTimer = 0;
function flashScene(name) {
  sceneTag.textContent = name;
  sceneTag.classList.add('on');
  clearTimeout(tagTimer);
  tagTimer = setTimeout(() => sceneTag.classList.remove('on'), 1800);
}

/* ---------------- 声音：配音 / 键盘 / 场景声景 ----------------
   · 配音：每个场景预先合成好的 mp3 + 句级时间轴，字幕跟着语音逐字浮现
   · 键盘：从 keyboard.mp3 里切出真实单键，300ms 一下
   · 声景：场景环境声现场合成 + 背景乐循环，人声一开口一起退下去
   -------------------------------------------- */
const VOICE_VOL = 0.5;      // 人声
const BGM_DUCK = 0.055;     // 人声期间的音乐
const KEY_VOL = 0.42;       // 键盘声
const KEY_GAP = 0.30;       // 两次击打的最小间隔（秒）

const SND = {
  ctx: null, master: null, kbGain: null, kb: [], kbAt: 0,
  bgmEl: null, loading: null, resumed: false,
  noise: null, musicKey: null, ducked: false, hidden: false,
  bgmWasPlaying: false, narrWasPlaying: false,
  recDest: null, recBus: null,
};

function sndCtx() {
  if (SND.ctx) return SND.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const c = new AC();
  SND.ctx = c;
  SND.master = c.createGain();
  SND.master.gain.value = 1;
  SND.master.connect(c.destination);
  SND.kbGain = c.createGain();
  SND.kbGain.gain.value = KEY_VOL;
  SND.kbGain.connect(SND.master);

  /* 录制专用混音口：游戏里所有声音都汇到这里，录屏时作为音轨录进去。
     以前录进去的是服务端那条流的声音，又轻又卡，还听不见配音和键盘。
     末级加一点增益和限幅——手机外放听回放时不会太小声，也不至于爆掉。 */
  try {
    SND.recDest = c.createMediaStreamDestination();
    SND.recBus = c.createGain();
    SND.recBus.gain.value = 1.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    SND.recBus.connect(comp).connect(SND.recDest);
    SND.master.connect(SND.recBus);
  } catch (e) { SND.recDest = null; }

  return c;
}

/* 让 <audio> 元素也走 Web Audio：
   这样既能照常听到，又能同时汇进录制混音口。
   一个元素只能接一次，接上之后声音就只从图上走，所以必须同时连到扬声器。 */
function elementInGraph(el) {
  if (!el || el._inGraph) return;
  const c = sndCtx();
  if (!c) return;
  try {
    const src = c.createMediaElementSource(el);
    src.connect(c.destination);
    if (SND.recBus) src.connect(SND.recBus);
    el._inGraph = true;
  } catch (e) {}
}

/* 浏览器规定：必须有用户手势才能出声 */
function sndResume() {
  const c = sndCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

/* 键盘：加载一次，把整段录音切成一个个单键 */
function loadKeyboard() {
  if (SND.loading) return SND.loading;
  const c = sndCtx();
  if (!c) return Promise.resolve();
  SND.loading = fetch('assets/audio/keyboard.mp3')
    .then(r => r.arrayBuffer())
    .then(b => c.decodeAudioData(b))
    .then(ab => {
      const d = ab.getChannelData(0), sr = ab.sampleRate, n = d.length;
      const w = Math.floor(sr * 0.01), env = [];
      for (let i = 0; i + w < n; i += w) {
        let s = 0;
        for (let j = 0; j < w; j++) s += Math.abs(d[i + j]);
        env.push(s / w);
      }
      let mx = 0;
      for (let i = 0; i < env.length; i++) if (env[i] > mx) mx = env[i];
      const onsets = [];
      let above = false;
      for (let i = 0; i < env.length; i++) {
        if (env[i] > mx * 0.30 && !above) { onsets.push(i * 10); above = true; }
        if (env[i] < mx * 0.12) above = false;
      }
      for (let k = 0; k < onsets.length; k++) {
        const gapMs = k < onsets.length - 1 ? onsets[k + 1] - onsets[k] : 300;
        if (gapMs < 80) continue;              // 两击太近，切出来会带进下一击
        const t0 = Math.max(0, onsets[k] / 1000 - 0.03);
        const dur = Math.min(0.26, Math.max(0.10, gapMs / 1000 * 0.85));
        const s0 = Math.floor(t0 * sr), len = Math.floor(dur * sr);
        if (s0 + len > n) continue;
        const seg = c.createBuffer(1, len, sr), out = seg.getChannelData(0);
        const fi = Math.floor(sr * 0.004), fo = Math.floor(sr * 0.02);
        for (let i = 0; i < len; i++) {
          let g = 1;
          if (i < fi) g = i / fi;
          if (len - i < fo) g = Math.min(g, (len - i) / fo);
          out[i] = d[s0 + i] * g;
        }
        SND.kb.push(seg);
      }
    })
    .catch(() => {});
  return SND.loading;
}

/* 敲一下：300ms 内不重复，音高轻微浮动 */
function keyHit(force) {
  const c = SND.ctx;
  if (!c || !SND.kb.length) return;
  const t = c.currentTime;
  if (!force && t - SND.kbAt < KEY_GAP) return;
  SND.kbAt = t;
  const buf = SND.kb[Math.floor(Math.random() * SND.kb.length)];
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.96 + Math.random() * 0.08;
  const g = c.createGain();
  g.gain.value = 0.85 + Math.random() * 0.3;
  src.connect(g).connect(SND.kbGain);
  src.start(t + 0.002);
}

/* ---------------- 场景声景 + 背景乐 ----------------
   十个场景归成五个"声景家族"，相似的共用（室内 / 水岸 / 市井 / 织坊 / 戏台）：
     · 环境声用 Web Audio 现场合成——不下载、不占体积、没有版权问题
     · 背景乐是真录音，两个曲子按家族轮换，每个场景从不同段落进
     · 人声一开口，音乐和环境声一起退下去
     -------------------------------------------- */

/* 场景 → 声景家族 */
const SOUNDSCAPE = {
  shuchang: 'room',   neishi: 'room',   qinshi: 'room',
  kunqu: 'water',     hupan: 'water',
  jishi: 'market',    denghui: 'night',
  zhifang: 'loom',    jiazhi: 'loom',
  xitai: 'stage',
};

/* 音乐：只有两首真曲子，按家族挑，靠起始段落 / 速度拉开差异 */
const MUSIC = {
  room:   { file: 'assets/audio/bgm.mp3',       vol: 0.15, rate: 0.99, offset: 0 },
  water:  { file: 'assets/audio/bgm_water.mp3', vol: 0.15, rate: 1.00, offset: 0 },
  night:  { file: 'assets/audio/bgm_water.mp3', vol: 0.12, rate: 0.94, offset: 62 },
  market: { file: 'assets/audio/bgm.mp3',       vol: 0.12, rate: 1.06, offset: 96 },
  loom:   { file: 'assets/audio/bgm.mp3',       vol: 0.11, rate: 1.02, offset: 42 },
  stage:  { file: 'assets/audio/bgm_water.mp3', vol: 0.11, rate: 0.96, offset: 78 },
};

const AMB_VOL = 2.0;     // 环境声总电平（各层内部很小，这里整体抬一档）
const AMB_DUCK = 0.45;   // 人声期间的环境声

const AMB = { kind: null, out: null, stop: [] };

/* 一段布朗噪声，所有环境层的底料，只生成一次 */
function ambNoise(c) {
  if (SND.noise) return SND.noise;
  const len = Math.floor(c.sampleRate * 3);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.4;
  }
  SND.noise = buf;
  return buf;
}

/* 一层持续的噪声：水、风、人声底都是它 */
function ambLoop(c, out, type, freq, q, vol) {
  const src = c.createBufferSource();
  src.buffer = ambNoise(c);
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(out);
  src.start();
  return { src, f, g };
}

/* 给某个参数加慢速摆动，声音才"活" */
function ambLfo(c, param, rate, depth, base) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = rate;
  g.gain.value = depth;
  param.value = base;
  o.connect(g).connect(param);
  o.start();
  return o;
}

/* 鸟叫：两三声短促的滑音 */
function ambChirp(c, out, t) {
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const at = t + i * (0.075 + Math.random() * 0.055);
    const o = c.createOscillator();
    const g = c.createGain();
    const f0 = 2050 + Math.random() * 900;
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.5, at + 0.045);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.9, at + 0.085);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.045 + Math.random() * 0.03, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
    o.connect(g).connect(out);
    o.start(at); o.stop(at + 0.14);
  }
}

/* 轻碰：瓷碗、木器 */
function ambClick(c, out, t, freq, vol, dur) {
  const src = c.createBufferSource();
  src.buffer = ambNoise(c);
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 7;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.1));
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.6, 0.5);
}

/* 闷响：脚步、木梭落底、织机打纬 */
function ambThud(c, out, t, f0, vol, len) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (len || 0.19));
  o.connect(g).connect(out);
  o.start(t); o.stop(t + (len || 0.19) + 0.02);
}

/* 远处锣：不和谐分音 + 长衰减 */
function ambGong(c, out, t, vol) {
  [196, 347, 503, 741, 1103].forEach((f, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = f * (0.994 + Math.random() * 0.012);
    const v = (vol || 0.05) / (i * 0.7 + 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 - i * 0.28);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 2.6);
  });
}

/* 远处吆喝：一个带共振峰的滑音，闷在低通里像隔了条街 */
function ambCall(c, out, t, vol) {
  const base = 160 + Math.random() * 50;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 700; f1.Q.value = 4;
  const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 5;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
  const g = c.createGain();
  const dur = 0.6 + Math.random() * 0.35;
  o.frequency.setValueAtTime(base, t);
  o.frequency.linearRampToValueAtTime(base * 1.32, t + dur * 0.35);
  o.frequency.linearRampToValueAtTime(base * 0.9, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.1);
  g.gain.setValueAtTime(vol, t + dur * 0.68);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f1); o.connect(f2);
  f1.connect(g); f2.connect(g);
  g.connect(lp).connect(out);
  o.start(t); o.stop(t + dur + 0.1);
}

/* 五个家族：bed 是持续层，event 是随机点缀 */
const AMB_FAMILY = {
  /* 室内：书场、点茶、琴室 —— 极轻的屋子底噪 + 偶有瓷响 */
  room: {
    bed(c, out) {
      const a = ambLoop(c, out, 'lowpass', 360, 0.7, 0.045);
      ambLfo(c, a.g.gain, 0.05, 0.018, 0.045);
      return () => a.src.stop();
    },
    every: 6200,
    event(c, out, t) {
      if (Math.random() < 0.45) ambClick(c, out, t, 2200 + Math.random() * 1400, 0.035, 0.13);
      else ambThud(c, out, t, 120, 0.02, 0.16);
    },
  },

  /* 水岸：水榭、园池 —— 水波 + 风 + 鸟 */
  water: {
    bed(c, out) {
      const a = ambLoop(c, out, 'bandpass', 820, 0.6, 0.075);
      ambLfo(c, a.f.frequency, 0.11, 210, 820);
      ambLfo(c, a.g.gain, 0.07, 0.022, 0.075);
      const b = ambLoop(c, out, 'lowpass', 240, 0.6, 0.055);
      ambLfo(c, b.g.gain, 0.045, 0.02, 0.055);
      return () => { a.src.stop(); b.src.stop(); };
    },
    every: 5200,
    event(c, out, t) {
      ambChirp(c, out, t);
    },
  },

  /* 市井：山塘集市 —— 人声轰鸣 + 脚步 + 偶有一声吆喝 */
  market: {
    bed(c, out) {
      const layers = [
        { f: 360, q: 1.1, v: 0.055, r: 0.09 },
        { f: 620, q: 1.4, v: 0.045, r: 0.13 },
        { f: 940, q: 1.8, v: 0.03, r: 0.17 },
      ];
      const nodes = layers.map(L => {
        const a = ambLoop(c, out, 'bandpass', L.f, L.q, L.v);
        ambLfo(c, a.g.gain, L.r, L.v * 0.55, L.v);
        return a;
      });
      return () => nodes.forEach(n => n.src.stop());
    },
    every: 1900,
    event(c, out, t) {
      const r = Math.random();
      if (r < 0.55) ambThud(c, out, t, 95 + Math.random() * 25, 0.022, 0.14);
      else if (r < 0.85) ambClick(c, out, t, 1600 + Math.random() * 900, 0.02, 0.1);
      else ambCall(c, out, t, 0.05);
    },
  },

  /* 夜市：山塘灯会 —— 水声打底，人声疏一些，偶尔一声铜铃 */
  night: {
    bed(c, out) {
      const a = ambLoop(c, out, 'bandpass', 760, 0.7, 0.05);
      ambLfo(c, a.f.frequency, 0.08, 160, 760);
      const b = ambLoop(c, out, 'bandpass', 520, 1.4, 0.03);
      ambLfo(c, b.g.gain, 0.11, 0.017, 0.03);
      return () => { a.src.stop(); b.src.stop(); };
    },
    every: 4200,
    event(c, out, t) {
      if (Math.random() < 0.3) ambClick(c, out, t, 3200, 0.03, 0.5);   // 铜铃
      else ambCall(c, out, t, 0.028);
    },
  },

  /* 织坊：梭子来回 + 打纬 */
  loom: {
    bed(c, out) {
      const a = ambLoop(c, out, 'lowpass', 420, 0.8, 0.04);
      return () => a.src.stop();
    },
    every: 620,
    event(c, out, t) {
      ambThud(c, out, t, 105, 0.05, 0.12);                       // 打纬
      ambClick(c, out, t + 0.02, 1700 + Math.random() * 500, 0.028, 0.07);  // 木件
      if (Math.random() < 0.5) ambClick(c, out, t + 0.3, 2600, 0.016, 0.05); // 梭子
    },
  },

  /* 戏台：锣鼓点 + 后台人声 */
  stage: {
    bed(c, out) {
      const a = ambLoop(c, out, 'bandpass', 500, 1.3, 0.032);
      ambLfo(c, a.g.gain, 0.12, 0.018, 0.032);
      return () => a.src.stop();
    },
    every: 2600,
    event(c, out, t) {
      const r = Math.random();
      if (r < 0.5) {
        ambThud(c, out, t, 88, 0.06, 0.22);
        ambThud(c, out, t + 0.17, 78, 0.045, 0.2);
      } else if (r < 0.78) {
        ambGong(c, out, t, 0.05);
      } else {
        ambCall(c, out, t, 0.03);
      }
    },
  },
};

function ambStart(kind) {
  const c = sndCtx();
  if (!c || AMB.kind === kind) return;
  ambStop();
  const fam = AMB_FAMILY[kind] || AMB_FAMILY.room;
  AMB.kind = kind;

  const out = c.createGain();
  out.gain.value = 0;
  out.connect(SND.master);
  AMB.out = out;

  const now = c.currentTime;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(SND.ducked ? AMB_DUCK : AMB_VOL, now + 2.4);

  const stops = [];
  if (fam.bed) { const s = fam.bed(c, out); if (s) stops.push(s); }

  let next = now + 1 + Math.random() * 2.5;
  const timer = setInterval(() => {
    if (!AMB.out) return;
    const t = c.currentTime;
    let guard = 0;
    while (next < t + 1.2 && guard++ < 6) {
      fam.event(c, out, Math.max(next, t + 0.03));
      next += fam.every * (0.6 + Math.random() * 0.9);
    }
  }, 400);
  stops.push(() => clearInterval(timer));
  AMB.stop = stops;
}

function ambStop() {
  const out = AMB.out;
  const stops = AMB.stop;
  const c = SND.ctx;
  AMB.out = null; AMB.kind = null; AMB.stop = [];
  if (!out) return;
  if (c) {
    try {
      const t = c.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.8);
    } catch (e) {}
  }
  setTimeout(() => {
    stops.forEach(fn => { try { fn(); } catch (e) {} });
    try { out.disconnect(); } catch (e) {}
  }, 950);
}

/* 元素音量不能渐变，用短定时器走 */
function fadeTo(a, target, ms) {
  clearInterval(a._fade);
  const step = ms / 30;
  a._fade = setInterval(() => {
    const d = target - a.volume;
    if (Math.abs(d) < 0.006) { a.volume = Math.max(0, target); clearInterval(a._fade); return; }
    a.volume = Math.max(0, Math.min(1, a.volume + d / step));
  }, 30);
}

/* 换场景就换音乐：先淡出，再换曲，从该场景的段落进 */
function musicSet(kind) {
  if (SND.musicKey === kind) return;
  SND.musicKey = kind;
  const m = MUSIC[kind] || MUSIC.room;
  let a = SND.bgmEl;
  if (!a) {
    a = new Audio();
    a.loop = true;
    a.preload = 'auto';
    a.volume = 0;
    SND.bgmEl = a;
  }
  elementInGraph(a);
  clearInterval(a._fade);
  a._fade = setInterval(() => {
    if (a.volume <= 0.012) {
      clearInterval(a._fade);
      a.src = m.file;
      a.playbackRate = m.rate || 1;
      a.volume = 0;
      const seek = () => { try { a.currentTime = m.offset || 0; } catch (e) {} };
      if (a.readyState >= 1) seek();
      else a.addEventListener('loadedmetadata', seek, { once: true });
      a.play().catch(() => {});
      fadeTo(a, SND.ducked ? BGM_DUCK : m.vol, 900);
      return;
    }
    a.volume = Math.max(0, a.volume - 0.02);
  }, 30);
}

/* 人声一开口：音乐和环境声一起退下去 */
function duckBgm(ducked) {
  SND.ducked = ducked;
  const m = MUSIC[SND.musicKey] || MUSIC.room;
  if (SND.bgmEl) fadeTo(SND.bgmEl, ducked ? BGM_DUCK : m.vol, 300);
  const c = SND.ctx;
  if (AMB.out && c) {
    try {
      const t = c.currentTime;
      AMB.out.gain.cancelScheduledValues(t);
      AMB.out.gain.setValueAtTime(AMB.out.gain.value, t);
      AMB.out.gain.linearRampToValueAtTime(ducked ? AMB_DUCK : AMB_VOL, t + 0.3);
    } catch (e) {}
  }
}

/* 切到别的 App / 锁屏 / 换标签页：所有声音先停，回来接着放 */
function soundPause() {
  if (SND.hidden) return;
  SND.hidden = true;
  try { if (SND.ctx && SND.ctx.state === 'running') SND.ctx.suspend(); } catch (e) {}
  const a = SND.bgmEl;
  if (a && !a.paused) { SND.bgmWasPlaying = true; a.pause(); }
  if (narr && narr.el && !narr.el.paused) { SND.narrWasPlaying = true; narr.el.pause(); }
  try { if ('speechSynthesis' in window) window.speechSynthesis.pause(); } catch (e) {}
}

function soundResume() {
  if (!SND.hidden) return;
  SND.hidden = false;
  try { if (SND.ctx && SND.ctx.state === 'suspended') SND.ctx.resume(); } catch (e) {}
  const a = SND.bgmEl;
  if (a && SND.bgmWasPlaying) a.play().catch(() => {});
  if (narr && narr.el && SND.narrWasPlaying) narr.el.play().catch(() => {});
  SND.bgmWasPlaying = false;
  SND.narrWasPlaying = false;
  try { if ('speechSynthesis' in window) window.speechSynthesis.resume(); } catch (e) {}
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) soundPause();
  else soundResume();
});
window.addEventListener('pagehide', soundPause);
window.addEventListener('pageshow', () => soundResume());

/* 进场景：音乐 + 环境声一起换成这一处的 */
function sceneSound(id) {
  const kind = SOUNDSCAPE[id] || 'room';
  musicSet(kind);
  ambStart(kind);
}

/* 当前正在播的配音。
   iPad 上不要频繁 new Audio()——媒体元素多了 Safari 会闹脾气，
   统一用一个元素，换 src 就相当于切音轨。 */
const narrEl = new Audio();
narrEl.preload = 'auto';
let narr = null;
let narrSeq = 0;        // 每次开新的一段就 +1，旧的异步回调看到不一致就自行退出

function stopNarr() {
  narrSeq++;                       // 让还在路上的异步回调（fetch/play）作废
  if (!narr) return;
  if (narr.raf) cancelAnimationFrame(narr.raf);
  try { narr.el.pause(); } catch (e) {}
  narr = null;
  duckBgm(false);
}

/* 播一段配音，同时把字幕按语音时间轴逐字打出来。
   注意：fetch 和 play 都是异步的，中途可能已经被下一段顶掉——
   每个 await 之后都要确认自己还是"当前这一段"，否则会出现两段声音叠着放。 */
async function narrate(opt) {
  stopNarr();
  stopSpeak();
  const seq = ++narrSeq;
  const el = narrEl;
  elementInGraph(el);          // 配音也要进录制混音口
  el.volume = VOICE_VOL;
  if (el.getAttribute('src') !== opt.audio) el.src = opt.audio;
  else { try { el.currentTime = 0; } catch (e) {} }
  const n = { el, raf: 0, chars: [], shown: 0, target: opt.target, cursor: !!opt.cursor, seq };
  narr = n;

  let meta = null;
  try { meta = await (await fetch(opt.json)).json(); } catch (e) {}
  if (seq !== narrSeq) { try { el.pause(); } catch (e) {} return; }

  const chars = [];
  if (meta && meta.sentences && meta.sentences.length) {
    meta.sentences.forEach(s => {
      const len = s.text.length;
      for (let k = 0; k < len; k++) chars.push({ ch: s.text[k], t: s.t + s.d * k / len });
    });
  } else {
    for (let k = 0; k < opt.text.length; k++) chars.push({ ch: opt.text[k], t: k * 150 });
  }
  n.chars = chars;
  opt.target.textContent = '';
  if (n.cursor) opt.target.classList.add('typing');

  const paint = (upto) => {
    opt.target.textContent = chars.slice(0, upto).map(o => o.ch).join('');
  };

  try {
    await el.play();
  } catch (e) {
    if (seq !== narrSeq) return;
    // 声音播不出来就退回纯打字，至少字幕还在走
    let k = 0;
    const timer = setInterval(() => {
      if (seq !== narrSeq) { clearInterval(timer); return; }
      k++;
      paint(k);
      if (k % 2 === 0) keyHit();
      if (k >= chars.length) {
        clearInterval(timer);
        if (n.cursor) opt.target.classList.remove('typing');
        if (opt.after) opt.after();
      }
    }, 150);
    n.el = { pause() { clearInterval(timer); } };
    return;
  }

  // play() 期间被下一段顶掉了：立刻停，别让它出声
  if (seq !== narrSeq) { try { el.pause(); } catch (e) {} return; }

  duckBgm(true);
  el.onended = () => {
    if (seq !== narrSeq) return;
    paint(chars.length);
    if (n.cursor) opt.target.classList.remove('typing');
    duckBgm(false);
    if (opt.after) opt.after();
  };

  const loop = () => {
    if (seq !== narrSeq) return;
    const now = el.currentTime * 1000;
    while (n.shown < chars.length && chars[n.shown].t <= now) {
      const c = chars[n.shown];
      if (c.ch !== '，' && c.ch !== '。' && n.shown % 2 === 0) keyHit();
      n.shown++;
    }
    paint(n.shown);
    n.raf = requestAnimationFrame(loop);
  };
  n.raf = requestAnimationFrame(loop);
}

/* 过场字幕：进场景时在画面底部，跟着配音逐字打出。
   题头是「苏州 · 地点」，正文是"在哪、你是谁、干嘛"。 */
const introCard = $('introCard');
const introText = $('introText');
const introPlace = $('introPlace');
let introTimer = 0;

function showIntro(i) {
  const s = SCENES[i];
  if (!s || !s.intro) return;
  hideTask();
  sceneSound(s.id);            // 音乐和环境声跟着换到这一处
  introPlace.textContent = s.place || s.name;
  introCard.classList.add('on');
  clearTimeout(introTimer);
  narrate({
    text: s.intro,
    audio: `assets/voice/${s.id}.mp3`,
    json: `assets/voice/${s.id}.json`,
    target: introText,
    cursor: true,
    after: () => {
      clearTimeout(introTimer);
      introTimer = setTimeout(() => introCard.classList.remove('on'), 6000);
    },
  });
  // 兜底：万一音频卡住，40 秒后也让字幕条退场
  introTimer = setTimeout(() => introCard.classList.remove('on'), 40000);
}

function hideIntro() {
  introCard.classList.remove('on');
  clearTimeout(introTimer);
  stopNarr();
  introText.classList.remove('typing');
}

/* 当前场景的「台词提示」：老师自己在设置里填了就用填的（全部场景通用）；
   没填就用场景自带的 3 条动作提示。 */
function curLines() {
  if (S.lines.length) return S.lines;
  const s = SCENES[S.scene];
  return (s && s.acts) || [];
}

function showTask(idx) {
  const L = curLines();
  if (!L.length) { taskCard.classList.remove('on'); return; }
  hideIntro();          // 字幕条和台词卡同一个位置，切成台词卡
  const t = taskCard.querySelector('.tk-text');
  taskCard.classList.add('on');
  const s = SCENES[S.scene];
  const i = idx % L.length;
  if (S.lines.length || !s) {
    // 老师在设置里自己写的台词，没有预生成音频，只能用系统朗读
    t.textContent = L[i];
    speak(t.textContent);
    return;
  }
  narrate({
    text: L[i],
    audio: `assets/voice/act_${s.id}_${i}.mp3`,
    json: `assets/voice/act_${s.id}_${i}.json`,
    target: t,
    cursor: false,
  });
}

function hideTask() { taskCard.classList.remove('on'); stopNarr(); }

/* 点画面 / 按 T：过场字幕 → 台词提示逐条 → 又回到过场字幕 */
function cycleHint() {
  if (introCard.classList.contains('on')) { S.lineIdx = 0; showTask(0); return; }
  const L = curLines();
  if (taskCard.classList.contains('on')) {
    S.lineIdx++;
    if (S.lineIdx >= L.length) { hideTask(); S.lineIdx = 0; showIntro(S.scene); }
    else showTask(S.lineIdx);
    return;
  }
  showIntro(S.scene);
}

/* ---------------- 画面合成 ----------------
   Xmax 换背景时，人物两侧总留着一片没画到的地方。这个改不动，所以不去改它，
   而是让这块区域落在画面边缘——反正舞台是满屏的，边缘本来就少有人注意。

   这一层的真正职责是：显示、录制、拍照都从同一张 canvas 取，
   三处出来完全一致，录像导出来就是大屏上看到的样子。
   -------------------------------------------- */

const COMP = {
  cv: null, ctx: null, raf: 0, on: false,
  painted: false,   // 有没有画过至少一帧（没画过才铺黑底）
  stall: 0,         // 连续多少帧拿不到画面
};

function compInit() {
  if (COMP.cv) return;
  const cv = document.createElement('canvas');
  cv.id = 'comp';
  // 插在 #veil2 之前：未出画的暗底和上下压暗都要盖在画上
  $('stageWrap').insertBefore(cv, $('veil2'));
  COMP.cv = cv;
  COMP.ctx = cv.getContext('2d');
  compResize();
  window.addEventListener('resize', compResize);
}

function compResize() {
  if (!COMP.cv) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  let W = Math.round(window.innerWidth * dpr);
  let H = Math.round(window.innerHeight * dpr);
  const k = Math.min(1, 1920 / W, 1080 / H);
  COMP.cv.width = Math.max(2, Math.round(W * k));
  COMP.cv.height = Math.max(2, Math.round(H * k));
  /* 改尺寸会把画布清空（iPad 转屏时就会黑一下），立刻补画一帧 */
  if (COMP.on) { COMP.painted = false; compFrame(); }
}


function compLoop() {
  if (!COMP.on) return;
  compFrame();
  COMP.raf = requestAnimationFrame(compLoop);
}

function compStart() {
  compInit();
  if (COMP.on) return;
  COMP.on = true;
  compLoop();
}

function compStop() {
  COMP.on = false;
  COMP.painted = false;
  COMP.stall = 0;
  cancelAnimationFrame(COMP.raf);
  const ctx = COMP.ctx, cv = COMP.cv;
  if (ctx && cv) {
    ctx.fillStyle = '#0b0a08';
    ctx.fillRect(0, 0, cv.width, cv.height);
  }
}

function compFrame() {
  const cv = COMP.cv, ctx = COMP.ctx;
  if (!cv || !ctx) return;
  const W = cv.width, H = cv.height;
  const v = stage;

  /* 视频暂时没有尺寸（换场景、连接抖一下都会短暂出现）：
     保留上一帧，不要刷成黑屏——黑闪比卡住更吓人。
     只有连第一帧都还没画过时才铺暗底。 */
  if (!v.videoWidth) {
    if (!COMP.painted) { ctx.fillStyle = '#0b0a08'; ctx.fillRect(0, 0, W, H); }
    COMP.stall++;
    if (COMP.stall === 150 && S.generating) { try { v.play(); } catch (e) {} }
    return;
  }

  const vw = v.videoWidth, vh = v.videoHeight;

  COMP.stall = 0;
  COMP.painted = true;

  /* 视频铺满整屏，不做任何装裱、不模糊补边。
     直接按 cover 缩放铺满：Xmax 生成的就是满幅画面（背景+人一体），
     左右两侧不再是"放大模糊"的毛玻璃，而是真正的生成画面本身。 */
  const cover = Math.max(W / vw, H / vh);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  if (cfg.mirror) ctx.scale(-1, 1);
  ctx.drawImage(v, -vw * cover / 2, -vh * cover / 2, vw * cover, vh * cover);
  ctx.restore();
}

/* ---------------- 场景按钮 ---------------- */

function renderScenes() {
  scenesEl.innerHTML = '';
  SCENES.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'sc' + (i === S.scene ? ' on' : '');
    b.title = s.name;
    b.innerHTML = `<span class="n">${s.short}</span><span class="k">${s.key}</span>`;
    b.onclick = () => switchScene(i);
    scenesEl.appendChild(b);
  });
}

function syncOutfitBtns() {
  document.querySelectorAll('.of').forEach(b => b.classList.toggle('on', b.dataset.gender === cfg.gender));
}

/* ---------------- prompt ---------------- */

function buildPrompt() {
  const s = SCENES[S.scene];
  const o = OUTFITS[cfg.outfit] || OUTFITS.shuchang_girl;

  /* 一、画风。必须排最前，而且要短。 */
  let p = `${STYLE.brief}。`;

  /* 二、场景。bg 是环境骨架，folk 是近处中景的物件，sky 是头顶。
        多列些具体物件，画面才丰富不空洞；但一律只写"物"不写"人"。 */
  p += `画的是${s.bg}。`;
  if (s.folk) p += `近处还有${s.folk}。`;
  p += `人物头顶是${s.sky}。`;

  /* 二点五、真实背景强约束。摄像头拍进来的是真实环境（可能有椅子、
        柜子、衣架、墙上的挂件、杂物、别的人），这些一律要删掉，只保留
        画面中央的孩子，然后把背景整体替换成上面的宋代苏州场景。 */
  p += `摄像头里除了正中央那个孩子之外，周围和身后的一切真实物体——椅子、柜子、衣架、挂着的衣服、墙上的挂件、门、窗、杂物、任何家具、任何别的人——统统忽略并删除，一点都不要保留，不要把它们画进画面里；`;
  p += `只把正中央那个孩子保留下来，其余的背景全部替换成上面的宋代苏州场景；`;
  p += `背景里的物件只允许出现上面场景描述里写到的那些建筑和摆设，不要出现任何真实环境里的东西；`;

  /* 三、人物。写死"只有这一个孩子"——实测这是唯一能防分身的写法。
     背景一律不写人：只要 prompt 里出现"小贩/路人/听客"，
     模型就会把主角复制成三四个一样的孩子。热闹交给物件去表达。 */
  p += `画面正中间只站着唯一一个孩子，一个Q版卡通小孩，头大身小、圆润可爱、线条柔和、边缘清晰，人物只占画面较小一部分、不要贴满镜头，场景和建筑是主体，`;
  p += `小孩是正面平视、面对镜头的，穿${o.brief}（见参考图），衣服也画成Q版卡通样式、圆润可爱、线条柔和，和背景同一种画法，`;
  p += s.mask
    ? `脸上是昆剧花旦的妆：粉白的脸、吊起的眉、眼周红胭脂、一点小红唇；`
    : `脸是一张圆润可爱的Q版脸，眼睛大而有神、表情轻松，肤色干净均匀，脸上不要有杂色；`;
  p += `孩子的脸要干净完整，肤色均匀正常，脸上和脸周围不要出现蓝色、绿色、红色等杂色块，衣服的颜色不要染到脸上；`;
  /* 单人的硬约束：把"人/衣/挂件"三个最容易出错的维度全锁死，
     并明确禁止场景里出现任何"操作用具的人"（说书人、织女、点茶人等）。 */
  p += `整幅画里从头到尾只有这唯一一个孩子，绝对不要画出第二个孩子、不要复制、不要分身；`;
  p += `画面里不要出现任何别的人：没有说书人、没有织女、没有小贩、没有路人、没有听客、没有任何大人或旁人，一个多余的人都不许有；`;
  p += `衣服只有一套，只穿在这唯一一个孩子身上、正确贴合地穿在身上；`;
  p += `参考图里的那件衣服，只能变成孩子身上穿着的那一件衣服，绝对不要把它再复制一份、挂在背景里、披在椅子桌柜上、或摆在地面上；`;
  p += `孩子的头上、脑袋上不要长出衣服、帽子、云肩、头饰之类的任何东西，头上只有头发；`;
  p += `背景里也不要凭空多挂一件衣服、一件衣裳、一块布料在墙上、柱子上、椅子上或任何地方，场景里只有建筑和摆设；`;
  p += `背景里的墙、门、窗、桌椅、矮几、灯笼、柜子、花木这些摆设全都是静止的家具和风景，不是人、不是衣服，不要把任何一个画成一个人、不要给它安上一个脑袋、也不要画成一件衣服；`;
  p += `孩子身后、两侧、脑袋后面都不要出现任何多余的人影、人影轮廓、衣服轮廓或垂下来的布料；`;

  if (cfg.promptAppend.trim()) p += ' ' + cfg.promptAppend.trim();
  return p;
}

/* ---------------- 客户端 ---------------- */

function ensureClient() {
  const env = cfg.env === 'global' ? XmaxEnvironment.global : XmaxEnvironment.china;
  const model = cfg.model === 'x2.0' ? RealtimeModel.x2_0
    : cfg.model === 'x2.1-flash' ? RealtimeModel.x2_1_flash
    : RealtimeModel.x2_1;

  // 配置变了就重建
  if (S.client && S.clientEnv === env && S.clientModel === model) return;

  disposeClient();

  S.client = new XmaxClient(new XmaxConfiguration({ apiKey: cfg.key, environment: env }));
  S.rt = S.client.createRealtimeManager(new RealtimeConfiguration({ model }));
  S.clientEnv = env;
  S.clientModel = model;

  bindListeners();
}

function disposeClient() {
  if (S.rt) { try { S.rt.close(); } catch (e) {} }
  S.rt = null;
  S.client = null;
  /* 停掉本机摄像头/麦克风轨道，否则结束/失败后摄像头灯常亮、资源不释放 */
  if (S.local) {
    try { S.local.getTracks().forEach(t => t.stop()); } catch (e) {}
  }
  S.local = null;
  S.generating = false;
  S.stageReady = false;
  compStop();
}

/* 监听器的返回值在新旧版本里可能同步、可能 Promise，统一兜住 */
function safeSet(fn, ...args) {
  try {
    const r = fn(...args);
    if (r && typeof r.catch === 'function') r.catch(() => {});
    return r;
  } catch (e) {
    console.warn('listener bind failed', e);
  }
}

function bindListeners() {
  const rt = S.rt;

  safeSet(rt.setStateListener.bind(rt), (st) => {
    const c = st.connectionState;
    $('dgState').textContent = c;
    if (st.sessionID) $('dgSess').textContent = st.sessionID.slice(0, 10);

    if (c === 'Connecting' || c === 'Preparing') setStat('busy', '正在连上宋代…');
    else if (c === 'Starting') setStat('busy', '正在换衣裳…');
    else if (c === 'Generating') setStat('ok', '已穿越', S.fps ? `${S.fps}fps` : '');
    else if (c === 'Connected') setStat('busy', '已连通，等待出画');
    else if (c === 'Idle') setStat('', '未开始');
    else if (c === 'Disconnecting') setStat('busy', '正在收起…');

    // 掉线要能让老师知道
    if (st.reason && st.reason.kind && String(st.reason.kind).toLowerCase().includes('error')) {
      setStat('err', '出错了', String(st.reason.message || '').slice(0, 30));
    }
  });

  safeSet(rt.setRemoteMediaTracksListener.bind(rt), (tracks) => {
    if (!tracks || !tracks.videoTrack) return;
    attachStream(tracks.videoTrack, tracks.audioTrack);
  });

  safeSet(rt.setDownlinkVideoStatisticsListener.bind(rt), (s) => {
    if (!s) return;
    if (typeof s.renderFrameRate === 'number') S.fps = Math.round(s.renderFrameRate);
    if (typeof s.endToEndDelayMs === 'number') S.delayMs = Math.round(s.endToEndDelayMs);
    $('dgFrame').textContent = `${S.fps}fps · ${S.delayMs != null ? S.delayMs + 'ms' : '—'}`;
    if (S.generating) statMeta.textContent = `${S.fps}fps · ${S.delayMs != null ? S.delayMs + 'ms' : ''}`;
  });
}

function attachStream(videoTrack, audioTrack) {
  if (!videoTrack) return;

  const tracks = [videoTrack];

  // 新会话的音频可能还没发布：沿用旧流里还活着的音轨，别让声音在换场景时断掉
  if (audioTrack) {
    tracks.push(audioTrack);
  } else if (S.remoteStream) {
    const oldAudio = S.remoteStream.getAudioTracks()[0];
    if (oldAudio && oldAudio.readyState === 'live') tracks.push(oldAudio);
  }

  // 已经是同一路流就不重挂，避免闪断。
  // 但即便是同一路流，也要把黑屏遮罩揭开、看门狗停掉——
  // 否则切换场景时服务端复用同一条流，画面其实已经好了，
  // 却因为没走下面的 play().then() 而一直被 veil2 黑屏盖住。
  if (S.remoteStream) {
    const cur = S.remoteStream.getVideoTracks()[0];
    if (cur && cur.id === videoTrack.id) {
      if (audioTrack && S.remoteStream.getAudioTracks().length === 0) S.remoteStream.addTrack(audioTrack);
      S.stageReady = true;
      veil2.classList.add('off');
      compStart();
      clearWatchdog();
      tunnelDone();
      return;
    }
  }

  const ms = new MediaStream(tracks);
  S.remoteStream = ms;
  stage.srcObject = ms;
  stage.muted = true;
  stage.play()
    .then(() => { S.stageReady = true; veil2.classList.add('off'); compStart(); clearWatchdog(); tunnelDone(); })
    .catch(() => {
      // 浏览器拦了有声自动播放，先静音起播，再由用户手势打开声音
      stage.muted = true;
      stage.play().then(() => { S.stageReady = true; veil2.classList.add('off'); compStart(); clearWatchdog(); tunnelDone(); }).catch(() => {});
    });
}

/* ---------------- 参考图 ---------------- */

async function ensureReference(keyWanted) {
  const key = keyWanted || cfg.outfit;
  if (S.refCache[key]) { S.refPath = S.refCache[key]; return S.refPath; }
  if (S.refPath && S.refKey === key) return S.refPath;

  const info = OUTFITS[key] || OUTFITS.shuchang_girl;
  const resp = await fetch(info.file);
  if (!resp.ok) throw new Error('衣冠参考图加载失败：' + info.file);
  const blob = await resp.blob();

  const storage = S.client.createStorageService();
  const stored = await storage.uploadImage({
    data: blob,
    fileName: `${key}_song.webp`,
    contentType: 'image/webp',
  });

  const path = stored.url || stored.objectKey;
  S.refCache[key] = path;
  S.refPath = path;
  S.refKey = key;
  return path;
}

/* ---------------- 开始 / 停止 ---------------- */

async function start() {
  if (!cfg.key) { openSetup(); gateNote.textContent = '请先填入 API Key 再开始'; return; }
  if (S.starting || S.generating) return;

  S.starting = true;
  $('btnGo').disabled = true;
  setStat('busy', '准备中…');
  armWatchdog();

  try {
    ensureClient();

    // 修正衣冠：按当前场景 + 性别，穿对应那一件（兼容旧配置里失效的 key）
    const wantOutfit = SCENES[S.scene].id + '_' + cfg.gender;
    if (OUTFITS[wantOutfit] && cfg.outfit !== wantOutfit) {
      cfg.outfit = wantOutfit;
      saveCfg();
      syncOutfitBtns();
    }

    if (!S.local) {
      const preset = cfg.ratio === 'port'
        ? RealtimeCameraPreset.resolution1080x1920
        : RealtimeCameraPreset.resolution1920x1080;

      S.local = await S.rt.createLocalCameraStream({
        preset,
        position: CameraPosition.front,
        useMicrophone: true,
      });
    }

    const refPath = await ensureReference();

    const remote = await S.rt.startGeneration({
      localStream: S.local,
      context: new RealtimeContext({ prompt: buildPrompt(), referencePath: refPath }),
      faceRestoration: false,
    });

    // 兜底：万一轨道监听还没到，直接用返回的轨道先挂上
    const nativeTrack = remote && remote.videoTrack && remote.videoTrack.mediaStreamTrack;
    if (nativeTrack && !S.remoteStream) attachStream(nativeTrack, null);

    S.generating = true;
    S.startedAt = Date.now();
    S.refPath = refPath;

    gate.classList.add('off');
    hud.classList.add('on');
    dock.classList.add('on');
    btnBack.classList.add('on');
    $('btnRec').disabled = false;
    $('btnShot').disabled = false;
    $('btnGo').innerHTML = '<span class="ic">■</span><span class="lb">结束</span>';
    $('btnGo').classList.remove('primary');
    flashScene(SCENES[S.scene].name);
    // 场景名不再用系统 TTS 念：配音一开始就会把它盖掉，听起来像两个声音打架
    showIntro(S.scene);            // 显示并朗读场景介绍

    startFpsTicker();
    startElapsedTicker();
  } catch (e) {
    fail(e);
  } finally {
    S.starting = false;
    $('btnGo').disabled = false;
  }
}

async function stop() {
  try {
    if (S.recorder && S.recorder.state === 'recording') stopRec();
    if (S.rt) await S.rt.close();
  } catch (e) {}

  // 整条链路丢掉重建，免得复用已关闭的会话
  disposeClient();
  S.refPath = null;
  S.refKey = null;
  S.refCache = {};
  S.remoteStream = null;
  S.stageReady = false;
  stage.srcObject = null;
  clearWatchdog();
  veil2.classList.remove('off');
  gate.classList.remove('off');
  resetMap();
  dock.classList.remove('on');
  hud.classList.remove('on');
  btnBack.classList.remove('on');
  hideTask();
  hideIntro();
  sceneSound('hupan');       // 回到地图，声景换成水岸，别留着集市的叫卖

  $('btnGo').innerHTML = '<span class="ic">▶</span><span class="lb">开始穿越</span>';
  $('btnGo').classList.add('primary');
  $('btnRec').disabled = true;
  $('btnShot').disabled = true;
  setStat('', '未开始');
  stopFpsTicker();
  /* 停掉计时器并归零，否则结束后后台仍每秒累加费用 */
  clearInterval(elapsedTimer);
  elapsedTimer = 0;
  S.startedAt = 0;
  /* 结束穿越：停语音 */
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
}

function fail(e) {
  const msg = (e && (e.message || e.toString())) || '未知错误';
  console.error(e);
  setStat('err', '出错了', msg.slice(0, 40));
  gateNote.textContent = msg.slice(0, 120);
  gate.classList.remove('off');
  btnBack.classList.remove('on');
  // 别让隧道瞬间消失，先淡出再复位地图
  tunnelDone();
  setTimeout(resetMap, 720);
  S.generating = false;
}

/* ---------------- 换场景 ---------------- */

let switchLock = false;

/* 每个场景都有专属衣冠（男女童各一套）。
   进哪个场景，就自动穿该场景、当前性别对应的那一件。
   只改配置，不碰生成流程；返回是否真的换了。 */
function noteSceneOutfit(i) {
  const want = SCENES[i].id + '_' + cfg.gender;
  if (!OUTFITS[want] || cfg.outfit === want) return false;
  cfg.outfit = want;
  saveCfg();
  syncOutfitBtns();
  return true;
}

async function switchScene(i) {
  if (i === S.scene) return;

  // 还没开始：只记下衣冠，等点「开始」时一起生效
  if (!S.generating) {
    S.scene = i;
    renderScenes();
    flashScene(SCENES[i].name);
    noteSceneOutfit(i);
    return;
  }
  if (switchLock) return;

  // 连点会堆积请求，节流 900ms
  const now = Date.now();
  if (now - S.lastSwitch < 900) return;
  S.lastSwitch = now;

  // 所有 guard 通过后，才真正改状态，避免状态与画面脱节
  S.scene = i;
  renderScenes();
  flashScene(SCENES[i].name);

  switchLock = true;
  setStat('busy', '正在穿越…');
  sfxWarp();
  buildClouds();
  tunnel.className = 'on';
  $('tuWhere').textContent = SCENES[i].name;
  // 场景名交给过场配音和题头，别再用系统 TTS 插一句
  showIntro(i);            // 换场景也重新介绍
  // 不再盖 veil2 黑屏：隧道云雾自己就够遮挡了。
  // 这样如果服务端一时没回新帧，云雾散去后露出来的是旧画面（还在播），
  // 而不是一块黑屏——最差是旧场景多显示一会儿，不会黑着吓到孩子。
  armWatchdog();
  try {
    let refPath = S.refPath;
    if (noteSceneOutfit(i)) {
      refPath = await ensureReference();
      flashScene(`${SCENES[i].name} · 换${OUTFITS[cfg.outfit].label}`);
    }

    const remote = await S.rt.startGeneration({
      localStream: S.local,
      context: new RealtimeContext({ prompt: buildPrompt(), referencePath: refPath }),
      faceRestoration: false,
    });
    const nativeTrack = remote && remote.videoTrack && remote.videoTrack.mediaStreamTrack;
    if (nativeTrack) attachStream(nativeTrack, null);
    setStat('ok', '已穿越', S.fps ? `${S.fps}fps` : '');
  } catch (e) {
    setStat('err', '换场景失败', String(e.message || '').slice(0, 30));
    tunnel.className = '';
  } finally {
    switchLock = false;
  }
}

/* ---------------- 换衣冠 ---------------- */

async function switchOutfit(key) {
  if (!OUTFITS[key]) return;
  cfg.outfit = key;
  saveCfg();
  syncOutfitBtns();
  await applyPrompt('正在换衣裳…', '换装失败');
}

/* 切换孩子性别：男童/女童。性别变了，当前场景对应的衣裳也跟着换。 */
async function switchGender(g) {
  if (g !== 'girl' && g !== 'boy') return;
  if (cfg.gender === g) return;
  cfg.gender = g;
  // 性别变了，outfit 也要跟着变成当前场景对应的那一件
  const want = SCENES[S.scene].id + '_' + cfg.gender;
  if (OUTFITS[want]) cfg.outfit = want;
  saveCfg();
  syncOutfitBtns();
  await applyPrompt('正在换衣裳…', '换装失败');
}

/* 画风 / 衣冠改了就重下一次指令（不断流、不重连） */
async function applyPrompt(busyText, errText) {
  if (!S.generating) return;
  setStat('busy', busyText);
  try {
    const refPath = await ensureReference();
    const remote = await S.rt.startGeneration({
      localStream: S.local,
      context: new RealtimeContext({ prompt: buildPrompt(), referencePath: refPath }),
      faceRestoration: false,
    });
    const nativeTrack = remote && remote.videoTrack && remote.videoTrack.mediaStreamTrack;
    if (nativeTrack) attachStream(nativeTrack, null);
    setStat('ok', '已穿越', S.fps ? `${S.fps}fps` : '');
  } catch (e) {
    setStat('err', errText, String(e.message || '').slice(0, 30));
  }
}

/* ---------------- 计时 / 帧率 ---------------- */

let fpsTimer = 0, elapsedTimer = 0;

function startFpsTicker() {
  stopFpsTicker();
  fpsTimer = setInterval(() => {
    if (S.generating) setStat('ok', '已穿越', `${S.fps}fps · ${S.delayMs != null ? S.delayMs + 'ms' : '—'}`);
  }, 2000);
}
function stopFpsTicker() { clearInterval(fpsTimer); fpsTimer = 0; }

function startElapsedTicker() {
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    if (!S.startedAt) return;
    const sec = Math.floor((Date.now() - S.startedAt) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    $('dgTime').textContent = `${mm}:${ss}`;
    // 大屏右上角：用掉多久、大概花了多少（按 ¥20/小时）
    if ($('costTime')) {
      $('costTime').textContent = `${mm}:${ss}`;
      $('costMoney').textContent = '¥' + (sec * 20 / 3600).toFixed(2);
    }
  }, 1000);
}

/* ---------------- 录制 ---------------- */

function pickMime() {
  const cands = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const m of cands) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function toggleRec() {
  if (!S.generating || !S.remoteStream) { setStat('err', '还没开始', '先点一个地方进去'); return; }
  if (S.recorder && S.recorder.state === 'recording') { stopRec(); return; }
  startRec();
}

function startRec() {
  const mime = pickMime();
  if (!mime) { setStat('err', '这台设备不支持录制'); return; }

  // 确保音频引擎醒着、录制混音口在
  sndResume();
  sndCtx();

  // 录的是合成后的画面，跟大屏上看到的、拍照出来的是同一张
  let target = S.remoteStream;
  compInit();
  if (COMP.cv && COMP.cv.captureStream) {
    try {
      const vs = COMP.cv.captureStream(24);
      /* 音轨取游戏自己的混音口：配音、键盘、音乐、环境声都在里面。
         服务端那条流的音轨不是游戏的声音（录出来又轻又卡），不要。 */
      const rec = SND.recDest ? SND.recDest.stream.getAudioTracks() : [];
      rec.forEach(t => vs.addTrack(t));
      target = vs;
    } catch (e) { target = S.remoteStream; }
  }

  try {
    S.recorder = new MediaRecorder(target, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  } catch (e) {
    try { S.recorder = new MediaRecorder(target); }
    catch (e2) { setStat('err', '录制启动失败', String(e2.message || '').slice(0, 30)); return; }
  }

  S.recChunks = [];
  S.recorder.ondataavailable = (e) => { if (e.data && e.data.size) S.recChunks.push(e.data); };
  S.recorder.onstop = () => {
    const type = S.recorder.mimeType || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(S.recChunks, { type });
    const sec = Math.round((Date.now() - S.recStart) / 1000);
    const name = `宋锦入画_${SCENES[S.scene].name}_${stamp()}_${sec}s.${ext}`;
    S.recChunks = [];
    galAdd({ kind: 'video', blob, name, sec, scene: SCENES[S.scene].name, poster: galPoster() });
  };

  S.recorder.start(1000);
  S.recStart = Date.now();
  recBar.classList.add('on');
  $('btnRec').classList.add('recording');
  S.recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - S.recStart) / 1000);
    recTime.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
}

function stopRec() {
  if (S.recorder && S.recorder.state === 'recording') S.recorder.stop();
  clearInterval(S.recTimer);
  recBar.classList.remove('on');
  $('btnRec').classList.remove('recording');
  recTime.textContent = '00:00';
}

/* ---------------- 拍照：留一幅宋画 ---------------- */

function shoot() {
  if (!S.generating) { setStat('err', '还没开始', '先点一个地方进去'); return; }
  if (!stage.videoWidth) { setStat('busy', '画面还没出来', '等一下再按一次'); return; }
  compInit();

  // 直接取合成好的画面（装裱、题款、朱印都已经在上面了），只补一个日期
  const W = COMP.cv.width, H = COMP.cv.height;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.drawImage(COMP.cv, 0, 0);

  const m = Math.round(Math.min(W, H) * 0.032);
  const fs = Math.round(Math.min(W, H) * 0.024);
  c.font = `${fs}px "Songti SC","STSong","SimSun",serif`;
  c.textAlign = 'right';
  c.textBaseline = 'bottom';
  c.fillStyle = 'rgba(66,52,36,.55)';
  c.fillText(today(), W - m, H - m);

  cv.toBlob((b) => {
    if (!b) return;
    galAdd({
      kind: 'photo', blob: b,
      name: `宋锦入画_${SCENES[S.scene].name}_${stamp()}.png`,
      scene: SCENES[S.scene].name,
      poster: galPoster(),
    });
  }, 'image/png');
}

/* ---------------- 工具 ---------------- */

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

/* ---------------- 回看：录好的视频和照片 ----------------
   录完 / 拍完不再直接往「下载」里塞，先存进浏览器本机（IndexedDB），
   关掉页面也还在；点底部「回看」就能翻着看，需要再另存到设备。
   -------------------------------------------- */

const GAL = { db: null, req: null, items: [], idx: 0, url: null, on: false };
const GAL_MAX = 60;                       // 最多留 60 条
const GAL_BYTES = 400 * 1024 * 1024;      // 总共不超过 400MB

function galDb() {
  if (GAL.db) return Promise.resolve(GAL.db);
  if (GAL.req) return GAL.req;
  GAL.req = new Promise((res, rej) => {
    let rq;
    try { rq = indexedDB.open('songjin.gallery', 1); } catch (e) { rej(e); return; }
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('items')) {
        const st = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
        st.createIndex('ts', 'ts');
      }
    };
    rq.onsuccess = () => { GAL.db = rq.result; res(GAL.db); };
    rq.onerror = () => rej(rq.error || new Error('本机存储打不开'));
  });
  return GAL.req;
}

function galTx(mode, run) {
  return galDb().then(db => new Promise((res, rej) => {
    const tx = db.transaction('items', mode);
    const req = run(tx.objectStore('items'));
    tx.oncomplete = () => res(req ? req.result : undefined);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  }));
}

/* 缩略图：直接从合成画布取小图，存成 dataURL */
function galPoster() {
  try {
    if (!COMP.cv || !COMP.cv.width) return '';
    const w = 240;
    const h = Math.max(1, Math.round(COMP.cv.height / COMP.cv.width * w));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(COMP.cv, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', 0.7);
  } catch (e) { return ''; }
}

/* 先放内存，再尽力存本机。
   iPad 上 IndexedDB 有各种脾气（无痕模式、配额、主屏应用），
   只要等存储成功才显示，用户就会觉得"什么都没存进去"。
   所以顺序反过来：内存里立刻可见 → 再尝试落盘 → 落不了也还能看、能存到相册。 */
async function galAdd(rec) {
  rec.ts = Date.now();
  rec.persisted = false;
  GAL.items.unshift(rec);
  galBadge();
  if (GAL.on) { GAL.idx = 0; galRender(); }
  setStat('ok', rec.kind === 'video' ? '录好了 · 点「回看」' : '拍好了 · 点「回看」');

  try {
    const key = await galTx('readwrite', st => st.add({ ...rec }));
    rec.id = key;
    rec.persisted = true;
    await galPrune();
  } catch (e) {
    // 存不进去也别丢：这一场照样能看、能「保存到设备」
    setStat('ok', '已存进相册（本机存储受限，关掉页面会丢）');
  }
}

async function galPrune() {
  let all = [];
  try { all = (await galTx('readonly', st => st.getAll())) || []; } catch (e) { return; }
  all.sort((a, b) => b.ts - a.ts);
  let total = 0;
  const kill = [];
  all.forEach((r, i) => {
    total += r.blob ? r.blob.size : 0;
    if (i >= GAL_MAX || total > GAL_BYTES) kill.push(r.id);
  });
  if (!kill.length) return;
  try { await galTx('readwrite', st => { kill.forEach(id => st.delete(id)); }); } catch (e) {}
}

function galBadge() {
  const n = GAL.items.length;
  const badge = $('galN');
  if (badge) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('on', n > 0);
  }
  const btn = $('btnGallery');
  if (btn) btn.disabled = false;   // 空着也能点开，里面会说明怎么回事，别让人以为坏了
  return n;
}

async function galRefresh() {
  let all = [];
  try { all = (await galTx('readonly', st => st.getAll())) || []; } catch (e) {}
  all.sort((a, b) => b.ts - a.ts);
  // 本机库里的 + 这次没落盘成功的（只在内存里，关页面就没了）
  const mem = GAL.items.filter(r => !r.persisted);
  GAL.items = all.concat(mem);
  return galBadge();
}

function galOpenView(i) {
  GAL.on = true;
  GAL.idx = Math.max(0, Math.min(GAL.items.length - 1, i || 0));
  $('gal').classList.add('on');
  $('gal').setAttribute('aria-hidden', 'false');
  stopNarr();                 // 看回放时先把配音停下，别两路声音打架
  duckBgm(true);              // 背景乐和环境声也让开
  galRender();
}

function galRender() {
  const stage = $('galStage');
  const strip = $('galStrip');
  if (GAL.url) { URL.revokeObjectURL(GAL.url); GAL.url = null; }
  stage.innerHTML = '';

  const it = GAL.items[GAL.idx];
  if (!it) {
    stage.innerHTML = '<div class="galEmpty">还没有录过东西<br>进场景后按「录制」或「拍照」，回来这里就能看</div>';
    strip.innerHTML = '';
    $('galCount').textContent = '';
    return;
  }

  GAL.url = URL.createObjectURL(it.blob);
  let el;
  if (it.kind === 'video') {
    el = document.createElement('video');
    el.src = GAL.url;
    el.controls = true;
    el.autoplay = true;
    el.loop = true;
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    // 录出来的 webm 常常没有时长信息，进度条会显示 0:00、拖不动。
    // 先跳到极远处逼浏览器算一遍总长，再拉回开头。
    el.addEventListener('loadedmetadata', () => {
      if (isFinite(el.duration) && el.duration > 0) return;
      const back = () => { el.removeEventListener('timeupdate', back); try { el.currentTime = 0; } catch (e) {} };
      try { el.currentTime = 1e101; } catch (e) {}
      el.addEventListener('timeupdate', back);
    });
  } else {
    el = document.createElement('img');
    el.src = GAL.url;
    el.alt = it.name || '宋锦照片';
  }
  stage.appendChild(el);

  // 只在内存里的那些，明确告诉老师：关掉页面就没了，要留就另存
  if (!it.persisted) {
    const tip = document.createElement('div');
    tip.className = 'galNote';
    tip.textContent = '这条只在本次有效，关掉页面会消失 · 点「保存到设备」留住它';
    stage.appendChild(tip);
  }

  $('galCount').textContent = `${GAL.idx + 1} / ${GAL.items.length}`;

  strip.innerHTML = '';
  GAL.items.forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'galTh' + (i === GAL.idx ? ' on' : '');
    d.innerHTML =
      (r.poster ? `<img src="${r.poster}" alt="">` : '') +
      `<i class="tk">${r.kind === 'video' ? '录制' : '照片'}</i>` +
      `<span class="tg"><b>${r.scene || ''}</b><b>${r.sec ? r.sec + 's' : ''}</b></span>`;
    d.onclick = () => { GAL.idx = i; galRender(); };
    strip.appendChild(d);
  });
  const cur = strip.children[GAL.idx];
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function galCloseView() {
  GAL.on = false;
  $('gal').classList.remove('on');
  $('gal').setAttribute('aria-hidden', 'true');
  const v = $('galStage').querySelector('video');
  if (v) { try { v.pause(); } catch (e) {} }
  setTimeout(() => {
    if (GAL.on) return;                       // 又打开了就别清
    if (GAL.url) { URL.revokeObjectURL(GAL.url); GAL.url = null; }
    $('galStage').innerHTML = '';
  }, 300);
  duckBgm(false);
}

function galSaveFile() {
  const it = GAL.items[GAL.idx];
  if (!it) return;
  download(it.blob, it.name || '宋锦入画.png');
}

async function galRemove() {
  const it = GAL.items[GAL.idx];
  if (!it) return;
  if (it.id != null) {
    try { await galTx('readwrite', st => st.delete(it.id)); } catch (e) {}
  }
  GAL.items.splice(GAL.idx, 1);
  galBadge();
  if (!GAL.items.length) { GAL.idx = 0; galRender(); return; }
  if (GAL.idx >= GAL.items.length) GAL.idx = GAL.items.length - 1;
  galRender();
}

function galStep(d) {
  if (!GAL.items.length) return;
  GAL.idx = (GAL.idx + d + GAL.items.length) % GAL.items.length;
  galRender();
}


/* ---------------- 设置面板 ---------------- */

function openSetup() {
  $('inKey').value = cfg.key;
  $('inEnv').value = cfg.env;
  $('inModel').value = cfg.model;
  $('inRatio').value = cfg.ratio || 'land';
  if ($('inFace')) $('inFace').checked = !!cfg.face;
  if ($('inSound')) $('inSound').checked = !!cfg.sound;
  $('inLines').value = cfg.lines;
  $('inAppend') && ($('inAppend').value = cfg.promptAppend);
  document.querySelectorAll('.of').forEach(b => b.classList.toggle('on', b.dataset.gender === cfg.gender));
  $('dgSess').textContent = '—';
  $('dgState').textContent = '—';
  $('dgFrame').textContent = '—';
  $('dgTime').textContent = '—';
  setup.classList.add('on');
}

function closeSetup() { setup.classList.remove('on'); }

function readSetup() {
  cfg.key = $('inKey').value.trim();
  cfg.env = $('inEnv').value;
  cfg.model = $('inModel').value;
  cfg.ratio = $('inRatio').value;
  if ($('inFace')) cfg.face = $('inFace').checked;
  if ($('inSound')) cfg.sound = !!$('inSound').checked;
  cfg.lines = $('inLines').value;
  if ($('inAppend')) cfg.promptAppend = $('inAppend').value;
  S.lines = cfg.lines.split('\n').map(s => s.trim()).filter(Boolean);
  saveCfg();
  stage.muted = true;
}


/* ---------------- 声音 ----------------
   全部用 Web Audio 现场合成，不依赖音频文件，断网也响。
   点地点是一声清亮的叮；穿越是低频上冲加一层扫频的风。 */

let AC = null;
function ac() {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    return AC;
  } catch (e) { return null; }
}

function sfxBling() {
  const a = ac(); if (!a) return;
  const t = a.currentTime;
  [[1568, 0, .12], [2093, .055, .07], [3136, .11, .045]].forEach(([f, d, v]) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t + d);
    g.gain.setValueAtTime(0, t + d);
    g.gain.linearRampToValueAtTime(v, t + d + .008);
    g.gain.exponentialRampToValueAtTime(.0008, t + d + .52);
    o.connect(g); g.connect(a.destination);
    o.start(t + d); o.stop(t + d + .58);
  });
}

function sfxWarp() {
  const a = ac(); if (!a) return;
  const t = a.currentTime;

  // 低频往上冲
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(70, t);
  o.frequency.exponentialRampToValueAtTime(580, t + 1.55);
  g.gain.setValueAtTime(.0001, t);
  g.gain.linearRampToValueAtTime(.12, t + .42);
  g.gain.exponentialRampToValueAtTime(.0006, t + 1.9);
  o.connect(g); g.connect(a.destination);
  o.start(t); o.stop(t + 2);

  // 风：白噪声过带通，频带一路往上扫
  const dur = 2, sr = a.sampleRate;
  const buf = a.createBuffer(1, Math.round(sr * dur), sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * .5;
  const src = a.createBufferSource(); src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(420, t);
  bp.frequency.exponentialRampToValueAtTime(3600, t + 1.3);
  const ng = a.createGain();
  ng.gain.setValueAtTime(.0001, t);
  ng.gain.linearRampToValueAtTime(.19, t + .45);
  ng.gain.exponentialRampToValueAtTime(.0006, t + 1.85);
  src.connect(bp); bp.connect(ng); ng.connect(a.destination);
  src.start(t); src.stop(t + dur);
}

/* ---------------- 语音旁白 ----------------
   用浏览器内置的 speechSynthesis，离线可用、不依赖音频文件。
   语速放慢一点，幼儿听得清。 */

function stopSpeak() {
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
}

function speak(text, rate) {
  if (!text || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = rate || 0.82;   // 略慢，适合幼儿
    u.pitch = 1.05;
    u.volume = 1;
    // 优先挑一个中文语音
    const vs = window.speechSynthesis.getVoices();
    const zh = vs.find(v => /zh|cmn|Chinese/i.test(v.lang));
    if (zh) u.voice = zh;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

/* ---------------- 江南地图 ---------------- */

const gPins = $('gPins');
const gWorld = $('gWorld');
const tunnel = $('tunnel');
let entering = false;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function renderPins() {
  gPins.innerHTML = '';
  SCENES.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin';
    b.style.left = s.map[0] + '%';
    b.style.top = s.map[1] + '%';
    b.style.animationDelay = (0.06 + i * 0.07) + 's';
    b.setAttribute('aria-label', s.name);
    // 序号写死成 1..10，戏台的 key 是 0 但地图上不该显示 0
    b.innerHTML = `<span class="pLb"><b>${s.name}</b><em>${s.onMap}</em></span>`
      + `<span class="pDot">${i + 1}</span>`
      + `<span class="pTail"></span>`;
    b.onclick = () => enterScene(i);
    gPins.appendChild(b);
  });
}

function buildClouds() {
  const box = $('tuClouds');
  box.innerHTML = '';
  for (let i = 0; i < 14; i++) {
    const c = document.createElement('i');
    c.className = 'cd';
    const a = (360 / 14) * i + (Math.random() * 22 - 11);
    c.style.setProperty('--a', a + 'deg');
    c.style.animationDelay = (Math.random() * 0.3) + 's';
    box.appendChild(c);
  }
}

/* 首帧看门狗。
   实测：连续切换场景时，服务端偶尔不回帧，画面就一直黑着，也没有报错。
   与其让老师对着黑屏猜，不如到点说一句。 */
let wdTimer = 0;
let tipTimer = 0;

/* 等首帧时给一句会动的提示，别让人以为卡死了 */
function startTip() {
  const el = $('tuTip');
  if (!el) return;
  let n = 0;
  el.style.opacity = 1;
  el.textContent = '正在给你换衣裳';
  clearInterval(tipTimer);
  tipTimer = setInterval(() => {
    n = (n + 1) % 4;
    el.textContent = '正在给你换衣裳' + '·'.repeat(n);
  }, 420);
}
function stopTip() {
  clearInterval(tipTimer);
  tipTimer = 0;
  const el = $('tuTip');
  if (el) { el.style.opacity = 0; el.textContent = '正在给你换衣裳'; }
}

function armWatchdog() {
  clearTimeout(wdTimer);
  // 首次要下 SDK 分包 + 建连接，慢一点很正常，先给提示
  setTimeout(() => { if (S.generating) startTip(); }, 900);
  wdTimer = setTimeout(() => {
    if (S.generating) setStat('err', '一直没有画面', '点「结束」再来一次');
    tunnelDone();
  }, 25000);
}
function clearWatchdog() { clearTimeout(wdTimer); wdTimer = 0; stopTip(); }

function resetMap() {
  gWorld.classList.remove('zoom');
  gWorld.style.transformOrigin = '';
  gate.classList.remove('zooming');
  tunnel.className = '';
  entering = false;
}

/* 点一处地点：先弹一下、响一声，再推近、穿越 */
async function enterScene(i) {
  if (entering) return;
  if (!cfg.key) {
    openSetup();
    gateNote.textContent = '请老师先填一下 API Key';
    return;
  }
  entering = true;

  /* 参考图预热：趁镜头推近 + 隧道这半秒多，先把这一场要穿的衣冠图传上去。
     真正开始生成时 ensureReference() 直接命中缓存，省掉上传那一下。 */
  try {
    const wantKey = SCENES[i].id + '_' + cfg.gender;
    if (OUTFITS[wantKey] && !S.refCache[wantKey]) {
      ensureClient();
      ensureReference(wantKey).catch(() => {});
    }
  } catch (e) {}

  const pin = gPins.children[i];
  if (pin) {
    pin.classList.add('hit');
    const ring = document.createElement('span'); ring.className = 'pRing';
    const bl = document.createElement('span'); bl.className = 'pBling';
    pin.appendChild(ring); pin.appendChild(bl);
    setTimeout(() => { ring.remove(); bl.remove(); pin.classList.remove('hit'); }, 950);
  }
  sfxBling();
  // 点图钉不再念地名（会和过场配音重复）

  const [mx, my] = SCENES[i].map;
  gWorld.style.transformOrigin = `${mx}% ${my}%`;
  gate.classList.add('zooming');
  await wait(70);
  gWorld.classList.add('zoom');

  await wait(560);

  setStat('busy', '正在穿越…');
  sfxWarp();
  buildClouds();
  tunnel.className = 'on';
  $('tuWhere').textContent = SCENES[i].name;

  S.scene = i;
  renderScenes();
  noteSceneOutfit(i);

  await wait(240);
  gate.classList.add('off');

  start();

  // 首帧迟迟不来时，隧道总得收尾，否则会一直挡着
  setTimeout(tunnelDone, 26000);
}

/* 首帧到了：隧道淡出，露出新的场景 */
function tunnelDone() {
  if (!tunnel.classList.contains('on')) { entering = false; return; }
  tunnel.classList.add('out');
  setTimeout(() => {
    tunnel.className = '';
    if (S.generating) gWorld.classList.remove('zoom');
    entering = false;
  }, 720);
}

/* ---------------- 事件 ---------------- */

$('btnGateCfg').onclick = openSetup;
$('btnGo').onclick = () => { if (S.generating) stop(); else start(); };
$('btnBack').onclick = () => { stop(); };
$('btnRec').onclick = toggleRec;
$('btnShot').onclick = shoot;
$('btnGallery').onclick = () => galOpenView(GAL.idx);
$('galSave').onclick = galSaveFile;
$('galDel').onclick = galRemove;
$('galClose').onclick = galCloseView;
$('gal').onclick = (e) => { if (e.target && e.target.id === 'gal') galCloseView(); };
$('btnFull').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
};
$('btnCfg').onclick = openSetup;
$('btnCloseCfg').onclick = () => { readSetup(); closeSetup(); };
$('btnSave').onclick = () => {
  readSetup();
  closeSetup();
  if (cfg.key) { gateNote.textContent = '点一个地方，就出发'; setTimeout(prewarmRef, 600); }
};
$('btnReset').onclick = () => {
  cfg = { ...DEFAULT_CFG };
  saveCfg();
  $('inKey').value = '';
  try { localStorage.removeItem(LS); } catch (e) {}
  gateNote.textContent = '已清空，请重新填入 API Key';
};

$('btnCredit').onclick = async () => {
  if (!cfg.key) { $('dgCredit').textContent = '先填 Key'; return; }
  $('dgCredit').textContent = '查询中…';
  try {
    ensureClient();
    const b = await S.client.getCreditBalance();
    $('dgCredit').textContent = `${Math.round(b.currentBalance)} 点`;
  } catch (e) {
    $('dgCredit').textContent = '查询失败';
  }
};

document.querySelectorAll('.of').forEach(b => {
  b.onclick = () => switchGender(b.dataset.gender);
});

// 键盘：数字切场景，空格录，P 拍照，F 全屏，T 换台词，Esc 关面板
window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;

  if (e.key === 'Escape') {
    if (GAL.on) { galCloseView(); return; }
    closeSetup();
    return;
  }
  if (GAL.on) {
    if (e.key === 'ArrowLeft') { galStep(-1); return; }
    if (e.key === 'ArrowRight') { galStep(1); return; }
    if (e.key === ' ' || e.key === 'p' || e.key === 'P') return;   // 看回放时别误触录制
  }
  if (e.key === 'v' || e.key === 'V') {
    if (GAL.on) galCloseView();
    else galOpenView(GAL.idx);
    return;
  }
  if (e.key === 'f' || e.key === 'F') { $('btnFull').click(); return; }
  if (e.key === ' ') {
    e.preventDefault();
    if (S.generating) toggleRec();
    else if (gate && !gate.classList.contains('off')) enterScene(S.scene);
    else start();
    return;
  }
  if (e.key === 'p' || e.key === 'P') { shoot(); return; }
  if (e.key === 't' || e.key === 'T') {
    cycleHint();
    return;
  }
  // 数字键按场景标注的 key 走（1–9，0 是戏台）
  const hit = SCENES.findIndex(s => s.key === e.key);
  if (hit >= 0) switchScene(hit);
});

// 点画面空白处：过场字幕 → 台词提示逐条轮 → 都看完再回过场字幕
stage.addEventListener('click', () => {
  if (!S.generating) return;
  cycleHint();
});

window.addEventListener('beforeunload', () => {
  try { if (S.rt) S.rt.close(); } catch (e) {}
  if (S.local) { try { S.local.getTracks().forEach(t => t.stop()); } catch (e) {} }
});

/* ---------------- 初始化 ---------------- */

function boot() {
  renderScenes();
  renderPins();
  galRefresh();                 // 上次录的东西还在，把「回看」点亮
  // 请浏览器别在空间紧张时清掉我们的相册
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
  S.lines = cfg.lines.split('\n').map(s => s.trim()).filter(Boolean);
  stage.muted = true;
  stage.classList.toggle('noMirror', !cfg.mirror);
  gateNote.textContent = cfg.key ? '点一个地方，就出发' : '请老师先填一下 API Key';
  // 预加载中文语音（speechSynthesis 的 voices 是异步加载的）
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.getVoices(); } catch (e) {}
    window.speechSynthesis.onvoiceschanged = () => { try { window.speechSynthesis.getVoices(); } catch (e) {} };
  }
}

boot();

/* ---------------- 开屏预热 ----------------
   1. 用户第一次碰屏幕：解锁音频、把键盘样本切好、音频上下文先建好
   2. 空闲时预取实时生成用的 SDK 分包（约 5.9MB），按下「开始」就不用现下
   3. 有 Key 的话顺手把衣冠参考图传上去，省掉开始那一两秒 */
document.addEventListener('pointerdown', () => {
  sndResume();
  loadKeyboard();
  sndCtx();
  sceneSound('hupan');        // 地图上是水岸的声（水声、风、鸟），不吵
  setTimeout(prewarmRef, 1500);
}, { once: true });

/* 参考图预热：把当前衣冠的图先上传到云端，等真开始生成时直接用 */
let prewarming = false;
function prewarmRef() {
  if (prewarming || S.generating || S.starting || !cfg.key) return;
  prewarming = true;
  const done = () => { prewarming = false; };
  try {
    ensureClient();
    ensureReference().then(done, done);
  } catch (e) { done(); }
}

(function prefetchSdk() {
  const chunks = [
    'sdk/chunks/index.esm.min-32J2X22X.js',
    'sdk/chunks/trtc-NSSG7IZO.js',
    'sdk/chunks/AgoraRTC_N-production-2PFQX2GK.js',
    'sdk/chunks/agora-extension-beauty-N2VYE3UU.js',
    'sdk/chunks/cos-js-sdk-v5-XRIJRUGG.js',
  ];
  let i = 0;
  const next = () => {
    if (i >= chunks.length) return;
    fetch(chunks[i++]).then(next).catch(next);
  };
  const kick = () => setTimeout(next, 1200);
  if (document.readyState === 'complete') kick();
  else window.addEventListener('load', kick, { once: true });
})();





