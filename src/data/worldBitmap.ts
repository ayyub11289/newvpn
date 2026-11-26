import { AutoPilotRule, SecurityToggle, SplitAppRule, VpnNode } from '../types';

export const WORLD_BITMAP = [
  '..............######......#########.....................................',
  '........############.....###########..........####...########...........',
  '......##############......#########........####################.........',
  '.....################......#######...#....############################..',
  '......###############.......#####........##############################.',
  '........##############..................###############################.',
  '.........#############.............##..################################.',
  '.........##############............#################################....',
  '..........#############............################################.#...',
  '..........############............################################..##..',
  '...........##########.............###############################...##..',
  '............########..............#####.#########################..##...',
  '.............######..............#####...#######################........',
  '..............####...............############.#################.........',
  '...............###..............##############..##############..........',
  '................###.............#############...#####..######...........',
  '.................####...........#############....###...#####............',
  '...................#####.........###########.....##.....####............',
  '....................#######.......#########.............####............',
  '....................#########.....#########..............#####..........',
  '....................##########.....#######................######........',
  '.....................##########....#######.................####.........',
  '.....................##########.....######..............................',
  '......................#########.....######........................####..',
  '......................########.......####.......................#######.',
  '......................#######........###.......................########.',
  '.......................#####.........##........................########.',
  '.......................####.....................................######..',
  '.......................###........................................###...',
  '.......................##............................................##.',
  '.......................#.............................................#..',
  '........................................................................',
  '........................................................................',
  '........................................................................'
];

export interface LandDot {
  lon: number;
  lat: number;
  lam: number;
  cosPhi: number;
  sinPhi: number;
}

export const LAND_DOTS: LandDot[] = [];
for (let r = 0; r < WORLD_BITMAP.length; r++) {
  const rowStr = WORLD_BITMAP[r];
  for (let c = 0; c < rowStr.length; c++) {
    if (rowStr[c] !== '#') continue;
    for (let sy = 0; sy < 2; sy++) {
      for (let sx = 0; sx < 2; sx++) {
        const lon = -180 + (c + (sx + 0.5) * 0.5) * 5;
        const lat = 78 - (r + (sy + 0.5) * 0.5) * 4;
        const lam = (lon * Math.PI) / 180;
        const phi = (lat * Math.PI) / 180;
        LAND_DOTS.push({ lon, lat, lam, cosPhi: Math.cos(phi), sinPhi: Math.sin(phi) });
      }
    }
  }
}

export const ORIGIN = { city: '上海本地', code: 'CN', lon: 121.5, lat: 31.2 };

export const DEFAULT_DEMO_NODES: VpnNode[] = [
  { id: 'jp-tyo', code: 'JP', country: '日本', city: '东京 #04', host: 'tyo-04.veil.net', port: 443, asn: 'AS2497 IIJ', ip: '45.90.28.194', lon: 139.7, lat: 35.7, ping: 34, load: 28, tags: ['asia', 'streaming'], fav: true, source: 'demo', protocolType: 'demo' },
  { id: 'hk-hkg', code: 'HK', country: '中国香港', city: '香港 #11', host: 'hkg-11.veil.net', port: 443, asn: 'AS9269 HKBN', ip: '103.214.20.88', lon: 114.2, lat: 22.3, ping: 19, load: 46, tags: ['asia', 'streaming'], fav: true, source: 'demo', protocolType: 'demo' },
  { id: 'sg-sin', code: 'SG', country: '新加坡', city: '新加坡 · 裕廊', host: 'sin-02.veil.net', port: 443, asn: 'AS132203 Equinix', ip: '146.70.98.12', lon: 103.8, lat: 1.3, ping: 48, load: 31, tags: ['asia', 'streaming', 'privacy'], fav: true, source: 'demo', protocolType: 'demo' },
  { id: 'kr-sel', code: 'KR', country: '韩国', city: '首尔 #03', host: 'sel-03.veil.net', port: 443, asn: 'AS4766 KT', ip: '121.189.44.71', lon: 126.9, lat: 37.5, ping: 29, load: 39, tags: ['asia'], fav: false, source: 'demo', protocolType: 'demo' },
  { id: 'us-lax', code: 'US', country: '美国', city: '洛杉矶 · Core', host: 'lax-08.veil.net', port: 443, asn: 'AS20473 CoreSite', ip: '198.54.132.60', lon: -118.2, lat: 34.0, ping: 128, load: 35, tags: ['streaming'], fav: true, source: 'demo', protocolType: 'demo' },
  { id: 'us-nyc', code: 'US', country: '美国', city: '纽约 #05', host: 'nyc-05.veil.net', port: 443, asn: 'AS174 Cogent', ip: '192.241.210.19', lon: -74.0, lat: 40.7, ping: 186, load: 42, tags: ['streaming'], fav: false, source: 'demo', protocolType: 'demo' },
  { id: 'ch-zrh', code: 'CH', country: '瑞士', city: '苏黎世 · 堡垒', host: 'zrh-01.veil.net', port: 51820, asn: 'AS51396 Bahnhof', ip: '185.213.154.92', lon: 8.5, lat: 47.4, ping: 168, load: 18, tags: ['privacy'], fav: true, source: 'demo', protocolType: 'demo' },
  { id: 'de-fra', code: 'DE', country: '德国', city: '法兰克福 #09', host: 'fra-09.veil.net', port: 443, asn: 'AS24940 DE-CIX', ip: '89.58.12.205', lon: 8.7, lat: 50.1, ping: 159, load: 24, tags: ['privacy', 'streaming'], fav: false, source: 'demo', protocolType: 'demo' },
  { id: 'gb-lon', code: 'GB', country: '英国', city: '伦敦 · Docklands', host: 'lon-06.veil.net', port: 443, asn: 'AS212238 M247', ip: '185.195.232.41', lon: -0.1, lat: 51.5, ping: 166, load: 33, tags: ['streaming'], fav: false, source: 'demo', protocolType: 'demo' },
  { id: 'is-rek', code: 'IS', country: '冰岛', city: '雷克雅未克', host: 'rek-01.veil.net', port: 51820, asn: 'AS44515 Advania', ip: '82.221.105.14', lon: -21.9, lat: 64.1, ping: 192, load: 14, tags: ['privacy'], fav: false, source: 'demo', protocolType: 'demo' },
  { id: 'au-syd', code: 'AU', country: '澳大利亚', city: '悉尼 #02', host: 'syd-02.veil.net', port: 443, asn: 'AS13335 Sydney', ip: '103.108.231.55', lon: 151.2, lat: -33.9, ping: 118, load: 22, tags: ['asia', 'streaming'], fav: false, source: 'demo', protocolType: 'demo' },
  { id: 'br-gru', code: 'BR', country: '巴西', city: '圣保罗 #01', host: 'gru-01.veil.net', port: 443, asn: 'AS28573 Claro', ip: '177.54.148.77', lon: -46.6, lat: -23.5, ping: 264, load: 19, tags: [], fav: false, source: 'demo', protocolType: 'demo' }
];

