#!/usr/bin/env node
'use strict';

/*
 * Uploads the generated black JR Rewards badge images to Google Drive as
 * individual files and writes a file-id manifest for spreadsheet linking.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OAUTH_PATH = path.join(process.env.HOME || '', '.clasprc.json');
const DEFAULT_FILE_LIST = path.join(REPO_ROOT, 'tmp/black-badge-files.txt');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, '05-tools/reports/jr-rewards-drive-files.json');
const DEFAULT_FOLDER_NAME = 'JR Rewards - Black Badge Images';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

function parseArgs(argv) {
  const options = {
    oauthPath: DEFAULT_OAUTH_PATH,
    fileListPath: DEFAULT_FILE_LIST,
    outputPath: DEFAULT_OUTPUT_PATH,
    folderName: DEFAULT_FOLDER_NAME,
    folderId: '',
    concurrency: 6,
    limit: 0,
    shareAnyone: true
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--oauth') {
      options.oauthPath = path.resolve(argv[++index]);
    } else if (arg === '--file-list') {
      options.fileListPath = path.resolve(argv[++index]);
    } else if (arg === '--out') {
      options.outputPath = path.resolve(argv[++index]);
    } else if (arg === '--folder-name') {
      options.folderName = argv[++index];
    } else if (arg === '--folder-id') {
      options.folderId = argv[++index];
    } else if (arg === '--concurrency') {
      options.concurrency = Number(argv[++index]);
    } else if (arg === '--limit') {
      options.limit = Number(argv[++index]);
    } else if (arg === '--no-share-anyone') {
      options.shareAnyone = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive number');
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node 05-tools/scripts/upload-jr-rewards-drive-images.cjs [options]

Options:
  --file-list PATH       Text file with one local image path per line.
  --out PATH             Write Drive file-id manifest JSON here.
  --folder-name NAME     Drive folder name to create/reuse.
  --folder-id ID         Upload into an existing Drive folder ID.
  --concurrency N        Parallel upload count. Default: 6.
  --limit N              Upload only the first N files, for testing.
  --no-share-anyone      Do not add an anyone-reader permission to the folder.
  -h, --help             Show this help.
`);
}

function readOAuthConfig(oauthPath) {
  const raw = JSON.parse(fs.readFileSync(oauthPath, 'utf8'));
  const token = raw.tokens && raw.tokens.default ? raw.tokens.default : raw;
  for (const key of ['client_id', 'client_secret', 'refresh_token']) {
    if (!token[key]) throw new Error(`OAuth config is missing ${key}`);
  }
  return token;
}

async function refreshAccessToken(oauthConfig) {
  const params = new URLSearchParams({
    client_id: oauthConfig.client_id,
    client_secret: oauthConfig.client_secret,
    refresh_token: oauthConfig.refresh_token,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Unable to refresh Drive token: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

function makeDriveClient(accessToken) {
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`Drive API ${response.status}: ${JSON.stringify(body)}`);
    }
    return body;
  }

  return { request };
}

function driveFileUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

function driveThumbnailUrl(fileId) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600`;
}

function quoteDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listFiles(client, query, fields) {
  const files = [];
  let pageToken = '';
  do {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    url.searchParams.set('q', query);
    url.searchParams.set('fields', `nextPageToken,files(${fields})`);
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = await client.request(url);
    files.push(...(body.files || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function findOrCreateFolder(client, folderName, folderId) {
  if (folderId) {
    const url = new URL(`${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}`);
    url.searchParams.set('fields', 'id,name,webViewLink');
    url.searchParams.set('supportsAllDrives', 'true');
    return client.request(url);
  }

  const query = [
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${quoteDriveQueryValue(folderName)}'`,
    'trashed = false'
  ].join(' and ');
  const matches = await listFiles(client, query, 'id,name,webViewLink,createdTime');
  if (matches.length) return matches[0];

  return client.request(`${DRIVE_API_BASE}/files?supportsAllDrives=true&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });
}

async function ensureAnyoneReader(client, folderId) {
  try {
    await client.request(`${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'anyone',
        role: 'reader'
      })
    });
    return true;
  } catch (error) {
    if (String(error.message || '').includes('alreadyExists')) return true;
    console.warn(`[drive-upload] Could not set anyone-reader permission on folder ${folderId}: ${error.message}`);
    return false;
  }
}

async function loadExistingFiles(client, folderId) {
  const query = `'${quoteDriveQueryValue(folderId)}' in parents and trashed = false`;
  const files = await listFiles(client, query, 'id,name,webViewLink,md5Checksum,size');
  const byName = new Map();
  files.forEach(file => {
    if (file.name && !byName.has(file.name)) byName.set(file.name, file);
  });
  return byName;
}

function readImagePaths(fileListPath, limit) {
  const rows = fs.readFileSync(fileListPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const selected = limit > 0 ? rows.slice(0, limit) : rows;
  return selected.map(relativeOrAbsolute => {
    const absolute = path.isAbsolute(relativeOrAbsolute)
      ? relativeOrAbsolute
      : path.join(REPO_ROOT, relativeOrAbsolute);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Image listed but not found: ${relativeOrAbsolute}`);
    }
    const hash = path.basename(absolute, path.extname(absolute));
    return {
      hash,
      absolute,
      relative: path.relative(REPO_ROOT, absolute).split(path.sep).join('/'),
      fileName: `jr-reward-${hash}.webp`
    };
  });
}

function multipartBody(metadata, filePath) {
  const boundary = `jr_rewards_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const fileBytes = fs.readFileSync(filePath);
  const before = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: image/webp\r\n\r\n',
    'utf8'
  );
  const after = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    body: Buffer.concat([before, fileBytes, after]),
    contentType: `multipart/related; boundary=${boundary}`
  };
}

async function uploadImage(client, folderId, image) {
  const metadata = {
    name: image.fileName,
    mimeType: 'image/webp',
    parents: [folderId]
  };
  const multipart = multipartBody(metadata, image.absolute);
  return client.request(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,size,md5Checksum`, {
    method: 'POST',
    headers: {
      'content-type': multipart.contentType,
      'content-length': String(multipart.body.length)
    },
    body: multipart.body
  });
}

async function uploadWithRetry(client, folderId, image, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await uploadImage(client, folderId, image);
    } catch (error) {
      lastError = error;
      const delayMs = 500 * attempt * attempt;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function runQueue(items, worker, concurrency) {
  let nextIndex = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function writeOutput(outputPath, payload) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const csvPath = outputPath.replace(/\.json$/i, '.csv');
  const headers = ['hash', 'fileName', 'fileId', 'viewUrl', 'thumbnailUrl', 'localFile'];
  const lines = [
    headers.join(','),
    ...payload.files.map(file => headers.map(header => csvEscape(file[header] || '')).join(','))
  ];
  fs.writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8');
}

function csvEscape(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const options = parseArgs(process.argv);
  const oauthConfig = readOAuthConfig(options.oauthPath);
  const accessToken = await refreshAccessToken(oauthConfig);
  const client = makeDriveClient(accessToken);
  const folder = await findOrCreateFolder(client, options.folderName, options.folderId);
  console.log(`[drive-upload] Folder: ${folder.name} (${folder.id})`);

  const shared = options.shareAnyone ? await ensureAnyoneReader(client, folder.id) : false;
  if (shared) console.log('[drive-upload] Folder has anyone-reader permission.');

  const images = readImagePaths(options.fileListPath, options.limit);
  const existingByName = await loadExistingFiles(client, folder.id);
  const uploadedFiles = [];
  let uploaded = 0;
  let skipped = 0;

  await runQueue(images, async image => {
    const existing = existingByName.get(image.fileName);
    const file = existing || await uploadWithRetry(client, folder.id, image);
    if (existing) skipped += 1;
    else uploaded += 1;

    uploadedFiles.push({
      hash: image.hash,
      fileName: image.fileName,
      fileId: file.id,
      viewUrl: file.webViewLink || driveFileUrl(file.id),
      thumbnailUrl: driveThumbnailUrl(file.id),
      localFile: image.relative
    });

    const done = uploadedFiles.length;
    if (done % 100 === 0 || done === images.length) {
      console.log(`[drive-upload] ${done}/${images.length} processed (${uploaded} uploaded, ${skipped} already present)`);
    }
  }, options.concurrency);

  uploadedFiles.sort((a, b) => a.hash.localeCompare(b.hash));
  writeOutput(options.outputPath, {
    generatedAt: new Date().toISOString(),
    folder: {
      id: folder.id,
      name: folder.name,
      url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
      anyoneReader: shared
    },
    total: uploadedFiles.length,
    uploaded,
    skipped,
    files: uploadedFiles
  });

  console.log(`[drive-upload] Wrote ${options.outputPath}`);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
