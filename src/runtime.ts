/**
 * 运行时适配层: Bun 优先 / Node 回退 (设计: 总纲「二、代码结构与运行时基座」; ADR 0006)。
 * 两处实质差异 (spawn 与文件读写) 的分支收敛在本文件内部, 调用方无感;
 * 其余能力一律走 node: 兼容 API, 不设分支。仅用可擦除 TS 语法。
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

/** Bun 子进程句柄在本层用到的最小面 (stdout 以 'pipe' 捕获时) */
interface BunSpawned {
  /** 标准输出流 */
  stdout: ReadableStream<Uint8Array>;
  /** 退出码 */
  exited: Promise<number>;
}

/** Bun 全局对象的最小面: 仅声明本层实际调用的成员 (Node 侧不存在, 靠功能检测分流) */
declare const Bun: {
  spawn(
    cmd: string[],
    options: { stdout: 'pipe'; stderr: 'inherit' },
  ): BunSpawned;
  file(path: string): { text(): Promise<string> };
  write(path: string, text: string): Promise<number>;
};

/** 运行时探测: 功能检测, 有 Bun 走 Bun 实现, 无则回退 Node 实现 */
export const isBun: boolean = typeof Bun !== 'undefined';

/** 版本表: 两个运行时各自在 process.versions 里自报版本 (bun 报在 .bun, node 报在 .node) */
const versions = process.versions as Record<string, string | undefined>;
const runtimeName = isBun ? 'bun' : 'node';

/**
 * 运行时自述 (如 `bun 1.4.2`): 供输出如实展示本次的执行环境。
 * 取运行时自报字段而非外部探测 —— 直接跑 `node dist/cli.js` 或经启动器跑, 报的都是真身。
 */
export const runtimeLabel: string = `${runtimeName} ${versions[runtimeName] ?? 'unknown'}`;

export interface SpawnResult {
  /** 标准输出全文 (UTF-8) */
  stdout: string;
  /** 退出码; 非零不视为错误, 由调用方判定 */
  exitCode: number;
}

/**
 * 执行命令并捕获 stdout。
 * 命令不存在 (ENOENT) 时抛出含命令名的错误; 退出码非零原样返回, 不抛错。
 * stderr 直通 (inherit) 而非捕获: 既避免管道缓冲填满导致子进程阻塞, 又让错误原样可见。
 */
export async function spawnCapture(
  cmd: string,
  args: string[],
): Promise<SpawnResult> {
  if (isBun) {
    let proc: BunSpawned;
    try {
      proc = Bun.spawn([cmd, ...args], { stdout: 'pipe', stderr: 'inherit' });
    } catch (err) {
      // Bun 对不存在的命令在 spawn 这类调用处同步抛出 (code 为 ENOENT), 不同于 Node 的 error 事件
      throw spawnFailure(cmd, err);
    }

    // 先读尽 stdout 再等退出, 避免大输出时管道阻塞
    const stdout = await new Response(proc.stdout).text();
    return { stdout, exitCode: await proc.exited };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    const out = child.stdout!;
    let stdout = '';

    out.setEncoding('utf8');
    out.on('data', (chunk: string) => {
      stdout += chunk;
    });
    // 命令不存在时走 error 事件 (ENOENT); Node 随后还会补一个 close, 被首个 settle 忽略
    child.on('error', (err) => {
      reject(spawnFailure(cmd, err));
    });
    child.on('close', (code) => {
      // 被信号终止时 code 为 null, 以非零兜底 (非零即失败, 交调用方判定)
      resolve({ stdout, exitCode: code ?? 1 });
    });
  });
}

/** 读取文本文件 (UTF-8); 文件不存在时 reject (两运行时行为一致) */
export async function readTextFile(path: string): Promise<string> {
  if (isBun) {
    return Bun.file(path).text();
  }

  return readFile(path, 'utf8');
}

/** 写入文本文件 (UTF-8); 目标目录不存在时 reject */
export async function writeTextFile(path: string, text: string): Promise<void> {
  if (isBun) {
    await Bun.write(path, text);
    return;
  }

  await writeFile(path, text, 'utf8');
}

/**
 * 把两运行时各自的 spawn 失败统一为含命令名的错误。
 * ENOENT (命令不存在) 与非 ENOENT (如无执行权限) 分流措辞, 原始 message 保留在括号内。
 */
function spawnFailure(cmd: string, err: unknown): Error {
  const code = (err as { code?: string }).code;
  const detail = err instanceof Error ? err.message : String(err);
  const reason = code === 'ENOENT' ? '命令不存在' : '命令无法执行';
  return new Error(`${reason}: ${cmd} (${detail})`);
}
