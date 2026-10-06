// 생성기가 쓰는 type 이름 낱말 — 공개 API 의 resource_type 이 되므로 셋(AWS · Azure 생성기)이 같은 규칙을 쓴다.
// 약어(slug)는 여기서 만들지 않는다 — 약어가 바뀌면 생성되는 이름이 바뀐다(기준선 고정).

/** 대소문자가 섞인 약어 — 그대로 두면 낙타 표기 분해가 IoT → io_t · IPv4 → i_pv4 · SignalR → signal_r 로 쪼갠다.
 *  한 낱말로 읽히게 첫 글자만 대문자로 바꾼 뒤 분해한다 */
const MIXED_ACRONYMS = [[/IoT/g, 'Iot'], [/IPv([46])/g, 'Ipv$1'], [/([Ss])ignalR/g, '$1ignalr']];

/** 분해한 뒤 표시명에는 원래 꼴로 되돌린다 */
const RESTORE = { Iot: 'IoT', Ipv4: 'IPv4', Ipv6: 'IPv6', Signalr: 'SignalR', signalr: 'signalR' };

/** 낙타 표기 → 낱말 (표시명용 대소문자). 연속 대문자는 한 낱말(VPC · OIDC), 그 뒤 대문자+소문자는 새 낱말 */
export function typeWords(s) {
  let t = s;
  for (const [re, to] of MIXED_ACRONYMS) t = t.replace(re, to);
  return t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((w) => RESTORE[w] ?? w);
}

export const typeSnake = (s) => typeWords(s).join('_').toLowerCase();

/** 표시명에서만 쓰는 약어 꼴 — 낙타 표기 분해는 VpnGateway → Vpn Gateway 처럼 약어의 첫 글자만 대문자로 남긴다.
 *  낱말 전체가 표의 열쇠와 같을 때만 바꾼다(Ipam · Http2 · Natural 은 그대로). type(공개 계약)은 typeSnake 가 만들고 이 표를 보지 않는다 */
export const DISPLAY_ACRONYMS = {
  Acl: 'ACL', Api: 'API', Cdn: 'CDN', Dns: 'DNS', Grpc: 'gRPC', Http: 'HTTP', Https: 'HTTPS', Ip: 'IP', Iot: 'IoT', Nat: 'NAT',
  Sql: 'SQL', Ssl: 'SSL', Tcp: 'TCP', Tls: 'TLS', Udp: 'UDP', Url: 'URL', Vm: 'VM', Vpc: 'VPC', Vpn: 'VPN',
};
export const displayWords = (words) => words.map((w) => DISPLAY_ACRONYMS[w] ?? w);

/** 한 글자 토막 — `_a_` 같은 type 은 읽을 수 없다(리뷰 지적). 생성기는 이런 후보를 고르지 않는다 */
export const hasSingleLetterToken = (type) => /(^|_)[a-z](_|$)/.test(type);

/** 40자를 넘는 type 을 읽을 수 있게 줄이는 낱말 약어 — 널리 쓰는 꼴만 */
export const WORD_ABBREVIATIONS = {
  application: 'app', applications: 'apps', association: 'assoc', associations: 'assocs',
  authorization: 'auth', configuration: 'config', configurations: 'configs', databases: 'dbs', environment: 'env', environments: 'envs',
  external: 'ext', gateway: 'gw', interface: 'iface', locations: 'locs', management: 'mgmt', namespaces: 'ns', network: 'net', notification: 'notif',
  notifications: 'notifs', verification: 'verif', virtual: 'virt',
};

/** snake type 의 낱말을 약어로 바꾼다 */
export const abbreviateSnake = (snake) => snake.split('_').map((w) => WORD_ABBREVIATIONS[w] ?? w).join('_');
