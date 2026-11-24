// MCP 客户端：让导师用上别人写好的工具（第 10 课）
// MCP（Model Context Protocol）是给 Agent 用的"标准插头"：
// 工具做成独立的 MCP 服务器程序，任何支持 MCP 的 Agent（Claude Code、Cursor、本项目……）都能连上它、使用它的工具。
//
// 配置文件 ~/.agent-tutor/mcp.json，格式和 Claude Code / Claude 桌面版一样：
// {
//   "mcpServers": {
//     "time":   { "command": "npx", "args": ["-y", "某个MCP服务器包"] },   ← 本地服务器：启动一个程序，通过它的输入输出通信
//     "remote": { "url": "https://example.com/mcp" }                     ← 远程服务器：通过网络通信
//   }
// }
// 也可以在程序里输入 /mcp add 名字 命令或网址 来添加（会写进这个文件并马上连接），/mcp remove 名字 删除
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DATA_DIR } from "./config.js";
import type { Tool } from "./tools.js";

export const MCP_CONFIG_FILE = join(DATA_DIR, "mcp.json");

interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>; // 比如某些服务器需要的 API Key
  cwd?: string;
  disabled?: boolean; // 设为 true 可以暂时停用，不用删配置
}

interface HttpServerConfig {
  url: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export type ServerConfig = StdioServerConfig | HttpServerConfig;

export interface McpServerStatus {
  name: string;
  ok: boolean;
  tools: { name: string; description: string }[]; // 这个服务器提供的工具（原名和说明）
  error?: string;
}

const CONNECT_TIMEOUT_MS = 60_000; // npx 第一次运行要下载，给足时间
const CALL_TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 8000;

const clients = new Map<string, Client>(); // 服务器名 → 连接
let statuses: McpServerStatus[] = [];

export function mcpStatuses() {
  return statuses;
}

function readConfigFile(): any {
  if (!existsSync(MCP_CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(MCP_CONFIG_FILE, "utf-8"));
  } catch (e) {
    throw new Error(`${MCP_CONFIG_FILE} 不是合法的 JSON：${e instanceof Error ? e.message : e}`);
  }
}

function loadMcpConfig(): Record<string, ServerConfig> {
  return readConfigFile().mcpServers ?? {};
}

// 改配置文件时保留文件里的其他内容；里面可能有 token，只让自己能读
function writeMcpServers(update: (servers: Record<string, ServerConfig>) => void) {
  const json = readConfigFile();
  json.mcpServers ??= {};
  update(json.mcpServers);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MCP_CONFIG_FILE, JSON.stringify(json, null, 2));
  chmodSync(MCP_CONFIG_FILE, 0o600);
}

// OpenAI 接口要求工具名只能有字母、数字、下划线、横线，最长 64 个字符
// 加上 mcp__服务器名__ 前缀，既避免和自带工具重名，也能看出工具来自哪个服务器
const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

function toolName(server: string, tool: string) {
  return `${mcpToolPrefix(server)}${safe(tool)}`.slice(0, 64);
}

// 某个服务器的所有工具名都以这个开头（删除服务器时用来找出它的工具）
export function mcpToolPrefix(server: string) {
  return `mcp__${safe(server)}__`;
}

