const express = require('express');
const axios = require('axios');
const http = require('http');

const app = express();
app.use(express.json());

const NOMINATIM_URL = (process.env.NOMINATIM_URL || '').trim();
const MEILI_URL = process.env.MEILI_URL || 'http://localhost:7700';
const MEILI_KEY = process.env.MEILI_KEY || 'vn-geocode-key-2026';
const INDEX = 'places';

const STOPWORDS = new Set(['duong', 'pho', 'phuong', 'quan', 'huyen', 'xa', 'thi', 'tran', 'tp', 'tinh', 'so']);

function stripDiacritics(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function cleanSearch(s) {
  return s.split(/\s+/).filter(w => w && !STOPWORDS.has(w)).join(' ');
}

function normalizeQuery(q) {
  return cleanSearch(stripDiacritics(String(q || '').trim()));
}

function meiliSearch(q, limit = 10, extra = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ q, limit, ...extra });
    const req = http.request(`${MEILI_URL}/indexes/${INDEX}/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MEILI_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${res.statusCode}: ${data.slice(0, 200)}`));
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('meili timeout')));
    req.write(body);
    req.end();
  });
}

function hitToNominatimFormat(hit) {
  return {
    place_id: Number(hit.id),
    licence: 'Data (c) OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    osm_type: hit.osm_type,
    osm_id: hit.osm_id,
    boundingbox: hit.boundingbox,
    lat: String(hit._geo.lat),
    lon: String(hit._geo.lng),
    display_name: hit.display,
    class: hit.class,
    type: hit.type,
    importance: hit.importance || 0
  };
}

// ---------- fallback: original multi-query Nominatim flow ----------
const VN_SYNONYMS = {
  'đ': 'duong',
  'đg': 'duong',
  'q': 'quan',
  'h': 'huyen',
  'p': 'phuong',
  'x': 'xa',
  'tp': 'thanh pho',
  't': 'tinh'
};

function normalizeVietnameseAddress(query) {
  let normalized = query.toLowerCase().trim();
  Object.entries(VN_SYNONYMS).forEach(([abbr, full]) => {
    normalized = normalized.replace(new RegExp(`\\b${abbr}\\b`, 'g'), full);
  });
  const hasStreetKeyword = ['duong', 'đường', 'đ', 'pho', 'phố'].some(k => normalized.includes(k));
  const hasNumber = /^\d+/.test(normalized) || /\b\d+\b/.test(normalized);
  if (hasNumber && !hasStreetKeyword) {
    normalized = normalized.replace(/^(\d+)/, '$1 duong');
  }
  return normalized;
}

function buildSmartQueries(originalQuery) {
  const queries = new Set([originalQuery]);
  const normalized = normalizeVietnameseAddress(originalQuery);
  queries.add(normalized);
  queries.add(`${normalized}, việt nam`);
  queries.add(`${normalized}, vietnam`);
  const numMatch = originalQuery.match(/^(\d+)/);
  if (numMatch) {
    queries.add(`số ${numMatch[1]} ${normalized.replace(/^\d+\s*/, '')}`);
    if (!normalized.includes('duong')) {
      queries.add(`${numMatch[1]} duong ${normalized.replace(/^\d+\s*/, '')}`);
      queries.add(`${numMatch[1]} đường ${normalized.replace(/^\d+\s*/, '')}`);
    }
  }
  return Array.from(queries);
}

async function nominatimFallback(q) {
  const queries = buildSmartQueries(q);
  let allResults = [];
  const seen = new Set();
  await Promise.all(queries.map(async (query) => {
    try {
      const response = await axios.get(`${NOMINATIM_URL}/search`, {
        params: { q: query, format: 'json', limit: 10 },
        timeout: 8000
      });
      for (const result of response.data) {
        const key = `${result.osm_type}-${result.osm_id}`;
        if (!seen.has(key)) { seen.add(key); allResults.push(result); }
      }
    } catch (err) { /* ignore */ }
  }));
  allResults.sort((a, b) => (b.importance || 0) - (a.importance || 0));
  return allResults.slice(0, 10);
}

// ---------- routes ----------
app.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Missing query parameter q' });
    const limit = Math.min(Number(req.query.limit) || 10, 50);

    try {
      const nq = normalizeQuery(q);
      const out = await meiliSearch(nq, limit);
      if (out.hits && out.hits.length > 0) {
        return res.json(out.hits.map(hitToNominatimFormat));
      }
    } catch (e) {
      console.warn('Meilisearch failed:', e.message);
    }

    if (!NOMINATIM_URL) {
      console.warn('No results and NOMINATIM_URL not set (slim mode)');
      return res.json([]);
    }
    const results = await nominatimFallback(q);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/reverse', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!NOMINATIM_URL) {
      const la = Number(lat), lo = Number(lon);
      if (!isFinite(la) || !isFinite(lo)) {
        return res.status(400).json({ error: 'Invalid lat/lon' });
      }
      const out = await meiliSearch('', 1, {
        sort: [`_geoPoint(${la},${lo}):asc`]
      });
      const hit = out.hits && out.hits[0];
      if (!hit) return res.status(404).json({ error: 'Unable to geocode' });
      const r = hitToNominatimFormat(hit);
      r.name = hit.name || '';
      return res.json(r);
    }
    const response = await axios.get(`${NOMINATIM_URL}/reverse`, {
      params: { format: 'json', ...req.query },
      timeout: 8000
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Smart geocoder proxy :${PORT} (Meilisearch${NOMINATIM_URL ? ' -> Nominatim fallback' : ', slim mode'})`));