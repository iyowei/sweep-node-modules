/**
 * 初始化向导: 三问 (扫描根 / 排除名单 / 包含名单) + 覆盖保护, 交互 IO 依赖注入。
 * 权威: sweep-node-modules 设计文档「配置初始化模型」与 ADR 0004 (配置初始化向导)。
 * 纯逻辑 (答案解析 / 状态流转 / 落盘文本) 与 readline 交互分离, 前者由 init.test.ts 钉死。
 * 视觉: 与清单同一套色块语言 (顶栏 / 中性行 / 标记原语见 render.ts), 着色开关经 IO 层注入。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Interface, createInterface } from 'node:readline/promises';

import { type Config } from './config.ts';
import { bannerLine, neutralLine, paint, shortenHome } from './render.ts';

/** 交互 IO: ask 返回 null 表示取消 (Ctrl+C / EOF) */
export interface InitIO {
  /** 提问并等待一行答案; 返回 null 即取消 (hint 非空时以压暗的 [hint] 附在问句后) */
  ask(question: string, hint?: string): Promise<string | null>;
  /** 是 / 否确认; 空答取 defaultYes */
  confirm(question: string, defaultYes: boolean): Promise<boolean>;
  /** 输出一行普通信息 */
  print(line: string): void;
  /** 着色开关 (非 TTY / NO_COLOR 为 false): 本次向导的问句提示与回执按它着色, 与清单同一降级契约 */
  color: boolean;
}

/** 运行依赖: 文件系统与 IO 全部注入, 本模块不直接碰 stdin / fs */
export interface InitDeps {
  /** 配置文件目标路径 */
  configPath: string;
  fileExists(path: string): Promise<boolean>;
  writeFile(path: string, text: string): Promise<void>;
  io: InitIO;
}

export interface InitResult {
  state: 'written' | 'cancelled' | 'declined-overwrite';
  /** 仅 state 为 written 时存在: 实际落盘的配置 (复用 Config 而非重述形状, 加字段时不会漏改) */
  config?: Config;
}

/** 空白判定: 正则 \s 已覆盖全角空格 (\u3000) 等 Unicode 空白 */
const WHITESPACE = /\s/;

/** 家目录展开: 仅认 ~ 与 ~/... / ~\... (后者是 win32 习惯; 不解析 ~user: 跨平台语义不一) */
function expandHome(token: string): string {
  if (token === '~') return homedir();
  if (token.startsWith('~/') || token.startsWith('~\\'))
    return join(homedir(), token.slice(2));
  return token;
}

/**
 * 答案切分: 逗号 (半角 / 全角) 与未加引号的空白作分隔; 成对引号 (双 / 单) 内的
 * 空格与逗号原样保留、引号字符剥离; 未配对的引号按普通字符处理, 不吞后续内容。
 */