// MCP 工具的参数说明（JSON Schema）基本可以直接给模型用，只去掉个别模型不认的字段
function cleanSchema(schema: any) {
  const { $schema, ...rest } = schema ?? {};
  return { ...rest, type: "object", properties: rest.properties ?? {} };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// MCP 工具的返回结果是一组"内容块"（文字、图片、资源……），整理成模型好读的文字
function formatResult(result: any) {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    if (block.type === "text") parts.push(block.text);
    else if (block.type === "image") parts.push(`[图片：${block.mimeType}]`);
    else if (block.type === "audio") parts.push(`[音频：${block.mimeType}]`);
    else if (block.type === "resource") parts.push(block.resource?.text ?? `[资源：${block.resource?.uri}]`);
    else if (block.type === "resource_link") parts.push(`[链接：${block.uri}]`);
  }
  if (parts.length === 0 && result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  let text = parts.join("\n") || "（工具没有返回内容）";
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + "\n…（内容过长，已截断）";
  return result.isError ? { error: text } : { content: text };
}

async function connectServer(name: string, cfg: ServerConfig, version: string) {
  const client = new Client({ name: "agent-tutor", version });
  let stderrTail = ""; // 服务器的报错输出不打到终端上（会打乱上课界面），只留最后几行，连接失败时用来提示原因

  let transport;
  if ("url" in cfg) {
    transport = new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } });
  } else {
    const stdio = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...getDefaultEnvironment(), ...cfg.env },
      cwd: cfg.cwd,
      stderr: "pipe",
    });
    stdio.stderr?.on("data", (d) => (stderrTail = (stderrTail + d).slice(-400)));
    transport = stdio;
  }

  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "连接超时");
  } catch (e) {
    await client.close().catch(() => {});
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(stderrTail.trim() ? `${reason}\n${stderrTail.trim()}` : reason);
  }
  clients.set(name, client);

  // 工具很多时服务器会分页返回，用 nextCursor 一页一页取
  const mcpTools = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    mcpTools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);

  const tools = mcpTools.map((t): Tool => ({
    name: toolName(name, t.name),
    description: `[来自 MCP 服务器 ${name}] ${t.description ?? t.name}`.slice(0, 1024),
    parameters: cleanSchema(t.inputSchema),
    async run(args, ctx) {
      // MCP 工具是第三方写的，能做什么全看服务器，所以每次调用前都先问学生
      const detail = JSON.stringify(args, null, 2);
      const ok = await ctx.confirm(
        toolName(name, t.name),
        `使用 MCP 工具「${t.name}」（来自 ${name}）`,
        detail.length > 600 ? detail.slice(0, 600) + "\n…" : detail,
      );
      if (!ok) return { error: "学生拒绝了这次工具调用，请问问学生原因或换个做法" };
      const result = await client.callTool({ name: t.name, arguments: args }, undefined, {
        signal: ctx.signal,
        timeout: CALL_TIMEOUT_MS,
      });
      return formatResult(result);
    },
  }));
  return { tools, info: mcpTools.map((t) => ({ name: t.name, description: (t.description ?? "").replace(/\s+/g, " ").trim() })) };
}

// 启动时连接所有配置好的 MCP 服务器（同时连接，某个失败不影响其他的）
export async function connectMcpServers(version: string): Promise<{ statuses: McpServerStatus[]; tools: Tool[] }> {
  const servers = Object.entries(loadMcpConfig()).filter(([, cfg]) => !cfg.disabled);
  const tools: Tool[] = [];
  statuses = await Promise.all(
    servers.map(async ([name, cfg]): Promise<McpServerStatus> => {
      try {
        if (!("url" in cfg) && !cfg.command) throw new Error("配置里缺少 command 或 url");
        const server = await connectServer(name, cfg, version);
        tools.push(...server.tools);
        return { name, ok: true, tools: server.info };
      } catch (e) {
        return { name, ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return { statuses, tools };
}

async function disconnect(name: string) {
  await clients.get(name)?.close().catch(() => {});
  clients.delete(name);
  statuses = statuses.filter((s) => s.name !== name);
}

// /mcp add：写进配置文件，然后马上连接（不用重启）。连接失败也保留配置，方便改了再试
export async function addMcpServer(name: string, cfg: ServerConfig, version: string) {
  writeMcpServers((servers) => (servers[name] = cfg));
  await disconnect(name); // 同名的旧服务器先断开
  let status: McpServerStatus;
  let tools: Tool[] = [];
  try {
    const server = await connectServer(name, cfg, version);
    tools = server.tools;
    status = { name, ok: true, tools: server.info };
  } catch (e) {
    status = { name, ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
  }
  statuses.push(status);
  return { status, tools };
}

// /mcp remove：从配置文件里删掉，并断开连接。返回 false 表示本来就没有这个服务器
export async function removeMcpServer(name: string) {
  const existed = name in loadMcpConfig() || clients.has(name);
  writeMcpServers((servers) => delete servers[name]);
  await disconnect(name);
  return existed;
}

// 退出时关闭所有 MCP 服务器，免得留下后台进程
export async function closeMcpServers() {
  await Promise.allSettled([...clients.values()].map((c) => c.close()));
}
