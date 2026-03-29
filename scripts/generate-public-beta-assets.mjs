import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const assetRoot = path.join(repoRoot, '.github', 'assets', 'public-beta');
const outputAssetRoot = path.join(assetRoot, 'sample-output');
const tempRoot = path.join('/tmp', 'newsvideo-public-beta');
const userDataDir = path.join(tempRoot, 'user-data');
const captureLogPath = path.join(tempRoot, 'capture.log');
const electronBinaryPath = path.join(repoRoot, 'node_modules', '.bin', 'electron');
const rendererUrl = pathToFileURL(path.join(repoRoot, 'dist', 'index.html')).toString();
const fontPath = '/System/Library/Fonts/Supplemental/Menlo.ttc';

const COMPLETE_PROJECT_ID = '0fbbd0df-33bb-4cfa-a4d1-5dc8d925ebad';
const SCRIPT_ONLY_PROJECT_ID = 'b1557e92-ef7a-49a1-a9da-f0eae2349d8c';
const ARTICLE_ONLY_PROJECT_ID = 'c1d24302-e23f-4dc7-a1b1-c457cf6f848a';

const articleFixture = {
  title: '再エネ拡大と蓄電池導入、来夏の電力需給を左右　系統混雑も課題',
  source: '架空ニュース通信（2025-12-10）',
  bodyText: [
    '経済産業省は10日、来夏（2026年）の電力需給見通しを公表した。猛暑を想定したピーク時の需要は全国で前年比2%増を見込み、供給余力は地域差が大きいという。',
    '太陽光・風力など再生可能エネルギーの導入拡大が進む一方、出力変動に対応するための蓄電池や需給調整力の確保が重要になる。',
    '昼間は太陽光の余剰が起きやすく、夕方以降は需要が急増するため、火力の立ち上げや蓄電池の放電が不足すると価格が急騰する可能性がある。',
    '九州や北海道では系統混雑による出力抑制が増える見込みで、連系線増強や需要地近くの蓄電池設置、需要家側のピークカットが焦点になる。',
  ].join('\n\n'),
};

const partFixtures = [
  {
    id: '3bc02cb2-fcf7-4700-a2ba-7ce6204c95be',
    promptId: 'd0483f79-4c74-4d7b-a653-1486c2e8a3af',
    imageId: '15292958-eaf7-4188-9f39-d7019d2d4be4',
    audioId: '72a9fbbe-2f16-41d6-a07f-0e368f53021f',
    title: '需給見通しの前提',
    summary: '需要増と供給余力の地域差を整理する導入パート。',
    scriptText:
      '来夏の電力需給は全国では持ちこたえる見通しですが、需要が2パーセント増える前提で、地域ごとの余力には差が残ります。再エネ比率が上がるほど、単純に発電量を見るだけではなく、時間帯ごとの調整力をどう確保するかが重要になります。',
    durationEstimateSec: 15,
    imageLabel: 'PART 1',
    imageHeadline: 'Power Demand Outlook',
    imageSubhead: 'Demand rises while reserve margins stay uneven',
    imagePalette: {
      background: '0x0f172a',
      panel: '0x132238',
      accent: '0x38bdf8',
      accentSoft: '0x0ea5e9',
      text: '0xf8fafc',
      muted: '0x94a3b8',
    },
    audioFrequency: 220,
  },
  {
    id: '9fc8255d-b6cb-4e32-a7f3-3928abdf4708',
    promptId: 'b21776e8-9cae-41af-b63b-a1d0fdbbaa73',
    imageId: '08d2b596-a654-40bb-9209-26f2a261e056',
    audioId: 'a1306753-1fe5-4ee1-b0aa-577496a6d55d',
    title: '夕方ピークと価格変動',
    summary: '再エネ余剰の後に来る夕方ピーク帯のリスクを説明する。',
    scriptText:
      '昼間は太陽光で余剰が出やすい一方で、夕方は太陽光の出力が落ちるのに合わせて需要が立ち上がります。ここで火力や蓄電池の準備が足りないと、スポット価格が急騰しやすく、電力市場の不安定さが表面化します。',
    durationEstimateSec: 16,
    imageLabel: 'PART 2',
    imageHeadline: 'Evening Price Spike',
    imageSubhead: 'Solar surplus flips into a sharp evening ramp',
    imagePalette: {
      background: '0x111827',
      panel: '0x2b1b12',
      accent: '0xfb923c',
      accentSoft: '0xf97316',
      text: '0xfffbeb',
      muted: '0xfed7aa',
    },
    audioFrequency: 246,
  },
  {
    id: 'cf567e99-e857-48d7-bff9-ffb1d08f51b3',
    promptId: 'fc964e11-674d-4731-a649-a88ff5ca308c',
    imageId: 'd6afee8d-c647-4235-89db-f70906cbab2a',
    audioId: 'c4a40cc7-f1a4-4ec1-9e27-33fc9c533a25',
    title: '系統増強と蓄電池の焦点',
    summary: '設備投資と需要家参加が今後の焦点であることを締めに置く。',
    scriptText:
      '今後の焦点は、蓄電池の導入スピードと連系線増強の進み具合、そして需要家がピークカットにどれだけ参加できるかです。供給力の追加だけでなく、需要側の柔軟性を含めて運用できるかが、料金抑制と安定供給の分かれ目になります。',
    durationEstimateSec: 15,
    imageLabel: 'PART 3',
    imageHeadline: 'Storage And Grid Upgrades',
    imageSubhead: 'Batteries and demand response become the key buffer',
    imagePalette: {
      background: '0x0b1120',
      panel: '0x0f2f34',
      accent: '0x2dd4bf',
      accentSoft: '0x14b8a6',
      text: '0xf0fdfa',
      muted: '0x99f6e4',
    },
    audioFrequency: 196,
  },
];

