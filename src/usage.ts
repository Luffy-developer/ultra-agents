// token 用量和花费：每次调用模型，接口都会返回这次用了多少 token（输入多少、输出多少、有多少命中了缓存）
// 把它们按模型累加起来，再乘上单价，就知道花了多少钱

export interface Usage {
  input: number; // 输入 token：每次调用都要把整段对话（system + 历史 + 工具说明）重新发一遍，所以对话越长越贵
  output: number; // 输出 token：模型生成的内容，单价通常比输入贵好几倍
  cached: number; // 输入里命中缓存的部分：和上一次开头相同的内容，很多服务商按更低的价格收费
  calls: number;
}

// 每百万 token 的价格
export interface Price {
  input: number;
  output: number;
  cached?: number; // 不填就按普通输入价算
}

const empty = (): Usage => ({ input: 0, output: 0, cached: 0, calls: 0 });

// 不同服务商返回的字段名不太一样：OpenAI 是 prompt_tokens_details.cached_tokens，DeepSeek 是 prompt_cache_hit_tokens
export function readUsage(raw: any): Omit<Usage, "calls"> | undefined {
  if (!raw || typeof raw.prompt_tokens !== "number") return undefined;
  return {
    input: raw.prompt_tokens,
    output: raw.completion_tokens ?? 0,
    cached: raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens ?? 0,
  };
}

export class UsageMeter {
  readonly byModel = new Map<string, Usage>();
  lastContext = 0; // 导师最近一次调用的输入 token 数，约等于现在的对话有多长

  add(model: string, u: Omit<Usage, "calls">) {
    const sum = this.byModel.get(model) ?? empty();
    sum.input += u.input;
    sum.output += u.output;
    sum.cached += u.cached;
    sum.calls++;
    this.byModel.set(model, sum);
  }

  total() {
    const sum = empty();
    for (const u of this.byModel.values()) {
      sum.input += u.input;
      sum.output += u.output;
      sum.cached += u.cached;
      sum.calls += u.calls;
    }
    return sum;
  }

  // 有模型没配价格时返回 undefined（算不出来，就不要给一个偏低的数字）
  cost(prices: Record<string, Price> = {}) {
    let total = 0;
    for (const [model, u] of this.byModel) {
      const cost = costOf(u, prices[model]);
      if (cost === undefined) return undefined;
      total += cost;
    }
    return total;
  }
}

export function costOf(u: Usage, price?: Price) {
  if (!price) return undefined;
  const cachedPrice = price.cached ?? price.input;
  return ((u.input - u.cached) * price.input + u.cached * cachedPrice + u.output * price.output) / 1_000_000;
}

export function formatTokens(n: number) {
  if (n < 1000) return String(n);
  return n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatCost(cost: number, currency = "¥") {
  return `${currency}${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`;
}

// 一行摘要：输入 12.3k（缓存 8.0k）· 输出 456 · ¥0.0123
export function usageLine(u: Usage, cost?: number, currency?: string) {
  const parts = [`输入 ${formatTokens(u.input)}${u.cached ? `（缓存 ${formatTokens(u.cached)}）` : ""}`, `输出 ${formatTokens(u.output)}`];
  if (cost !== undefined) parts.push(`约 ${formatCost(cost, currency)}`);
  return parts.join(" · ");
}

// 解析 /setup 里填的价格：「输入价/输出价」或「输入价/输出价/缓存价」，如 2/8 或 2/8/0.5
export function parsePrice(text: string): Price | undefined {
  const nums = text.split("/").map((s) => Number(s.trim()));
  if (nums.length < 2 || nums.length > 3 || nums.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  return { input: nums[0], output: nums[1], ...(nums.length === 3 && { cached: nums[2] }) };
}

export function formatPrice(p: Price) {
  return [p.input, p.output, ...(p.cached !== undefined ? [p.cached] : [])].join("/");
}
