export interface Question {
  id: string;
  topic: string;
  prompt: string;
  choices: readonly [string, string, string, string];
  correctIndex: number;
  explanation: string;
}
// 本プロジェクト独自の教材。本試験問題の転載ではありません。
export const questions: readonly Question[] = [
  { id: 'subnet-01', topic: 'IPアドレス', prompt: 'IPv4の /27 サブネットで、通常のホストに割り当て可能なアドレス数はいくつか。', choices: ['14', '30', '32', '62'], correctIndex: 1, explanation: 'ホスト部は5ビット。32個のうちネットワークアドレスとブロードキャストアドレスを除き30個です。' },
  { id: 'dns-01', topic: 'DNS', prompt: 'DNSで、名前に対応するIPv6アドレスを保持するレコードはどれか。', choices: ['A', 'MX', 'AAAA', 'PTR'], correctIndex: 2, explanation: 'AAAAレコードがIPv6アドレスを保持します。AはIPv4、MXはメール配送先、PTRは逆引きに使います。' },
  { id: 'vlan-01', topic: 'LAN', prompt: 'イーサネットフレームにVLAN識別情報を付加する規格はどれか。', choices: ['IEEE 802.1Q', 'IEEE 802.11ax', 'IEEE 802.3ad', 'IEEE 802.1X'], correctIndex: 0, explanation: 'IEEE 802.1QはVLANタグを規定します。802.1Xはポートベースのネットワークアクセス制御です。' },
];
export function generatePractice(bank: readonly Question[], count: number, random = Math.random): Question[] {
  if (!Number.isInteger(count) || count < 1 || count > bank.length) throw new RangeError('問題数は問題バンクの件数以内で指定してください。');
  const result = [...bank];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.slice(0, count);
}
export function grade(items: readonly Question[], answers: Readonly<Record<string, number>>): number {
  return items.filter(q => answers[q.id] === q.correctIndex).length;
}