function splitAnswer(answer: string): string[] {
  const items: string[] = [];
  let current = '';
  let openQuote: string | null = null;

  for (let index = 0; index < answer.length; index += 1) {
    const char = answer[index]!;

    if (openQuote !== null) {
      if (char === openQuote) {
        openQuote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      // 仅当后方存在配对引号才进入引用态; 未配对时按普通字符累积
      if (answer.indexOf(char, index + 1) !== -1) {
        openQuote = char;
        continue;
      }
      current += char;
      continue;
    }

    if (char === ',' || char === '，' || WHITESPACE.test(char)) {
      if (current.length > 0) items.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current.length > 0) items.push(current);
  return items;
}

/**
 * 答案解析: 切分 (见 splitAnswer) → 家目录展开; 空答案 (含 null) 回落 fallback。
 *
 * ### 数据追踪示例
 *
 * Input（真实 Payload）
 *   answer = '"~/My Projects", ~/lab'
 *   fallback = ['/Users/iyowei/tmp']
 *
 * 步骤 1：切分 (引号内空格保留, 未加引号的逗号 / 空白作分隔)
 *   items = ['~/My Projects', '~/lab']
 *
 * 步骤 2：展开家目录 (~ 与 ~/...)
 *   items = ['/Users/iyowei/My Projects', '/Users/iyowei/lab']
 *
 * Output（数据契约）
 *   return ['/Users/iyowei/My Projects', '/Users/iyowei/lab']
 */
export function parseList(answer: string | null, fallback: string[]): string[] {
  if (answer === null) return [...fallback];
  const items = splitAnswer(answer).map(expandHome);
  return items.length > 0 ? items : [...fallback];
}

/**
 * 装配配置并落盘 (2 空格缩进 + 末尾换行)。
 * 外部副作用：经 deps.writeFile 写入 configPath。
 *
 * 执行步骤：
 * 1. 顶栏先出 (与清单同一视觉语言), 配置已存在则再确认覆盖 (默认否), 拒绝即返回 declined-overwrite;
 * 2. 开场提示后问扫描根 (默认值为家目录而非 cwd: 工作区级清理与唤起目录无关, 提示里的默认值经
 *    家目录缩写): 逐根校验存在性, 不存在的红色 ✗ 提示后重问该问;
 * 3. 依次问排除名单与包含名单 (均可留空), 回显解析结果 (人话计数) 并确认 (默认写入);
 * 4. 中途取消与回显拒绝统一返回 cancelled 且不落盘 (取消文案保持原样, 不带视觉标记);
 * 5. 落盘后回显 (写入路径带家目录缩写与绿色 ✓; 落盘全文内容与文件一致、整体缩进 2), 返回 written。
 */
export async function runInit(deps: InitDeps): Promise<InitResult> {
  const { configPath, fileExists, writeFile, io } = deps;
  const { color } = io;

  /** 统一取消出口: 中途取消与回显拒绝共用同一措辞 */
  function cancelled(): InitResult {
    io.print('已取消, 未写入配置');
    return { state: 'cancelled' };
  }

  io.print(bannerLine('初始化向导', color));

  if (await fileExists(configPath)) {
    const overwrite = await io.confirm(
      `配置已存在 (${configPath}), 是否覆盖?`,
      false,
    );
    if (!overwrite) return { state: 'declined-overwrite' };
  }

  io.print(neutralLine('首次使用, 先确定扫描范围', color));

  // 默认取家目录而非 cwd: 本工具是工作区级清理, 用户从哪个目录唤起与要扫的范围
  // 无关 (cwd 常是某个项目内部, 作默认值无意义); 非 TTY 静默回退仍按 cwd, 见 cli.ts
  const home = homedir();
  let roots: string[] = [];

  // 存在性校验挡在落盘前: 坏根提示后重问, 不让无效路径进配置
  for (;;) {
    const rootsAnswer = await io.ask(
      '扫描根 (逗号或空白分隔多个)',
      `默认: ${shortenHome(home, home)}`,
    );
    if (rootsAnswer === null) return cancelled();
    roots = parseList(rootsAnswer, [home]);

    const missing: string[] = [];
    for (const root of roots) {
      if (!(await fileExists(root))) missing.push(root);
    }
    if (missing.length === 0) break;
    for (const path of missing)
      io.print(`  ${paint('✗', '31', color)} 根不存在: ${path}`);
  }

  const excludeAnswer = await io.ask('排除名单 (目录名, 可留空)', '回车跳过');
  if (excludeAnswer === null) return cancelled();
  const exclude = parseList(excludeAnswer, []);

  const includeAnswer = await io.ask('包含名单 (目录名, 可留空)', '回车跳过');
  if (includeAnswer === null) return cancelled();
  const include = parseList(includeAnswer, []);

  io.print(
    neutralLine(
      `将写入 ${roots.length} 个扫描根 · 排除 ${exclude.length} 条 · 包含 ${include.length} 条`,
      color,
    ),
  );
  if (!(await io.confirm('确认写入?', true))) return cancelled();

  const config = { roots, exclude, include };
  const text = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(configPath, text);
  // 路径行缩写家目录便于辨认; 正文回显落盘原文 (与文件逐字一致, 便于对照与复制)
  io.print(
    `  配置已写入: ${shortenHome(configPath, homedir())}  ${paint('✓', '32', color)}`,
  );
  io.print('');
  // 回显逐行缩进 2, 与叙述行/交互行同一左缘 (内容与落盘文件逐字一致, 仅整体加固定两空格缩进)
  io.print(
    text
      .trimEnd()
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
  );
  io.print('');
  return { state: 'written', config };
}

/**
 * stdin 的进程引用管理: 等待一行期间保持 ref, 等待结束 (一行到手 / 流关闭) 即 unref,
 * 使 TTY 场景向导完成后进程能自然退出 (pty 实测: 不释放则挂在 stdin 上, 契约又无 close 通道)。
 * 为何 close 路径也显式释放: 官方文档 (nodejs.org/api/readline.html) 未承诺 close 释放引用,
 * 反而直接推荐 process.stdin.unref() 让进程退出; 虽 pty 双载体实测 (node v26 / bun 1.4.2)
 * close 后进程立即退出, 但那是未文档化的实现细节, 故按对称语义显式释放 (幂等, 防运行时差异)。
 * bun 的 process.stdin 在流结束后 ref / unref 会消失 (eof 场景实测: 无条件调用抛 TypeError),
 * 故按存在性调用, 缺失时跳过 (此刻流已结束, 引用管理本就无意义)。
 */
function setStdinRef(shouldRef: boolean): void {
  const fn = shouldRef ? process.stdin.ref : process.stdin.unref;
  if (typeof fn === 'function') fn.call(process.stdin);
}

/**
 * 真实 readline 适配 (薄壳, 由 e2e 覆盖)。
 * 单 interface 长存 + 自管行缓冲: 管道一次性投喂多行时, 先到的行入队, 后续问题依次取走
 * (每问新开 interface 的形态会丢行并因 EOF 已发生而永久挂起, 冒烟实测坐实)。
 * color 由调用方判定后传入 (见 cli.ts 的 colorEnabled); 问句里的 [hint] 与 (Y/n) 标记按它压暗。
 * prompt 内嵌 ANSI 安全: readline 算光标位置前会剥控制序列 (node 源码 _getDisplayPos 实证)。
 * 外部副作用：读写 process.stdin / process.stdout。
 * stdin 结束 (EOF) 或 Ctrl+C 一律折算为取消 (ask 返 null, confirm 返 false)。
 */
export function createReadlineIO(color: boolean): InitIO {
  /** 已到达但尚无问题认领的行 (先于问题到达的答案) */
  const buffered: string[] = [];
  let rl: Interface | null = null;
  let ended = false;
  /** 当前等待中的问题; 调用方串行提问, 同一时刻至多一个 */
  let pending: ((line: string | null) => void) | null = null;

  function ensure(): Interface {
    if (rl !== null) return rl;

    const created = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    created.on('line', (line) => {
      if (pending === null) {
        buffered.push(line);
        return;
      }
      const resolve = pending;
      pending = null;
      setStdinRef(false);
      resolve(line);
    });
    created.on('close', () => {
      ended = true;
      if (pending === null) return;
      const resolve = pending;
      pending = null;
      setStdinRef(false); // 与 line 路径对称: 等待因流关闭而结束, 同样释放引用
      resolve(null);
    });
    created.on('SIGINT', () => created.close());
    rl = created;
    return created;
  }

  /** 取一行: 先回显提示, 缓冲命中立即取, 否则挂起等待; 会话结束返回 null */
  function readLine(prompt: string): Promise<string | null> {
    // 会话已结束: 重建 interface 也等不到已发生过的 EOF, 直接折算取消
    if (ended) return Promise.resolve(null);

    const created = ensure();
    created.setPrompt(prompt);
    created.prompt();

    const ready = buffered.shift();
    if (ready !== undefined) return Promise.resolve(ready);

    setStdinRef(true);
    return new Promise((resolve) => {
      pending = resolve;
    });
  }

  return {
    color,
    ask(question, hint) {
      // 缩进 2: 与叙述行 (neutralLine) 同一左缘, 全流程不横跳 (视觉规格见 cli-surface.md「init 向导」)
      const prompt =
        hint === undefined
          ? `  ${question} `
          : `  ${question} [${paint(hint, '2', color)}] `;
      return readLine(prompt);
    },
    async confirm(question, defaultYes) {
      const mark = paint(defaultYes ? '(Y/n)' : '(y/N)', '2', color);
      const answer = await readLine(`  ${question} ${mark} `);
      if (answer === null) return false;
      const normalized = answer.trim().toLowerCase();
      if (normalized === '') return defaultYes;
      return normalized === 'y' || normalized === 'yes';
    },
    print(line) {
      process.stdout.write(`${line}\n`);
    },
  };
}
