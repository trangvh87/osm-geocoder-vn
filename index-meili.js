const { spawn } = require('child_process');
const http = require('http');

const MEILI_URL = process.env.MEILI_URL || 'http://localhost:7700';
const MEILI_KEY = process.env.MEILI_KEY || 'vn-geocode-key-2026';
const INDEX = 'places';
const BATCH_SIZE = 20000;

function stripDiacritics(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

const STOPWORDS = new Set(['duong', 'pho', 'phuong', 'quan', 'huyen', 'xa', 'thi', 'tran', 'tp', 'tinh', 'so']);

function cleanSearch(s) {
  return s.split(/\s+/).filter(w => w && !STOPWORDS.has(w)).join(' ');
}

function normalizeForIndex(s) {
  return cleanSearch(stripDiacritics(String(s || '')));
}

function meiliRequest(method, path, body, contentType) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(body, 'utf8') : null;
    const req = http.request(`${MEILI_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${MEILI_KEY}`,
        ...(payload ? { 'Content-Type': contentType || 'application/json', 'Content-Length': payload.length } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode}: ${data.slice(0, 500)}`));
        resolve(data ? JSON.parse(data) : null);
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('meili timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

// FORMAT text: fields separated by TAB, backslash escaped (\\ \t \n)
function unescapeText(v) {
  return v.replace(/\\(.)/g, (_, ch) => ({ t: '\t', n: '\n', '\\': '\\' }[ch] ?? ch));
}

function buildSql() {
  return `
COPY (
WITH RECURSIVE targets AS (
  SELECT p.* FROM placex p
  WHERE p.indexed_status = 0
    AND (p.name IS NOT NULL OR (p.housenumber IS NOT NULL AND p.housenumber <> ''))
),
chain(root_id, anc_id, d) AS (
  SELECT t.place_id, t.parent_place_id, 1 FROM targets t WHERE t.parent_place_id IS NOT NULL
  UNION ALL
  SELECT c.root_id, pp.parent_place_id, c.d + 1
  FROM chain c
  JOIN placex pp ON pp.place_id = c.anc_id
  WHERE pp.parent_place_id IS NOT NULL AND c.d < 12
),
ctx AS (
  SELECT c.root_id, string_agg(x.name->'name', ', ' ORDER BY c.d) AS ctxt
  FROM (
    SELECT DISTINCT ON (c.root_id, c.anc_id, c.d) c.root_id, c.anc_id, c.d
    FROM chain c
  ) c
  JOIN placex x ON x.place_id = c.anc_id AND x.name ? 'name'
  GROUP BY c.root_id
)
SELECT
  t.place_id::text,
  t.osm_type,
  t.osm_id::text,
  t.class,
  t.type,
  COALESCE(t.name->'name', ''),
  COALESCE(t.housenumber, ''),
  COALESCE(t.postcode, ''),
  round(ST_Y(t.centroid)::numeric, 7),
  round(ST_X(t.centroid)::numeric, 7),
  COALESCE(t.importance, 0)::float8,
  t.rank_address,
  COALESCE(cx.ctxt, ''),
  round(ST_XMin(t.geometry)::numeric, 7),
  round(ST_YMin(t.geometry)::numeric, 7),
  round(ST_XMax(t.geometry)::numeric, 7),
  round(ST_YMax(t.geometry)::numeric, 7)
FROM targets t
LEFT JOIN ctx cx ON cx.root_id = t.place_id
) TO STDOUT WITH (FORMAT text);
`;
}
async function main() {
  console.log('Creating Meilisearch index...');
  await meiliRequest('DELETE', `/indexes/${INDEX}`).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await meiliRequest('POST', `/indexes`, JSON.stringify({ uid: INDEX, primaryKey: 'id' }));

  console.log('Extracting from PostgreSQL (docker exec psql)...');
  const child = spawn('docker', [
    'exec', '-i',
    '-e', 'PGCLIENTENCODING=UTF8',
    'nominatim-local', 'sudo', '-E', '-u', 'postgres', 'psql', '-d', 'nominatim', '-q'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  child.stdin.write(buildSql());
  child.stdin.end();

  let errBuf = '';
  child.stderr.on('data', c => errBuf += c);

  let buf = '';
  let total = 0;
  let batch = [];
  let uploads = [];

  function rowToDoc(cols) {
    const [id, osmType, osmId, klass, type, name, housenumber, postcode, lat, lon, importance, rankAddress, context, xmin, ymin, xmax, ymax] = cols;
    const nameNrm = normalizeForIndex(name);
    const ctxNrm = normalizeForIndex(context);

    let display;
    if (name && housenumber) display = `${name}, ${housenumber}, ${ctxNrm ? context : ''}`.replace(/, $/, '');
    else if (housenumber) display = `${housenumber}, ${context}`;
    else display = ctxNrm ? `${name}, ${context}` : name;

    // degenerate bbox (node/point) -> pad like Nominatim
    let bb;
    if (xmin === xmax || ymin === ymax) {
      bb = [
        String(Number(ymin) - 0.00005),
        String(Number(ymax) + 0.00005),
        String(Number(xmin) - 0.00005),
        String(Number(xmax) + 0.00005)
      ];
    } else {
      bb = [ymin, ymax, xmin, xmax];
    }

    return {
      id,
      osm_type: osmType,
      osm_id: Number(osmId),
      class: klass,
      type,
      name,
      housenumber,
      postcode,
      context,
      display,
      nrm: nameNrm,
      stext: `${nameNrm} ${housenumber} ${ctxNrm}`.trim(),
      _geo: { lat: Number(lat), lng: Number(lon) },
      boundingbox: bb,
      importance: Number(importance) || 0,
      rank_address: Number(rankAddress)
    };
  }

  async function flush(final = false) {
    if (!batch.length) return;
    const ndjson = batch.map(d => JSON.stringify(d)).join('\n');
    const task = await meiliRequest(
      'POST', `/indexes/${INDEX}/documents?primaryKey=id`, ndjson, 'application/x-ndjson'
    );
    uploads.push(task.taskUid);
    total += batch.length;
    console.log(`Uploaded ${total} docs...`);
    batch = [];
  }

  let uploading = false;
  let fatalError = null;

  child.stdout.on('data', (chunk) => {
    if (fatalError) return;
    buf += chunk.toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim() || /^COPY \d+$/.test(line.trim())) continue;
      const cols = line.split('\t').map(unescapeText);
      try { batch.push(rowToDoc(cols)); } catch (e) { console.warn('Row parse fail:', e.message); }
    }
    if (batch.length >= BATCH_SIZE && !uploading) {
      uploading = true;
      child.stdout.pause();
      flush().then(() => { uploading = false; if (!fatalError) child.stdout.resume(); })
             .catch(e => { fatalError = e; });
    }
  });
  child.stdout.on('end', () => {
    if (!fatalError && buf.trim() && !/^COPY \d+$/.test(buf.trim())) {
      const cols = buf.split('\t').map(unescapeText);
      try { batch.push(rowToDoc(cols)); } catch (e) { console.warn('Row parse fail:', e.message); }
    }
  });
  child.on('error', (e) => { fatalError = e; });

  await new Promise((resolve) => {
    child.stdout.on('end', () => resolve());
  });

  try { await flush(true); } catch (e) { throw e; }

  if (errBuf.trim()) console.log('psql stderr:', errBuf.trim().slice(0, 1000));
  console.log(`Extraction done. Total docs: ${total}. Waiting for Meilisearch indexing tasks...`);

  // wait all tasks complete
  while (uploads.length) {
    const check = uploads[0];
    const t = await meiliRequest('GET', `/tasks/${check}`);
    if (t.status === 'succeeded') { uploads.shift(); continue; }
    if (t.status === 'failed') throw new Error(`Task failed: ${t.error?.message}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('Configuring index settings...');
  const task = await meiliRequest('PATCH', `/indexes/${INDEX}/settings`, JSON.stringify({
    searchableAttributes: ['stext'],
    filterableAttributes: ['class', 'type', 'rank_address'],
    sortableAttributes: ['_geo'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness', 'importance:desc'],
    typoTolerance: {
      minWordSizeForTypos: { oneTypo: 3, twoTypos: 7 }
    }
  }));

  // poll the actual task until it finishes
  let done = false;
  while (!done) {
    const t = await meiliRequest('GET', `/tasks/${task.taskUid}`);
    if (t.status === 'succeeded') done = true;
    else if (t.status === 'failed') throw new Error(`Settings failed: ${t.error?.message}`);
    else await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`DONE. Indexed ${total} documents.`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });