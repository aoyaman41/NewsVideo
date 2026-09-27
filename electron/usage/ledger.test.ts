import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UsageLedger } from './ledger';
import { normalizeCostRates } from '../../src/utils/cost';
import type { UsageRecord } from '../../shared/project/schema';
import type { UsageSource } from '../../shared/project/usageLedger';

let root: string;
let file: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-ledger-'));
  file = path.join(root, 'usage-ledger.json');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const rates = normalizeCostRates(undefined);

function record(patch: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: crypto.randomUUID(),
    provider: 'anthropic',
    category: 'text',
    model: 'claude-opus-5-5',
    operation: 'script_generate',
    inputTokens: 0,
    outputTokens: 1_000, // $0.02
    createdAt: '2026-09-15T03:00:00.000Z',
    ...patch,
  };
}

function ledger(sources: UsageSource[], options: { now?: () => Date } = {}) {
  const scan = vi.fn(async () => sources);
  return {
    scan,
    ledger: new UsageLedger({ filePath: file, scan, rates: async () => rates, ...options }),
  };
}

describe('UsageLedger', () => {
  it('builds the ledger once from every existing project and never scans again', async () => {
    const first = record();
    const second = record({ provider: 'openai', category: 'image', operation: 'image_generate' });
    const { ledger: built, scan } = ledger([
      { projectId: 'a', projectName: '動画 A', usage: [first] },
      { projectId: 'b', projectName: '動画 B', usage: [second, first] },
    ]);
    await built.ready();
    const summary = await built.summary();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(summary.count).toBe(2); // 同じ ID は 1 件として数える
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(saved.version).toBe(1);
    expect(saved.entries.map((entry: { id: string }) => entry.id).sort()).toEqual(
      [first.id, second.id].sort()
    );
    expect(saved.entries.find((entry: { id: string }) => entry.id === first.id)).toMatchObject({
      projectId: 'a',
      projectName: '動画 A',
      operation: 'script_generate',
      costUsd: 0.02,
    });

    // 次に起動したとき(新しいインスタンス)は、ファイルを読むだけで作り直さない
    const { ledger: reopened, scan: rescan } = ledger([]);
    expect((await reopened.summary()).count).toBe(2);
    expect(rescan).not.toHaveBeenCalled();
  });

  it('appends only new usage and ignores records it already has', async () => {
    const old = record();
    const { ledger: target } = ledger([{ projectId: 'a', projectName: '動画 A', usage: [old] }]);
    const added = record({ createdAt: '2026-09-20T00:00:00.000Z' });
    expect(
      await target.record({ projectId: 'a', projectName: '動画 A', usage: [old, added] })
    ).toBe(1);
    expect(
      await target.record({ projectId: 'a', projectName: '動画 A', usage: [old, added] })
    ).toBe(0);
    expect((await target.summary()).count).toBe(2);
  });

  it('keeps the totals after a project is deleted', async () => {
    const usage = [record(), record()];
    const { ledger: first } = ledger([{ projectId: 'a', projectName: '動画 A', usage }]);
    const before = await first.summary();
    // プロジェクトを削除しても(既存のプロジェクトの一覧から消えても)台帳の合計は変わらない
    const { ledger: afterDelete } = ledger([]);
    const after = await afterDelete.summary();
    expect(after.totalUsd).toBeCloseTo(before.totalUsd, 10);
    expect(after.count).toBe(2);
  });

  it('sums the cost by month and by service', async () => {
    const usage = [
      record({ createdAt: '2026-08-10T03:00:00.000Z' }), // Anthropic $0.02
      record({
        provider: 'openai',
        category: 'image',
        model: 'gpt-image-2.5-sunburst',
        operation: 'image_generate',
        textInputTokens: 0,
        outputTokens: 10_000, // $0.30
      }),
      record({
        provider: 'gemini',
        category: 'tts',
        model: 'gemini-3.8-flash-tts',
        operation: 'tts_generate',
        outputTokens: 10_000, // $0.09
      }),
    ];
    const { ledger: target } = ledger([{ projectId: 'a', projectName: '動画 A', usage }]);
    const summary = await target.summary();
    expect(summary.months.map((month) => month.month)).toEqual(['2026-09', '2026-08']);
    expect(summary.months[0].totals.openai).toBeCloseTo(0.3, 10);
    expect(summary.months[0].totals.google).toBeCloseTo(0.09, 10);
    expect(summary.months[0].totals.anthropic).toBe(0);
    expect(summary.months[1].totals.anthropic).toBeCloseTo(0.02, 10);
    expect(summary.totals).toEqual({
      anthropic: expect.closeTo(0.02, 10),
      openai: expect.closeTo(0.3, 10),
      google: expect.closeTo(0.09, 10),
    });
    expect(summary.totalUsd).toBeCloseTo(0.41, 10);
  });

  it('keeps the recorded amount even when the rates change later', async () => {
    const first = record();
    const { ledger: target } = ledger([{ projectId: 'a', projectName: '動画 A', usage: [first] }]);
    await target.ready();
    const cheaper = normalizeCostRates({
      anthropic: {
        textRatesByModel: {
          'claude-opus-5-5': { inputPer1MTokensUsd: 1, outputPer1MTokensUsd: 1 },
        },
      },
    });
    const later = new UsageLedger({
      filePath: file,
      scan: async () => [],
      rates: async () => cheaper,
    });
    await later.record({ projectId: 'a', projectName: '動画 A', usage: [first, record()] });
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(saved.entries.map((entry: { costUsd: number }) => entry.costUsd)).toEqual([0.02, 0.001]);
  });

  it('moves an unreadable ledger aside and rebuilds it from the projects', async () => {
    await fs.writeFile(file, '{broken');
    const onRecovered = vi.fn();
    const target = new UsageLedger({
      filePath: file,
      scan: async () => [{ projectId: 'a', projectName: '動画 A', usage: [record()] }],
      rates: async () => rates,
      now: () => new Date('2026-09-26T00:00:00.000Z'),
      onRecovered,
    });
    expect((await target.summary()).count).toBe(1);
    const backup = `${file}.broken-${new Date('2026-09-26T00:00:00.000Z').getTime()}`;
    expect(await fs.readFile(backup, 'utf8')).toBe('{broken');
    expect(onRecovered).toHaveBeenCalledWith(backup);
  });

  it('skips broken rows but keeps the others', async () => {
    const valid = {
      ...record(),
      projectId: 'a',
      projectName: '動画 A',
      costUsd: 0.02,
    };
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        createdAt: '2026-09-01T00:00:00.000Z',
        entries: [valid, { id: 'not-a-usage' }, valid],
      })
    );
    const { ledger: target, scan } = ledger([]);
    const summary = await target.summary();
    expect(summary.count).toBe(1);
    expect(summary.ledgerCreatedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(scan).not.toHaveBeenCalled();
  });

  it('builds the ledger before appending when the first save happens before startup finishes', async () => {
    const existing = record();
    const { ledger: target, scan } = ledger([
      { projectId: 'a', projectName: '動画 A', usage: [existing] },
    ]);
    const added = record();
    await Promise.all([
      target.record({ projectId: 'a', projectName: '動画 A', usage: [existing, added] }),
      target.ready(),
    ]);
    expect(scan).toHaveBeenCalledTimes(1);
    expect((await target.summary()).count).toBe(2);
  });

  it('fills in usage missing from an existing ledger at startup and never removes entries', async () => {
    const kept = record();
    const { ledger: first } = ledger([{ projectId: 'a', projectName: '動画 A', usage: [kept] }]);
    await first.ready();
    // 前回は追記の前にアプリが終了した(プロジェクトにはあるが、台帳にはない)。動画 A は削除済み
    const missed = record();
    const { ledger: restarted, scan } = ledger([
      { projectId: 'b', projectName: '動画 B', usage: [missed] },
    ]);
    expect(await restarted.reconcile()).toBe(1);
    expect(scan).toHaveBeenCalledTimes(1);
    const summary = await restarted.summary();
    expect(summary.count).toBe(2);
    // 作ったばかりの台帳は、照合で読み直さない
    const fresh = path.join(root, 'fresh.json');
    const freshScan = vi.fn(async () => [
      { projectId: 'a', projectName: '動画 A', usage: [record()] },
    ]);
    const created = new UsageLedger({ filePath: fresh, scan: freshScan, rates: async () => rates });
    expect(await created.reconcile()).toBe(0);
    expect(freshScan).toHaveBeenCalledTimes(1);
    expect((await created.summary()).count).toBe(1);
  });

  it('keeps the built ledger in memory when it cannot be written, without scanning again', async () => {
    // 読み取りだけできるフォルダには、台帳を書き込めない
    const readOnly = path.join(root, 'read-only');
    await fs.mkdir(readOnly, { mode: 0o500 });
    const scan = vi.fn(async () => [{ projectId: 'a', projectName: '動画 A', usage: [record()] }]);
    const target = new UsageLedger({
      filePath: path.join(readOnly, 'usage-ledger.json'),
      scan,
      rates: async () => rates,
    });
    try {
      await expect(target.ready()).rejects.toThrow();
      await expect(
        target.record({ projectId: 'b', projectName: '動画 B', usage: [record()] })
      ).rejects.toThrow();
      expect((await target.summary()).count).toBe(1);
      expect(scan).toHaveBeenCalledTimes(1);
    } finally {
      await fs.chmod(readOnly, 0o700);
    }
  });
});
