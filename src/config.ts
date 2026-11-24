// 配置与数据目录：工具会在任意目录下运行，所以配置和进度统一放在 ~/.agent-tutor/
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Interface } from "node:readline/promises";
import { formatPrice, parsePrice, type Price } from "./usage.js";
import type { SearchConfig, SearchProvider } from "./web.js";

export const DATA_DIR = process.env.AGENT_TUTOR_HOME ?? join(homedir(), ".agent-tutor");
const CONFIG_FILE = join(DATA_DIR, "config.json");

export interface Config {
  baseURL: string;
  model: string;
  apiKey: string; // 有些内网网关不需要 key，可以为空
  searchProvider?: SearchProvider; // 网页搜索服务，不配置就不能用 web_search
  searchApiKey?: string;
  // 模型价格（可选）：每百万 token 多少钱，按模型名分别填，用来估算花费
  prices?: Record<string, Price>;
  currency?: string; // 货币符号，默认 ¥
}

function readConfigFile(): Partial<Config> {
  if (!existsSync(CONFIG_FILE)) return {};
  return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
}

// 环境变量优先于配置文件，方便临时切换模型
export function loadConfig(): Partial<Config> {
  const file = readConfigFile();
  return {
    baseURL: process.env.OPENAI_BASE_URL || file.baseURL,
    model: process.env.MODEL_NAME || file.model,
    apiKey: process.env.OPENAI_API_KEY ?? file.apiKey ?? "",
    searchProvider: (process.env.SEARCH_PROVIDER as SearchProvider) || file.searchProvider,
    searchApiKey: process.env.SEARCH_API_KEY || file.searchApiKey,
    prices: file.prices,
    currency: file.currency,
  };
}

export function searchConfig(c: Partial<Config>): SearchConfig | undefined {
  if (!c.searchApiKey) return undefined;
  return { provider: c.searchProvider ?? "bocha", apiKey: c.searchApiKey };
}

export function isComplete(c: Partial<Config>): c is Config {
  return Boolean(c.baseURL && c.model);
}

// 首次运行或 `agent-tutor --setup` 时的配置向导
export async function runSetup(rl: Interface): Promise<Config> {
  const old = readConfigFile();
  console.log(`\n配置模型（OpenAI 兼容接口），将保存到 ${CONFIG_FILE}`);
  console.log("直接回车 = 保持方括号里的当前值\n");
  const ask = async (label: string, current = "") =>
    (await rl.question(`${label}${current ? ` [${current}]` : ""}：`)).trim() || current;

  const baseURL = await ask("base_url（如 https://api.example.com/v1）", old.baseURL);
  const model = await ask("模型名", old.model);
  const keyInput = await rl.question(
    `API Key${old.apiKey ? "（已设置，回车保持不变）" : "（不需要可直接回车）"}：`,
  );

  // 价格只用来估算花费，不填也能正常用（只是看不到花了多少钱）
  console.log("\n模型价格（可选）：每百万 token 多少元，格式「输入价/输出价」，有缓存价可以写成「输入价/输出价/缓存价」，如 2/8/0.5");
  console.log("价格在模型服务商的官网上能查到；输入 - 删除已填的价格");
  const prices = { ...old.prices };
  const oldPrice = prices[model];
  let price: Price | undefined;
  while (true) {
    const text = await ask("价格", oldPrice ? formatPrice(oldPrice) : "");
    if (text === "-") {
      delete prices[model];
      break;
    }
    if (!text || (price = parsePrice(text))) break;
    console.log("格式不对，例子：2/8 或 2/8/0.5");
  }
  if (price) prices[model] = price;

  console.log("\n网页搜索（可选）：bocha = 博查，国内网络直接可用；tavily = 国外服务；none = 不用搜索");
  let provider = "";
  while (!["bocha", "tavily", "none"].includes(provider)) {
    provider = (await ask("搜索服务 bocha / tavily / none", old.searchProvider ?? "bocha")).toLowerCase();
  }
  let searchApiKey = "";
  if (provider !== "none") {
    const sameProvider = provider === old.searchProvider && old.searchApiKey;
    const input = await rl.question(`搜索 API Key${sameProvider ? "（已设置，回车保持不变）" : ""}：`);
    searchApiKey = input.trim() || (sameProvider ? old.searchApiKey! : "");
    if (!searchApiKey) console.log("没有填 key，暂时不能搜索，之后可以输入 /setup 再填");
  }

  const config: Config = {
    baseURL,
    model,
    apiKey: keyInput.trim() || old.apiKey || "",
    ...(provider !== "none" && { searchProvider: provider as SearchProvider, searchApiKey }),
    ...(Object.keys(prices).length > 0 && { prices }),
    ...(old.currency && { currency: old.currency }),
  };

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  chmodSync(CONFIG_FILE, 0o600); // 只有自己能读，保护 key
  console.log("✅ 已保存\n");
  return config;
}
