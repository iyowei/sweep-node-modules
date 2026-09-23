/**
 * 合成工作区生成器: 为扫描 / 体积 / 安全闸的测试与基准提供确定的目录树。
 * 全部生成在系统临时目录下; 调用方经返回的 cleanup() 清理。
 */
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ProjectSpec {
  /** 项目目录相对路径 (相对工作区根) */
  dir: string;
  /** node_modules 内散文件数 (默认 2) */
  files?: number;
  /** 每个文件字节数 (默认 256) */
  bytesPerFile?: number;
  /** 在 node_modules 内部再嵌一层 node_modules (剪枝用例) */
  nested?: boolean;
  /** 生成 .git 目录并在其中埋诱饵 node_modules (跳过 .git 的用例) */
  git?: boolean;
}

export interface WorkspaceSpec {
  projects: ProjectSpec[];
  /** 目录符号链接: at -> to (均为工作区根相对路径) */
  symlinks?: { at: string; to: string }[];
  /** 不可读目录 (chmod 000, 空目录) */
  unreadable?: string[];
}

export interface Workspace {
  root: string;
  cleanup(): Promise<void>;
}

const filler = (n: number) => 'x'.repeat(n);

export async function makeWorkspace(spec: WorkspaceSpec): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), 'sweep-lab-'));

  for (const project of spec.projects) {
    const nodeModules = join(root, project.dir, 'node_modules');
    await mkdir(nodeModules, { recursive: true });
    const files = project.files ?? 2;
    const bytes = project.bytesPerFile ?? 256;
    for (let i = 0; i < files; i += 1) {
      await writeFile(join(nodeModules, `pkg-${i}.js`), filler(bytes));
    }
    if (project.nested) {
      const inner = join(nodeModules, 'dep', 'node_modules');
      await mkdir(inner, { recursive: true });
      await writeFile(join(inner, 'inner.js'), filler(64));
    }
    if (project.git) {
      const bait = join(root, project.dir, '.git', 'x', 'node_modules');
      await mkdir(bait, { recursive: true });
      await writeFile(join(bait, 'bait.js'), filler(64));
    }
  }

  for (const link of spec.symlinks ?? []) {
    await symlink(join(root, link.to), join(root, link.at));
  }

  for (const dir of spec.unreadable ?? []) {
    await mkdir(join(root, dir), { recursive: true });
    await chmod(join(root, dir), 0o000);
  }

  return {
    root,
    async cleanup() {
      for (const dir of spec.unreadable ?? []) {
        await chmod(join(root, dir), 0o700).catch(() => {});
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}