const screenshotTargets = [
  { route: '/projects', fileName: 'project-list.png' },
  { route: `/projects/${COMPLETE_PROJECT_ID}/article`, fileName: 'article-input.png' },
  { route: `/projects/${COMPLETE_PROJECT_ID}/image`, fileName: 'image-workflow.png' },
  { route: `/projects/${COMPLETE_PROJECT_ID}/video`, fileName: 'video-export.png' },
];

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}\n${stderr}`));
    });
  });
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function resetDir(dirPath) {
  await fs.rm(dirPath, { recursive: true, force: true });
  await ensureDir(dirPath);
}

function sanitizeProjectDirName(name, id) {
  return `${name.replace(/[^a-zA-Z0-9\u3040-\u30FF\u4E00-\u9FAF]/g, '_')}_${id.slice(0, 8)}.newsproj`;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function drawTextFilter(text, x, y, fontsize, color) {
  return `drawtext=fontfile=${fontPath}:text='${text}':fontcolor=${color}:fontsize=${fontsize}:x=${x}:y=${y}`;
}

async function generateStillImage(targetPath, fixture) {
  const { background, panel, accent, accentSoft, text, muted } = fixture.imagePalette;
  const filters = [
    `drawbox=x=0:y=0:w=1280:h=720:color=${background}:t=fill`,
    `drawbox=x=56:y=56:w=1168:h=608:color=${panel}:t=fill`,
    `drawbox=x=84:y=92:w=220:h=42:color=${accent}:t=fill`,
    drawTextFilter(fixture.imageLabel, 102, 101, 24, 'white'),
    drawTextFilter(fixture.imageHeadline, 84, 176, 42, text),
    drawTextFilter(fixture.imageSubhead, 84, 238, 26, muted),
    `drawbox=x=84:y=320:w=340:h=220:color=${accent}:t=fill`,
    `drawbox=x=454:y=356:w=112:h=184:color=${accentSoft}:t=fill`,
    `drawbox=x=598:y=300:w=112:h=240:color=${accent}:t=fill`,
    `drawbox=x=742:y=388:w=112:h=152:color=${accentSoft}:t=fill`,
    `drawbox=x=886:y=252:w=112:h=288:color=${accent}:t=fill`,
    `drawbox=x=1030:y=338:w=112:h=202:color=${accentSoft}:t=fill`,
    drawTextFilter('SUPPLY SHIFT', 114, 548, 20, text),
    drawTextFilter('DEMAND RAMP', 914, 548, 20, text),
    `drawbox=x=84:y=586:w=1056:h=2:color=${muted}:t=fill`,
  ];

  await run(
    ffmpegPath,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=1280x720:d=1',
      '-vf',
      filters.join(','),
      '-frames:v',
      '1',
      targetPath,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

async function generateAudioTone(targetPath, durationSec, frequency) {
  await run(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}:duration=${durationSec}:sample_rate=44100`,
    '-c:a',
    'pcm_s16le',
    targetPath,
  ]);
}