export const DEFAULT_AUTOPILOT: AutoPilotRule[] = [
  { id: 'wifi', title: '陌生公共 Wi-Fi 自动接管', desc: '检测到未加密热点时自动拉起加密隧道并锁定路由', enabled: true },
  { id: 'ai-route', title: 'AI 与研发域名智能选线', desc: '访问 OpenAI / Anthropic / GitHub 时强制走加密出口', enabled: true },
  { id: 'media-4k', title: '流媒体 4K 零缓冲优选', desc: '优先避开负载 >60% 拥塞机房，保障高码率推流稳定', enabled: false },
  { id: 'cn-direct', title: '政务与网银域名直连白名单', desc: '国内银行、税务及本地政务域名自动绕过代理避免风控', enabled: true }
];

export const DEFAULT_SECURITY: SecurityToggle[] = [
  { id: 'killswitch', title: '有限断线保护 (Kill Switch)', desc: '系统代理模式在内核崩溃后锁定失效代理（仅覆盖遵循系统代理的应用）；TUN strict_route 仅在进程运行期有效，内核强杀后无独立系统防火墙阻断', enabled: true },
  { id: 'netshield', title: 'NetShield 反追踪净化', desc: '通过 sing-box reject 动作拦截广告、遥测与追踪域名', enabled: true },
  { id: 'pqkem', title: '密钥轮换显示 (会话标识)', desc: '在连接中枢周期刷新会话指纹标识（实际加密套件由所选节点协议决定）', enabled: true },
  { id: 'lan', title: '局域网设备直连 (LAN)', desc: '保持全局保护的同时允许访问本地 NAS、打印机与调试端口', enabled: true }
];

export const DEFAULT_SPLIT_APPS: SplitAppRule[] = [
  { id: 'browser', name: 'Arc / Chrome 浏览器', proc: 'chrome.exe, msedge.exe', executables: ['chrome.exe', 'msedge.exe', 'arc.exe'], mode: 'proxy' },
  { id: 'terminal', name: 'Terminal / Git / Docker', proc: 'git.exe, ssh.exe, docker.exe', executables: ['git.exe', 'ssh.exe', 'docker.exe', 'node.exe'], mode: 'proxy' },
  { id: 'wechat', name: '微信 / 国内网银服务', proc: 'WeChat.exe · 低延迟直连', executables: ['WeChat.exe', 'Weixin.exe', 'QQ.exe'], mode: 'bypass' },
  { id: 'steam', name: 'Steam 游戏平台', proc: 'steam.exe · 下载走直连', executables: ['steam.exe', 'steamwebhelper.exe'], mode: 'bypass' },
  { id: 'spotify', name: 'Spotify / 流媒体客户端', proc: 'Spotify.exe · 跨区解锁', executables: ['Spotify.exe'], mode: 'proxy' }
];
