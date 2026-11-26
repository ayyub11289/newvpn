export interface GeoLocation {
  code: string;
  country: string;
  lon: number;
  lat: number;
  tags: string[];
}

interface GeoRule {
  pattern: RegExp;
  geo: GeoLocation;
}

const GEO_RULES: GeoRule[] = [
  { pattern: /tokyo|东京|日本|jp|osaka|大阪|🇯🇵/i, geo: { code: 'JP', country: '日本', lon: 139.7, lat: 35.7, tags: ['asia', 'streaming'] } },
  { pattern: /hong\s*kong|香港|hk|🇭🇰/i, geo: { code: 'HK', country: '中国香港', lon: 114.2, lat: 22.3, tags: ['asia', 'streaming'] } },
  { pattern: /singapore|新加坡|狮城|sg|🇸🇬/i, geo: { code: 'SG', country: '新加坡', lon: 103.8, lat: 1.3, tags: ['asia', 'streaming', 'privacy'] } },
  { pattern: /taiwan|台湾|台北|tw|🇹🇼/i, geo: { code: 'TW', country: '中国台湾', lon: 121.5, lat: 25.0, tags: ['asia', 'streaming'] } },
  { pattern: /seoul|首尔|韩国|kr|🇰🇷/i, geo: { code: 'KR', country: '韩国', lon: 126.9, lat: 37.5, tags: ['asia'] } },
  { pattern: /los\s*angeles|洛杉矶|san\s*jose|圣何塞|seattle|西雅图|silicon|硅谷|us-west/i, geo: { code: 'US', country: '美国', lon: -118.2, lat: 34.0, tags: ['streaming'] } },
  { pattern: /new\s*york|纽约|chicago|芝加哥|dallas|miami|us-east|美国|\bus\b|🇺🇸/i, geo: { code: 'US', country: '美国', lon: -74.0, lat: 40.7, tags: ['streaming'] } },
  { pattern: /zurich|苏黎世|瑞士|switzerland|\bch\b|🇨🇭/i, geo: { code: 'CH', country: '瑞士', lon: 8.5, lat: 47.4, tags: ['privacy'] } },
  { pattern: /frankfurt|法兰克福|德国|germany|\bde\b|🇩🇪/i, geo: { code: 'DE', country: '德国', lon: 8.7, lat: 50.1, tags: ['privacy', 'streaming'] } },
  { pattern: /london|伦敦|英国|uk|britain|\bgb\b|🇬🇧/i, geo: { code: 'GB', country: '英国', lon: -0.1, lat: 51.5, tags: ['streaming'] } },
  { pattern: /amsterdam|阿姆斯特丹|荷兰|netherlands|\bnl\b|🇳🇱/i, geo: { code: 'NL', country: '荷兰', lon: 4.9, lat: 52.4, tags: ['privacy'] } },
  { pattern: /paris|巴黎|法国|france|\bfr\b|🇫🇷/i, geo: { code: 'FR', country: '法国', lon: 2.3, lat: 48.9, tags: ['streaming'] } },
  { pattern: /iceland|冰岛|reykjavik|雷克雅未克|\bis\b|🇮🇸/i, geo: { code: 'IS', country: '冰岛', lon: -21.9, lat: 64.1, tags: ['privacy'] } },
  { pattern: /sweden|瑞典|stockholm|斯德哥尔摩|\bse\b|🇸🇪/i, geo: { code: 'SE', country: '瑞典', lon: 18.1, lat: 59.3, tags: ['privacy'] } },
  { pattern: /sydney|悉尼|melbourne|澳大利亚|澳洲|australia|\bau\b|🇦🇺/i, geo: { code: 'AU', country: '澳大利亚', lon: 151.2, lat: -33.9, tags: ['asia', 'streaming'] } },
  { pattern: /canada|加拿大|toronto|多伦多|vancouver|温哥华|\bca\b|🇨🇦/i, geo: { code: 'CA', country: '加拿大', lon: -79.4, lat: 43.7, tags: ['streaming'] } },
  { pattern: /brazil|巴西|sao\s*paulo|圣保罗|\bbr\b|🇧🇷/i, geo: { code: 'BR', country: '巴西', lon: -46.6, lat: -23.5, tags: [] } },
  { pattern: /india|印度|mumbai|孟买|\bin\b|🇮🇳/i, geo: { code: 'IN', country: '印度', lon: 72.8, lat: 19.1, tags: ['asia'] } }
];

export function matchGeoFromLabel(label: string): GeoLocation {
  for (const rule of GEO_RULES) {
    if (rule.pattern.test(label)) {
      return { ...rule.geo, tags: [...rule.geo.tags] };
    }
  }
  return { code: 'GL', country: '全球节点', lon: 12.5, lat: 41.9, tags: [] };
}