async function generateFinalVideo(targetPath, imagePaths) {
  const filterGraph = [
    '[0:v]scale=1280:720,setsar=1[v0]',
    '[1:v]scale=1280:720,setsar=1[v1]',
    '[2:v]scale=1280:720,setsar=1[v2]',
    '[v0][v1][v2]concat=n=3:v=1:a=0,format=yuv420p[v]',
  ].join(';');

  await run(ffmpegPath, [
    '-y',
    '-loop',
    '1',
    '-t',
    '4.5',
    '-i',
    imagePaths[0],
    '-loop',
    '1',
    '-t',
    '4.5',
    '-i',
    imagePaths[1],
    '-loop',
    '1',
    '-t',
    '4.5',
    '-i',
    imagePaths[2],
    '-filter_complex',
    filterGraph,
    '-map',
    '[v]',
    '-r',
    '24',
    '-pix_fmt',
    'yuv420p',
    targetPath,
  ]);
}

async function createCompleteProject(projectsDir) {
  const name = 'Public Beta Demo';
  const projectDir = path.join(projectsDir, sanitizeProjectDirName(name, COMPLETE_PROJECT_ID));
  const imageDir = path.join(projectDir, 'images');
  const importedDir = path.join(imageDir, 'imported');
  const audioDir = path.join(projectDir, 'audio');
  const outputDir = path.join(projectDir, 'output');

  await ensureDir(importedDir);
  await ensureDir(audioDir);
  await ensureDir(outputDir);
  await ensureDir(outputAssetRoot);

  const createdAt = '2026-03-20T09:30:00.000Z';
  const updatedAt = '2026-03-28T15:20:00.000Z';

  const images = [];
  const prompts = [];
  const audio = [];
  const parts = [];

  for (let index = 0; index < partFixtures.length; index += 1) {
    const fixture = partFixtures[index];
    const outputStillPath = path.join(outputAssetRoot, `output-part-${index + 1}.png`);
    const projectStillPath = path.join(imageDir, `output-part-${index + 1}.png`);
    const audioPath = path.join(audioDir, `part-${index + 1}.wav`);

    await generateStillImage(outputStillPath, fixture);
    await fs.copyFile(outputStillPath, projectStillPath);
    await generateAudioTone(audioPath, fixture.durationEstimateSec, fixture.audioFrequency);

    images.push({
      id: fixture.imageId,
      filePath: projectStillPath,
      sourceType: 'generated',
      metadata: {
        width: 1280,
        height: 720,
        mimeType: 'image/png',
        fileSize: (await fs.stat(projectStillPath)).size,
        createdAt: updatedAt,
        promptId: fixture.promptId,
        tags: ['public-beta', `part-${index + 1}`],
        generation: {
          model: 'gemini-3.1-flash-image-preview',
          resolution: 'fhd',
          imageSizeTier: '1K',
          aspectRatio: '16:9',
          inputTokens: 842,
          outputTokens: 1324,
          totalTokens: 2166,
        },
      },
    });

    prompts.push({
      id: fixture.promptId,
      partId: fixture.id,
      stylePreset: 'infographic',
      prompt: `Create an infographic-style 16:9 visual about ${fixture.title}. Show electricity demand, battery storage, and grid balancing in a clean editorial style.`,
      negativePrompt: 'No logos, no watermarks, no UI chrome, no raw screenshots.',
      aspectRatio: '16:9',
      version: 1,
      createdAt: updatedAt,
    });

    const audioAsset = {
      id: fixture.audioId,
      filePath: audioPath,
      durationSec: fixture.durationEstimateSec,
      ttsEngine: 'gemini_tts',
      voiceId: 'Kore',
      settings: {
        speakingRate: 1,
        pitch: 0,
        languageCode: 'ja-JP',
      },
      generatedAt: updatedAt,
    };

    audio.push(audioAsset);

    parts.push({
      id: fixture.id,
      index,
      title: fixture.title,
      summary: fixture.summary,
      scriptText: fixture.scriptText,
      durationEstimateSec: fixture.durationEstimateSec,
      panelImages: [{ imageId: fixture.imageId, displayDurationSec: fixture.durationEstimateSec }],
      comments: [],
      audio: audioAsset,
      createdAt,
      updatedAt,
      scriptGeneratedAt: createdAt,
      scriptModifiedByUser: false,
    });
  }

  const finalVideoPath = path.join(outputDir, 'public-beta-demo.mp4');
  await generateFinalVideo(
    finalVideoPath,
    partFixtures.map((_, index) => path.join(imageDir, `output-part-${index + 1}.png`))
  );

  const projectMeta = {
    id: COMPLETE_PROJECT_ID,
    name,
    schemaVersion: 'v1.1',
    createdAt,
    updatedAt,
    thumbnail: { imageId: partFixtures[0].imageId },
    autoGenerationStatus: {
      running: false,
      step: 'done',
      startedAt: createdAt,
      updatedAt,
      finishedAt: updatedAt,
      steps: {
        script: true,
        prompts: true,
        images: true,
        audio: true,
        video: true,
      },
      lastVideoPath: finalVideoPath,
    },
  };

  await writeJson(path.join(projectDir, 'project.json'), projectMeta);
  await writeJson(path.join(projectDir, 'article.json'), {
    ...articleFixture,
    importedImages: [],
  });
  await writeJson(path.join(projectDir, 'parts.json'), parts);
  await writeJson(path.join(projectDir, 'images.json'), images);
  await writeJson(path.join(projectDir, 'prompts.json'), prompts);
  await writeJson(path.join(projectDir, 'audio.json'), audio);
  await writeJson(path.join(projectDir, 'usage.json'), [
    {
      id: randomUUID(),
      provider: 'openai',
      category: 'text',
      model: 'gpt-5.2',
      operation: 'script_generate',
      inputTokens: 2221,
      outputTokens: 874,
      createdAt,
    },
    {
      id: randomUUID(),
      provider: 'gemini',
      category: 'image',
      model: 'gemini-3.1-flash-image-preview',
      operation: 'image_generate_batch',
      imageCount: 3,
      imageResolution: 'fhd',
      imageSizeTier: '1K',
      imageAspectRatio: '16:9',
      createdAt: updatedAt,
    },
  ]);
}

async function createScriptOnlyProject(projectsDir) {
  const name = 'Script Draft Demo';
  const id = SCRIPT_ONLY_PROJECT_ID;
  const projectDir = path.join(projectsDir, sanitizeProjectDirName(name, id));
  const createdAt = '2026-03-26T04:45:00.000Z';
  const updatedAt = '2026-03-27T08:15:00.000Z';

  await ensureDir(path.join(projectDir, 'images', 'imported'));
  await ensureDir(path.join(projectDir, 'audio'));
  await ensureDir(path.join(projectDir, 'output'));

  await writeJson(path.join(projectDir, 'project.json'), {
    id,
    name,
    schemaVersion: 'v1.1',
    createdAt,
    updatedAt,
  });
  await writeJson(path.join(projectDir, 'article.json'), {
    title: '地方空港と訪日需要、夏ダイヤで便数回復',
    source: '架空ニュース通信（2025-11-08）',
    bodyText:
      '地方空港で国際線の夏ダイヤが回復しつつある。運航枠と人員確保がボトルネックで、需要回復の速度に供給側が追いつけるかが焦点だ。',
    importedImages: [],
  });
  await writeJson(path.join(projectDir, 'parts.json'), [
    {
      id: randomUUID(),
      index: 0,
      title: '訪日需要の回復',
      summary: '国際線の便数回復と空港側の制約を整理する。',
      scriptText:
        '国際線の需要は回復基調ですが、便数の完全回復には地上業務の人員や運航枠の制約が残っています。',
      durationEstimateSec: 14,
      panelImages: [],
      comments: [],
      createdAt,
      updatedAt,
      scriptGeneratedAt: createdAt,
      scriptModifiedByUser: false,
    },
  ]);
  await writeJson(path.join(projectDir, 'images.json'), []);
  await writeJson(path.join(projectDir, 'prompts.json'), []);
  await writeJson(path.join(projectDir, 'audio.json'), []);
  await writeJson(path.join(projectDir, 'usage.json'), []);
}

async function createArticleOnlyProject(projectsDir) {
  const name = 'Article Intake Demo';
  const id = ARTICLE_ONLY_PROJECT_ID;
  const projectDir = path.join(projectsDir, sanitizeProjectDirName(name, id));
  const createdAt = '2026-03-22T11:10:00.000Z';
  const updatedAt = '2026-03-22T11:10:00.000Z';

  await ensureDir(path.join(projectDir, 'images', 'imported'));
  await ensureDir(path.join(projectDir, 'audio'));
  await ensureDir(path.join(projectDir, 'output'));

  await writeJson(path.join(projectDir, 'project.json'), {
    id,
    name,
    schemaVersion: 'v1.1',
    createdAt,
    updatedAt,
  });
  await writeJson(path.join(projectDir, 'article.json'), {
    title: '自治体向けデータセンター整備、電力と冷却負荷が課題',
    source: '架空ニュース通信（2025-10-18）',
    bodyText:
      '自治体がデータセンターの誘致に動く一方、電力供給と冷却コストの説明責任が厳しく問われている。事前の需給計画が重要だ。',
    importedImages: [],
  });
  await writeJson(path.join(projectDir, 'parts.json'), []);
  await writeJson(path.join(projectDir, 'images.json'), []);
  await writeJson(path.join(projectDir, 'prompts.json'), []);
  await writeJson(path.join(projectDir, 'audio.json'), []);
  await writeJson(path.join(projectDir, 'usage.json'), []);
}

async function seedPublicBetaFixture() {
  await resetDir(tempRoot);
  await resetDir(assetRoot);
  await ensureDir(outputAssetRoot);

  const projectsDir = path.join(userDataDir, 'projects');
  await ensureDir(projectsDir);

  await Promise.all([
    createCompleteProject(projectsDir),
    createScriptOnlyProject(projectsDir),
    createArticleOnlyProject(projectsDir),
  ]);
}

async function waitForElectronWindowId(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const swiftScript = `
import CoreGraphics

let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
for entry in list {
  let owner = entry[kCGWindowOwnerName as String] as? String ?? ""
  if owner != "Electron" && owner != "NewsVideo" { continue }

  let title = entry[kCGWindowName as String] as? String ?? ""
  if !title.contains("NewsVideo") { continue }

  let id = entry[kCGWindowNumber as String] as? Int ?? -1
  if id > 0 {
    print(id)
    break
  }
}
`;

  while (Date.now() < deadline) {
    const { stdout } = await run('swift', ['-e', swiftScript]);
    const windowId = stdout.trim();
    if (windowId && windowId !== 'NO_WINDOW') {
      await delay(1200);
      return windowId;
    }
    await delay(400);
  }

  throw new Error('Timed out while waiting for the Electron window.');
}

async function captureWindow(windowId, targetPath) {
  await run('screencapture', ['-x', '-l', String(windowId), targetPath]);
}

async function cleanupElectronProcesses() {
  await run('pkill', ['-f', `${repoRoot}/node_modules/.bin/electron`]).catch(() => null);
  await run('pkill', ['-f', `${repoRoot}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`]).catch(
    () => null
  );
  await delay(500);
}

async function closeElectron(child) {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');

  const deadline = Date.now() + 5000;
  while (child.exitCode == null && Date.now() < deadline) {
    await delay(200);
  }

  if (child.exitCode == null) {
    child.kill('SIGKILL');
    await delay(300);
  }
}

async function captureScreenshot(route, targetPath) {
  await cleanupElectronProcesses();
  const logHandle = await fs.open(captureLogPath, 'a');
  const child = spawn(electronBinaryPath, ['.'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEWSVIDEO_USER_DATA_DIR: userDataDir,
      NEWSVIDEO_START_PATH: route,
      NEWSVIDEO_RENDERER_URL: rendererUrl,
      NEWSVIDEO_SHOW_WINDOW_IMMEDIATELY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', async (chunk) => {
    await logHandle.appendFile(chunk);
  });
  child.stderr.on('data', async (chunk) => {
    await logHandle.appendFile(chunk);
  });

  try {
    const windowId = await waitForElectronWindowId();
    await captureWindow(windowId, targetPath);
  } finally {
    await closeElectron(child);
    await cleanupElectronProcesses();
    await logHandle.close();
  }
}

async function buildWorkflowGif() {
  const concatListPath = path.join(tempRoot, 'workflow-demo.txt');
  const gifPath = path.join(assetRoot, 'workflow-demo.gif');
  const concatLines = screenshotTargets.flatMap((entry) => [
    `file '${path.join(assetRoot, entry.fileName).replace(/'/g, "'\\''")}'`,
    'duration 1.8',
  ]);
  concatLines.push(`file '${path.join(assetRoot, screenshotTargets.at(-1).fileName).replace(/'/g, "'\\''")}'`);
  await fs.writeFile(concatListPath, `${concatLines.join('\n')}\n`, 'utf-8');

  await run(ffmpegPath, [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatListPath,
    '-vf',
    'fps=8,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer',
    gifPath,
  ]);
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Public beta asset generation currently supports macOS only.');
  }

  await run('npm', ['run', 'build:vite']);
  await seedPublicBetaFixture();

  for (const target of screenshotTargets) {
    await captureScreenshot(target.route, path.join(assetRoot, target.fileName));
  }

  await buildWorkflowGif();
}

await main();
